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
const recoverySourceSessionByAgent = {};

function getRecoveryAgentId() {
    return (window._memoryCards && typeof window._memoryCards.getCurrentAgentId === 'function' && window._memoryCards.getCurrentAgentId())
        || window._deepLinkAgentId
        || window.currentAgentId
        || null;
}

function getLockedSourceSession(agentId) {
    const key = String(agentId || '').toLowerCase();
    return recoverySourceSessionByAgent[key] || null;
}

function setLockedSourceSession(agentId, sessionKey) {
    const key = String(agentId || '').toLowerCase();
    if (!key) return;
    if (!sessionKey) delete recoverySourceSessionByAgent[key];
    else recoverySourceSessionByAgent[key] = sessionKey;
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
    const attempts = [];
    for (const method of candidates) {
        try {
            const out = await gateway._request(method, payload);
            attempts.push({ method, ok: true });
            console.log('[AgentRecovery] RPC success:', { method, payloadKeys: Object.keys(payload || {}) });
            return { ok: true, method, out, attempts };
        } catch (e) {
            lastError = e;
            const errMsg = String(e?.message || e || 'unknown error');
            attempts.push({ method, ok: false, error: errMsg });
            console.warn('[AgentRecovery] RPC failed:', { method, error: errMsg });
        }
    }
    return { ok: false, error: lastError, attempts };
}

async function getAgentSessionSnapshot(agentId) {
    const list = await safeGatewayRequest(['sessions_list', 'sessions.list'], { includeGlobal: true });
    if (!list.ok) return { error: list.error, attempts: list.attempts || [] };
    const sessions = list.out?.sessions || [];
    const prefix = `agent:${agentId}:`;
    const matches = sessions.filter(s => (s.key || '').startsWith(prefix));
    if (!matches.length) return { sessions: [], latest: null, main: null, target: null };

    const sorted = [...matches].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const latest = sorted[0];
    const main = sorted.find(s => (s.key || '') === `agent:${agentId}:main`) || null;
    const target = main || latest;

    return { sessions: sorted, latest, main, target };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractHistoryMessages(historyOut) {
    return historyOut?.messages || historyOut?.history || [];
}

function isAssistantMessage(msg) {
    const role = String(msg?.role || msg?.from || '').toLowerCase();
    return role === 'assistant' || role === 'solobot' || role === 'agent';
}

function messageTs(msg) {
    const raw = msg?.time ?? msg?.timestamp ?? msg?.createdAt ?? msg?.updatedAt ?? null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
        const n = Date.parse(raw);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function findAssistantResponseInState(sessionKey, startedAtMs) {
    const key = String(sessionKey || '').toLowerCase();
    const msgs = (window.state?.chat?.messages || []);
    return msgs.find(m => {
        const mKey = String(m?._sessionKey || '').toLowerCase();
        if (!mKey || mKey !== key) return false;
        if (!isAssistantMessage(m)) return false;
        return messageTs(m) >= startedAtMs;
    }) || null;
}

function collectContextSourceSessions(agentId, targetMainKey) {
    const all = (window.state?.chat?.messages || [])
        .filter(m => String(m?.text || '').trim().length > 0)
        .filter(m => String(m?._sessionKey || '').toLowerCase().startsWith(`agent:${String(agentId).toLowerCase()}:`));

    const grouped = new Map();
    for (const m of all) {
        const key = String(m._sessionKey || '').toLowerCase();
        const item = grouped.get(key) || { key, lastTs: 0, count: 0 };
        item.count += 1;
        item.lastTs = Math.max(item.lastTs, messageTs(m));
        grouped.set(key, item);
    }

    const target = String(targetMainKey || '').toLowerCase();
    return Array.from(grouped.values())
        .filter(s => s.key && s.key !== target)
        .sort((a, b) => (b.lastTs - a.lastTs) || (b.count - a.count));
}

function pickBestContextSourceSession(agentId, targetMainKey) {
    return collectContextSourceSessions(agentId, targetMainKey)[0]?.key || null;
}

function buildReplayContextLines(sourceSessionKey, maxLines = 10) {
    const source = String(sourceSessionKey || '').toLowerCase();
    const rows = (window.state?.chat?.messages || [])
        .filter(m => String(m?._sessionKey || '').toLowerCase() === source)
        .filter(m => String(m?.text || '').trim().length > 0)
        .sort((a, b) => messageTs(a) - messageTs(b))
        .slice(-maxLines)
        .map(m => `${String(m.from || 'unknown').toUpperCase()}: ${String(m.text || '').trim()}`);
    return rows;
}

async function waitForAssistantResponse(sessionKey, startedAtMs, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const found = findAssistantResponseInState(sessionKey, startedAtMs);
        if (found) return { status: 'responded', message: found };
        await sleep(1200);
    }
    return { status: 'timed_out' };
}

window._agentRecovery = {
    setSource(sessionKey) {
        const agentId = getRecoveryAgentId();
        if (!agentId) return;
        setLockedSourceSession(agentId, sessionKey || null);
        const label = sessionKey ? `Locked source: ${sessionKey}` : 'Source lock cleared. Using best source automatically.';
        setRecoveryStatus(label, 'success');
    },

    async refreshSources() {
        const agentId = getRecoveryAgentId();
        const sel = document.getElementById('agent-recovery-source-session');
        if (!agentId || !sel) return;

        const targetKey = `agent:${agentId}:main`;
        const options = collectContextSourceSessions(agentId, targetKey);
        const locked = getLockedSourceSession(agentId);

        sel.innerHTML = '';
        const autoOpt = document.createElement('option');
        autoOpt.value = '';
        autoOpt.textContent = 'Auto (best stalled session)';
        sel.appendChild(autoOpt);

        options.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.key;
            const mins = o.lastTs ? Math.round((Date.now() - o.lastTs) / 60000) : null;
            opt.textContent = `${o.key}${mins !== null ? ` · ${mins}m ago` : ''} · ${o.count} msgs`;
            sel.appendChild(opt);
        });

        if (locked && options.some(o => o.key === locked)) sel.value = locked;
        else sel.value = '';
    },

    async check() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        await this.refreshSources();
        setRecoveryStatus(`Checking sessions for ${agentId}...`);
        const info = await getAgentSessionSnapshot(agentId);
        if (info.error) {
            const tried = (info.attempts || []).map(a => `${a.method}${a.ok ? ':ok' : ':err'}`).join(', ');
            return setRecoveryStatus(`Check failed: ${info.error?.message || 'unknown error'}${tried ? ` · tried ${tried}` : ''}`, 'error');
        }
        if (!info.sessions?.length) return setRecoveryStatus(`No sessions found for ${agentId}.`, 'error');

        const latest = info.latest;
        const target = info.target;
        const targetType = info.main ? 'main' : 'latest';
        const mins = target?.updatedAt ? Math.round((Date.now() - new Date(target.updatedAt).getTime()) / 60000) : null;
        const cronCount = info.sessions.filter(s => String(s.key || '').includes(':cron:')).length;
        setRecoveryStatus(`Healthy check: sessions=${info.sessions.length} (cron=${cronCount}) · target(${targetType})=${target?.key || 'none'}${mins !== null ? ` · ${mins}m ago` : ''}.`, 'success');
    },

    async ping() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        const info = await getAgentSessionSnapshot(agentId);
        if (info.error || !info.target) return setRecoveryStatus(`No target session available for ${agentId}.`, 'error');
        const sessionKey = info.target.key || `agent:${agentId}:main`;
        setRecoveryStatus(`Sending async ping to ${sessionKey}...`);

        const payload = {
            sessionKey,
            message: 'Quick health ping from dashboard. Reply with ACK if healthy.',
            idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `recovery-${Date.now()}`
        };
        const res = await safeGatewayRequest(['chat.send', 'chat_send'], payload);
        if (!res.ok) {
            const msg = String(res.error?.message || 'unknown error');
            if (/timeout/i.test(msg)) return setRecoveryStatus(`Ping timed out on ${sessionKey}. Session may be stuck or queueing.`, 'error');
            const tried = (res.attempts || []).map(a => `${a.method}${a.ok ? ':ok' : ':err'}`).join(', ');
            return setRecoveryStatus(`Ping failed: ${msg}${tried ? ` · tried ${tried}` : ''}`, 'error');
        }

        setRecoveryStatus(`Ping sent to ${sessionKey} via ${res.method}.`, 'success');
    },

    async probe() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        const info = await getAgentSessionSnapshot(agentId);
        if (info.error || !info.target) return setRecoveryStatus(`No target session available for ${agentId}.`, 'error');
        const sessionKey = info.target.key;

        const probeStartedAt = Date.now();
        setRecoveryStatus(`Running blocking probe on ${sessionKey} (up to ~20s)...`);
        const res = await safeGatewayRequest(['chat.send', 'chat_send'], {
            sessionKey,
            message: 'Health probe: reply with EXACT text "ACK" only.',
            idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `probe-${Date.now()}`
        });

        if (!res.ok) {
            const msg = String(res.error?.message || 'unknown error');
            if (/timeout/i.test(msg)) return setRecoveryStatus(`Probe timeout: ${sessionKey} did not answer within the wait window.`, 'error');
            const tried = (res.attempts || []).map(a => `${a.method}${a.ok ? ':ok' : ':err'}`).join(', ');
            return setRecoveryStatus(`Probe failed: ${msg}${tried ? ` · tried ${tried}` : ''}`, 'error');
        }
        const status = res.out?.status || res.out?.result?.status || 'ok';
        setRecoveryStatus(`Probe started via ${res.method}: ${status}. Waiting for assistant response...`);

        const waited = await waitForAssistantResponse(sessionKey, probeStartedAt, 22000);
        if (waited.status === 'responded') {
            const preview = String(waited.message?.content || waited.message?.text || '').trim().slice(0, 80);
            return setRecoveryStatus(`Probe responded: assistant replied on ${sessionKey}${preview ? ` · "${preview}${preview.length >= 80 ? '…' : ''}"` : ''}.`, 'success');
        }
        if (waited.status === 'timed_out_history_unavailable') {
            return setRecoveryStatus(`Probe started, but response verification timed out because history is unavailable for ${sessionKey}.`, 'error');
        }
        return setRecoveryStatus(`Probe started, but no assistant response detected within wait window on ${sessionKey}.`, 'error');
    },

    async diagnose() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        const info = await getAgentSessionSnapshot(agentId);
        if (info.error) {
            const tried = (info.attempts || []).map(a => `${a.method}${a.ok ? ':ok' : ':err'}`).join(', ');
            return setRecoveryStatus(`Diag failed: sessions.list error: ${info.error?.message || 'unknown'}${tried ? ` · tried ${tried}` : ''}`, 'error');
        }
        if (!info.target) return setRecoveryStatus(`Diag: no sessions for ${agentId}.`, 'error');

        const targetKey = info.target.key;
        const targetType = info.main ? 'main' : 'latest';
        const targetMins = info.target.updatedAt ? Math.round((Date.now() - new Date(info.target.updatedAt).getTime()) / 60000) : null;
        const cronSessions = info.sessions.filter(s => String(s.key || '').includes(':cron:'));

        const localCount = (window.state?.chat?.messages || []).filter(m => String(m?._sessionKey || '').toLowerCase() === String(targetKey).toLowerCase()).length;
        const recentAssistant = findAssistantResponseInState(targetKey, Date.now() - (15 * 60 * 1000));

        setRecoveryStatus(`Diag: connected=yes · sessions=${info.sessions.length} (cron=${cronSessions.length}) · target(${targetType})=${targetKey}${targetMins !== null ? ` (${targetMins}m)` : ''} · localMsgs=${localCount} · recentAssistant=${recentAssistant ? 'yes' : 'no'} · main=${info.main ? 'present' : 'missing'}.`, 'success');
    },

    async rebindMain() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        const mainKey = `agent:${agentId}:main`;
        try {
            if (typeof switchToSession === 'function') {
                await switchToSession(mainKey);
                setRecoveryStatus(`Rebound to main session: ${mainKey}.`, 'success');
            } else {
                setRecoveryStatus(`Main session key: ${mainKey} (manual switch needed).`, 'success');
            }
        } catch (e) {
            setRecoveryStatus(`Rebind failed: ${e?.message || e}`, 'error');
        }
    },

    async replayContext() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        const info = await getAgentSessionSnapshot(agentId);
        if (info.error || !info.latest) return setRecoveryStatus(`No source session available for ${agentId}.`, 'error');

        const targetKey = `agent:${agentId}:main`;
        const lockedSource = getLockedSourceSession(agentId);
        const sourceKey = lockedSource || pickBestContextSourceSession(agentId, targetKey) || info.latest.key;
        let history = buildReplayContextLines(sourceKey, 12);
        if (!history.length && String(sourceKey).toLowerCase() !== String(targetKey).toLowerCase()) {
            history = buildReplayContextLines(targetKey, 12);
        }

        if (!history.length) return setRecoveryStatus(`No local context found to replay for ${agentId}.`, 'error');

        const packet = [
            `Context recovery packet for ${agentId}.`,
            `Source session: ${sourceKey}`,
            `Target session: ${targetKey}`,
            'Please continue exactly where this conversation left off. First: summarize last state in 1-2 bullets. Then continue execution.',
            'Recent context:',
            ...history
        ].join('\n');

        const res = await safeGatewayRequest(['chat.send', 'chat_send'], {
            sessionKey: targetKey,
            message: packet,
            idempotencyKey: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `replay-${Date.now()}`
        });

        if (!res.ok) {
            const msg = String(res.error?.message || 'unknown error');
            const tried = (res.attempts || []).map(a => `${a.method}${a.ok ? ':ok' : ':err'}`).join(', ');
            return setRecoveryStatus(`Replay failed: ${msg}${tried ? ` · tried ${tried}` : ''}`, 'error');
        }

        setRecoveryStatus(`Context replay sent to ${targetKey} from ${sourceKey}.`, 'success');
    },

    async fullRecover() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
        if (!gateway || !gateway.isConnected()) return setRecoveryStatus('Gateway not connected.', 'error');

        try {
            await this.refreshSources();
            setRecoveryStatus(`Full recover started for ${agentId}: refresh + rebind + replay + probe...`);
            if (typeof fetchSessions === 'function') await fetchSessions();
            await this.rebindMain();
            await sleep(300);
            await this.replayContext();
            await sleep(400);
            await this.probe();
        } catch (e) {
            setRecoveryStatus(`Full recover failed: ${e?.message || e}`, 'error');
        }
    },

    openChat() {
        const agentId = getRecoveryAgentId();
        if (!agentId) return setRecoveryStatus('No agent selected. Open an individual agent dashboard page first.', 'error');
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
