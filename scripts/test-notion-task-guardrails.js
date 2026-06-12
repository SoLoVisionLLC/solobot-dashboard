#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildGuardedTaskProperties,
  appendGuardedNotionProperties,
  validateNotionPageForActiveSync,
  extractExplicitDueDate
} = require('../lib/notion-task-guardrails');

function pageWith({ title = 'Test Task', status = 'To Do', agent = 'Dev', dueDate = null } = {}) {
  const properties = {
    Task: { title: [{ plain_text: title }] },
    Status: { select: { name: status } },
    'Assigned Agent': agent ? { select: { name: agent } } : { select: null }
  };
  if (dueDate) properties['Due Date'] = { date: { start: dueDate } };
  return { id: 'page-id', properties };
}

// Default Assigned Agent + SLA due date for active local/dashboard tasks.
{
  const guard = buildGuardedTaskProperties(
    { title: 'Launch cleanup', priority: 1, created: '2026-05-14T10:00:00.000Z' },
    'todo',
    { now: new Date('2026-05-14T10:00:00.000Z') }
  );
  assert.strictEqual(guard.ok, true);
  assert.strictEqual(guard.notionAgent, 'Dev');
  assert.strictEqual(guard.dueDate, '2026-05-17');
  assert.deepStrictEqual(guard.appliedDefaults, { assignedAgent: true, dueDate: true });
}

// Preserve explicit date when source task title carries one.
{
  const guard = buildGuardedTaskProperties(
    { title: 'Send client proof by 2026-06-01', agent: 'orion', priority: 2 },
    'progress',
    { now: new Date('2026-05-14T10:00:00.000Z') }
  );
  assert.strictEqual(guard.notionAgent, 'Orion');
  assert.strictEqual(guard.dueDate, '2026-06-01');
  assert.strictEqual(extractExplicitDueDate({ title: 'Due 06/03/2026' }), '2026-06-03');
}

// Refuse active Notion pages with no Assigned Agent rather than syncing them into dashboard active lists.
{
  const guard = validateNotionPageForActiveSync(pageWith({ agent: null }), 'todo');
  assert.strictEqual(guard.ok, false);
  assert.match(guard.errors[0], /missing Assigned Agent/);
}

// Append canonical Notion properties used by creation and status-sync paths.
{
  const properties = { Task: { title: [{ text: { content: 'Guarded create' } }] } };
  const guard = appendGuardedNotionProperties(
    properties,
    { title: 'Guarded create', agent: 'nova', dueDate: '2026-06-10', priority: 0 },
    'progress'
  );
  assert.strictEqual(guard.ok, true);
  assert.deepStrictEqual(properties.Status, { select: { name: 'In Progress' } });
  assert.deepStrictEqual(properties.Priority, { select: { name: 'P0 Critical' } });
  assert.deepStrictEqual(properties['Assigned Agent'], { select: { name: 'Nova' } });
  assert.deepStrictEqual(properties['Due Date'], { date: { start: '2026-06-10' } });
}

console.log('notion-task-guardrails: all assertions passed');
