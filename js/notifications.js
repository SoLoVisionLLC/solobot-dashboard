// js/notifications.js — Cross-session notifications, unread badges, toasts

// ===================
// CROSS-SESSION NOTIFICATIONS
// ===================
const READ_ACK_PREFIX = '[[read_ack]]';
const unreadSessions = new Map(); // sessionKey → count
const NOTIFICATION_DEBUG = false;
function notifLog(...args) { if (NOTIFICATION_DEBUG) console.log(...args); }
const NOTIFICATIONS_RUNTIME_MARK = '2026-02-22.3';
if (window.__notificationsRuntimeMark !== NOTIFICATIONS_RUNTIME_MARK) {
    window.__notificationsRuntimeMark = NOTIFICATIONS_RUNTIME_MARK;
    console.log(`[Notifications] notifications.js loaded (${NOTIFICATIONS_RUNTIME_MARK})`);
}
const FINAL_DEDUPE_WINDOW_MS = 15000;
const recentFinalFingerprints = new Map(); // fingerprint -> timestamp
let _streamingRunId = null;

function normalizeMessageText(text) {
    return String(text || '').replace(/\r\n/g, '\n');
}

function extractHistoryTextFromPart(part) {
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.input_text === 'string') return part.input_text;
    if (typeof part.output_text === 'string') return part.output_text;
    if (typeof part.content === 'string' && part.type !== 'image') return part.content;
    return '';
}

function extractHistoryText(container) {
    if (!container) return '';
    let text = '';

    if (Array.isArray(container.content)) {
        for (const part of container.content) {
            text += extractHistoryTextFromPart(part);
        }
    } else if (typeof container.content === 'string') {
        text += container.content;
    }

    // Some providers return output blocks with nested content parts.
    if (Array.isArray(container.output)) {
        for (const block of container.output) {
            if (!block || typeof block !== 'object') continue;
            if (typeof block.text === 'string') text += block.text;
            if (typeof block.output_text === 'string') text += block.output_text;
            if (Array.isArray(block.content)) {
                for (const part of block.content) {
                    text += extractHistoryTextFromPart(part);
                }
            }
        }
    }

    if (!text && typeof container.output_text === 'string') text = container.output_text;
    if (!text && typeof container.text === 'string') text = container.text;
    return (text || '').trim();
}

function mergeStreamingDelta(previousText, incomingText) {
    const prev = normalizeMessageText(previousText);
    const next = normalizeMessageText(incomingText);
    if (!next) return prev;
    if (!prev) return next;

    // Cumulative snapshot (ideal path): replace with latest full snapshot
    if (next.startsWith(prev)) return next;
    // Out-of-order shorter snapshot: keep longer one
    if (prev.startsWith(next)) return prev;
    // Duplicate chunk already present
    if (prev.includes(next)) return prev;

    // Token/chunk streaming fallback: append chunk
    return prev + next;
}

function pruneRecentFinalFingerprints(now = Date.now()) {
    for (const [key, ts] of recentFinalFingerprints.entries()) {
        if (now - ts > FINAL_DEDUPE_WINDOW_MS) {
            recentFinalFingerprints.delete(key);
        }
    }
}

function buildFinalFingerprint({ runId, sessionKey, text, images }) {
    const session = String(sessionKey || '').toLowerCase();
    if (runId) return `run:${session}:${runId}`;

    const normalizedText = String(text || '').trim();
    const imageCount = Array.isArray(images) ? images.length : 0;
    const firstImageSig = imageCount > 0 && typeof images[0] === 'string'
        ? images[0].slice(0, 32)
        : '';
    return `text:${session}:${normalizedText}:${imageCount}:${firstImageSig}`;
}

function hasRecentFinalFingerprint(fingerprint) {
    const now = Date.now();
    pruneRecentFinalFingerprints(now);
    return recentFinalFingerprints.has(fingerprint);
}

function rememberFinalFingerprint(fingerprint) {
    pruneRecentFinalFingerprints();
    recentFinalFingerprints.set(fingerprint, Date.now());
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
            console.log(`[Notifications] Permission: ${perm}`);
        });
    }
}

function subscribeToAllSessions() {
    if (!gateway || !gateway.isConnected()) return;
    // Only subscribe to recent/active sessions, not all 200+
    // Sort by updatedAt descending and take top 20
    const sorted = [...availableSessions]
        .filter(s => s.key && s.updatedAt)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 20);
    const keys = sorted.map(s => s.key);
    if (keys.length > 0) {
        gateway.subscribeToAllSessions(keys);
        console.log(`[Notifications] Subscribed to ${keys.length} recent sessions (of ${availableSessions.length} total)`);
    }
}

function handleCrossSessionNotification(msg) {
    const { sessionKey, content, images } = msg;
    notifLog(`[Notifications] 📥 Cross-session notification received: session=${sessionKey}, content=${(content || '').slice(0, 80)}..., images=${images?.length || 0}`);

    // Never count read-ack sync events as notifications.
    // These are internal signals used to clear unreads across clients.
    if (typeof content === 'string' && content.startsWith(READ_ACK_PREFIX)) {
        notifLog(`[Notifications] Ignoring read-ack cross-session event for ${sessionKey}`);
        // Best-effort: clear unread for that session (handles race where unread was set elsewhere)
        if (sessionKey) clearUnreadForSession(sessionKey);
        return;
    }

    // Never count "silent reply" placeholders as notifications.
    // These are used by cron/background jobs to indicate "no user-visible output".
    if (typeof content === 'string') {
        const t = content.trim();
        if (t === 'NO_REPLY' || t === 'NO' || t === 'HEARTBEAT_OK' || t === 'ANNOUNCE_SKIP' || t === 'REPLY_SKIP') {
            notifLog(`[Notifications] Ignoring silent placeholder notification for ${sessionKey}: ${t}`);
            return;
        }
        // Gateway-injected read-sync / read_ack signals
        if (t === '[read-sync]' || t.startsWith('[[read_ack]]') || /^\[read-sync\]\s*\n*\s*\[\[read_ack\]\]$/s.test(t)) {
            notifLog(`[Notifications] Ignoring read-sync notification for ${sessionKey}`);
            if (sessionKey) clearUnreadForSession(sessionKey);
            return;
        }
    }

    // If the message is for the currently active session and the tab is visible,
    // don't increment unread (user can already see it or will on next render).
    if (sessionKey && typeof currentSessionName !== 'undefined' && sessionKey === currentSessionName) {
        if (document.visibilityState === 'visible') {
            notifLog(`[Notifications] Ignoring notification for active session ${sessionKey}`);
            return;
        }
    }

    const friendlyName = getFriendlySessionName(sessionKey);
    const preview = content.length > 120 ? content.slice(0, 120) + '…' : content;

    notifLog(`[Notifications] 🔔 Message from ${friendlyName}: ${preview.slice(0, 60)}`);

    // Track unread count
    unreadSessions.set(sessionKey, (unreadSessions.get(sessionKey) || 0) + 1);
    updateUnreadBadges();
    notifLog(`[Notifications] Unread total: ${Array.from(unreadSessions.values()).reduce((a, b) => a + b, 0)}`);

    // Always show in-app toast (works regardless of browser notification permission)
    showNotificationToast(friendlyName, preview, sessionKey);

    // Browser notification (best-effort — may not be permitted)
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const notification = new Notification(`${friendlyName}`, {
                body: preview,
                icon: '/solobot-avatar.png',
                tag: `session-${sessionKey}`,
                silent: false
            });

            notification.onclick = () => {
                window.focus();
                navigateToSession(sessionKey);
                notification.close();
            };

            setTimeout(() => notification.close(), 8000);
        } catch (e) {
            console.warn('[Notifications] Browser notification failed:', e);
        }
    }

    // Play notification sound
    playNotificationSound();
}

// Navigate to a specific session (used by notification click handlers)
function navigateToSession(sessionKey) {
    if (typeof showPage === 'function') showPage('chat');
    const agentMatch = sessionKey.match(/^agent:([^:]+):/);
    if (agentMatch && typeof setActiveSidebarAgent === 'function') {
        const agentId = window.resolveAgentId ? window.resolveAgentId(agentMatch[1]) : agentMatch[1];
        setActiveSidebarAgent(agentId);
    }
    if (typeof switchToSessionKey === 'function') {
        switchToSessionKey(sessionKey);
    }
    // Clear unread for this session
    unreadSessions.delete(sessionKey);
    updateUnreadBadges();
}

// In-app toast notification — always visible, no browser permission needed
function showNotificationToast(title, body, sessionKey, onClick = null, duration = 12000) {
    // Create toast container if it doesn't exist
    let container = document.getElementById('toast-container') || document.getElementById('notification-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-toast-container';
        container.style.cssText = 'position: fixed; bottom: 96px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; max-width: 360px; pointer-events: none;';
        document.body.appendChild(container);
    }

    // Keep all notification toasts in the same visible corner.
    if (container.id === 'toast-container') {
        container.style.position = 'fixed';
        container.style.bottom = '96px';
        container.style.right = '20px';
        container.style.flexDirection = 'column';
    }

    // Determine agent color from session key
    const agentMatch = sessionKey?.match(/^agent:([^:]+):/);
    // Also update the agent's chat button on the Agents page
    if (agentMatch) {
        const agentId = window.resolveAgentId ? window.resolveAgentId(agentMatch[1]) : agentMatch[1];
        if (typeof updateAgentChatButton === 'function') updateAgentChatButton(agentId);
    }
    const agentId = agentMatch ? (window.resolveAgentId ? window.resolveAgentId(agentMatch[1]) : agentMatch[1]) : 'main';
    const agentColors = { main: '#BC2026', dev: '#6366F1', exec: '#F59E0B', coo: '#10B981', cfo: '#EAB308', cmp: '#EC4899', family: '#14B8A6', tax: '#78716C', sec: '#3B82F6', smm: '#8B5CF6' };
    const color = agentColors[agentId] || '#BC2026';

    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.style.cssText = `
        pointer-events: auto; cursor: pointer;
        background: var(--card-bg, #1a1a2e); color: var(--text-primary, #e0e0e0);
        border: 1px solid color-mix(in srgb, ${color} 60%, transparent);
        border-left: 4px solid ${color}; border-radius: 8px;
        padding: 10px 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.35);
        opacity: 0; transform: translateX(100%);
        transition: all 0.3s ease; max-width: 360px;
        font-family: var(--font-family, system-ui);
        backdrop-filter: blur(6px);
    `;
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0; box-shadow: 0 0 0 2px color-mix(in srgb, ${color} 30%, transparent);"></span>
            <strong style="color: var(--text-primary, #e0e0e0); font-size: 13px;">${title}</strong>
            <span style="margin-left: auto; color: var(--text-muted, #666); font-size: 11px; cursor: pointer;" class="toast-close">✕</span>
        </div>
        <div style="color: var(--text-secondary, #c9c9c9); font-size: 12px; line-height: 1.4; padding-left: 16px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${body?.replace(/</g, '&lt;') || ''}</div>
    `;

    // Click toast → navigate to session (for message notifications) or call custom action (for system/gateway notices)
    toast.addEventListener('click', (e) => {
        if (e.target.classList?.contains('toast-close')) {
            dismissToast(toast);
            return;
        }
        if (typeof onClick === 'function') {
            onClick();
        } else if (sessionKey) {
            navigateToSession(sessionKey);
        }
        dismissToast(toast);
    });

    container.appendChild(toast);
    notifLog(`[Notifications] Toast rendered for ${title} (session=${sessionKey})`);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });

    // Auto-dismiss after specified duration
    const timer = setTimeout(() => dismissToast(toast), duration);
    toast._dismissTimer = timer;

    // Limit to 4 toasts max
    while (container.children.length > 4) {
        dismissToast(container.firstChild);
    }
}

function dismissToast(toast) {
    if (!toast || toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._dismissTimer);
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
}

// Toggle notification panel — click bell to navigate to most-unread session
function toggleNotificationPanel() {
    if (unreadSessions.size === 0) {
        // No unreads — just flash the bell
        const bell = document.getElementById('notification-bell');
        if (bell) {
            bell.style.animation = 'none';
            bell.offsetHeight; // trigger reflow
            bell.style.animation = 'bellPulse 0.3s ease-in-out';
        }
        return;
    }

    // Find session with most unreads
    let maxKey = null, maxCount = 0;
    for (const [key, count] of unreadSessions) {
        if (count > maxCount) { maxCount = count; maxKey = key; }
    }

    if (maxKey) {
        navigateToSession(maxKey);
    }
}

function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* audio not available */ }
}

function updateUnreadBadges() {
    // Build agent -> department map from sidebar DOM (for collapsed group badges)
    const agentDeptMap = new Map();
    document.querySelectorAll('.sidebar-agent[data-agent][data-dept]').forEach(el => {
        const agentId = el.getAttribute('data-agent');
        const dept = el.getAttribute('data-dept');
        if (agentId && dept) agentDeptMap.set(agentId, dept);
    });

    // Update session dropdown badges
    document.querySelectorAll('.session-option, [data-session-key]').forEach(el => {
        const key = el.dataset?.sessionKey || el.getAttribute('data-session-key');
        if (!key) return;

        let badge = el.querySelector('.unread-badge');
        const count = unreadSessions.get(key) || 0;

        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'unread-badge';
                el.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.cssText = 'background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 18px; height: 18px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; margin-left: 6px;';
        } else if (badge) {
            badge.remove();
        }
    });

    // Update sidebar agent dots
    document.querySelectorAll('.sidebar-agent[data-agent]').forEach(el => {
        const agentId = el.getAttribute('data-agent');
        if (!agentId) return;

        // Sum unread across all sessions for this agent
        let agentUnread = 0;
        for (const [key, count] of unreadSessions) {
            if (key.startsWith(`agent:${agentId}:`) || (agentId === 'main' && key === 'main')) {
                agentUnread += count;
            }
        }

        let dot = el.querySelector('.agent-unread-dot');
        if (agentUnread > 0) {
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'agent-unread-dot';
                dot.style.cssText = 'position: absolute; top: 2px; right: 2px; background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 16px; height: 16px; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 3px; pointer-events: none;';
                el.style.position = 'relative';
                el.appendChild(dot);
            }
            dot.textContent = agentUnread > 99 ? '99+' : agentUnread;
        } else if (dot) {
            dot.remove();
        }
    });

    // Update department/group header badges (so collapsed groups still show unread)
    const unreadByDept = new Map();
    for (const [key, count] of unreadSessions) {
        const match = String(key || '').match(/^agent:([^:]+):/);
        const rawAgentId = match ? match[1] : 'main';
        const agentId = (window.resolveAgentId ? window.resolveAgentId(rawAgentId) : rawAgentId) || 'main';
        const dept = agentDeptMap.get(agentId);
        if (!dept) continue;
        unreadByDept.set(dept, (unreadByDept.get(dept) || 0) + (count || 0));
    }

    document.querySelectorAll('.sidebar-agent-group[data-dept]').forEach(groupEl => {
        const dept = groupEl.getAttribute('data-dept');
        const header = groupEl.querySelector('.sidebar-agent-group-header');
        if (!dept || !header) return;

        const groupUnread = unreadByDept.get(dept) || 0;
        let badge = header.querySelector('.group-unread-badge');

        if (groupUnread > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'group-unread-badge';
                badge.style.cssText = 'margin-left: 6px; background: var(--brand-red, #BC2026); color: white; border-radius: 999px; min-width: 18px; height: 18px; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; pointer-events: none;';
                header.appendChild(badge);
            }
            badge.textContent = groupUnread > 99 ? '99+' : groupUnread;
            groupEl.classList.add('has-unread');
        } else {
            if (badge) badge.remove();
            groupEl.classList.remove('has-unread');
        }
    });

    // Update notification bell badge
    const totalUnread = Array.from(unreadSessions.values()).reduce((a, b) => a + b, 0);
    const bellBadge = document.getElementById('notification-bell-badge');
    if (bellBadge) {
        if (totalUnread > 0) {
            bellBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            bellBadge.style.display = 'flex';
        } else {
            bellBadge.style.display = 'none';
        }
    }

    // Update the tab/title with total unread count
    const baseTitle = 'SoLoVision Dashboard';
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
}

async function sendReadAck(sessionKey) {
    try {
        if (gateway && gateway.isConnected()) {
            await gateway.injectChat(sessionKey, READ_ACK_PREFIX, 'read-sync');
        }
    } catch (e) {
        console.warn('[Notifications] Failed to send read ack:', e.message);
    }
}

function clearUnreadForSession(sessionKey) {
    if (unreadSessions.has(sessionKey)) {
        unreadSessions.delete(sessionKey);
        updateUnreadBadges();
        // Notify other clients (Android) to clear this session unread
        sendReadAck(sessionKey);
    }
}

function connectToGateway() {
    const host = document.getElementById('gateway-host')?.value || GATEWAY_CONFIG.host;
    const port = parseInt(document.getElementById('gateway-port')?.value) || GATEWAY_CONFIG.port;
    const token = document.getElementById('gateway-token')?.value || GATEWAY_CONFIG.token;
    const rawSessionKey = document.getElementById('gateway-session')?.value || GATEWAY_CONFIG.sessionKey || 'agent:main:main';
    const sessionKey = (rawSessionKey === 'main') ? 'agent:main:main' : rawSessionKey;

    if (!host) {
        showToast('Please enter a gateway host in Settings', 'warning');
        return;
    }

    // Don't reconnect if already connected to the same host with the right session
    if (gateway && gateway.isConnected() && gateway.sessionKey === sessionKey) {
        console.log('[Dashboard] Already connected with correct session, skipping reconnect');
        return;
    }

    // Save settings to both localStorage AND server state
    GATEWAY_CONFIG.host = host;
    GATEWAY_CONFIG.port = port;
    GATEWAY_CONFIG.token = token;
    GATEWAY_CONFIG.sessionKey = sessionKey;
    saveGatewaySettings(host, port, token, sessionKey);

    updateConnectionUI('connecting', 'Connecting...');

    if (!gateway) {
        initGateway();
    }

    gateway.sessionKey = sessionKey;
    gateway.connect(host, port, token);
}

function disconnectFromGateway() {
    if (gateway) {
        gateway.disconnect();
    }
    updateConnectionUI('disconnected', 'Disconnected');
}

// Restart gateway directly via WebSocket RPC (no bot involved)
window.requestGatewayRestart = async function () {
    if (!gateway || !gateway.isConnected()) {
        showNotificationToast('Gateway', 'Not connected to gateway', null, null, 5000);
        return;
    }

    showNotificationToast('Gateway', 'Restarting gateway...', null, null, 5000);

    try {
        await gateway.restartGateway('manual restart from dashboard');
        showNotificationToast('Gateway', 'Gateway restart initiated. Reconnecting...', null, null, 5000);
    } catch (err) {
        console.error('[Dashboard] Gateway restart failed:', err);
        showNotificationToast('Gateway', 'Restart failed: ' + err.message, null, null, 5000);
    }
};

function updateConnectionUI(status, message) {
    // Update chat header status
    const statusEl = document.getElementById('gateway-status');
    const statusDot = document.getElementById('gateway-status-dot');

    // Update settings modal status
    const settingsStatusEl = document.getElementById('settings-gateway-status');
    const settingsDot = document.getElementById('settings-gateway-dot');
    const connectBtn = document.getElementById('gateway-connect-btn');
    const disconnectBtn = document.getElementById('gateway-disconnect-btn');

    const displayMessage = message || status;

    if (statusEl) statusEl.textContent = displayMessage;
    if (settingsStatusEl) settingsStatusEl.textContent = displayMessage;

    // Get status-dot class based on status
    const getStatusClass = () => {
        switch (status) {
            case 'connected': return 'success';
            case 'connecting': return 'warning pulse';
            case 'error': return 'error';
            default: return 'idle';
        }
    };

    const statusClass = getStatusClass();

    // Update chat header dot
    if (statusDot) {
        statusDot.className = `status-dot ${statusClass}`;
    }

    // Update settings modal dot
    if (settingsDot) {
        settingsDot.className = `status-dot ${statusClass}`;
    }

    // Update buttons
    if (connectBtn && disconnectBtn) {
        if (status === 'connected') {
            connectBtn.classList.add('hidden');
            disconnectBtn.classList.remove('hidden');
        } else {
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
        }
    }

    // Re-render chat to update placeholder message
    renderChat();
    renderChatPage();
}

function handleChatEvent(event) {
    if (window.ModelValidator && typeof window.ModelValidator.handleGatewayEvent === 'function') {
        window.ModelValidator.handleGatewayEvent(event);
    }
    const { state: eventState, content, images, role, errorMessage, model, provider, stopReason, sessionKey, runId } = event;

    // HARD GATE: only render events for the active session. Period.
    // Cross-session notifications are handled separately by onCrossSessionMessage.
    const activeSession = currentSessionName?.toLowerCase();
    const eventSession = sessionKey?.toLowerCase();
    if (eventSession && activeSession && eventSession !== activeSession) {
        return;
    }

    // Ignore read-ack sync events
    if (content && content.startsWith(READ_ACK_PREFIX)) {
        if (sessionKey) clearUnreadForSession(sessionKey);
        return;
    }

    // Intercept health check events
    if (sessionKey && sessionKey.startsWith('health-check-')) {
        const pending = pendingHealthChecks.get(sessionKey);
        if (pending) {
            if (eventState === 'final') {
                pending.resolve({
                    success: true,
                    content: content,
                    model: model,
                    provider: provider
                });
                pendingHealthChecks.delete(sessionKey);
            } else if (eventState === 'error') {
                pending.reject(new Error(errorMessage || 'Gateway error'));
                pendingHealthChecks.delete(sessionKey);
            }
        }
        // Don't show health check events in the main chat UI
        return;
    }

    // Track the current model being used for responses and sync UI
    // BUT: Don't override if user just manually changed (respect openclaw.json settings)
    if (model) {
        window._lastResponseModel = model;
        window._lastResponseProvider = provider;
        // Skip sync if manual change happened recently — openclaw.json is source of truth
        const now = Date.now();
        if (!window._lastManualModelChange || (now - window._lastManualModelChange > 5000)) {
            syncModelDisplay(model, provider);
        } else {
            notifLog(`[Notifications] Skipping model sync from gateway (manual change active)`);
        }
    }

    // Handle user messages from other clients (WebUI, Telegram, etc.)
    if (role === 'user' && eventState === 'final' && content) {
        // HARD GATE: Only accept user messages for the current session
        const activeSession = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
        const eventSession = sessionKey?.toLowerCase();
        if (eventSession && activeSession && eventSession !== activeSession) {
            notifLog(`[Notifications] Ignoring user message for session ${eventSession} (current: ${activeSession})`);
            return;
        }

        // Check if we already have this message (to avoid duplicates from our own sends)
        const isDuplicate = state.chat.messages.some(m =>
            m.from === 'user' && m.text?.trim() === content.trim() && (Date.now() - m.time) < 5000
        );
        if (!isDuplicate) {
            addLocalChatMessage(content, 'user');
        }
        return;
    }

    // Handle assistant messages
    switch (eventState) {
        case 'start':
        case 'thinking':
            // AI has started processing - show typing indicator
            isProcessing = true;
            streamingText = ''; // Clear stale stream from previous runs
            _streamingRunId = runId || null;
            renderChat();
            renderChatPage();
            break;

        case 'delta':
            // Some providers send cumulative snapshots, others send token chunks.
            // Merge robustly so final content doesn't collapse to partial text.
            if (runId && _streamingRunId && runId !== _streamingRunId) {
                streamingText = '';
            }
            if (runId) _streamingRunId = runId;
            streamingText = mergeStreamingDelta(streamingText, content);
            _streamingSessionKey = sessionKey || currentSessionName || '';
            isProcessing = true;
            renderChat();
            renderChatPage();
            break;

        case 'final':
            // Final response from assistant
            const streamedText = normalizeMessageText(streamingText);
            const payloadText = normalizeMessageText(content);

            // Prefer the longer/more complete variant on final.
            let finalContent = '';
            if (payloadText && streamedText) {
                finalContent = payloadText.length >= streamedText.length ? payloadText : streamedText;
            } else {
                finalContent = payloadText || streamedText;
            }

            // Skip gateway-injected internal messages
            if (finalContent && /^\s*\[read-sync\]\s*(\n\s*\[\[read_ack\]\])?\s*$/s.test(finalContent)) {
                streamingText = '';
                _streamingRunId = null;
                isProcessing = false;
                lastProcessingEndTime = Date.now();
                break;
            }

            if ((finalContent || images?.length > 0) && role !== 'user') {
                // Check for duplicate - by runId first, then by trimmed text within 10 seconds
                const trimmed = finalContent.trim();
                const runtimeDuplicate = state.chat.messages.some(m =>
                    (runId && m.runId === runId) ||
                    (trimmed && m.from === 'solobot' && m.text?.trim() === trimmed && (Date.now() - m.time) < 10000)
                );
                const finalFingerprint = buildFinalFingerprint({
                    runId,
                    sessionKey,
                    text: trimmed,
                    images
                });
                const recentDuplicate = hasRecentFinalFingerprint(finalFingerprint);
                if (!runtimeDuplicate && !recentDuplicate) {
                    const msg = addLocalChatMessage(finalContent, 'solobot', images, window._lastResponseModel, window._lastResponseProvider);
                    // Tag with runId for dedup against history merge
                    if (msg && runId) msg.runId = runId;
                    rememberFinalFingerprint(finalFingerprint);
                }
            }
            streamingText = '';
            _streamingRunId = null;
            isProcessing = false;
            lastProcessingEndTime = Date.now();
            // Schedule a history refresh (guarded, won't spam)
            setTimeout(_doHistoryRefresh, 2000);
            renderChat();
            renderChatPage();
            break;

        case 'error':
            addLocalChatMessage(`Error: ${errorMessage || 'Unknown error'}`, 'system');
            streamingText = '';
            isProcessing = false;
            lastProcessingEndTime = Date.now();
            renderChat();
            renderChatPage();
            break;
    }
}

function loadHistoryMessages(messages) {
    // Convert gateway history format and classify as chat vs system
    // Only preserve local messages that belong to the CURRENT session (prevent cross-session bleed)
    const currentKey = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    const allLocalChatMessages = state.chat.messages.filter(m => {
        // Skip non-local messages (have real IDs from server)
        if (!m.id?.startsWith('m')) return false;
        // If the message was tagged with a session, only keep if it matches
        // If NOT tagged, assume it's from current session (conservative - old messages)
        if (m._sessionKey && m._sessionKey.toLowerCase() !== currentKey) return false;
        return true;
    });

    const chatMessages = [];
    const systemMessages = [];

    const extractContent = (container) => {
        if (!container) return { text: '', images: [] };
        let text = '';
        let images = [];

        if (Array.isArray(container.content)) {
            for (const part of container.content) {
                if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
                    text += extractHistoryTextFromPart(part);
                } else if (part.type === 'image') {
                    // Image attachment - reconstruct data URI
                    if (part.content && part.mimeType) {
                        images.push(`data:${part.mimeType};base64,${part.content}`);
                    } else if (part.source?.data) {
                        // Alternative format: source.data with media_type
                        const mimeType = part.source.media_type || 'image/jpeg';
                        images.push(`data:${mimeType};base64,${part.source.data}`);
                    } else if (part.data) {
                        // Direct data field
                        images.push(`data:image/jpeg;base64,${part.data}`);
                    }
                } else if (part.type === 'image_url' && part.image_url?.url) {
                    // OpenAI-style image_url format
                    images.push(part.image_url.url);
                }
            }
        }
        if (!text) text = extractHistoryText(container);

        // Check for attachments array (our send format)
        if (Array.isArray(container.attachments)) {
            for (const att of container.attachments) {
                if (att.type === 'image' && att.content && att.mimeType) {
                    images.push(`data:${att.mimeType};base64,${att.content}`);
                }
            }
        }

        return { text: (text || '').trim(), images };
    };

    messages.forEach(msg => {
        // Skip tool results and tool calls - only show actual text responses
        if (msg.role === 'toolResult' || msg.role === 'tool') {
            return;
        }

        // Skip gateway-injected messages (read-sync, read_ack, etc.)
        if (msg.model === 'gateway-injected' || msg.provider === 'openclaw') {
            return;
        }

        let content = extractContent(msg);
        if (!content.text && !content.images.length && msg.message) {
            content = extractContent(msg.message);
        }

        const message = {
            id: msg.id || 'm' + Date.now() + Math.random(),
            from: msg.role === 'user' ? 'user' : 'solobot',
            text: content.text,
            image: content.images[0] || null, // First image as thumbnail
            images: content.images, // All images
            time: msg.timestamp || Date.now(),
            model: msg.model, // Preserve model from gateway history
            runId: msg.runId || msg.message?.runId || null,
            // Fix #3c: Stamp session + agent so history messages display correctly after agent switch
            _sessionKey: currentSessionName || GATEWAY_CONFIG?.sessionKey || '',
            _agentId: window.currentAgentId || 'main'
        };

        // Classify and route
        if (isSystemMessage(content.text, message.from)) {
            systemMessages.push(message);
        } else {
            chatMessages.push(message);
        }
    });

    // Merge chat: combine gateway history with ALL local messages
    // Dedupe by ID first, then by exact text match (not snippet) to be safer
    const historyIds = new Set(chatMessages.map(m => m.id));
    const historyExactTexts = new Set(chatMessages.map(m => (m.text || '').trim()));
    const uniqueLocalMessages = allLocalChatMessages.filter(m => {
        const normalizedText = (m.text || '').trim();
        // Keep local message if: different ID AND (no text or text isn't already in history)
        return !historyIds.has(m.id) && (!normalizedText || !historyExactTexts.has(normalizedText));
    });

    // Patch history messages: if we have a local copy with a real model, prefer it
    // (history may return "openrouter/free" while local has the resolved model)
    const localByText = {};
    allLocalChatMessages.forEach(m => {
        const key = (m.text || '').trim();
        if (key) localByText[key] = m;
    });
    chatMessages.forEach(m => {
        const local = localByText[m.text?.trim()];
        if (local?.model && (!m.model || m.model === 'openrouter/free' || m.model === 'unknown')) {
            m.model = local.model;
            m.provider = local.provider;
        }
    });

    state.chat.messages = [...chatMessages, ...uniqueLocalMessages];
    console.log(`[Dashboard] Set ${state.chat.messages.length} chat messages (${chatMessages.length} from history, ${uniqueLocalMessages.length} local)`);

    // Sort chat by time and trim
    state.chat.messages.sort((a, b) => a.time - b.time);
    if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
        state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
    }

    // Merge system messages with existing (they're local noise, but good to show from history too)
    state.system.messages = [...state.system.messages, ...systemMessages];
    state.system.messages.sort((a, b) => a.time - b.time);
    if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
        state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
    }

    // Persist both system and chat messages locally (workaround for Gateway bug #5735)
    persistSystemMessages();
    persistChatMessages();

    renderChat();
    renderChatPage();
    renderSystemPage();
}

// Shared refresh function (one instance, never duplicated)
let _historyRefreshFn = null;
let _historyVisibilityFn = null;
let _historyRefreshInFlight = false;
let _lastHistoryLoadTime = 0;
const HISTORY_MIN_INTERVAL = 8000; // Minimum 8 seconds between loads

function _doHistoryRefresh() {
    if (!gateway || !gateway.isConnected() || isProcessing) return;
    if (Date.now() - lastProcessingEndTime < 1500) return;
    if (_historyRefreshInFlight) return; // Prevent overlapping calls
    if (Date.now() - _lastHistoryLoadTime < HISTORY_MIN_INTERVAL) return; // Rate limit
    _historyRefreshInFlight = true;
    _lastHistoryLoadTime = Date.now();
    const pollVersion = sessionVersion;
    const pollSessionKey = GATEWAY_CONFIG?.sessionKey || 'unknown';
    notifLog(`[Notifications] _doHistoryRefresh: session=${pollSessionKey}, version=${pollVersion}`);
    gateway.loadHistory().then(result => {
        _historyRefreshInFlight = false;
        if (pollVersion !== sessionVersion) {
            notifLog(`[Notifications] _doHistoryRefresh: Skipped (version mismatch ${pollVersion} vs ${sessionVersion})`);
            return;
        }
        if (result?.messages) {
            notifLog(`[Notifications] _doHistoryRefresh: Got ${result.messages.length} messages for session=${pollSessionKey}`);
            mergeHistoryMessages(result.messages);
        } else {
            notifLog(`[Notifications] _doHistoryRefresh: No messages returned`);
        }
    }).catch(err => {
        _historyRefreshInFlight = false;
        notifLog(`[Notifications] _doHistoryRefresh: Error - ${err.message}`);
    });
}

function startHistoryPolling() {
    stopHistoryPolling(); // Clear any existing interval + listeners

    // Poll every 30 seconds to catch user messages from other clients (was 10s, reduced for perf)
    historyPollInterval = setInterval(_doHistoryRefresh, 30000);

    // Only add focus/visibility listeners ONCE (remove old ones first)
    if (!_historyRefreshFn) {
        _historyRefreshFn = _doHistoryRefresh;
        _historyVisibilityFn = () => {
            if (document.visibilityState === 'visible') _doHistoryRefresh();
        };
        window.addEventListener('focus', _historyRefreshFn);
        document.addEventListener('visibilitychange', _historyVisibilityFn);
    }
}

function stopHistoryPolling() {
    if (historyPollInterval) {
        clearInterval(historyPollInterval);
        historyPollInterval = null;
    }
    // Clean up event listeners
    if (_historyRefreshFn) {
        window.removeEventListener('focus', _historyRefreshFn);
        document.removeEventListener('visibilitychange', _historyVisibilityFn);
        _historyRefreshFn = null;
        _historyVisibilityFn = null;
    }
}

function mergeHistoryMessages(messages) {
    // HARD GATE: Only merge messages for the current session
    // This prevents cross-session bleed if history poll returns stale data
    const activeSession = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    if (!activeSession) {
        notifLog('[Notifications] mergeHistoryMessages: No active session, skipping merge');
        return;
    }

    // Removed verbose log - called on every history poll
    // Merge new messages from history without duplicates, classify as chat vs system
    // This catches user messages from other clients that weren't broadcast as events
    const existingIds = new Set(state.chat.messages.map(m => m.id));
    const existingSystemIds = new Set(state.system.messages.map(m => m.id));
    // Also track existing text content (trimmed) to prevent duplicates when IDs differ
    // (local messages use 'm' + Date.now(), history messages have server IDs)
    const existingTexts = new Set(state.chat.messages.map(m => (m.text || '').trim()));
    const existingSystemTexts = new Set(state.system.messages.map(m => (m.text || '').trim()));
    // Track runIds from real-time messages for dedup
    const existingRunIds = new Set(state.chat.messages.filter(m => m.runId).map(m => m.runId));
    let newChatCount = 0;
    let newSystemCount = 0;

    const extractContentText = (container) => extractHistoryText(container);

    for (const msg of messages) {
        const msgId = msg.id || 'm' + msg.timestamp;

        // Skip if already exists in either array (by ID)
        if (existingIds.has(msgId) || existingSystemIds.has(msgId)) {
            continue;
        }

        // Skip tool results and tool calls - only show actual text responses
        if (msg.role === 'toolResult' || msg.role === 'tool') {
            continue;
        }

        // Skip gateway-injected messages (read-sync, read_ack, etc.)
        if (msg.model === 'gateway-injected' || msg.provider === 'openclaw') {
            continue;
        }

        {
            let textContent = extractContentText(msg);
            if (!textContent && msg.message) {
                textContent = extractContentText(msg.message);
            }

            // Only add if we have content and it's not a duplicate
            if (textContent) {
                const isSystemMsg = isSystemMessage(textContent, msg.role === 'user' ? 'user' : 'solobot');

                // Skip if runId matches a real-time message we already have
                if (msg.runId && existingRunIds.has(msg.runId)) {
                    continue;
                }

                // Skip if we already have this exact text content (trimmed, prevents duplicates when IDs differ)
                if (isSystemMsg && existingSystemTexts.has(textContent)) {
                    continue;
                }
                if (!isSystemMsg && existingTexts.has(textContent)) {
                    continue;
                }

                // Time guard: skip non-user assistant messages if we have any local message added within the last 5 seconds
                // Uses client-side time (m.time) to avoid clock skew with server timestamps
                if (msg.role !== 'user') {
                    const hasRecentLocal = state.chat.messages.some(m =>
                        m.from === 'solobot' && (Date.now() - m.time) < 5000
                    );
                    if (hasRecentLocal && !existingIds.has(msgId)) {
                        // Check if this message's text matches a recent local one (likely the same)
                        const recentMatch = state.chat.messages.some(m =>
                            m.from === 'solobot' && (Date.now() - m.time) < 5000 && m.text?.trim() === textContent
                        );
                        if (recentMatch) continue;
                    }
                }

                const message = {
                    id: msgId,
                    from: msg.role === 'user' ? 'user' : 'solobot',
                    text: textContent,
                    time: msg.timestamp || Date.now(),
                    model: msg.model || null,
                    provider: msg.provider || null,
                    runId: msg.runId || msg.message?.runId || null
                };

                // Classify and route
                if (isSystemMsg) {
                    state.system.messages.push(message);
                    existingSystemTexts.add(textContent); // already trimmed by extractContentText
                    newSystemCount++;
                } else {
                    state.chat.messages.push(message);
                    existingIds.add(msgId);
                    if (message.runId) existingRunIds.add(message.runId);
                    existingTexts.add(textContent); // already trimmed by extractContentText
                    newChatCount++;
                }
            }
        }
    }

    if (newChatCount > 0 || newSystemCount > 0) {
        notifLog(`[Notifications] mergeHistoryMessages: Merged ${newChatCount} chat, ${newSystemCount} system messages for session ${activeSession}`);

        // Sort and trim chat
        state.chat.messages.sort((a, b) => a.time - b.time);
        if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Sort and trim system
        state.system.messages.sort((a, b) => a.time - b.time);
        if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Persist both system and chat messages
        persistSystemMessages();
        persistChatMessages();

        // Don't re-render if user has text selected (would destroy their selection)
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;
        if (!hasSelection) {
            renderChat();
            renderChatPage();
            renderSystemPage();
        } else {
            // Defer render until selection is cleared
            console.log('[Dashboard] Deferring render — text is selected');
            if (!window._pendingRender) {
                window._pendingRender = true;
                const checkSelection = () => {
                    const sel = window.getSelection();
                    if (!sel || sel.toString().trim().length === 0) {
                        window._pendingRender = false;
                        renderChat();
                        renderChatPage();
                        renderSystemPage();
                    } else {
                        requestAnimationFrame(checkSelection);
                    }
                };
                requestAnimationFrame(checkSelection);
            }
        }
    }
}
