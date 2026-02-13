// js/subagent-monitor.js — Sub-agent activity monitor widget

function renderSubagentMonitor() {
  const container = document.getElementById('subagent-monitor-content');
  if (!container) return;

  // Filter subagent sessions from available sessions
  const sessions = window.availableSessions || [];
  const subagents = sessions.filter(s => s.key && s.key.includes(':subagent:'));

  if (subagents.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No sub-agent sessions</div>';
    return;
  }

  // Sort by updatedAt descending (most recent first)
  subagents.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // Show most recent 10
  const visible = subagents.slice(0, 10);

  const rows = visible.map(s => {
    const agent = extractAgent(s.key);
    const label = s.displayName || s.name || extractLabel(s.key);
    const age = timeSince(s.updatedAt);
    const isRecent = Date.now() - (s.updatedAt || 0) < 300000; // 5 min
    const dot = isRecent ? 'success' : 'idle';

    return `<div class="subagent-row">
      <span class="status-dot ${dot}"></span>
      <span class="subagent-agent">${agent}</span>
      <span class="subagent-label" title="${escapeHtml(label)}">${truncate(label, 40)}</span>
      <span class="subagent-time">${age}</span>
    </div>`;
  }).join('');

  const total = subagents.length;
  const active = subagents.filter(s => Date.now() - (s.updatedAt || 0) < 300000).length;

  container.innerHTML = `
    <div class="subagent-summary">
      <span>${active} active</span>
      <span style="color: var(--text-muted)">${total} total</span>
    </div>
    <div class="subagent-list">${rows}</div>
  `;
}

function extractAgent(key) {
  const m = key.match(/^agent:([^:]+):/);
  return m ? m[1].toUpperCase() : '?';
}

function extractLabel(key) {
  const parts = key.split(':');
  return parts[parts.length - 1]?.substring(0, 8) || 'unknown';
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function timeSince(ts) {
  if (!ts) return '—';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

function escapeHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Auto-refresh with existing session polling
const _origRenderSessions = window.renderSessionList;
window.renderSessionList = function() {
  if (typeof _origRenderSessions === 'function') _origRenderSessions();
  renderSubagentMonitor();
};

// Also hook into periodic refresh
setInterval(renderSubagentMonitor, 15000);
