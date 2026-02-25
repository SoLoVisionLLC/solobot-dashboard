// js/daily-journal.js — Agents page daily journal view
(function () {
  'use strict';

  const api = window._dailyJournal || (window._dailyJournal = {});

  let lastIndex = [];
  let selectedDate = null;
  let currentView = 'org'; // org | log | journal
  let lastDaily = null;
  let timelineMode = 'detailed'; // brief | detailed

  const AGENTS = ['main', 'elon', 'orion', 'atlas', 'sterling', 'dev', 'forge', 'knox', 'sentinel', 'vector', 'canon', 'luma', 'ledger', 'quill', 'chip', 'nova', 'snip', 'family'];

  function $(id) { return document.getElementById(id); }

  function escapeHtml(v) {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  }

  function syncViewButtons() {
    const set = (id, active) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle('btn-secondary', active);
      el.classList.toggle('btn-ghost', !active);
    };
    set('agents-view-org', currentView === 'org');
    set('agents-view-log', currentView === 'log');
    set('agents-view-journal', currentView === 'journal');
  }

  function applyContextAgentFilter() {
    const sel = $('journal-filter-agent');
    if (!sel) return;

    const drilled = window._memoryCards?.getCurrentAgentId?.() || '';
    if (drilled) {
      sel.value = drilled;
      return;
    }

    // If opened from org-chart context (not drilled), show full cross-agent logs.
    sel.value = '';
  }

  function buildAgentsPath(view, agentId) {
    if (view === 'org') return agentId ? `/agents/${agentId}` : '/agents';
    if (view === 'log') return agentId ? `/agents/${agentId}/log` : '/agents/log';
    if (view === 'journal') return agentId ? `/agents/${agentId}/journal` : '/agents/journal';
    return '/agents';
  }

  function pushAgentsHistory(view) {
    const agentId = window._memoryCards?.getCurrentAgentId?.() || null;
    const nextPath = buildAgentsPath(view, agentId);
    const state = { page: 'agents', agentId, agentsView: view };
    if (window.location.pathname !== nextPath) {
      history.pushState(state, '', nextPath);
    } else {
      history.replaceState(state, '', nextPath);
    }
  }

  function showOrg(updateURL = true) {
    currentView = 'org';
    const org = $('agents-org-shell');
    const log = $('agents-log-shell');
    const journal = $('agents-journal-shell');
    if (org) org.style.display = '';
    if (log) log.style.display = 'none';
    if (journal) journal.style.display = 'none';
    syncViewButtons();
    if (updateURL) pushAgentsHistory('org');
  }

  function showLog(updateURL = true) {
    currentView = 'log';
    const org = $('agents-org-shell');
    const log = $('agents-log-shell');
    const journal = $('agents-journal-shell');
    if (org) org.style.display = 'none';
    if (log) log.style.display = '';
    if (journal) journal.style.display = 'none';
    syncViewButtons();
    if (updateURL) pushAgentsHistory('log');

    applyContextAgentFilter();

    if (!lastIndex.length) loadIndex();
    else {
      const filtered = getFilteredIndex();
      renderDayList(filtered);
      const targetDate = selectedDate || filtered[0]?.date || lastIndex[0]?.date;
      if (targetDate) loadDaily(targetDate);
    }
  }

  function showJournalTimeline(updateURL = true) {
    currentView = 'journal';
    const org = $('agents-org-shell');
    const log = $('agents-log-shell');
    const journal = $('agents-journal-shell');
    if (org) org.style.display = 'none';
    if (log) log.style.display = 'none';
    if (journal) journal.style.display = '';
    syncViewButtons();
    if (updateURL) pushAgentsHistory('journal');

    applyContextAgentFilter();

    if (!lastIndex.length) loadIndex();
    else {
      const filtered = getFilteredIndex();
      renderDayList(filtered);
      const targetDate = selectedDate || filtered[0]?.date || lastIndex[0]?.date;
      if (targetDate) loadDaily(targetDate);
      else if (lastDaily) renderTimeline(lastDaily);
    }
  }

  function normalizeIndex(payload) {
    const raw = Array.isArray(payload) ? payload
      : Array.isArray(payload?.days) ? payload.days
      : Array.isArray(payload?.entries) ? payload.entries
      : [];

    return raw.map((x) => ({
      date: x.date || x.day || x.dateKey || '',
      agents: Array.isArray(x.agents) ? x.agents : (x.agent ? [x.agent] : []),
      tags: Array.isArray(x.tags) ? x.tags : [],
      count: Number(x.count ?? x.itemsCount ?? x.total ?? x?.counts?.total ?? 0) || 0
    })).filter(x => x.date);
  }

  function normalizeEntry(v) {
    if (v == null) return null;
    if (typeof v === 'string') return { title: v, agent: null, timestamp: null };
    if (typeof v === 'object') {
      const title = String(v.title || v.text || v.content || v.id || '').trim();
      if (!title) return null;
      return {
        title,
        agent: v.agent || null,
        timestamp: v.timestamp || null
      };
    }
    const title = String(v).trim();
    return title ? { title, agent: null, timestamp: null } : null;
  }

  function asList(value) {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr.map(normalizeEntry).filter(Boolean);
  }

  function normalizeDaily(payload) {
    const sections = payload?.sections || {};
    const completed = asList(sections.completed || payload?.completed);
    const blockers = asList(sections.blockers || payload?.blockers);
    const decisions = asList(sections.decisions || payload?.decisions);
    const followups = asList(sections.pendingFollowups || sections.followUps || sections.pending || payload?.pendingFollowups || payload?.followups || payload?.pending);

    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (entries.length) {
      for (const e of entries) {
        const sec = String(e.section || e.type || '').toLowerCase();
        const normalized = normalizeEntry(e);
        if (!normalized) continue;
        if (sec.includes('complete')) completed.push(normalized);
        else if (sec.includes('block')) blockers.push(normalized);
        else if (sec.includes('decision')) decisions.push(normalized);
        else if (sec.includes('follow') || sec.includes('pend')) followups.push(normalized);
      }
    }

    return { completed, blockers, decisions, followups };
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderSection(id, items) {
    const el = $(id);
    if (!el) return;
    if (!items?.length) {
      el.innerHTML = '<div style="color:var(--text-muted);">—</div>';
      return;
    }

    el.innerHTML = `<div style="display:grid; gap:8px;">${items.map((i) => {
      const time = formatTime(i.timestamp);
      const agent = i.agent ? String(i.agent).toUpperCase() : '';
      return `<div style="border:1px solid var(--border-default); background:var(--surface-1); border-radius:8px; padding:8px;">
        ${time || agent ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${escapeHtml([time, agent].filter(Boolean).join(' • '))}</div>` : ''}
        <div style="font-size:12px; line-height:1.35;">${escapeHtml(i.title)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function splitNarrative(text) {
    const t = String(text || '').trim();
    if (!t) return { headline: '', details: '' };
    const parts = t.split(/\.(\s+|$)/).map(s => s.trim()).filter(Boolean);
    const headline = parts[0] || t;
    const rest = parts.slice(1).join('. ');
    return {
      headline: headline.length > 90 ? `${headline.slice(0, 87)}...` : headline,
      details: rest || t
    };
  }

  function cleanNarrativeTitle(title) {
    let t = String(title || '').trim();
    t = t
      .replace(/^\[[^\]]+\]\s*/g, '') // strip [cron:...] or similar prefixes
      .replace(/\b[a-z]+:[0-9a-f\-]{8,}\b/ig, '') // strip cron/session ids
      .replace(/\b[A-Z][a-z]+\s*\([^\)]+\)\s*$/g, '') // strip trailing "Canon (Docs)"
      .replace(/^[-*#`>\s]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Collapse noisy command/path-only starts
    t = t
      .replace(/^\/?home\/[\w\-/.]+\s*/i, '')
      .replace(/^\w+:\s+cannot\s+access\s+/i, '')
      .trim();

    return t;
  }

  function isMachineLikeText(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    if (/^\s*([\[{].*[\]}]|---\s*name:|```|#\s+[A-Z_]+|\/home\/|C:\\|jq: error|error: cannot pull|Command exited with code)/i.test(t)) return true;
    if (/\b(tool_call|process exited|unexpected token|stack trace|stdin|stdout|stderr|curl\s+-sS)\b/i.test(t)) return true;
    return false;
  }

  function extractTopicFromText(text) {
    const cleaned = cleanNarrativeTitle(text)
      .replace(/\*+/g, '')
      .replace(/`+/g, '')
      .replace(/\[[^\]]+\]\([^\)]+\)/g, '')
      .replace(/\b(commit|repo|branch|command exited|http\S+)\b/ig, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!cleaned) return '';

    const first = cleaned.split(/\.(\s+|$)/)[0].trim();
    const topic = first
      .replace(/^(yes[—\-,\s]+|done[—\-,\s]+|update[d]? now[—\-,\s]+|status[—\-,\s]+)/i, '')
      .replace(/^(here('| i)?s the current status on\s+)/i, '')
      .replace(/^(current status on\s+)/i, '')
      .replace(/^\d+\)\s*/, '')
      .trim();

    if (!topic) return '';
    return topic.length > 64 ? `${topic.slice(0, 61)}...` : topic;
  }

  function deriveHumanTitle(text, sectionLabel) {
    const t = cleanNarrativeTitle(text);
    if (!t) return `${sectionLabel} update`;

    const topic = extractTopicFromText(t);

    // Hard filters for technical/meta blobs in headline generation
    if (/\b(no such file|cannot access|command exited|jq: error|unexpected token|stack trace|\/home\/|\.md\b|^--\s*name:)\b/i.test(t)) {
      if (/\b(no such file|cannot access)\b/i.test(t)) {
        const m = t.match(/([\w.-]+\.md)\b/i);
        const file = m ? m[1] : '';
        return file ? `Issue update: Missing memory file ${file}` : 'Issue update: Missing file';
      }
      if (/\b(jq: error|unexpected token|stack trace)\b/i.test(t)) return topic ? `Issue update: ${topic}` : 'Issue update: Tooling error';
      if (/^--\s*name:/i.test(t)) {
        const nameMatch = t.match(/--\s*name:\s*([a-z0-9._-]+)/i);
        const name = nameMatch ? nameMatch[1] : '';
        return name ? `Docs update: ${name} metadata` : 'Docs update: Skill metadata';
      }
      return topic ? `${sectionLabel} update: ${topic}` : `${sectionLabel} update`;
    }

    const patterns = [
      { re: /\b(done|completed|shipped|implemented|fixed|resolved)\b/i, label: 'Completed' },
      { re: /\b(blocked|blocker|stuck|failed|error|dependency)\b/i, label: 'Blocker' },
      { re: /\b(decision|approved|approval|decided)\b/i, label: 'Decision' },
      { re: /\b(update|status|progress)\b/i, label: 'Progress' },
      { re: /\b(policy|scope|plan|roadmap)\b/i, label: 'Plan/Policy' },
      { re: /\b(notion|doc|documentation|runbook|agents\.md|skill)\b/i, label: 'Docs' },
      { re: /\b(browser|session|gateway|restart|maintenance)\b/i, label: 'System' }
    ];

    for (const p of patterns) {
      if (p.re.test(t)) return topic ? `${p.label}: ${topic}` : `${p.label} update`;
    }

    if (topic && !/[:/\\]|\b[a-z]+:[0-9a-f\-]{8,}\b/i.test(topic)) return topic;
    return `${sectionLabel} update`;
  }

  function synthesizeJournalEntry(entry) {
    const n = splitNarrative(entry?.title || '');
    const raw = `${n.headline}. ${n.details}`.trim();
    const text = raw.replace(/\s+/g, ' ').trim();

    const isDecision = /\b(decision|decided|approved|approval|go ahead|ship it)\b/i.test(text);
    const isBlocker = /\b(blocked|blocker|stuck|waiting|dependency|failed|error)\b/i.test(text);
    const isCompleted = /\b(done|completed|fixed|implemented|shipped|published|resolved)\b/i.test(text);

    const sectionLabel = entry?.sectionLabel || 'Work';
    let title = deriveHumanTitle(n.headline || text, sectionLabel);
    let happened = cleanNarrativeTitle(n.details || n.headline || '');
    let impact = '';
    let next = '';

    if (isDecision) {
      impact = 'Decision made and direction clarified for execution.';
      next = 'Execute against the chosen direction and report status at next checkpoint.';
    } else if (isBlocker) {
      impact = 'Progress risk identified; delivery may be delayed until blocker clears.';
      next = 'Unblock dependency and resume the planned implementation path.';
    } else if (isCompleted) {
      impact = 'Delivery moved forward with completed work and reduced pending risk.';
      next = 'Validate outcome and continue with the next queued task.';
    } else {
      impact = 'Work context updated with actionable progress details.';
      next = 'Continue execution and capture any blocker/decision explicitly.';
    }

    if (!happened || happened.length < 12) {
      happened = cleanNarrativeTitle(text) || text;
    }

    return { title, happened, impact, next };
  }

  function hourBucket(ts) {
    if (!ts) return 'Unknown';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return 'Unknown';
    return d.toLocaleTimeString([], { hour: 'numeric' });
  }

  function toggleTimelineMode() {
    timelineMode = timelineMode === 'brief' ? 'detailed' : 'brief';
    if (lastDaily) renderTimeline(lastDaily);
  }

  function renderTimeline(normalizedDaily) {
    const body = $('journal-timeline-body');
    const titleEl = $('journal-timeline-title');
    if (!body || !titleEl) return;

    const date = selectedDate || normalizedDaily?.date || 'Journal';
    titleEl.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <span>📝 Journal: ${escapeHtml(date)}</span>
        <button class="btn btn-ghost btn-xs" id="journal-mode-toggle">${timelineMode === 'brief' ? 'Detailed' : 'Brief'} view</button>
      </div>
    `;

    const sections = [
      { key: 'decisions', label: 'Decision', color: '#a78bfa', icon: '🧠' },
      { key: 'blockers', label: 'Issue', color: '#f87171', icon: '⚠️' },
      { key: 'completed', label: 'Update', color: '#34d399', icon: '✅' },
      { key: 'followups', label: 'Planned', color: '#60a5fa', icon: '📌' }
    ];

    const entries = [];
    for (const s of sections) {
      for (const item of (normalizedDaily?.[s.key] || [])) {
        entries.push({ ...item, section: s.key, sectionLabel: s.label, color: s.color, icon: s.icon });
      }
    }

    const seen = new Set();
    const deduped = [];
    for (const e of entries) {
      const minute = Math.floor(new Date(e.timestamp || 0).getTime() / 60000);
      const sig = `${String(e.agent || '').toLowerCase()}|${String(e.title || '').toLowerCase()}|${minute}|${e.section}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      deduped.push(e);
    }

    // Newest first (descending)
    deduped.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    const filteredNarrative = deduped.filter(e => !isMachineLikeText(e?.title));
    if (!filteredNarrative.length) {
      body.innerHTML = '<div style="color:var(--text-muted);">No natural-language journal entries for this day/filter yet.</div>';
      return;
    }

    const groups = new Map();
    for (const e of filteredNarrative) {
      const key = hourBucket(e.timestamp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    body.innerHTML = Array.from(groups.entries()).map(([hour, items]) => {
      const hourLabel = `<div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.04em; margin:8px 0 2px;">${escapeHtml(hour)} block</div>`;
      const rows = items.map((e) => {
        const tm = formatTime(e.timestamp) || '—';
        const agent = e.agent ? ` · ${String(e.agent).toUpperCase()}` : '';
        const s = synthesizeJournalEntry(e);
        return `
          <article style="position:relative; padding:8px 0 12px 18px; border-left:2px solid ${e.color}; margin-left:6px;">
            <div style="position:absolute; left:-6px; top:12px; width:10px; height:10px; border-radius:50%; background:${e.color};"></div>
            <h4 style="margin:0 0 6px 0; font-size:14px; font-weight:700; color:#8fb3ff;">${escapeHtml(`${e.icon} ${tm} — ${s.title}`)}</h4>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">${escapeHtml(`${e.sectionLabel}${agent}`)}</div>
            ${timelineMode === 'brief'
              ? `<div style="font-size:12px; color:var(--text-secondary); line-height:1.6;">${escapeHtml(s.happened)}</div>`
              : `<div style="font-size:12px; color:var(--text-secondary); line-height:1.65; display:grid; gap:6px;">
                  <div><strong>What happened:</strong> ${escapeHtml(s.happened)}</div>
                  <div><strong>Impact:</strong> ${escapeHtml(s.impact)}</div>
                  <div><strong>Next:</strong> ${escapeHtml(s.next)}</div>
                </div>`}
          </article>
        `;
      }).join('');
      return `${hourLabel}${rows}`;
    }).join('');

    document.getElementById('journal-mode-toggle')?.addEventListener('click', toggleTimelineMode);
  }

  function renderDayList(days) {
    const lists = [$('journal-day-list'), $('journal-day-list-timeline')].filter(Boolean);
    if (!lists.length) return;

    const html = (!days.length)
      ? '<div style="font-size:12px; color:var(--text-muted);">No journal days found.</div>'
      : days.map((d) => {
          const active = selectedDate === d.date;
          const meta = [d.agents?.length ? `${d.agents.length} agent(s)` : '', d.tags?.length ? `${d.tags.length} tag(s)` : '', d.count ? `${d.count} item(s)` : '']
            .filter(Boolean).join(' · ');
          return `<button data-date="${escapeHtml(d.date)}" style="width:100%; text-align:left; border:1px solid var(--border-default); background:${active ? 'var(--surface-3)' : 'var(--surface-1)'}; color:var(--text-primary); border-radius:8px; padding:8px; margin-bottom:8px; cursor:pointer;">
            <div style="font-size:13px; font-weight:600;">${escapeHtml(d.date)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(meta || 'Daily journal')}</div>
          </button>`;
        }).join('');

    for (const list of lists) {
      list.innerHTML = html;
      list.querySelectorAll('button[data-date]').forEach((b) => {
        b.addEventListener('click', () => loadDaily(b.getAttribute('data-date')));
      });
    }
  }

  async function loadIndex() {
    const list = $('journal-day-list');
    if (list) list.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Loading…</div>';
    try {
      const res = await fetch('/api/journal/index');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      lastIndex = normalizeIndex(data).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      applyFiltersAndRender();

      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const todayKey = `${yyyy}-${mm}-${dd}`;
      const todayInIndex = lastIndex.find(d => d.date === todayKey)?.date;
      const fallback = lastIndex[0]?.date;
      const targetDate = selectedDate || todayInIndex || fallback;
      if (targetDate) loadDaily(targetDate);
    } catch (e) {
      if (list) list.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Failed to load journal index.</div>';
      console.warn('[DailyJournal] loadIndex failed:', e.message);
    }
  }

  async function loadDaily(date) {
    if (!date) return;
    selectedDate = date;
    if ($('journal-filter-date')) $('journal-filter-date').value = date;
    renderDayList(getFilteredIndex());

    const params = new URLSearchParams({ date });
    const agent = $('journal-filter-agent')?.value || '';
    const tag = ($('journal-filter-tag')?.value || '').trim();
    if (agent) params.set('agent', agent);
    if (tag) params.set('tag', tag);

    ['journal-section-completed', 'journal-section-blockers', 'journal-section-decisions', 'journal-section-followups']
      .forEach(id => { const el = $(id); if (el) el.innerHTML = '<div style="color:var(--text-muted);">Loading…</div>'; });

    try {
      const res = await fetch(`/api/journal/daily?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const normalized = normalizeDaily(data);
      normalized.date = data?.date || date;
      lastDaily = normalized;
      renderSection('journal-section-completed', normalized.completed);
      renderSection('journal-section-blockers', normalized.blockers);
      renderSection('journal-section-decisions', normalized.decisions);
      renderSection('journal-section-followups', normalized.followups);
      renderTimeline(normalized);
    } catch (e) {
      ['journal-section-completed', 'journal-section-blockers', 'journal-section-decisions', 'journal-section-followups']
        .forEach(id => { const el = $(id); if (el) el.innerHTML = '<div style="color:var(--text-muted);">—</div>'; });
      const body = $('journal-timeline-body');
      if (body) body.innerHTML = '<div style="color:var(--text-muted);">Failed to load journal entries.</div>';
      console.warn('[DailyJournal] loadDaily failed:', e.message);
    }
  }

  function getFilteredIndex() {
    const date = $('journal-filter-date')?.value || '';
    const agent = $('journal-filter-agent')?.value || '';
    const tag = ($('journal-filter-tag')?.value || '').trim().toLowerCase();

    return lastIndex.filter((d) => {
      if (date && d.date !== date) return false;
      if (agent && !(d.agents || []).map(a => String(a).toLowerCase()).includes(agent.toLowerCase())) return false;
      if (tag && !(d.tags || []).some(t => String(t).toLowerCase().includes(tag))) return false;
      return true;
    });
  }

  function applyFiltersAndRender() {
    const filtered = getFilteredIndex();
    renderDayList(filtered);
  }

  function search() {
    applyFiltersAndRender();
    const filtered = getFilteredIndex();
    if (filtered[0]?.date) loadDaily(filtered[0].date);
  }

  function clearFilters() {
    if ($('journal-filter-date')) $('journal-filter-date').value = '';
    if ($('journal-filter-agent')) $('journal-filter-agent').value = '';
    if ($('journal-filter-tag')) $('journal-filter-tag').value = '';
    applyFiltersAndRender();
    if (lastIndex[0]?.date) loadDaily(lastIndex[0].date);
  }

  function initAgentFilter() {
    const sel = $('journal-filter-agent');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map(o => o.value));
    AGENTS.forEach((a) => {
      if (existing.has(a)) return;
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      sel.appendChild(opt);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initAgentFilter();
    // default view remains org (no URL mutation on boot)
    showOrg(false);
  });

  Object.assign(api, {
    showOrg,
    showLog,
    showJournalTimeline,
    // backward-compat for older bindings
    showJournal: showLog,
    search,
    clearFilters,
    loadIndex,
    loadDaily
  });
})();