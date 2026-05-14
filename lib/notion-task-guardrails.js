'use strict';

// Central guardrails for Hermes/Dashboard <-> Notion Task Board sync.
// Notion cannot make select properties required at the database layer, so every
// Task Board creation/sync path must normalize or reject active tasks here.

const ACTIVE_TASK_BUCKETS = new Set(['todo', 'progress', 'done']);
const ARCHIVE_TASK_BUCKETS = new Set(['archive', 'cancelled', 'canceled']);

const STATUS_MAP = {
  todo: 'To Do',
  progress: 'In Progress',
  done: 'Done'
};

const PRIORITY_MAP = {
  0: 'P0 Critical',
  1: 'P1 High',
  2: 'P2 Medium',
  3: 'P3 Low'
};

// Map internal agent IDs and canonical names to Notion select options.
const AGENT_MAP = {
  main: 'Halo',
  halo: 'Halo',
  exec: 'Elon',
  elon: 'Elon',
  cto: 'Orion',
  orion: 'Orion',
  dev: 'Dev',
  coo: 'Atlas',
  atlas: 'Atlas',
  cfo: 'Sterling',
  sterling: 'Sterling',
  cmp: 'Vector',
  vector: 'Vector',
  smm: 'Nova',
  nova: 'Nova',
  sec: 'Knox',
  knox: 'Knox',
  tax: 'Ledger',
  ledger: 'Ledger',
  family: 'Haven',
  haven: 'Haven',
  creative: 'Luma',
  luma: 'Luma',
  docs: 'Canon',
  canon: 'Canon',
  forge: 'Forge',
  quill: 'Dev',
  chip: 'Dev',
  snip: 'Dev',
  net: 'Dev'
};

const DEFAULT_AGENT = 'Dev';
const SLA_DAYS_BY_PRIORITY = {
  0: 1,
  1: 3,
  2: 7,
  3: 14
};

function isActiveTaskStatus(status) {
  const normalized = String(status || '').toLowerCase().trim();
  return ACTIVE_TASK_BUCKETS.has(normalized) || (!ARCHIVE_TASK_BUCKETS.has(normalized) && normalized !== '');
}

function normalizeDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Already ISO-ish.
  const iso = raw.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (iso) return iso[0];

  // Common US numeric date. Keep this conservative to avoid ambiguous date ranges.
  const slash = raw.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function extractExplicitDueDate(task = {}) {
  const direct = normalizeDateString(task.dueDate || task.due || task.deadline || task.targetDate || task.date);
  if (direct) return direct;

  const title = String(task.title || '');
  const description = String(task.description || task.notes || '');
  const haystack = `${title}\n${description}`;

  // Only accept a single clear date. Multiple dates may be ranges/windows and need human policy.
  const isoMatches = [...haystack.matchAll(/\b20\d{2}-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])\b/g)].map(m => m[0]);
  const slashMatches = [...haystack.matchAll(/\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/20\d{2}\b/g)].map(m => normalizeDateString(m[0]));
  const uniqueDates = Array.from(new Set([...isoMatches, ...slashMatches].filter(Boolean)));
  return uniqueDates.length === 1 ? uniqueDates[0] : null;
}

function deriveSlaDueDate(task = {}, now = new Date()) {
  const rawPriority = Number(task.priority ?? 2);
  const priority = Number.isFinite(rawPriority) ? Math.max(0, Math.min(3, rawPriority)) : 2;
  const days = SLA_DAYS_BY_PRIORITY[priority];
  if (!days) return null;

  const base = normalizeDateString(task.createdAt || task.created) || normalizeDateString(now);
  const due = new Date(`${base}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + days);
  return due.toISOString().slice(0, 10);
}

function resolveNotionAgent(task = {}, { allowDefault = true } = {}) {
  const raw = String(task.agent || task.assignedAgent || task.assigned_agent || task.assignee || '').trim();
  if (!raw) return allowDefault ? DEFAULT_AGENT : null;
  const normalized = raw.toLowerCase();
  return AGENT_MAP[normalized] || raw.replace(/\b\w/g, c => c.toUpperCase());
}

function buildGuardedTaskProperties(task = {}, status = 'todo', options = {}) {
  const active = isActiveTaskStatus(status);
  const agent = resolveNotionAgent(task, { allowDefault: active });
  const dueDate = extractExplicitDueDate(task) || (active ? deriveSlaDueDate(task, options.now) : null);

  const errors = [];
  if (active && !agent) errors.push('Assigned Agent is required before syncing a task into an active Task Board state.');

  return {
    ok: errors.length === 0,
    errors,
    status,
    active,
    notionStatus: STATUS_MAP[status] || STATUS_MAP.todo,
    notionPriority: PRIORITY_MAP[task.priority] || PRIORITY_MAP[2],
    notionAgent: agent,
    dueDate,
    appliedDefaults: {
      assignedAgent: !String(task.agent || task.assignedAgent || task.assigned_agent || task.assignee || '').trim() && Boolean(agent),
      dueDate: !extractExplicitDueDate(task) && Boolean(dueDate)
    }
  };
}

function appendGuardedNotionProperties(properties, task = {}, status = 'todo', options = {}) {
  const guard = buildGuardedTaskProperties(task, status, options);
  if (!guard.ok) {
    const err = new Error(guard.errors.join(' '));
    err.guard = guard;
    throw err;
  }

  properties.Status = { select: { name: guard.notionStatus } };
  properties.Priority = { select: { name: guard.notionPriority } };
  if (guard.notionAgent) properties['Assigned Agent'] = { select: { name: guard.notionAgent } };
  if (guard.dueDate) properties['Due Date'] = { date: { start: guard.dueDate } };
  return guard;
}

function validateNotionPageForActiveSync(page, status) {
  if (!isActiveTaskStatus(status)) return { ok: true, errors: [] };
  const props = page?.properties || {};
  const agent = props['Assigned Agent']?.select?.name;
  if (agent) return { ok: true, errors: [] };
  const title = props.Task?.title?.[0]?.plain_text || props.Name?.title?.[0]?.plain_text || page?.id || 'Untitled';
  return {
    ok: false,
    errors: [`Notion Task Board page "${title}" is active but missing Assigned Agent; refusing to sync into dashboard active state.`]
  };
}

module.exports = {
  ACTIVE_TASK_BUCKETS,
  AGENT_MAP,
  DEFAULT_AGENT,
  STATUS_MAP,
  PRIORITY_MAP,
  SLA_DAYS_BY_PRIORITY,
  isActiveTaskStatus,
  normalizeDateString,
  extractExplicitDueDate,
  deriveSlaDueDate,
  resolveNotionAgent,
  buildGuardedTaskProperties,
  appendGuardedNotionProperties,
  validateNotionPageForActiveSync
};
