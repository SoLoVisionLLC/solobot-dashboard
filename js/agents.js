// js/agents.js — Agent Status Panel widget

let agentStatusInterval = null;

function initAgentStatusPanel() {
    loadAgentStatuses();
    if (agentStatusInterval) clearInterval(agentStatusInterval);
    agentStatusInterval = setInterval(loadAgentStatuses, 15000);
}

async function loadAgentStatuses() {
    const container = document.getElementById('agent-status-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
                <div class="empty-state-title">No Agent Data</div>
                <div class="empty-state-desc">Connect to gateway to see agent status</div>
            </div>
        `;
        return;
    }

    try {
        const result = await gateway._request('sessions.list', { includeGlobal: true });
        const sessions = result?.sessions || [];
        renderAgentStatuses(sessions);
    } catch (e) {
        console.warn('[Agents] Failed to fetch sessions:', e.message);
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center;">Failed to load</div>';
    }
}

function renderAgentStatuses(sessions) {
    const container = document.getElementById('agent-status-list');
    if (!container) return;

    // Group sessions by agent
    const agents = {};
    const knownAgents = ['main', 'elon', 'atlas', 'sterling', 'vector', 'dev', 'haven', 'ledger', 'knox', 'nova'];

    for (const s of sessions) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? (window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1]) : 'main';
        if (!agents[agentId]) {
            agents[agentId] = { sessions: [], lastActivity: 0, lastPreview: '' };
        }
        agents[agentId].sessions.push(s);
        const ts = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
        if (ts > agents[agentId].lastActivity) {
            agents[agentId].lastActivity = ts;
            agents[agentId].lastPreview = s.displayName || s.key || '';
        }
    }

    // Ensure all known agents appear
    for (const id of knownAgents) {
        if (!agents[id]) agents[id] = { sessions: [], lastActivity: 0, lastPreview: '' };
    }

    // Sort by most recent activity
    const sorted = Object.entries(agents).sort((a, b) => b[1].lastActivity - a[1].lastActivity);

    container.innerHTML = sorted.map(([id, data]) => {
        const persona = (typeof AGENT_PERSONAS !== 'undefined') && AGENT_PERSONAS[id];
        const label = persona ? `${persona.name} (${persona.role})` : id.toUpperCase();
        const sessionCount = data.sessions.length;
        const timeSince = data.lastActivity ? timeAgo(data.lastActivity) : 'No activity';
        const isActive = data.lastActivity && (Date.now() - data.lastActivity < 300000); // 5min
        const isRecent = data.lastActivity && (Date.now() - data.lastActivity < 3600000); // 1hr
        const statusClass = isActive ? 'success' : isRecent ? 'warning' : 'idle';
        const statusText = isActive ? 'Active' : isRecent ? 'Recent' : 'Idle';
        const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${id}`).trim() || '#888';

        return `
        <div class="agent-status-row" onclick="switchToAgent('${id}')" style="cursor: pointer;">
            <span class="status-dot ${statusClass}"></span>
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-weight: 600; font-size: 13px; color: ${color};">${label}</span>
                    <span style="font-size: 10px; color: var(--text-muted);">${sessionCount} session${sessionCount !== 1 ? 's' : ''}</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${timeSince}${data.lastPreview ? ' · ' + escapeHtml(data.lastPreview) : ''}
                </div>
            </div>
            <span style="font-size: 10px; padding: 2px 6px; border-radius: 8px; background: var(--surface-2); color: var(--text-muted);">${statusText}</span>
        </div>`;
    }).join('');
}

function timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

let _switchingAgent = false;
function switchToAgent(agentId) {
    if (_switchingAgent) return; // Debounce
    _switchingAgent = true;
    setTimeout(() => _switchingAgent = false, 500);

    // Navigate to chat page immediately
    if (typeof showPage === 'function') showPage('chat');
    if (typeof setActiveSidebarAgent === 'function') setActiveSidebarAgent(agentId);
    currentAgentId = agentId;

    // Determine target session: last used for this agent, or agent:ID:main
    const lastSession = typeof getLastAgentSession === 'function' ? getLastAgentSession(agentId) : null;
    const targetSession = lastSession || `agent:${agentId}:main`;

    // If already on this session, just refresh the dropdown
    if (targetSession === (currentSessionName || GATEWAY_CONFIG?.sessionKey)) {
        if (typeof populateSessionDropdown === 'function') populateSessionDropdown();
        return;
    }

    // Switch to the session directly (fast path — no fetchSessions needed)
    if (typeof switchToSession === 'function') {
        switchToSession(targetSession);
    }

    // Fetch sessions in background to update the dropdown
    if (typeof fetchSessions === 'function') {
        setTimeout(() => fetchSessions(), 100);
    }
}

// Auto-init when gateway connects
function getRecoveryAgentId() {
    return (window._memoryCards && typeof window._memoryCards.getCurrentAgentId === 'function' && window._memoryCards.getCurrentAgentId())
        || window._deepLinkAgentId
        || window.currentAgentId
        || null;
}

function setRecoveryStatus(text, kind = 'muted') {
    const el = document.getElementById('agent-recovery-status');
    if (!el) return;
    const color = kind === 'error' ? 'var(--error)' : (kind === 'success' ? 'var(--success)' : 'var(--text-muted)');
    el.style.color = color;
    el.textContent = text;
}

async function safeGatewayRequest(candidates, payload) {
    let lastError = null;
    for (const method of candidates) {
        try {
            const out = await gateway._request(method, payload);
            return { ok: true, method, out };
        } catch (e) {
            lastError = e;
        }
    }
    return { ok: false, error: lastError };
}

window._agentRecovery = {
    async check() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent memory page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        setRecoveryStatus(`Checking sessions for ${agentId}...`);
        const res = await safeGatewayRequest(['sessions.list'], { includeGlobal: true });
        if (!res.ok) return setRecoveryStatus(`Check failed: ${res.error?.message || 'unknown error'}`, 'error');

        const sessions = res.out?.sessions || [];
        const prefix = `agent:${agentId}:`;
        const matches = sessions.filter(s => (s.key || '').startsWith(prefix));
        if (!matches.length) return setRecoveryStatus(`No sessions found for ${agentId}.`, 'error');

        const latest = matches.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
        const mins = latest.updatedAt ? Math.round((Date.now() - new Date(latest.updatedAt).getTime()) / 60000) : null;
        setRecoveryStatus(`Healthy check: ${matches.length} session(s). Latest: ${latest.key}${mins !== null ? ` · ${mins}m ago` : ''}.`, 'success');
    },

    async ping() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent memory page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        const sessionKey = `agent:${agentId}:main`;
        setRecoveryStatus(`Sending async ping to ${sessionKey}...`);

        const payload = {
            sessionKey,
            message: 'Quick health ping from dashboard. Reply with ACK if healthy.',
            timeoutSeconds: 0
        };
        const res = await safeGatewayRequest(['sessions.send', 'session.send'], payload);
        if (!res.ok) return setRecoveryStatus(`Ping failed: ${res.error?.message || 'unknown error'}`, 'error');

        setRecoveryStatus(`Ping sent to ${sessionKey} via ${res.method}.`, 'success');
    },

    openChat() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent memory page first.', 'error');
        try {
            if (typeof switchToAgent === 'function') switchToAgent(agentId);
            if (typeof showPage === 'function') showPage('chat');
            setRecoveryStatus(`Opened chat for ${agentId}.`, 'success');
        } catch (e) {
            setRecoveryStatus(`Open chat failed: ${e.message || e}`, 'error');
        }
    },

    async refresh() {
        try {
            if (typeof fetchSessions === 'function') await fetchSessions();
            setRecoveryStatus('Sessions refreshed.', 'success');
        } catch (e) {
            setRecoveryStatus(`Refresh failed: ${e.message || e}`, 'error');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAgentStatusPanel, 2000);
});
