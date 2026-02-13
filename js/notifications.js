// js/notifications.js — Cross-session notifications, unread badges, toasts

// ===================
// CROSS-SESSION NOTIFICATIONS
// ===================
const READ_ACK_PREFIX = '[[read_ack]]';
const unreadSessions = new Map(); // sessionKey → count
const NOTIFICATION_DEBUG = false;
function notifLog(...args){ if (NOTIFICATION_DEBUG) console.log(...args); }

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
            console.log(`[Notifications] Permission: ${perm}`);
        });
    }
}

function subscribeToAllSessions() {
    if (!gateway || !gateway.isConnected()) return;
    const keys = availableSessions.map(s => s.key).filter(k => k);
    if (keys.length > 0) {
        gateway.subscribeToAllSessions(keys);
        console.log(`[Notifications] Subscribed to ${keys.length} sessions for cross-session notifications`);
    }
}

function handleCrossSessionNotification(msg) {
    const { sessionKey, content } = msg;
    notifLog(`[Notifications] 📥 Cross-session notification received: session=${sessionKey}, content=${(content||'').slice(0,80)}...`);

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
        if (t === 'NO_REPLY' || t === 'NO') {
            notifLog(`[Notifications] Ignoring silent placeholder notification for ${sessionKey}: ${t}`);
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
    notifLog(`[Notifications] Unread total: ${Array.from(unreadSessions.values()).reduce((a,b)=>a+b,0)}`);
    
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
        setActiveSidebarAgent(agentMatch[1]);
    }
    if (typeof switchToSessionKey === 'function') {
        switchToSessionKey(sessionKey);
    }
    // Clear unread for this session
    unreadSessions.delete(sessionKey);
    updateUnreadBadges();
}

// In-app toast notification — always visible, no browser permission needed
function showNotificationToast(title, body, sessionKey) {
    // Create toast container if it doesn't exist
    let container = document.getElementById('notification-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-toast-container';
        container.style.cssText = 'position: fixed; top: 12px; right: 12px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; max-width: 360px; pointer-events: none;';
        document.body.appendChild(container);
    }
    
    // Determine agent color from session key
    const agentMatch = sessionKey?.match(/^agent:([^:]+):/);
    const agentId = agentMatch ? agentMatch[1] : 'main';
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
        <div style="color: var(--text-secondary, #c9c9c9); font-size: 12px; line-height: 1.4; padding-left: 16px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${body.replace(/</g, '&lt;')}</div>
    `;
    
    // Click toast → navigate to session
    toast.addEventListener('click', (e) => {
        if (e.target.classList?.contains('toast-close')) {
            dismissToast(toast);
            return;
        }
        navigateToSession(sessionKey);
        dismissToast(toast);
    });
    
    container.appendChild(toast);
    notifLog(`[Notifications] Toast rendered for ${title} (session=${sessionKey})`);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });
    
    // Auto-dismiss after 12 seconds
    const timer = setTimeout(() => dismissToast(toast), 12000);
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
    const sessionKey = document.getElementById('gateway-session')?.value || GATEWAY_CONFIG.sessionKey || 'main';

    if (!host) {
        showToast('Please enter a gateway host in Settings', 'warning');
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
window.requestGatewayRestart = async function() {
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to gateway', 'warning');
        return;
    }

    showToast('Restarting gateway...', 'info');

    try {
        await gateway.restartGateway('manual restart from dashboard');
        showToast('Gateway restart initiated. Reconnecting...', 'success');
    } catch (err) {
        console.error('[Dashboard] Gateway restart failed:', err);
        showToast('Restart failed: ' + err.message, 'error');
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
    const { state: eventState, content, role, errorMessage, model, provider, stopReason, sessionKey } = event;
    
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
    if (model) {
        window._lastResponseModel = model;
        window._lastResponseProvider = provider;
        syncModelDisplay(model, provider);
    }

    // Handle user messages from other clients (WebUI, Telegram, etc.)
    if (role === 'user' && eventState === 'final' && content) {
        // Check if we already have this message (to avoid duplicates from our own sends)
        const isDuplicate = state.chat.messages.some(m =>
            m.from === 'user' && m.text === content && (Date.now() - m.time) < 5000
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
            streamingText = '';  // Clear any stale streaming text
            renderChat();
            renderChatPage();
            break;
            
        case 'delta':
            // Streaming response - content is cumulative, so REPLACE not append
            // Safety: If we have significant streaming content and new content is much shorter,
            // this might be a new response starting. Finalize the old one first.
            if (streamingText && streamingText.length > 100 && content.length < streamingText.length * 0.5) {
                addLocalChatMessage(streamingText, 'solobot');
            }
            
            streamingText = content;
            isProcessing = true;
            renderChat();
            renderChatPage();
            break;

        case 'final':
            // Final response from assistant
            // Prefer streamingText if available for consistency (avoid content mismatch)
            const finalContent = streamingText || content;
            if (finalContent && role !== 'user') {
                // Check for duplicate - same content within 10 seconds
                const isDuplicate = state.chat.messages.some(m =>
                    m.from === 'solobot' && m.text === finalContent && (Date.now() - m.time) < 10000
                );
                if (!isDuplicate) {
                    addLocalChatMessage(finalContent, 'solobot', window._lastResponseModel);
                }
            }
            streamingText = '';
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
    // Removed verbose log - called frequently on history sync
    // Convert gateway history format and classify as chat vs system
    // IMPORTANT: Preserve ALL local messages since Gateway doesn't save user messages (bug #5735)
    const allLocalChatMessages = state.chat.messages.filter(m => m.id.startsWith('m'));

    const chatMessages = [];
    const systemMessages = [];

    const extractContent = (container) => {
        if (!container) return { text: '', images: [] };
        let text = '';
        let images = [];
        
        if (Array.isArray(container.content)) {
            for (const part of container.content) {
                if (part.type === 'text') {
                    text += part.text || '';
                } else if (part.type === 'input_text') {
                    text += part.text || part.input_text || '';
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
        } else if (typeof container.content === 'string') {
            text = container.content;
        }
        
        // Check for attachments array (our send format)
        if (Array.isArray(container.attachments)) {
            for (const att of container.attachments) {
                if (att.type === 'image' && att.content && att.mimeType) {
                    images.push(`data:${att.mimeType};base64,${att.content}`);
                }
            }
        }
        
        if (!text && typeof container.text === 'string') text = container.text;
        return { text: (text || '').trim(), images };
    };

    messages.forEach(msg => {
        // Skip tool results and tool calls - only show actual text responses
        if (msg.role === 'toolResult' || msg.role === 'tool') {
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
            time: msg.timestamp || Date.now()
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
    const historyExactTexts = new Set(chatMessages.map(m => m.text));
    const uniqueLocalMessages = allLocalChatMessages.filter(m => {
        // Keep local message if: different ID AND different exact text
        return !historyIds.has(m.id) && !historyExactTexts.has(m.text);
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
const HISTORY_MIN_INTERVAL = 2000; // Minimum 2 seconds between loads

function _doHistoryRefresh() {
    if (!gateway || !gateway.isConnected() || isProcessing) return;
    if (Date.now() - lastProcessingEndTime < 1500) return;
    if (_historyRefreshInFlight) return; // Prevent overlapping calls
    if (Date.now() - _lastHistoryLoadTime < HISTORY_MIN_INTERVAL) return; // Rate limit
    _historyRefreshInFlight = true;
    _lastHistoryLoadTime = Date.now();
    const pollVersion = sessionVersion;
    gateway.loadHistory().then(result => {
        _historyRefreshInFlight = false;
        if (pollVersion !== sessionVersion) return;
        if (result?.messages) mergeHistoryMessages(result.messages);
    }).catch(() => { _historyRefreshInFlight = false; });
}

function startHistoryPolling() {
    stopHistoryPolling(); // Clear any existing interval + listeners

    // Poll every 3 seconds to catch user messages from other clients
    historyPollInterval = setInterval(_doHistoryRefresh, 3000);

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
    // Removed verbose log - called on every history poll
    // Merge new messages from history without duplicates, classify as chat vs system
    // This catches user messages from other clients that weren't broadcast as events
    const existingIds = new Set(state.chat.messages.map(m => m.id));
    const existingSystemIds = new Set(state.system.messages.map(m => m.id));
    // Also track existing text content to prevent duplicates when IDs differ
    // (local messages use 'm' + Date.now(), history messages have server IDs)
    const existingTexts = new Set(state.chat.messages.map(m => m.text));
    const existingSystemTexts = new Set(state.system.messages.map(m => m.text));
    let newChatCount = 0;
    let newSystemCount = 0;

    const extractContentText = (container) => {
        if (!container) return '';
        let text = '';
        if (Array.isArray(container.content)) {
            for (const part of container.content) {
                if (part.type === 'text') text += part.text || '';
                if (part.type === 'input_text') text += part.text || part.input_text || '';
            }
        } else if (typeof container.content === 'string') {
            text = container.content;
        }
        if (!text && typeof container.text === 'string') text = container.text;
        return (text || '').trim();
    };

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

        {
            let textContent = extractContentText(msg);
            if (!textContent && msg.message) {
                textContent = extractContentText(msg.message);
            }

            // Only add if we have content and it's not a duplicate by text
            if (textContent) {
                const isSystemMsg = isSystemMessage(textContent, msg.role === 'user' ? 'user' : 'solobot');

                // Skip if we already have this exact text content (prevents duplicates when IDs differ)
                if (isSystemMsg && existingSystemTexts.has(textContent)) {
                    continue;
                }
                if (!isSystemMsg && existingTexts.has(textContent)) {
                    continue;
                }

                const message = {
                    id: msgId,
                    from: msg.role === 'user' ? 'user' : 'solobot',
                    text: textContent,
                    time: msg.timestamp || Date.now()
                };

                // Classify and route
                if (isSystemMsg) {
                    state.system.messages.push(message);
                    existingSystemTexts.add(textContent);
                    newSystemCount++;
                } else {
                    state.chat.messages.push(message);
                    existingIds.add(msgId);
                    existingTexts.add(textContent);
                    newChatCount++;
                }
            }
        }
    }

    if (newChatCount > 0 || newSystemCount > 0) {
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


