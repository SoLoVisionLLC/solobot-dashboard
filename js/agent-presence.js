// js/agent-presence.js — live mission-control presence + run timeline
(function () {
  const STALL_MS = 30000;
  const IDLE_AFTER_DONE_MS = 12000;
  const MAX_EVENTS = 80;
  const SHOW_PANEL = false;
  const states = new Map();

  function now() { return Date.now(); }
  function shortSession(sessionKey = '') {
    const m = sessionKey.match(/^agent:([^:]+):/i);
    if (m) return m[1];
    return sessionKey || 'main';
  }
  function norm(key) { return (key || '').toLowerCase(); }

  function getState(sessionKey) {
    const key = norm(sessionKey);
    if (!states.has(key)) {
      states.set(key, {
        sessionKey: key,
        state: 'idle',
        prevState: 'idle',
        lastEventAt: 0,
        runId: null,
        activeTools: new Map(),
        events: [],
        updatedAt: now(),
      });
    }
    return states.get(key);
  }

  function pushEvent(s, type, text, ts) {
    s.events.unshift({ ts: ts || now(), type, text });
    if (s.events.length > MAX_EVENTS) s.events.length = MAX_EVENTS;
  }

  function setState(s, next, reason, ts) {
    if (!next) return;
    const prev = s.state;
    s.prevState = prev;
    s.state = next;
    s.updatedAt = ts || now();
    if (prev !== next) {
      pushEvent(s, 'transition', `${prev} → ${next}${reason ? ` (${reason})` : ''}`, ts);
      if ((next === 'stalled' || next === 'error') && typeof showToast === 'function') {
        showToast(`${shortSession(s.sessionKey)}: ${next}${reason ? ` — ${reason}` : ''}`, next === 'error' ? 'error' : 'warning');
      }
    }
  }

  function ingestChat(evt) {
    const sessionKey = evt?.sessionKey;
    if (!sessionKey) return;
    const s = getState(sessionKey);
    const ts = evt.timestamp || now();
    s.lastEventAt = ts;
    if (evt.runId) s.runId = evt.runId;

    const st = evt.state;
    if (st === 'start' || st === 'thinking' || st === 'delta') {
      if (s.activeTools.size > 0) setState(s, 'waiting_tool', st, ts);
      else setState(s, 'running', st, ts);
    } else if (st === 'final') {
      const text = (evt.content || '').trim();
      if (evt.role === 'assistant' && /\?\s*$/.test(text)) setState(s, 'waiting_user', 'assistant question', ts);
      else setState(s, 'done', 'final', ts);
      pushEvent(s, 'chat', text ? `final: ${text.slice(0, 120)}` : 'final');
    } else if (st === 'error') {
      setState(s, 'error', evt.errorMessage || 'chat error', ts);
    }
    render();
  }

  function ingestTool(evt) {
    const sessionKey = evt?.sessionKey;
    if (!sessionKey) return;
    const s = getState(sessionKey);
    const ts = evt.timestamp || now();
    s.lastEventAt = ts;
    const key = `${evt.name || 'tool'}:${evt.callId || ts}`;
    if (evt.phase === 'start') {
      s.activeTools.set(key, { name: evt.name || 'tool', ts });
      setState(s, 'waiting_tool', evt.name || 'tool', ts);
      pushEvent(s, 'tool', `🔧 start ${evt.name || 'tool'}`, ts);
    } else if (evt.phase === 'complete' || evt.phase === 'end' || evt.phase === 'done') {
      for (const [k, t] of s.activeTools) {
        if (!evt.name || t.name === evt.name) { s.activeTools.delete(k); break; }
      }
      if (s.activeTools.size > 0) setState(s, 'waiting_tool', 'more tools', ts);
      else setState(s, 'running', 'tool complete', ts);
      pushEvent(s, 'tool', `✅ ${evt.name || 'tool'} complete`, ts);
    } else if (evt.phase === 'error') {
      setState(s, 'error', `${evt.name || 'tool'} failed`, ts);
      pushEvent(s, 'tool', `❌ ${evt.name || 'tool'} error`, ts);
    }
    render();
  }

  function runTicker() {
    const t = now();
    let changed = false;
    for (const s of states.values()) {
      if ((s.state === 'running' || s.state === 'waiting_tool') && s.lastEventAt && (t - s.lastEventAt) >= STALL_MS) {
        setState(s, 'stalled', `${Math.floor((t - s.lastEventAt) / 1000)}s no events`, t);
        changed = true;
      }
      if ((s.state === 'done' || s.state === 'waiting_user') && s.lastEventAt && (t - s.lastEventAt) >= IDLE_AFTER_DONE_MS) {
        setState(s, 'idle', 'cooldown', t);
        changed = true;
      }
    }
    if (changed) render();
  }

  function ensurePanel() {
    if (!SHOW_PANEL) {
      const old = document.getElementById('agent-presence-panel');
      if (old) old.remove();
      return null;
    }
    const root = document.querySelector('#page-chat .chat-page-wrapper');
    if (!root) return null;
    let panel = document.getElementById('agent-presence-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'agent-presence-panel';
      panel.style.cssText = 'margin:8px 12px;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;background:var(--surface-elevated);font-size:12px;';
      const header = root.querySelector('.chat-page-header');
      if (header && header.nextSibling) root.insertBefore(panel, header.nextSibling);
      else root.prepend(panel);
    }
    return panel;
  }

  function stateColor(st) {
    if (st === 'running') return '#3b82f6';
    if (st === 'waiting_tool') return '#a855f7';
    if (st === 'waiting_user') return '#f59e0b';
    if (st === 'stalled') return '#f97316';
    if (st === 'error') return '#ef4444';
    if (st === 'done') return '#10b981';
    return '#64748b';
  }

  function render() {
    const panel = ensurePanel();
    if (!panel) return;
    const t = now();
    const all = [...states.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const active = all.filter(s => ['running', 'waiting_tool', 'waiting_user', 'stalled', 'error', 'done'].includes(s.state));
    const chips = active.slice(0, 12).map(s => {
      const age = s.lastEventAt ? `${Math.max(0, Math.floor((t - s.lastEventAt) / 1000))}s` : '—';
      return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;border:1px solid var(--border-color);margin:2px;"><span style="width:8px;height:8px;border-radius:50%;background:${stateColor(s.state)}"></span><strong>${shortSession(s.sessionKey)}</strong><span>${s.state}</span><span style="opacity:.6">${age}</span></span>`;
    }).join('');

    const current = getState(window.currentSessionName || 'main');
    const timeline = (current?.events || []).slice(0, 8).map(e => `<div style="opacity:.9">${new Date(e.ts).toLocaleTimeString()} · ${e.text}</div>`).join('');

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <div><strong>Mission Control</strong> <span style="opacity:.7">(live agent states)</span></div>
        <div style="opacity:.7">stall threshold: ${Math.floor(STALL_MS / 1000)}s</div>
      </div>
      <div style="margin-top:6px;">${chips || '<span style="opacity:.7">No active agents</span>'}</div>
      <div style="margin-top:8px;border-top:1px dashed var(--border-color);padding-top:6px;">
        <div style="font-weight:600;margin-bottom:4px;">Current session timeline</div>
        ${timeline || '<div style="opacity:.7">No recent events</div>'}
      </div>`;
  }

  window.AgentPresence = {
    ingestEvent(evt) {
      if (!evt) return;
      if (evt.kind === 'chat') ingestChat(evt);
      if (evt.kind === 'tool') ingestTool(evt);
    },
    render,
    getStates() { return [...states.values()]; },
    getSessionState(sessionKey) { return getState(sessionKey || window.currentSessionName || 'main'); },
    getSessionLabel(sessionKey) {
      const s = getState(sessionKey || window.currentSessionName || 'main');
      if (!s) return 'Thinking...';
      const labels = {
        running: 'Working…',
        waiting_tool: 'Using tools…',
        waiting_user: 'Waiting for your input…',
        stalled: 'No activity (possible stall)…',
        error: 'Error encountered…',
        done: 'Finishing up…',
        idle: 'Thinking...'
      };
      return labels[s.state] || 'Thinking...';
    }
  };

  let tickerInterval = setInterval(runTicker, 1000);
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 300));

  // Cleanup function for SPA navigation
  window._agentPresenceCleanup = () => clearInterval(tickerInterval);
})();
