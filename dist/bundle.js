// SoLoBot Dashboard — Bundled JS
// Generated: 2026-04-29T11:48:17Z
// Modules: 26


// === state.js ===
// js/state.js — Global state, config constants, persistence, chat storage

// Initialize global state on window object to prevent "Identifier already declared" errors
// across modular script boundaries and ensure global accessibility.
window.state = window.state || {
    status: 'idle',
    model: 'opus 4.5',
    currentTask: null,
    subagent: null,
    tasks: {
        todo: [],
        progress: [],
        done: [],
        archive: []
    },
    notes: [],
    activity: [],
    docs: [],
    pendingNotify: null,
    live: {
        status: 'idle',
        task: null,
        taskStarted: null,
        thoughts: [],
        lastActive: null,
        tasksToday: 0
    },
    console: {
        logs: [],
        expanded: false
    },
    chat: {
        messages: []  // User and SoLoBot messages only
    },
    system: {
        messages: []  // System messages, heartbeats, errors, etc.
    }
};


// Global agent color map — reads from CSS variables (--agent-*) defined in themes.css
// Used by phase10-taskboard.js, phase11-agents.js, phase12-analytics.js
window._lastManualModelChange = window._lastManualModelChange || null;

const AGENT_COLORS = window.AGENT_COLORS = new Proxy({}, {
    get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        const cached = target[prop];
        if (cached) return cached;
        const val = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${prop}`).trim();
        if (val) target[prop] = val;
        return val || '';
    }
});

function normalizeSessionKey(sessionKey) {
    if (!sessionKey || sessionKey === 'main') return 'agent:main:main';
    const key = String(sessionKey);
    const match = key.match(/^agent:([^:]+):(.+)$/);
    if (!match) return key;

    const rawAgentId = match[1].toLowerCase();
    const legacyMap = {
        exec: 'elon',
        cto: 'orion',
        coo: 'atlas',
        cfo: 'sterling',
        cmp: 'vector',
        devops: 'forge',
        ui: 'quill',
        swe: 'chip',
        youtube: 'snip',
        veo: 'snip',
        veoflow: 'snip',
        sec: 'knox',
        net: 'sentinel',
        smm: 'nova',
        docs: 'canon',
        tax: 'ledger',
        family: 'haven',
        creative: 'luma',
        art: 'luma',
        halo: 'main'
    };
    const canonicalAgent = (typeof window.resolveAgentId === 'function')
        ? window.resolveAgentId(rawAgentId)
        : (legacyMap[rawAgentId] || rawAgentId);

    if (!canonicalAgent || canonicalAgent === rawAgentId) return key;
    return `agent:${canonicalAgent}:${match[2]}`;
}

function chatStorageKey(sessionKey) {
    const key = normalizeSessionKey(sessionKey || GATEWAY_CONFIG?.sessionKey || localStorage.getItem('gateway_session') || 'agent:main:main');
    return 'solobot-chat-' + key;
}

function resolveMessageSessionKey(message) {
    const raw = message?._sessionKey || message?.sessionKey || '';
    if (!raw || typeof raw !== 'string') return '';
    return normalizeSessionKey(raw);
}

// In-memory session message cache (avoids full reload on agent switch)
const _sessionMessageCache = new Map();

function dedupeStateMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const kept = [];
    const seen = new Set();

    for (const msg of list) {
        if (!msg || typeof msg !== 'object') continue;
        const text = String(msg.text || '').trim();
        const imageCount = Array.isArray(msg.images) ? msg.images.length : (msg.image ? 1 : 0);
        if (!text && imageCount === 0) continue;

        const session = String(msg._sessionKey || msg.sessionKey || '').toLowerCase();
        const from = String(msg.from || msg.role || '').toLowerCase();
        const runId = String(msg.runId || '');
        const key = runId
            ? `run:${session}:${from}:${runId}`
            : `text:${session}:${from}:${text}:${imageCount}`;

        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(msg);
    }

    return kept;
}

function cacheSessionMessages(sessionKey, messages) {
    if (!sessionKey || !messages) return;
    _sessionMessageCache.set(sessionKey, messages.slice(-100));
}

function getCachedSessionMessages(sessionKey) {
    return _sessionMessageCache.get(sessionKey) || null;
}

// Load persisted system messages from localStorage (chat from localStorage + server fallback)
function loadPersistedMessages() {
    try {
        // System messages are local-only (UI noise)
        const savedSystem = localStorage.getItem('solobot-system-messages');
        if (savedSystem) {
            const parsed = JSON.parse(savedSystem);
            if (Array.isArray(parsed)) {
                const cutoff = Date.now() - (24 * 60 * 60 * 1000);
                state.system.messages = parsed.filter(m => m.time > cutoff);
            }
        }

        // Chat messages - use session-scoped key
        const currentKey = chatStorageKey();
        const savedChat = localStorage.getItem(currentKey);
        // Also try legacy global key as fallback (one-time migration)
        const legacyChat = !savedChat ? localStorage.getItem('solobot-chat-messages') : null;
        const chatData = savedChat || legacyChat;

        if (chatData) {
            const parsed = JSON.parse(chatData);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const sessionTag = normalizeSessionKey(GATEWAY_CONFIG.sessionKey).toLowerCase();
                const scopedMessages = parsed
                    .map(m => {
                        if (!m || typeof m !== 'object') return null;
                        const msgSession = resolveMessageSessionKey(m);
                        if (!msgSession) return null;
                        const normalized = { ...m, _sessionKey: msgSession };
                        const hasText = !!String(normalized.text || '').trim();
                        const hasImage = Array.isArray(normalized.images) ? normalized.images.length > 0 : !!normalized.image;
                        if (!hasText && !hasImage) return null;
                        return normalized;
                    })
                    .filter(m => m && m._sessionKey.toLowerCase() === sessionTag);

                const dedupedScopedMessages = typeof collapseDuplicateMessages === 'function'
                    ? collapseDuplicateMessages(scopedMessages)
                    : dedupeStateMessages(scopedMessages);
                const migratedSystem = dedupedScopedMessages.filter(m => typeof isSystemMessage === 'function' && isSystemMessage(m.text, m.from));
                state.chat.messages = dedupedScopedMessages.filter(m => !(typeof isSystemMessage === 'function' && isSystemMessage(m.text, m.from)));
                if (migratedSystem.length > 0) {
                    state.system.messages = [...(state.system.messages || []), ...migratedSystem].slice(-GATEWAY_CONFIG.maxMessages);
                    persistSystemMessages();
                }

                // Migrate legacy key to session-scoped
                if (legacyChat && !savedChat) {
                    localStorage.setItem(currentKey, JSON.stringify(state.chat.messages));
                }
                if (state.chat.messages.length > 0 || migratedSystem.length > 0) {
                    localStorage.setItem(currentKey, JSON.stringify(state.chat.messages));
                    return;
                }
            }
        }

        // No local messages - fetch from server
        loadChatFromServer();
    } catch (e) {
        loadChatFromServer();
    }
}

// Load chat messages from server (fallback when localStorage is empty)
async function loadChatFromServer() {
    try {
        const response = await fetch('/api/state');
        const serverState = await response.json();
        const sessionKey = normalizeSessionKey(GATEWAY_CONFIG?.sessionKey || localStorage.getItem('gateway_session') || 'agent:main:main');
        const sessionTag = sessionKey.toLowerCase();

        const hasSessionMap = !!(serverState.chat?.sessions && typeof serverState.chat.sessions === 'object');
        const sessionMessages = Array.isArray(serverState.chat?.sessions?.[sessionKey])
            ? serverState.chat.sessions[sessionKey]
            : [];
        const fallbackMessages = Array.isArray(serverState.chat?.messages)
            ? serverState.chat.messages
            : [];

        const sourceMessages = hasSessionMap ? sessionMessages : fallbackMessages;
        const filtered = sourceMessages
            .map(m => {
                if (!m || typeof m !== 'object') return null;
                const msgSession = resolveMessageSessionKey(m);
                if (!msgSession) return null;
                const normalized = { ...m, _sessionKey: msgSession };
                const hasText = !!String(normalized.text || '').trim();
                const hasImage = Array.isArray(normalized.images) ? normalized.images.length > 0 : !!normalized.image;
                if (!hasText && !hasImage) return null;
                return normalized;
            })
            .filter(m => m && m._sessionKey.toLowerCase() === sessionTag);

        if (filtered.length > 0) {
            const dedupedFiltered = typeof collapseDuplicateMessages === 'function'
                ? collapseDuplicateMessages(filtered)
                : dedupeStateMessages(filtered);
            const migratedSystem = dedupedFiltered.filter(m => typeof isSystemMessage === 'function' && isSystemMessage(m.text, m.from));
            state.chat.messages = dedupedFiltered.filter(m => !(typeof isSystemMessage === 'function' && isSystemMessage(m.text, m.from)));
            if (migratedSystem.length > 0) {
                state.system.messages = [...(state.system.messages || []), ...migratedSystem].slice(-GATEWAY_CONFIG.maxMessages);
                persistSystemMessages();
            }
            localStorage.setItem(chatStorageKey(), JSON.stringify(state.chat.messages));
            // console.log(`[Dashboard] Loaded ${state.chat.messages.length} chat messages from server`); // Keep quiet
            // Re-render if on chat page
            if (typeof renderChatMessages === 'function') renderChatMessages();
            if (typeof renderChatPage === 'function') renderChatPage();
            if (typeof renderSystemPage === 'function') renderSystemPage();
        }
    } catch (e) {
        // Silently fail - not critical
    }
}

// Save system messages to localStorage (chat is synced via Gateway)
function persistSystemMessages() {
    try {
        // Only persist system messages - they're local UI noise (limit to 30 to save space)
        const systemToSave = state.system.messages.slice(-30);
        localStorage.setItem('solobot-system-messages', JSON.stringify(systemToSave));
    } catch (e) {
        // Silently fail - not critical
    }
}

// Save chat messages to localStorage AND server
// Ensures persistence across browser sessions and deploys
function persistChatMessages() {
    try {
        // Limit to 50 messages to prevent localStorage quota exceeded
        const chatToSave = state.chat.messages.slice(-200);
        // Use session-scoped key so each agent's chat is stored separately
        const sessionKey = normalizeSessionKey(currentSessionName || GATEWAY_CONFIG.sessionKey);
        const key = chatStorageKey(sessionKey);
        localStorage.setItem(key, JSON.stringify(chatToSave));
        // Also update in-memory cache
        cacheSessionMessages(sessionKey, chatToSave);

        // Also sync to server for persistence across deploys
        syncChatToServer(chatToSave, sessionKey);
    } catch (e) {
        // Silently fail - not critical
    }
}

// Sync chat messages to server (debounced)
let chatSyncTimeout = null;
function syncChatToServer(messages, sessionKey) {
    if (chatSyncTimeout) clearTimeout(chatSyncTimeout);
    chatSyncTimeout = setTimeout(async () => {
        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages,
                    sessionKey: normalizeSessionKey(sessionKey || currentSessionName || GATEWAY_CONFIG.sessionKey)
                })
            });
        } catch (e) {
            // Silently fail - not critical
        }
    }, 2000); // Debounce 2 seconds
}

// Gateway connection configuration - localStorage only (sessionKey is browser concern, not server)
const GATEWAY_CONFIG = {
    host: localStorage.getItem('gateway_host') || '',
    port: parseInt(localStorage.getItem('gateway_port')) || 443,
    token: localStorage.getItem('gateway_token') || '',
    sessionKey: normalizeSessionKey(localStorage.getItem('gateway_session') || 'agent:main:main'),
    maxMessages: 500
};

// Load persisted messages after gateway config is initialized.
loadPersistedMessages();

// Function to save gateway settings to localStorage only
function saveGatewaySettings(host, port, token, sessionKey) {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);

    // Save to localStorage only (sessionKey is browser/localStorage concern)
    localStorage.setItem('gateway_host', host);
    localStorage.setItem('gateway_port', port.toString());
    localStorage.setItem('gateway_token', token);
    localStorage.setItem('gateway_session', normalizedSessionKey);

    // Update config
    GATEWAY_CONFIG.host = host;
    GATEWAY_CONFIG.port = port;
    GATEWAY_CONFIG.token = token;
    GATEWAY_CONFIG.sessionKey = normalizedSessionKey;

    console.log('[saveGatewaySettings] Saved sessionKey:', normalizedSessionKey);
}

// Gateway client instance

let gateway = null;
let streamingText = '';
let _streamingSessionKey = '';  // Session key that owns the current streamingText
let isProcessing = false;
let lastProcessingEndTime = 0; // Track when processing ended to avoid poll conflicts
let historyPollInterval = null;
let sessionVersion = 0; // Incremented on session switch to ignore stale history data

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set();
let editingTaskId = null;
let currentModalTask = null;
let currentModalColumn = null;
let refreshIntervalId = null;
let taskModalOpen = false; // Flag to pause auto-refresh while editing tasks

// DEBUG: Set to true to disable all filtering and show EVERYTHING in chat
const DISABLE_SYSTEM_FILTER = false;

// ===================
// DATA PERSISTENCE
// ===================

async function loadState() {
    // Preserve current messages and logs
    const currentChat = state.chat;
    const currentSystem = state.system;
    const currentConsole = state.console;

    // Count tasks helper
    const countTasks = (s) => {
        if (!s || !s.tasks) return 0;
        const t = s.tasks;
        return (t.todo?.length || 0) + (t.progress?.length || 0) + (t.done?.length || 0) + (t.archive?.length || 0);
    };

    // Load localStorage tasks as a safety net (in case server state is empty)
    let localTasks = null;
    try {
        const localSaved = localStorage.getItem('solovision-dashboard');
        if (localSaved) {
            const parsed = JSON.parse(localSaved);
            if (parsed.tasks && countTasks(parsed) > 0) {
                localTasks = JSON.parse(JSON.stringify(parsed.tasks));
            }
        }
    } catch (e) { /* ignore */ }

    // Also check in-memory tasks
    if (!localTasks && countTasks(state) > 0) {
        localTasks = JSON.parse(JSON.stringify(state.tasks));
    }

    // Load from VPS
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            if (!vpsState.tasks) vpsState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!vpsState.tasks.archive) vpsState.tasks.archive = [];

            delete vpsState.pendingChat;
            delete vpsState.chat;

            // SERVER IS ALWAYS AUTHORITATIVE for tasks and activity.
            // Never let stale localStorage overwrite server state.
            state = {
                ...state,
                ...vpsState,
                tasks: vpsState.tasks,
                activity: vpsState.activity || [],
                _taskVersion: vpsState._taskVersion || 0,
                chat: currentChat,
                system: currentSystem,
                console: currentConsole
            };

            console.log(`[loadState] Loaded from server: ${countTasks(vpsState)} tasks, ${(vpsState.activity || []).length} activity, v${vpsState._taskVersion || 0}`);
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            return;
        }
    } catch (e) {
        // VPS not available, will use localStorage fallback
    }

    // Fallback: localStorage
    const localSaved = localStorage.getItem('solovision-dashboard');
    if (localSaved) {
        const parsed = JSON.parse(localSaved);
        delete parsed.system;
        delete parsed.console;
        state = { ...state, ...parsed, chat: currentChat, system: currentSystem, console: currentConsole };
    } else {
        initSampleData();
    }
}

const SYNC_API = '/api/sync';

async function saveState(changeDescription = null) {
    state.localModified = Date.now();
    if (changeDescription) {
        state.lastChange = changeDescription;
    }

    // Create a trimmed copy for localStorage (limit messages to prevent quota exceeded)
    try {
        const stateForStorage = JSON.parse(JSON.stringify(state));
        // Limit chat messages to last 50 to save space
        if (stateForStorage.chat && stateForStorage.chat.messages) {
            stateForStorage.chat.messages = stateForStorage.chat.messages.slice(-200);
        }
        // Keep more console logs for review (last 500)
        if (stateForStorage.console && stateForStorage.console.logs) {
            stateForStorage.console.logs = stateForStorage.console.logs.slice(-500);
        }
        // Keep more activity for review (last 200)
        if (stateForStorage.activity) {
            stateForStorage.activity = stateForStorage.activity.slice(-200);
        }
        localStorage.setItem('solovision-dashboard', JSON.stringify(stateForStorage));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn('[Dashboard] localStorage full, clearing old data...');
            // Clear and try again with minimal data
            localStorage.removeItem('solovision-dashboard');
            localStorage.removeItem('solobot-chat');
            localStorage.removeItem('solobot-system-messages');
        } else {
            console.error('[Dashboard] saveState error:', e);
        }
    }
    updateLastSync();

    // Sync to server
    await syncToServer();
}

async function syncToServer() {
    try {
        // PROTECTION: Fetch server state first — check version and counts
        let serverTaskCount = 0;
        let serverActivityCount = 0;
        let serverTaskVersion = 0;
        try {
            const checkResp = await fetch('/api/state', { cache: 'no-store' });
            if (checkResp.ok) {
                const serverState = await checkResp.json();
                const st = serverState.tasks || {};
                serverTaskCount = (st.todo?.length || 0) + (st.progress?.length || 0) + (st.done?.length || 0) + (st.archive?.length || 0);
                serverActivityCount = Array.isArray(serverState.activity) ? serverState.activity.length : 0;
                serverTaskVersion = serverState._taskVersion || 0;

                // If server has newer task version, pull server tasks into local state
                if (serverTaskVersion > (state._taskVersion || 0)) {
                    console.log(`[Sync] Server tasks are newer (v${serverTaskVersion} > v${state._taskVersion || 0}) — adopting server tasks`);
                    state.tasks = serverState.tasks;
                    state._taskVersion = serverTaskVersion;
                    // Update localStorage with server tasks
                    try { localStorage.setItem('solovision-dashboard', JSON.stringify(state)); } catch (e) { }
                    renderTasks();
                }
            }
        } catch (e) { /* continue with sync */ }

        // Build sync payload — NEVER push tasks or activity from browser.
        // Server is source of truth for tasks (managed by dashboard-sync script)
        // and activity (managed by agents). Browser is read-only for these.
        const syncPayload = JSON.parse(JSON.stringify(state));
        delete syncPayload.tasks;
        delete syncPayload._taskVersion;
        delete syncPayload.activity;

        // Don't sync transient local-only data
        delete syncPayload.chat;
        delete syncPayload.system;
        delete syncPayload.console;

        const response = await fetch(SYNC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload)
        });

        if (response.ok) {
            const result = await response.json();
            if (result.protected?.tasks || result.protected?.activity) {
                console.log('[Sync] Server protected data:', result.protected);
            }
            if (state.console && state.console.logs) {
                state.console.logs.push({
                    text: 'State synced to server',
                    type: 'info',
                    time: Date.now()
                });
                if (state.console.logs.length > 500) {
                    state.console.logs = state.console.logs.slice(-500);
                }
                renderConsole();
            }
        }
    } catch (err) {
        console.error('Sync error:', err);
    }
}

function initSampleData() {
    state.tasks = {
        todo: [],
        progress: [],
        done: [],
        archive: []
    };
    state.notes = [];
    state.activity = [];
    state.docs = [];
    // Don't initialize chat - it's managed by Gateway WebSocket
    saveState();
}


// ===================
// DASHBOARD TASKS INITIALIZATION
// ===================

// Tasks are managed server-side via dashboard-sync API — no client-side task generation
function initDashboardTasks() {
    console.log('[Dashboard] Task initialization skipped — tasks managed server-side');
}

// === utils.js ===
// js/utils.js — Utility functions (time formatting, etc)

// ===================
// UTILITY FUNCTIONS
// ===================

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Smart relative time formatting - shows "just now", "2m", "1h", etc.
function formatSmartTime(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    
    // Less than 30 seconds
    if (diff < 30000) return 'just now';
    
    // Less than 1 minute
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    
    // Less than 1 hour
    if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins}m ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }
    
    // Less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }
    
    // Older - show actual date
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeShort(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return formatDate(timestamp);
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateLastSync() {
    document.getElementById('last-sync').textContent = formatTime(Date.now());
}

function getPriorityClass(p) {
    if (p === 0) return 'badge-error';
    if (p === 1) return 'badge-warning';
    return 'badge-default';
}

function getPriorityBadgeClass(p) {
    if (p === 0) return 'badge-error';
    if (p === 1) return 'badge-warning';
    return 'badge-default';
}

function getLogColor(type) {
    switch(type) {
        case 'command': return 'text-green-400';
        case 'success': return 'text-green-300';
        case 'error': return 'text-red-400';
        case 'warning': return 'text-yellow-400';
        case 'info': return 'text-blue-400';
        case 'thinking': return 'text-purple-400';
        case 'output': return 'text-gray-300';
        default: return 'text-gray-400';
    }
}

function getLogPrefix(type) {
    switch(type) {
        case 'command': return '$ ';
        case 'thinking': return '🧠 ';
        case 'success': return '✓ ';
        case 'error': return '✗ ';
        case 'warning': return '⚠ ';
        default: return '';
    }
}

// Legacy function - keeping for backwards compatibility
function getDocIcon(type) {
    return getDocIconSymbol(type, '');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addActivity(action, type = 'info') {
    state.activity.push({
        time: Date.now(),
        action,
        type
    });
    
    if (state.activity.length > 500) {
        state.activity = state.activity.slice(-500);
    }
}

function updateArchiveBadge() {
    const badgeEl = document.getElementById('archive-badge');
    if (!badgeEl) return;
    
    const count = (state.tasks.archive || []).length;
    badgeEl.textContent = count;
    if (count > 0) {
        badgeEl.classList.remove('hidden');
    } else {
        badgeEl.classList.add('hidden');
    }
}



// ============================================================================
// CENTRALIZED AVATAR RESOLUTION
// All avatar URL generation should go through these functions to avoid
// duplicate logic and potential inconsistencies.
// ============================================================================

const PNG_AGENTS = new Set(['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'family', 'smm', 'nova', 'luma',
    'elon', 'orion', 'atlas', 'sterling', 'forge', 'sentinel', 'knox', 'vector', 'canon',
    'quill', 'chip', 'snip', 'ledger', 'haven', 'solo', 'halo', 'pulse']);
const SVG_AGENTS = new Set(['tax', 'sec']);

/**
 * Resolve an agent ID to their avatar filename (without extension).
 * This is the SINGLE SOURCE OF TRUTH for avatar resolution.
 * @param {string} agentId - The agent ID (e.g., 'main', 'dev', 'orion')
 * @returns {string} The avatar filename (e.g., 'halo', 'dev', 'orion')
 */
function resolveAgentToAvatar(agentId) {
    // Special case: 'main' agent uses 'halo' avatar
    if (agentId === 'main') return 'halo';
    // Special case: 'smm' agent uses 'nova' avatar (legacy mapping)
    if (agentId === 'smm') return 'nova';
    // Return the agentId itself for all other cases
    return agentId;
}

/**
 * Get the full avatar URL for an agent (small version).
 * @param {string} agentId - The agent ID
 * @returns {string} The avatar URL (e.g., '/avatars/halo.png')
 */
function getAvatarUrl(agentId) {
    const avatar = resolveAgentToAvatar(agentId);
    if (PNG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}.png`;
    }
    if (SVG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}.svg`;
    }
    // Fallback for unknown agents
    return '/avatars/solobot.png';
}

/**
 * Get the full-size avatar URL for an agent (hero/full version).
 * @param {string} agentId - The agent ID
 * @returns {string} The full-size avatar URL
 */
function getAvatarUrlFull(agentId) {
    const avatar = resolveAgentToAvatar(agentId);
    if (PNG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}-full.png`;
    }
    if (SVG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}.svg`;
    }
    // Fallback to small avatar if full not available
    return getAvatarUrl(agentId);
}

// ============================================================================
// CENTRALIZED AGENT DATA
// ============================================================================

const AGENT_ID_ALIASES = {
    exec: "elon",
    cto: "orion",
    coo: "atlas",
    cfo: "sterling",
    cmp: "vector",
    devops: "forge",
    ui: "quill",
    swe: "chip",
    youtube: "snip",
    veo: "snip",
    veoflow: "snip",
    sec: "knox",
    net: "sentinel",
    smm: "nova",
    docs: "canon",
    tax: "ledger",
    family: "haven",
    creative: "luma",
    art: "luma",
    halo: "main",
    pulse: "pulse"
};

const DEFAULT_DEPARTMENTS = {
    main: "Executive",
    elon: "Executive",
    orion: "Technology",
    dev: "Technology",
    forge: "Technology",
    quill: "Technology",
    chip: "Technology",
    sentinel: "Technology",
    knox: "Technology",
    atlas: "Operations",
    canon: "Operations",
    vector: "Marketing & Product",
    nova: "Marketing & Product",
    snip: "Marketing & Product",
    luma: "Marketing & Product",
    chase: "Marketing & Product",
    pulse: "Marketing & Product",
    sterling: "Finance",
    ledger: "Finance",
    haven: "Family / Household"
};

const ALLOWED_AGENT_IDS = new Set(Object.keys(DEFAULT_DEPARTMENTS));

// ============================================================================
// AGENT ID NORMALIZATION
// ============================================================================

function normalizeAgentId(raw) {
    if (!raw) return 'main';
    const normalized = raw.toLowerCase().trim();
    return AGENT_ID_ALIASES[normalized] || normalized;
}

function getAgentDepartment(agentId) {
    const normalized = normalizeAgentId(agentId);
    return DEFAULT_DEPARTMENTS[normalized] || 'Other';
}

// ============================================================================
// TIME FORMATTING (CENTRALIZED)
// ============================================================================

function timeAgo(timestamp) {
    if (!timestamp) return 'never';
    const now = Date.now();
    const then = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const seconds = Math.floor((now - then) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(then).toLocaleDateString();
}

// ============================================================================
// LOCALSTORAGE UTILITIES
// ============================================================================

function getStorage(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    } catch { return defaultValue; }
}

function setStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch { return false; }
}

function getStorageJSON(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
    } catch { return defaultValue; }
}

function setStorageJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch { return false; }
}

// ============================================================================
// DOM HELPER
// ============================================================================

// Simple ID-based element lookup (like jQuery's $())
function $(id) {
    return typeof id === 'string' ? document.getElementById(id) : id;
}

// === ui.js ===
// js/ui.js — Confirm dialogs, toasts, alert/confirm overrides


// ===================
// CUSTOM CONFIRM & TOAST (no browser alerts!)
// ===================

// Note: showConfirm and closeConfirmModal are defined later in this file (more complete version)

// Toast notification - replaces alert()
function showToast(message, type = 'info', duration = 4000) {
    // Centralized notification rendering via showNotificationToast for a single look/feel.
    const normalized = String(message ?? '');
    const title = type === 'error' ? 'Warning' :
                  type === 'warning' ? 'Notice' :
                  type === 'success' ? 'Status' :
                  'Info';

    if (typeof showNotificationToast === 'function') {
        // showNotificationToast keeps all notification UI centralized in one style.
        showNotificationToast(title, normalized, null, null, duration);
        return;
    }

    // Fallback to legacy toast styling if notifications module is not loaded yet.
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
        max-width: 350px;
        word-wrap: break-word;
    `;

    // Set color based on type
    switch (type) {
        case 'success': toast.style.background = 'var(--success)'; break;
        case 'error': toast.style.background = 'var(--error)'; break;
        case 'warning': toast.style.background = '#f59e0b'; break;
        default: toast.style.background = 'var(--accent)'; break;
    }

    toast.textContent = normalized;
    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Make functions globally available
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;
window.showToast = showToast;

// === OVERRIDE NATIVE alert/confirm ===
// Intercept ALL browser dialogs and use our custom UI instead
window.alert = function(message) {
    showToast(message, 'info', 5000);
};

// Store original confirm for emergency use
const _originalConfirm = window.confirm;

window.confirm = function(message) {
    // Show our custom confirm modal
    // Since confirm() is synchronous, we show the modal but return false
    // to block the action. Code should be refactored to use showConfirm().
    console.warn('[Dashboard] Native confirm() intercepted. Use showConfirm() for proper async handling.');
    
    // Show toast explaining what happened
    showToast('Action blocked - please try again', 'warning');
    
    // Show the confirm modal (user can see the message)
    showConfirm(message, 'Confirm');
    
    // Return false to block the synchronous action
    return false;
};

// Classify messages as system/heartbeat noise vs real chat

// ===================
// THEMED CONFIRM MODAL (replaces browser confirm)
// ===================

let confirmModalCallback = null;

function showConfirm(title, message, okText = 'OK', cancelText = 'Cancel', isDanger = false) {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('confirm-modal-title');
        const messageEl = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (okBtn) {
            okBtn.textContent = okText;
            okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
        }
        if (cancelBtn) cancelBtn.textContent = cancelText;
        
        confirmModalCallback = resolve;
        showModal('confirm-modal');
    });
}

function closeConfirmModal(result) {
    hideModal('confirm-modal');
    if (confirmModalCallback) {
        confirmModalCallback(result);
        confirmModalCallback = null;
    }
}

// Make globally available
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;

async function clearChatHistory(skipConfirm = false, clearCache = false) {
    if (!skipConfirm) {
        const confirmed = await showConfirm(
            'Clear Chat History',
            'Clear all chat messages? They may reload from Gateway on next sync.',
            'Clear',
            'Cancel',
            true
        );
        if (!confirmed) return;
    }

    state.chat.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;

    // Clear localStorage cache when switching sessions to prevent stale data
    if (clearCache) {
        localStorage.removeItem(chatStorageKey());
    }

    // Reset incremental render state
    const chatContainer = document.getElementById('chat-page-messages');
    if (chatContainer) { chatContainer._renderedCount = 0; chatContainer._sessionKey = null; }

    renderChat();
    renderChatPage();
}



// === tasks.js ===
// js/tasks.js — Task board sorting, filtering, search

// ===================
// TASK BOARD: SORTING, FILTERING, SEARCH
// ===================

function getTaskAgent(task) {
    // 1. Direct agent field (set by CLI scripts or API)
    if (task.agent) return task.agent;
    
    // 2. Detect from title prefix patterns or description
    const title = (task.title || '').toLowerCase();
    const desc = (task.description || '').toLowerCase();
    const agents = ['dev', 'exec', 'coo', 'cfo', 'cmp', 'sec', 'smm', 'family', 'tax'];
    
    // Check explicit prefixes
    for (const agent of agents) {
        if (title.startsWith(`${agent}:`) || title.startsWith(`${agent} -`) || title.startsWith(`${agent} `)) return agent;
    }
    
    // Check title patterns
    if (title.startsWith('solobot-android:') || title.startsWith('android:') || title.includes('dashboard:')) return 'dev';
    if (title.includes('android') || title.includes('api ') || title.includes('fix ') || title.includes('deploy') || title.includes('cache') || title.includes('sync') || title.includes('notification') || title.includes('server.js')) return 'dev';
    if (title.includes('marketing') || title.includes('social') || title.includes('content')) return 'cmp';
    if (title.includes('budget') || title.includes('invoice') || title.includes('financial')) return 'cfo';
    if (title.includes('security') || title.includes('audit')) return 'sec';
    
    return 'main'; // default
}

// Agent colors are now defined in CSS variables (see css/themes.css)
function getAgentColor(agentId) {
    return getComputedStyle(document.documentElement).getPropertyValue(`--agent-${agentId}`).trim() || '#888';
}

function getFilteredSortedTasks(column) {
    let tasks = [...(state.tasks[column] || [])];
    
    // Search filter
    const search = (document.getElementById('task-search')?.value || '').toLowerCase().trim();
    if (search) {
        tasks = tasks.filter(t => 
            (t.title || '').toLowerCase().includes(search) || 
            (t.description || '').toLowerCase().includes(search)
        );
    }
    
    // Priority filter
    const priorityFilter = document.getElementById('task-filter-priority')?.value || 'all';
    if (priorityFilter !== 'all') {
        const p = parseInt(priorityFilter);
        tasks = tasks.filter(t => (t.priority ?? 1) === p);
    }
    
    // Agent filter
    const agentFilter = document.getElementById('task-filter-agent')?.value || 'all';
    if (agentFilter !== 'all') {
        tasks = tasks.filter(t => getTaskAgent(t) === agentFilter);
    }
    
    // Sort
    const sortBy = document.getElementById('task-sort')?.value || 'newest';
    switch (sortBy) {
        case 'newest':
            tasks.sort((a, b) => (b.created || 0) - (a.created || 0));
            break;
        case 'oldest':
            tasks.sort((a, b) => (a.created || 0) - (b.created || 0));
            break;
        case 'priority-high':
            tasks.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
            break;
        case 'priority-low':
            tasks.sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
            break;
        case 'alpha-az':
            tasks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
        case 'alpha-za':
            tasks.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
            break;
    }
    
    return tasks;
}

function applyTaskFilters() {
    renderTasks();
    updateBulkActionsUI();
}

function populateAgentFilter() {
    const select = document.getElementById('task-filter-agent');
    if (!select) return;
    
    // Collect all agents from all tasks
    const agents = new Set();
    ['todo', 'progress', 'done'].forEach(col => {
        (state.tasks[col] || []).forEach(t => agents.add(getTaskAgent(t)));
    });
    
    const currentValue = select.value;
    select.innerHTML = '<option value="all">All agents</option>';
    const sortedAgents = [...agents].sort();
    for (const agent of sortedAgents) {
        const color = getAgentColor(agent);
        const opt = document.createElement('option');
        opt.value = agent;
        opt.textContent = agent.toUpperCase();
        opt.style.color = color;
        select.appendChild(opt);
    }
    select.value = currentValue || 'all';
}

function updateTaskStats() {
    const el = document.getElementById('task-stats');
    if (!el) return;
    
    const todoCount = (state.tasks.todo || []).length;
    const progressCount = (state.tasks.progress || []).length;
    const doneCount = (state.tasks.done || []).length;
    const total = todoCount + progressCount + doneCount;
    const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    
    el.innerHTML = `${total} tasks • ${completionRate}% done`;
}

function updateBulkActionsUI() {
    const bulkEl = document.getElementById('task-bulk-actions');
    const countEl = document.getElementById('task-selected-count');
    if (!bulkEl) return;
    
    if (selectedTasks.size > 0) {
        bulkEl.style.display = 'flex';
        if (countEl) countEl.textContent = `${selectedTasks.size} selected`;
    } else {
        bulkEl.style.display = 'none';
    }
}

function bulkDelete() {
    if (selectedTasks.size === 0) return;
    if (!confirm(`Delete ${selectedTasks.size} task(s)?`)) return;
    
    ['todo', 'progress', 'done'].forEach(col => {
        state.tasks[col] = (state.tasks[col] || []).filter(t => !selectedTasks.has(t.id));
    });
    selectedTasks.clear();
    saveState('Bulk deleted tasks');
    renderTasks();
}

function renderTasks() {
    populateAgentFilter();
    
    ['todo', 'progress', 'done'].forEach(column => {
        const container = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
        const count = document.getElementById(`${column === 'progress' ? 'progress' : column}-count`);

        if (!container) { console.warn('[renderTasks] Missing container for', column); return; }

        const tasks = getFilteredSortedTasks(column);
        const totalInColumn = (state.tasks[column] || []).length;

        if (tasks.length === 0) {
            const emptyMsg = totalInColumn > 0 ? 'No tasks match filters' : 'No tasks';
            container.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-6) var(--space-2);">${emptyMsg}</div>`;
            if (count) count.textContent = totalInColumn;
            return;
        }

        container.innerHTML = tasks.map((task, index) => {
            const isSelected = selectedTasks.has(task.id);
            const doneStyle = column === 'done' ? 'text-decoration: line-through; color: var(--text-muted);' : '';
            const agent = getTaskAgent(task);
            const agentColor = getAgentColor(agent);
            const ageDays = Math.floor((Date.now() - (task.created || 0)) / 86400000);
            const ageLabel = ageDays === 0 ? 'today' : ageDays === 1 ? '1d ago' : `${ageDays}d ago`;
            
            return `
            <div class="task-card priority-p${task.priority} ${isSelected ? 'selected' : ''} ${task.images?.length ? 'has-attachments' : ''}"
                 data-task-id="${task.id}" data-column="${column}"
                 onclick="openTaskDetail('${task.id}', '${column}')">
                <div style="display: flex; align-items: flex-start; gap: var(--space-3);">
                    <span class="drag-handle" draggable="true"
                          ondragstart="handleDragStart(event, '${task.id}', '${column}')"
                          ondragend="handleDragEnd(event)"
                          title="Drag to move">⠿</span>
                    <input type="checkbox"
                           style="margin-top: 2px; accent-color: var(--brand-red); cursor: pointer;"
                           ${isSelected ? 'checked' : ''}
                           onclick="toggleTaskSelection('${task.id}', event)">
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2);">
                            <span class="task-title" style="${doneStyle}">${escapeHtml(task.title)}</span>
                            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                                <span style="font-size: 9px; padding: 1px 5px; border-radius: 8px; background: ${agentColor}22; color: ${agentColor}; font-weight: 600; text-transform: uppercase;">${agent}</span>
                                <span class="badge ${getPriorityBadgeClass(task.priority)}">P${task.priority}</span>
                            </div>
                        </div>
                        ${task.description ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${escapeHtml(task.description.slice(0, 80))}${task.description.length > 80 ? '…' : ''}</div>` : ''}
                        <div class="task-meta">
                            ${ageLabel} • ${formatTime(task.created || task.completedAt || task.id?.replace('t',''))}
                            ${task.description ? ' • 📝' : ''}
                            ${task.images?.length ? ` • 📎${task.images.length}` : ''}
                        </div>
                    </div>
                </div>

                <div class="task-quick-actions">
                    ${column === 'todo' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'progress', event)"
                                class="btn btn-ghost" style="width: 28px; height: 28px; padding: 0; border-radius: 50%;"
                                title="Start Working">▶</button>
                    ` : ''}
                    ${column !== 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'done', event)"
                                class="btn btn-primary" style="width: 28px; height: 28px; padding: 0; border-radius: 50%;"
                                title="Mark Done">✓</button>
                    ` : ''}
                    ${column === 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'todo', event)"
                                class="btn btn-ghost" style="width: 28px; height: 28px; padding: 0; border-radius: 50%;"
                                title="Reopen">↩</button>
                    ` : ''}
                </div>
            </div>
        `}).join('');

        // Show filtered count vs total
        if (count) count.textContent = tasks.length === totalInColumn ? totalInColumn : `${tasks.length}/${totalInColumn}`;
    });
    
    updateTaskStats();
    updateBulkActionsUI();
    updateDoneColumnCollapse();
    
    // Update quick stats when tasks change
    if (typeof updateQuickStats === 'function') {
        updateQuickStats();
    }
}

// Done column collapse/expand — NO auto-archive, SoLo reviews manually
let doneColumnCollapsed = localStorage.getItem('doneColumnCollapsed') !== 'false'; // Default: collapsed

function updateDoneColumnCollapse() {
    const doneContainer = document.getElementById('done-tasks');
    const summaryEl = document.getElementById('done-collapsed-summary');
    const btnEl = document.getElementById('done-toggle-btn');
    const textEl = document.getElementById('done-collapsed-text');
    
    if (!doneContainer) return;
    
    const doneCount = (state.tasks.done || []).length;
    
    // Update summary text
    if (textEl) textEl.textContent = `${doneCount} completed task${doneCount !== 1 ? 's' : ''}`;
    
    if (doneCount === 0) {
        // No done tasks — show drop zone, hide summary
        doneContainer.classList.remove('done-hidden');
        if (summaryEl) summaryEl.style.display = 'none';
        if (btnEl) btnEl.textContent = 'Show';
        return;
    }
    
    if (doneColumnCollapsed) {
        doneContainer.classList.add('done-hidden');
        if (summaryEl) summaryEl.style.display = '';
        if (btnEl) btnEl.textContent = 'Show';
    } else {
        doneContainer.classList.remove('done-hidden');
        if (summaryEl) summaryEl.style.display = 'none';
        if (btnEl) btnEl.textContent = 'Hide';
    }
}

function toggleDoneColumn() {
    doneColumnCollapsed = !doneColumnCollapsed;
    localStorage.setItem('doneColumnCollapsed', doneColumnCollapsed.toString());
    updateDoneColumnCollapse();
}

function renderNotes() {
    const container = document.getElementById('notes-list');
    container.innerHTML = state.notes.map(note => `
        <div class="note-item" style="${note.seen ? 'opacity: 0.6;' : ''}">
            <div style="display: flex; align-items: flex-start; justify-content: space-between;">
                <span class="note-text">${escapeHtml(note.text)}</span>
                ${note.seen
                    ? '<span class="badge badge-success">✓ Seen</span>'
                    : '<span class="badge badge-warning">Pending</span>'}
            </div>
            <div class="note-meta">${formatTime(note.created)}</div>
        </div>
    `).join('') || '<div style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No notes yet</div>';
}

function renderActivity() {
    const container = document.getElementById('activity-log');
    if (!container) return;
    
    const entries = state.activity.slice().reverse().slice(0, 50);

    if (entries.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No activity yet</div>';
        return;
    }

    // Group entries by time period
    const now = Date.now();
    const today = new Date().toDateString();
    const yesterday = new Date(now - 86400000).toDateString();
    const weekAgo = now - 7 * 86400000;
    
    const grouped = { today: [], yesterday: [], thisWeek: [], older: [] };
    const systemEntries = [];
    
    entries.forEach(entry => {
        const entryDate = new Date(entry.time).toDateString();
        const isSystem = /system|heartbeat|audit|auto/i.test(entry.action);
        
        if (isSystem) {
            systemEntries.push(entry);
            return;
        }
        
        if (entryDate === today) {
            grouped.today.push(entry);
        } else if (entryDate === yesterday) {
            grouped.yesterday.push(entry);
        } else if (entry.time > weekAgo) {
            grouped.thisWeek.push(entry);
        } else {
            grouped.older.push(entry);
        }
    });
    
    // Helper to format activity item with icon + verb + object
    const formatActivity = (entry) => {
        const timeStr = formatTime(entry.time);
        let icon = '📋';
        let text = escapeHtml(entry.action);
        
        // Parse action to extract icon + verb + object
        const action = entry.action.toLowerCase();
        if (action.includes('completed') || action.includes('done')) {
            icon = '✅';
        } else if (action.includes('started') || action.includes('began')) {
            icon = '▶️';
        } else if (action.includes('created') || action.includes('added')) {
            icon = '➕';
        } else if (action.includes('deleted') || action.includes('removed')) {
            icon = '🗑️';
        } else if (action.includes('updated') || action.includes('edited')) {
            icon = '✏️';
        } else if (action.includes('error') || action.includes('failed')) {
            icon = '❌';
        }
        
        const typeClass = entry.type === 'success' ? 'success' : entry.type === 'error' ? 'warning' : '';
        
        return `
            <div class="activity-item">
                <span style="font-size: 14px; margin-right: 6px;">${icon}</span>
                <div style="flex: 1; min-width: 0;">
                    <span class="activity-text ${typeClass}">${text}</span>
                    <span class="activity-time" style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">${timeStr}</span>
                </div>
            </div>
        `;
    };
    
    let html = '';
    
    // Today
    if (grouped.today.length > 0) {
        html += '<div class="activity-group-header">Today</div>';
        html += grouped.today.map(formatActivity).join('');
    }
    
    // Yesterday
    if (grouped.yesterday.length > 0) {
        html += '<div class="activity-group-header">Yesterday</div>';
        html += grouped.yesterday.map(formatActivity).join('');
    }
    
    // This Week
    if (grouped.thisWeek.length > 0) {
        html += '<div class="activity-group-header">This Week</div>';
        html += grouped.thisWeek.map(formatActivity).join('');
    }
    
    // Older
    if (grouped.older.length > 0) {
        html += '<div class="activity-group-header">Older</div>';
        html += grouped.older.map(formatActivity).join('');
    }
    
    // System entries (collapsed by default)
    if (systemEntries.length > 0) {
        html += `
            <div class="activity-system-toggle" onclick="toggleSystemActivity()" style="cursor: pointer; padding: var(--space-2); margin-top: var(--space-2); background: var(--surface-2); border-radius: var(--radius-md); text-align: center; font-size: 11px; color: var(--text-muted);">
                <span id="system-activity-toggle-text">Show ${systemEntries.length} system entries ▼</span>
            </div>
            <div id="system-activity-list" style="display: none;">
                <div class="activity-group-header">System</div>
                ${systemEntries.map(formatActivity).join('')}
            </div>
        `;
    }
    
    container.innerHTML = html;
}

// Toggle system activity visibility
function toggleSystemActivity() {
    const list = document.getElementById('system-activity-list');
    const toggleText = document.getElementById('system-activity-toggle-text');
    if (!list || !toggleText) return;
    
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'block' : 'none';
    const count = (state.activity || []).filter(e => /system|heartbeat|audit|auto/i.test(e.action)).length;
    toggleText.textContent = isHidden ? `Hide system entries ▲` : `Show ${count} system entries ▼`;
}

function renderDocs(filter = '') {
    const container = document.getElementById('docs-grid');
    
    // If docs-grid doesn't exist (moved to Memory page), skip
    if (!container) return;
    
    // First, render the memory files from our local documentation
    renderMemoryFiles(filter);
    
    // Then, append the existing Google Drive docs (if any) below the memory files
    const filtered = state.docs.filter(doc =>
        doc.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    if (filtered.length > 0) {
        // Add a separator if we have both memory files and Google Drive docs
        if (container.innerHTML && filtered.length > 0) {
            container.innerHTML += '<div class="docs-separator"><h3 class="category-title">Google Drive Documents</h3></div>';
        }
        
        const driveDocsHtml = filtered.map(doc => {
            const iconClass = getDocIconClass(doc.type, doc.url);
            const iconSymbol = getDocIconSymbol(doc.type, doc.url);
            return `
            <a href="${doc.url}" target="_blank" class="doc-card">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                    <div class="doc-icon ${iconClass}">${iconSymbol}</div>
                    <div style="min-width: 0; flex: 1;">
                        <div class="doc-title">${escapeHtml(doc.name)}</div>
                        <div class="doc-meta">Updated: ${formatDate(doc.updated)}</div>
                    </div>
                </div>
            </a>
        `}).join('');
        
        container.innerHTML += driveDocsHtml;
    }
    
    // If completely empty, show message
    if (!container.innerHTML) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; grid-column: 1 / -1; text-align: center; padding: var(--space-4);">No documents found</div>';
    }
}

function getDocIconClass(type, url) {
    if (url?.includes('docs.google.com/document')) return 'gdoc';
    if (url?.includes('docs.google.com/spreadsheets')) return 'gsheet';
    if (type === 'pdf' || url?.includes('.pdf')) return 'pdf';
    return 'default';
}

function getDocIconSymbol(type, url) {
    if (url?.includes('docs.google.com/document')) return '📄';
    if (url?.includes('docs.google.com/spreadsheets')) return '📊';
    if (type === 'pdf' || url?.includes('.pdf')) return '📕';
    return '📁';
}

// Done column collapse helpers already defined above



// === quick-stats.js ===
// js/quick-stats.js — Quick stats with sparklines and circular progress rings

// ===================
// QUICK STATS
// ===================

let statsState = {
    tasksDoneThisWeek: 0,
    messagesToday: 0,
    streak: parseInt(localStorage.getItem('dashboardStreak') || '0'),
    sessionStartTime: Date.now(),
    // History for sparklines (keep last 7 data points)
    history: {
        tasks: JSON.parse(localStorage.getItem('stats_history_tasks') || '[]'),
        messages: JSON.parse(localStorage.getItem('stats_history_messages') || '[]'),
        activity: JSON.parse(localStorage.getItem('stats_history_activity') || '[]')
    }
};

// ===================
// SPARKLINE GENERATOR
// ===================

function generateSparkline(data, width = 60, height = 24, type = 'neutral') {
    if (!data || data.length < 2) {
        return `<svg width="${width}" height="${height}" class="sparkline"><line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,2"/></svg>`;
    }
    
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    
    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');
    
    // Create area path (closed)
    const areaPoints = `0,${height} ${points} ${width},${height}`;
    
    const colorClass = type === 'positive' ? 'sparkline-positive' : 
                       type === 'negative' ? 'sparkline-negative' : 'sparkline-neutral';
    
    return `
        <svg width="${width}" height="${height}" class="sparkline ${colorClass}" viewBox="0 0 ${width} ${height}">
            <polygon points="${areaPoints}" class="sparkline-area" />
            <polyline points="${points}" class="sparkline-path" />
        </svg>
    `;
}

function updateSparklineData(key, value) {
    const arr = statsState.history[key];
    arr.push(value);
    if (arr.length > 7) arr.shift();
    localStorage.setItem(`stats_history_${key}`, JSON.stringify(arr));
}

// ===================
// CIRCULAR PROGRESS RING
// ===================

function generateProgressRing(value, max, size = 50, strokeWidth = 4, color = null) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(Math.max(value / max, 0), 1);
    const offset = circumference - progress * circumference;
    
    const strokeColor = color || 'var(--brand-red)';
    
    return `
        <div class="progress-ring" style="width: ${size}px; height: ${size}px;">
            <svg width="${size}" height="${size}">
                <circle
                    class="progress-ring-bg"
                    cx="${size/2}" cy="${size/2}" r="${radius}"
                    fill="none"
                    stroke-width="${strokeWidth}"
                />
                <circle
                    class="progress-ring-circle"
                    cx="${size/2}" cy="${size/2}" r="${radius}"
                    fill="none"
                    stroke="${strokeColor}"
                    stroke-width="${strokeWidth}"
                    stroke-linecap="round"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}"
                />
            </svg>
            <span class="progress-ring-value">${Math.round(progress * 100)}%</span>
        </div>
    `;
}

// ===================
// MINI HEATMAP
// ===================

function generateMiniHeatmap(data, rows = 4, cols = 7) {
    // data should be array of values 0-5
    const cells = [];
    for (let i = 0; i < rows * cols; i++) {
        const level = data[i] || 0;
        const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i % 7];
        cells.push(`<div class="heatmap-cell level-${level}" title="${dayLabel}: Level ${level}"></div>`);
    }
    
    return `<div class="mini-heatmap" style="grid-template-columns: repeat(${cols}, 1fr);">${cells.join('')}</div>`;
}

function generateActivityHeatmap(hourlyData) {
    // hourlyData: array of 24 values (0-5) representing activity per hour
    const cells = hourlyData.map((level, hour) => {
        const timeLabel = `${hour}:00`;
        return `<div class="activity-heatmap-cell ${level > 0 ? 'active' : ''}" style="opacity: ${0.2 + (level / 5) * 0.8}" title="${timeLabel}: Level ${level}"></div>`;
    }).join('');
    
    return `<div class="activity-heatmap">${cells}</div>`;
}

// Generate sample activity data for the last 28 days
function generateActivityData() {
    const data = [];
    for (let i = 0; i < 28; i++) {
        // Random activity level 0-5, with higher probability of lower values
        const rand = Math.random();
        let level = 0;
        if (rand > 0.6) level = 1;
        if (rand > 0.75) level = 2;
        if (rand > 0.85) level = 3;
        if (rand > 0.93) level = 4;
        if (rand > 0.98) level = 5;
        data.push(level);
    }
    return data;
}

// Generate hourly activity data (24 hours)
function generateHourlyActivityData() {
    const data = [];
    for (let i = 0; i < 24; i++) {
        // More activity during working hours (9-17)
        let base = 0;
        if (i >= 9 && i <= 17) base = 2;
        if (i >= 13 && i <= 15) base = 3;
        
        const rand = Math.random();
        let level = base;
        if (rand > 0.7) level = Math.min(base + 1, 5);
        if (rand > 0.9) level = Math.min(base + 2, 5);
        if (rand < 0.3 && base > 0) level = Math.max(base - 1, 0);
        
        data.push(level);
    }
    return data;
}

// ===================
// ENHANCED STATS UPDATE
// ===================

function updateQuickStats() {
    // Tasks done this week
    const tasksDone = state.tasks?.done?.length || 0;
    const tasksDoneEl = document.getElementById('stat-tasks-done');
    if (tasksDoneEl) {
        tasksDoneEl.textContent = tasksDone;
        // Update history
        updateSparklineData('tasks', tasksDone);
    }
    
    // Messages today (count from chat)
    const today = new Date().toDateString();
    const messagesToday = (state.chat?.messages || []).filter(m => {
        const msgDate = new Date(m.time).toDateString();
        return msgDate === today;
    }).length;
    const messagesEl = document.getElementById('stat-messages');
    if (messagesEl) {
        messagesEl.textContent = messagesToday;
        updateSparklineData('messages', messagesToday);
    }
    
    // Streak
    updateStreak();
    const streakEl = document.getElementById('stat-streak');
    if (streakEl) streakEl.textContent = statsState.streak;
    
    // Session time
    const uptimeEl = document.getElementById('stat-uptime');
    if (uptimeEl) {
        const elapsed = Math.floor((Date.now() - statsState.sessionStartTime) / 60000);
        if (elapsed < 60) {
            uptimeEl.textContent = `${elapsed}m`;
        } else {
            const hours = Math.floor(elapsed / 60);
            const mins = elapsed % 60;
            uptimeEl.textContent = `${hours}h ${mins}m`;
        }
    }
    
    // Update timestamp
    const lastUpdatedEl = document.getElementById('stats-last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = 'Updated just now';
    }
    
    // Render sparklines if containers exist
    renderSparklines();
    
    // Render heatmaps if containers exist
    renderHeatmaps();
    
    // Render progress rings if containers exist
    renderProgressRings();
}

function renderSparklines() {
    // Tasks sparkline with trend
    const tasksSparklineEl = document.getElementById('sparkline-tasks');
    if (tasksSparklineEl) {
        const trend = statsState.history.tasks.length > 1 ? 
            statsState.history.tasks[statsState.history.tasks.length - 1] - statsState.history.tasks[statsState.history.tasks.length - 2] : 0;
        const type = trend > 0 ? 'positive' : trend < 0 ? 'negative' : 'neutral';
        tasksSparklineEl.innerHTML = generateSparkline(statsState.history.tasks, 60, 24, type);
        
        const trendEl = document.getElementById('trend-tasks');
        if (trendEl) {
            trendEl.textContent = trend >= 0 ? `+${trend}` : trend;
            trendEl.className = `stat-change ${trend > 0 ? 'positive' : trend < 0 ? 'negative' : ''}`;
        }
    }
    
    // Messages sparkline
    const messagesSparklineEl = document.getElementById('sparkline-messages');
    if (messagesSparklineEl) {
        messagesSparklineEl.innerHTML = generateSparkline(statsState.history.messages, 60, 24, 'neutral');
    }
    
}

function renderHeatmaps() {
    // Activity heatmap
    const activityHeatmapEl = document.getElementById('activity-heatmap-container');
    if (activityHeatmapEl && !activityHeatmapEl.dataset.initialized) {
        const activityData = generateActivityData();
        activityHeatmapEl.innerHTML = generateMiniHeatmap(activityData, 4, 7);
        activityHeatmapEl.dataset.initialized = 'true';
    }
    
    // Hourly activity heatmap
    const hourlyHeatmapEl = document.getElementById('hourly-heatmap-container');
    if (hourlyHeatmapEl && !hourlyHeatmapEl.dataset.initialized) {
        const hourlyData = generateHourlyActivityData();
        hourlyHeatmapEl.innerHTML = generateActivityHeatmap(hourlyData);
        hourlyHeatmapEl.dataset.initialized = 'true';
    }
}

function renderProgressRings() {
    // Task completion progress
    const taskProgressEl = document.getElementById('progress-ring-tasks');
    if (taskProgressEl) {
        const total = (state.tasks?.todo?.length || 0) + (state.tasks?.progress?.length || 0) + (state.tasks?.done?.length || 0);
        const done = state.tasks?.done?.length || 0;
        taskProgressEl.innerHTML = generateProgressRing(done, total || 1, 36, 3, 'var(--success)');
    }
    
    // Daily goal progress (example: 10 tasks/day goal)
    const dailyGoalEl = document.getElementById('progress-ring-daily');
    if (dailyGoalEl) {
        const today = new Date().toDateString();
        const doneToday = (state.tasks?.done || []).filter(t => {
            const completedDate = t.completedAt ? new Date(t.completedAt).toDateString() : null;
            return completedDate === today;
        }).length;
        dailyGoalEl.innerHTML = generateProgressRing(doneToday, 10, 36, 3, 'var(--brand-red)');
    }
}

function updateStreak() {
    const lastActiveDate = localStorage.getItem('lastActiveDate');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    if (lastActiveDate === today) {
        // Already active today, streak maintained
        return;
    } else if (lastActiveDate === yesterday) {
        // Was active yesterday, increment streak
        statsState.streak++;
    } else if (lastActiveDate !== today) {
        // Streak broken or first day
        statsState.streak = 1;
    }
    
    localStorage.setItem('dashboardStreak', statsState.streak.toString());
    localStorage.setItem('lastActiveDate', today);
}

// Initialize sparkline data if empty
function initSparklineData() {
    const keys = ['tasks', 'messages', 'activity'];
    keys.forEach(key => {
        const stored = localStorage.getItem(`stats_history_${key}`);
        if (!stored || stored === '[]') {
            // Generate some sample historical data
            const sampleData = [];
            for (let i = 0; i < 7; i++) {
                sampleData.push(Math.floor(Math.random() * 10) + 5);
            }
            localStorage.setItem(`stats_history_${key}`, JSON.stringify(sampleData));
            statsState.history[key] = sampleData;
        }
    });
}

// Initialize on load
initSparklineData();

// Update stats every minute
let quickStatsInterval = setInterval(updateQuickStats, 60000);

// Export for use in other modules
window.QuickStats = {
    update: updateQuickStats,
    generateSparkline,
    generateProgressRing,
    generateMiniHeatmap,
    generateActivityHeatmap,
    cleanup: () => clearInterval(quickStatsInterval)
};

// === phase1-visuals.js ===
// ========================================
// PHASE 1: VISUAL DESIGN FOUNDATION
// Glassmorphism, Sparklines, Progress Rings, Heatmaps
// ========================================

/**
 * Sparkline Chart Generator
 * Creates mini trend graphs for Quick Stats widget
 */
const Sparklines = {
    /**
     * Generate SVG sparkline path from data array
     * @param {number[]} data - Array of values
     * @param {number} width - SVG width
     * @param {number} height - SVG height
     * @returns {string} SVG path string
     */
    generatePath(data, width = 60, height = 24) {
        if (!data || data.length < 2) return '';
        
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        
        const points = data.map((value, index) => {
            const x = (index / (data.length - 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        });
        
        return `M ${points.join(' L ')}`;
    },

    /**
     * Generate area path for sparkline (closed at bottom)
     */
    generateAreaPath(data, width = 60, height = 24) {
        if (!data || data.length < 2) return '';
        
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        
        const points = data.map((value, index) => {
            const x = (index / (data.length - 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        });
        
        return `M ${points.join(' L ')} L ${width},${height} L 0,${height} Z`;
    },

    /**
     * Render sparkline SVG element
     * @param {string} containerId - Target container ID
     * @param {number[]} data - Data points
     * @param {string} type - 'positive' | 'negative' | 'neutral'
     */
    render(containerId, data, type = 'neutral') {
        const container = document.getElementById(containerId);
        if (!container || !data || data.length < 2) return;
        
        const width = 60;
        const height = 24;
        const strokeColor = type === 'positive' ? 'var(--success)' : 
                           type === 'negative' ? 'var(--error)' : 'var(--brand-red)';
        const fillColor = type === 'positive' ? 'var(--success)' : 
                         type === 'negative' ? 'var(--error)' : 'var(--brand-red)';
        
        const path = this.generatePath(data, width, height);
        const areaPath = this.generateAreaPath(data, width, height);
        
        container.innerHTML = `
            <svg class="sparkline sparkline-${type}" viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
                <path class="sparkline-area" d="${areaPath}" fill="${fillColor}" opacity="0.15"></path>
                <path class="sparkline-path" d="${path}" stroke="${strokeColor}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
        `;
    },

    /**
     * Generate sample data for demo/testing
     */
    generateSampleData(points = 10, trend = 'random') {
        const data = [];
        let value = 50;
        
        for (let i = 0; i < points; i++) {
            if (trend === 'up') {
                value += Math.random() * 10 - 2;
            } else if (trend === 'down') {
                value -= Math.random() * 10 - 2;
            } else {
                value += Math.random() * 20 - 10;
            }
            value = Math.max(0, Math.min(100, value));
            data.push(value);
        }
        
        return data;
    }
};

/**
 * Circular Progress Ring
 * Replaces traditional progress bars with SVG rings
 */
const ProgressRings = {
    /**
     * Render circular progress ring
     * @param {string} containerId - Target container ID
     * @param {number} percent - 0-100
     * @param {string} label - Center label text
     * @param {number} size - Ring size in pixels
     * @param {number} strokeWidth - Stroke width
     */
    render(containerId, percent, label = '', size = 48, strokeWidth = 4) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percent / 100) * circumference;
        
        // Color based on percentage
        let color = 'var(--brand-red)';
        if (percent >= 80) color = 'var(--success)';
        else if (percent >= 50) color = 'var(--warning)';
        
        container.innerHTML = `
            <div class="progress-ring" style="width: ${size}px; height: ${size}px;">
                <svg width="${size}" height="${size}">
                    <circle class="progress-ring-bg" 
                            cx="${size/2}" cy="${size/2}" r="${radius}" 
                            fill="none" stroke-width="${strokeWidth}"></circle>
                    <circle class="progress-ring-circle" 
                            cx="${size/2}" cy="${size/2}" r="${radius}" 
                            fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                            stroke-dasharray="${circumference}" 
                            stroke-dashoffset="${offset}"></circle>
                </svg>
                ${label ? `<span class="progress-ring-value">${label}</span>` : ''}
            </div>
        `;
    },

    /**
     * Render multiple rings for stats display
     */
    renderStats(containerId, stats) {
        const container = document.getElementById(containerId);
        if (!container || !stats) return;
        
        const html = stats.map(stat => {
            const size = 40;
            const strokeWidth = 3;
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (stat.percent / 100) * circumference;
            
            let color = 'var(--brand-red)';
            if (stat.percent >= 80) color = 'var(--success)';
            else if (stat.percent >= 50) color = 'var(--warning)';
            
            return `
                <div class="stat-ring-item" style="text-align: center;">
                    <div class="progress-ring" style="width: ${size}px; height: ${size}px; margin: 0 auto;">
                        <svg width="${size}" height="${size}">
                            <circle class="progress-ring-bg" 
                                    cx="${size/2}" cy="${size/2}" r="${radius}" 
                                    fill="none" stroke-width="${strokeWidth}"></circle>
                            <circle class="progress-ring-circle" 
                                    cx="${size/2}" cy="${size/2}" r="${radius}" 
                                    fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                                    stroke-dasharray="${circumference}" 
                                    stroke-dashoffset="${offset}"></circle>
                        </svg>
                        <span class="progress-ring-value" style="font-size: 11px;">${stat.value}</span>
                    </div>
                    <div class="progress-ring-label">${stat.label}</div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = `<div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">${html}</div>`;
    }
};

/**
 * Mini Heatmap Generator
 * For activity patterns visualization
 */
const MiniHeatmap = {
    /**
     * Generate activity heatmap
     * @param {string} containerId - Target container ID
     * @param {number[]} data - Array of intensity values (0-5)
     * @param {string} type - 'week' | 'day' | 'hour'
     */
    render(containerId, data, type = 'week') {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        let cols = 7;
        let rows = 1;
        
        if (type === 'day') {
            cols = 24;
            rows = 1;
        } else if (type === 'hour') {
            cols = 12;
            rows = 1;
        }
        
        const cells = data.map((level, index) => {
            const levelClass = `level-${Math.min(5, Math.max(0, level))}`;
            return `<div class="heatmap-cell ${levelClass}" title="Activity level: ${level}"></div>`;
        }).join('');
        
        container.innerHTML = `
            <div class="mini-heatmap" style="grid-template-columns: repeat(${cols}, 1fr);">
                ${cells}
            </div>
        `;
    },

    /**
     * Generate sample activity data
     */
    generateSampleData(count = 28) {
        return Array.from({ length: count }, () => Math.floor(Math.random() * 6));
    },

    /**
     * Render week-based activity heatmap with day labels
     */
    renderWeekHeatmap(containerId, weekData) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const cells = weekData.map((level, index) => {
            const dayName = days[index % 7];
            const levelClass = `level-${Math.min(5, Math.max(0, level))}`;
            return `
                <div style="text-align: center;">
                    <div class="heatmap-cell ${levelClass}" title="${dayName}: Activity level ${level}"></div>
                    <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">${dayName}</div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = `<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">${cells}</div>`;
    }
};

/**
 * Enhanced Quick Stats Widget
 * Combines sparklines, progress rings, and heatmaps
 */
const QuickStatsEnhanced = {
    /**
     * Initialize enhanced stats display
     */
    init() {
        this.renderSparklines();
        this.renderProgressRings();
        this.renderActivityHeatmap();
    },

    /**
     * Render sparklines for stats
     */
    renderSparklines() {
        // Sample data - in production, this would come from actual activity history
        const taskTrend = Sparklines.generateSampleData(10, 'up');
        const messageTrend = Sparklines.generateSampleData(10, 'random');
        
        // Find or create sparkline containers
        const statItems = document.querySelectorAll('.stat-item');
        statItems.forEach((item, index) => {
            // Add sparkline after the value
            const valueEl = item.querySelector('.stat-value');
            if (valueEl && !item.querySelector('.sparkline')) {
                const sparklineId = `sparkline-stat-${index}`;
                const sparklineContainer = document.createElement('div');
                sparklineContainer.id = sparklineContainer;
                sparklineContainer.className = 'sparkline';
                sparklineContainer.style.cssText = 'width: 40px; height: 16px; margin-top: 4px;';
                
                // Insert after label
                const labelEl = item.querySelector('.stat-label');
                if (labelEl) {
                    labelEl.after(sparklineContainer);
                }
                
                // Render sparkline
                const type = index % 2 === 0 ? 'positive' : 'neutral';
                const data = index % 2 === 0 ? taskTrend : messageTrend;
                Sparklines.render(sparklineContainer, data, type);
            }
        });
    },

    /**
     * Render circular progress rings for completion stats
     */
    renderProgressRings() {
        // Look for task completion containers
        const taskBoard = document.querySelector('.bento-task-board');
        if (taskBoard && !taskBoard.querySelector('.progress-ring')) {
            const header = taskBoard.querySelector('.bento-widget-header');
            if (header) {
                const ringContainer = document.createElement('div');
                ringContainer.id = 'task-completion-ring';
                ringContainer.style.cssText = 'margin-left: auto;';
                
                const actions = header.querySelector('.bento-widget-actions');
                if (actions) {
                    actions.before(ringContainer);
                    
                    // Calculate completion percentage
                    const todo = state.tasks?.todo?.length || 0;
                    const progress = state.tasks?.progress?.length || 0;
                    const done = state.tasks?.done?.length || 0;
                    const total = todo + progress + done;
                    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                    
                    ProgressRings.render('task-completion-ring', percent, `${percent}%`, 36, 3);
                }
            }
        }
    },

    /**
     * Render activity heatmap
     */
    renderActivityHeatmap() {
        const activityWidget = document.querySelector('.bento-activity');
        if (activityWidget && !activityWidget.querySelector('.mini-heatmap')) {
            const content = activityWidget.querySelector('.bento-widget-content');
            if (content) {
                const heatmapContainer = document.createElement('div');
                heatmapContainer.id = 'activity-heatmap-mini';
                heatmapContainer.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);';
                heatmapContainer.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Activity Pattern (Last 7 Days)</div>';
                
                const heatmapGrid = document.createElement('div');
                heatmapGrid.id = 'activity-heatmap-grid';
                heatmapContainer.appendChild(heatmapGrid);
                
                content.appendChild(heatmapContainer);
                
                // Generate and render sample activity data
                const activityData = MiniHeatmap.generateSampleData(7);
                MiniHeatmap.renderWeekHeatmap('activity-heatmap-grid', activityData);
            }
        }
    },

    /**
     * Update all enhanced stats
     */
    update() {
        this.renderProgressRings();
    }
};

/**
 * Widget Animation Controller
 * Handles fade-in and stagger animations
 */
const WidgetAnimations = {
    /**
     * Apply fade-in animation to widgets
     */
    fadeInWidgets() {
        const widgets = document.querySelectorAll('.bento-widget');
        widgets.forEach((widget, index) => {
            widget.style.opacity = '0';
            widget.style.transform = 'translateY(10px)';
            widget.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            
            setTimeout(() => {
                widget.style.opacity = '1';
                widget.style.transform = 'translateY(0)';
            }, index * 50);
        });
    },

    /**
     * Apply hover lift effect
     */
    setupHoverEffects() {
        document.querySelectorAll('.bento-widget').forEach(widget => {
            widget.addEventListener('mouseenter', () => {
                widget.style.transform = 'translateY(-3px)';
            });
            widget.addEventListener('mouseleave', () => {
                widget.style.transform = 'translateY(0)';
            });
        });
    }
};

// Initialize Phase 1 features when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for dashboard to be rendered
    setTimeout(() => {
        QuickStatsEnhanced.init();
        WidgetAnimations.fadeInWidgets();
        WidgetAnimations.setupHoverEffects();
    }, 500);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Sparklines, ProgressRings, MiniHeatmap, QuickStatsEnhanced, WidgetAnimations };
}

// === agents.js ===
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

// Note: timeAgo is now in utils.js - using centralized version

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

// === channels.js ===
// js/channels.js — Channel Status & Health widget

let channelStatusInterval = null;

function initChannelStatus() {
    loadChannelStatuses();
    if (channelStatusInterval) clearInterval(channelStatusInterval);
    channelStatusInterval = setInterval(loadChannelStatuses, 30000);
}

async function loadChannelStatuses() {
    const container = document.getElementById('channel-status-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                </svg>
                <div class="empty-state-title">No Channel Data</div>
                <div class="empty-state-desc">Connect to gateway to view active channels</div>
            </div>
        `;
        return;
    }

    try {
        const result = await gateway._request('channels.status', {});
        renderChannelStatuses(result?.channels || result || []);
    } catch (e) {
        // Fallback: show known channels as unknown
        renderChannelStatuses([
            { name: 'WhatsApp', status: 'unknown' },
            { name: 'Telegram', status: 'unknown' },
            { name: 'Discord', status: 'unknown' },
            { name: 'Signal', status: 'unknown' },
            { name: 'Webchat', status: 'connected' }
        ]);
    }
}

function renderChannelStatuses(channels) {
    const container = document.getElementById('channel-status-list');
    if (!container) return;

    const icons = {
        whatsapp: '📱', telegram: '✈️', discord: '🎮', signal: '🔒',
        webchat: '💬', email: '📧', sms: '📲'
    };

    // If it's an object with channel names as keys
    let channelList = Array.isArray(channels) ? channels : Object.entries(channels).map(([name, data]) => ({
        name, ...(typeof data === 'object' ? data : { status: data })
    }));

    if (channelList.length === 0) {
        channelList = [
            { name: 'WhatsApp', status: 'unknown' },
            { name: 'Telegram', status: 'unknown' },
            { name: 'Discord', status: 'unknown' },
            { name: 'Signal', status: 'unknown' },
            { name: 'Webchat', status: 'connected' }
        ];
    }

    container.innerHTML = channelList.map(ch => {
        const name = ch.name || ch.channel || 'Unknown';
        const status = (ch.status || ch.state || 'unknown').toLowerCase();
        const icon = icons[name.toLowerCase()] || '📡';
        const dotClass = status === 'connected' || status === 'online' || status === 'ready' ? 'success'
            : status === 'error' || status === 'disconnected' || status === 'failed' ? 'error'
            : 'warning';
        const lastMsg = ch.lastMessageAt ? timeAgo(new Date(ch.lastMessageAt).getTime()) : '';

        return `
        <div class="channel-status-row">
            <span style="font-size: 16px;">${icon}</span>
            <div style="flex: 1; min-width: 0;">
                <span style="font-weight: 500; font-size: 13px;">${escapeHtml(name)}</span>
                ${lastMsg ? `<span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">${lastMsg}</span>` : ''}
            </div>
            <span class="status-dot ${dotClass}"></span>
        </div>`;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initChannelStatus, 2500);
});

// === costs.js ===
// js/costs.js — Cost & Usage Tracker widget

let costsInterval = null;

function initCostTracker() {
    loadCostData();
    if (costsInterval) clearInterval(costsInterval);
    costsInterval = setInterval(loadCostData, 60000);
}

async function loadCostData() {
    const container = document.getElementById('cost-tracker-content');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div class="empty-state-title">No Cost Data</div>
                <div class="empty-state-desc">Connect to gateway to view usage & costs</div>
            </div>
        `;
        return;
    }

    try {
        const result = await gateway._request('sessions.list', { includeGlobal: true });
        const sessions = result?.sessions || [];

        // Also try to get status for model info
        let statusInfo = null;
        try {
            statusInfo = await gateway._request('status', {});
        } catch (e) { /* optional */ }

        renderCostData(sessions, statusInfo);
    } catch (e) {
        console.warn('[Costs] Failed:', e.message);
    }
}

function renderCostData(sessions, statusInfo) {
    const container = document.getElementById('cost-tracker-content');
    if (!container) return;

    // Aggregate tokens by agent
    const agentTokens = {};
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const s of sessions) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? (window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1]) : 'main';
        if (!agentTokens[agentId]) agentTokens[agentId] = { input: 0, output: 0, total: 0 };

        const input = s.inputTokens || 0;
        const output = s.outputTokens || 0;
        const total = s.totalTokens || (input + output);

        agentTokens[agentId].input += input;
        agentTokens[agentId].output += output;
        agentTokens[agentId].total += total;
        totalTokens += total;
        totalInput += input;
        totalOutput += output;
    }

    // Rough cost estimate ($3/1M input, $15/1M output for Claude)
    const estCost = ((totalInput * 3 + totalOutput * 15) / 1000000).toFixed(2);

    const sorted = Object.entries(agentTokens).sort((a, b) => b[1].total - a[1].total);
    const maxTokens = sorted.length > 0 ? sorted[0][1].total : 1;

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
            <div>
                <span style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${formatTokens(totalTokens)}</span>
                <span style="font-size: 11px; color: var(--text-muted);"> tokens</span>
            </div>
            <div style="text-align: right;">
                <span style="font-size: 16px; font-weight: 600; color: var(--success);">~$${estCost}</span>
                <div style="font-size: 10px; color: var(--text-muted);">est. cost</div>
            </div>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 10px; font-size: 11px; color: var(--text-muted);">
            <span>↗ In: ${formatTokens(totalInput)}</span>
            <span>↙ Out: ${formatTokens(totalOutput)}</span>
            <span>📊 ${sessions.length} sessions</span>
        </div>
        <div style="space-y: 4px;">
            ${sorted.slice(0, 6).map(([id, data]) => {
        const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${id}`).trim() || '#888';
        const pct = maxTokens > 0 ? (data.total / maxTokens * 100) : 0;
        const label = (typeof getAgentLabel === 'function') ? getAgentLabel(id) : id.toUpperCase();
        return `
                <div style="margin-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                        <span style="color: ${color}; font-weight: 600;">${label}</span>
                        <span style="color: var(--text-muted);">${formatTokens(data.total)}</span>
                    </div>
                    <div style="height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden;">
                        <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 2px;"></div>
                    </div>
                </div>`;
    }).join('')}
        </div>
    `;
}

function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCostTracker, 3000);
});

// === analytics.js ===
// js/analytics.js — Session Analytics widget

let analyticsInterval = null;

function initAnalytics() {
    loadAnalyticsData();
    if (analyticsInterval) clearInterval(analyticsInterval);
    analyticsInterval = setInterval(loadAnalyticsData, 60000);
}

async function loadAnalyticsData() {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                </svg>
                <div class="empty-state-title">No Analytics Data</div>
                <div class="empty-state-desc">Connect to gateway to view session analytics</div>
            </div>
        `;
        return;
    }

    try {
        const result = await gateway._request('sessions.list', { includeGlobal: true });
        const sessions = result?.sessions || [];
        renderAnalytics(sessions);
    } catch (e) {
        console.warn('[Analytics] Failed:', e.message);
    }
}

function renderAnalytics(sessions) {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    // Messages per agent (channel breakdown)
    const agentMessages = {};
    const dayBuckets = {};
    const now = Date.now();

    for (const s of sessions) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? (window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1]) : 'main';
        const tokens = s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0);
        if (!agentMessages[agentId]) agentMessages[agentId] = 0;
        agentMessages[agentId] += tokens > 0 ? 1 : 0;

        // Bucket by day (last 7 days)
        if (s.updatedAt) {
            const d = new Date(s.updatedAt);
            const dayKey = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayMs = d.getTime();
            if (now - dayMs < 7 * 86400000) {
                if (!dayBuckets[dayKey]) dayBuckets[dayKey] = 0;
                dayBuckets[dayKey]++;
            }
        }
    }

    // Most active sessions
    const activeSessions = [...sessions]
        .filter(s => s.updatedAt)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5);

    const maxAgent = Math.max(...Object.values(agentMessages), 1);
    const maxDay = Math.max(...Object.values(dayBuckets), 1);

    container.innerHTML = `
        <div style="margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Sessions by Agent</div>
            ${Object.entries(agentMessages).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => {
        const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${id}`).trim() || '#888';
        const pct = (count / maxAgent * 100);
        return `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                    <span style="width: 40px; font-size: 10px; color: ${color}; font-weight: 600; text-align: right;">${id.toUpperCase()}</span>
                    <div style="flex: 1; height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 3px;"></div>
                    </div>
                    <span style="width: 24px; font-size: 10px; color: var(--text-muted);">${count}</span>
                </div>`;
    }).join('')}
        </div>
        <div style="margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Activity (7 days)</div>
            <div style="display: flex; align-items: flex-end; gap: 4px; height: 40px;">
                ${Object.entries(dayBuckets).slice(-7).map(([day, count]) => {
        const h = Math.max(4, (count / maxDay) * 36);
        return `<div style="flex: 1; text-align: center;">
                        <div style="height: ${h}px; background: var(--brand-red); border-radius: 2px; margin: 0 auto; width: 80%;"></div>
                        <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">${day}</div>
                    </div>`;
    }).join('')}
            </div>
        </div>
        <div>
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Most Active</div>
            ${activeSessions.map(s => {
        const name = s.displayName || s.key?.replace(/^agent:[^:]+:/, '') || 'unnamed';
        const ago = s.updatedAt ? timeAgo(new Date(s.updatedAt).getTime()) : '';
        return `<div style="font-size: 11px; padding: 2px 0; display: flex; justify-content: space-between;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</span>
                    <span style="color: var(--text-muted); flex-shrink: 0; margin-left: 8px;">${ago}</span>
                </div>`;
    }).join('')}
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAnalytics, 3500);
});

// === focus-timer.js ===
// js/focus-timer.js — Focus timer functionality

// ===================
// FOCUS TIMER
// ===================

let focusTimer = {
    running: false,
    isBreak: false,
    timeLeft: 25 * 60, // 25 minutes in seconds
    interval: null,
    sessions: parseInt(localStorage.getItem('focusSessions') || '0'),
    workDuration: 25 * 60,
    breakDuration: 5 * 60,
    sessionStart: null
};

function toggleFocusTimer() {
    if (focusTimer.running) {
        pauseFocusTimer();
    } else {
        startFocusTimer();
    }
}

function startFocusTimer() {
    focusTimer.running = true;
    focusTimer.sessionStart = Date.now();
    updateFocusTimerUI();
    
    focusTimer.interval = setInterval(() => {
        focusTimer.timeLeft--;
        updateFocusTimerDisplay();
        
        if (focusTimer.timeLeft <= 0) {
            completeFocusSession();
        }
    }, 1000);
    
    showToast(focusTimer.isBreak ? '☕ Break started!' : '🎯 Focus session started!', 'success', 2000);
}

function pauseFocusTimer() {
    focusTimer.running = false;
    clearInterval(focusTimer.interval);
    updateFocusTimerUI();
    showToast('⏸️ Timer paused', 'info', 1500);
}

function resetFocusTimer() {
    focusTimer.running = false;
    focusTimer.isBreak = false;
    clearInterval(focusTimer.interval);
    focusTimer.timeLeft = focusTimer.workDuration;
    updateFocusTimerUI();
    updateFocusTimerDisplay();
    showToast('🔄 Timer reset', 'info', 1500);
}

function completeFocusSession() {
    clearInterval(focusTimer.interval);
    focusTimer.running = false;
    
    if (!focusTimer.isBreak) {
        // Completed a work session
        focusTimer.sessions++;
        localStorage.setItem('focusSessions', focusTimer.sessions.toString());
        localStorage.setItem('focusSessionsDate', new Date().toDateString());
        updateQuickStats();
        
        // Play notification sound (if available)
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2telehn2d7DYv49iHxtfns/hoGwaCEGWz9+1aTIOO4nK2sBxIg0zdsXN0HgsEjFnusbRgjQXKVmrxNKTPSkfSJ28zZpDKhhAd6/J0p9JLRlAd6/J0p9JLRlAd6/K0p9JLRlAd6/K0p9JLRk/dq/K0p9JLRk/dq/K0aBKLRk/dq/K0aBKLRk=');
            audio.volume = 0.3;
            audio.play().catch(() => {});
        } catch (e) {}
        
        showToast(`🎉 Focus session complete! (${focusTimer.sessions} today)`, 'success', 3000);
        
        // Start break
        focusTimer.isBreak = true;
        focusTimer.timeLeft = focusTimer.breakDuration;
    } else {
        // Completed a break
        showToast('☕ Break over! Ready for another focus session?', 'info', 3000);
        focusTimer.isBreak = false;
        focusTimer.timeLeft = focusTimer.workDuration;
    }
    
    updateFocusTimerUI();
    updateFocusTimerDisplay();
}

function updateFocusTimerUI() {
    const timer = document.getElementById('focus-timer');
    const playIcon = document.getElementById('focus-play-icon');
    const pauseIcon = document.getElementById('focus-pause-icon');
    const sessionsEl = document.getElementById('focus-sessions');
    
    if (!timer) return;
    
    timer.classList.remove('active', 'break');
    if (focusTimer.running) {
        timer.classList.add(focusTimer.isBreak ? 'break' : 'active');
    }
    
    if (playIcon && pauseIcon) {
        playIcon.style.display = focusTimer.running ? 'none' : 'block';
        pauseIcon.style.display = focusTimer.running ? 'block' : 'none';
    }
    
    if (sessionsEl) {
        sessionsEl.textContent = `${focusTimer.sessions} 🎯`;
    }
}

function updateFocusTimerDisplay() {
    const display = document.getElementById('focus-timer-display');
    if (!display) return;
    
    const minutes = Math.floor(focusTimer.timeLeft / 60);
    const seconds = focusTimer.timeLeft % 60;
    display.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Check if we need to reset sessions (new day)
function checkFocusSessionsReset() {
    const lastDate = localStorage.getItem('focusSessionsDate');
    const today = new Date().toDateString();
    if (lastDate !== today) {
        focusTimer.sessions = 0;
        localStorage.setItem('focusSessions', '0');
        localStorage.setItem('focusSessionsDate', today);
    }
}



// === keyboard.js ===
// js/keyboard.js — Keyboard shortcuts & command palette

// ===================
// KEYBOARD SHORTCUTS ENHANCEMENT
// ===================

function showShortcutsModal() {
    showModal('shortcuts-modal');
}

// Expose functions globally
window.toggleFocusTimer = toggleFocusTimer;
window.resetFocusTimer = resetFocusTimer;
window.showShortcutsModal = showShortcutsModal;

// Initialize focus timer and stats on load
document.addEventListener('DOMContentLoaded', () => {
    checkFocusSessionsReset();
    updateFocusTimerUI();
    updateFocusTimerDisplay();
    updateQuickStats();
});

// Session-scoped localStorage key for chat messages

// ===================
// KEYBOARD SHORTCUTS & COMMAND PALETTE
// ===================

// Command palette state
let commandPaletteOpen = false;
let commandPaletteSelectedIndex = 0;

// Command definitions
const commands = [
    { id: 'chat', icon: '💬', title: 'Go to Chat', desc: 'Open chat page', shortcut: 'C', action: () => showPage('chat') },
    { id: 'system', icon: '🔧', title: 'System Messages', desc: 'View system/debug messages', shortcut: 'S', action: () => showPage('system') },
    { id: 'health', icon: '🏥', title: 'Model Health', desc: 'Check model status', shortcut: 'H', action: () => showPage('health') },
    { id: 'settings', icon: '⚙️', title: 'Settings', desc: 'Open settings modal', shortcut: ',', action: () => openSettingsModal() },
    { id: 'theme', icon: '🎨', title: 'Themes', desc: 'Open theme picker', shortcut: 'T', action: () => toggleTheme() },
    { id: 'new-session', icon: '➕', title: 'New Session', desc: 'Create a new chat session', shortcut: 'N', action: () => createNewSession() },
    { id: 'refresh', icon: '🔄', title: 'Refresh Sessions', desc: 'Reload session list', shortcut: 'R', action: () => fetchSessions() },
    { id: 'focus-chat', icon: '⌨️', title: 'Focus Chat Input', desc: 'Jump to chat input', shortcut: '/', action: () => focusChatInput() },
];

// Initialize command palette HTML
function initCommandPalette() {
    // Check if already initialized
    if (document.getElementById('command-palette')) return;
    
    const backdrop = document.createElement('div');
    backdrop.id = 'command-palette-backdrop';
    backdrop.className = 'command-palette-backdrop';
    backdrop.onclick = closeCommandPalette;
    
    const palette = document.createElement('div');
    palette.id = 'command-palette';
    palette.className = 'command-palette';
    palette.innerHTML = `
        <input type="text" class="command-palette-input" placeholder="Type a command... (↑↓ to navigate, Enter to select)" id="command-palette-input">
        <div class="command-palette-results" id="command-palette-results"></div>
    `;
    
    document.body.appendChild(backdrop);
    document.body.appendChild(palette);
    
    // Setup input handler
    const input = document.getElementById('command-palette-input');
    input.addEventListener('input', (e) => filterCommands(e.target.value));
    input.addEventListener('keydown', handlePaletteKeydown);
    
    renderCommands(commands);
}

function renderCommands(cmds) {
    const container = document.getElementById('command-palette-results');
    if (!container) return;
    
    container.innerHTML = cmds.map((cmd, idx) => `
        <div class="command-palette-item${idx === commandPaletteSelectedIndex ? ' selected' : ''}" 
             data-index="${idx}" 
             onclick="executeCommand('${cmd.id}')">
            <span class="command-palette-item-icon">${cmd.icon}</span>
            <div class="command-palette-item-text">
                <div class="command-palette-item-title">${cmd.title}</div>
                <div class="command-palette-item-desc">${cmd.desc}</div>
            </div>
            ${cmd.shortcut ? `<span class="command-palette-shortcut">${cmd.shortcut}</span>` : ''}
        </div>
    `).join('');
}

function filterCommands(query) {
    const q = query.toLowerCase().trim();
    let filtered = commands;
    
    if (q) {
        filtered = commands.filter(cmd => 
            cmd.title.toLowerCase().includes(q) || 
            cmd.desc.toLowerCase().includes(q) ||
            cmd.id.toLowerCase().includes(q)
        );
    }
    
    commandPaletteSelectedIndex = 0;
    renderCommands(filtered);
}

function handlePaletteKeydown(e) {
    const results = document.querySelectorAll('.command-palette-item');
    const maxIndex = results.length - 1;
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            commandPaletteSelectedIndex = Math.min(commandPaletteSelectedIndex + 1, maxIndex);
            updatePaletteSelection();
            break;
        case 'ArrowUp':
            e.preventDefault();
            commandPaletteSelectedIndex = Math.max(commandPaletteSelectedIndex - 1, 0);
            updatePaletteSelection();
            break;
        case 'Enter':
            e.preventDefault();
            const selectedItem = results[commandPaletteSelectedIndex];
            if (selectedItem) {
                const idx = parseInt(selectedItem.dataset.index);
                const filtered = getFilteredCommands();
                if (filtered[idx]) {
                    executeCommand(filtered[idx].id);
                }
            }
            break;
        case 'Escape':
            closeCommandPalette();
            break;
    }
}

function getFilteredCommands() {
    const input = document.getElementById('command-palette-input');
    const q = (input?.value || '').toLowerCase().trim();
    if (!q) return commands;
    return commands.filter(cmd => 
        cmd.title.toLowerCase().includes(q) || 
        cmd.desc.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q)
    );
}

function updatePaletteSelection() {
    const items = document.querySelectorAll('.command-palette-item');
    items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === commandPaletteSelectedIndex);
        if (idx === commandPaletteSelectedIndex) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

window.executeCommand = function(id) {
    const cmd = commands.find(c => c.id === id);
    if (cmd) {
        closeCommandPalette();
        cmd.action();
    }
};

function openCommandPalette() {
    initCommandPalette();
    commandPaletteOpen = true;
    commandPaletteSelectedIndex = 0;
    
    const backdrop = document.getElementById('command-palette-backdrop');
    const palette = document.getElementById('command-palette');
    const input = document.getElementById('command-palette-input');
    
    if (backdrop) backdrop.classList.add('visible');
    if (palette) palette.classList.add('visible');
    if (input) {
        input.value = '';
        input.focus();
    }
    
    renderCommands(commands);
}

function closeCommandPalette() {
    commandPaletteOpen = false;
    
    const backdrop = document.getElementById('command-palette-backdrop');
    const palette = document.getElementById('command-palette');
    
    if (backdrop) backdrop.classList.remove('visible');
    if (palette) palette.classList.remove('visible');
}

function focusChatInput() {
    // Navigate to chat page first
    showPage('chat');
    
    // Focus the input after a short delay to allow page transition
    setTimeout(() => {
        const input = document.getElementById('chat-page-input');
        if (input) input.focus();
    }, 100);
}

function createNewSession() {
    // Generate a unique session name
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const newKey = `session-${timestamp}`;
    
    if (typeof switchToSession === 'function') {
        switchToSession(newKey);
        showToast(`Created new session: ${newKey}`, 'success');
    } else {
        showToast('Session creation not available', 'warning');
    }
}

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs (except specific ones)
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    
    // Command palette: Cmd/Ctrl + Shift + K
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        if (commandPaletteOpen) {
            closeCommandPalette();
        } else {
            openCommandPalette();
        }
        return;
    }
    
    // Escape: Close modals/palettes
    if (e.key === 'Escape') {
        if (commandPaletteOpen) {
            closeCommandPalette();
            return;
        }
        // Close any open modal
        const visibleModal = document.querySelector('.modal-overlay.visible');
        if (visibleModal) {
            visibleModal.classList.remove('visible');
            return;
        }
    }
    
    // Don't process other shortcuts if in input
    if (isInput) return;
    
    // Quick navigation (single key shortcuts - only when not typing)
    switch (e.key.toLowerCase()) {
        case 'c':
            showPage('chat');
            break;
        case 's':
            if (e.shiftKey) {
                // Shift+S: Sync tasks
                syncFromVPS();
            } else {
                showPage('system');
            }
            break;
        case 'h':
            showPage('health');
            break;
        case 'd':
            showPage('dashboard');
            break;
        case 'p':
            showPage('products');
            break;
        case 't':
            toggleTheme();
            break;
        case 'f':
            if (e.shiftKey) {
                // Shift+F: Reset focus timer
                resetFocusTimer();
            } else {
                // F: Toggle focus timer
                toggleFocusTimer();
            }
            break;
        case 'n':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                createNewSession();
            } else {
                // N: New task
                openAddTask('todo');
            }
            break;
        case '/':
            e.preventDefault();
            focusChatInput();
            break;
        case '?':
            e.preventDefault();
            showModal('shortcuts-modal');
            break;
        case ',':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                openSettingsModal();
            }
            break;
    }
    
    // Number keys 1-9: Switch to session by index
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const sessionIndex = parseInt(e.key) - 1;
        const agentSessions = filterSessionsForAgent(availableSessions, currentAgentId);
        if (agentSessions[sessionIndex]) {
            switchToSession(agentSessions[sessionIndex].key);
            showToast(`Switched to session ${e.key}`, 'success', 1500);
        }
    }
});

// Initialize command palette on page load
document.addEventListener('DOMContentLoaded', () => {
    initCommandPalette();
});



// === memory.js ===
// js/memory.js — Memory file functions

// ===================
// MEMORY FILE FUNCTIONS
// ===================

// Current file being edited
let currentMemoryFile = null;

// View a memory file in the modal
if (typeof window.viewMemoryFile !== 'function') window.viewMemoryFile = async function(filePath) {
    const titleEl = document.getElementById('memory-file-title');
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!titleEl || !contentEl) return;
    
    // Show loading state
    titleEl.textContent = filePath;
    contentEl.value = 'Loading...';
    contentEl.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    
    currentMemoryFile = filePath;
    showModal('memory-file-modal');
    
    try {
        // Fetch file content from API
        const response = await fetch(`/api/memory/${encodeURIComponent(filePath)}`);
        const data = await response.json();
        
        if (data.error) {
            contentEl.value = `Error: ${data.error}`;
            return;
        }
        
        contentEl.value = data.content || '';
        contentEl.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
        
        // Show bot-update badge and acknowledge button if applicable
        if (data.botUpdated && !data.acknowledged) {
            titleEl.innerHTML = `
                ${escapeHtml(data.name)}
                <span class="badge badge-warning" style="margin-left: 8px;">🤖 Updated by SoLoBot</span>
                <button onclick="this.style.color='var(--text-muted)'; this.textContent='✓ Read'; this.disabled=true; window.acknowledgeUpdate && window.acknowledgeUpdate('${escapeHtml(filePath)}')" 
                        class="btn btn-ghost" style="margin-left: 8px; font-size: 12px; color: var(--error);">
                    ✓ Mark as Read
                </button>
            `;
        } else {
            titleEl.textContent = data.name;
        }
        
        // Load version history (function from docs-hub-memory-files.js)
        if (typeof window.loadVersionHistory === 'function') {
            window.loadVersionHistory(filePath);
        }
        
    } catch (error) {
        console.error('Error loading memory file:', error);
        contentEl.value = `Error loading file: ${error.message}`;
    }
};

// Save memory file changes
if (typeof window.saveMemoryFile !== 'function') window.saveMemoryFile = async function() {
    if (!currentMemoryFile) return;
    
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!contentEl) return;
    
    const content = contentEl.value;
    
    // Show saving state
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(currentMemoryFile)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            // Success feedback
            if (saveBtn) {
                saveBtn.textContent = '✓ Saved!';
                setTimeout(() => {
                    saveBtn.textContent = 'Save';
                    saveBtn.disabled = false;
                }, 1500);
            }
            // Refresh the memory files list
            if (typeof renderMemoryFilesForPage === 'function') {
                renderMemoryFilesForPage('');
            }
        } else {
            throw new Error(data.error || 'Save failed');
        }
        
    } catch (error) {
        console.error('Error saving memory file:', error);
        showToast(`Failed to save: ${error.message}`, 'error');
        if (saveBtn) {
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        }
    }
};

// Close memory modal
if (typeof window.closeMemoryModal !== 'function') window.closeMemoryModal = function() {
    currentMemoryFile = null;
    hideModal('memory-file-modal');
};



// === memory-browser.js ===
// js/memory-browser.js — Enhanced Memory Browser

let memoryTree = [];
let memorySearchResults = [];

function initMemoryBrowser() {
    loadMemoryTree();
}

async function loadMemoryTree() {
    const treeContainer = document.getElementById('memory-tree');
    if (!treeContainer) return;

    treeContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Loading...</div>';

    // Try gateway RPC for filesystem listing
    if (gateway && gateway.isConnected()) {
        try {
            const result = await gateway._request('memory.list', { recursive: true });
            memoryTree = result?.files || result || [];
            renderMemoryTree(memoryTree);
            return;
        } catch (e) {
            console.warn('[Memory] Gateway memory.list not available:', e.message);
        }
    }

    // Fallback: use existing memory files from the page
    try {
        const files = typeof fetchMemoryFiles === 'function' ? await fetchMemoryFiles() : [];
        memoryTree = files;
        renderMemoryTree(files);
    } catch (e) {
        treeContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Could not load memory files</div>';
    }
}

function renderMemoryTree(files) {
    const container = document.getElementById('memory-tree');
    if (!container) return;

    if (!files || files.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">No files found</div>';
        return;
    }

    // Build tree from flat file list
    const tree = {};
    for (const f of files) {
        const filePath = f.path || f.name || '';
        const parts = filePath.split('/').filter(Boolean);
        let node = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                if (!node._files) node._files = [];
                node._files.push({ ...f, fileName: part });
            } else {
                if (!node[part]) node[part] = {};
                node = node[part];
            }
        }
        // If no path separators, add to root
        if (parts.length <= 1) {
            if (!tree._files) tree._files = [];
            if (!tree._files.find(x => x.fileName === (parts[0] || filePath))) {
                tree._files.push({ ...f, fileName: parts[0] || filePath });
            }
        }
    }

    container.innerHTML = renderTreeNode(tree, '');
}

function renderTreeNode(node, prefix) {
    let html = '';

    // Render subdirectories
    const dirs = Object.keys(node).filter(k => k !== '_files').sort();
    for (const dir of dirs) {
        const dirPath = prefix ? `${prefix}/${dir}` : dir;
        const fileCount = countFiles(node[dir]);
        html += `
        <div class="memory-tree-dir" onclick="toggleTreeDir(this)">
            <span class="tree-chevron">▶</span>
            <span style="font-size: 13px;">📁 ${escapeHtml(dir)}</span>
            <span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">(${fileCount})</span>
        </div>
        <div class="memory-tree-children hidden">
            ${renderTreeNode(node[dir], dirPath)}
        </div>`;
    }

    // Render files
    const files = node._files || [];
    for (const f of files.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''))) {
        const fp = f.path || f.name || f.fileName;
        html += `
        <div class="memory-tree-file" onclick="previewMemoryFile('${escapeHtml(fp)}')">
            <span style="font-size: 12px;">📄</span>
            <span style="font-size: 12px;">${escapeHtml(f.fileName || fp)}</span>
        </div>`;
    }

    return html;
}

function countFiles(node) {
    let count = (node._files || []).length;
    for (const k of Object.keys(node).filter(k => k !== '_files')) {
        count += countFiles(node[k]);
    }
    return count;
}

window.toggleTreeDir = function(el) {
    const children = el.nextElementSibling;
    if (!children) return;
    const chevron = el.querySelector('.tree-chevron');
    if (children.classList.contains('hidden')) {
        children.classList.remove('hidden');
        if (chevron) chevron.textContent = '▼';
    } else {
        children.classList.add('hidden');
        if (chevron) chevron.textContent = '▶';
    }
};

window.previewMemoryFile = async function(filePath) {
    const preview = document.getElementById('memory-file-preview');
    if (!preview) {
        // Fallback to existing viewer
        if (typeof viewMemoryFile === 'function') viewMemoryFile(filePath);
        return;
    }

    preview.innerHTML = '<div style="color: var(--text-muted); padding: 12px;">Loading...</div>';

    try {
        let content = '';
        if (gateway && gateway.isConnected()) {
            try {
                const result = await gateway._request('memory.read', { path: filePath });
                content = result?.content || result || '';
            } catch (e) {
                // Fallback to fetch
                const resp = await fetch(`/api/memory/file?path=${encodeURIComponent(filePath)}`);
                content = resp.ok ? await resp.text() : 'Could not load file';
            }
        } else {
            const resp = await fetch(`/api/memory/file?path=${encodeURIComponent(filePath)}`);
            content = resp.ok ? await resp.text() : 'Could not load file';
        }

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default);">
                <span style="font-weight: 600; font-size: 13px;">📄 ${escapeHtml(filePath)}</span>
                <div style="display: flex; gap: 4px;">
                    <button onclick="editMemoryFile('${escapeHtml(filePath)}')" class="btn btn-ghost" style="font-size: 11px; padding: 2px 8px;">Edit</button>
                </div>
            </div>
            <pre style="padding: 12px; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-word; overflow-y: auto; max-height: 500px; color: var(--text-primary);">${escapeHtml(typeof content === 'string' ? content : JSON.stringify(content, null, 2))}</pre>
        `;
    } catch (e) {
        preview.innerHTML = `<div style="color: var(--error); padding: 12px;">Error: ${e.message}</div>`;
    }
};

window.editMemoryFile = function(filePath) {
    if (typeof viewMemoryFile === 'function') {
        viewMemoryFile(filePath);
    }
};

window.searchMemoryFiles = async function() {
    const query = document.getElementById('memory-browser-search')?.value?.trim();
    if (!query) {
        renderMemoryTree(memoryTree);
        return;
    }

    const q = query.toLowerCase();
    const filtered = memoryTree.filter(f => {
        const name = (f.name || f.path || '').toLowerCase();
        const desc = (f.description || '').toLowerCase();
        return name.includes(q) || desc.includes(q);
    });

    renderMemoryTree(filtered);
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initMemoryBrowser, 1000);
});

// === models.js ===
// js/models.js — isSystemMessage, provider/model management

function isInternalControlMessage(text) {
    if (!text) return false;
    const trimmed = String(text).trim();
    const lowerTrimmed = trimmed.toLowerCase();

    if (/^(ack|heartbeat_ok|no_reply|no|reply_skip|announce_skip)$/i.test(trimmed)) return true;
    if (trimmed === '[read-sync]') return true;
    if (trimmed === '[[read_ack]]') return true;
    if (trimmed.startsWith('[[read_ack]]')) return true;
    if (/^\[read-sync\]\s*\n*\s*\[\[read_ack\]\]$/s.test(trimmed)) return true;
    if (lowerTrimmed.includes('agent-to-agent announce step')) return true;
    if (lowerTrimmed.includes('reply with a one-line ack')) return true;
    return false;
}

function isSystemMessage(text, from) {
    if (!text) return false;

    // These are protocol/control messages, never user-facing — even in debug mode.
    if (isInternalControlMessage(text)) return true;

    // DEBUG MODE: Show everything else in chat
    if (DISABLE_SYSTEM_FILTER) {
        return false; // Everything goes to chat
    }

    const trimmed = text.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    // Only mark as system if from='system' explicitly
    if (from === 'system') return true;

    // === TOOL OUTPUT FILTERING ===
    // Filter out obvious tool results that shouldn't appear in chat

    // JSON outputs (API responses, fetch results)
    if (trimmed.startsWith('{') && trimmed.includes('"')) return true;

    // Command outputs
    if (trimmed.startsWith('Successfully replaced text in')) return true;
    if (trimmed.startsWith('Successfully wrote')) return true;
    if (trimmed === '(no output)') return true;
    if (trimmed.startsWith('[main ') && trimmed.includes('file changed')) return true;
    if (trimmed.startsWith('To https://github.com')) return true;

    // Git/file operation outputs  
    if (/^\[main [a-f0-9]+\]/.test(trimmed)) return true;
    if (trimmed.startsWith('Exported ') && trimmed.includes(' activities')) return true;
    if (trimmed.startsWith('Posted ') && trimmed.includes(' activities')) return true;

    // Token/key outputs (security - never show these)
    if (/^ghp_[A-Za-z0-9]+$/.test(trimmed)) return true;
    if (/^sk_[A-Za-z0-9]+$/.test(trimmed)) return true;

    // File content dumps (markdown files being read)
    if (trimmed.startsWith('# ') && trimmed.length > 500) return true;

    // Grep/search output (line numbers with code)
    if (/^\d+:\s*(if|const|let|var|function|class|return|import|export)\s/.test(trimmed)) return true;
    if (/^\d+[-:].*\.(js|ts|py|md|json|html|css)/.test(trimmed)) return true;

    // Multiple line number prefixes (grep output)
    const lineNumberPattern = /^\d+:/;
    const lines = trimmed.split('\n');
    if (lines.length > 2 && lines.filter(l => lineNumberPattern.test(l.trim())).length > lines.length / 2) return true;

    // Code blocks with state/config references
    if (trimmed.includes('state.chat.messages') || trimmed.includes('GATEWAY_CONFIG')) return true;
    if (trimmed.includes('maxMessages:') && /\d+:/.test(trimmed)) return true;

    // === HEARTBEAT FILTERING ===

    // Exact heartbeat matches
    if (trimmed === 'HEARTBEAT_OK') return true;

    // === INTERNAL CONTROL MESSAGES ===
    // OpenClaw internal signals that should never appear in chat
    if (trimmed === 'NO_REPLY') return true;
    // Some surfaces truncate/simplify NO_REPLY to "NO"; treat as internal noise as well
    if (trimmed === 'NO') return true;
    if (trimmed === 'REPLY_SKIP') return true;
    if (trimmed === 'ANNOUNCE_SKIP') return true;
    if (trimmed.startsWith('Agent-to-agent announce')) return true;

    // Gateway-injected read-sync / read_ack messages (internal notification signals)
    if (trimmed === '[read-sync]') return true;
    if (trimmed === '[[read_ack]]') return true;
    if (trimmed.startsWith('[[read_ack]]')) return true;
    if (trimmed === '[read-sync]\n\n[[read_ack]]') return true;
    if (/^\[read-sync\]\s*\n*\s*\[\[read_ack\]\]$/s.test(trimmed)) return true;

    // System timestamped messages
    if (trimmed.startsWith('System: [')) return true;
    if (trimmed.startsWith('System:')) return true;
    if (/^System:\s*\[/i.test(trimmed)) return true;

    // HEARTBEAT messages (cron/scheduled)
    if (trimmed.includes('] HEARTBEAT:')) return true;
    if (trimmed.includes('] Cron:')) return true;
    if (trimmed.includes('] EMAIL CHECK:')) return true;

    // Heartbeat prompts
    if (trimmed.startsWith('Read HEARTBEAT.md if it exists')) return true;

    // Memory/housekeeping prompts injected by automation should not appear as user chat
    if (trimmed.startsWith('Write lasting notes to memory/')) return true;
    if (trimmed.includes('Reply with NO_REPLY if nothing durable.')) return true;
    if (trimmed.includes('Current time:') && trimmed.includes('America/Detroit')) return true;

    // Watchdog / automation chatter
    if (lowerTrimmed.includes('watchdog check')) return true;
    if (lowerTrimmed.includes('watchdog ping')) return true;
    if (lowerTrimmed.includes('agent-to-agent announce step')) return true;
    if (lowerTrimmed.includes('reply with a one-line ack')) return true;
    if (/^(ack|announce_skip|reply_skip)$/i.test(trimmed)) return true;

    // Short heartbeat patterns
    if (from === 'solobot' && trimmed.length < 200) {
        const exactStartPatterns = [
            'following heartbeat routine',
            'following the heartbeat routine',
            'checking current status via heartbeat',
        ];

        for (const pattern of exactStartPatterns) {
            if (lowerTrimmed.startsWith(pattern)) {
                return true;
            }
        }
    }

    // Don't filter anything else
    return false;
}

function normalizeGuardedModel(modelId) {
    const resolved = resolveFullModelId(modelId);
    if (!resolved) return { model: resolved, redirected: false };
    return { model: resolved, redirected: false };
}

// Provider and Model selection functions
window.changeProvider = function () {
    const providerSelect = document.getElementById('provider-select');
    if (!providerSelect) return;

    const selectedProvider = providerSelect.value;

    // Update display
    const providerNameEl = document.getElementById('provider-name');
    if (providerNameEl) providerNameEl.textContent = selectedProvider;

    // Update model dropdown for this provider
    updateModelDropdown(selectedProvider);
};

window.updateProviderDisplay = function () {
    const providerSelect = document.getElementById('provider-select');
    if (!providerSelect) return;

    const selectedProvider = providerSelect.value;

    // Update display (with null check)
    const providerNameEl = document.getElementById('provider-name');
    if (providerNameEl) providerNameEl.textContent = selectedProvider;

    // Update model dropdown for this provider
    updateModelDropdown(selectedProvider);
};

// Populate provider dropdown dynamically from API
async function populateProviderDropdown() {
    const selects = [
        document.getElementById('provider-select'),
        document.getElementById('setting-provider')
    ].filter(Boolean);

    if (selects.length === 0) {
        console.warn('[Dashboard] No provider-select elements found');
        return [];
    }

    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const allModels = await response.json();
        const providers = Object.keys(allModels);

        for (const select of selects) {
            select.innerHTML = '';
            providers.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = provider.split('-').map(w =>
                    w.charAt(0).toUpperCase() + w.slice(1)
                ).join(' ');
                if (provider === currentProvider) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        }

        return providers;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch providers:', e);
        return [];
    }
}

// Handler for settings page provider dropdown change
window.onSettingsProviderChange = async function () {
    const providerSelect = document.getElementById('setting-provider');
    const modelSelect = document.getElementById('setting-model');
    if (!providerSelect || !modelSelect) return;

    const provider = providerSelect.value;
    const models = await getModelsForProvider(provider);

    modelSelect.innerHTML = '';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        if (model.selected) option.selected = true;
        modelSelect.appendChild(option);
    });
};

// Refresh models from CLI (force cache invalidation)
window.refreshModels = async function () {
    showToast('Refreshing models from CLI...', 'info');

    try {
        const response = await fetch('/api/models/refresh', { method: 'POST' });
        const result = await response.json();

        if (result.ok) {
            showToast(`${result.message}`, 'success');
            // Refresh the provider dropdown with new models
            await populateProviderDropdown();
            // Update model dropdown for current provider (use currentProvider variable as fallback)
            const providerSelect = document.getElementById('provider-select');
            const provider = providerSelect?.value || currentProvider || 'openai-codex';
            await updateModelDropdown(provider);

            // Also refresh current model info from server
            try {
                const modelResponse = await fetch('/api/models/current');
                const modelInfo = await modelResponse.json();
                if (modelInfo?.modelId && modelInfo?.provider) {
                    syncModelDisplay(modelInfo.modelId, modelInfo.provider);
                }
            } catch (e) {
                console.warn('[Dashboard] Failed to refresh current model info:', e.message);
            }
        } else {
            showToast(result.message || 'Failed to refresh models', 'warning');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to refresh models:', e);
        showToast('Failed to refresh models: ' + e.message, 'error');
    }
}

/**
 * Header dropdown: change model for the CURRENT SESSION only.
 * Uses sessions.patch to set a per-session model override.
 */
/**
 * Header dropdown: change model for the CURRENT SESSION and Agent Default.
 * - Updates the current session immediately.
 * - Updates the agent's default configuration (via /api/models/set).
 * - "Global Default" reverts session to valid system default.
 */
window.changeSessionModel = async function () {
    const modelSelect = document.getElementById('model-select');
    const selectedModelRaw = modelSelect?.value;
    let selectedModel = selectedModelRaw === 'global/default'
        ? selectedModelRaw
        : resolveFullModelId(selectedModelRaw);

    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }

    if (selectedModel === 'global/default') {
        // This is valid - user wants to revert to global default
        console.log('[Dashboard] User selected Global Default - will revert to system default');
    } else if (!selectedModel.includes('/')) {
        showToast('Invalid model format. Please select a valid model.', 'warning');
        return;
    }

    if (selectedModel !== 'global/default') {
        const guard = normalizeGuardedModel(selectedModel);
        if (guard.redirected) {
            selectedModel = guard.model;
            if (modelSelect) modelSelect.value = selectedModel;
            showToast(`gpt-5.3-codex is unavailable in this OAuth profile. Using ${selectedModel.split('/').pop()} instead.`, 'warning');
            console.warn(`[Dashboard] Model guard redirected ${guard.original} -> ${selectedModel}`);
        }
    }

    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to gateway', 'warning');
        return;
    }

    // Track manual change to prevent UI reversion
    window._lastManualModelChange = Date.now();

    try {
        // Smartly determine which agent we're changing: 
        // If we're on the Agents page and drilled into an agent, use that agent. Otherwise, use the active chat agent.
        let targetAgentId = window.currentAgentId || 'main';
        if (typeof window._activePage === 'function' && window._activePage() === 'agents' && window._memoryCards && window._memoryCards.getCurrentDrilledAgent) {
            const drilled = window._memoryCards.getCurrentDrilledAgent();
            if (drilled) targetAgentId = drilled.id;
        }

        const agentId = targetAgentId;
        console.log(`[Dashboard] Applying model change for agent: ${agentId}, model: ${selectedModel}`);

        // Update the lock immediately so the sync logic doesn't revert it
        if (window._configModelLocks) {
            window._configModelLocks[window.currentSessionName] = selectedModel;
            console.log(`[Dashboard] Updated lock for ${window.currentSessionName} to ${selectedModel}`);
        }

        // 1. Update gateway session if applicable
        if (gateway && gateway.isConnected()) {
            gateway.request('sessions.patch', {
                key: window.currentSessionName,
                model: selectedModel
            });
        }

        if (selectedModel === 'global/default') {
            // Remove per-agent model override — revert to global default
            await fetch('/api/models/set-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, modelId: 'global/default' })
            });

            // Also clear session override
            try { await gateway.patchSession(window.currentSessionName, { model: null }); } catch (_) { }

            // Fetch current global default to update UI
            const response = await fetch('/api/models/current');
            const globalModel = await response.json();

            if (globalModel?.modelId) {
                currentModel = globalModel.modelId;
                const provider = globalModel.provider || window.getProviderFromModelId(currentModel) || currentModel.split('/')[0];
                currentProvider = provider;

                syncModelDisplay(currentModel, currentProvider);
                showToast('Reverted to Global Default', 'success');
            }
        } else {
            // Update per-agent model in openclaw.json
            const agentId = currentAgentId || 'main';
            const setResult = await fetch('/api/models/set-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, modelId: selectedModel })
            });
            const setData = await setResult.json();
            if (!setResult.ok) {
                throw new Error(setData.error || 'Failed to set agent model');
            }

            // Also patch current session so it takes effect immediately
            try {
                await gateway.patchSession(window.currentSessionName, { model: selectedModel });
            } catch (e) {
                console.warn('[Dashboard] sessions.patch model failed (may need gateway restart):', e.message);
            }

            // Update local state
            currentModel = selectedModel;
            const provider = window.getProviderFromModelId(selectedModel) || selectedModel.split('/')[0];
            currentProvider = provider;
            localStorage.setItem('selected_model', selectedModel);
            localStorage.setItem('selected_provider', provider);

            // Update lock so new manual choice is honored
            if (window._configModelLocks) {
                window._configModelLocks[window.currentSessionName] = selectedModel;
            }

            // Update settings display
            const currentModelDisplay = document.getElementById('current-model-display');
            if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;
            const currentProviderDisplay = document.getElementById('current-provider-display');
            if (currentProviderDisplay) currentProviderDisplay.textContent = provider;

            // Ensure provider dropdown matches
            const providerSelectEl = document.getElementById('provider-select');
            if (providerSelectEl) {
                const providerOptions = Array.from(providerSelectEl.options);
                if (!providerOptions.find(o => o.value === provider)) {
                    const opt = document.createElement('option');
                    opt.value = provider;
                    opt.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    providerSelectEl.appendChild(opt);
                }
                providerSelectEl.value = provider;
            }

            showToast(`Model set to ${selectedModel.split('/').pop()}`, 'success');

            // Dispatch event so other UI elements (like Agents dashboard) can sync instantly
            document.dispatchEvent(new CustomEvent('modelChanged', {
                detail: { agentId, modelId: selectedModel, source: 'header-dropdown' }
            }));
        }
    } catch (error) {
        console.error('[Dashboard] Failed to change model:', error);
        showToast(`Failed: ${error.message}`, 'error');
    }
};

/**
 * Settings: change the GLOBAL DEFAULT model for all agents.
 * Patches openclaw.json via the server API and triggers gateway restart.
 */
window.changeGlobalModel = async function () {
    const modelSelect = document.getElementById('setting-model');
    const providerSelect = document.getElementById('setting-provider');
    let selectedModel = modelSelect?.value;
    const selectedProvider = providerSelect?.value;

    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }

    if (!selectedModel.includes('/')) {
        showToast('Invalid model format. Please select a valid model.', 'warning');
        return;
    }

    const guard = normalizeGuardedModel(selectedModel);
    if (guard.redirected) {
        selectedModel = guard.model;
        if (modelSelect) modelSelect.value = selectedModel;
        showToast(`gpt-5.3-codex is unavailable in this OAuth profile. Global default set to ${selectedModel.split('/').pop()}.`, 'warning');
        console.warn(`[Dashboard] Global model guard redirected ${guard.original} -> ${selectedModel}`);
    }

    if (selectedModel.includes('ERROR')) {
        showToast('Cannot change model - configuration error', 'error');
        return;
    }

    if (!selectedProvider) {
        showToast('Please select a provider', 'warning');
        return;
    }

    try {
        console.log(`[Dashboard] Changing global default model to: ${selectedModel}`);

        const response = await fetch('/api/models/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: selectedModel })
        });

        const result = await response.json();

        if (response.ok) {
            currentModel = selectedModel;
            const provider = window.getProviderFromModelId(selectedModel) || currentProvider;
            currentProvider = provider;
            localStorage.setItem('selected_provider', provider);
            localStorage.setItem('selected_model', selectedModel);

            // Update all displays
            const currentModelDisplay = document.getElementById('current-model-display');
            const currentProviderDisplay = document.getElementById('current-provider-display');
            if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;
            if (currentProviderDisplay) currentProviderDisplay.textContent = provider;

            // Sync header dropdown
            selectModelInDropdowns(selectedModel);

            showToast(`Global default → ${selectedModel.split('/').pop()}. Gateway restarting...`, 'success');
        } else {
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('[Dashboard] Error changing global model:', error);
        showToast(`Failed: ${error.message}`, 'error');
    }
};

// Legacy alias — keep for any old references
window.changeModel = window.changeSessionModel;

/**
 * Load the saved model for a specific agent
 * Fetches from server and updates the UI dropdowns
 */
window.loadAgentModel = async function (agentId) {
    if (!agentId) return;

    try {
        // Fetch agent's model from server
        const response = await fetch(`/api/models/agent/${agentId}`);
        const agentModel = await response.json();

        if (!agentModel?.modelId || agentModel.modelId === 'global/default') {
            console.log(`[Dashboard] Agent ${agentId} has no model override — using global default`);
            return;
        }

        console.log(`[Dashboard] Loaded model for ${agentId}: ${agentModel.modelId}`);

        // Update current model vars
        currentModel = agentModel.modelId;
        currentProvider = agentModel.provider || window.getProviderFromModelId(agentModel.modelId) || currentProvider;

        // Update localStorage for persistence
        localStorage.setItem('selected_model', currentModel);
        localStorage.setItem('selected_provider', currentProvider);

        // Update the sticky lock so syncModelDisplay allows the new model
        const activeSession = window.currentSessionName;
        if (activeSession) {
            window._configModelLocks = window._configModelLocks || {};
            window._configModelLocks[activeSession] = currentModel;
        }

        // Update UI
        syncModelDisplay(currentModel, currentProvider);

        // Update dropdowns
        const providerSelect = document.getElementById('provider-select');
        if (providerSelect) {
            providerSelect.value = currentProvider;
            await updateHeaderModelDropdown(currentProvider);
        }

        const modelSelect = document.getElementById('model-select');
        if (modelSelect) {
            modelSelect.value = currentModel;
        }
    } catch (e) {
        console.warn(`[Dashboard] Failed to load model for ${agentId}:`, e.message);
    }
};

// Global listener for cross-dashboard model synchronization
document.addEventListener('modelChanged', async (e) => {
    const { agentId, modelId, source } = e.detail;

    // Reverse Sync 1: If user saves model in Agents dashboard, the central header should update aggressively to reflect their latest action
    if (source === 'agents-dashboard') {
        console.log(`[Dashboard] Model changed in agents dashboard for ${agentId} to ${modelId}, forcing header update`);
        window.currentAgentId = agentId;
        await window.loadAgentModel(agentId);
    }

    // Reverse Sync 2: If the event came from the header or settings, and the agent dashboard is open, update the dashboard panel
    if (source === 'header-dropdown' || source === 'settings-modal') {
        if (typeof window._activePage === 'function' && window._activePage() === 'agents' && window._memoryCards && typeof window._memoryCards.getCurrentDrilledAgent === 'function') {
            const drilledAgent = window._memoryCards.getCurrentDrilledAgent();
            if (drilledAgent && (drilledAgent.id === agentId || source === 'settings-modal' || agentId === 'main')) {
                console.log(`[Dashboard] Model changed in header for ${agentId}, reloading agents dashboard config`);
                setTimeout(() => window._memoryCards.loadAgentModelConfig(drilledAgent.id), 100);
            }
        }
    }
});

async function updateHeaderModelDropdown(provider) {
    const models = await getModelsForProvider(provider);
    const select = document.getElementById('model-select');
    if (!select) return;

    select.innerHTML = '';

    // Add "Global Default" option first (header can revert to global default)
    const globalOption = document.createElement('option');
    globalOption.value = 'global/default';
    globalOption.textContent = 'Global Default 🌐';
    globalOption.style.fontWeight = 'bold';
    select.appendChild(globalOption);

    // Add separator
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = '──────────';
    select.appendChild(separator);

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        if (model.selected) option.selected = true;
        select.appendChild(option);
    });
}

async function updateSettingsModelDropdown(provider) {
    const models = await getModelsForProvider(provider);
    const select = document.getElementById('setting-model');
    if (!select) return;

    select.innerHTML = '';

    // Settings dropdown should NOT have "Global Default" option since it's for setting the global default
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        if (model.selected) option.selected = true;
        select.appendChild(option);
    });
}

// Legacy function for backward compatibility - calls both functions
async function updateModelDropdown(provider) {
    await Promise.all([
        updateHeaderModelDropdown(provider),
        updateSettingsModelDropdown(provider)
    ]);
}

async function getModelsForProvider(provider) {
    // Prefer live gateway models (most up-to-date — reads running config)
    if (window._gatewayModels && window._gatewayModels[provider]) {
        const providerModels = window._gatewayModels[provider];
        return providerModels.map(m => ({
            value: m.id,
            name: m.name,
            selected: (m.id === currentModel)
        }));
    }

    // Fallback: fetch from server API (Docker config may be stale)
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const allModels = await response.json();

        // Get models for the requested provider
        const providerModels = allModels[provider] || [];

        // Transform to expected format and mark current as selected
        const models = providerModels.map(m => ({
            value: m.id,
            name: m.name,
            selected: (m.id === currentModel)
        }));

        return models;
    } catch (e) {
        console.error('[Dashboard] Failed to get models from API:', e);
        return [];
    }
}

/**
 * Fetch model configuration directly from the gateway via WebSocket RPC.
 * The live gateway config is the source of truth — the Docker-mounted config
 * may be stale if openclaw.json was updated after the container started.
 */
async function fetchModelsFromGateway() {
    if (!gateway || !gateway.isConnected()) return;

    try {
        const config = await gateway.getConfig();

        let configData = config;
        if (typeof config === 'string') configData = JSON.parse(config);
        if (configData?.raw) {
            try {
                configData = JSON.parse(configData.raw);
            } catch (e) {
                console.warn('[Dashboard] Falling back to structured config due to raw parse error:', e.message);
                if (configData.config) configData = configData.config;
            }
        }

        const modelConfig = configData?.agents?.defaults?.model;
        if (!modelConfig) return;

        const primary = modelConfig.primary;
        const fallbacks = modelConfig.fallbacks || [];
        const picker = modelConfig.picker || [];
        const configuredModels = Object.keys(configData?.agents?.defaults?.models || {});

        const allModelIds = [...new Set([
            ...(primary ? [primary] : []),
            ...picker,
            ...fallbacks,
            ...configuredModels
        ])];

        if (allModelIds.length === 0) return;

        // Group by provider
        const modelsByProvider = {};
        for (const modelId of allModelIds) {
            const provider = window.getProviderFromModelId(modelId) || 'unknown';
            const slashIdx = modelId.indexOf('/');
            const modelName = slashIdx !== -1 ? modelId.substring(slashIdx + 1) : modelId;

            if (!modelsByProvider[provider]) modelsByProvider[provider] = [];

            const isPrimary = modelId === primary;
            const displayName = modelName + (isPrimary ? ' ⭐' : '');

            if (!modelsByProvider[provider].some(m => m.id === modelId)) {
                modelsByProvider[provider].push({
                    id: modelId,
                    name: displayName,
                    tier: isPrimary ? 'default' : 'fallback'
                });
            }
        }

        // Update the provider dropdown with gateway-sourced providers
        const providerSelect = document.getElementById('provider-select');
        if (providerSelect) {
            const providers = Object.keys(modelsByProvider);
            providerSelect.innerHTML = '';
            providers.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                if (p === currentProvider) opt.selected = true;
                providerSelect.appendChild(opt);
            });
        }

        // Store for getModelsForProvider to prefer
        window._gatewayModels = modelsByProvider;

        // Refresh model dropdown for the active provider
        const activeProvider = providerSelect?.value || currentProvider;
        if (activeProvider) {
            await updateModelDropdown(activeProvider);
            if (currentModel) selectModelInDropdowns(currentModel);
        }

        console.log(`[Dashboard] Gateway models: ${allModelIds.length} models from ${Object.keys(modelsByProvider).length} providers`);

        // Sync to server so /api/models/list works even without config file volume mount
        try {
            fetch('/api/models/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(modelsByProvider)
            });
        } catch (_) { }
    } catch (e) {
        console.warn('[Dashboard] Failed to fetch models from gateway:', e.message);
    }
}

function getConfiguredModels() {
    // Fallback to configured models if command fails
    try {
        const exec = require('child_process').execSync;
        const result = exec('moltbot models list 2>/dev/null | tail -n +4', { encoding: 'utf8' });

        const models = [];
        const lines = result.split('\n').filter(line => line.trim());

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const modelId = parts[0];
                const tags = parts[parts.length - 1] || '';

                models.push({
                    value: modelId,
                    name: modelId.split('/').pop() || modelId,
                    selected: tags.includes('default') || tags.includes('configured')
                });
            }
        }

        return models;
    } catch (e) {
        return [];
    }
}

// Current model state
// Initialize provider and model variables on window for global access
window.currentProvider = window.currentProvider || null;
window.currentModel = window.currentModel || null;

/**
 * Resolve a bare model name (e.g. "claude-opus-4-6") to its full "provider/model" ID.
 * The gateway sessions.list often returns model names without the provider prefix.
 * Uses known prefixes to resolve the model.
 */
function resolveFullModelId(modelStr) {
    if (!modelStr) return modelStr;

    // Special handling for OpenRouter which often uses double slashes or gets stripped
    if (modelStr.includes('moonshotai/') || modelStr.includes('minimax/') || modelStr.includes('deepseek/')) {
        if (!modelStr.startsWith('openrouter/')) {
            return `openrouter/${modelStr}`;
        }
        return modelStr;
    }

    // Already has a provider prefix
    if (modelStr.includes('/')) return modelStr;

    // Well-known provider prefixes
    const knownPrefixes = {
        'claude': 'openrouter',
        'gpt': 'openai-codex',
        'o1': 'openai',
        'o3': 'openai',
        'gemini': 'google',
        'kimi': 'moonshot',
    };
    for (const [prefix, provider] of Object.entries(knownPrefixes)) {
        if (modelStr.startsWith(prefix)) return `${provider}/${modelStr}`;
    }

    return modelStr;
}
window.resolveFullModelId = resolveFullModelId;

/**
 * Extracts the provider from a full model ID correctly, handling edge cases
 * like OpenRouter models which often contain multiple slashes (e.g.,
 * openrouter/huggingface/moonshotai/Kimi-K2.5:fastest).
 */
window.getProviderFromModelId = function (modelId) {
    if (!modelId || typeof modelId !== 'string') return '';

    // OpenRouter edge case: sometimes the model ID has multiple slashes
    if (modelId.startsWith('openrouter/')) {
        return 'openrouter';
    }

    // Fallback: extract the first segment before a slash
    const slashIdx = modelId.indexOf('/');
    if (slashIdx !== -1) {
        return modelId.substring(0, slashIdx);
    }

    return '';
}

/**
 * Sync the model dropdown and display elements with the actual model in use.
 * Called when we get model info from gateway connect or chat responses.
 * This is the source of truth — gateway tells us what model is actually running.
 */
function syncModelDisplay(model, provider) {
    if (!model) return;

    // 1. Ignore updates if manual change happened recently (prevent reversion flicker)
    const now = Date.now();
    if (window._lastManualModelChange && (now - window._lastManualModelChange < 5000)) {
        console.log('[Dashboard] Skipping model sync due to recent manual change');
        return;
    }

    // 2. STICKY CONFIG LOCK: If a model is set in openclaw.json, refuse to let gateway change it
    const activeSession = window.currentSessionName || '';
    if (window._configModelLocks && window._configModelLocks[activeSession]) {
        const lockedModel = window._configModelLocks[activeSession];
        if (model !== lockedModel) {
            console.log(`[Dashboard] IGNORING gateway model override (${model}) — Session is locked to openclaw.json value: ${lockedModel}`);
            return;
        }
    }

    // Resolve bare model names to full provider/model IDs and guard blocked models.
    const guarded = normalizeGuardedModel(model);
    model = guarded.model;

    if (model === currentModel && provider === currentProvider) return;

    console.log(`[Dashboard] Model sync: ${currentModel} → ${model} (provider: ${provider || currentProvider})`);
    currentModel = model;

    // Extract provider from model ID if not provided
    if (!provider) {
        provider = window.getProviderFromModelId(model);
    }
    if (provider) currentProvider = provider;

    // Update localStorage
    localStorage.setItem('selected_model', model);
    if (provider) localStorage.setItem('selected_provider', provider);

    // Update settings modal displays
    const currentModelDisplay = document.getElementById('current-model-display');
    if (currentModelDisplay) currentModelDisplay.textContent = model;

    // Update provider display & dropdown
    if (provider) {
        const currentProviderDisplay = document.getElementById('current-provider-display');
        if (currentProviderDisplay) currentProviderDisplay.textContent = provider;

        const providerSelectEl = document.getElementById('provider-select');
        if (providerSelectEl) {
            // Make sure provider option exists
            const providerOptions = Array.from(providerSelectEl.options);
            if (!providerOptions.find(o => o.value === provider)) {
                const opt = document.createElement('option');
                opt.value = provider;
                opt.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                providerSelectEl.appendChild(opt);
            }
            providerSelectEl.value = provider;
        }

        // Also update settings provider dropdown
        const settingProviderEl = document.getElementById('setting-provider');
        if (settingProviderEl) {
            settingProviderEl.value = provider;
        }

        // Refresh model dropdowns for this provider, then select the right model
        updateModelDropdown(provider).then(() => {
            selectModelInDropdowns(model);
        }).catch(e => {
            console.warn('[Dashboard] Failed to update model dropdowns:', e);
            // Fallback: try to select model directly
            selectModelInDropdowns(model);
        });
    } else {
        selectModelInDropdowns(model);
    }
}

// Track models loaded from config to prevent gateway overrides
window._configModelLocks = window._configModelLocks || {};
window._sessionModelEnforcement = window._sessionModelEnforcement || {};

// Ensure the gateway session model matches the locked config model.
// This prevents drift when a session was previously patched to a different provider/model.
window.enforceSessionModelLock = async function enforceSessionModelLock(sessionKey, model, reason = 'config-lock') {
    if (!sessionKey || !model || model === 'global/default') return;
    const normalizedModel = resolveFullModelId(model);
    if (!normalizedModel) return;

    const gw = window.gateway || (typeof gateway !== 'undefined' ? gateway : null);
    if (!gw || typeof gw.isConnected !== 'function' || !gw.isConnected()) return;

    const now = Date.now();
    const prev = window._sessionModelEnforcement[sessionKey];
    if (prev && prev.model === normalizedModel && (now - prev.ts) < 10000) {
        return;
    }
    window._sessionModelEnforcement[sessionKey] = { model: normalizedModel, ts: now };

    try {
        await gw.patchSession(sessionKey, { model: normalizedModel });
        console.log(`[Dashboard] Enforced session model for ${sessionKey}: ${normalizedModel} (${reason})`);
    } catch (e) {
        console.warn(`[Dashboard] Failed to enforce session model for ${sessionKey}: ${e?.message || e}`);
    }
};

// Apply per-session model override — openclaw.json is SOURCE OF TRUTH
async function applySessionModelOverride(sessionKey) {
    if (!sessionKey) return;

    const rawAgentId = sessionKey.match(/^agent:([^:]+):/)?.[1];
    const agentId = rawAgentId ? (window.resolveAgentId ? window.resolveAgentId(rawAgentId) : rawAgentId) : null;
    let sessionModel = null;

    // === 1. FIRST: Check openclaw.json for agent-specific model (source of truth) ===
    if (agentId) {
        try {
            const agentModel = await fetch(`/api/models/agent/${agentId}`).then(r => r.json());
            if (agentModel?.modelId && agentModel.modelId !== 'global/default') {
                sessionModel = agentModel.modelId;
                console.log(`[Dashboard] LOCKING model for ${agentId} to config value: ${sessionModel}`);
                window._configModelLocks[sessionKey] = sessionModel;
            }
        } catch (e) { }
    }

    // === 2. SECOND: Check global default in openclaw.json ===
    if (!sessionModel) {
        try {
            const response = await fetch('/api/models/current');
            if (response.ok) {
                const modelInfo = await response.json();
                if (modelInfo?.modelId) {
                    sessionModel = modelInfo.modelId;
                    console.log(`[Dashboard] LOCKING model to global default: ${sessionModel}`);
                    window._configModelLocks[sessionKey] = sessionModel;
                }
            }
        } catch (e) { }
    }

    if (sessionModel) {
        const guard = normalizeGuardedModel(sessionModel);
        sessionModel = guard.model;

        if (guard.redirected) {
            console.warn(`[Dashboard] Session model guard redirected ${guard.original} -> ${sessionModel} for ${sessionKey}`);
            if (window._configModelLocks) {
                window._configModelLocks[sessionKey] = sessionModel;
            }

            // Best-effort: patch active session immediately so chat sends stop failing.
            try {
                if (gateway && gateway.isConnected()) {
                    gateway.request('sessions.patch', { key: sessionKey, model: sessionModel });
                }
            } catch (_) { }
        }

        const provider = window.getProviderFromModelId(sessionModel) || currentProvider;
        syncModelDisplay(sessionModel, provider);

        // Always enforce the lock on the actual gateway session entry.
        // Display lock alone is not enough because chat.send uses server-side session model.
        if (typeof window.enforceSessionModelLock === 'function') {
            window.enforceSessionModelLock(sessionKey, sessionModel, 'session-switch').catch(() => { });
        }
    } else {
        console.warn(`[Dashboard] No model found for session ${sessionKey}, keeping current display`);
    }
}


/**
 * Select a model in both header and settings dropdowns.
 * Adds the option dynamically if it's not already listed.
 */
function selectModelInDropdowns(model) {
    const shortName = model.split('/').pop() || model;

    const modelSelect = document.getElementById('model-select');
    const settingModel = document.getElementById('setting-model');

    [modelSelect, settingModel].forEach(select => {
        if (!select) return;
        const options = Array.from(select.options);
        const match = options.find(o => o.value === model);
        if (match) {
            select.value = model;
        } else {
            // Model not in dropdown — add it
            const option = document.createElement('option');
            option.value = model;
            option.textContent = shortName;
            option.selected = true;
            select.appendChild(option);
        }
    });
}

// Initialize provider/model display on page load
document.addEventListener('DOMContentLoaded', async function () {
    try {
        // Optimistically load from localStorage first to prevent UI flashes (e.g. "openrouter/free" flash)
        let modelId = resolveFullModelId(localStorage.getItem('selected_model'));
        let provider = localStorage.getItem('selected_provider');

        if (modelId) {
            provider = provider || window.getProviderFromModelId(modelId);
            // Persist normalized full model IDs so stale short IDs do not get reused.
            localStorage.setItem('selected_model', modelId);
            if (provider) localStorage.setItem('selected_provider', provider);
            window.currentModel = modelId;
            window.currentProvider = provider;

            // Quickly update DOM elements without waiting for API
            const tempModelDisplay = document.getElementById('current-model-display');
            if (tempModelDisplay) tempModelDisplay.textContent = modelId;
            const tempProviderDisplay = document.getElementById('current-provider-display');
            if (tempProviderDisplay) tempProviderDisplay.textContent = provider;
        }

        try {
            // Then fetch current model from server API (reads openclaw.json — source of truth)
            const response = await fetch('/api/models/current');
            const modelInfo = await response.json();

            // Only update if the server gives us a valid response
            if (modelInfo?.modelId) {
                // If we didn't have a local model, apply the UI update
                // If we DID have one, we log it but don't force a visual overwrite to prevent flash
                if (!localStorage.getItem('selected_model')) {
                    modelId = modelInfo.modelId;
                    provider = modelInfo.provider || window.getProviderFromModelId(modelId);
                }
                console.log(`[Dashboard] Model from API global default: ${modelInfo.modelId} (provider: ${modelInfo.provider || window.getProviderFromModelId(modelInfo.modelId)})`);
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to fetch current model from API:', e.message);
        }

        // No fallback — leave null and let the gateway/config provide the model
        if (!modelId) modelId = null;
        if (!provider && modelId) provider = window.getProviderFromModelId(modelId) || modelId.split('/')[0];

        window.currentProvider = provider;
        window.currentModel = modelId;

        console.log(`[Dashboard] Init model: ${window.currentModel} (provider: ${window.currentProvider})`);

        // NOW populate the provider dropdown with currentProvider set
        await populateProviderDropdown();

        // Update displays
        const currentProviderDisplay = document.getElementById('current-provider-display');
        const currentModelDisplay = document.getElementById('current-model-display');
        const providerSelectEl = document.getElementById('provider-select');

        if (currentProviderDisplay) currentProviderDisplay.textContent = window.currentProvider;
        if (currentModelDisplay) currentModelDisplay.textContent = window.currentModel;
        if (providerSelectEl) providerSelectEl.value = window.currentProvider;

        // Also sync settings provider dropdown
        const settingProviderEl = document.getElementById('setting-provider');
        if (settingProviderEl) settingProviderEl.value = window.currentProvider;

        // Populate model dropdown for current provider and select current model

        // Set up periodic model sync (every 5 minutes)
        let modelSyncInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/models/current');
                const modelInfo = await response.json();
                if (modelInfo?.modelId && modelInfo?.provider) {
                    // Only update if different from current
                    if (modelInfo.modelId !== window.currentModel || modelInfo.provider !== window.currentProvider) {
                        console.log(`[Dashboard] Model changed on server: ${window.currentModel} → ${modelInfo.modelId}`);
                        syncModelDisplay(modelInfo.modelId, modelInfo.provider);
                    }
                }
            } catch (e) {
                // Silent fail for periodic sync
            }
        }, 5 * 60 * 1000); // 5 minutes
        
        // Export cleanup for SPA navigation
        window._modelsCleanup = () => clearInterval(modelSyncInterval);
        
        await updateModelDropdown(window.currentProvider);
        selectModelInDropdowns(window.currentModel);

    } catch (error) {
        console.error('[Dashboard] Failed to initialize model display:', error);
    }
});

// Default settings
const defaultSettings = {
    pickupFreq: 'disabled',
    priorityOrder: 'priority',
    refreshInterval: '10000',
    defaultPriority: '1',
    compactMode: false,
    showLive: true,
    showActivity: true,
    showNotes: true,
    showProducts: true,
    showDocs: true
};

// === notifications.js ===
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
const TRANSIENT_RETRY_DELAY_MS = 1400;
const MAX_TRANSIENT_RETRIES_PER_RUN = 1;
const _retryScheduledForRun = new Set();

function isTransientGatewayError(errorMessage, errorKind) {
    if (errorKind === 'upstream_transient') return true;
    const msg = String(errorMessage || '').toLowerCase();
    if (!msg) return false;
    if (msg.includes('502 bad gateway')) return true;
    if (msg.includes('cloudflare')) return true;
    return msg.includes('<html') && msg.includes('bad gateway');
}

function clearPendingSendByRunId(runId) {
    if (!runId) return;
    const map = window._chatPendingSends;
    if (map instanceof Map) map.delete(runId);
    _retryScheduledForRun.delete(runId);
}

function tryRetryTransientSend({ runId, sessionKey, errorMessage, errorKind }) {
    if (!runId) return;
    if (!isTransientGatewayError(errorMessage, errorKind)) return;
    if (_retryScheduledForRun.has(runId)) return;

    const map = window._chatPendingSends;
    if (!(map instanceof Map)) return;
    const pending = map.get(runId);
    if (!pending) return;

    const activeSession = String(currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    const pendingSession = String(pending.sessionKey || sessionKey || '').toLowerCase();
    if (!activeSession || !pendingSession || activeSession !== pendingSession) return;
    if (Number(pending.retries || 0) >= MAX_TRANSIENT_RETRIES_PER_RUN) return;

    _retryScheduledForRun.add(runId);
    showToast('Transient gateway outage detected. Retrying once...', 'warning');

    setTimeout(async () => {
        const latest = map.get(runId);
        if (!latest) {
            _retryScheduledForRun.delete(runId);
            return;
        }
        if (Number(latest.retries || 0) >= MAX_TRANSIENT_RETRIES_PER_RUN) {
            _retryScheduledForRun.delete(runId);
            return;
        }
        if (!gateway || !gateway.isConnected()) {
            _retryScheduledForRun.delete(runId);
            return;
        }

        latest.retries = Number(latest.retries || 0) + 1;
        map.set(runId, latest);

        try {
            let retryResult = null;
            if (Array.isArray(latest.images) && latest.images.length > 0) {
                retryResult = await gateway.sendMessageWithImages(latest.text || 'Image', latest.images);
            } else {
                retryResult = await gateway.sendMessage(latest.text || '');
            }
            if (retryResult?.runId) {
                map.set(retryResult.runId, {
                    ...latest,
                    createdAt: Date.now()
                });
            }
            map.delete(runId);
            showToast('Retry sent after temporary upstream error.', 'success');
        } catch (err) {
            console.error('[Notifications] Auto-retry failed:', err);
            showToast('Retry failed. Please send once more.', 'warning');
        } finally {
            _retryScheduledForRun.delete(runId);
        }
    }, TRANSIENT_RETRY_DELAY_MS);
}

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

function resolveInterSessionMeta(primary, secondary = null) {
    const sourceSession = String(primary?.sourceSession || secondary?.sourceSession || '').trim();
    const sourceAgentRaw = String(primary?.sourceAgent || primary?.sourceAgentId || secondary?.sourceAgent || secondary?.sourceAgentId || '').trim();
    const sourceAgentName = String(primary?.sourceAgentName || secondary?.sourceAgentName || '').trim();

    let sourceAgent = sourceAgentRaw;
    if (!sourceAgent && sourceSession) {
        const m = sourceSession.match(/^agent:([^:]+):/i);
        if (m) sourceAgent = m[1];
    }
    if (!sourceSession && !sourceAgent && !sourceAgentName) return null;

    const canonicalAgent = (typeof window.resolveAgentId === 'function')
        ? window.resolveAgentId(sourceAgent || 'main')
        : (sourceAgent || 'main');
    const displayName = sourceAgentName || (typeof getAgentDisplayName === 'function' ? getAgentDisplayName(canonicalAgent) : canonicalAgent);

    return {
        _sourceSession: sourceSession || null,
        _sourceAgent: canonicalAgent || null,
        _sourceAgentName: displayName || null,
        _agentId: canonicalAgent || (window.currentAgentId || 'main'),
        _isInterSession: true
    };
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

function buildFinalFingerprint({ runId, sessionKey, text, images, from = 'solobot' }) {
    const session = String(sessionKey || '').toLowerCase();
    const sender = String(from || 'solobot').toLowerCase();
    if (runId) return `run:${session}:${sender}:${runId}`;

    const normalizedText = String(text || '').trim();
    const imageCount = Array.isArray(images) ? images.length : 0;
    const firstImageSig = imageCount > 0 && typeof images[0] === 'string'
        ? images[0].slice(0, 32)
        : '';
    return `text:${session}:${sender}:${normalizedText}:${imageCount}:${firstImageSig}`;
}

function canonicalMessageFingerprint(msg = {}) {
    const session = String(msg._sessionKey || msg.sessionKey || currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    const sender = String(msg.from || msg.role || '').toLowerCase();
    const text = String(msg.text || '').trim();
    const images = Array.isArray(msg.images) ? msg.images : (msg.image ? [msg.image] : []);
    return buildFinalFingerprint({
        runId: msg.runId,
        sessionKey: session,
        text,
        images,
        from: sender
    });
}

function shouldKeepDistinctDuplicate(existing, msg) {
    const existingText = String(existing?.text || '').trim();
    const msgText = String(msg?.text || '').trim();
    if (!existingText || !msgText) return false;
    if (existingText !== msgText) return true;

    const isShort = existingText.length < 25 && !existingText.includes('\n');
    const existingTime = Number(existing?.time || 0);
    const msgTime = Number(msg?.time || 0);
    const farApart = Math.abs(msgTime - existingTime) > 15 * 60 * 1000;

    return isShort && farApart;
}

function collapseDuplicateMessages(messages = []) {
    const sorted = [...messages].sort((a, b) => (a.time || 0) - (b.time || 0));
    const kept = [];
    const seen = new Map();

    for (const msg of sorted) {
        if (!msg) continue;
        const text = String(msg.text || '').trim();
        const imageCount = Array.isArray(msg.images) ? msg.images.length : (msg.image ? 1 : 0);
        if (!text && imageCount === 0) continue;

        const fp = canonicalMessageFingerprint(msg);
        const existing = seen.get(fp);
        if (!existing) {
            seen.set(fp, msg);
            kept.push(msg);
            continue;
        }

        const existingTime = Number(existing.time || 0);
        const msgTime = Number(msg.time || 0);
        const existingId = String(existing.id || '');
        const msgId = String(msg.id || '');
        const localVsServerPair = (!!msgId && !msgId.startsWith('m') && existingId.startsWith('m'))
            || (!!existingId && !existingId.startsWith('m') && msgId.startsWith('m'));
        const withinWindow = Math.abs(msgTime - existingTime) <= 15000;

        if (!withinWindow && !localVsServerPair && shouldKeepDistinctDuplicate(existing, msg)) {
            const variantKey = `${fp}:${msgTime}`;
            seen.set(variantKey, msg);
            kept.push(msg);
            continue;
        }

        const preferCurrent = (!!msg.runId && !existing.runId)
            || (!!msgId && !msgId.startsWith('m') && existingId.startsWith('m'))
            || ((msg.images?.length || 0) > (existing.images?.length || 0));

        if (preferCurrent) {
            const idx = kept.indexOf(existing);
            if (idx >= 0) kept[idx] = msg;
            seen.set(fp, msg);
        }
    }

    return kept;
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
    const agentColors = { main: '#BC2026', dev: '#6366F1', exec: '#F59E0B', coo: '#10B981', cfo: '#EAB308', cmp: '#EC4899', family: '#14B8A6', tax: '#78716C', sec: '#3B82F6', smm: '#8B5CF6', pulse: '#00D4FF' };
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
        const countBadge = header.querySelector('.sidebar-agent-group-count');

        if (groupUnread > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'group-unread-badge';
                badge.style.cssText = 'margin-left: auto; margin-right: 6px; background: var(--brand-red, #BC2026); color: white; border-radius: 999px; min-width: 18px; height: 18px; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; pointer-events: none;';

                // Keep unread badge inside header, but before the normal group-count pill.
                if (countBadge) {
                    header.insertBefore(badge, countBadge);
                } else {
                    header.appendChild(badge);
                }
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
    const { state: eventState, content, images, role, errorMessage, model, provider, stopReason, sessionKey, runId, errorKind, sourceSession, sourceAgent, sourceAgentId, sourceAgentName } = event;

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

        const interMeta = resolveInterSessionMeta({ sourceSession, sourceAgent, sourceAgentId, sourceAgentName }, event);
        const from = interMeta ? 'solobot' : 'user';

        // Check if we already have this message (to avoid duplicates from our own sends)
        const isDuplicate = state.chat.messages.some(m =>
            m.from === from && m.text?.trim() === content.trim() && (Date.now() - m.time) < 5000
        );
        if (!isDuplicate) {
            addLocalChatMessage(content, from, null, null, null, interMeta);
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
            clearPendingSendByRunId(runId);
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
                    images,
                    from: 'solobot'
                });
                const recentDuplicate = hasRecentFinalFingerprint(finalFingerprint);
                if (!runtimeDuplicate && !recentDuplicate) {
                    const interMeta = resolveInterSessionMeta({ sourceSession, sourceAgent, sourceAgentId, sourceAgentName }, event);
                    const msg = addLocalChatMessage(finalContent, 'solobot', images, window._lastResponseModel, window._lastResponseProvider, interMeta);
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
            tryRetryTransientSend({ runId, sessionKey, errorMessage, errorKind });
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
        // Strict isolation: untagged messages are treated as unsafe legacy data and dropped.
        const msgSession = (m._sessionKey || m.sessionKey || '').toLowerCase();
        return !!msgSession && !!currentKey && msgSession === currentKey;
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
        const historySession = String(msg?.sessionKey || msg?.message?.sessionKey || '').toLowerCase();
        if (historySession && currentKey && historySession !== currentKey) {
            return;
        }

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
            _agentId: (resolveInterSessionMeta(msg, msg.message)?._agentId) || (window.currentAgentId || 'main'),
            _sourceSession: resolveInterSessionMeta(msg, msg.message)?._sourceSession || null,
            _sourceAgent: resolveInterSessionMeta(msg, msg.message)?._sourceAgent || null,
            _sourceAgentName: resolveInterSessionMeta(msg, msg.message)?._sourceAgentName || null,
            _isInterSession: !!resolveInterSessionMeta(msg, msg.message)
        };

        // Classify and route
        if (isSystemMessage(content.text, message.from) || message._isInterSession || message._sourceSession || message._sourceAgent) {
            systemMessages.push(message);
        } else {
            chatMessages.push(message);
        }
    });

    // Merge chat: combine gateway history with ALL local messages.
    // Dedupe ONLY by ID. Text-based dedupe caused legit repeated messages
    // (e.g., "yes", "ok", "thanks") to disappear after refresh/switch.
    const historyIds = new Set(chatMessages.map(m => m.id));
    const uniqueLocalMessages = allLocalChatMessages.filter(m => !historyIds.has(m.id));

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

    const mergedMessages = collapseDuplicateMessages([...chatMessages, ...uniqueLocalMessages]);
    const migratedSystem = mergedMessages.filter(m => typeof isSystemMessage === 'function' && isSystemMessage(m.text, m.from));
    state.chat.messages = collapseDuplicateMessages(mergedMessages.filter(m => !(typeof isSystemMessage === 'function' && isSystemMessage(m.text, m.from))));
    console.log(`[Dashboard] Set ${state.chat.messages.length} chat messages (${chatMessages.length} from history, ${uniqueLocalMessages.length} local, migrated ${migratedSystem.length} to system)`);

    // Sort chat by time and trim
    state.chat.messages.sort((a, b) => a.time - b.time);
    if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
        state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
    }

    // Merge system messages with existing (they're local noise, but good to show from history too)
    state.system.messages = [...state.system.messages, ...systemMessages, ...migratedSystem];
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
    const activeSession = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    const gatewaySession = (gateway.sessionKey || '').toLowerCase();
    if (activeSession && gatewaySession && activeSession !== gatewaySession) {
        notifLog(`[Notifications] _doHistoryRefresh: Skipped (gateway session mismatch ${gatewaySession} vs ${activeSession})`);
        return;
    }
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
        const currentActive = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
        const currentGateway = (gateway.sessionKey || '').toLowerCase();
        if (currentActive && currentGateway && currentActive !== currentGateway) {
            notifLog(`[Notifications] _doHistoryRefresh: Skipped merge (post-load mismatch ${currentGateway} vs ${currentActive})`);
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

    const existingChatMessages = state.chat.messages.filter(m => {
        const msgSession = (m?._sessionKey || m?.sessionKey || '').toLowerCase();
        return !!msgSession && msgSession === activeSession;
    });

    // Removed verbose log - called on every history poll
    // Merge new messages from history without duplicates, classify as chat vs system
    // This catches user messages from other clients that weren't broadcast as events
    const existingIds = new Set(existingChatMessages.map(m => m.id));
    const existingSystemIds = new Set(state.system.messages.map(m => m.id));
    // Also track existing text content (trimmed) to prevent duplicates when IDs differ
    // (local messages use 'm' + Date.now(), history messages have server IDs)
    const existingTexts = new Set(existingChatMessages.map(m => (m.text || '').trim()));
    const existingSystemTexts = new Set(state.system.messages.map(m => (m.text || '').trim()));
    // Track runIds from real-time messages for dedup
    const existingRunIds = new Set(existingChatMessages.filter(m => m.runId).map(m => m.runId));
    let newChatCount = 0;
    let newSystemCount = 0;

    const extractContentText = (container) => extractHistoryText(container);

    for (const msg of messages) {
        const historySession = String(msg?.sessionKey || msg?.message?.sessionKey || '').toLowerCase();
        if (historySession && historySession !== activeSession) {
            continue;
        }

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
                const interMeta = resolveInterSessionMeta(msg, msg.message);
                const isSystemMsg = isSystemMessage(textContent, msg.role === 'user' ? 'user' : 'solobot') || !!interMeta;

                // Skip if runId matches a real-time message we already have
                if (msg.runId && existingRunIds.has(msg.runId)) {
                    continue;
                }

                // Skip if we already have this exact text content (trimmed, prevents duplicates when IDs differ)
                // Keep repeated content messages; rely on ID/runId dedupe.

                // Time guard: skip non-user assistant messages if we have any local message added within the last 5 seconds
                // Uses client-side time (m.time) to avoid clock skew with server timestamps
                if (msg.role !== 'user') {
                    const hasRecentLocal = existingChatMessages.some(m =>
                        m.from === 'solobot' && (Date.now() - m.time) < 5000
                    );
                    if (hasRecentLocal && !existingIds.has(msgId)) {
                        // Check if this message's text matches a recent local one (likely the same)
                        const recentMatch = existingChatMessages.some(m =>
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
                    runId: msg.runId || msg.message?.runId || null,
                    _sessionKey: currentSessionName || GATEWAY_CONFIG?.sessionKey || '',
                    _agentId: interMeta?._agentId || (window.currentAgentId || 'main'),
            _sourceSession: interMeta?._sourceSession || null,
            _sourceAgent: interMeta?._sourceAgent || null,
            _sourceAgentName: interMeta?._sourceAgentName || null,
            _isInterSession: !!interMeta
                };

                // Classify and route
                if (isSystemMsg) {
                    state.system.messages.push(message);
                    existingSystemTexts.add(textContent); // already trimmed by extractContentText
                    newSystemCount++;
                } else {
                    state.chat.messages.push(message);
                    existingChatMessages.push(message);
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

        // Sort, dedupe, and trim chat
        state.chat.messages = collapseDuplicateMessages(state.chat.messages);
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

// === security.js ===
// js/security.js — Security & Access Log page

let securityInterval = null;

function initSecurityPage() {
    loadSecurityData();
    if (securityInterval) clearInterval(securityInterval);
    securityInterval = setInterval(loadSecurityData, 30000);
}

async function loadSecurityData() {
    if (!gateway || !gateway.isConnected()) {
        renderSecurityDisconnected();
        return;
    }

    // Load exec approvals
    try {
        const approvals = await gateway._request('exec.approvals.list', {});
        renderExecApprovals(approvals?.items || approvals || []);
    } catch (e) {
        renderExecApprovals([]);
    }

    // Load connection events
    try {
        const events = await gateway._request('audit.events', { limit: 50 });
        renderConnectionLog(events?.events || events || []);
    } catch (e) {
        renderConnectionLog([]);
    }

    // Load devices if available
    try {
        const devices = await gateway._request('devices.list', {});
        renderDevices(devices?.devices || devices || []);
    } catch (e) {
        renderDevices([]);
    }
}

function renderSecurityDisconnected() {
    const el = document.getElementById('exec-approvals');
    if (el) el.innerHTML = '<div class="empty-state">Connect to gateway</div>';
    const cl = document.getElementById('connection-log');
    if (cl) cl.innerHTML = '';
}

function renderExecApprovals(items) {
    const container = document.getElementById('exec-approvals');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 16px;">No pending approvals</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        const status = item.status || 'pending';
        const dotClass = status === 'approved' ? 'success' : status === 'denied' ? 'error' : 'warning';
        const time = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
        return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 10px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="status-dot ${dotClass}"></span>
                        <span style="font-weight: 600; font-size: 13px;">${escapeHtml(item.command || item.action || 'Unknown')}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        ${item.agent ? `Agent: ${escapeHtml(item.agent)} · ` : ''}${time}
                    </div>
                    ${item.reason ? `<div style="font-size: 11px; color: var(--text-muted);">Reason: ${escapeHtml(item.reason)}</div>` : ''}
                </div>
                ${status === 'pending' ? `
                <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button onclick="approveExec('${item.id}')" class="btn btn-primary" style="padding: 4px 10px; font-size: 11px;">Approve</button>
                    <button onclick="denyExec('${item.id}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px; color: var(--error);">Deny</button>
                </div>` : ''}
            </div>
        </div>`;
    }).join('');
}

window.approveExec = async function(id) {
    try {
        await gateway._request('exec.approvals.approve', { id });
        showToast('Approved', 'success');
        loadSecurityData();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.denyExec = async function(id) {
    try {
        await gateway._request('exec.approvals.deny', { id });
        showToast('Denied', 'success');
        loadSecurityData();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

function renderConnectionLog(events) {
    const container = document.getElementById('connection-log');
    if (!container) return;

    if (events.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No events recorded</div>';
        return;
    }

    container.innerHTML = events.slice(0, 30).map(ev => {
        const type = ev.type || ev.event || 'event';
        const icon = type.includes('connect') ? '🔗' : type.includes('disconnect') ? '🔌' : type.includes('error') ? '⚠️' : '📋';
        const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '';
        return `
        <div style="font-size: 11px; padding: 4px 0; display: flex; gap: 6px; border-bottom: 1px solid var(--border-default);">
            <span>${icon}</span>
            <span style="flex: 1;">${escapeHtml(ev.message || ev.description || type)}</span>
            <span style="color: var(--text-muted); flex-shrink: 0;">${time}</span>
        </div>`;
    }).join('');
}

function renderDevices(devices) {
    const container = document.getElementById('devices-list');
    if (!container) return;

    if (devices.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 8px;">No devices</div>';
        return;
    }

    container.innerHTML = devices.map(d => {
        return `
        <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border-default);">
            <span style="font-size: 16px;">💻</span>
            <div style="flex: 1;">
                <div style="font-size: 13px; font-weight: 500;">${escapeHtml(d.name || d.id || 'Unknown')}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${d.lastSeen ? new Date(d.lastSeen).toLocaleString() : ''}</div>
            </div>
            <span class="status-dot ${d.online ? 'success' : 'idle'}"></span>
        </div>`;
    }).join('');
}

// === sessions.js ===
// js/sessions.js — Session management, switching, agent selection

const SESSION_DEBUG = false;
function sessLog(...args) { if (SESSION_DEBUG) console.log(...args); }

// ===================
// SESSION MANAGEMENT
// ===================

// Agent persona names and role labels
const AGENT_PERSONAS = {
    'main': { name: 'Halo', role: 'PA' },
    'elon': { name: 'Elon', role: 'CoS' },
    'orion': { name: 'Orion', role: 'CTO' },
    'atlas': { name: 'Atlas', role: 'COO' },
    'sterling': { name: 'Sterling', role: 'CFO' },
    'vector': { name: 'Vector', role: 'CMP' },
    'dev': { name: 'Dev', role: 'ENG' },
    'forge': { name: 'Forge', role: 'DEVOPS' },
    'quill': { name: 'Quill', role: 'FE/UI' },
    'chip': { name: 'Chip', role: 'SWE' },
    'chase': { name: 'Chase', role: 'Content Ops' },
    'snip': { name: 'Snip', role: 'YT/VEO' },
    'knox': { name: 'Knox', role: 'SEC' },
    'sentinel': { name: 'Sentinel', role: 'NET' },
    'nova': { name: 'Nova', role: 'SMM (X/FB/IG/LI/Threads/Pinterest)' },
    'haven': { name: 'Haven', role: 'FAM' },
    'ledger': { name: 'Ledger', role: 'TAX' },
    'canon': { name: 'Canon', role: 'DOC' },
    'luma': { name: 'Luma', role: 'ART' }
};

// Helper to extract friendly name from session key (strips agent:agentId: prefix)
function normalizeDashboardSessionKey(key) {
    if (!key || key === 'main') return 'agent:main:main';

    // Auto-migrate legacy role-based IDs to canonical name-based IDs.
    const legacyMigrateMap = {
        'exec': 'elon',
        'cto': 'orion',
        'coo': 'atlas',
        'cfo': 'sterling',
        'cmp': 'vector',
        'devops': 'forge',
        'ui': 'quill',
        'swe': 'chip',
        'youtube': 'snip',
        'veo': 'snip',
        'veoflow': 'snip',
        'sec': 'knox',
        'net': 'sentinel',
        'smm': 'nova',
        'family': 'haven',
        'tax': 'ledger',
        'docs': 'canon',
        'creative': 'luma',
        'art': 'luma',
        'halo': 'main'
    };

    let normalized = key;
    const match = normalized.match(/^agent:([^:]+):(.+)$/);
    if (match) {
        const agentId = match[1];
        if (legacyMigrateMap[agentId]) {
            normalized = `agent:${legacyMigrateMap[agentId]}:${match[2]}`;
            console.log(`[Sessions] Auto-migrated legacy session ${key} -> ${normalized}`);
        }
    }

    return normalized;
}

function getFriendlySessionName(key) {
    if (!key) return 'Halo (PA)';
    const match = key.match(/^agent:([^:]+):(.+)$/);
    if (match) {
        const agentId = resolveAgentId(match[1]);
        const sessionSuffix = match[2];
        const persona = AGENT_PERSONAS[agentId];
        const name = persona ? persona.name : agentId.toUpperCase();

        if (sessionSuffix === 'main') return name;

        const cronMatch = sessionSuffix.match(/^cron:([a-f0-9-]{8,})$/i);
        if (cronMatch) {
            const jobId = cronMatch[1];
            const cronName = typeof window.getCronFriendlyNameById === 'function'
                ? window.getCronFriendlyNameById(jobId)
                : null;
            return cronName ? `${name} (${cronName})` : `${name} (cron:${jobId.slice(0, 8)}…)`;
        }

        return `${name} (${sessionSuffix})`;
    }
    return key;
}

// Initialize session variables on window for global access across modular scripts
window.currentSessionName = window.currentSessionName || null;

// Initialize currentSessionName from localStorage (browser is authoritative for session)
function initCurrentSessionName() {
    const localSession = localStorage.getItem('gateway_session');
    const gatewaySession = (typeof GATEWAY_CONFIG !== 'undefined' && GATEWAY_CONFIG?.sessionKey) ? GATEWAY_CONFIG.sessionKey : null;
    const preferredSession = localSession || gatewaySession || 'agent:main:main';
    const normalizedSession = normalizeDashboardSessionKey(preferredSession);

    // localStorage is authoritative (user's explicit choice)
    window.currentSessionName = normalizedSession;
    if (preferredSession !== normalizedSession) {
        try { localStorage.setItem('gateway_session', normalizedSession); } catch { }
        if (typeof GATEWAY_CONFIG !== 'undefined' && GATEWAY_CONFIG) {
            GATEWAY_CONFIG.sessionKey = normalizedSession;
        }
    }

    console.log('[initCurrentSessionName] localStorage:', localSession);
    console.log('[initCurrentSessionName] GATEWAY_CONFIG:', gatewaySession);
    console.log('[initCurrentSessionName] Final:', window.currentSessionName);
}

// Initialize immediately (before any other code uses it)
initCurrentSessionName();

window.toggleSessionMenu = function () {
    const menu = document.getElementById('session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

window.renameSession = async function () {
    toggleSessionMenu();
    const newName = prompt('Enter new session name:', window.currentSessionName);
    if (!newName || newName === window.currentSessionName) return;

    try {
        const response = await fetch('/api/session/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName: window.currentSessionName, newName })
        });

        if (response.ok) {
            window.currentSessionName = newName;
            const nameEl = document.getElementById('current-session-name');
            if (nameEl) nameEl.textContent = newName;
            showToast(`Session renamed to "${newName}"`, 'success');
        } else {
            const err = await response.json();
            showToast(`Failed to rename: ${err.error || 'Unknown error'}`, 'error');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to rename session:', e);
        showToast('Failed to rename session', 'error');
    }
}

window.showSessionSwitcher = function () {
    toggleSessionMenu();
    showToast('Session switcher coming soon', 'info');
}

// Chat Page Session Menu Functions
window.toggleChatPageSessionMenu = function () {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

// Close session menu when clicking outside
document.addEventListener('click', function (e) {
    const menu = document.getElementById('chat-page-session-menu');
    const trigger = e.target.closest('[onclick*="toggleChatPageSessionMenu"]');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !trigger) {
        menu.classList.add('hidden');
    }
});

// Session Management
let availableSessions = [];
window.availableSessions = availableSessions; // Shared session cache for other modules (agents dashboard, heatmap, sidebar, etc.)

function setAvailableSessions(next) {
    availableSessions = Array.isArray(next) ? next : [];
    window.availableSessions = availableSessions;
    return availableSessions;
}

window.currentAgentId = window.currentAgentId || 'main'; // Track which agent's sessions we're viewing
let _switchInFlight = false;
let _sessionSwitchQueue = []; // Queue array for rapid switches

// Legacy role IDs and old aliases that should resolve to name-based canonical IDs.
const LEGACY_AGENT_MAP = {
    'exec': 'elon',
    'cto': 'orion',
    'coo': 'atlas',
    'cfo': 'sterling',
    'cmp': 'vector',
    'devops': 'forge',
    'ui': 'quill',
    'swe': 'chip',
    'youtube': 'snip',
    'veo': 'snip',
    'veoflow': 'snip',
    'sec': 'knox',
    'net': 'sentinel',
    'smm': 'nova',
    'family': 'haven',
    'tax': 'ledger',
    'docs': 'canon',
    'creative': 'luma',
    'art': 'luma',
    'halo': 'main'
};

function resolveAgentId(id) {
    if (!id) return 'main';
    id = id.toLowerCase();
    return LEGACY_AGENT_MAP[id] || id;
}
window.resolveAgentId = resolveAgentId;

function migrateLegacyAgentSessionPrefs() {
    try {
        const key = 'agent_last_sessions';
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        let changed = false;
        const migrated = {};
        for (const [agentId, sessionKey] of Object.entries(parsed)) {
            const canonicalAgent = resolveAgentId(agentId);
            const canonicalSession = normalizeDashboardSessionKey(sessionKey);
            if (canonicalAgent !== agentId || canonicalSession !== sessionKey) changed = true;
            migrated[canonicalAgent] = canonicalSession;
        }
        if (changed) {
            localStorage.setItem(key, JSON.stringify(migrated));
            console.log('[Sessions] Migrated local agent session preferences to name-based IDs');
        }
    } catch { }
}
migrateLegacyAgentSessionPrefs();

// Get the agent ID from a session key (e.g., "agent:dev:main" -> "dev")
function getAgentIdFromSession(sessionKey) {
    const match = sessionKey?.match(/^agent:([^:]+):/);
    return match ? resolveAgentId(match[1]) : 'main';
}

// Filter sessions to only show those belonging to a specific agent
// Also includes spawned subagent sessions (agent:main:subagent:*) where the label starts with the agentId
// Example: agentId="dev" matches:
//   - agent:dev:main (direct match)
//   - agent:main:subagent:abc123 with label "dev-avatar-fix" (label prefix match)
function filterSessionsForAgent(sessions, agentId) {
    return sessions.filter(s => {
        // Direct match: session belongs to this agent
        const sessAgent = getAgentIdFromSession(s.key);
        if (sessAgent === agentId) return true;

        // Subagent match: spawned by main but labeled for this agent
        // Pattern: agent:main:subagent:* with label starting with "{agentId}-"
        if (s.key?.startsWith('agent:main:subagent:')) {
            const label = s.displayName || s.name || '';
            // Label pattern: {agentId}-{taskname} (e.g., "dev-avatar-fix", "cmp-marketing-research")
            if (label.toLowerCase().startsWith(agentId.toLowerCase() + '-')) {
                return true;
            }
        }

        return false;
    });
}

// Check URL parameters for auto-session connection
function checkUrlSessionParam() {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) {
        sessLog(`[Dashboard] URL session param detected: ${sessionParam}`);
        return sessionParam;
    }
    return null;
}

// For subagent sessions (agent:main:subagent:*), determine the correct agent from the label
// and update currentAgentId so the sidebar highlights correctly
function handleSubagentSessionAgent() {
    if (!currentSessionName?.startsWith('agent:main:subagent:')) {
        return; // Not a subagent session
    }

    // Find the session in availableSessions
    const session = availableSessions.find(s => s.key === currentSessionName);
    if (!session) {
        sessLog(`[Dashboard] Subagent session not found in available sessions: ${currentSessionName}`);
        return;
    }

    const label = session.displayName || session.name || '';
    sessLog(`[Dashboard] Subagent session label: ${label}`);

    // Extract agent ID from label pattern: {agentId}-{taskname}
    const labelMatch = label.match(/^([a-z]+)-/i);
    if (labelMatch) {
        const agentFromLabel = labelMatch[1].toLowerCase();
        sessLog(`[Dashboard] Determined agent from label: ${agentFromLabel}`);

        // Update current agent ID
        currentAgentId = agentFromLabel;

        // Update sidebar highlight
        setActiveSidebarAgent(agentFromLabel);

        // Update agent name display
        const agentNameEl = document.getElementById('chat-page-agent-name');
        if (agentNameEl) {
            agentNameEl.textContent = getAgentLabel(agentFromLabel);
        }
    }
}

let _fetchSessionsInFlight = false;
let _fetchSessionsQueued = false;

function _sessionTimestamp(value) {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function canonicalizeSessionEntries(entries) {
    const byKey = new Map();
    for (const entry of (entries || [])) {
        if (!entry || !entry.key) continue;
        const canonicalKey = normalizeDashboardSessionKey(entry.key);
        const normalized = { ...entry, key: canonicalKey };
        const existing = byKey.get(canonicalKey);
        if (!existing || _sessionTimestamp(normalized.updatedAt) >= _sessionTimestamp(existing.updatedAt)) {
            byKey.set(canonicalKey, normalized);
        }
    }
    return Array.from(byKey.values());
}

async function fetchSessions() {
    // Debounce: if already fetching, queue one follow-up call
    if (_fetchSessionsInFlight) { _fetchSessionsQueued = true; return availableSessions; }
    _fetchSessionsInFlight = true;

    try {
        // Preserve locally-added sessions that might not be in gateway yet
        const localSessions = canonicalizeSessionEntries(
            availableSessions
                .filter(s => s.sessionId === null)
                .map(s => ({ ...s, key: normalizeDashboardSessionKey(s.key) }))
        );

        // Try gateway first if connected (direct RPC call)
        if (gateway && gateway.isConnected()) {
            try {
                const result = await gateway.listSessions({});
                let sessions = result?.sessions || [];

                const gatewaySessions = canonicalizeSessionEntries(sessions.map(s => {
                    const friendlyName = getFriendlySessionName(s.key);
                    return {
                        key: normalizeDashboardSessionKey(s.key),
                        name: friendlyName,
                        displayName: friendlyName,
                        updatedAt: s.updatedAt,
                        totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                        model: s.model || 'unknown',
                        sessionId: s.sessionId
                    };
                }));

                const gatewayKeys = new Set(gatewaySessions.map(s => s.key));
                const mergedLocalSessions = localSessions.filter(s => !gatewayKeys.has(s.key));
                setAvailableSessions(canonicalizeSessionEntries([...gatewaySessions, ...mergedLocalSessions]));

                sessLog(`[Dashboard] Fetched ${gatewaySessions.length} from gateway + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);

                handleSubagentSessionAgent();
                try {
            if (typeof populateSessionDropdown === 'function') {
                populateSessionDropdown();
            }
        } catch (dropdownErr) {
            sessLog(`[Dashboard] Non-fatal populateSessionDropdown error: ${dropdownErr?.message || dropdownErr}`);
        }
                if (typeof updateSidebarAgentsFromSessions === 'function') {
                    try { updateSidebarAgentsFromSessions(availableSessions); } catch (e) { console.warn('[SidebarAgents] update failed:', e.message); }
                }
                subscribeToAllSessions();
                return availableSessions;
            } catch (e) {
                console.warn('[Dashboard] Gateway sessions.list failed, falling back to server:', e.message);
            }
        }

        // Fallback to server API
        const response = await fetch('/api/sessions');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const rawServerSessions = data.sessions || [];

        const serverSessions = canonicalizeSessionEntries(rawServerSessions.map(s => {
            const friendlyName = getFriendlySessionName(s.key);
            return {
                key: normalizeDashboardSessionKey(s.key),
                name: friendlyName,
                displayName: s.displayName || friendlyName,
                updatedAt: s.updatedAt,
                totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                model: s.model || 'unknown',
                sessionId: s.sessionId
            };
        }));

        const serverKeys = new Set(serverSessions.map(s => s.key));
        const mergedLocalSessions = localSessions.filter(s => !serverKeys.has(s.key));
        setAvailableSessions(canonicalizeSessionEntries([...serverSessions, ...mergedLocalSessions]));

        sessLog(`[Dashboard] Fetched ${serverSessions.length} from server + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);

        handleSubagentSessionAgent();
        populateSessionDropdown();
        if (typeof updateSidebarAgentsFromSessions === 'function') {
            try { updateSidebarAgentsFromSessions(availableSessions); } catch (e) { console.warn('[SidebarAgents] update failed:', e.message); }
        }
        return availableSessions;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch sessions:', e);
        return [];
    } finally {
        _fetchSessionsInFlight = false;
        if (_fetchSessionsQueued) { _fetchSessionsQueued = false; setTimeout(fetchSessions, 100); }
    }
}

function populateSessionDropdown() {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;

    // Filter sessions for current agent only
    const agentSessions = filterSessionsForAgent(availableSessions, currentAgentId);

    sessLog(`[Dashboard] populateSessionDropdown: agent=${currentAgentId}, total=${availableSessions.length}, filtered=${agentSessions.length}`);
    sessLog(`[Dashboard] Available sessions:`, availableSessions.map(s => s.key));

    // Build the dropdown HTML
    let html = '';

    // Header showing which agent's sessions we're viewing
    const agentLabel = getAgentLabel(currentAgentId);
    html += `<div style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
        <span>${escapeHtml(agentLabel)} Sessions</span>
        <button onclick="startNewAgentSession('${currentAgentId}')" style="background: var(--brand-red); color: white; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;" title="New session for ${agentLabel}">+ New</button>
    </div>`;

    if (agentSessions.length === 0) {
        html += '<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">No sessions for this agent yet</div>';
        menu.innerHTML = html;
        return;
    }

    html += agentSessions.map(s => {
        const isActive = s.key === currentSessionName;
        const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
        const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const friendlyFallback = getFriendlySessionName(s.key);
        const rawLabel = s.displayName || s.name || s.key || 'unnamed';
        const sessionLabel = (rawLabel && /\bcron:[a-f0-9-]{8,}\b/i.test(rawLabel)) ? friendlyFallback : (rawLabel || friendlyFallback);

        return `
        <div class="session-dropdown-item ${isActive ? 'active' : ''}" data-session-key="${s.key}" onclick="if(event.target.closest('.session-edit-btn')) return; switchToSession('${s.key}')">
            <div class="session-info">
                <div class="session-name">${escapeHtml(sessionLabel)}${unreadSessions.get(s.key) ? ` <span class="unread-badge" style="background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 18px; height: 18px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; margin-left: 4px;">${unreadSessions.get(s.key)}</span>` : ''}</div>
                <div class="session-meta">${dateStr} ${timeStr} • ${s.totalTokens?.toLocaleString() || 0} tokens</div>
            </div>
            <span class="session-model">${s.model}</span>
            <div class="session-actions">
                <button class="session-edit-btn" onclick="editSessionName('${s.key}', '${escapeHtml(sessionLabel)}')" title="Rename session">
                    ✏️
                </button>
                <button class="session-edit-btn" onclick="deleteSession('${s.key}', '${escapeHtml(sessionLabel)}')" title="Delete session" style="color: var(--error);">
                    🗑️
                </button>
            </div>
        </div>
        `;
    }).join('');

    menu.innerHTML = html;
}

// Get human-readable label for an agent ID (persona name)
function getAgentLabel(agentId) {
    const persona = AGENT_PERSONAS[agentId];
    return persona ? persona.name : agentId.toUpperCase();
}

// Get display name for message bubbles (e.g., "SoLoBot-CTO" or persona name)
function getAgentDisplayName(agentId) {
    if (!agentId || agentId === 'main') {
        return 'Halo (PA)';
    }
    const persona = AGENT_PERSONAS[agentId];
    if (persona) {
        return `${persona.name} (${persona.role})`;
    }
    return `SoLoBot-${agentId.toUpperCase()}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.editSessionName = function (sessionKey, currentName) {
    const newName = prompt('Enter new session name:', currentName);
    if (!newName || newName === currentName) return;

    fetch('/api/session/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName: sessionKey, newName })
    }).then(r => r.json()).then(result => {
        if (result.ok) {
            showToast(`Session rename requested. Will update shortly.`, 'success');
            // Update local display immediately
            const session = availableSessions.find(s => s.key === sessionKey);
            if (session) {
                session.displayName = newName;
                populateSessionDropdown();
                if (sessionKey === currentSessionName) {
                    const nameEl = document.getElementById('chat-page-session-name');
                    // Keep human-friendly label in header (cron sessions resolve to cron job name)
                    if (nameEl) {
                        const headerLabel = session.displayName || getFriendlySessionName(sessionKey);
                        nameEl.textContent = headerLabel;
                        nameEl.title = sessionKey;
                    }
                }
            }
        } else {
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    }).catch(e => {
        console.error('[Dashboard] Failed to rename session:', e);
        showToast('Failed to rename session', 'error');
    });
}

window.deleteSession = async function (sessionKey, sessionName) {
    // Don't allow deleting the current active session
    if (sessionKey === currentSessionName) {
        showToast('Cannot delete the active session. Switch to another session first.', 'warning');
        return;
    }

    // Confirm deletion
    if (!confirm(`Delete session "${sessionName}"?\n\nThis will permanently delete all messages in this session.`)) {
        return;
    }

    try {
        // Use gateway RPC to delete the session
        if (gateway && gateway.isConnected()) {
            const result = await gateway.request('sessions.delete', { sessionKey });
            if (result && result.ok) {
                showToast(`Session "${sessionName}" deleted`, 'success');
                // Remove from local list
                setAvailableSessions(availableSessions.filter(s => s.key !== sessionKey));
                populateSessionDropdown();
            } else {
                showToast(`Failed to delete: ${result?.error || 'Unknown error'}`, 'error');
            }
        } else {
            showToast('Not connected to gateway', 'error');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to delete session:', e);
        showToast('Failed to delete session: ' + e.message, 'error');
    }
}

window.switchToSessionKey = window.switchToSession = async function (sessionKey) {
    sessionKey = normalizeDashboardSessionKey(sessionKey);

    // Keep only the latest requested session to avoid A→B→C lag (drop stale middle clicks).
    _sessionSwitchQueue.push({ sessionKey, timestamp: Date.now() });
    if (_sessionSwitchQueue.length > 1) {
        const latest = _sessionSwitchQueue[_sessionSwitchQueue.length - 1];
        _sessionSwitchQueue = [latest];
    }

    // If switch already in progress, latest request will run after current completes.
    if (_switchInFlight) {
        return;
    }

    while (_sessionSwitchQueue.length > 0) {
        // Always execute the most recent queued request (LIFO for responsiveness)
        const { sessionKey: nextKey } = _sessionSwitchQueue.pop();
        _sessionSwitchQueue.length = 0; // hard-drop stale queued targets

        if (nextKey === currentSessionName) {
            populateSessionDropdown();
            continue;
        }

        await executeSessionSwitch(nextKey);
    }
}

// Core switch execution (no queue handling)
async function executeSessionSwitch(sessionKey) {
    _switchInFlight = true;
    const switchStart = performance.now();

    try {
        try {
            if (typeof toggleChatPageSessionMenu === 'function') {
                toggleChatPageSessionMenu();
            }
        } catch (menuErr) {
            sessLog(`[Dashboard] Non-fatal menu toggle error: ${menuErr?.message || menuErr}`);
        }

        // Clear unread notifications for this session
        clearUnreadForSession(sessionKey);

        showToast(`Switching to ${getFriendlySessionName(sessionKey)}...`, 'info');

        // Save current chat in the background (don't block UX switch path)
        saveCurrentChat().catch(() => {});
        cacheSessionMessages(currentSessionName || GATEWAY_CONFIG.sessionKey, state.chat.messages);

        // THEN: nuke all rendering state synchronously
        streamingText = '';
        _streamingSessionKey = '';
        isProcessing = false;
        state.chat.messages = [];
        renderChat();
        renderChatPage();

        // 2. Increment session version to invalidate any in-flight history loads
        sessionVersion++;
        sessLog(`[Dashboard] Session version now ${sessionVersion}`);

        // 3. Update session config and input field
        const oldSessionName = currentSessionName;
        currentSessionName = sessionKey;
        GATEWAY_CONFIG.sessionKey = sessionKey;
        localStorage.setItem('gateway_session', sessionKey);
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;

        // 3a. Update current agent ID from session key
        const agentMatch = sessionKey.match(/^agent:([^:]+):/);
        if (agentMatch) {
            currentAgentId = resolveAgentId(agentMatch[1]);
            // Force sync UI immediately (before async work)
            if (typeof forceSyncActiveAgent === 'function') {
                forceSyncActiveAgent(currentAgentId);
            }
        }

        // 4. Clear current chat display
        try {
            if (typeof clearChatHistory === 'function') {
                await clearChatHistory(true, true);
            } else {
                state.chat.messages = [];
                if (typeof renderChat === 'function') renderChat();
                if (typeof renderChatPage === 'function') renderChatPage();
            }
        } catch (clearErr) {
            sessLog(`[Dashboard] Non-fatal clearChatHistory error: ${clearErr?.message || clearErr}`);
            state.chat.messages = [];
            if (typeof renderChat === 'function') renderChat();
            if (typeof renderChatPage === 'function') renderChatPage();
        }

        // 4a. Check in-memory cache for instant switch
        const cached = getCachedSessionMessages(sessionKey);
        if (cached && cached.length > 0) {
            state.chat.messages = cached.slice();
            if (typeof renderChatPage === 'function') renderChatPage();
            sessLog(`[Dashboard] Restored ${cached.length} cached messages for ${sessionKey}`);
        }

        // 5. Switch gateway session key (no disconnect/reconnect needed)
        // Add small delay to allow gateway state to stabilize
        await new Promise(r => setTimeout(r, 50));

        if (gateway && gateway.isConnected()) {
            gateway.setSessionKey(sessionKey);
        } else if (gateway) {
            sessLog(`[Dashboard] Gateway not connected, initiating connect...`);
            connectToGateway();
        }

        // 6. Load history + model override in parallel (not sequential)
        const historyPromise = loadSessionHistory(sessionKey);
        const modelPromise = applySessionModelOverride(sessionKey).catch(() => { });

        // Update UI immediately (don't wait for network)
        const nameEl = document.getElementById('chat-page-session-name');
        if (nameEl) {
            nameEl.textContent = getFriendlySessionName(sessionKey);
            nameEl.title = sessionKey;
        }
        populateSessionDropdown();

        // Persist active agent/session mapping immediately for correctness
        try {
            if (agentMatch) {
                const canonicalAgent = (typeof resolveAgentId === 'function')
                    ? resolveAgentId(agentMatch[1])
                    : agentMatch[1];
                if (typeof setActiveSidebarAgent === 'function') {
                    setActiveSidebarAgent(canonicalAgent);
                }
                if (typeof saveLastAgentSession === 'function') {
                    saveLastAgentSession(canonicalAgent, sessionKey);
                }
            } else if (typeof setActiveSidebarAgent === 'function') {
                setActiveSidebarAgent(null);
            }
        } catch (agentUiErr) {
            sessLog(`[Dashboard] Non-fatal agent UI sync error for ${sessionKey}: ${agentUiErr?.message || agentUiErr}`);
        }

        // Do not block switch completion on network history/model fetch.
        historyPromise.catch((e) => sessLog(`[Dashboard] history refresh failed for ${sessionKey}: ${e?.message || e}`));
        modelPromise.catch(() => {});

        const switchMs = Math.round(performance.now() - switchStart);
        sessLog(`[Dashboard] Session switch UI complete in ${switchMs}ms -> ${sessionKey}`);
        showToast(`Switched to ${getFriendlySessionName(sessionKey)}`, 'success');
    } catch (e) {
        console.error('[Dashboard] Failed to switch session:', e);
        try {
            sessLog(`[Dashboard] switch error for ${sessionKey}: ${e?.message || e}`);
        } catch {}
        showToast(`Failed to switch session: ${e?.message || 'unknown error'}`, 'error');
    } finally {
        _switchInFlight = false;
    }
}

// Navigate to a session by key - can be called from external links
// Usage: window.goToSession('agent:main:subagent:abc123')
// Or via URL: ?session=agent:main:subagent:abc123
window.goToSession = async function (sessionKey) {
    sessionKey = normalizeDashboardSessionKey(sessionKey);
    if (!sessionKey) {
        showToast('No session key provided', 'warning');
        return;
    }

    sessLog(`[Dashboard] goToSession called with: ${sessionKey}`);

    // Wait for gateway to be connected
    if (!gateway || !gateway.isConnected()) {
        showToast('Connecting to gateway...', 'info');
        // If not connected, set the session key and let auto-connect handle it
        GATEWAY_CONFIG.sessionKey = sessionKey;
        currentSessionName = sessionKey;
        localStorage.setItem('gateway_session', sessionKey);  // Persist for reload
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;

        // Try to connect
        if (GATEWAY_CONFIG.host) {
            connectToGateway();
        } else {
            showToast('Please configure gateway settings first', 'warning');
        }
        return;
    }

    // Show chat page first
    showPage('chat');

    // Switch to the session
    await switchToSession(sessionKey);
}

// Generate a URL for a specific session (for sharing/linking)
window.getSessionUrl = function (sessionKey) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?session=${encodeURIComponent(sessionKey)}`;
}

async function saveCurrentChat() {
    // Save current chat messages to state as safeguard
    try {
        const response = await fetch('/api/state');
        const serverState = await response.json();

        // Save chat history to archivedChats
        if (!serverState.archivedChats) serverState.archivedChats = {};
        serverState.archivedChats[currentSessionName] = {
            savedAt: Date.now(),
            messages: state.chat.messages.slice(-100) // Fix #5: was chatHistory (undefined), now state.chat.messages
        };

        await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverState)
        });
    } catch (e) {
        // Silently fail - safeguard is optional
    }
}

async function loadSessionHistory(sessionKey) {
    const loadVersion = sessionVersion;
    const normalizedSessionKey = normalizeDashboardSessionKey(sessionKey);

    function sessionLikelyHasHistory(targetSessionKey) {
        const session = availableSessions.find(s => s.key === targetSessionKey);
        if (!session) return false;
        const tokens = Number(session.totalTokens || 0);
        return Number.isFinite(tokens) && tokens > 0;
    }

    // Helper: attempt to load from gateway
    async function tryGatewayLoad(attempt = 1) {
        if (!gateway || !gateway.isConnected()) return false;
        try {
            const result = await gateway.loadHistory();
            if (loadVersion !== sessionVersion) {
                sessLog(`[Dashboard] Ignoring stale history load for ${sessionKey}`);
                return true; // Stale but don't retry
            }
            const messages = Array.isArray(result?.messages) ? result.messages : [];
            if (messages.length > 0) {
                if (state.chat?.messages?.length > 0) {
                    mergeHistoryMessages(messages);
                } else {
                    loadHistoryMessages(messages);
                }
                sessLog(`[Dashboard] Loaded ${messages.length} messages from gateway for ${sessionKey}`);
                return true;
            }

            // Gateway session switch can race with immediate history fetch.
            // If this session is known to have tokens, retry once before falling back.
            if (attempt < 2 && sessionLikelyHasHistory(normalizedSessionKey)) {
                sessLog(`[Dashboard] Empty history on attempt ${attempt} for ${sessionKey}; retrying once`);
                await new Promise(r => setTimeout(r, 350));
                if (loadVersion !== sessionVersion) return true;
                return tryGatewayLoad(attempt + 1);
            }

            // Empty history is still a valid load result.
            return true;
        } catch (e) {
            console.warn('[Dashboard] Gateway history failed:', e.message);
        }
        return false;
    }

    // Try gateway first
    if (await tryGatewayLoad()) return;

    // If gateway wasn't connected, wait briefly for reconnect and retry
    if (gateway && !gateway.isConnected()) {
        sessLog(`[Dashboard] Gateway disconnected during switch to ${sessionKey}, waiting for reconnect...`);
        await new Promise(r => setTimeout(r, 2000));
        if (loadVersion !== sessionVersion) return; // Session changed again
        if (await tryGatewayLoad()) return;
    }

    // Fallback: check in-memory cache
    const cached = getCachedSessionMessages(sessionKey);
    if (cached && cached.length > 0) {
        state.chat.messages = cached.slice();
        renderChat();
        renderChatPage();
        sessLog(`[Dashboard] Loaded ${cached.length} cached messages for ${sessionKey}`);
        return;
    }

    // Last resort: render empty (gateway is source of truth)
    sessLog(`[Dashboard] No history available for ${sessionKey} — rendering empty`);
    renderChat();
    renderChatPage();
}

async function loadArchivedChat(sessionKey) {
    // Just render empty — gateway.loadHistory() is the primary source now
    // Previously this fetched entire /api/state which was very expensive
    chatHistory = [];
    renderChat();
    renderChatPage();
}

// Sessions are fetched when gateway connects (see initGateway onConnected)
// No need to fetch on DOMContentLoaded — gateway isn't connected yet

function initGateway() {
    gateway = new GatewayClient({
        sessionKey: GATEWAY_CONFIG.sessionKey,
        onConnected: (serverName, sessionKey) => {
            sessLog(`[Dashboard] Connected to ${serverName}, session: ${sessionKey}`);
            updateConnectionUI('connected', serverName);

            // On reconnect, the gateway client reports whatever sessionKey it has.
            // If the user switched sessions while disconnected, currentSessionName
            // is authoritative — re-sync the gateway client to match.
            const intendedSession = normalizeDashboardSessionKey(
                GATEWAY_CONFIG.sessionKey || currentSessionName || sessionKey
            );
            if (sessionKey !== intendedSession) {
                sessLog(`[Dashboard] Reconnect mismatch: gateway=${sessionKey}, intended=${intendedSession}. Re-syncing gateway.`);
                if (gateway) gateway.setSessionKey(intendedSession);
            }
            GATEWAY_CONFIG.sessionKey = intendedSession;
            currentSessionName = intendedSession;

            // Fetch live model config from gateway (populates dropdowns),
            // then apply per-session override (authoritative model display).
            fetchModelsFromGateway().then(() => applySessionModelOverride(intendedSession));

            // Update session name displays
            const nameEl = document.getElementById('current-session-name');
            const friendlySessionLabel = getFriendlySessionName(intendedSession);
            if (nameEl) {
                nameEl.textContent = friendlySessionLabel;
                nameEl.title = intendedSession;
            }
            const chatPageNameEl = document.getElementById('chat-page-session-name');
            if (chatPageNameEl) {
                chatPageNameEl.textContent = friendlySessionLabel;
                chatPageNameEl.title = intendedSession;
            }

            // Remember this session for the agent
            const agentMatch = intendedSession.match(/^agent:([^:]+):/);
            if (agentMatch) saveLastAgentSession(resolveAgentId(agentMatch[1]), intendedSession);

            checkRestartToast();

            // Load chat history on connect (one-time full load)
            _historyRefreshInFlight = true;
            _lastHistoryLoadTime = Date.now();
            const loadVersion = sessionVersion;
            gateway.loadHistory().then(result => {
                _historyRefreshInFlight = false;
                if (loadVersion !== sessionVersion) {
                    sessLog(`[Dashboard] Ignoring stale history (version ${loadVersion} != ${sessionVersion})`);
                    return;
                }
                if (result?.messages) {
                    // Fix #2: On initial connect, always do a full authoritative replace from gateway.
                    // This ensures hard refresh always shows the correct session's messages.
                    // mergeHistoryMessages() is reserved for the incremental poll path (_doHistoryRefresh).
                    sessLog(`[Dashboard] onConnected: full history replace with ${result.messages.length} messages`);
                    loadHistoryMessages(result.messages);
                }
            }).catch(() => { _historyRefreshInFlight = false; });

            // Poll history periodically (guarded — won't overlap with initial load)
            startHistoryPolling();

            // Fetch sessions list from gateway (now that we're connected)
            fetchSessions();
        },
        onDisconnected: (message) => {
            updateConnectionUI('disconnected', message);
            isProcessing = false;
            streamingText = '';
            stopHistoryPolling();
        },
        onChatEvent: (event) => {
            handleChatEvent(event);
        },
        onToolEvent: (event) => {
            // Add tool event to terminal in real-time
            if ((event.phase === 'start' || event.phase === 'complete' || event.phase === 'end' || event.phase === 'done') && event.summary) {
                addTerminalLog(event.phase === 'start' ? event.summary : `✅ ${event.summary}`, 'info', event.timestamp);
            }
        },
        onPresenceEvent: (event) => {
            if (window.AgentPresence && typeof window.AgentPresence.ingestEvent === 'function') {
                window.AgentPresence.ingestEvent(event);
            }
        },
        onCrossSessionMessage: (msg) => {
            handleCrossSessionNotification(msg);
        },
        onError: (error) => {
            console.error(`[Dashboard] Gateway error: ${error}`);
            updateConnectionUI('error', error);
        }
    });
}


// ===================
// NEW SESSION MODAL
// ===================

let newSessionModalResolve = null;

window.openNewSessionModal = function (defaultValue) {
    return new Promise((resolve) => {
        newSessionModalResolve = resolve;
        const modal = document.getElementById('new-session-modal');
        const input = document.getElementById('new-session-name-input');
        if (modal && input) {
            input.value = defaultValue || '';
            modal.classList.add('visible');
            // Focus and select all text
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);
        } else {
            resolve(null);
        }
    });
};

window.closeNewSessionModal = function (value) {
    const modal = document.getElementById('new-session-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
    if (newSessionModalResolve) {
        newSessionModalResolve(value);
        newSessionModalResolve = null;
    }
};

window.submitNewSessionModal = function () {
    const input = document.getElementById('new-session-name-input');
    const value = input ? input.value : null;
    closeNewSessionModal(value);
};

// Handle Enter key in new session modal
document.addEventListener('keydown', function (e) {
    const modal = document.getElementById('new-session-modal');
    if (modal && modal.classList.contains('visible')) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitNewSessionModal();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeNewSessionModal(null);
        }
    }
});

// Start a new session for a specific agent
window.startNewAgentSession = async function (agentId) {
    // Close dropdown first
    toggleChatPageSessionMenu();

    // Generate default name with timestamp: MM/DD/YYYY hh:mm:ss AM/PM
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const defaultTimestamp = `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;

    const agentLabel = getAgentLabel(agentId);

    // Open custom modal instead of browser prompt
    const userInput = await openNewSessionModal(defaultTimestamp);
    if (!userInput || !userInput.trim()) return;

    // Always prepend agent ID to the session name (lowercase)
    const sessionName = `${agentId.toLowerCase()}-${userInput.trim()}`;

    // Build the full session key: agent:{agentId}:{agentId}-{userInput}
    const sessionKey = `agent:${agentId}:${sessionName}`;

    // Check if session already exists
    if (availableSessions.some(s => s.key === sessionKey)) {
        showToast(`Session "${userInput.trim()}" already exists. Switching to it.`, 'info');
        await switchToSession(sessionKey);
        return;
    }

    showToast(`Creating new ${agentLabel} session "${userInput.trim()}"...`, 'info');

    // Increment session version to invalidate any in-flight history loads
    sessionVersion++;
    sessLog(`[Dashboard] Session version now ${sessionVersion} (new agent session)`);

    // Clear local chat and cache
    state.chat.messages = [];
    state.system.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;
    localStorage.removeItem(chatStorageKey());

    // Update agent context
    currentAgentId = agentId;

    // Render immediately to show empty chat
    renderChat();
    renderChatPage();

    // Switch gateway to new session
    currentSessionName = sessionKey;
    GATEWAY_CONFIG.sessionKey = sessionKey;
    // Persist for reload - save to BOTH localStorage AND server state
    localStorage.setItem('gateway_session', sessionKey);
    // Also update server state so refresh doesn't revert to stale cached session
    if (typeof saveGatewaySettings === 'function') {
        saveGatewaySettings(
            GATEWAY_CONFIG.host,
            GATEWAY_CONFIG.port,
            GATEWAY_CONFIG.token,
            sessionKey
        );
    } else if (typeof state !== 'undefined' && state.gatewayConfig) {
        // Fallback: update server state directly if saveGatewaySettings unavailable
        state.gatewayConfig.sessionKey = sessionKey;
        if (typeof saveState === 'function') saveState('Updated session for reload');
    }

    // Update session input field
    const sessionInput = document.getElementById('gateway-session');
    if (sessionInput) sessionInput.value = sessionKey;

    // Update session display (show user's input, not the full session name with agent prefix)
    const displayName = userInput.trim();
    const nameEl = document.getElementById('chat-page-session-name');
    if (nameEl) nameEl.textContent = displayName;

    // Clear streaming state from previous session to prevent cross-session bleed
    streamingText = '';
    isProcessing = false;

    // Switch gateway to new session key (no disconnect needed)
    if (gateway && gateway.isConnected()) {
        gateway.setSessionKey(sessionKey);
    } else if (gateway) {
        connectToGateway();
    }

    // Add new session to availableSessions locally (gateway won't return it until there's activity)
    const newSession = {
        key: sessionKey,
        name: sessionName,
        displayName: displayName,  // Display without agent prefix for cleaner UI
        updatedAt: Date.now(),
        totalTokens: 0,
        model: currentModel || 'unknown',
        sessionId: null
    };

    // Add to beginning of list (most recent)
    availableSessions.unshift(newSession);

    // Refresh sessions list from gateway (will merge with our local addition)
    await fetchSessions();

    // Ensure our new session is still in the list (in case fetchSessions didn't include it)
    if (!availableSessions.some(s => s.key === sessionKey)) {
        availableSessions.unshift(newSession);
    }

    populateSessionDropdown();
    setActiveSidebarAgent(agentId);

    renderChat();
    renderChatPage();
    renderSystemPage();

    showToast(`New ${agentLabel} session "${displayName}" created`, 'success');
}

// Legacy function - creates session for current agent
window.startNewSession = async function () {
    await startNewAgentSession(currentAgentId);
}


// ===================
// SESSION SEARCH
// ===================

let sessionSearchQuery = '';

function filterSessionsBySearch(sessions, query) {
    if (!query) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(s => {
        const name = (s.displayName || s.name || s.key || '').toLowerCase();
        const model = (s.model || '').toLowerCase();
        return name.includes(q) || model.includes(q);
    });
}

// Update populateSessionDropdown to include search
const originalPopulateSessionDropdown = window.populateSessionDropdown;
if (typeof originalPopulateSessionDropdown === 'function') {
    window.populateSessionDropdown = function () {
        // Call original first
        originalPopulateSessionDropdown();

        // Then add search functionality if not already present
        const dropdown = document.getElementById('chat-page-session-menu');
        if (dropdown && !dropdown.querySelector('.session-search')) {
            const searchDiv = document.createElement('div');
            searchDiv.className = 'session-search';
            searchDiv.innerHTML = `
                <input type="text" placeholder="Search sessions..." 
                       oninput="filterSessionDropdown(this.value)"
                       onclick="event.stopPropagation()">
            `;
            dropdown.insertBefore(searchDiv, dropdown.firstChild);
        }
    };
}

window.filterSessionDropdown = function (query) {
    sessionSearchQuery = query;
    const dropdown = document.getElementById('chat-page-session-menu');
    if (!dropdown) return;

    const items = dropdown.querySelectorAll('.session-menu-item');
    const q = query.toLowerCase();

    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? '' : 'none';
    });
};
// js/gateway.js — Gateway connection, init, restart, connection UI

// ===================
// GATEWAY CONNECTION
// ===================

async function checkRestartToast() {
    try {
        const response = await fetch('/api/state');
        if (!response.ok) return;
        const state = await response.json();
        if (state.restartPending) {
            showNotificationToast('Gateway', 'Gateway restarted successfully');
            delete state.restartPending;
            await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            });
        }
    } catch (e) {
        console.warn('[Dashboard] Restart toast check failed:', e);
    }
}

// === sidebar-agents.js ===
// js/sidebar-agents.js — Dynamic sidebar Agents list (hide/reorder)
//
// Features:
// - Drag-and-drop reordering (persisted to localStorage)
// - Manual hide/show per agent (persisted)
// - Optional auto-hide inactive agents based on recent session activity
//
// Storage keys
const SIDEBAR_AGENTS_ORDER_KEY = 'sidebar_agents_order_v1';
const SIDEBAR_AGENTS_HIDDEN_KEY = 'sidebar_agents_hidden_v1';
const SIDEBAR_AGENTS_PREFS_KEY = 'sidebar_agents_prefs_v1';

// Grouping / departments
const SIDEBAR_AGENT_DEPT_OVERRIDES_KEY = 'sidebar_agents_dept_overrides_v1';
const SIDEBAR_AGENT_GROUP_COLLAPSED_KEY = 'sidebar_agents_group_collapsed_v1';
const SIDEBAR_AGENT_ORDER_BY_DEPT_KEY = 'sidebar_agents_order_by_dept_v1';

// Note: AGENT_ID_ALIASES, DEFAULT_DEPARTMENTS, ALLOWED_AGENT_IDS, 
// normalizeAgentId, getAgentDepartment are now in utils.js

const DEPARTMENT_ORDER = ['Executive', 'Technology', 'Operations', 'Marketing & Product', 'Finance', 'Family / Household', 'Other'];

function getSidebarAgentsPrefs() {
    try {
        return JSON.parse(localStorage.getItem(SIDEBAR_AGENTS_PREFS_KEY) || '{}');
    } catch {
        return {};
    }
}

function setSidebarAgentsPrefs(prefs) {
    try {
        localStorage.setItem(SIDEBAR_AGENTS_PREFS_KEY, JSON.stringify(prefs || {}));
    } catch { }
}

function getSidebarAgentsHiddenSet() {
    try {
        const arr = JSON.parse(localStorage.getItem(SIDEBAR_AGENTS_HIDDEN_KEY) || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function setSidebarAgentsHiddenSet(set) {
    try {
        localStorage.setItem(SIDEBAR_AGENTS_HIDDEN_KEY, JSON.stringify(Array.from(set || [])));
    } catch { }
}

function getSidebarAgentsOrder() {
    // Legacy global order (kept for backwards compatibility)
    try {
        const arr = JSON.parse(localStorage.getItem(SIDEBAR_AGENTS_ORDER_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function setSidebarAgentsOrder(order) {
    try {
        localStorage.setItem(SIDEBAR_AGENTS_ORDER_KEY, JSON.stringify(order || []));
    } catch { }
}

function getSidebarDeptOverrides() {
    try {
        const raw = JSON.parse(localStorage.getItem(SIDEBAR_AGENT_DEPT_OVERRIDES_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function setSidebarDeptOverrides(map) {
    try {
        localStorage.setItem(SIDEBAR_AGENT_DEPT_OVERRIDES_KEY, JSON.stringify(map || {}));
    } catch { }
}

function getSidebarCollapsedGroupsSet() {
    try {
        const arr = JSON.parse(localStorage.getItem(SIDEBAR_AGENT_GROUP_COLLAPSED_KEY) || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function setSidebarCollapsedGroupsSet(set) {
    try {
        localStorage.setItem(SIDEBAR_AGENT_GROUP_COLLAPSED_KEY, JSON.stringify(Array.from(set || [])));
    } catch { }
}

function getSidebarOrderByDept() {
    try {
        const raw = JSON.parse(localStorage.getItem(SIDEBAR_AGENT_ORDER_BY_DEPT_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function setSidebarOrderByDept(map) {
    try {
        localStorage.setItem(SIDEBAR_AGENT_ORDER_BY_DEPT_KEY, JSON.stringify(map || {}));
    } catch { }
}

// Note: normalizeAgentId is now in utils.js

function getAgentDepartment(agentId) {
    const overrides = getSidebarDeptOverrides();
    const normalized = normalizeAgentId(agentId);
    return overrides[normalized] || DEFAULT_DEPARTMENTS[normalized] || 'Other';
}

function setAgentDepartment(agentId, dept) {
    const overrides = getSidebarDeptOverrides();
    overrides[normalizeAgentId(agentId)] = dept;
    setSidebarDeptOverrides(overrides);
}

function getSidebarAgentsContainer() {
    return document.getElementById('sidebar-agents-list');
}

function getSidebarAgentElements() {
    const container = getSidebarAgentsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.sidebar-agent[data-agent]'));
}

function getSidebarGroupElements() {
    const container = getSidebarAgentsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.sidebar-agent-group[data-dept]'));
}

function getGroupListEl(dept) {
    const container = getSidebarAgentsContainer();
    if (!container) return null;
    return container.querySelector(`.sidebar-agent-group[data-dept="${CSS.escape(dept)}"] .sidebar-agent-group-list`);
}

function applySidebarAgentsOrder() {
    // Apply ordering within each department group.
    const byDept = getSidebarOrderByDept();

    for (const groupEl of getSidebarGroupElements()) {
        const dept = groupEl.getAttribute('data-dept');
        const listEl = groupEl.querySelector('.sidebar-agent-group-list');
        if (!dept || !listEl) continue;

        const desired = Array.isArray(byDept[dept]) ? byDept[dept] : [];
        if (!desired.length) continue;

        const els = Array.from(listEl.querySelectorAll('.sidebar-agent[data-agent]'));
        const map = new Map(els.map(el => [el.getAttribute('data-agent'), el]));

        for (const id of desired) {
            const el = map.get(id);
            if (el) listEl.appendChild(el);
            map.delete(id);
        }
        for (const el of map.values()) listEl.appendChild(el);

        // Save normalized order for this group
        const normalized = Array.from(listEl.querySelectorAll('.sidebar-agent[data-agent]')).map(el => el.getAttribute('data-agent'));
        byDept[dept] = normalized;
    }

    setSidebarOrderByDept(byDept);
}

function applySidebarAgentsHidden() {
    const hidden = getSidebarAgentsHiddenSet();
    for (const el of getSidebarAgentElements()) {
        const id = el.getAttribute('data-agent');
        const isHidden = hidden.has(id);
        el.classList.toggle('is-hidden', isHidden);
    }
}

function computeLastActivityByAgent(sessions) {
    const lastByAgent = {};
    for (const s of (sessions || [])) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const rawAgentId = match ? match[1] : 'main';
        const agentId = window.resolveAgentId ? window.resolveAgentId(rawAgentId) : rawAgentId;
        const ts = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
        if (!lastByAgent[agentId] || ts > lastByAgent[agentId]) {
            lastByAgent[agentId] = ts;
        }
    }
    return lastByAgent;
}

function updateSidebarAgentActivityIndicators(sessions) {
    const prefs = getSidebarAgentsPrefs();
    const hideInactive = prefs.hideInactive === true;
    const inactivityMs = typeof prefs.inactivityMs === 'number' ? prefs.inactivityMs : 15 * 60 * 1000;

    const lastByAgent = computeLastActivityByAgent(sessions);
    const now = Date.now();

    for (const el of getSidebarAgentElements()) {
        const id = el.getAttribute('data-agent');
        const last = lastByAgent[id] || 0;
        const age = last ? (now - last) : Infinity;

        el.dataset.lastActivity = String(last || '');
        el.classList.toggle('is-inactive', age > inactivityMs);
        el.classList.toggle('is-never-active', !last);

        // Auto-hide (but never hide main)
        const shouldAutoHide = hideInactive && id !== 'main' && (age > inactivityMs);
        el.classList.toggle('auto-hidden', shouldAutoHide);
    }
}

// Called from sessions.js after fetchSessions(), if present
function updateSidebarAgentsFromSessions(availableSessions) {
    updateSidebarAgentActivityIndicators(availableSessions);
    applySidebarAgentsHidden();
}

let sidebarAgentsDragging = false;

function persistDeptOrdersFromDOM() {
    const byDept = {};
    for (const groupEl of getSidebarGroupElements()) {
        const dept = groupEl.getAttribute('data-dept');
        const listEl = groupEl.querySelector('.sidebar-agent-group-list');
        if (!dept || !listEl) continue;
        byDept[dept] = Array.from(listEl.querySelectorAll('.sidebar-agent[data-agent]'))
            .map(el => el.getAttribute('data-agent'));
    }
    setSidebarOrderByDept(byDept);
}

function setupSidebarAgentsDragAndDrop() {
    const els = getSidebarAgentElements();
    if (!els.length) return;

    // Make agent elements draggable + ensure handle
    for (const el of els) {
        el.setAttribute('draggable', 'true');
        el.classList.add('draggable');

        if (!el.querySelector('.agent-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'agent-drag-handle';
            handle.title = 'Drag to reorder';
            handle.textContent = '⠿';
            handle.addEventListener('click', (e) => e.stopPropagation());
            handle.addEventListener('mousedown', (e) => e.stopPropagation());
            el.insertBefore(handle, el.firstChild);
        }

        el.addEventListener('dragstart', (e) => {
            sidebarAgentsDragging = true;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.getAttribute('data-agent') || '');
        });

        el.addEventListener('dragend', () => {
            sidebarAgentsDragging = false;
            el.classList.remove('dragging');
            persistDeptOrdersFromDOM();
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId) return;

            const draggedEl = document.querySelector(`.sidebar-agent[data-agent="${CSS.escape(draggedId)}"]`);
            if (!draggedEl || draggedEl === el) return;

            // If dropped onto an agent, insert before it (within that agent's department list)
            const targetDept = el.getAttribute('data-dept') || getAgentDepartment(el.getAttribute('data-agent'));
            const listEl = getGroupListEl(targetDept);
            if (!listEl) return;

            // Re-home if moved across departments
            if (draggedEl.getAttribute('data-dept') !== targetDept) {
                setAgentDepartment(draggedId, targetDept);
            }

            listEl.insertBefore(draggedEl, el);
            draggedEl.setAttribute('data-dept', targetDept);
            persistDeptOrdersFromDOM();
        });
    }

    // Allow dropping into empty space within a department group
    for (const groupEl of getSidebarGroupElements()) {
        const dept = groupEl.getAttribute('data-dept');
        const listEl = groupEl.querySelector('.sidebar-agent-group-list');
        const headerEl = groupEl.querySelector('.sidebar-agent-group-header');
        if (!dept || !listEl) continue;

        const onDropIntoGroup = (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId) return;
            const draggedEl = document.querySelector(`.sidebar-agent[data-agent="${CSS.escape(draggedId)}"]`);
            if (!draggedEl) return;

            if (draggedEl.getAttribute('data-dept') !== dept) {
                setAgentDepartment(draggedId, dept);
            }

            listEl.appendChild(draggedEl);
            draggedEl.setAttribute('data-dept', dept);
            persistDeptOrdersFromDOM();
        };

        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        listEl.addEventListener('drop', onDropIntoGroup);

        // Header drop = quick move to group (Notion-ish)
        if (headerEl) {
            headerEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            headerEl.addEventListener('drop', onDropIntoGroup);
        }
    }

    // Guard: if user clicks while dragging, ignore
    els.forEach(el => {
        el.addEventListener('click', (e) => {
            if (sidebarAgentsDragging) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    });
}

function openSidebarAgentsModal() {
    const modal = document.getElementById('sidebar-agents-modal');
    if (!modal) return;
    renderSidebarAgentsModal();
    modal.classList.add('visible');
}

function closeSidebarAgentsModal() {
    const modal = document.getElementById('sidebar-agents-modal');
    if (!modal) return;
    modal.classList.remove('visible');
}

function renderSidebarAgentsModal() {
    const list = document.getElementById('sidebar-agents-modal-list');
    const hideInactive = document.getElementById('sidebar-hide-inactive');
    const inactivity = document.getElementById('sidebar-inactivity-threshold');
    if (!list || !hideInactive || !inactivity) return;

    const prefs = getSidebarAgentsPrefs();
    const hiddenSet = getSidebarAgentsHiddenSet();

    hideInactive.checked = prefs.hideInactive === true;
    const inactivityMs = typeof prefs.inactivityMs === 'number' ? prefs.inactivityMs : 15 * 60 * 1000;
    inactivity.value = String(inactivityMs);

    const agents = getSidebarAgentElements().map(el => {
        const id = el.getAttribute('data-agent');
        const labelEl = el.querySelector('.sidebar-item-text');
        const label = labelEl ? labelEl.textContent.trim() : id;
        const last = Number(el.dataset.lastActivity || 0);
        return { id, label, last };
    });

    agents.sort((a, b) => {
        // Use sidebar order as primary ordering
        return 0;
    });

    list.innerHTML = agents.map(a => {
        const checked = !hiddenSet.has(a.id);
        const lastText = a.last ? (typeof timeAgo === 'function' ? timeAgo(a.last) : '') : 'no activity';
        return `
            <label class="sidebar-agent-pref-row">
                <input type="checkbox" data-agent="${a.id}" ${checked ? 'checked' : ''} />
                <span class="sidebar-agent-pref-label">${a.label}</span>
                <span class="sidebar-agent-pref-meta">${lastText}</span>
            </label>
        `;
    }).join('');

    // Bind checkboxes
    list.querySelectorAll('input[type="checkbox"][data-agent]').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-agent');
            if (!id) return;
            const nextHidden = getSidebarAgentsHiddenSet();
            if (cb.checked) nextHidden.delete(id); else nextHidden.add(id);
            setSidebarAgentsHiddenSet(nextHidden);
            applySidebarAgentsHidden();
        });
    });

    hideInactive.onchange = () => {
        const next = getSidebarAgentsPrefs();
        next.hideInactive = hideInactive.checked;
        next.inactivityMs = Number(inactivity.value || 0) || 15 * 60 * 1000;
        setSidebarAgentsPrefs(next);
        updateSidebarAgentActivityIndicators(window.availableSessions || []);
        applySidebarAgentsHidden();
    };

    inactivity.onchange = () => {
        const next = getSidebarAgentsPrefs();
        next.hideInactive = hideInactive.checked;
        next.inactivityMs = Number(inactivity.value || 0) || 15 * 60 * 1000;
        setSidebarAgentsPrefs(next);
        updateSidebarAgentActivityIndicators(window.availableSessions || []);
        applySidebarAgentsHidden();
    };
}

function resetSidebarAgentsOrder() {
    try {
        localStorage.removeItem(SIDEBAR_AGENTS_ORDER_KEY);
        localStorage.removeItem(SIDEBAR_AGENT_ORDER_BY_DEPT_KEY);
        localStorage.removeItem(SIDEBAR_AGENT_DEPT_OVERRIDES_KEY);
        localStorage.removeItem(SIDEBAR_AGENT_GROUP_COLLAPSED_KEY);
    } catch { }
    // Reload page for clean order restore
    location.reload();
}

function setupSidebarAgentsManageButton() {
    const btn = document.getElementById('sidebar-agents-manage-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebarAgentsModal();
    });
}

// Avatar resolution: check for .png first, fall back to .svg, then emoji/initial
const AVATAR_EXTENSIONS = ['png', 'svg'];

// Avatar resolution - now uses centralized function from utils.js
// Keeping wrapper for backward compatibility
function resolveAvatarUrl(agentId) {
    return getAvatarUrl(agentId);
}

function agentDisplayName(agent) {
    const id = normalizeAgentId(agent.id || agent.name);
    const persona = (typeof AGENT_PERSONAS !== 'undefined') && AGENT_PERSONAS[id];
    if (persona) return `${persona.name} (${persona.role})`;
    if (agent.isDefault || id === 'main') return 'Halo (PA)';
    const name = agent.name || id;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function sanitizeAgentEmoji(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    // Reject template/noise phrases leaking from uninitialized IDENTITY.md files.
    if (/your signature|pick one|workspace-relative|data uri|ghost in the machine/i.test(v)) return '';
    // Keep short values only (emoji, small token).
    if (v.length > 8) return '';
    return v;
}

async function loadSidebarAgents() {
    const container = document.getElementById('sidebar-agents-list');
    if (!container) return;

    try {
        const response = await fetch('/api/agents');
        const data = await response.json();
        const agents = data.agents || [];

        // Include main agent (it's excluded from /api/agents since it uses the shared workspace)
        // Add it at the front if not present
        const hasMain = agents.some(a => normalizeAgentId(a.id) === 'main' || a.isDefault);
        const allAgentsRaw = hasMain ? agents : [{ id: 'main', name: 'main', emoji: '', isDefault: true }, ...agents];

        // Normalize IDs, dedupe alias/canonical duplicates, and drop unknown/noise IDs.
        // This prevents stray workspace names or template text from becoming sidebar agents.
        const dedupedByCanonicalId = new Map();
        for (const agent of allAgentsRaw) {
            const canonicalId = normalizeAgentId(agent.id);
            if (!ALLOWED_AGENT_IDS.has(canonicalId)) continue;

            const existing = dedupedByCanonicalId.get(canonicalId);
            const normalizedAgent = {
                ...agent,
                id: canonicalId,
                isDefault: canonicalId === 'main' || agent.isDefault === true
            };

            // Prefer canonical/native entries over alias entries when both exist
            if (!existing || existing.id !== canonicalId || agent.id === canonicalId) {
                dedupedByCanonicalId.set(canonicalId, normalizedAgent);
            }
        }

        const allAgents = Array.from(dedupedByCanonicalId.values());

        // Sort: default first, then by id
        allAgents.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return (a.id || '').localeCompare(b.id || '');
        });

        // Group agents by department
        const groups = {};
        for (const agent of allAgents) {
            const dept = getAgentDepartment(agent.id);
            groups[dept] = groups[dept] || [];
            groups[dept].push(agent);
        }

        // Stable group order (Notion-ish)
        const groupNames = Array.from(new Set([
            ...DEPARTMENT_ORDER,
            ...Object.keys(groups).sort()
        ])).filter((d) => groups[d] && groups[d].length > 0);

        // Apply stored per-dept ordering, or default sort by id
        const orderByDept = getSidebarOrderByDept();
        for (const dept of groupNames) {
            const desired = Array.isArray(orderByDept[dept]) ? orderByDept[dept] : [];
            if (!desired.length) {
                groups[dept].sort((a, b) => {
                    if (a.isDefault) return -1;
                    if (b.isDefault) return 1;
                    return (a.id || '').localeCompare(b.id || '');
                });
                continue;
            }

            const map = new Map(groups[dept].map(a => [a.id, a]));
            const ordered = [];
            for (const id of desired) {
                const a = map.get(id);
                if (a) ordered.push(a);
                map.delete(id);
            }
            for (const a of map.values()) ordered.push(a);
            groups[dept] = ordered;
        }

        const collapsed = getSidebarCollapsedGroupsSet();

        container.innerHTML = groupNames.map((dept) => {
            const isCollapsed = collapsed.has(dept);
            const listHtml = groups[dept].map(agent => {
                const avatarUrl = resolveAvatarUrl(agent.id);
                const displayName = agentDisplayName(agent);
                const emoji = sanitizeAgentEmoji(agent.emoji);
                const fallbackInitial = (agent.name || agent.id).charAt(0).toUpperCase();

                return `
                    <div class="sidebar-agent" data-agent="${agent.id}" data-dept="${dept}">
                        <img class="agent-avatar"
                             src="${avatarUrl}"
                             alt="${agent.id}"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <span class="agent-avatar-fallback" style="display:none; width:28px; height:28px; border-radius:50%; background:var(--surface-3); align-items:center; justify-content:center; font-size:14px; flex-shrink:0;">
                            ${emoji || fallbackInitial}
                        </span>
                        <span class="sidebar-item-text">${displayName}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="sidebar-agent-group" data-dept="${dept}">
                    <div class="sidebar-agent-group-header" role="button" tabindex="0" title="Toggle ${dept}">
                        <span class="sidebar-agent-group-caret">${isCollapsed ? '▶' : '▼'}</span>
                        <span class="sidebar-agent-group-title">${dept}</span>
                        <span class="sidebar-agent-group-count">${groups[dept].length}</span>
                    </div>
                    <div class="sidebar-agent-group-list" style="${isCollapsed ? 'display:none;' : ''}">
                        ${listHtml}
                    </div>
                </div>
            `;
        }).join('');

        // Group collapse handlers
        for (const groupEl of getSidebarGroupElements()) {
            const dept = groupEl.getAttribute('data-dept');
            const header = groupEl.querySelector('.sidebar-agent-group-header');
            const list = groupEl.querySelector('.sidebar-agent-group-list');
            const caret = groupEl.querySelector('.sidebar-agent-group-caret');
            if (!dept || !header || !list || !caret) continue;

            const toggle = () => {
                const set = getSidebarCollapsedGroupsSet();
                const nowCollapsed = !set.has(dept);
                if (nowCollapsed) set.add(dept); else set.delete(dept);
                setSidebarCollapsedGroupsSet(set);
                const isCollapsedNow = set.has(dept);
                list.style.display = isCollapsedNow ? 'none' : '';
                caret.textContent = isCollapsedNow ? '▶' : '▼';
            };

            header.addEventListener('click', (e) => {
                // Don't collapse when dropping onto header
                if (sidebarAgentsDragging) return;
                e.preventDefault();
                e.stopPropagation();
                toggle();
            });

            header.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        }

        // Re-init after dynamic load
        applySidebarAgentsOrder();
        applySidebarAgentsHidden();
        setupSidebarAgentsDragAndDrop();

        // Re-attach click handlers (setupSidebarAgents from chat.js)
        if (typeof setupSidebarAgents === 'function') {
            setupSidebarAgents();
        }

        if (window.availableSessions) {
            updateSidebarAgentActivityIndicators(window.availableSessions);
        }

        // Re-apply unread badges after sidebar re-render (notifications.js)
        if (typeof updateUnreadBadges === 'function') {
            updateUnreadBadges();
        }

        console.log(`[Sidebar] Loaded ${allAgents.length} agents dynamically`);
    } catch (e) {
        console.warn('[Sidebar] Failed to load agents:', e.message);
    }
}

function initSidebarAgentsUI() {
    setupSidebarAgentsManageButton();
    // Load agents dynamically from API
    loadSidebarAgents();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSidebarAgentsUI, 50);
});

// Expose a couple functions for inline onclick handlers
window.openSidebarAgentsModal = openSidebarAgentsModal;
window.closeSidebarAgentsModal = closeSidebarAgentsModal;
window.resetSidebarAgentsOrder = resetSidebarAgentsOrder;
window.updateSidebarAgentsFromSessions = updateSidebarAgentsFromSessions;

// === skills-mgr.js ===
// js/skills-mgr.js - Skills Manager page

let skillsList = [];
let skillsInterval = null;
let skillsPageBound = false;
const SKILLS_CACHE_KEY = 'skillsStatusCache.v1';

const skillsUi = {
    search: '',
    onlyIssues: false,
    status: '',      // 'enabled', 'disabled', or ''
    source: '',      // 'bundled', 'installed', 'clawhub', or ''
    agent: ''       // agent id or ''
};

function getHiddenSkills() {
    try { return JSON.parse(localStorage.getItem('hiddenSkills') || '[]'); } catch { return []; }
}

function setHiddenSkills(arr) {
    localStorage.setItem('hiddenSkills', JSON.stringify(arr));
}

function initSkillsPage() {
    bindSkillsPageControls();
    loadSkills({ useCache: true });

    if (skillsInterval) clearInterval(skillsInterval);
    skillsInterval = setInterval(() => loadSkills({ useCache: false }), 60000);
}

function readSkillsCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(SKILLS_CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.skills)) return null;
        return cached;
    } catch {
        return null;
    }
}

function writeSkillsCache(skills) {
    try {
        localStorage.setItem(SKILLS_CACHE_KEY, JSON.stringify({ ts: Date.now(), skills }));
    } catch {}
}

function getSkillAssignedAgent(skill) {
    const explicit = String(skill?.assignedAgent || '').trim().toLowerCase();
    if (explicit) return explicit;

    const candidates = [
        skill?.name,
        skill?.id,
        skill?.skillKey,
        skill?.path,
        skill?.directory,
    ]
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase());

    const knownAgents = [
        'halo', 'nova', 'luma', 'vector', 'canon', 'snip', 'haven', 'dev', 'sterling'
    ];

    for (const candidate of candidates) {
        for (const agent of knownAgents) {
            if (candidate === agent || candidate.startsWith(`${agent}-`) || candidate.includes(`/${agent}-`) || candidate.includes(`/${agent}/`)) {
                return agent;
            }
        }
    }

    return '';
}

function bindSkillsPageControls() {
    if (skillsPageBound) return;
    skillsPageBound = true;

    // Search input
    const search = document.getElementById('skills-search');
    if (search) {
        search.addEventListener('input', () => {
            skillsUi.search = (search.value || '').trim().toLowerCase();
            renderSkills();
            updateActiveFilters();
        });
    }

    // Issues toggle
    const onlyIssues = document.getElementById('skills-only-issues');
    if (onlyIssues) {
        onlyIssues.addEventListener('change', () => {
            skillsUi.onlyIssues = Boolean(onlyIssues.checked);
            renderSkills();
            updateActiveFilters();
        });
    }

    // Refresh button
    const refresh = document.getElementById('skills-refresh');
    if (refresh) {
        refresh.addEventListener('click', () => loadSkills({ useCache: false }));
    }

    // Clear filters button
    const clearBtn = document.getElementById('skills-clear-filters');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            skillsUi.search = '';
            skillsUi.onlyIssues = false;
            skillsUi.status = '';
            skillsUi.source = '';
            skillsUi.agent = '';
            
            if (search) search.value = '';
            if (onlyIssues) onlyIssues.checked = false;
            
            // Reset dropdowns
            document.querySelectorAll('.skills-filter-popover-trigger').forEach(trigger => {
                const filter = trigger.dataset.filter;
                trigger.classList.remove('open');
                trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.value === '');
                });
                const valueEl = document.getElementById(`skills-${filter}-value`);
                if (valueEl) valueEl.textContent = filter === 'agent' ? 'All' : 'All';
            });
            
            renderSkills();
            updateActiveFilters();
        });
    }

    // Filter popover triggers
    document.querySelectorAll('.skills-filter-popover-trigger').forEach(trigger => {
        const filter = trigger.dataset.filter;
        const dropdown = trigger.querySelector('.skills-filter-dropdown');
        
        // Click on trigger to toggle
        trigger.querySelector('.skills-filter-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close other open dropdowns
            document.querySelectorAll('.skills-filter-popover-trigger.open').forEach(t => {
                if (t !== trigger) t.classList.remove('open');
            });
            
            trigger.classList.toggle('open');
        });
        
        // Click on options
        dropdown.querySelectorAll('.skills-filter-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const label = option.textContent;
                
                // Update active state
                dropdown.querySelectorAll('.skills-filter-option').forEach(opt => {
                    opt.classList.toggle('active', opt === option);
                });
                
                // Update UI
                const valueEl = document.getElementById(`skills-${filter}-value`);
                if (valueEl) valueEl.textContent = label;
                
                // Update state
                if (filter === 'status') skillsUi.status = value;
                else if (filter === 'source') skillsUi.source = value;
                else if (filter === 'agent') skillsUi.agent = value;
                
                // Close dropdown
                trigger.classList.remove('open');
                
                renderSkills();
                updateActiveFilters();
            });
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.skills-filter-popover-trigger')) {
            document.querySelectorAll('.skills-filter-popover-trigger.open').forEach(t => {
                t.classList.remove('open');
            });
        }
    });
}

async function loadSkills({ useCache = true } = {}) {
    const container = document.getElementById('skills-list');
    if (!container) return;

    const startedAt = performance.now();

    if (useCache) {
        const cached = readSkillsCache();
        if (cached?.skills?.length) {
            skillsList = cached.skills;
            renderSkills();
            console.log(`[Perf][Skills] Rendered cached skills in ${Math.round(performance.now() - startedAt)}ms (${skillsList.length} skills)`);
        }
    }

    if (!gateway || !gateway.isConnected()) {
        if (!skillsList.length) {
            container.innerHTML = '<div class="empty-state">Connect to gateway to view skills</div>';
        }
        return;
    }

    try {
        // Prefer skills.status (rich, includes install options + requirements).
        // Fallback to skills.list for older gateways.
        let result;
        let source = 'skills.status';
        try {
            result = await gateway._request('skills.status', {});
            skillsList = result?.skills || [];
        } catch (e) {
            source = 'skills.list';
            result = await gateway._request('skills.list', {});
            skillsList = result?.skills || result || [];
        }

        writeSkillsCache(skillsList);
        renderSkills();
        console.log(`[Perf][Skills] ${source} + render: ${Math.round(performance.now() - startedAt)}ms (${Array.isArray(skillsList) ? skillsList.length : 0} skills)`);
    } catch (e) {
        console.warn('[Skills] Failed:', e.message);
        if (!skillsList.length) {
            container.innerHTML = '<div class="empty-state">Could not load skills. The skills RPC may not be available.</div>';
        }
    }
}

function skillHasIssues(skill) {
    // When skills.status is available, entries include missing + eligibility flags.
    const missing = skill?.missing || {};
    const missingCount = (missing.bins?.length || 0) + (missing.anyBins?.length || 0) + (missing.env?.length || 0) + (missing.config?.length || 0) + (missing.os?.length || 0);
    return Boolean(skill?.disabled || skill?.blockedByAllowlist || skill?.eligible === false || missingCount > 0);
}

function renderMissingBadges(skill) {
    const missing = skill?.missing || {};
    const blocks = [];

    const add = (label, items) => {
        if (!items || items.length === 0) return;
        const text = items.map(escapeHtml).join(', ');
        blocks.push(`<div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">
            <span style="font-weight: 600; color: var(--warning);">Missing ${escapeHtml(label)}:</span> ${text}
        </div>`);
    };

    add('bins', missing.bins);
    add('any bins', missing.anyBins);
    add('env', missing.env);
    add('config', missing.config);
    add('os', missing.os);

    if (skill?.blockedByAllowlist) {
        blocks.push(`<div style="margin-top: 6px; font-size: 11px; color: var(--error);">
            Blocked by bundled allowlist
        </div>`);
    }

    return blocks.join('');
}

function skillIsReady(skill) {
    // "Ready" means prerequisites/binaries are present.
    // This is NOT the same thing as "installed" (many skills are bundled).
    const missing = skill?.missing || {};
    const missingBins = (missing.bins?.length || 0) + (missing.anyBins?.length || 0);
    return missingBins === 0;
}

function renderInstallButtons(skill) {
    const options = skill?.install || [];
    if (!Array.isArray(options) || options.length === 0) return '';

    const name = skill?.name;
    if (!name) return '';

    // Show "Reinstall" if the skill is already installed:
    // - gateway explicitly reports installed=true, OR
    // - the skill has install options AND all required bins are present (ready)
    const ready = skillIsReady(skill);
    const installed = skill?.installed === true || ready;

    const readyBadge = ready
        ? `<span class="badge" style="background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.25); color: var(--success); padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;">Ready</span>`
        : '';

    const buttons = options.map(opt => {
        const baseLabel = opt?.label || 'Install';
        const installId = opt?.id;
        if (!installId) return '';

        const label = installed ? 'Reinstall' : baseLabel;
        const klass = installed ? 'btn btn-ghost' : 'btn btn-primary';

        return `<button class="${klass}" style="padding: 4px 10px; font-size: 11px;" onclick="installSkill('${escapeHtml(name)}','${escapeHtml(installId)}')">${escapeHtml(label)}</button>`;
    }).join('');

    return [readyBadge, buttons].filter(Boolean).join('');
}

function renderSkills() {
    const container = document.getElementById('skills-list');
    if (!container) return;

    if (!Array.isArray(skillsList) || skillsList.length === 0) {
        // If it's an object, convert
        if (typeof skillsList === 'object' && !Array.isArray(skillsList)) {
            skillsList = Object.entries(skillsList).map(([name, data]) => ({
                name, ...(typeof data === 'object' ? data : { status: data })
            }));
        }

        if (!skillsList || skillsList.length === 0) {
            container.innerHTML = '<div class="empty-state">No skills installed</div>';
            return;
        }
    }

    const query = skillsUi.search;
    const filtered = skillsList
        .filter(skill => {
            const name = (skill?.name || skill?.id || '').toString();
            const desc = (skill?.description || '').toString();
            const key = (skill?.skillKey || '').toString();
            if (!query) return true;
            return name.toLowerCase().includes(query) || desc.toLowerCase().includes(query) || key.toLowerCase().includes(query);
        })
        .filter(skill => {
            if (!skillsUi.status) return true;
            const enabled = !skill?.disabled && skill?.enabled !== false;
            if (skillsUi.status === 'enabled') return enabled;
            if (skillsUi.status === 'disabled') return !enabled;
            return true;
        })
        .filter(skill => {
            if (!skillsUi.source) return true;
            if (skillsUi.source === 'bundled') return skill?.bundled === true;
            if (skillsUi.source === 'installed') return skill?.installed === true;
            if (skillsUi.source === 'clawhub') return skill?.source === 'clawhub';
            return true;
        })
        .filter(skill => {
            if (!skillsUi.agent) return true;
            return getSkillAssignedAgent(skill) === skillsUi.agent;
        })
        .filter(skill => skillsUi.onlyIssues ? skillHasIssues(skill) : true)
        .sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));

    container.innerHTML = filtered.map(skill => {
        const name = skill?.name || skill?.id || 'Unknown';
        const skillKey = skill?.skillKey || name;
        const enabled = skill?.disabled ? false : (skill?.enabled !== false);

        const eligible = skill?.eligible;
        const showEligible = typeof eligible === 'boolean';

        const dotClass = (!enabled || skill?.disabled)
            ? 'idle'
            : (eligible === true ? 'success' : eligible === false ? 'error' : 'idle');

        const desc = skill?.description || '';
        const emoji = skill?.emoji || '🧩';
        const source = skill?.source ? `• ${escapeHtml(skill.source)}` : '';
        const assignedAgent = getSkillAssignedAgent(skill);

        const topBadges = [
            showEligible ? (eligible ? '<span style="font-size: 10px; color: var(--success);">Ready</span>' : '<span style="font-size: 10px; color: var(--warning);">Needs attention</span>') : '',
            skill?.bundled ? '<span style="font-size: 10px; color: var(--text-muted);">Bundled</span>' : '',
            skill?.always ? '<span style="font-size: 10px; color: var(--text-muted);">Always</span>' : '',
        ].filter(Boolean).join('<span style="opacity:.35">•</span>');

        const installButtons = renderInstallButtons(skill);
        const missingBadges = renderMissingBadges(skill);

        const homepage = skill?.homepage ? `<a href="${escapeHtml(skill.homepage)}" target="_blank" style="font-size: 11px; color: var(--accent); text-decoration: none;">Homepage</a>` : '';

        return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; margin-bottom: 10px;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="status-dot ${dotClass}"></span>
                        <span style="font-weight: 650; font-size: 14px;">${escapeHtml(emoji)} ${escapeHtml(name)}</span>
                        ${topBadges ? `<span style="font-size: 10px; color: var(--text-muted);">${topBadges}</span>` : ''}
                        ${source ? `<span style="font-size: 10px; color: var(--text-muted);">${source}</span>` : ''}
                    </div>
                    ${desc ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(desc)}</div>` : ''}
                    <div style="margin-top: 6px; display:flex; align-items:center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-size: 10px; color: var(--text-faint);">skillKey: <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(skillKey)}</span></span>
                        ${assignedAgent ? `<span style="font-size: 10px; color: var(--text-faint);">agent: <span style="text-transform: capitalize;">${escapeHtml(assignedAgent)}</span></span>` : ''}
                        ${homepage}
                    </div>
                    ${missingBadges}
                </div>

                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
                    ${installButtons}
                    <button onclick="viewSkillFiles('${escapeHtml(skillKey)}', '${escapeHtml(skill?.path || '')}')"
                            class="btn btn-ghost"
                            style="padding: 4px 10px; font-size: 11px;"
                            title="View and edit skill files">
                        📂 Files
                    </button>
                    <button onclick="openEditSkillModal('${escapeHtml(skillKey)}')"
                            class="btn btn-ghost"
                            style="padding: 4px 10px; font-size: 11px;"
                            title="Edit skill settings">
                        ✏️ Edit
                    </button>
                    <button onclick="toggleSkill('${escapeHtml(skillKey)}', ${enabled ? 'false' : 'true'})"
                            class="btn ${enabled ? 'btn-ghost' : 'btn-primary'}"
                            style="padding: 4px 10px; font-size: 11px;">
                        ${enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onclick="promptSetApiKey('${escapeHtml(skillKey)}', '${escapeHtml(skill?.primaryEnv || '')}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px;">
                        Set key
                    </button>
                    <button onclick="promptSetEnv('${escapeHtml(skillKey)}', ${escapeHtml(JSON.stringify(skill?.missing?.env || []))})" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px;">
                        Set env
                    </button>
                    ${skill?.bundled
                        ? `<button onclick="toggleHideSkill('${escapeHtml(skillKey)}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px; color: var(--text-muted);">
                            ${getHiddenSkills().includes(skillKey) ? '👁 Unhide' : '🙈 Hide'}
                          </button>`
                        : `<button onclick="uninstallSkill('${escapeHtml(skillKey)}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px; color: var(--error);">
                            🗑 Uninstall
                          </button>`
                    }
                </div>
            </div>
        </div>`;
    }).join('');

    if (!container.innerHTML.trim()) {
        container.innerHTML = '<div class="empty-state">No matching skills</div>';
    }
}

function showInstallModal(title, subtitle, body) {
    const titleEl = document.getElementById('skills-install-modal-title');
    const subtitleEl = document.getElementById('skills-install-modal-subtitle');
    const bodyEl = document.getElementById('skills-install-modal-body');

    if (titleEl) titleEl.textContent = title || 'Skill installer';
    if (subtitleEl) subtitleEl.textContent = subtitle || '';
    if (bodyEl) bodyEl.textContent = body || '';

    showModal('skills-install-modal');
}

window.installSkill = async function(name, installId) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    showInstallModal(`Installing ${name}`, `Installer: ${installId}`, 'Running…');

    try {
        const result = await gateway._request('skills.install', { name, installId }, 600000);

        const warnings = Array.isArray(result?.warnings) && result.warnings.length > 0
            ? `\n\nWARNINGS:\n- ${result.warnings.join('\n- ')}`
            : '';

        const out = [
            `ok: ${String(result?.ok)}`,
            result?.message ? `message: ${result.message}` : '',
            typeof result?.code !== 'undefined' ? `code: ${String(result.code)}` : '',
            '',
            result?.stdout ? `STDOUT:\n${result.stdout}` : 'STDOUT: (empty)',
            '',
            result?.stderr ? `STDERR:\n${result.stderr}` : 'STDERR: (empty)',
        ].filter(Boolean).join('\n');

        showInstallModal(`Install: ${name}`, `Installer: ${installId}`, out + warnings);

        showToast(result?.ok ? 'Install complete' : 'Install failed', result?.ok ? 'success' : 'error');
        loadSkills();
    } catch (e) {
        showInstallModal(`Install: ${name}`, `Installer: ${installId}`, `ERROR: ${e.message}`);
        showToast('Install failed: ' + e.message, 'error');
    }
};

window.toggleSkill = async function(skillKey, enable) {
    try {
        await gateway._request('skills.update', { skillKey, enabled: enable });
        showToast(`Skill ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.promptSetApiKey = async function(skillKey, primaryEnv) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    const envName = primaryEnv || `${skillKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    const apiKey = window.prompt(`Enter API key for ${skillKey} (${envName}).\n\nLeave blank to clear.`);
    if (apiKey === null) return; // cancelled

    try {
        // Store both as apiKey (legacy) and as the proper env var
        await gateway._request('skills.update', { skillKey, apiKey, env: { [envName]: apiKey } });
        showToast(`Saved ${envName}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.promptSetEnv = async function(skillKey, missingEnv) {
    if (!gateway || !gateway.isConnected()) {
        showToast('Connect to gateway first', 'warning');
        return;
    }

    // Pre-fill with first missing env var if available
    const defaultKey = Array.isArray(missingEnv) && missingEnv.length > 0 ? missingEnv[0] : '';
    const key = window.prompt(`Env var name for ${skillKey} (e.g., FOO_TOKEN).${defaultKey ? `\n\nMissing: ${missingEnv.join(', ')}` : ''}\n\nLeave blank to cancel.`, defaultKey);
    if (key === null) return;
    const trimmedKey = (key || '').trim();
    if (!trimmedKey) return;

    const value = window.prompt(`Enter value for ${trimmedKey}.\n\nLeave blank to clear this key.`);
    if (value === null) return;

    try {
        await gateway._request('skills.update', { skillKey, env: { [trimmedKey]: value } });
        showToast(`Saved ${trimmedKey}`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

// ========== Skill File Viewer/Editor ==========

let currentSkillFiles = [];
let currentSkillPath = '';
let currentSkillName = '';
let currentEditingFile = null;

window.viewSkillFiles = async function(skillKey, skillPath) {
    currentSkillPath = skillPath || '';
    currentSkillName = skillKey;

    const titleEl = document.getElementById('skill-files-modal-title');
    const treeEl = document.getElementById('skill-files-tree');
    const previewEl = document.getElementById('skill-file-preview');

    if (titleEl) titleEl.textContent = `📂 ${skillKey}`;
    if (treeEl) treeEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">Loading...</div>';
    if (previewEl) previewEl.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">Select a file to view</div>';

    showModal('skill-files-modal');

    try {
        // Use dashboard API for file listing
        const resp = await fetch(`/api/skills/${encodeURIComponent(skillKey)}/files`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load files');
        }
        const result = await resp.json();
        currentSkillFiles = result?.files || [];
        currentSkillPath = result?.path || skillPath || '';

        if (currentSkillFiles.length === 0) {
            if (treeEl) treeEl.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">No files found</div>';
            return;
        }

        renderSkillFilesTree(currentSkillFiles);

        // Auto-open SKILL.md if present
        const skillMd = currentSkillFiles.find(f => f.name === 'SKILL.md' || f.relativePath === 'SKILL.md');
        if (skillMd) {
            previewSkillFile(skillMd.relativePath || 'SKILL.md');
        }
    } catch (e) {
        console.warn('[Skills] Failed to load files:', e.message);
        if (treeEl) treeEl.innerHTML = `<div style="color: var(--error); padding: 8px;">Error: ${escapeHtml(e.message)}</div>`;
    }
};

function renderSkillFilesTree(files) {
    const container = document.getElementById('skill-files-tree');
    if (!container) return;

    // Build tree structure from relativePath
    const tree = {};
    for (const f of files) {
        const relPath = f.relativePath || f.name || '';
        const parts = relPath.split('/').filter(Boolean);

        let node = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                if (!node._files) node._files = [];
                node._files.push({ ...f, fileName: part, relPath: relPath });
            } else {
                if (!node[part]) node[part] = {};
                node = node[part];
            }
        }
    }

    container.innerHTML = renderSkillTreeNode(tree, '');
}

function renderSkillTreeNode(node, prefix) {
    let html = '';

    // Render subdirectories first
    const dirs = Object.keys(node).filter(k => k !== '_files').sort();
    for (const dir of dirs) {
        html += `
        <div class="skill-tree-dir" onclick="toggleSkillTreeDir(this)" style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; border-radius: 4px;">
            <span class="tree-chevron" style="font-size: 10px; color: var(--text-muted);">▶</span>
            <span style="font-size: 12px;">📁 ${escapeHtml(dir)}</span>
        </div>
        <div class="skill-tree-children hidden" style="padding-left: 16px;">
            ${renderSkillTreeNode(node[dir], prefix ? `${prefix}/${dir}` : dir)}
        </div>`;
    }

    // Render files
    const files = node._files || [];
    for (const f of files.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''))) {
        const icon = getFileIcon(f.fileName);
        html += `
        <div class="skill-tree-file" onclick="previewSkillFile('${escapeHtml(f.relPath)}')"
             style="display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 12px;"
             onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
            <span>${icon}</span>
            <span>${escapeHtml(f.fileName)}</span>
        </div>`;
    }

    return html;
}

function getFileIcon(fileName) {
    if (!fileName) return '📄';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const icons = {
        'md': '📝',
        'py': '🐍',
        'sh': '🔧',
        'js': '📜',
        'json': '📋',
        'yaml': '📋',
        'yml': '📋',
        'txt': '📄',
    };
    return icons[ext] || '📄';
}

window.toggleSkillTreeDir = function(el) {
    const children = el.nextElementSibling;
    if (!children) return;
    const chevron = el.querySelector('.tree-chevron');
    if (children.classList.contains('hidden')) {
        children.classList.remove('hidden');
        if (chevron) chevron.textContent = '▼';
    } else {
        children.classList.add('hidden');
        if (chevron) chevron.textContent = '▶';
    }
};

window.previewSkillFile = async function(relPath) {
    const preview = document.getElementById('skill-file-preview');
    if (!preview) return;

    preview.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">Loading...</div>';
    currentEditingFile = relPath;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load file');
        }
        const result = await resp.json();
        const content = result?.content || '';
        const fileName = relPath.split('/').pop();
        const isEditable = /\.(md|txt|py|sh|js|json|yaml|yml)$/i.test(fileName);
        const isBundled = !currentSkillPath.includes('/workspace/skills');

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default); background: var(--surface-1);">
                <span style="font-weight: 600; font-size: 12px; font-family: ui-monospace, monospace;">${escapeHtml(fileName)}</span>
                <div style="display: flex; gap: 6px; align-items: center;">
                    ${isBundled ? '<span style="font-size: 10px; color: var(--warning);">Read-only (bundled)</span>' : ''}
                    ${isEditable && !isBundled ? `<button onclick="editSkillFile('${escapeHtml(relPath)}')" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">Edit</button>` : ''}
                </div>
            </div>
            <pre id="skill-file-content" style="padding: 12px; margin: 0; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow-y: auto; flex: 1; background: var(--surface-0); color: var(--text-primary);">${escapeHtml(content)}</pre>
        `;
    } catch (e) {
        preview.innerHTML = `<div style="color: var(--error); padding: 20px;">Error: ${escapeHtml(e.message)}</div>`;
    }
};

window.editSkillFile = async function(relPath) {
    const preview = document.getElementById('skill-file-preview');
    if (!preview) return;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`);
        if (!resp.ok) {
            throw new Error(await resp.text() || 'Failed to load file');
        }
        const result = await resp.json();
        const content = result?.content || '';
        const fileName = relPath.split('/').pop();

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default); background: var(--surface-1);">
                <span style="font-weight: 600; font-size: 12px; font-family: ui-monospace, monospace;">✏️ Editing: ${escapeHtml(fileName)}</span>
                <div style="display: flex; gap: 6px;">
                    <button onclick="previewSkillFile('${escapeHtml(relPath)}')" class="btn btn-ghost" style="font-size: 11px; padding: 4px 10px;">Cancel</button>
                    <button onclick="saveSkillFile('${escapeHtml(relPath)}')" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px;">💾 Save</button>
                </div>
            </div>
            <textarea id="skill-file-editor" style="width: 100%; flex: 1; padding: 12px; margin: 0; font-size: 11px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; border: none; resize: none; background: var(--surface-0); color: var(--text-primary);">${escapeHtml(content)}</textarea>
        `;

        // Focus the textarea
        const textarea = document.getElementById('skill-file-editor');
        if (textarea) textarea.focus();
    } catch (e) {
        showToast('Failed to load file: ' + e.message, 'error');
    }
};

window.uninstallSkill = async function(skillKey) {
    if (!confirm(`Uninstall "${skillKey}"? This will permanently delete the skill directory.`)) return;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(skillKey)}`, { method: 'DELETE' });
        const result = await resp.json();
        if (!resp.ok) {
            showToast(result.error || 'Uninstall failed', 'error');
            return;
        }
        showToast(`${skillKey} uninstalled`, 'success');
        loadSkills();
    } catch (e) {
        showToast('Uninstall failed: ' + e.message, 'error');
    }
};

window.toggleHideSkill = function(skillKey) {
    const hidden = getHiddenSkills();
    const idx = hidden.indexOf(skillKey);
    if (idx >= 0) {
        hidden.splice(idx, 1);
        showToast(`${skillKey} unhidden`, 'success');
    } else {
        hidden.push(skillKey);
        showToast(`${skillKey} hidden`, 'success');
    }
    setHiddenSkills(hidden);
    renderSkills();
};

window.saveSkillFile = async function(relPath) {
    const textarea = document.getElementById('skill-file-editor');
    if (!textarea) return;

    const content = textarea.value;

    try {
        const resp = await fetch(`/api/skills/${encodeURIComponent(currentSkillName)}/files/${encodeURIComponent(relPath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save file');
        }

        showToast('File saved', 'success');
        previewSkillFile(relPath);
    } catch (e) {
        showToast('Failed to save: ' + e.message, 'error');
    }
};

window.openEditSkillModal = function(skillKey) {
    const skill = skillsList.find(s => (s?.skillKey || s?.name || '') === skillKey);
    if (!skill) {
        showToast('Skill not found', 'error');
        return;
    }

    document.getElementById('edit-skill-key').value = skillKey;
    document.getElementById('edit-skill-name').value = skill?.name || skillKey;
    document.getElementById('edit-skill-description').value = skill?.description || '';

    const enabled = !skill?.disabled && skill?.enabled !== false;
    document.getElementById('edit-skill-enabled').checked = enabled;

    // Get env vars from skill config if available
    const envText = skill?.envEntries
        ? Object.entries(skill.envEntries).map(([k, v]) => `${k}=${v}`).join('\n')
        : '';
    document.getElementById('edit-skill-env').value = envText;

    // Get agent assignment if configured
    const agentSelect = document.getElementById('edit-skill-agent');
    if (agentSelect) {
        agentSelect.value = getSkillAssignedAgent(skill);
    }

    document.getElementById('edit-skill-modal-subtitle').textContent = skill?.skillKey || skillKey;

    showModal('edit-skill-modal');
};

window.submitEditSkill = async function() {
    const skillKey = document.getElementById('edit-skill-key')?.value?.trim();
    if (!skillKey) {
        showToast('Skill key is required', 'error');
        return;
    }

    const description = document.getElementById('edit-skill-description')?.value?.trim();
    const enabled = document.getElementById('edit-skill-enabled')?.checked;
    const envText = document.getElementById('edit-skill-env')?.value?.trim() || '';
    const assignedAgent = document.getElementById('edit-skill-agent')?.value?.trim();

    // Parse env vars
    const envEntries = {};
    if (envText) {
        envText.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                const value = trimmed.substring(eqIdx + 1).trim();
                if (key) envEntries[key] = value;
            }
        });
    }

    // Build the skill config patch
    const patch = {
        enabled: enabled
    };

    if (description) {
        patch.description = description;
    }

    if (Object.keys(envEntries).length > 0) {
        patch.envEntries = envEntries;
    }

    if (assignedAgent) {
        patch.assignedAgent = assignedAgent;
    }

    try {
        const resp = await fetch('/api/skills/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillKey, patch })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to save skill settings');
        }

        showToast(`${skillKey} settings updated`, 'success');
        hideModal('edit-skill-modal');
        loadSkills({ useCache: false });
    } catch (e) {
        showToast('Failed to save: ' + e.message, 'error');
    }
};

function updateActiveFilters() {
    const container = document.getElementById('skills-active-filters');
    const clearBtn = document.getElementById('skills-clear-filters');
    const countEl = document.getElementById('skills-filter-count');
    if (!container) return;

    const filters = [];
    
    if (skillsUi.search) {
        filters.push({ type: 'search', label: `"${skillsUi.search}"` });
    }
    if (skillsUi.status) {
        filters.push({ type: 'status', label: skillsUi.status });
    }
    if (skillsUi.source) {
        filters.push({ type: 'source', label: skillsUi.source });
    }
    if (skillsUi.agent) {
        filters.push({ type: 'agent', label: skillsUi.agent });
    }
    if (skillsUi.onlyIssues) {
        filters.push({ type: 'issues', label: '⚠ Issues' });
    }

    // Update count
    const count = filters.length;
    if (countEl) countEl.textContent = count;
    
    if (filters.length === 0) {
        container.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    if (clearBtn) clearBtn.style.display = 'flex';

    const filterLabels = {
        'search': 'Search',
        'status': 'Status',
        'source': 'Source',
        'agent': 'Agent',
        'issues': 'Issues'
    };

    container.innerHTML = filters.map(f => `
        <span class="filter-chip">
            <span style="opacity: 0.6; font-size: 10px;">${filterLabels[f.type]}:</span>
            ${escapeHtml(f.label)}
            <button onclick="clearFilter('${f.type}')">✕</button>
        </span>
    `).join('');
}

window.clearFilter = function(type) {
    if (type === 'search') {
        skillsUi.search = '';
        const el = document.getElementById('skills-search');
        if (el) el.value = '';
    } else if (type === 'status') {
        skillsUi.status = '';
        const trigger = document.getElementById('skills-status-filter');
        if (trigger) {
            trigger.classList.remove('open');
            trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
            const valueEl = document.getElementById('skills-status-value');
            if (valueEl) valueEl.textContent = 'All';
        }
    } else if (type === 'source') {
        skillsUi.source = '';
        const trigger = document.getElementById('skills-source-filter');
        if (trigger) {
            trigger.classList.remove('open');
            trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
            const valueEl = document.getElementById('skills-source-value');
            if (valueEl) valueEl.textContent = 'All';
        }
    } else if (type === 'agent') {
        skillsUi.agent = '';
        const trigger = document.getElementById('skills-agent-filter');
        if (trigger) {
            trigger.classList.remove('open');
            trigger.querySelectorAll('.skills-filter-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
            const valueEl = document.getElementById('skills-agent-value');
            if (valueEl) valueEl.textContent = 'All';
        }
    } else if (type === 'issues') {
        skillsUi.onlyIssues = false;
        const el = document.getElementById('skills-only-issues');
        if (el) el.checked = false;
    }
    renderSkills();
    updateActiveFilters();
};

// === system.js ===
// js/system.js — System page rendering

// ===================
// SYSTEM PAGE RENDERING
// ===================

function renderSystemPage() {
    const container = document.getElementById('system-page-messages');
    if (!container) return;

    const messages = state.system?.messages || [];

    // Clear and re-render
    container.innerHTML = '';

    // Show empty state if no messages
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="chat-page-empty">
                <div class="chat-page-empty-icon">⚙️</div>
                <div class="chat-page-empty-text">
                    No system messages yet. This tab shows heartbeats, errors, and other system noise.
                </div>
            </div>
        `;
        return;
    }

    // Render messages
    messages.forEach(msg => {
        const msgEl = createSystemMessage(msg);
        if (msgEl) container.appendChild(msgEl);
    });

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function createSystemMessage(msg) {
    if (!msg || typeof msg.text !== 'string') return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'system-message';

    const bubble = document.createElement('div');
    bubble.className = 'system-bubble';

    // Header with time
    const header = document.createElement('div');
    header.className = 'system-bubble-header';

    const sender = document.createElement('span');
    sender.className = 'system-sender';
    sender.textContent = msg.from === 'solobot' ? 'SoLoBot (System)' : 'System';

    const time = document.createElement('span');
    time.className = 'system-bubble-time';
    time.textContent = formatTime(msg.time);

    header.appendChild(sender);
    header.appendChild(time);
    bubble.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'system-bubble-content';
    content.textContent = msg.text;
    bubble.appendChild(content);

    wrapper.appendChild(bubble);
    return wrapper;
}

async function clearSystemHistory() {
    if (await showConfirm('Clear all system messages?', 'Clear History')) {
        state.system.messages = [];
        persistSystemMessages();
        renderSystemPage();
        showToast('System messages cleared', 'success');
    }
}

// RENDERING (OTHER FUNCTIONS REMAIN THE SAME)
// ===================

function render(options = {}) {
    try {
    renderStatus();
    renderConsole();
    renderTasks();
    renderNotes();
    renderActivity();
    renderDocs();
    renderChat();
    renderChatPage();
    // Only render system page on explicit request (not during auto-refresh)
    // System messages are local, not from VPS, so no need to refresh them
    if (options.includeSystem) {
        renderSystemPage();
    }
    renderBulkActionBar();
    updateArchiveBadge();

    // Re-apply scroll containment after rendering
    if (window.setupScrollContainment) {
        window.setupScrollContainment();
    }
    } catch (e) {
        console.error('[render] Error during render:', e);
    }
}

function renderStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const modelEl = document.getElementById('model-name');
    const taskEl = document.getElementById('current-task');
    const taskName = document.getElementById('task-name');
    const subagentBanner = document.getElementById('subagent-banner');
    const subagentTask = document.getElementById('subagent-task');

    // Use design system status-dot classes (with null checks)
    if (indicator) {
        indicator.className = 'status-dot';
        switch(state.status) {
            case 'working':
                indicator.classList.add('success', 'pulse');
                break;
            case 'thinking':
                indicator.classList.add('warning', 'pulse');
                break;
            case 'offline':
                indicator.classList.add('error');
                break;
            default:
                indicator.classList.add('success');
        }
    }
    
    if (text) {
        switch(state.status) {
            case 'working': text.textContent = 'WORKING'; break;
            case 'thinking': text.textContent = 'THINKING'; break;
            case 'offline': text.textContent = 'OFFLINE'; break;
            default: text.textContent = 'IDLE';
        }
    }

    if (modelEl) modelEl.textContent = state.model || 'opus 4.5';

    const providerEl = document.getElementById('provider-name');
    if (providerEl) {
        providerEl.textContent = state.provider || 'openai-codex';
    }

    if (state.currentTask) {
        taskEl?.classList.remove('hidden');
        if (taskName) taskName.textContent = state.currentTask;
    } else {
        taskEl?.classList.add('hidden');
    }

    if (state.subagent) {
        subagentBanner?.classList.remove('hidden');
        if (subagentTask) subagentTask.textContent = state.subagent;
    } else {
        subagentBanner?.classList.add('hidden');
    }
}

function renderConsole() {
    const live = state.live || { status: 'idle' };
    const consoleData = state.console || { logs: [] };

    const statusBadge = document.getElementById('console-status-badge');
    if (statusBadge) {
        const statusConfig = {
            'working': { text: 'WORKING', badgeClass: 'badge-success' },
            'thinking': { text: 'THINKING', badgeClass: 'badge-warning' },
            'idle': { text: 'IDLE', badgeClass: 'badge-success' },
            'offline': { text: 'OFFLINE', badgeClass: 'badge-default' }
        };
        const config = statusConfig[live.status] || statusConfig['idle'];
        statusBadge.textContent = config.text;
        statusBadge.className = `badge ${config.badgeClass}`;
    }

    const output = document.getElementById('console-output');
    if (output) {
        if (consoleData.logs && consoleData.logs.length > 0) {
            output.innerHTML = consoleData.logs.map(log => {
                const timeStr = formatTimeShort(log.time);
                const colorClass = getLogColor(log.type);
                const prefix = getLogPrefix(log.type);
                return `<div class="${colorClass}"><span class="info">[${timeStr}]</span> ${prefix}${escapeHtml(log.text)}</div>`;
            }).join('');
            output.scrollTop = output.scrollHeight;
        }
        // Don't clear if empty - keep existing content
    }
}



// === ui-handlers.js ===
// js/ui-handlers.js — UI handler functions, modal helpers, rendering

// ===================
// MISSING FUNCTIONS (UI handlers)
// ===================

function renderBulkActionBar() {
    const bar = document.getElementById('bulk-action-bar');
    if (!bar) return;

    if (selectedTasks.size > 0) {
        bar.classList.add('visible');
        const countEl = document.getElementById('bulk-count');
        if (countEl) countEl.textContent = `${selectedTasks.size} selected`;
    } else {
        bar.classList.remove('visible');
    }
}

// Modal helpers
function showModal(id) {
    document.getElementById(id)?.classList.add('visible');
}

function hideModal(id) {
    document.getElementById(id)?.classList.remove('visible');
}

async function openSettingsModal() {
    showModal('settings-modal');

    try {
        // Get current model from OpenClaw
        const response = await fetch('/api/models/current');
        const modelInfo = await response.json();
        
        // Update settings modal display
        document.getElementById('current-provider-display').textContent = modelInfo.provider;
        document.getElementById('current-model-display').textContent = modelInfo.modelId;
        
        // Set provider select to current
        document.getElementById('setting-provider').value = modelInfo.provider;
        
        // Populate model dropdown for current provider FIRST
        await updateModelDropdown(modelInfo.provider);
        
        // Then set the correct model value after dropdown is populated
        const settingModelSelect = document.getElementById('setting-model');
        if (settingModelSelect && modelInfo.modelId) {
            settingModelSelect.value = modelInfo.modelId;
        }
        
    } catch (error) {
        console.error('[Dashboard] Failed to get current model:', error);
        // Fallback (approved providers only)
        document.getElementById('current-provider-display').textContent = 'openai-codex';
        document.getElementById('current-model-display').textContent = 'openai-codex/gpt-5.3-codex';
        document.getElementById('setting-provider').value = 'openai-codex';
        await updateModelDropdown('openai-codex');
        
        // Set fallback model after dropdown is populated
        const settingModelSelect = document.getElementById('setting-model');
        if (settingModelSelect) {
            settingModelSelect.value = 'openai-codex/gpt-5.3-codex';
        }
    }

    // Populate gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 443;
    if (tokenEl) tokenEl.value = GATEWAY_CONFIG.token || '';
    if (sessionEl) sessionEl.value = GATEWAY_CONFIG.sessionKey || 'agent:main:main';
}

function closeSettingsModal() {
    hideModal('settings-modal');
}

function syncFromVPS() {
    loadState().then(() => {
        render();
        updateLastSync();
    });
}

function openAddTask(column = 'todo') {
    newTaskColumn = column;
    showModal('add-task-modal');
    document.getElementById('new-task-title')?.focus();
}

function closeAddTask() {
    hideModal('add-task-modal');
    const input = document.getElementById('new-task-title');
    if (input) input.value = '';
}

function setTaskPriority(priority) {
    newTaskPriority = priority;
    [0, 1, 2].forEach(p => {
        const btn = document.getElementById(`priority-btn-${p}`);
        if (btn) {
            btn.classList.toggle('bg-opacity-50', p !== priority);
        }
    });
}

function submitTask() {
    const titleInput = document.getElementById('new-task-title');
    const title = titleInput?.value?.trim();
    if (!title) return;

    const task = {
        id: 't' + Date.now(),
        title,
        priority: newTaskPriority,
        created: Date.now()
    };

    state.tasks[newTaskColumn].push(task);
    saveState('Added task: ' + title);
    closeAddTask();
    renderTasks();
}

function openActionModal(taskId, column) {
    currentModalTask = taskId;
    currentModalColumn = column;

    const task = state.tasks[column]?.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('action-modal-task-title').textContent = task.title;
    document.getElementById('action-priority-text').textContent = `Change Priority (P${task.priority})`;

    // Hide current column option
    ['todo', 'progress', 'done', 'archive'].forEach(col => {
        const btn = document.getElementById(`action-move-${col}`);
        if (btn) btn.classList.toggle('hidden', col === column);
    });

    showModal('task-action-modal');
}

function closeActionModal() {
    hideModal('task-action-modal');
    currentModalTask = null;
    currentModalColumn = null;
}

function modalMoveTask(targetColumn) {
    if (!currentModalTask || !currentModalColumn) return;

    const taskIndex = state.tasks[currentModalColumn].findIndex(t => t.id === currentModalTask);
    if (taskIndex === -1) return;

    const [task] = state.tasks[currentModalColumn].splice(taskIndex, 1);
    state.tasks[targetColumn].push(task);

    saveState(`Moved task to ${targetColumn}`);
    closeActionModal();
    renderTasks();
    updateArchiveBadge();
}

function modalEditTitle() {
    if (!currentModalTask || !currentModalColumn) return;

    const task = state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask);
    if (!task) return;

    closeActionModal();
    document.getElementById('edit-title-input').value = task.title;
    showModal('edit-title-modal');
    document.getElementById('edit-title-input')?.focus();
}

function closeEditTitleModal() {
    hideModal('edit-title-modal');
}

function saveEditedTitle() {
    if (!currentModalTask || !currentModalColumn) return;

    const task = state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask);
    if (!task) return;

    const newTitle = document.getElementById('edit-title-input')?.value?.trim();
    if (newTitle) {
        task.title = newTitle;
        saveState('Edited task title');
        renderTasks();
    }
    closeEditTitleModal();
}

function modalCyclePriority() {
    if (!currentModalTask || !currentModalColumn) return;

    const task = state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask);
    if (!task) return;

    task.priority = (task.priority + 1) % 3;
    document.getElementById('action-priority-text').textContent = `Change Priority (P${task.priority})`;
    saveState('Changed priority');
    renderTasks();
}

function modalDeleteTask() {
    document.getElementById('delete-modal-task-title').textContent =
        state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask)?.title || '';
    closeActionModal();
    showModal('confirm-delete-modal');
}

function closeDeleteModal() {
    hideModal('confirm-delete-modal');
}

function confirmDeleteTask() {
    if (!currentModalTask || !currentModalColumn) return;

    const taskIndex = state.tasks[currentModalColumn].findIndex(t => t.id === currentModalTask);
    if (taskIndex !== -1) {
        state.tasks[currentModalColumn].splice(taskIndex, 1);
        saveState('Deleted task');
        renderTasks();
    }
    closeDeleteModal();
}

function quickMoveTask(taskId, fromColumn, toColumn, event) {
    event?.stopPropagation();

    const taskIndex = state.tasks[fromColumn].findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks[fromColumn].splice(taskIndex, 1);
    state.tasks[toColumn].push(task);

    saveState(`Moved task to ${toColumn}`);
    renderTasks();
}

function toggleTaskSelection(taskId, event) {
    event?.stopPropagation();

    if (selectedTasks.has(taskId)) {
        selectedTasks.delete(taskId);
    } else {
        selectedTasks.add(taskId);
    }
    renderTasks();
    if (typeof renderBulkActionBar === 'function') renderBulkActionBar();
}

function selectAllTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        state.tasks[column].forEach(task => selectedTasks.add(task.id));
    });
    renderTasks();
    if (typeof renderBulkActionBar === 'function') renderBulkActionBar();
}

function clearSelection() {
    selectedTasks.clear();
    renderTasks();
    if (typeof renderBulkActionBar === 'function') renderBulkActionBar();
}

function bulkMoveTo(targetColumn) {
    if (selectedTasks.size === 0) return;

    selectedTasks.forEach(taskId => {
        // Find and move each selected task
        ['todo', 'progress', 'done'].forEach(column => {
            const taskIndex = state.tasks[column].findIndex(t => t.id === taskId);
            if (taskIndex !== -1) {
                const [task] = state.tasks[column].splice(taskIndex, 1);
                state.tasks[targetColumn].push(task);
            }
        });
    });

    saveState(`Bulk moved ${selectedTasks.size} tasks to ${targetColumn}`);
    clearSelection();
    renderTasks();
    updateArchiveBadge();
}

function clearDone() {
    // Move all done tasks to archive
    const doneTasks = state.tasks.done.splice(0);
    state.tasks.archive.push(...doneTasks);
    saveState('Archived done tasks');
    renderTasks();
    updateArchiveBadge();
}

function openArchiveModal() {
    renderArchive();
    showModal('archive-modal');
}

function renderArchive() {
    const list = document.getElementById('archive-tasks-list');
    const countEl = document.getElementById('archive-modal-count');

    if (!list) return;

    const archived = state.tasks.archive || [];
    if (countEl) countEl.textContent = archived.length;

    list.innerHTML = archived.map(task => `
        <div class="task-card" style="display: flex; align-items: center; justify-content: space-between;">
            <div>
                <span class="task-title">${escapeHtml(task.title)}</span>
                <div class="task-meta">${formatTime(task.created)}</div>
            </div>
            <button onclick="restoreFromArchive('${task.id}')" class="btn btn-ghost" style="font-size: 12px;">
                Restore
            </button>
        </div>
    `).join('') || '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-8);">No archived tasks</div>';
}

function closeArchiveModal() {
    hideModal('archive-modal');
}

function restoreFromArchive(taskId) {
    const taskIndex = state.tasks.archive.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks.archive.splice(taskIndex, 1);
    state.tasks.todo.push(task);

    saveState('Restored task from archive');
    renderArchive(); // Refresh the archive list
    renderTasks();
    updateArchiveBadge();
}

async function clearArchive() {
    if (await showConfirm('Delete all archived tasks permanently?', 'Clear Archive', 'Delete All')) {
        state.tasks.archive = [];
        saveState('Cleared archive');
        renderArchive();
        updateArchiveBadge();
        showToast('Archive cleared', 'success');
    }
}

function addNote() {
    const input = document.getElementById('note-input');
    const text = input?.value?.trim();
    if (!text) return;

    state.notes.push({
        id: 'n' + Date.now(),
        text,
        created: Date.now(),
        seen: false
    });

    input.value = '';
    saveState('Added note');
    renderNotes();
}

function clearConsole() {
    if (state.console) state.console.logs = [];
    saveState();
    renderConsole();
}

// Add a log entry to the terminal
function addTerminalLog(text, type = 'info', timestamp = null) {
    if (!state.console) state.console = { logs: [] };
    
    const log = {
        time: timestamp || Date.now(),
        text: text,
        type: type
    };
    
    // Dedupe - don't add if identical to last entry within 5 seconds
    const lastLog = state.console.logs[state.console.logs.length - 1];
    if (lastLog && lastLog.text === text && Math.abs(log.time - lastLog.time) < 5000) {
        return;
    }
    
    state.console.logs.push(log);
    
    // Keep last 500 entries for review
    if (state.console.logs.length > 500) {
        state.console.logs = state.console.logs.slice(-500);
    }
    
    renderConsole();
}

// Auto-sync activities from transcript file
let lastActivitySync = 0;
async function syncActivitiesFromFile() {
    try {
        // Check if memory files are available first (avoid 404 noise in console)
        if (!gateway || !gateway.isConnected()) return;
        const response = await fetch('/api/memory/recent-activity.json');
        if (!response.ok) return;
        
        const wrapper = await response.json();
        // API wraps content in {name, content, modified, size}
        const data = typeof wrapper.content === 'string' ? JSON.parse(wrapper.content) : wrapper.content;
        if (!data || !data.activities || data.updatedMs <= lastActivitySync) return;
        
        lastActivitySync = data.updatedMs;
        
        // Convert activities to console log format
        const activityLogs = data.activities.map(a => ({
            time: a.timestamp,
            text: a.text,
            type: 'info'
        }));
        
        // Merge with existing logs (dedupe by timestamp + text)
        if (!state.console) state.console = { logs: [] };
        const existing = new Set(state.console.logs.map(l => `${l.time}-${l.text}`));
        
        let added = 0;
        for (const log of activityLogs) {
            const key = `${log.time}-${log.text}`;
            if (!existing.has(key)) {
                state.console.logs.push(log);
                existing.add(key);
                added++;
            }
        }
        
        if (added > 0) {
            // Sort by time and keep last 100
            state.console.logs.sort((a, b) => a.time - b.time);
            state.console.logs = state.console.logs.slice(-100);
            renderConsole();
        }
    } catch (e) {
        // Silent fail - file might not exist yet
    }
}

// Poll for activity updates every 30 seconds
let activitySyncInterval = setInterval(syncActivitiesFromFile, 30000);
// Also sync on load
setTimeout(syncActivitiesFromFile, 2000);

// Cleanup function for SPA navigation
window._uiHandlersCleanup = () => clearInterval(activitySyncInterval);

function toggleConsoleExpand() {
    const section = document.getElementById('console-section');
    const output = document.getElementById('console-output');
    const btn = document.getElementById('console-expand-btn');

    if (!section || !output || !btn) return;

    const isExpanded = output.classList.contains('h-[500px]');

    if (isExpanded) {
        output.classList.remove('h-[500px]');
        output.classList.add('h-[250px]');
        btn.textContent = 'Expand';
    } else {
        output.classList.remove('h-[250px]');
        output.classList.add('h-[500px]');
        btn.textContent = 'Collapse';
    }
}

function updateSetting(key, value) {
    // Handle provider/model changes specially - just show warning
    if (key === 'provider' || key === 'model') {
        console.warn(`[Dashboard] Cannot change ${key} from dashboard - must be configured at OpenClaw gateway level`);
        showToast(`${key.charAt(0).toUpperCase() + key.slice(1)} must be configured at OpenClaw gateway level`, 'warning');
        return;
    }
    
    // Settings are stored in localStorage
    localStorage.setItem(`setting_${key}`, JSON.stringify(value));
}

async function resetToServerState() {
    if (await showConfirm('This will reload all data from the server. Continue?', 'Reset to Server', 'Reload')) {
        localStorage.removeItem('solovision-dashboard');
        location.reload();
    }
}

async function clearAllData() {
    if (await showConfirm('This will delete ALL local data. Are you sure?', '⚠️ Delete All Data', 'Delete Everything')) {
        localStorage.clear();
        state = {
            status: 'idle',
            model: 'opus 4.5',
            tasks: { todo: [], progress: [], done: [], archive: [] },
            notes: [],
            activity: [],
            docs: [],
            console: { logs: [] },
            chat: { messages: [] }
        };
        saveState();
        render();
    }
}

// Drag and drop handlers
let draggedTaskId = null;
let draggedFromColumn = null;

function handleDragStart(event, taskId, column) {
    draggedTaskId = taskId;
    draggedFromColumn = column;
    event.dataTransfer.effectAllowed = 'move';
    const card = event.target.closest('.task-card');
    if (card) card.classList.add('opacity-50');
}

function handleDragEnd(event) {
    const card = event.target.closest('.task-card');
    if (card) card.classList.remove('opacity-50');
    draggedTaskId = null;
    draggedFromColumn = null;

    // Remove all drag-over styling
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.classList.remove('bg-slate-600/30', 'ring-2', 'ring-solo-primary');
    });
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(event, column) {
    event.preventDefault();
    const zone = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
    zone?.classList.add('bg-slate-600/30', 'ring-2', 'ring-solo-primary');
}

function handleDragLeave(event, column) {
    const zone = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
    zone?.classList.remove('bg-slate-600/30', 'ring-2', 'ring-solo-primary');
}

function handleDrop(event, targetColumn) {
    event.preventDefault();

    const zone = document.getElementById(`${targetColumn === 'progress' ? 'progress' : targetColumn}-tasks`);
    zone?.classList.remove('bg-slate-600/30', 'ring-2', 'ring-solo-primary');

    if (!draggedTaskId || !draggedFromColumn || draggedFromColumn === targetColumn) return;

    const taskIndex = state.tasks[draggedFromColumn].findIndex(t => t.id === draggedTaskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks[draggedFromColumn].splice(taskIndex, 1);
    state.tasks[targetColumn].push(task);

    saveState(`Moved task to ${targetColumn}`);
    renderTasks();
}

function closeAllTaskMenus() {
    document.querySelectorAll('.task-menu').forEach(menu => menu.classList.add('hidden'));
}



// === cron.js ===
// js/cron.js — Cron Jobs Manager page

let cronJobs = [];
let cronInterval = null;
let cronRunCache = new Map();
let cronDiagnostics = new Map();
let activeCronJobId = null;
let activeCronTimeline = [];
let cronDetailLoadToken = 0;
let cronListFilter = 'all';
let cronListQuery = '';
let cronVisibleCount = 24;
let cronDetailDrawerOpen = false;
let cronAgentFilter = 'all';
let cronEnabledFilter = 'all';
let cronActivityFilter = 'all';
let cronSortBy = 'nextRun';
let cronSortDirection = 'asc';
let cronAdvancedControlsOpen = false;
let cronListLoadPromise = null;
let cronLastLoadedAt = 0;
const CRON_CACHE_KEY = 'cronListCache.v1';
const CRON_NAME_MAP_KEY = 'cronJobNameMap.v1';
const CRON_MIN_REFRESH_INTERVAL_MS = 15000;
const CRON_REQUEST_TIMEOUT_MS = 10000;
const CRON_DETAIL_INITIAL_RUN_LIMIT = 12;
const CRON_DETAIL_FULL_RUN_LIMIT = 40;

function initCronPage() {
    const searchInput = document.getElementById('cron-search-input');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = 'true';
        searchInput.addEventListener('input', (event) => {
            cronListQuery = event.target.value.trim().toLowerCase();
            renderCronJobs();
        });
    }
    if (searchInput) searchInput.value = cronListQuery;

    const agentFilter = document.getElementById('cron-agent-filter');
    if (agentFilter && !agentFilter.dataset.bound) {
        agentFilter.dataset.bound = 'true';
        agentFilter.addEventListener('change', (event) => {
            cronAgentFilter = event.target.value || 'all';
            updateCronAdvancedControlsUI();
            renderCronJobs();
        });
    }

    const enabledFilter = document.getElementById('cron-enabled-filter');
    if (enabledFilter && !enabledFilter.dataset.bound) {
        enabledFilter.dataset.bound = 'true';
        enabledFilter.addEventListener('change', (event) => {
            cronEnabledFilter = event.target.value || 'all';
            updateCronAdvancedControlsUI();
            renderCronJobs();
        });
    }
    if (enabledFilter) enabledFilter.value = cronEnabledFilter;

    const activityFilter = document.getElementById('cron-activity-filter');
    if (activityFilter && !activityFilter.dataset.bound) {
        activityFilter.dataset.bound = 'true';
        activityFilter.addEventListener('change', (event) => {
            cronActivityFilter = event.target.value || 'all';
            updateCronAdvancedControlsUI();
            renderCronJobs();
        });
    }
    if (activityFilter) activityFilter.value = cronActivityFilter;

    const sortBySelect = document.getElementById('cron-sort-by');
    if (sortBySelect && !sortBySelect.dataset.bound) {
        sortBySelect.dataset.bound = 'true';
        sortBySelect.addEventListener('change', (event) => {
            cronSortBy = event.target.value || 'nextRun';
            renderCronJobs();
        });
    }
    if (sortBySelect) sortBySelect.value = cronSortBy;

    const sortDirectionBtn = document.getElementById('cron-sort-direction-btn');
    if (sortDirectionBtn && !sortDirectionBtn.dataset.bound) {
        sortDirectionBtn.dataset.bound = 'true';
        sortDirectionBtn.addEventListener('click', () => {
            cronSortDirection = cronSortDirection === 'asc' ? 'desc' : 'asc';
            updateCronSortDirectionButton();
            renderCronJobs();
        });
    }

    updateCronFilterChips();
    updateCronSortDirectionButton();
    updateCronAdvancedControlsUI();
    const hydratedFromCache = hydrateCronJobsFromCache();
    if (!hydratedFromCache) {
        populateCronAgentFilterOptions();
    }

    const params = new URLSearchParams(window.location.search);
    const hasDeepLinkedJob = window.location.pathname === '/cron' && params.has('job');
    if (hasDeepLinkedJob) {
        renderEmptyDetailState();
        setCronDetailDrawerOpen(false);
        syncCronViewFromURL();
    } else {
        activeCronJobId = null;
        activeCronTimeline = [];
        renderEmptyDetailState();
        setCronDetailDrawerOpen(false);
    }

    const shouldRefresh = !cronJobs.length || (Date.now() - cronLastLoadedAt > CRON_MIN_REFRESH_INTERVAL_MS);
    if (shouldRefresh) {
        loadCronJobs({ silent: hydratedFromCache });
    } else {
        renderCronJobs();
    }

    if (cronInterval) clearInterval(cronInterval);
    cronInterval = setInterval(() => {
        const cronPage = document.getElementById('page-cron');
        if (!cronPage || !cronPage.classList.contains('active')) return;

        if (activeCronJobId && cronDetailDrawerOpen) {
            openCronDetailView(activeCronJobId, { refresh: true, pushState: false });
        } else {
            loadCronJobs({ silent: true });
        }
    }, 30000);
}

function formatCronScheduleHuman(schedule) {
    if (!schedule) return '--';
    if (typeof schedule === 'string') {
        // Try to parse as cron expression
        return cronToHuman(schedule);
    }

    if (schedule.kind === 'cron') {
        return cronToHuman(schedule.expr);
    }
    if (schedule.kind === 'every') {
        const ms = Number(schedule.everyMs || 0);
        if (!ms) return 'every --';
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `every ${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `every ${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `every ${hours}h`;
        const days = Math.floor(hours / 24);
        return `every ${days}d`;
    }
    if (schedule.kind === 'at') {
        try {
            return `at ${new Date(schedule.at).toLocaleString()}`;
        } catch {
            return `at ${schedule.at || '--'}`;
        }
    }

    return JSON.stringify(schedule);
}

function cronToHuman(expr) {
    if (!expr || typeof expr !== 'string') return expr || '--';

    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return expr;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every X minutes: */X
    if (minute.startsWith('*/')) {
        const interval = minute.substring(2);
        return `Every ${interval} minutes`;
    }

    // Every hour at minute X: X * * * *
    if (hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
        return `Every hour at minute ${minute}`;
    }

    // Daily at X: X Y * * *
    if (dayOfMonth === '*' && dayOfWeek === '*') {
        const h = parseInt(hour);
        const m = parseInt(minute);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `Daily at ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    // Weekly on X at Y: X Y * * Z
    if (dayOfMonth === '*' && dayOfWeek !== '*') {
        const h = parseInt(hour);
        const m = parseInt(minute);
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `Weekly on ${days[parseInt(dayOfWeek)]} at ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    // Monthly on X at Y: X Y Z * *
    if (dayOfMonth !== '*') {
        const h = parseInt(hour);
        const m = parseInt(minute);
        const d = parseInt(dayOfMonth);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        const suffix = getOrdinalSuffix(d);
        return `Monthly on the ${d}${suffix} at ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    // Fallback to raw expression with timezone
    return expr;
}

function formatCronSchedule(schedule) {
    return formatCronScheduleHuman(schedule);
}

function formatDateTime(value) {
    if (value == null || value === '') return '--';
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString();
}

function getCronState(job) {
    return job?.state || {};
}

function formatNextRun(job) {
    const state = getCronState(job);
    const next = state.nextRunAtMs || job.nextRunAtMs || job.nextRun;
    return formatDateTime(next);
}

function formatLastRun(job) {
    const state = getCronState(job);
    const last = state.lastRunAtMs || job.lastRunAtMs || job.lastRun;
    if (!last) return 'Never';
    if (typeof timeAgo === 'function') return timeAgo(Number(last));
    return formatDateTime(last);
}

function getLastStatus(job) {
    const state = getCronState(job);
    return state.lastRunStatus || state.lastStatus || job.lastRunStatus || job.lastStatus || '--';
}

function getLastError(job) {
    const state = getCronState(job);
    return state.lastError || job.lastError || null;
}

function getPayloadSummary(job) {
    const payload = job?.payload;
    if (!payload) return '';
    if (payload.kind === 'systemEvent') return payload.text || '';
    if (payload.kind === 'agentTurn') return payload.message || '';
    return '';
}

function getCronDelivery(job) {
    return job?.delivery && typeof job.delivery === 'object' ? job.delivery : null;
}

function hasUnsupportedWebchatAnnounce(job) {
    const delivery = getCronDelivery(job);
    if (!delivery || delivery.mode !== 'announce') return false;
    const channel = String(delivery.channel || '').trim().toLowerCase();
    const to = String(delivery.to || '').trim().toLowerCase();
    return channel === 'webchat' || to === 'webchat';
}

function getCronDeliveryWarning(job) {
    if (!hasUnsupportedWebchatAnnounce(job)) return null;
    return 'WebChat is not a supported cron announce channel in this build. Use Main session for dashboard-visible reminders, or use webhook / a real provider channel.';
}

function buildCronWebchatMigrationPatch(job) {
    const payloadText = getPayloadSummary(job) || job?.payload?.text || job?.payload?.message || '';
    const patch = {
        delivery: null
    };

    if ((job?.sessionTarget || 'main') !== 'main') {
        patch.sessionTarget = 'main';
        patch.payload = {
            kind: 'systemEvent',
            text: payloadText
        };
        patch.wakeMode = 'now';
    }

    return patch;
}

function getJobById(jobId) {
    return cronJobs.find(job => String(job.id) === String(jobId));
}

function persistCronNameMap() {
    try {
        const map = {};
        for (const job of cronJobs) {
            if (!job || !job.id) continue;
            map[String(job.id)] = String(job.name || job.id);
        }
        localStorage.setItem(CRON_NAME_MAP_KEY, JSON.stringify(map));
    } catch (e) {
        console.warn('[Cron] Failed to persist cron name map:', e?.message || e);
    }
}

window.getCronFriendlyNameById = function (jobId) {
    if (!jobId) return null;
    try {
        const raw = localStorage.getItem(CRON_NAME_MAP_KEY);
        if (!raw) return null;
        const map = JSON.parse(raw);
        const value = map && map[String(jobId)];
        return value ? String(value) : null;
    } catch {
        return null;
    }
};

function summarizeRuns(runs = []) {
    const sorted = [...runs].sort((a, b) => Number(b.runAtMs || b.ts || 0) - Number(a.runAtMs || a.ts || 0));
    const failures = sorted.filter(r => (r.status || '').toLowerCase() === 'error' || (r.status || '').toLowerCase() === 'failed');
    const successes = sorted.filter(r => (r.status || '').toLowerCase() === 'ok' || (r.status || '').toLowerCase() === 'success');
    const latest = sorted[0] || null;
    const latestFailure = failures[0] || null;
    const latestSuccess = successes[0] || null;

    return {
        latest,
        latestFailure,
        latestSuccess,
        failureCount: failures.length,
        successCount: successes.length,
        totalCount: sorted.length
    };
}

function getCachedCronRuns(jobId) {
    const cached = cronRunCache.get(jobId);
    if (Array.isArray(cached)) return cached;
    if (cached && Array.isArray(cached.runs)) return cached.runs;
    return [];
}

function getCachedCronRunLimit(jobId) {
    const cached = cronRunCache.get(jobId);
    if (Array.isArray(cached)) return cached.length;
    if (cached && Number.isFinite(Number(cached.limit))) return Number(cached.limit);
    if (cached && Array.isArray(cached.runs)) return cached.runs.length;
    return 0;
}

async function fetchCronRuns(jobId, { refresh = false, limit = 20 } = {}) {
    const cachedRuns = getCachedCronRuns(jobId);
    const cachedLimit = getCachedCronRunLimit(jobId);
    if (!refresh && cachedRuns.length && cachedLimit >= limit) return cachedRuns;

    const result = await gateway._request('cron.runs', { jobId, limit }, CRON_REQUEST_TIMEOUT_MS);
    const runs = result?.entries || result?.runs || [];
    cronRunCache.set(jobId, {
        runs,
        limit,
        ts: Date.now()
    });
    cronDiagnostics.set(jobId, summarizeRuns(runs));
    return runs;
}

async function hydrateCronDiagnostics() {
    const jobs = cronJobs.slice(0, 6);
    if (!jobs.length) return;

    const startedAt = performance.now();
    await Promise.all(jobs.map(async (job) => {
        if (!job?.id) return;
        try {
            await fetchCronRuns(job.id, { limit: 10 });
        } catch (e) {
            console.warn('[Cron] Failed to fetch diagnostics for job', job.id, e.message);
        }
    }));

    renderCronJobs();
    console.log(`[Perf][Cron] Warmed diagnostics for ${jobs.length}/${cronJobs.length} jobs in ${Math.round(performance.now() - startedAt)}ms`);
}

function buildDetailURL(jobId) {
    const url = new URL(window.location.href);
    url.pathname = '/cron';
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');
    return `${url.pathname}${url.search}${url.hash}`;
}

function getCronJobStatusTone(job) {
    const status = String(getLastStatus(job) || '').toLowerCase();
    if (job?.enabled === false) return 'disabled';
    if (status === 'error' || status === 'failed') return 'error';
    if (status === 'ok' || status === 'success') return 'success';
    return 'neutral';
}

function getRunStatusTone(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'ok' || normalized === 'success') return 'success';
    if (normalized === 'error' || normalized === 'failed') return 'error';
    return 'neutral';
}

function getCronJobAccentColor(job) {
    const tone = getCronJobStatusTone(job);
    if (tone === 'error') return 'var(--error)';
    if (tone === 'success') return 'var(--success)';
    if (tone === 'disabled') return 'var(--text-muted)';
    return 'var(--brand, var(--text-primary))';
}

function getCronJobOwnerAgent(job) {
    const owner = String(job?.agentId || job?.ownerAgentId || '').trim();
    return owner;
}

function parseTimestamp(value) {
    if (value == null || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getCronJobLastRunMs(job) {
    const state = getCronState(job);
    return parseTimestamp(state.lastRunAtMs || job?.lastRunAtMs || job?.lastRun);
}

function getCronJobNextRunMs(job) {
    const state = getCronState(job);
    return parseTimestamp(state.nextRunAtMs || job?.nextRunAtMs || job?.nextRun);
}

function getCronJobFailureCount(job) {
    const diagnostics = cronDiagnostics.get(job?.id);
    if (diagnostics && Number.isFinite(Number(diagnostics.failureCount))) {
        return Number(diagnostics.failureCount);
    }
    return getCronJobStatusTone(job) === 'error' ? 1 : 0;
}

function getCronJobConsecutiveErrors(job) {
    return Number(getCronState(job).consecutiveErrors || 0);
}

function compareNumbers(a, b, direction = 'asc') {
    const left = Number(a || 0);
    const right = Number(b || 0);
    if (left === right) return 0;
    if (direction === 'asc') return left < right ? -1 : 1;
    return left > right ? -1 : 1;
}

function compareStrings(a, b, direction = 'asc') {
    const left = String(a || '');
    const right = String(b || '');
    const result = left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
    return direction === 'asc' ? result : -result;
}

function getCronStatusSeverity(job) {
    const tone = getCronJobStatusTone(job);
    if (tone === 'error') return 4;
    if (tone === 'disabled') return 3;
    if (tone === 'neutral') return 2;
    if (tone === 'success') return 1;
    return 0;
}

function getComparableNextRunMs(job) {
    const next = getCronJobNextRunMs(job);
    if (next > 0) return next;
    return cronSortDirection === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

function getComparableLastRunMs(job) {
    const last = getCronJobLastRunMs(job);
    if (last > 0) return last;
    return cronSortDirection === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

function matchesCronListAdvancedFilters(job) {
    const owner = getCronJobOwnerAgent(job);
    if (cronAgentFilter === '__unassigned') {
        if (owner) return false;
    } else if (cronAgentFilter !== 'all' && owner !== cronAgentFilter) {
        return false;
    }

    const enabled = job?.enabled !== false;
    if (cronEnabledFilter === 'enabled' && !enabled) return false;
    if (cronEnabledFilter === 'disabled' && enabled) return false;

    const now = Date.now();
    const lastRunMs = getCronJobLastRunMs(job);
    const nextRunMs = getCronJobNextRunMs(job);
    if (cronActivityFilter === 'ran_24h' && !(lastRunMs > now - (24 * 60 * 60 * 1000))) return false;
    if (cronActivityFilter === 'stale_7d' && !(lastRunMs > 0 && lastRunMs < now - (7 * 24 * 60 * 60 * 1000))) return false;
    if (cronActivityFilter === 'never' && lastRunMs > 0) return false;
    if (cronActivityFilter === 'next_24h' && !(nextRunMs > now && nextRunMs <= now + (24 * 60 * 60 * 1000))) return false;

    return true;
}

function sortCronJobs(jobs = []) {
    const sorted = [...jobs];
    sorted.sort((a, b) => {
        let result = 0;

        if (cronSortBy === 'name') {
            result = compareStrings(a?.name || a?.id, b?.name || b?.id, cronSortDirection);
        } else if (cronSortBy === 'agent') {
            result = compareStrings(getCronJobOwnerAgent(a) || 'zzzzzz', getCronJobOwnerAgent(b) || 'zzzzzz', cronSortDirection);
        } else if (cronSortBy === 'nextRun') {
            result = compareNumbers(getComparableNextRunMs(a), getComparableNextRunMs(b), cronSortDirection);
        } else if (cronSortBy === 'lastRun') {
            result = compareNumbers(getComparableLastRunMs(a), getComparableLastRunMs(b), cronSortDirection);
        } else if (cronSortBy === 'status') {
            result = compareNumbers(getCronStatusSeverity(a), getCronStatusSeverity(b), cronSortDirection);
        } else if (cronSortBy === 'errors') {
            result = compareNumbers(getCronJobConsecutiveErrors(a), getCronJobConsecutiveErrors(b), cronSortDirection);
        } else if (cronSortBy === 'failures') {
            result = compareNumbers(getCronJobFailureCount(a), getCronJobFailureCount(b), cronSortDirection);
        }

        if (result !== 0) return result;
        return compareStrings(a?.name || a?.id, b?.name || b?.id, 'asc');
    });
    return sorted;
}

function populateCronAgentFilterOptions() {
    const select = document.getElementById('cron-agent-filter');
    if (!select) return;

    const currentValue = cronAgentFilter;
    const owners = Array.from(new Set(cronJobs.map(getCronJobOwnerAgent).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    const hasUnassigned = cronJobs.some(job => !getCronJobOwnerAgent(job));

    select.innerHTML = '';
    const addOption = (value, label) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    };

    addOption('all', 'All agents');
    if (hasUnassigned) addOption('__unassigned', 'Unassigned');
    owners.forEach((owner) => addOption(owner, owner));

    if (currentValue === 'all') {
        select.value = 'all';
        return;
    }
    if (currentValue === '__unassigned' && hasUnassigned) {
        select.value = currentValue;
        return;
    }
    if (owners.includes(currentValue)) {
        select.value = currentValue;
        return;
    }

    cronAgentFilter = 'all';
    select.value = 'all';
}

function updateCronSortDirectionButton() {
    const button = document.getElementById('cron-sort-direction-btn');
    if (!button) return;
    button.textContent = cronSortDirection === 'asc' ? 'Asc' : 'Desc';
    button.title = cronSortDirection === 'asc' ? 'Sort ascending' : 'Sort descending';
}

function updateCronAdvancedControlsUI() {
    const advanced = document.getElementById('cron-advanced-controls');
    const toggle = document.getElementById('cron-advanced-toggle-btn');
    const activeAdvancedCount = Number(cronAgentFilter !== 'all') +
        Number(cronEnabledFilter !== 'all') +
        Number(cronActivityFilter !== 'all');

    if (advanced) advanced.classList.toggle('hidden', !cronAdvancedControlsOpen);
    if (toggle) {
        const badge = activeAdvancedCount > 0 ? ` (${activeAdvancedCount})` : '';
        toggle.textContent = cronAdvancedControlsOpen ? `Hide filters${badge}` : `Filters${badge}`;
        toggle.setAttribute('aria-expanded', cronAdvancedControlsOpen ? 'true' : 'false');
    }
}

function getCronSortLabel() {
    if (cronSortBy === 'name') return 'name';
    if (cronSortBy === 'agent') return 'agent owner';
    if (cronSortBy === 'nextRun') return 'next run';
    if (cronSortBy === 'lastRun') return 'last run';
    if (cronSortBy === 'status') return 'status';
    if (cronSortBy === 'errors') return 'consecutive errors';
    if (cronSortBy === 'failures') return 'failure count';
    return 'next run';
}

function matchesCronListFilter(job) {
    const tone = getCronJobStatusTone(job);
    const lastRunAt = Number(getCronState(job).lastRunAtMs || job?.lastRunAtMs || job?.lastRun || 0);
    const isRecent = lastRunAt > Date.now() - (24 * 60 * 60 * 1000);

    if (cronListFilter === 'failing') return tone === 'error';
    if (cronListFilter === 'healthy') return tone === 'success';
    if (cronListFilter === 'disabled') return tone === 'disabled';
    if (cronListFilter === 'recent') return isRecent;
    return true;
}

function matchesCronListQuery(job) {
    if (!cronListQuery) return true;
    const haystack = [
        job?.name,
        job?.id,
        formatCronSchedule(job?.schedule || job?.cron),
        job?.description,
        getPayloadSummary(job),
        getLastStatus(job)
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(cronListQuery);
}

function readCronCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CRON_CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.jobs)) return null;
        return cached;
    } catch {
        return null;
    }
}

function writeCronCache(jobs) {
    try {
        localStorage.setItem(CRON_CACHE_KEY, JSON.stringify({ ts: Date.now(), jobs }));
    } catch {}
}

function hydrateCronJobsFromCache() {
    const cached = readCronCache();
    if (!cached || !Array.isArray(cached.jobs) || !cached.jobs.length) return false;

    cronJobs = cached.jobs;
    cronLastLoadedAt = Number(cached.ts || 0);
    populateCronAgentFilterOptions();
    renderCronJobs();
    return true;
}

function getVisibleCronJobs() {
    const filtered = cronJobs.filter(job =>
        matchesCronListFilter(job) &&
        matchesCronListQuery(job) &&
        matchesCronListAdvancedFilters(job)
    );
    return sortCronJobs(filtered);
}

function getRenderedCronJobs() {
    return getVisibleCronJobs().slice(0, cronVisibleCount);
}

function updateCronListMeta(total = cronJobs.length, visible = getVisibleCronJobs().length) {
    const meta = document.getElementById('cron-list-meta');
    if (!meta) return;
    const countText = visible === total
        ? `${total} jobs`
        : `${visible} of ${total} jobs shown`;
    meta.textContent = countText;
}

function truncateForList(value, maxChars = 220) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function updateCronFilterChips() {
    document.querySelectorAll('[data-cron-filter]').forEach((button) => {
        const isActive = button.dataset.cronFilter === cronListFilter;
        button.classList.toggle('is-active', isActive);
    });
}

function setCronDetailDrawerOpen(open) {
    const shouldOpen = Boolean(open && activeCronJobId);
    const page = document.getElementById('page-cron');
    const detailView = document.getElementById('cron-detail-view');
    const peekButton = document.getElementById('cron-detail-peek-btn');

    cronDetailDrawerOpen = shouldOpen;
    if (page) page.classList.toggle('cron-detail-open', shouldOpen);
    if (detailView) detailView.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    if (peekButton) {
        const shouldShowPeek = !shouldOpen && Boolean(activeCronJobId);
        peekButton.classList.toggle('hidden', !shouldShowPeek);
    }
}

function renderEmptyDetailState(message = 'Choose a cron job on the left to inspect its schedule, failures, and recent runs.') {
    activeCronTimeline = [];
    const summary = document.getElementById('cron-detail-summary');
    const meta = document.getElementById('cron-detail-meta');
    const timeline = document.getElementById('cron-detail-timeline');
    const error = document.getElementById('cron-detail-error');
    const title = document.getElementById('cron-detail-title');
    const subtitle = document.getElementById('cron-detail-subtitle');

    if (title) title.textContent = activeCronJobId ? 'Loading cron job…' : 'Select a cron job';
    if (subtitle) subtitle.textContent = message;
    if (summary) summary.innerHTML = '';
    if (meta) meta.innerHTML = '<div class="empty-state">Select a job to see metadata and configuration details.</div>';
    if (timeline) timeline.innerHTML = '<div class="empty-state">Select a job to view its recent run timeline.</div>';
    if (error) {
        error.classList.add('hidden');
        error.innerHTML = '';
    }
}

function syncCronViewFromURL() {
    const cronPage = document.getElementById('page-cron');
    if (cronPage && !cronPage.classList.contains('active')) return;

    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');
    if (window.location.pathname === '/cron' && jobId) {
        openCronDetailView(jobId, { pushState: false });
    } else {
        showCronListView();
    }
}

function showCronListView() {
    activeCronJobId = null;
    cronDetailLoadToken += 1;
    document.getElementById('cron-list-view')?.classList.remove('hidden');
    document.getElementById('cron-detail-view')?.classList.remove('hidden');
    renderCronJobs();
    renderEmptyDetailState();
    setCronDetailDrawerOpen(false);
}

function setCronDetailURL(jobId) {
    const url = new URL(window.location.href);
    url.pathname = '/cron';
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');

    const targetPath = `${url.pathname}${url.search}${url.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (targetPath === currentPath) return;

    history.pushState({ page: 'cron', jobId }, '', targetPath);
}

function renderSummaryCard(label, value, tone = 'default', subtext = '') {
    const toneClass = tone === 'error' || tone === 'success' ? ` cron-tone-${tone}` : '';
    return `
        <div class="cron-summary-card${toneClass}">
            <div class="cron-summary-label">${escapeHtml(label)}</div>
            <div class="cron-summary-value">${escapeHtml(value || '--')}</div>
            ${subtext ? `<div class="cron-summary-subtext">${escapeHtml(subtext)}</div>` : ''}
        </div>`;
}

function renderCronDetailSummary(job, diagnostics) {
    const state = getCronState(job);
    return [
        renderSummaryCard('Last run', formatDateTime(diagnostics.latest?.runAtMs || diagnostics.latest?.ts), (diagnostics.latest?.status || '').toLowerCase() === 'error' ? 'error' : 'default', diagnostics.latest?.status || '--'),
        renderSummaryCard('Last failed attempt', diagnostics.latestFailure ? formatDateTime(diagnostics.latestFailure.runAtMs || diagnostics.latestFailure.ts) : 'None in recent history', diagnostics.latestFailure ? 'error' : 'success', diagnostics.latestFailure?.provider || ''),
        renderSummaryCard('Last successful attempt', diagnostics.latestSuccess ? formatDateTime(diagnostics.latestSuccess.runAtMs || diagnostics.latestSuccess.ts) : 'None in recent history', diagnostics.latestSuccess ? 'success' : 'default', diagnostics.latestSuccess?.provider || ''),
        renderSummaryCard('History window', `${diagnostics.totalCount} attempts`, 'default', `${diagnostics.failureCount} failed · ${diagnostics.successCount} successful`),
        renderSummaryCard('Consecutive errors', String(state.consecutiveErrors || 0), (state.consecutiveErrors || 0) > 0 ? 'error' : 'success', `Current status: ${getLastStatus(job)}`),
        renderSummaryCard('Next run', formatNextRun(job), 'default', job.enabled !== false ? 'Enabled' : 'Disabled')
    ].join('');
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyJsonToClipboard(data, successMessage = 'Copied JSON to clipboard') {
    const text = JSON.stringify(data, null, 2);
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage, 'success');
    } catch (e) {
        console.warn('[Cron] Clipboard copy failed:', e.message);
        showToast('Clipboard copy failed', 'error');
    }
}

function buildCronListExport() {
    return {
        exportedAt: new Date().toISOString(),
        page: 'cron-list',
        totalJobs: cronJobs.length,
        jobs: cronJobs.map((job) => ({
            ...job,
            diagnostics: cronDiagnostics.get(job.id) || null,
            recentRuns: getCachedCronRuns(job.id)
        }))
    };
}

function buildCronTimelineExport(jobId) {
    const job = getJobById(jobId);
    return {
        exportedAt: new Date().toISOString(),
        page: 'cron-timeline',
        jobId,
        job,
        diagnostics: cronDiagnostics.get(jobId) || (activeCronTimeline.length ? summarizeRuns(activeCronTimeline) : null),
        runs: activeCronTimeline
    };
}

function getCronJobDisplayModel(job, diagnostics = null) {
    // 1. Explicit payload model (set via the cron edit model selector)
    const payloadModel = String(job?.payload?.model || '').trim();
    if (payloadModel) return payloadModel;

    // 2. Root-level model field on the job itself
    const rootModel = String(job?.model || '').trim();
    if (rootModel) return rootModel;

    // 3. Model from the most recent run history (diagnostics load asynchronously,
    //    so this only helps after the detail view has been opened at least once)
    if (diagnostics) {
        const latestModel = String(
            diagnostics?.latest?.model ||
            diagnostics?.latestSuccess?.model ||
            diagnostics?.latestFailure?.model ||
            ''
        ).trim();
        if (latestModel) return latestModel;
    }

    return '--';
}

function renderDetailMeta(job, runs, diagnostics) {
    const state = getCronState(job);
    const delivery = getCronDelivery(job);
    const deliveryLabel = delivery
        ? `${delivery.mode || '--'} · ${delivery.channel || 'last'}${delivery.to ? ` → ${delivery.to}` : ''}`
        : '--';
    const deliveryWarning = getCronDeliveryWarning(job);
    const jobIdJs = String(job.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const meta = [
        ['Job ID', job.id || '--'],
        ['Agent', job.agentId || '--'],
        ['Session target', job.sessionTarget || '--'],
        ['Wake mode', job.wakeMode || '--'],
        ['Model', getCronJobDisplayModel(job, diagnostics)],
        ['Delivery', deliveryLabel],
        ['Enabled', job.enabled !== false ? 'Yes' : 'No'],
        ['Schedule', formatCronSchedule(job.schedule)],
        ['Next scheduled run', formatNextRun(job)],
        ['Current status', getLastStatus(job)],
        ['Consecutive errors', String(state.consecutiveErrors || 0)],
        ['History URL', buildDetailURL(job.id)]
    ];

    const payloadPreview = getPayloadSummary(job);

    document.getElementById('cron-detail-meta').innerHTML = `
        <div class="cron-meta-header">
            <div class="cron-meta-title">Job metadata</div>
            <div class="cron-meta-window">Showing ${runs.length} recent attempts</div>
        </div>
        <div class="cron-meta-grid">
            ${meta.map(([k, v]) => `
                <div class="cron-meta-item">
                    <div class="cron-meta-label">${escapeHtml(k)}</div>
                    <div class="cron-meta-value${k === 'History URL' || k === 'Job ID' ? ' is-code' : ''}">${escapeHtml(v)}</div>
                </div>`).join('')}
        </div>
        ${payloadPreview ? `
            <div class="cron-meta-payload">
                <div class="cron-meta-label">Payload preview</div>
                <p class="cron-meta-payload-text">${escapeHtml(payloadPreview)}</p>
            </div>` : ''}
        ${deliveryWarning ? `
            <div class="cron-job-warning">
                <div class="cron-job-warning-label">Unsupported WebChat delivery</div>
                <div class="cron-job-warning-text">${escapeHtml(deliveryWarning)}</div>
                <div class="cron-job-warning-actions">
                    <button class="btn btn-primary cron-small-btn" onclick="migrateUnsupportedWebchatCron('${jobIdJs}')">Migrate to Main session</button>
                </div>
            </div>` : ''}
    `;

    const errorEl = document.getElementById('cron-detail-error');
    if (diagnostics.latestFailure) {
        errorEl.classList.remove('hidden');
        errorEl.innerHTML = `
            <div class="cron-run-error-label">Latest failed attempt</div>
            <div class="cron-run-at">${escapeHtml(formatDateTime(diagnostics.latestFailure.runAtMs || diagnostics.latestFailure.ts))}</div>
            <div class="cron-run-error-text">${escapeHtml(diagnostics.latestFailure.error || diagnostics.latestFailure.summary || 'No error message recorded')}</div>
            <div class="cron-run-subline">Status: ${escapeHtml(diagnostics.latestFailure.status || '--')} · Duration: ${escapeHtml(String(diagnostics.latestFailure.durationMs || '--'))}ms · Provider: ${escapeHtml(diagnostics.latestFailure.provider || '--')} · Model: ${escapeHtml(diagnostics.latestFailure.model || '--')}</div>
        `;
    } else {
        errorEl.classList.add('hidden');
        errorEl.innerHTML = '';
    }
}

function renderDetailTimeline(runs = []) {
    const timeline = document.getElementById('cron-detail-timeline');
    if (!runs.length) {
        timeline.innerHTML = '<div class="empty-state">No run history available for this job.</div>';
        return;
    }

    timeline.innerHTML = runs.map((entry, index) => {
        const tone = getRunStatusTone(entry.status);
        const summary = truncateForList(entry.summary || '', 900);
        const error = truncateForList(entry.error || entry.deliveryError || entry.errorMessage || '', 700);
        const usage = entry.usage
            ? Object.entries(entry.usage).map(([k, v]) => `${k}: ${v}`).join(' • ')
            : '';

        return `
            <article class="cron-timeline-item">
                <div class="cron-timeline-rail">
                    <div class="cron-timeline-dot cron-tone-${tone}"></div>
                    ${index < runs.length - 1 ? '<div class="cron-timeline-line"></div>' : ''}
                </div>
                <div class="cron-timeline-card">
                    <div class="cron-run-head">
                        <div>
                            <div class="cron-run-badges">
                                <span class="badge cron-tone-${tone}">${escapeHtml(entry.status || 'unknown')}</span>
                                <span class="badge">${escapeHtml(entry.action || 'run')}</span>
                                ${entry.deliveryStatus ? `<span class="badge">delivery: ${escapeHtml(entry.deliveryStatus)}</span>` : ''}
                            </div>
                            <div class="cron-run-at">${escapeHtml(formatDateTime(entry.runAtMs || entry.ts))}</div>
                            <div class="cron-run-subline">Duration: ${escapeHtml(String(entry.durationMs || '--'))}ms · Next run: ${escapeHtml(formatDateTime(entry.nextRunAtMs))}</div>
                        </div>
                        <div class="cron-run-tech">
                            <div>Provider: ${escapeHtml(entry.provider || '--')}</div>
                            <div>Model: ${escapeHtml(entry.model || '--')}</div>
                            <div>Session: ${escapeHtml(entry.sessionId || '--')}</div>
                        </div>
                    </div>

                    ${error ? `
                        <div class="cron-run-error">
                            <div class="cron-run-error-label">Error details</div>
                            <div class="cron-run-error-text">${escapeHtml(error)}</div>
                        </div>` : ''}

                    ${summary ? `
                        <div class="cron-run-summary">
                            <div class="cron-run-summary-label">Summary / output</div>
                            <div class="cron-run-summary-text">${escapeHtml(summary)}</div>
                        </div>` : ''}

                    <div class="cron-run-grid">
                        <div class="cron-run-cell">
                            <div class="cron-run-cell-label">Session key</div>
                            <div class="cron-run-cell-value is-code">${escapeHtml(entry.sessionKey || '--')}</div>
                        </div>
                        <div class="cron-run-cell">
                            <div class="cron-run-cell-label">Token usage</div>
                            <div class="cron-run-cell-value">${escapeHtml(usage || '--')}</div>
                        </div>
                        <div class="cron-run-cell">
                            <div class="cron-run-cell-label">Delivery</div>
                            <div class="cron-run-cell-value">${escapeHtml(entry.delivered ? 'Delivered' : 'Not delivered')} ${entry.deliveryError ? `• ${escapeHtml(entry.deliveryError)}` : ''}</div>
                        </div>
                    </div>
                </div>
            </article>`;
    }).join('');
}

async function openCronDetailView(jobId, { refresh = false, pushState = true } = {}) {
    const detailView = document.getElementById('cron-detail-view');
    const listView = document.getElementById('cron-list-view');
    const timeline = document.getElementById('cron-detail-timeline');
    if (!detailView || !listView || !timeline) return;

    const detailStartedAt = performance.now();
    const loadToken = ++cronDetailLoadToken;
    activeCronJobId = jobId;
    listView.classList.remove('hidden');
    detailView.classList.remove('hidden');
    setCronDetailDrawerOpen(true);
    renderCronJobs();
    timeline.innerHTML = '<div class="empty-state">Loading run timeline...</div>';
    document.getElementById('cron-detail-summary').innerHTML = '';
    document.getElementById('cron-detail-meta').innerHTML = '<div class="empty-state">Loading job metadata...</div>';
    document.getElementById('cron-detail-error').classList.add('hidden');
    document.getElementById('cron-detail-error').innerHTML = '';

    if (pushState) setCronDetailURL(jobId);

    const initialRunLimit = refresh ? Math.min(CRON_DETAIL_FULL_RUN_LIMIT, 24) : CRON_DETAIL_INITIAL_RUN_LIMIT;
    const initialRunsPromise = fetchCronRuns(jobId, { refresh, limit: initialRunLimit });

    let job = getJobById(jobId);
    let listReadyAt = performance.now();
    if (!job) {
        await loadCronJobs({ silent: true, skipDiagnostics: true });
        if (loadToken !== cronDetailLoadToken) return;
        job = getJobById(jobId);
        listReadyAt = performance.now();
    }
    if (!job) {
        initialRunsPromise.catch(() => {});
        if (loadToken !== cronDetailLoadToken) return;
        activeCronJobId = null;
        setCronDetailDrawerOpen(false);
        renderCronJobs();
        renderEmptyDetailState('That cron job could not be found.');
        return;
    }

    document.getElementById('cron-detail-title').textContent = job.name || job.id || 'Cron Job History';
    document.getElementById('cron-detail-subtitle').textContent = `${formatCronSchedule(job.schedule)} · ${job.id}`;

    document.getElementById('cron-detail-run-btn').onclick = () => runCronJob(job.id);
    document.getElementById('cron-detail-refresh-btn').onclick = () => openCronDetailView(job.id, { refresh: true, pushState: false });
    document.getElementById('cron-detail-copy-btn').onclick = () => copyCronTimelineJson();
    document.getElementById('cron-detail-export-btn').onclick = () => exportCronTimelineJson();

    try {
        const runs = await initialRunsPromise;
        if (loadToken !== cronDetailLoadToken) return;
        activeCronTimeline = runs;
        const diagnostics = cronDiagnostics.get(job.id) || summarizeRuns(runs);
        document.getElementById('cron-detail-summary').innerHTML = renderCronDetailSummary(job, diagnostics);
        renderDetailMeta(job, runs, diagnostics);
        renderDetailTimeline(runs);
        console.log(`[Perf][Cron] detail open for ${job.id}: list ready ${Math.round(listReadyAt - detailStartedAt)}ms, initial runs ${Math.round(performance.now() - listReadyAt)}ms`);

        const cachedLimit = getCachedCronRunLimit(job.id);
        if (!refresh && cachedLimit < CRON_DETAIL_FULL_RUN_LIMIT) {
            setTimeout(async () => {
                try {
                    const fullRuns = await fetchCronRuns(job.id, { refresh: true, limit: CRON_DETAIL_FULL_RUN_LIMIT });
                    if (loadToken !== cronDetailLoadToken) return;
                    if (String(activeCronJobId) !== String(job.id) || !cronDetailDrawerOpen) return;

                    activeCronTimeline = fullRuns;
                    const fullDiagnostics = cronDiagnostics.get(job.id) || summarizeRuns(fullRuns);
                    document.getElementById('cron-detail-summary').innerHTML = renderCronDetailSummary(job, fullDiagnostics);
                    renderDetailMeta(job, fullRuns, fullDiagnostics);
                    renderDetailTimeline(fullRuns);
                } catch (backgroundErr) {
                    console.warn('[Cron] Background timeline expansion failed:', backgroundErr?.message || backgroundErr);
                }
            }, 0);
        }
    } catch (e) {
        if (loadToken !== cronDetailLoadToken) return;
        timeline.innerHTML = `<div class="empty-state">Failed to load run timeline: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }
}

window.closeCronDetailView = function() {
    showCronListView();
    activeCronTimeline = [];
    const targetPath = buildDetailURL(null);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (targetPath !== currentPath) {
        history.pushState({ page: 'cron' }, '', targetPath);
    }
};

window.tuckCronDetailView = function() {
    setCronDetailDrawerOpen(false);
};

window.reopenCronDetailView = function() {
    if (!activeCronJobId) {
        showToast('Select a cron job first', 'warning');
        return;
    }
    openCronDetailView(activeCronJobId, { pushState: false });
};

window.setCronListFilter = function(filter) {
    cronListFilter = filter || 'all';
    updateCronFilterChips();
    renderCronJobs();
};

window.toggleCronAdvancedControls = function() {
    cronAdvancedControlsOpen = !cronAdvancedControlsOpen;
    updateCronAdvancedControlsUI();
};

window.resetCronListControls = function() {
    cronListFilter = 'all';
    cronListQuery = '';
    cronAgentFilter = 'all';
    cronEnabledFilter = 'all';
    cronActivityFilter = 'all';
    cronSortBy = 'nextRun';
    cronSortDirection = 'asc';
    cronAdvancedControlsOpen = false;

    const searchInput = document.getElementById('cron-search-input');
    if (searchInput) searchInput.value = '';
    const enabledFilter = document.getElementById('cron-enabled-filter');
    if (enabledFilter) enabledFilter.value = 'all';
    const activityFilter = document.getElementById('cron-activity-filter');
    if (activityFilter) activityFilter.value = 'all';
    const sortBySelect = document.getElementById('cron-sort-by');
    if (sortBySelect) sortBySelect.value = 'nextRun';
    populateCronAgentFilterOptions();

    updateCronFilterChips();
    updateCronSortDirectionButton();
    updateCronAdvancedControlsUI();
    renderCronJobs();
};

window.copyCronListJson = async function() {
    await copyJsonToClipboard(buildCronListExport(), 'Copied cron list JSON');
};

window.exportCronListJson = function() {
    downloadJson(`cron-list-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, buildCronListExport());
    showToast('Cron list JSON exported', 'success');
};

window.copyCronTimelineJson = async function() {
    if (!activeCronJobId) {
        showToast('Open a cron timeline first', 'warning');
        return;
    }
    await copyJsonToClipboard(buildCronTimelineExport(activeCronJobId), 'Copied cron timeline JSON');
};

window.exportCronTimelineJson = function() {
    if (!activeCronJobId) {
        showToast('Open a cron timeline first', 'warning');
        return;
    }
    downloadJson(`cron-timeline-${activeCronJobId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, buildCronTimelineExport(activeCronJobId));
    showToast('Cron timeline JSON exported', 'success');
};

async function loadCronJobs({ silent = false, skipDiagnostics = false } = {}) {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return cronJobs;

    if (cronListLoadPromise) {
        return cronListLoadPromise;
    }

    const startedAt = performance.now();

    if (!silent && !cronJobs.length) {
        container.innerHTML = '<div class="empty-state">Loading cron jobs...</div>';
    }

    if (!gateway || !gateway.isConnected()) {
        if (!cronJobs.length) {
            container.innerHTML = '<div class="empty-state">Connect to gateway to manage cron jobs</div>';
        }
        return cronJobs;
    }

    cronListLoadPromise = (async () => {
        try {
            const result = await gateway._request('cron.list', { includeDisabled: true }, CRON_REQUEST_TIMEOUT_MS);
            cronJobs = Array.isArray(result?.jobs) ? result.jobs : (Array.isArray(result) ? result : []);
            cronLastLoadedAt = Date.now();
            writeCronCache(cronJobs);
            persistCronNameMap();
            populateCronAgentFilterOptions();
            if (activeCronJobId && !getJobById(activeCronJobId)) {
                activeCronJobId = null;
                renderEmptyDetailState('The previously selected job is no longer available.');
                setCronDetailDrawerOpen(false);
            }
            renderCronJobs();
            console.log(`[Perf][Cron] cron.list + first render: ${Math.round(performance.now() - startedAt)}ms for ${cronJobs.length} jobs`);
            if (!skipDiagnostics) {
                console.log('[Perf][Cron] Skipping history warm-up on initial page load');
            }
            return cronJobs;
        } catch (e) {
            console.warn('[Cron] Failed to fetch jobs:', e.message);
            if (!cronJobs.length) {
                container.innerHTML = `<div class="empty-state">Could not load cron jobs: ${escapeHtml(e.message || 'Unknown error')}</div>`;
            } else if (!silent && typeof showToast === 'function') {
                showToast('Using cached cron jobs while refresh retries', 'warning');
            }
            return cronJobs;
        } finally {
            cronListLoadPromise = null;
        }
    })();

    return cronListLoadPromise;
}

function renderCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    updateCronFilterChips();

    if (cronJobs.length === 0) {
        updateCronListMeta(0, 0);
        container.innerHTML = '<div class="empty-state">No cron jobs configured</div>';
        return;
    }

    const visibleJobs = getVisibleCronJobs();
    updateCronListMeta(cronJobs.length, visibleJobs.length);

    if (!visibleJobs.length) {
        container.innerHTML = '<div class="empty-state">No jobs match the current search/filter.</div>';
        return;
    }

    container.innerHTML = visibleJobs.map((job, idx) => {
        const enabled = job.enabled !== false;
        const lastStatus = getLastStatus(job);
        const statusTone = getRunStatusTone(lastStatus);
        const nextRun = formatNextRun(job);
        const lastRun = formatLastRun(job);
        const scheduleText = formatCronSchedule(job.schedule || job.cron);
        const payloadPreview = truncateForList(getPayloadSummary(job) || job.description || 'No summary available');
        const state = getCronState(job);
        const diagnostics = cronDiagnostics.get(job.id);
        const latestFailure = diagnostics?.latestFailure;
        const latestFailureMessage = latestFailure?.error || latestFailure?.summary || getLastError(job) || '';
        const accent = getCronJobAccentColor(job);
        const jobId = String(job.id || idx);
        const jobIdJs = jobId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const isActive = String(activeCronJobId) === jobId;
        const failureCount = diagnostics?.failureCount || 0;
        const successCount = diagnostics?.successCount || 0;
        const ownerAgent = getCronJobOwnerAgent(job);
        const activeClass = isActive ? ' is-active' : '';
        const statusToneClass = statusTone !== 'neutral' ? ` cron-tone-${statusTone}` : '';
        const deliveryWarning = getCronDeliveryWarning(job);
        const displayModel = getCronJobDisplayModel(job, diagnostics);

        return `
        <article class="cron-job-card${activeClass}" style="--cron-accent: ${accent};" role="button" tabindex="0" onclick="openCronDetailView('${jobIdJs}')" onkeydown="if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); openCronDetailView('${jobIdJs}'); }">
            <div class="cron-job-header">
                <div class="cron-job-main">
                    <div class="cron-job-title-row">
                        <span class="cron-job-status-dot"></span>
                        <span class="cron-job-title">${escapeHtml(job.name || job.id || 'Unnamed Job')}</span>
                        ${ownerAgent ? `<span class="badge cron-job-badge">${escapeHtml(ownerAgent)}</span>` : ''}
                        ${!enabled ? '<span class="badge cron-job-badge">Disabled</span>' : ''}
                        ${lastStatus && lastStatus !== '--' ? `<span class="badge cron-job-badge${statusToneClass}">${escapeHtml(lastStatus)}</span>` : ''}
                        ${job.sessionTarget ? `<span class="badge cron-job-badge">${escapeHtml(job.sessionTarget)}</span>` : ''}
                        ${displayModel && displayModel !== '--' ? `<span class="badge cron-job-badge">${escapeHtml(displayModel)}</span>` : ''}
                        ${deliveryWarning ? '<span class="badge cron-job-badge cron-tone-error">webchat unsupported</span>' : ''}
                    </div>
                    <div class="cron-job-id">${escapeHtml(job.id || '--')}</div>
                    <p class="cron-job-preview">${escapeHtml(payloadPreview)}</p>
                </div>
                <div class="cron-job-actions" onclick="event.stopPropagation();">
                    <button onclick="event.stopPropagation(); toggleCronJob('${jobIdJs}', ${!enabled});" class="cron-job-action-btn" title="${enabled ? 'Disable job' : 'Enable job'}">${enabled ? 'Pause' : 'Enable'}</button>
                    <button onclick="event.stopPropagation(); runCronJob('${jobIdJs}');" class="cron-job-action-btn cron-job-action-run" title="Run now">Run now</button>
                    <button onclick="event.stopPropagation(); openEditCronModal('${jobIdJs}');" class="cron-job-action-btn" title="Edit job">Edit</button>
                </div>
            </div>

            <div class="cron-job-divider"></div>

            <div class="cron-job-kpis">
                <div class="cron-job-kpi">
                    <div class="cron-job-kpi-label">Next run</div>
                    <div class="cron-job-kpi-value">${escapeHtml(nextRun)}</div>
                </div>
                <div class="cron-job-kpi">
                    <div class="cron-job-kpi-label">Last result</div>
                    <div class="cron-job-kpi-value">${escapeHtml(lastRun)}</div>
                </div>
            </div>

            <div class="cron-job-divider"></div>

            <div class="cron-job-footer">
                <code class="cron-schedule-code">${escapeHtml(scheduleText)}</code>
                ${state.consecutiveErrors ? `<span class="cron-job-consecutive-errors">${escapeHtml(String(state.consecutiveErrors))} consecutive errors</span>` : ''}
                ${(failureCount || successCount) ? `<span>${failureCount} failed · ${successCount} successful</span>` : ''}
            </div>

            ${deliveryWarning ? `
                <div class="cron-job-warning">
                    <div class="cron-job-warning-label">Unsupported WebChat delivery</div>
                    <div class="cron-job-warning-text">${escapeHtml(deliveryWarning)}</div>
                    <div class="cron-job-warning-actions">
                        <button onclick="event.stopPropagation(); migrateUnsupportedWebchatCron('${jobIdJs}');" class="btn btn-primary cron-small-btn" type="button">Migrate to Main session</button>
                    </div>
                </div>` : ''}
            ${latestFailureMessage && getCronJobStatusTone(job) === 'error' ? `
                <div class="cron-job-latest-failure">
                    <div class="cron-job-latest-failure-label">Latest failure</div>
                    <div class="cron-job-latest-failure-text">${escapeHtml(latestFailureMessage)}</div>
                </div>` : ''}
        </article>`;
    }).join('');
}

async function toggleCronJob(jobId, enable) {
    try {
        await gateway._request('cron.update', { jobId, patch: { enabled: enable } });
        showToast(`Job ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function runCronJob(jobId) {
    try {
        await gateway._request('cron.run', { jobId, mode: 'force' });
        showToast('Job triggered', 'success');
        cronRunCache.delete(jobId);
        cronDiagnostics.delete(jobId);
        if (activeCronJobId === jobId && cronDetailDrawerOpen) {
            openCronDetailView(jobId, { refresh: true, pushState: false });
        } else {
            loadCronJobs({ silent: true });
        }
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

window.migrateUnsupportedWebchatCron = async function(jobId) {
    const job = getJobById(jobId || activeCronJobId);
    if (!job) {
        showToast('Select a cron job to migrate', 'warning');
        return;
    }

    if (!hasUnsupportedWebchatAnnounce(job)) {
        showToast('This cron job is not using unsupported WebChat announce delivery', 'success');
        return;
    }

    const patch = buildCronWebchatMigrationPatch(job);

    try {
        await gateway._request('cron.update', { jobId: job.id, patch });
        const convertedToMain = patch.sessionTarget === 'main';
        showToast(convertedToMain
            ? 'Cron job migrated: WebChat announce removed and session switched to Main'
            : 'Cron job migrated: unsupported WebChat announce removed', 'success');
        await loadCronJobs();
        if (String(activeCronJobId) === String(job.id)) {
            openCronDetailView(job.id, { refresh: true, pushState: false });
        }
    } catch (e) {
        showToast('Migration failed: ' + e.message, 'error');
    }
};

window.refreshCronDiagnostics = async function() {
    cronRunCache.clear();
    cronDiagnostics.clear();
    await loadCronJobs();
    showToast('Cron diagnostics refreshed', 'success');
};

window.openAddCronModal = function() {
    const modal = document.getElementById('add-cron-modal');
    if (modal) modal.classList.add('visible');
};

window.closeAddCronModal = function() {
    const modal = document.getElementById('add-cron-modal');
    if (modal) modal.classList.remove('visible');
};

// Schedule builder functions
window.updateCronScheduleBuilder = function(prefix) {
    const type = document.getElementById(`cron-${prefix}-schedule-type`)?.value;
    const rows = ['daily', 'weekly', 'monthly', 'hourly', 'minutes'];
    rows.forEach(row => {
        const el = document.getElementById(`cron-${prefix}-schedule-${row}`);
        if (el) el.classList.toggle('hidden', row !== type);
    });
    updateCronScheduleFromBuilder(prefix);
};

window.updateCronScheduleFromBuilder = function(prefix) {
    const type = document.getElementById(`cron-${prefix}-schedule-type`)?.value;
    const preview = document.getElementById(`cron-${prefix}-schedule-preview`);
    const hiddenInput = document.getElementById(`cron-${prefix}-schedule`);
    let expr = '';
    let previewText = '';

    if (type === 'daily') {
        const time = document.getElementById(`cron-${prefix}-daily-time`)?.value || '09:00';
        const [h, m] = time.split(':').map(Number);
        expr = `${m} ${h} * * *`;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        previewText = `Daily at ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    } else if (type === 'weekly') {
        const day = parseInt(document.getElementById(`cron-${prefix}-weekly-day`)?.value || '0');
        const time = document.getElementById(`cron-${prefix}-weekly-time`)?.value || '09:00';
        const [h, m] = time.split(':').map(Number);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        expr = `${m} ${h} * * ${day}`;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        previewText = `Weekly on ${days[day]}s at ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    } else if (type === 'monthly') {
        const day = parseInt(document.getElementById(`cron-${prefix}-monthly-day`)?.value || '1');
        const time = document.getElementById(`cron-${prefix}-monthly-time`)?.value || '09:00';
        const [h, m] = time.split(':').map(Number);
        expr = `${m} ${h} ${day} * *`;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        const suffix = getOrdinalSuffix(day);
        previewText = `Monthly on the ${day}${suffix} at ${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    } else if (type === 'hourly') {
        expr = '0 * * * *';
        previewText = 'Every hour at minute 0';
    } else if (type === 'minutes') {
        const interval = parseInt(document.getElementById(`cron-${prefix}-minutes-interval`)?.value || '15');
        expr = `*/${interval} * * * *`;
        previewText = `Every ${interval} minutes`;
    }

    if (hiddenInput) hiddenInput.value = expr;
    if (preview) preview.textContent = previewText;
};

function getOrdinalSuffix(n) {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

window.submitNewCronJob = async function() {
    const name = document.getElementById('cron-new-name')?.value?.trim();
    const scheduleExpr = document.getElementById('cron-new-schedule')?.value?.trim();
    const command = document.getElementById('cron-new-command')?.value?.trim();
    const agentId = document.getElementById('cron-new-agent')?.value?.trim();
    const sessionTarget = document.getElementById('cron-new-session-target')?.value?.trim() || 'main';

    if (!name || !scheduleExpr || !command) {
        showToast('Name, schedule, and message are required', 'warning');
        return;
    }

    const job = {
        name,
        schedule: {
            kind: 'cron',
            expr: scheduleExpr,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        },
        sessionTarget,
        wakeMode: 'now',
        payload: {
            kind: 'systemEvent',
            text: command
        },
        enabled: true
    };

    if (agentId) {
        job.agentId = agentId;
    }

    try {
        await gateway._request('cron.add', job);
        showToast('Cron job added', 'success');
        closeAddCronModal();
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

let editingCronJobId = null;
let cronEditModelCatalog = null;

async function fetchCronModelCatalog() {
    if (cronEditModelCatalog) return cronEditModelCatalog;
    const response = await fetch('/api/models/list');
    if (!response.ok) throw new Error(`Failed to load models (${response.status})`);
    cronEditModelCatalog = await response.json();
    return cronEditModelCatalog;
}

function getCronModelProviderFromId(modelId) {
    if (!modelId) return '';
    if (typeof window.getProviderFromModelId === 'function') {
        return window.getProviderFromModelId(modelId) || '';
    }
    if (typeof modelId === 'string' && modelId.includes('/')) {
        return modelId.startsWith('openrouter/') ? 'openrouter' : modelId.split('/')[0];
    }
    return '';
}

async function populateCronEditProviderDropdown(selectedProvider = '', selectedModel = '') {
    const providerSelect = document.getElementById('cron-edit-model-provider');
    if (!providerSelect) return [];

    const catalog = await fetchCronModelCatalog();
    const providers = Object.keys(catalog || {});
    const inferredProvider = selectedProvider || getCronModelProviderFromId(selectedModel) || '';

    providerSelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Default / unchanged';
    providerSelect.appendChild(defaultOption);

    providers.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider;
        option.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (provider === inferredProvider) option.selected = true;
        providerSelect.appendChild(option);
    });

    await populateCronEditModelDropdown(providerSelect.value || inferredProvider || '', selectedModel);
    return providers;
}

async function populateCronEditModelDropdown(provider, selectedModel = '') {
    const modelSelect = document.getElementById('cron-edit-model');
    if (!modelSelect) return;

    modelSelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Default / unchanged';
    modelSelect.appendChild(defaultOption);

    if (!provider) {
        modelSelect.value = '';
        return;
    }

    const catalog = await fetchCronModelCatalog();
    const models = Array.isArray(catalog?.[provider]) ? catalog[provider] : [];
    const normalizedSelectedModel = selectedModel && typeof window.resolveFullModelId === 'function'
        ? window.resolveFullModelId(selectedModel)
        : selectedModel;

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name || model.id;
        if (model.id === normalizedSelectedModel) option.selected = true;
        modelSelect.appendChild(option);
    });

    if (!normalizedSelectedModel) {
        modelSelect.value = '';
    }
}

window.onCronEditModelProviderChange = async function() {
    const provider = document.getElementById('cron-edit-model-provider')?.value || '';
    await populateCronEditModelDropdown(provider, '');
};

window.openEditCronModal = async function(jobId) {
    const job = getJobById(jobId || activeCronJobId);
    if (!job) {
        showToast('Select a cron job to edit', 'warning');
        return;
    }

    editingCronJobId = job.id;

    const deliveryWarning = getCronDeliveryWarning(job);
    if (deliveryWarning) {
        showToast('This job still has unsupported WebChat announce delivery. Use Main session for dashboard-visible reminders, or move delivery to webhook / a real provider channel.', 'warning');
    }

    // Pre-fill the form
    document.getElementById('cron-edit-id').value = job.id;
    document.getElementById('cron-edit-name').value = job.name || '';
    document.getElementById('cron-edit-command').value = getPayloadSummary(job) || '';

    const sessionTarget = document.getElementById('cron-edit-session-target');
    if (sessionTarget) {
        sessionTarget.value = job.sessionTarget || 'main';
    }

    const agentSelect = document.getElementById('cron-edit-agent');
    if (agentSelect) {
        agentSelect.value = job.agentId || '';
    }

    const delivery = getCronDelivery(job);
    const deliveryModeInput = document.getElementById('cron-edit-delivery-mode');
    const deliveryChannelInput = document.getElementById('cron-edit-delivery-channel');
    const deliveryToInput = document.getElementById('cron-edit-delivery-to');
    if (deliveryModeInput) {
        deliveryModeInput.value = delivery?.mode || 'none';
    }
    if (deliveryChannelInput) {
        deliveryChannelInput.value = delivery?.channel || '';
    }
    if (deliveryToInput) {
        deliveryToInput.value = delivery?.to || '';
    }
    updateCronDeliveryFields('edit');

    const payloadModel = job?.payload?.model || '';
    const payloadProvider = getCronModelProviderFromId(payloadModel);
    try {
        await populateCronEditProviderDropdown(payloadProvider, payloadModel);
    } catch (e) {
        console.warn('[Cron] Failed to load model dropdowns:', e.message);
        showToast('Failed to load model list for cron editor: ' + e.message, 'warning');
    }

    // Parse cron expression and pre-fill schedule builder
    const cronExpr = job.schedule?.expr || '';
    const parsed = parseCronForBuilder(cronExpr);
    const typeSelect = document.getElementById('cron-edit-schedule-type');
    if (typeSelect) typeSelect.value = parsed.type;
    updateCronScheduleBuilder('edit');

    // Fill the specific inputs
    if (parsed.type === 'daily') {
        const timeInput = document.getElementById('cron-edit-daily-time');
        if (timeInput) timeInput.value = parsed.time;
    } else if (parsed.type === 'weekly') {
        const daySelect = document.getElementById('cron-edit-weekly-day');
        if (daySelect) daySelect.value = parsed.day;
        const timeInput = document.getElementById('cron-edit-weekly-time');
        if (timeInput) timeInput.value = parsed.time;
    } else if (parsed.type === 'monthly') {
        const dayInput = document.getElementById('cron-edit-monthly-day');
        if (dayInput) dayInput.value = parsed.day;
        const timeInput = document.getElementById('cron-edit-monthly-time');
        if (timeInput) timeInput.value = parsed.time;
    } else if (parsed.type === 'minutes') {
        const intervalInput = document.getElementById('cron-edit-minutes-interval');
        if (intervalInput) intervalInput.value = parsed.interval;
    }

    // Set the hidden cron expression and preview
    const hiddenInput = document.getElementById('cron-edit-schedule');
    if (hiddenInput) hiddenInput.value = cronExpr;
    const preview = document.getElementById('cron-edit-schedule-preview');
    if (preview) preview.textContent = parsed.previewText;

    const modal = document.getElementById('edit-cron-modal');
    if (modal) modal.classList.add('visible');
};

function parseCronForBuilder(expr) {
    // Returns: { type, time, day, interval, previewText }
    const result = { type: 'daily', time: '09:00', day: '0', interval: '15', previewText: 'Daily at 9:00 AM' };

    if (!expr) return result;

    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return result;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Every X minutes: */X
    if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
        const interval = minute.substring(2);
        result.type = 'minutes';
        result.interval = interval;
        result.previewText = `Every ${interval} minutes`;
        return result;
    }

    // Every hour at minute X: X * * * *
    if (minute !== '*' && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
        result.type = 'hourly';
        result.time = `${String(hour || 0).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        result.previewText = 'Every hour at minute ' + minute;
        return result;
    }

    // Daily at X: X Y * * *
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && dayOfWeek === '*') {
        result.type = 'daily';
        result.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        result.previewText = `Daily at ${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
        return result;
    }

    // Weekly on X at Y: X Y * * Z
    if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && dayOfWeek !== '*') {
        result.type = 'weekly';
        result.day = dayOfWeek;
        result.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        result.previewText = `Weekly on ${days[parseInt(dayOfWeek)]}s at ${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
        return result;
    }

    // Monthly on X at Y: X Y Z * *
    if (minute !== '*' && hour !== '*' && dayOfMonth !== '*') {
        result.type = 'monthly';
        result.day = dayOfMonth;
        result.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        const suffix = getOrdinalSuffix(parseInt(dayOfMonth));
        result.previewText = `Monthly on the ${dayOfMonth}${suffix} at ${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
        return result;
    }

    return result;
}

window.updateCronDeliveryFields = function(mode = 'edit') {
    const modeValue = document.getElementById(`cron-${mode}-delivery-mode`)?.value || 'none';
    const announceWrap = document.getElementById(`cron-${mode}-delivery-announce`);
    const toWrap = document.getElementById(`cron-${mode}-delivery-to-wrap`);
    const toHint = document.getElementById(`cron-${mode}-delivery-to-hint`);

    if (announceWrap) {
        announceWrap.classList.toggle('hidden', modeValue !== 'announce');
    }
    if (toWrap) {
        toWrap.classList.toggle('hidden', modeValue === 'none');
    }
    if (toHint) {
        toHint.textContent = modeValue === 'webhook'
            ? 'Required for webhook. Use a full HTTPS URL.'
            : 'Optional for announce. Leave blank to use the default announce target if configured.';
    }
};

window.closeEditCronModal = function() {
    editingCronJobId = null;
    const modal = document.getElementById('edit-cron-modal');
    if (modal) modal.classList.remove('visible');
};

window.submitEditCronJob = async function() {
    const jobId = document.getElementById('cron-edit-id')?.value?.trim();
    const name = document.getElementById('cron-edit-name')?.value?.trim();
    const scheduleExpr = document.getElementById('cron-edit-schedule')?.value?.trim();
    const command = document.getElementById('cron-edit-command')?.value?.trim();
    const sessionTarget = document.getElementById('cron-edit-session-target')?.value?.trim() || 'main';
    const agentId = document.getElementById('cron-edit-agent')?.value?.trim();
    const deliveryMode = document.getElementById('cron-edit-delivery-mode')?.value?.trim() || 'none';
    const deliveryChannel = document.getElementById('cron-edit-delivery-channel')?.value?.trim();
    const deliveryTo = document.getElementById('cron-edit-delivery-to')?.value?.trim();
    const modelProvider = document.getElementById('cron-edit-model-provider')?.value?.trim();
    const selectedModelRaw = document.getElementById('cron-edit-model')?.value?.trim();

    if (!jobId || !name || !scheduleExpr || !command) {
        showToast('Name, schedule, and message are required', 'warning');
        return;
    }

    if (deliveryMode === 'webhook' && !deliveryTo) {
        showToast('Webhook delivery requires a destination URL', 'warning');
        return;
    }

    const selectedModel = selectedModelRaw && typeof window.resolveFullModelId === 'function'
        ? window.resolveFullModelId(selectedModelRaw)
        : selectedModelRaw;

    if (selectedModel && !modelProvider) {
        showToast('Choose a model provider before selecting a model', 'warning');
        return;
    }

    const existingJob = getJobById(jobId || editingCronJobId);
    const existingPayload = existingJob?.payload && typeof existingJob.payload === 'object' ? existingJob.payload : {};
    const payloadKind = existingPayload.kind || 'systemEvent';
    const payload = { kind: payloadKind };

    if (payloadKind === 'agentTurn') {
        payload.message = command;
        if (typeof existingPayload.timeoutSeconds === 'number') payload.timeoutSeconds = existingPayload.timeoutSeconds;
    } else {
        payload.text = command;
    }

    const patch = {
        name,
        schedule: {
            kind: 'cron',
            expr: scheduleExpr,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        },
        sessionTarget,
        payload,
        delivery: { mode: deliveryMode }
    };

    if (selectedModel) {
        patch.payload.model = selectedModel;
    }

    if (deliveryMode === 'announce') {
        if (deliveryChannel) patch.delivery.channel = deliveryChannel;
        if (deliveryTo) patch.delivery.to = deliveryTo;
    } else if (deliveryMode === 'webhook') {
        patch.delivery.to = deliveryTo;
    }

    if (agentId) {
        patch.agentId = agentId;
    } else {
        patch.agentId = null; // Clear agent if not specified
    }

    try {
        await gateway._request('cron.update', { jobId, patch });
        showToast('Cron job updated', 'success');
        closeEditCronModal();
        loadCronJobs();

        // Refresh detail view if this job is selected
        if (String(activeCronJobId) === String(jobId)) {
            openCronDetailView(jobId, { refresh: true, pushState: false });
        }
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window._cronJobs = Object.assign(window._cronJobs || {}, {
    ensureLoaded: async function (options = {}) {
        return loadCronJobs(options);
    },
    getJobs: function () {
        return Array.isArray(cronJobs) ? cronJobs.slice() : [];
    },
    getOwnerAgent: function (job) {
        return getCronJobOwnerAgent(job);
    },
    getLastStatus: function (job) {
        return getLastStatus(job);
    },
    getPayloadSummary: function (job) {
        return getPayloadSummary(job);
    },
    formatSchedule: function (job) {
        return formatCronSchedule(job?.schedule || job?.cron);
    },
    formatNextRun: function (job) {
        return formatNextRun(job);
    },
    formatLastRun: function (job) {
        return formatLastRun(job);
    },
    isConnected: function () {
        return Boolean(gateway && typeof gateway.isConnected === 'function' && gateway.isConnected());
    },
    openPage: function () {
        if (typeof showPage === 'function') showPage('cron');
    },
    openJob: function (jobId) {
        const safeJobId = String(jobId || '').trim();
        if (!safeJobId) return;

        const openDetail = (attempts = 0) => {
            const detailView = document.getElementById('cron-detail-view');
            if (detailView && typeof openCronDetailView === 'function') {
                openCronDetailView(safeJobId, { pushState: true });
                return;
            }
            if (attempts < 8) {
                setTimeout(() => openDetail(attempts + 1), 80);
            }
        };

        if (typeof showPage === 'function') showPage('cron');
        setTimeout(() => openDetail(), 80);
    }
});

window.addEventListener('popstate', () => {
    if (window.location.pathname === '/cron') {
        syncCronViewFromURL();
    }
});

// === health.js ===
// js/health.js — System health monitoring

// ===================
// SYSTEM HEALTH FUNCTIONS
// ===================

let healthTestResults = {};
let healthTestInProgress = false;
let pendingHealthChecks = new Map(); // sessionKey -> { resolve, reject, timer }

// Initialize health page when shown
function initHealthPage() {
    updateHealthGatewayStatus();
    loadHealthModels();
}

// Update gateway connection status
function updateHealthGatewayStatus() {
    const statusEl = document.getElementById('health-gateway-status');
    if (!statusEl) return;

    if (gateway && gateway.isConnected()) {
        statusEl.innerHTML = `
            <span style="font-size: 20px;">✅</span>
            <span style="font-weight: 500; color: var(--success);">Connected</span>
        `;
    } else {
        statusEl.innerHTML = `
            <span style="font-size: 20px;">❌</span>
            <span style="font-weight: 500; color: var(--error);">Disconnected</span>
        `;
    }
}

// Load available models from API
async function loadHealthModels() {
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error('Failed to fetch models');
        const data = await response.json();

        // API returns models grouped by provider: { anthropic: [...], google: [...] }
        // Flatten into a single array
        let models = [];
        if (data.models) {
            // Direct models array format
            models = data.models;
        } else {
            // Provider-grouped format - flatten it
            for (const provider of Object.keys(data)) {
                if (Array.isArray(data[provider])) {
                    models = models.concat(data[provider]);
                }
            }
        }

        const countEl = document.getElementById('health-model-count');
        if (countEl) countEl.textContent = models.length;

        // Render initial model list (not tested yet)
        renderHealthModelList(models, {});

        return models;
    } catch (error) {
        console.error('[Health] Failed to load models:', error);
        const countEl = document.getElementById('health-model-count');
        if (countEl) countEl.textContent = '?';
        return [];
    }
}

// Test a single model using EXACT same path as chat (same session, same WebSocket, same auth)
// Uses gateway.sendTestMessage() which mirrors sendMessage() but with a model override
async function testSingleModel(modelId) {
    const startTime = Date.now();

    try {
        // Check if gateway is connected
        if (!gateway || !gateway.isConnected()) {
            return {
                success: false,
                error: 'Gateway not connected',
                latencyMs: Date.now() - startTime
            };
        }

        // Create a unique health-check session for this model to ensure isolation
        const healthSessionKey = 'health-check-' + modelId.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        console.log(`[Health] Testing model ${modelId} using session ${healthSessionKey}`);

        // Patch session to use the target model (ensures gateway uses correct model)
        try {
            await gateway.patchSession(healthSessionKey, { model: modelId });
        } catch (patchErr) {
            console.warn(`[Health] Session patch failed (may not exist yet): ${patchErr.message}`);
        }

        // Wait for the response event on this specific session
        const responsePromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Response timeout (60s)'));
            }, 60000);
            
            // Store resolver so chat event handler can call it
            window._healthCheckResolvers = window._healthCheckResolvers || {};
            window._healthCheckResolvers[healthSessionKey] = {
                resolve: (res) => {
                    clearTimeout(timer);
                    delete window._healthCheckResolvers[healthSessionKey];
                    resolve(res);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    delete window._healthCheckResolvers[healthSessionKey];
                    reject(err);
                }
            };
        });

        // Send test message via chat.send - same path as regular chat
        const result = await gateway.sendTestMessage('OK', modelId, healthSessionKey);
        console.log(`[Health] Message sent, runId: ${result?.runId}, waiting for response...`);

        // Wait for actual LLM response
        const response = await responsePromise;
        const latencyMs = Date.now() - startTime;
        
        console.log(`[Health] ✅ Model ${modelId} responded: ${response?.content?.substring(0, 50)}...`);
        
        return {
            success: true,
            response: response?.content || 'OK',
            latencyMs
        };

    } catch (error) {
        return {
            success: false,
            error: error.message || 'Test failed',
            latencyMs: Date.now() - startTime
        };
    }
}

// Run health checks on all models
window.runAllModelTests = async function () {
    if (healthTestInProgress) {
        showToast('Health check already in progress', 'warning');
        return;
    }

    healthTestInProgress = true;
    healthTestResults = {};

    const testBtn = document.getElementById('test-all-btn');
    const progressEl = document.getElementById('health-test-progress');

    if (testBtn) {
        testBtn.disabled = true;
        testBtn.innerHTML = '⏳ Testing...';
    }

    try {
        // Load models
        const models = await loadHealthModels();

        if (models.length === 0) {
            showToast('No models found to test', 'warning');
            return;
        }

        // Mark all as testing
        models.forEach(m => {
            healthTestResults[m.id] = { status: 'testing' };
        });
        renderHealthModelList(models, healthTestResults);

        // Test each model sequentially
        let tested = 0;
        let passed = 0;
        let failed = 0;

        for (const model of models) {
            tested++;
            if (progressEl) {
                progressEl.textContent = `Testing ${tested}/${models.length}...`;
            }

            const result = await testSingleModel(model.id);

            healthTestResults[model.id] = {
                status: result.success ? 'success' : 'error',
                error: result.error,
                latencyMs: result.latencyMs,
                response: result.response
            };

            if (result.success) passed++;
            else failed++;

            // Re-render after each test for real-time updates
            renderHealthModelList(models, healthTestResults);
        }

        // Update last test time
        const lastTestEl = document.getElementById('health-last-test');
        if (lastTestEl) {
            lastTestEl.textContent = new Date().toLocaleTimeString();
        }

        if (progressEl) {
            progressEl.textContent = `✅ ${passed} passed, ❌ ${failed} failed`;
        }

        showToast(`Health check complete: ${passed}/${models.length} models working`,
            failed > 0 ? 'warning' : 'success');

    } catch (error) {
        console.error('[Health] Test failed:', error);
        showToast('Health check failed: ' + error.message, 'error');
    } finally {
        healthTestInProgress = false;
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '🚀 Test All Models';
        }
    }
};

// Render the model list with test results
function renderHealthModelList(models, results) {
    const container = document.getElementById('health-model-list');
    if (!container) return;

    if (models.length === 0) {
        container.innerHTML = `
            <div style="padding: var(--space-4); color: var(--text-muted); text-align: center;">
                <p>No models available. Check gateway connection.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = models.map(model => {
        const result = results[model.id] || { status: 'pending' };

        let statusIcon, statusColor, statusText;
        switch (result.status) {
            case 'success':
                statusIcon = '✅';
                statusColor = 'var(--success)';
                statusText = `${result.latencyMs}ms`;
                break;
            case 'error':
                statusIcon = '❌';
                statusColor = 'var(--error)';
                statusText = result.error || 'Failed';
                break;
            case 'testing':
                statusIcon = '⏳';
                statusColor = 'var(--warning)';
                statusText = 'Testing...';
                break;
            default:
                statusIcon = '⚪';
                statusColor = 'var(--text-muted)';
                statusText = 'Not tested';
        }

        // Extract provider from model ID (e.g., 'anthropic/claude-3-5-sonnet' -> 'anthropic')
        const provider = window.getProviderFromModelId ? window.getProviderFromModelId(model.id) : (model.id.split('/')[0] || 'unknown');
        const modelName = model.id.split('/').slice(1).join('/') || model.id;

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle);">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                    <span style="font-size: 18px;">${statusIcon}</span>
                    <div>
                        <div style="font-weight: 500; color: var(--text-primary);">${modelName}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            <span style="background: var(--surface-3); padding: 1px 6px; border-radius: 3px;">${provider}</span>
                            ${model.displayName ? `<span style="margin-left: 8px;">${model.displayName}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${statusColor}; font-size: 13px; font-weight: 500; margin-bottom: 2px;">${statusText}</div>
                    ${result.status !== 'testing' && !healthTestInProgress ? `
                        <button onclick="testSingleModelUI('${model.id}')" class="btn btn-ghost" style="font-size: 10px; padding: 1px 6px; height: auto;">
                            ${result.status === 'pending' ? 'Test' : 'Re-test'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Test single model from UI button
window.testSingleModelUI = async function (modelId) {
    const models = await loadHealthModels();
    healthTestResults[modelId] = { status: 'testing' };
    renderHealthModelList(models, healthTestResults);

    const result = await testSingleModel(modelId);
    healthTestResults[modelId] = {
        status: result.success ? 'success' : 'error',
        error: result.error,
        latencyMs: result.latencyMs
    };
    renderHealthModelList(models, healthTestResults);

    showToast(result.success ? `${modelId.split('/').pop()} is working!` : `${modelId.split('/').pop()} failed: ${result.error}`,
        result.success ? 'success' : 'error');
};

// Hook into page navigation to init health page
const originalShowPage = window.showPage;
if (typeof originalShowPage === 'function') {
    window.showPage = function (pageName, updateURL = true) {
        originalShowPage(pageName, updateURL);
        if (pageName === 'health') {
            initHealthPage();
        }
        if (pageName === 'chat') {
            forceRefreshHistory();
        }
    };
}



// === chat.js ===
// js/chat.js — Chat event handling, message rendering, voice input, image handling, chat page

const CHAT_DEBUG = false;
function chatLog(...args) { if (CHAT_DEBUG) console.log(...args); }
const CHAT_RUNTIME_MARK = '2026-02-22.3';
if (window.__chatRuntimeMark !== CHAT_RUNTIME_MARK) {
    window.__chatRuntimeMark = CHAT_RUNTIME_MARK;
    console.log(`[Chat] chat.js loaded (${CHAT_RUNTIME_MARK})`);
}
window._chatPendingSends = window._chatPendingSends || new Map();

function getCurrentChatAgentId() {
    return (window.resolveAgentId ? window.resolveAgentId(window.currentAgentId || currentAgentId || 'main') : (window.currentAgentId || currentAgentId || 'main'));
}

function updateChatAgentRail() {
    const agentId = getCurrentChatAgentId();
    const avatar = document.getElementById('chat-agent-rail-avatar');
    const label = document.getElementById('chat-agent-rail-label');
    const subtitle = document.getElementById('chat-agent-rail-subtitle');
    const status = document.getElementById('chat-agent-rail-status');
    const card = document.getElementById('chat-agent-rail-card');
    if (!avatar || !label || !subtitle || !status || !card) return;

    const displayName = getAgentDisplayName(agentId);
    avatar.src = getAvatarUrl(agentId);
    avatar.alt = `${displayName} avatar`;
    label.textContent = displayName;

    const sessionLabel = (typeof getFriendlySessionName === 'function')
        ? getFriendlySessionName(currentSessionName || GATEWAY_CONFIG?.sessionKey || '')
        : (currentSessionName || GATEWAY_CONFIG?.sessionKey || 'main');
    subtitle.textContent = sessionLabel ? `Chatting in ${sessionLabel}` : 'Current chat agent';

    const connected = Boolean(gateway?.isConnected?.());
    status.style.background = connected ? '#22c55e' : '#71717a';
    status.style.boxShadow = connected
        ? '0 0 0 4px rgba(34, 197, 94, 0.14)'
        : '0 0 0 4px rgba(113, 113, 122, 0.14)';
    card.title = `Open ${displayName}'s agent page`;
}

window.openCurrentChatAgentPage = function() {
    const agentId = getCurrentChatAgentId();
    if (window._memoryCards?.openAgentMemory) {
        window._memoryCards.openAgentMemory(agentId, { updateURL: true, forceAgentsPage: true });
        return;
    }
    if (typeof showPage === 'function') {
        showPage('agents', false);
    }
};

function trackPendingSend(runId, payload) {
    if (!runId || !payload) return;
    const map = window._chatPendingSends;
    if (!(map instanceof Map)) return;
    map.set(runId, {
        ...payload,
        retries: Number(payload.retries || 0),
        createdAt: Date.now()
    });
    if (map.size > 100) {
        const oldest = [...map.entries()].sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0)).slice(0, map.size - 100);
        for (const [key] of oldest) map.delete(key);
    }
}

/**
 * Converts plain text to HTML with clickable links.
 * - Escapes HTML to prevent XSS
 * - Converts markdown links [text](url) to <a> tags
 * - Auto-links bare http/https URLs
 * - Preserves newlines as <br>
 * - Skips URLs inside code blocks (``` ... ```)
 */
function linkifyText(text) {
    if (!text) return '';

    // Split on code blocks to avoid linkifying inside them
    const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);

    return parts.map((part, i) => {
        // Odd indices are code blocks — escape only, no linkify
        if (i % 2 === 1) {
            return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // Escape HTML
        let safe = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Convert markdown links [text](url)
        safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // Auto-link bare URLs (not already inside an href)
        safe = safe.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/g,
            '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

        // Preserve newlines
        safe = safe.replace(/\n/g, '<br>');

        return safe;
    }).join('');
}

// ===================
// CHAT FUNCTIONS (Gateway WebSocket)
// ===================

/**
 * Format a model string for display in chat bubbles.
 * - "openrouter/moonshotai/kimi-k2.5"  → "openrouter moonshotai/kimi-k2.5"
 * - "google/gemini-flash-latest"        → "google/gemini-flash-latest"
 * - "anthropic/claude-3-5-sonnet"       → "anthropic/claude-3-5-sonnet"
 * - "moonshotai/kimi-k2.5" (no prefix) → "openrouter moonshotai/kimi-k2.5"
 */
/**
 * Get the best available model for a message, with fallback chain:
 *   msg.model → window._lastResponseModel → window.currentModel
 * Always skip generic gateway placeholders like "openrouter/free" or "unknown".
 */
function getBestModel(msg) {
    const isGeneric = (m) => !m || m === 'unknown' || m === 'openrouter/free' || m === 'free';
    if (!isGeneric(msg?.model)) return { model: msg.model, provider: msg.provider };
    if (!isGeneric(window._lastResponseModel)) return { model: window._lastResponseModel, provider: window._lastResponseProvider };
    return { model: window.currentModel, provider: window.currentProvider };
}

/**
 * Format a model + provider for display in chat bubbles.
 * - provider "openrouter" + model "moonshotai/kimi-k2.5" → "openrouter moonshotai/kimi-k2.5"
 * - model "openrouter/moonshotai/kimi-k2.5"              → "openrouter moonshotai/kimi-k2.5"
 * - provider "google" + model "gemini-flash-latest"       → "google/gemini-flash-latest"
 */
function formatModelDisplay(model, provider) {
    if (!model) return '';
    // Already has openrouter prefix — replace slash with space
    if (model.startsWith('openrouter/')) {
        return model.replace('openrouter/', 'openrouter ');
    }
    // Provider is openrouter but model lacks prefix
    if (provider === 'openrouter') {
        return 'openrouter ' + model;
    }
    // Has any provider prefix already
    if (model.includes('/')) return model;
    // No prefix — prepend provider if known
    if (provider) return `${provider}/${model}`;
    return model;
}

// ===================
// VOICE INPUT (Web Speech API)
// ===================

let voiceRecognition = null;
let voiceInputState = 'idle'; // idle, listening, processing
let voiceAutoSend = localStorage.getItem('voice_auto_send') === 'true'; // Auto-send after speech
let lastVoiceTranscript = ''; // Store last transcript for auto-send
let accumulatedTranscript = ''; // Store accumulated text across pause/resume cycles

// Live transcript indicator functions (disabled - transcript shows directly in input field)
function showLiveTranscriptIndicator() { }
function hideLiveTranscriptIndicator() { }
function updateLiveTranscriptIndicator(text, isInterim) { }

function initVoiceInput() {
    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    // Update both voice buttons
    const btns = [
        document.getElementById('voice-input-btn'),
        document.getElementById('voice-input-btn-chatpage')
    ];

    if (!SpeechRecognition) {
        for (const btn of btns) {
            if (btn) {
                btn.disabled = true;
                btn.title = 'Voice input not supported in this browser';
                btn.innerHTML = '<span class="voice-unsupported">🎤✗</span>';
            }
        }
        chatLog('[Voice] Web Speech API not supported');
        return;
    }

    if (btns.every(b => !b)) return;

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true; // Keep listening until manually stopped
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
        chatLog('[Voice] Started listening, target input:', activeVoiceTarget);
        // Don't reset transcript - keep accumulated text for pause/resume
        setVoiceState('listening');

        // Show live transcript indicator
        showLiveTranscriptIndicator();

        // Focus the target input
        const input = document.getElementById(activeVoiceTarget);
        if (input) {
            input.focus();
            input.placeholder = 'Listening... (speak now)';
            // Keep existing accumulated text in the field
            if (accumulatedTranscript) {
                input.value = accumulatedTranscript;
            }
        }
    };

    voiceRecognition.onaudiostart = () => {
        chatLog('[Voice] Audio capture started - microphone is working');
    };

    voiceRecognition.onsoundstart = () => {
        chatLog('[Voice] Sound detected');
    };

    voiceRecognition.onspeechstart = () => {
        chatLog('[Voice] Speech detected - processing...');
        const input = document.getElementById(activeVoiceTarget);
        if (input) {
            input.placeholder = 'Hearing you...';
        }
    };

    voiceRecognition.onresult = (event) => {
        chatLog('[Voice] onresult fired, resultIndex:', event.resultIndex, 'results.length:', event.results.length, 'target:', activeVoiceTarget);
        const input = document.getElementById(activeVoiceTarget);
        if (!input) {
            console.error('[Voice] Input not found:', activeVoiceTarget, '- trying fallback');
            // Fallback: try both inputs
            const fallback = document.getElementById('chat-page-input') || document.getElementById('chat-input');
            if (!fallback) {
                console.error('[Voice] No input found at all!');
                return;
            }
            chatLog('[Voice] Using fallback input:', fallback.id);
        }
        const targetInput = input || document.getElementById('chat-page-input') || document.getElementById('chat-input');
        chatLog('[Voice] Updating input element:', targetInput?.id, targetInput?.tagName);

        let interimTranscript = '';
        let finalTranscript = '';

        // Process all results
        for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            const confidence = result[0].confidence;
            chatLog(`[Voice] Result[${i}]: isFinal=${result.isFinal}, confidence=${confidence?.toFixed(2) || 'n/a'}, text="${transcript}"`);
            if (result.isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Append new transcripts to accumulated text
        if (finalTranscript) {
            // Add space before appending if there's already accumulated text
            if (accumulatedTranscript && !accumulatedTranscript.endsWith(' ')) {
                accumulatedTranscript += ' ';
            }
            accumulatedTranscript += finalTranscript;
        }

        // Display accumulated + interim
        const displayText = accumulatedTranscript + interimTranscript;
        chatLog('[Voice] Display text:', displayText, '(accumulated:', accumulatedTranscript.length, 'interim:', interimTranscript.length, ')');

        // Update live transcript indicator (banner)
        updateLiveTranscriptIndicator(displayText, !!interimTranscript);

        // Always update the input with current text (even if empty during pauses)
        chatLog('[Voice] Setting targetInput.value to:', displayText);
        targetInput.value = displayText;

        // Style based on whether we have final or interim
        if (interimTranscript) {
            // Has interim - show as in-progress with subtle indicator
            targetInput.style.fontStyle = 'italic';
            targetInput.style.color = 'var(--text-secondary)';
        } else if (finalTranscript) {
            // Only final content - solid style
            targetInput.style.fontStyle = 'normal';
            targetInput.style.color = 'var(--text-primary)';
        }

        // Trigger input event to handle auto-resize and any listeners
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Keep input focused and cursor at end
        targetInput.focus();
        if (targetInput.setSelectionRange) {
            targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length);
        }

        // Store final transcript for auto-send
        if (finalTranscript) {
            lastVoiceTranscript = finalTranscript;
            chatLog('[Voice] Final transcript stored:', finalTranscript);
        }
    };

    voiceRecognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error, event.message || '');

        if (event.error === 'not-allowed') {
            setVoiceState('idle');
            showToast('Microphone access denied. Click the lock icon in your browser address bar to allow.', 'error');
        } else if (event.error === 'no-speech') {
            // Don't stop on no-speech if continuous mode - just keep listening
            chatLog('[Voice] No speech detected yet, still listening...');
            // Only show toast if we're ending
            if (!voiceRecognition || voiceInputState !== 'listening') {
                showToast('No speech detected. Make sure your microphone is working.', 'info');
            }
        } else if (event.error === 'audio-capture') {
            setVoiceState('idle');
            showToast('No microphone found. Please connect a microphone and try again.', 'error');
        } else if (event.error === 'network') {
            setVoiceState('idle');
            showToast('Network error. Speech recognition requires internet connection.', 'error');
        } else if (event.error !== 'aborted') {
            setVoiceState('idle');
            showToast(`Voice error: ${event.error}`, 'error');
        }
    };

    voiceRecognition.onend = () => {
        chatLog('[Voice] Ended, accumulated transcript:', accumulatedTranscript);
        // Note: hideLiveTranscriptIndicator is called by setVoiceState('idle') below

        // Reset styling on both inputs
        for (const inputId of ['chat-input', 'chat-page-input']) {
            const input = document.getElementById(inputId);
            if (input) {
                input.style.fontStyle = 'normal';
                input.style.color = 'var(--text-primary)';
                // Reset placeholder
                if (inputId === 'chat-input') {
                    input.placeholder = 'Type a message...';
                } else {
                    input.placeholder = 'Message SoLoBot...';
                }
            }
        }

        // Auto-send if enabled and we have a transcript
        if (voiceAutoSend && accumulatedTranscript.trim()) {
            chatLog('[Voice] Auto-sending:', accumulatedTranscript);
            // Determine which send function to use based on target
            if (activeVoiceTarget === 'chat-page-input') {
                sendChatPageMessage();
            } else {
                sendChatMessage();
            }
            // Clear accumulated text after auto-send
            accumulatedTranscript = '';
            const input = document.getElementById(activeVoiceTarget);
            if (input) input.value = '';
        }

        setVoiceState('idle');
        activeVoiceTarget = 'chat-input'; // Reset target
    };

    chatLog('[Voice] Initialized successfully');
}

function toggleVoiceInput() {
    if (!voiceRecognition) {
        showToast('Voice input not available', 'error');
        return;
    }

    if (voiceInputState === 'listening') {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
}

function startVoiceInput() {
    if (!voiceRecognition) return;

    try {
        voiceRecognition.start();
        chatLog('[Voice] Starting...');
    } catch (e) {
        console.error('[Voice] Start error:', e);
        // May already be running
        if (e.message.includes('already started')) {
            stopVoiceInput();
        }
    }
}

function stopVoiceInput() {
    if (!voiceRecognition) return;

    try {
        voiceRecognition.stop();
        chatLog('[Voice] Stopping...');
    } catch (e) {
        console.error('[Voice] Stop error:', e);
    }
}

function setVoiceState(state, targetInput = 'chat-input') {
    voiceInputState = state;

    // Hide live transcript indicator when going idle
    if (state === 'idle') {
        hideLiveTranscriptIndicator();
    }

    // Update both buttons to stay in sync
    const btns = [
        { btn: document.getElementById('voice-input-btn'), mic: document.getElementById('voice-icon-mic'), stop: document.getElementById('voice-icon-stop') },
        { btn: document.getElementById('voice-input-btn-chatpage'), mic: document.getElementById('voice-icon-mic-chatpage'), stop: document.getElementById('voice-icon-stop-chatpage') }
    ];

    for (const { btn, mic, stop } of btns) {
        if (!btn) continue;

        btn.classList.remove('listening', 'processing');

        switch (state) {
            case 'listening':
                btn.classList.add('listening');
                btn.title = 'Listening... (click to stop)';
                if (mic) mic.style.display = 'none';
                if (stop) stop.style.display = 'block';
                break;
            case 'processing':
                btn.classList.add('processing');
                btn.title = 'Processing...';
                break;
            default: // idle
                btn.title = 'Voice input (click to speak)';
                if (mic) mic.style.display = 'block';
                if (stop) stop.style.display = 'none';
                break;
        }
    }
}

// Active voice target tracks which input field is receiving voice
let activeVoiceTarget = 'chat-input';

function toggleVoiceInputChatPage() {
    // Set target before calling the main function
    activeVoiceTarget = 'chat-page-input';
    toggleVoiceInput();
}

// Toggle auto-send setting
function toggleVoiceAutoSend() {
    voiceAutoSend = !voiceAutoSend;
    localStorage.setItem('voice_auto_send', voiceAutoSend);
    updateVoiceAutoSendUI();
    showToast(voiceAutoSend ? 'Voice auto-send enabled' : 'Voice auto-send disabled', 'info');
}

function updateVoiceAutoSendUI() {
    const toggles = document.querySelectorAll('.voice-auto-send-toggle');
    toggles.forEach(toggle => {
        toggle.classList.toggle('active', voiceAutoSend);
        toggle.title = voiceAutoSend ? 'Auto-send ON (click to disable)' : 'Auto-send OFF (click to enable)';
    });
}

// Alt+Space toggle: Press once to start, press again to stop
function initPushToTalk() {
    document.addEventListener('keydown', (e) => {
        // Toggle on Alt+Space (works even in input fields)
        if (e.code === 'Space' && e.altKey) {
            e.preventDefault();

            if (voiceInputState === 'listening') {
                // Already listening - stop
                chatLog('[Voice] Alt+Space toggle: stopping');
                stopVoiceInput();
            } else {
                // Not listening - start
                // Determine which input to target based on current page
                const chatPageVisible = document.getElementById('page-chat')?.classList.contains('active');
                activeVoiceTarget = chatPageVisible ? 'chat-page-input' : 'chat-input';

                chatLog('[Voice] Alt+Space toggle: starting, target:', activeVoiceTarget);
                startVoiceInput();
            }
        }
    });

    chatLog('[Voice] Alt+Space toggle initialized (press to start/stop recording)');
}

// Check if user is typing in an input field
function isTypingInInput(element) {
    if (!element) return false;
    const tagName = element.tagName.toLowerCase();
    const isEditable = element.isContentEditable;
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    return isInput || isEditable;
}

// ===================
// IMAGE HANDLING
// ===================

// Image handling - supports multiple images
let pendingImages = [];

function getImageDataUri(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.data === 'string') return value.data;
    return '';
}

function isValidImageDataUri(value) {
    const dataUri = getImageDataUri(value);
    if (!dataUri) return false;
    const match = dataUri.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([\s\S]*)$/);
    if (!match) return false;
    return match[1].trim().length > 0;
}

function sanitizeImageAttachments(items, sourceLabel = 'chat') {
    const source = Array.isArray(items) ? items : [];
    const valid = [];
    let dropped = 0;
    for (const item of source) {
        if (isValidImageDataUri(item)) {
            valid.push(item);
        } else {
            dropped += 1;
        }
    }
    if (dropped > 0) {
        chatLog(`[Chat] Skipped ${dropped} invalid image attachment(s) (${sourceLabel})`);
    }
    return { valid, dropped };
}

function handleImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            processImageFile(file);
        }
    }
}

function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) processImageFile(file);
            return;
        }
    }
}

let chatInputSelection = { start: 0, end: 0 };
let _chatSendInFlight = false;
let _lastChatSendSignature = '';
let _lastChatSendAt = 0;

function buildChatSendSignature(text, images) {
    const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
    const sessionKey = String(currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    const imageList = Array.isArray(images) ? images : [];
    const imageSig = imageList.map((img) => {
        const data = typeof img === 'string' ? img : img?.data;
        if (typeof data !== 'string') return '0:';
        return `${data.length}:${data.slice(-16)}`;
    }).join('|');
    return `${sessionKey}|${normalizedText}|${imageList.length}|${imageSig}`;
}

function shouldSuppressDuplicateSend(signature) {
    const now = Date.now();
    if (signature !== _lastChatSendSignature) return false;

    // Immediate double-click / enter+click duplicate
    if (now - _lastChatSendAt < 1200) return true;
    // Same payload while previous send is still in-flight
    if (_chatSendInFlight && now - _lastChatSendAt < 10000) return true;
    return false;
}

function markChatSendStart(signature) {
    _chatSendInFlight = true;
    _lastChatSendSignature = signature;
    _lastChatSendAt = Date.now();
}

function markChatSendEnd() {
    _chatSendInFlight = false;
}

function handleChatInputKeydown(event) {
    const input = event.target;
    if (event.key !== 'Enter' || !input) return;

    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        sendChatMessage();
        return;
    }

    if (event.shiftKey) {
        event.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const value = input.value;
        const before = value.slice(0, start);
        const after = value.slice(end);
        const newValue = `${before}\n${after}`;
        input.value = newValue;
        const cursor = start + 1;
        input.setSelectionRange(cursor, cursor);
        adjustChatInputHeight(input);
        return;
    }
}

function cacheChatInputSelection(input) {
    if (!input) return;
    chatInputSelection.start = input.selectionStart;
    chatInputSelection.end = input.selectionEnd;
}

function restoreChatInputSelection(input) {
    if (!input) return;
    const length = input.value.length;
    const start = Math.min(chatInputSelection.start ?? length, length);
    const end = Math.min(chatInputSelection.end ?? length, length);
    input.setSelectionRange(start, end);
}

function adjustChatInputHeight(input) {
    if (!input) return;
    input.style.height = 'auto';
    const height = Math.min(input.scrollHeight, 160);
    input.style.height = `${Math.max(height, 36)}px`;
}

function attachChatInputHandlers() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.addEventListener('keydown', handleChatInputKeydown);
    input.addEventListener('blur', () => cacheChatInputSelection(input));
    input.addEventListener('focus', () => {
        restoreChatInputSelection(input);
        adjustChatInputHeight(input);
    });
    input.addEventListener('input', () => adjustChatInputHeight(input));
    adjustChatInputHeight(input);
}

// Compress image to reduce size for WebSocket transmission
async function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // Scale down if too large
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to JPEG for better compression (unless PNG transparency needed)
            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
        };
        img.src = dataUrl;
    });
}

function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Compress image if larger than 200KB
        let imageData = e.target.result;
        if (!isValidImageDataUri(imageData)) {
            showToast('Invalid image data. Please select the file again.', 'warning');
            return;
        }
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
        }
        if (!isValidImageDataUri(imageData)) {
            showToast('Image processing failed. Please try another image.', 'warning');
            return;
        }

        pendingImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        });
        renderImagePreviews();
    };
    reader.readAsDataURL(file);
}

function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');
    if (!container) return;

    if (pendingImages.length === 0) {
        container.classList.remove('visible');
        container.innerHTML = '';
        return;
    }

    container.classList.add('visible');
    container.innerHTML = pendingImages.map((img, idx) => `
        <div class="image-preview-wrapper">
            <img src="${img.data}" alt="Preview ${idx + 1}" />
            <button onclick="removeImagePreview('${img.id}')" class="image-preview-close">✕</button>
        </div>
    `).join('');
}

function removeImagePreview(imgId) {
    pendingImages = pendingImages.filter(img => img.id !== imgId);
    renderImagePreviews();
    if (pendingImages.length === 0) {
        const input = document.getElementById('image-upload');
        if (input) input.value = '';
    }
}

function clearImagePreviews() {
    pendingImages = [];
    renderImagePreviews();
    const input = document.getElementById('image-upload');
    if (input) input.value = '';
}

async function sendChatMessage() {
    // Stop voice recording if active
    if (voiceInputState === 'listening') {
        chatLog('[Voice] Stopping recording before send');
        stopVoiceInput();
    }

    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;

    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to Gateway. Please connect first.', 'warning');
        return;
    }

    // Get images to send
    const rawImagesToSend = [...pendingImages];
    const { valid: imagesToSend, dropped: droppedImages } = sanitizeImageAttachments(rawImagesToSend, 'chat-input');
    if (droppedImages > 0) {
        showToast(`Skipped ${droppedImages} invalid image attachment${droppedImages > 1 ? 's' : ''}.`, 'warning');
    }
    const imageDataArray = imagesToSend.map(img => getImageDataUri(img)).filter(Boolean);
    const hasImages = imageDataArray.length > 0;
    if (!text && !hasImages) {
        clearImagePreviews();
        addLocalChatMessage('Failed to send: selected image is empty or invalid.', 'system');
        renderChat();
        renderChatPage();
        return;
    }
    const sendSignature = buildChatSendSignature(text, imageDataArray);
    if (shouldSuppressDuplicateSend(sendSignature)) {
        chatLog('[Chat] Suppressed duplicate send (chat-input)');
        return;
    }
    markChatSendStart(sendSignature);

    // Add to local display
    if (hasImages) {
        // Show all images in local preview
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        addLocalChatMessage(displayText, 'user', imageDataArray);
    } else {
        addLocalChatMessage(text, 'user');
    }

    input.value = '';
    accumulatedTranscript = ''; // Clear voice accumulated text
    clearImagePreviews();
    adjustChatInputHeight(input);
    chatInputSelection = { start: 0, end: 0 };

    // Show typing indicator immediately
    isProcessing = true;
    renderChat();
    renderChatPage();

    // Send via Gateway WebSocket
    try {
        chatLog(`[Chat] Sending message with model: ${currentModel}`);
        let result = null;
        if (hasImages) {
            // Send with image attachments (send all images)
            result = await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            result = await gateway.sendMessage(text);
        }

        if (result?.runId) {
            trackPendingSend(result.runId, {
                sessionKey: currentSessionName || GATEWAY_CONFIG?.sessionKey || '',
                text: hasImages ? (text || 'Image') : text,
                images: hasImages ? imageDataArray : []
            });
        }
    } catch (err) {
        console.error('Failed to send message:', err);
        addLocalChatMessage(`Failed to send: ${err.message}`, 'system');
    } finally {
        markChatSendEnd();
    }
}

function addLocalChatMessage(text, from, imageOrModel = null, model = null, provider = null, meta = null) {
    // DEFENSIVE: Hard session gate - validate incoming messages match current session
    // Check if this message already has a session tag from outside
    const incomingSession = (meta?._sessionKey || imageOrModel?._sessionKey || '').toLowerCase();
    const currentSession = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();

    if (incomingSession && currentSession && incomingSession !== currentSession) {
        chatLog(`[Chat] BLOCKED addLocalChatMessage: incoming session=${incomingSession}, current=${currentSession}`);
        return null;
    }

    if (!state.chat) state.chat = { messages: [] };
    if (!state.system) state.system = { messages: [] };

    // Handle multiple parameter signatures:
    // (text, from)
    // (text, from, image) - single image data URI
    // (text, from, images) - array of image data URIs
    // (text, from, model) - model name string
    // (text, from, image, model)
    let images = [];
    let messageModel = model;

    if (imageOrModel) {
        if (Array.isArray(imageOrModel)) {
            // Array of images
            images = imageOrModel.filter(img => img && typeof img === 'string' && img.includes('data:'));
        } else if (typeof imageOrModel === 'string') {
            if (imageOrModel.includes('data:image') || imageOrModel.includes('data:application')) {
                // Single image data URI
                images = [imageOrModel];
            } else if (imageOrModel.includes('/') || imageOrModel.includes('claude') || imageOrModel.includes('gpt') || imageOrModel.includes('MiniMax')) {
                // Model name
                messageModel = imageOrModel;
            }
        }
    }

    chatLog(`[Chat] addLocalChatMessage: text="${text?.slice(0, 50)}", from=${from}, images=${images.length}, model=${messageModel}`);

    const message = {
        id: 'm' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        from,
        text,
        time: Date.now(),
        image: images[0] || null, // Legacy single image field
        images: images, // New array field
        model: messageModel, // Store which AI model generated this response
        provider: provider, // Store which provider (e.g., 'google', 'anthropic')
        _sessionKey: meta?._sessionKey || window.currentSessionName || GATEWAY_CONFIG?.sessionKey || '', // Tag with session to prevent cross-session bleed
        _agentId: meta?._agentId || window.currentAgentId || 'main', // attribution owner
        _sourceSession: meta?._sourceSession || null,
        _sourceAgent: meta?._sourceAgent || null,
        _sourceAgentName: meta?._sourceAgentName || null,
        _isInterSession: !!(meta?._isInterSession)
    };

    const isSystem = isSystemMessage(text, from) || !!(message._isInterSession || message._sourceSession || message._sourceAgent);

    // Route to appropriate message array
    if (isSystem) {
        // System message - goes to system tab (local UI noise)
        state.system.messages.push(message);
        if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }
        persistSystemMessages(); // Persist system messages locally
        renderSystemPage();
    } else {
        // Real chat message - goes to chat tab (synced via Gateway)
        state.chat.messages.push(message);
        if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Notify chat page of new message (for indicator when scrolled up)
        if (from !== 'user' && typeof notifyChatPageNewMessage === 'function') {
            notifyChatPageNewMessage();
        }

        // Persist chat to localStorage (workaround for Gateway bug #5735)
        persistChatMessages();

        // Also sync chat to VPS for cross-computer access
        syncChatToVPS();

        renderChat();
        renderChatPage();
    }

    return message;
}

// Debounced sync of chat messages to VPS (so messages persist across computers)
// Note: reuses chatSyncTimeout declared above
function syncChatToVPS() {
    // Debounce - wait 2 seconds after last message before syncing
    if (chatSyncTimeout) clearTimeout(chatSyncTimeout);
    chatSyncTimeout = setTimeout(async () => {
        try {
            const sessionKey = normalizeSessionKey(currentSessionName || GATEWAY_CONFIG?.sessionKey || 'agent:main:main');
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: state.chat.messages.slice(-100),
                    sessionKey
                })
            });
        } catch (e) {
            // Chat sync failed - not critical
        }
    }, 2000);
}

// ===================
// CHAT RENDERING (Clean rewrite)
// ===================

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) {
        return;
    }
    // Removed verbose log: renderChat called frequently

    const messages = getMainChatRenderableMessages(state.chat?.messages || []);
    const isConnected = gateway?.isConnected();

    // Save scroll state BEFORE clearing
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 5;
    const previousScrollTop = container.scrollTop;

    // Clear container
    container.innerHTML = '';

    // Show placeholder if no messages
    if (messages.length === 0 && !streamingText) {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-8) 0;';
        placeholder.textContent = isConnected
            ? '💬 Connected! Send a message to start chatting.'
            : '🔌 Connect to Gateway in Settings to start chatting';
        container.appendChild(placeholder);
        return;
    }

    // Render each message (filtered by session to prevent bleed)
    const activeKey = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    messages.forEach(msg => {
        // Defensive: Skip messages from other sessions
        const msgSession = (msg._sessionKey || '').toLowerCase();
        if (!msgSession || !activeKey || msgSession !== activeKey) {
            chatLog(`[Chat] RENDER BLOCKED: msg session=${msgSession}, current=${activeKey}`);
            return;
        }
        const msgEl = createChatMessageElement(msg);
        if (msgEl) container.appendChild(msgEl);
    });

    // Render streaming message ONLY if it belongs to the current session
    const streamingActiveKey = (currentSessionName || '').toLowerCase();
    if (streamingText && _streamingSessionKey && _streamingSessionKey.toLowerCase() === streamingActiveKey) {
        const streamingMsg = createChatMessageElement({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true,
            model: window._lastResponseModel || window.currentModel
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }

    // Compact live status indicator (same footprint as Thinking...)
    const _presenceState = (window.AgentPresence && typeof window.AgentPresence.getSessionState === 'function')
        ? window.AgentPresence.getSessionState(currentSessionName || '')
        : null;
    const _presenceLabel = (window.AgentPresence && typeof window.AgentPresence.getSessionLabel === 'function')
        ? window.AgentPresence.getSessionLabel(currentSessionName || '')
        : 'Thinking...';
    const _showCompactStatus = !streamingText && (
        isProcessing || (_presenceState && ['running', 'waiting_tool', 'waiting_user', 'stalled', 'error', 'done'].includes(_presenceState.state))
    );
    if (_showCompactStatus) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">${_presenceLabel}</span>
        `;
        container.appendChild(typingIndicator);
    }

    // Auto-scroll only if user was at bottom; otherwise preserve exact reading position
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = previousScrollTop;
    }
}

function shouldHideFromMainChat(msg) {
    if (!msg) return false;
    if (msg._isInterSession || msg._sourceSession || msg._sourceAgent) return true;
    if (typeof isSystemMessage === 'function' && isSystemMessage(msg.text, msg.from)) return true;
    return false;
}

function getMainChatRenderableMessages(messages) {
    return (messages || []).filter(msg => !shouldHideFromMainChat(msg));
}

function createChatMessageElement(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;

    const isInterSession = !!(msg._isInterSession || msg._sourceSession || msg._sourceAgent);
    const isUser = msg.from === 'user' && !isInterSession;
    const isSystem = msg.from === 'system';

    // Create message container
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = 'var(--space-3)';

    // Create message bubble
    const bubble = document.createElement('div');
    bubble.style.padding = 'var(--space-3)';
    bubble.style.borderRadius = 'var(--radius-md)';
    bubble.style.maxWidth = '85%';
    bubble.style.wordWrap = 'break-word';

    if (isUser) {
        // User message - right aligned, brand red tint
        bubble.style.backgroundColor = 'rgba(188, 32, 38, 0.15)';
        bubble.style.border = '1px solid rgba(188, 32, 38, 0.25)';
        bubble.style.marginLeft = 'auto';
        bubble.style.textAlign = 'right';
    } else if (isSystem) {
        // System message - warning tint
        bubble.style.backgroundColor = 'var(--warning-muted)';
        bubble.style.border = '1px solid rgba(234, 179, 8, 0.2)';
    } else {
        // Bot message - left aligned, surface-2
        bubble.style.backgroundColor = msg.isStreaming ? 'var(--surface-2)' : 'var(--surface-2)';
        bubble.style.border = '1px solid var(--border-default)';
        bubble.style.marginRight = 'auto';
        if (msg.isStreaming) bubble.style.opacity = '0.8';
    }

    // Header with name and time
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = 'var(--space-2)';
    header.style.marginBottom = 'var(--space-2)';
    header.style.fontSize = '12px';
    if (isUser) header.style.justifyContent = 'flex-end';

    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '500';
    if (isUser) {
        nameSpan.style.color = 'var(--brand-red)';
        nameSpan.textContent = 'You';
    } else if (isSystem) {
        nameSpan.style.color = 'var(--warning)';
        nameSpan.textContent = 'System';
    } else {
        nameSpan.style.color = 'var(--success)';
        // Fix #3b: Use the agent stored on the message, not the current global agent
        const displayName = getAgentDisplayName(msg._agentId || currentAgentId);
        nameSpan.textContent = msg.isStreaming ? `${displayName} (typing...)` : displayName;
    }

    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = 'color: var(--text-muted); font-size: 12px;';
    timeSpan.textContent = formatTime(msg.time);
    header.appendChild(timeSpan);

    header.appendChild(nameSpan);

    // Model badge for bot messages - same style as time
    if (!isUser && !isSystem) {
        const { model: bestModel, provider: bestProvider } = getBestModel(msg);
        if (bestModel) {
            const modelBadge = document.createElement('span');
            modelBadge.style.cssText = 'color: var(--text-muted); font-size: 12px; margin-left: 4px;';
            const displayModel = formatModelDisplay(bestModel, bestProvider);
            modelBadge.textContent = msg.isStreaming ? `· **${displayModel}**` : `· ${displayModel}`;
            modelBadge.title = bestModel;
            header.appendChild(modelBadge);
        }
    }

    if (isInterSession && !isSystem) {
        const badge = document.createElement('div');
        badge.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-bottom: var(--space-2);';
        const fromName = msg._sourceAgentName || getAgentDisplayName(msg._agentId || currentAgentId);
        badge.textContent = `Inter-session • from ${fromName}`;
        bubble.appendChild(badge);
    }

    // Message content
    const content = document.createElement('div');
    content.style.fontSize = '14px';
    content.style.color = 'var(--text-primary)';
    content.style.lineHeight = '1.5';
    content.style.whiteSpace = 'pre-wrap';
    content.innerHTML = linkifyText(msg.text); // linkifyText escapes HTML first, then adds <a> tags

    // Images if present - show thumbnails
    const images = msg.images || (msg.image ? [msg.image] : []);
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '8px';
        imageContainer.style.marginBottom = 'var(--space-2)';

        images.forEach((imgSrc, idx) => {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.style.maxWidth = images.length > 1 ? '100px' : '150px';
            img.style.maxHeight = images.length > 1 ? '80px' : '100px';
            img.style.borderRadius = 'var(--radius-md)';
            img.style.cursor = 'pointer';
            img.style.objectFit = 'cover';
            img.style.border = '1px solid var(--border-default)';
            img.title = `Image ${idx + 1} of ${images.length} - Click to view`;
            img.onclick = () => openImageModal(imgSrc);
            imageContainer.appendChild(img);
        });

        bubble.appendChild(imageContainer);
    }

    bubble.appendChild(header);
    bubble.appendChild(content);
    wrapper.appendChild(bubble);

    return wrapper;
}

function openImageModal(src) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:1000;cursor:pointer;padding:40px;';
    modal.onclick = () => modal.remove();

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:20px;right:30px;color:white;font-size:28px;cursor:pointer;opacity:0.7;transition:opacity 0.2s;';
    closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.7';
    modal.appendChild(closeBtn);

    // Image container for shadow effect
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'max-width:85vw;max-height:85vh;box-shadow:0 25px 50px rgba(0,0,0,0.5);border-radius:8px;overflow:hidden;';

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'display:block;max-width:85vw;max-height:85vh;object-fit:contain;';
    img.onclick = (e) => e.stopPropagation(); // Don't close when clicking image

    imgContainer.appendChild(img);
    modal.appendChild(imgContainer);

    // Click hint
    const hint = document.createElement('div');
    hint.textContent = 'Click anywhere to close';
    hint.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.5);font-size:12px;';
    modal.appendChild(hint);

    document.body.appendChild(modal);
}



// ===================
// CHAT PAGE FUNCTIONS
// ===================

// Chat page state
let chatPagePendingImages = [];
let chatPageScrollPosition = null;
let chatPageUserScrolled = false;
let chatPageNewMessageCount = 0;
let chatPageLastRenderKey = null;
let suppressChatRenderUntil = 0;

// Suppress chat re-renders briefly on right-click to preserve text selection
document.addEventListener('contextmenu', (e) => {
    const container = document.getElementById('chat-page-messages');
    if (container && container.contains(e.target)) {
        suppressChatRenderUntil = Date.now() + 1500;
    }
});

// Save scroll position to sessionStorage
function saveChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (container && container.scrollTop > 0) {
        sessionStorage.setItem('chatScrollPosition', container.scrollTop);
        sessionStorage.setItem('chatScrollHeight', container.scrollHeight);
    }
}

// Restore scroll position from sessionStorage
function restoreChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (!container) return;

    const savedPosition = sessionStorage.getItem('chatScrollPosition');
    const savedHeight = sessionStorage.getItem('chatScrollHeight');

    if (savedPosition && savedHeight) {
        // Calculate relative position and apply
        const ratio = parseFloat(savedPosition) / parseFloat(savedHeight);
        container.scrollTop = ratio * container.scrollHeight;
    }
}

// Expose scroll functions globally for page navigation
window.saveChatScrollPosition = saveChatScrollPosition;
window.restoreChatScrollPosition = restoreChatScrollPosition;

// Check if user is at the very bottom (strict check for auto-scroll)
function isAtBottom(container) {
    if (!container) return true;
    // Only consider "at bottom" if within 5px - user must be truly at the bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < 5;
}

// Check if user is near the bottom (looser check for indicator hiding)
function isNearBottom(container) {
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// Scroll to bottom
function scrollChatToBottom() {
    const container = document.getElementById('chat-page-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
        chatPageUserScrolled = false;
        chatPageNewMessageCount = 0;
        updateNewMessageIndicator();
    }
}

// Update new message indicator visibility
function updateNewMessageIndicator() {
    const indicator = document.getElementById('chat-page-new-indicator');
    if (!indicator) return;

    const container = document.getElementById('chat-page-messages');
    const notAtBottom = container && !isAtBottom(container);

    if (notAtBottom && chatPageNewMessageCount > 0) {
        indicator.textContent = `↓ ${chatPageNewMessageCount} new message${chatPageNewMessageCount > 1 ? 's' : ''}`;
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
        if (!notAtBottom) {
            chatPageNewMessageCount = 0; // Reset count when at bottom
        }
    }
}

// Setup scroll listener for chat page
function setupChatPageScrollListener() {
    const container = document.getElementById('chat-page-messages');
    if (!container || container.dataset.scrollListenerAttached) return;

    container.addEventListener('scroll', () => {
        // Update indicator based on scroll position
        updateNewMessageIndicator();

        // Show/hide floating scroll button
        updateScrollToBottomButton();

        // Save position periodically
        saveChatScrollPosition();
    });

    container.dataset.scrollListenerAttached = 'true';
}

function updateScrollToBottomButton() {
    const container = document.getElementById('chat-page-messages');
    const btn = document.getElementById('scroll-to-bottom-btn');
    if (!container || !btn) return;

    // Show button if scrolled up more than 200px from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 200) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function forceRefreshHistory() {
    // Route through guarded function to prevent spam
    _doHistoryRefresh();
}

function renderChatPage() {
    const container = document.getElementById('chat-page-messages');
    updateChatAgentRail();
    if (!container) {
        return;
    }
    // Removed verbose log: renderChatPage called frequently

    // Setup scroll listener
    setupChatPageScrollListener();

    // Update connection status
    const statusDot = document.getElementById('chat-page-status-dot');
    const statusText = document.getElementById('chat-page-status-text');
    const isConnected = gateway?.isConnected();

    if (statusDot) {
        statusDot.className = `status-dot ${isConnected ? 'success' : 'idle'}`;
    }
    if (statusText) {
        statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
    }

    const messages = getMainChatRenderableMessages(state.chat?.messages || []);

    // Avoid clearing selection: if user is selecting text in chat, skip re-render
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;
    const selectionInChat = hasSelection && (
        (selection.anchorNode && container.contains(selection.anchorNode)) ||
        (selection.focusNode && container.contains(selection.focusNode))
    );
    if (selectionInChat) {
        return;
    }

    // Suppress render briefly after right-click
    if (Date.now() < suppressChatRenderUntil) {
        return;
    }

    // Skip re-render if nothing changed (prevents text selection from collapsing)
    const lastMsg = messages[messages.length - 1];
    const renderKey = [
        messages.length,
        lastMsg?.id || '',
        lastMsg?.time || '',
        streamingText || '',
        isProcessing ? 1 : 0
    ].join('|');

    if (renderKey === chatPageLastRenderKey) {
        return;
    }
    chatPageLastRenderKey = renderKey;

    // Check if at bottom BEFORE clearing (use strict check to avoid unwanted scrolling)
    const wasAtBottom = isAtBottom(container);
    // Preserve the exact reading position when user has scrolled up
    const previousScrollTop = container.scrollTop;

    // === Incremental rendering — only touch DOM for changes ===

    // Show empty state if no messages
    if (messages.length === 0 && !streamingText) {
        const displayName = getAgentDisplayName(currentAgentId);
        container.innerHTML = `
            <div class="chat-page-empty">
                <div class="chat-page-empty-icon">💬</div>
                <div class="chat-page-empty-text">
                    ${isConnected
                ? `Start a conversation with ${displayName}`
                : 'Connect to Gateway in <a href="#" onclick="openSettingsModal(); return false;">Settings</a> to start chatting'}
                </div>
            </div>
        `;
        container._renderedCount = 0;
        return;
    }

    // Remove empty state if it was showing
    const emptyState = container.querySelector('.chat-page-empty');
    if (emptyState) { container.innerHTML = ''; container._renderedCount = 0; }

    // How many real messages are already in DOM?
    const renderedCount = container._renderedCount || 0;

    // Full re-render needed if messages were removed/replaced (session switch, etc.)
    const needsFullRender = renderedCount > messages.length || container._sessionKey !== (currentSessionName || GATEWAY_CONFIG?.sessionKey);
    if (needsFullRender) {
        container.innerHTML = '';
        container._renderedCount = 0;
        container._sessionKey = currentSessionName || GATEWAY_CONFIG?.sessionKey;
    }

    const currentRendered = container._renderedCount || 0;

    // Append only new messages (skip already-rendered ones)
    // First, remove any transient elements (streaming msg, typing indicator)
    const transient = container.querySelectorAll('.streaming, .typing-indicator');
    transient.forEach(el => el.remove());

    // Append new messages (filtered by session to prevent bleed)
    const activeKeyCP = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    if (messages.length > currentRendered) {
        const fragment = document.createDocumentFragment();
        for (let i = currentRendered; i < messages.length; i++) {
            // Defensive: Skip messages from other sessions
            const msg = messages[i];
            const msgSession = (msg._sessionKey || '').toLowerCase();
            if (!msgSession || !activeKeyCP || msgSession !== activeKeyCP) {
                chatLog(`[Chat] RENDER BLOCKED: msg session=${msgSession}, current=${activeKeyCP}`);
                continue;
            }
            const msgEl = createChatPageMessage(msg);
            if (msgEl) fragment.appendChild(msgEl);
        }
        container.appendChild(fragment);
        container._renderedCount = messages.length;
    }

    // Render streaming message ONLY if it belongs to the current session
    const streamingActiveKeyCP = (currentSessionName || '').toLowerCase();
    if (streamingText && _streamingSessionKey && _streamingSessionKey.toLowerCase() === streamingActiveKeyCP) {
        const streamingMsg = createChatPageMessage({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true,
            model: window._lastResponseModel || window.currentModel
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }

    // Compact live status indicator (same footprint as Thinking...)
    const _presenceStateCP = (window.AgentPresence && typeof window.AgentPresence.getSessionState === 'function')
        ? window.AgentPresence.getSessionState(currentSessionName || '')
        : null;
    const _presenceLabelCP = (window.AgentPresence && typeof window.AgentPresence.getSessionLabel === 'function')
        ? window.AgentPresence.getSessionLabel(currentSessionName || '')
        : 'Thinking...';
    const _showCompactStatusCP = !streamingText && (
        isProcessing || (_presenceStateCP && ['running', 'waiting_tool', 'waiting_user', 'stalled', 'error', 'done'].includes(_presenceStateCP.state))
    );
    if (_showCompactStatusCP) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.style.cssText = 'margin: 12px 0 12px 12px;';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">${_presenceLabelCP}</span>
        `;
        container.appendChild(typingIndicator);
    }

    // Smart scroll behavior - only auto-scroll if user was truly at the bottom
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = previousScrollTop;
    }
}

// Create a chat page message element (different styling from widget)
function createChatPageMessage(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;

    const isInterSession = !!(msg._isInterSession || msg._sourceSession || msg._sourceAgent);
    const isUser = msg.from === 'user' && !isInterSession;
    const isSystem = msg.from === 'system';
    const isBot = !isUser && !isSystem;

    // Message wrapper
    const wrapper = document.createElement('div');
    wrapper.className = `chat-page-message ${isUser ? 'user' : (isSystem ? 'system' : 'solobot')}${msg.isStreaming ? ' streaming' : ''}`;
    wrapper.setAttribute('data-msg-id', msg.id || '');

    // Avatar (for bot and user messages, not system)
    if (!isSystem) {
        const avatar = document.createElement('div');
        avatar.className = 'chat-page-avatar';

        if (isUser) {
            // User avatar - initials circle
            avatar.classList.add('user-avatar');
            avatar.textContent = 'U';
        } else {
            // Bot avatar - agent-specific image and color
            const agentId = msg._agentId || currentAgentId || 'main';
            avatar.setAttribute('data-agent', agentId);

            // Get avatar path - use centralized avatar resolution
            const avatarPath = getAvatarUrl(agentId);

            const avatarImg = document.createElement('img');
            avatarImg.src = avatarPath;
            avatarImg.alt = getAgentDisplayName(agentId);
            avatarImg.onerror = () => { avatarImg.style.display = 'none'; avatar.textContent = '🤖'; };
            avatar.appendChild(avatarImg);
        }

        wrapper.appendChild(avatar);
    }

    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'chat-page-bubble';

    // Images if present - show thumbnails
    const images = msg.images || (msg.image ? [msg.image] : []);
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '8px';
        imageContainer.style.marginBottom = '8px';

        images.forEach((imgSrc, idx) => {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.className = 'chat-page-bubble-image';
            img.style.maxWidth = images.length > 1 ? '100px' : '200px';
            img.style.maxHeight = images.length > 1 ? '100px' : '150px';
            img.style.objectFit = 'cover';
            img.style.cursor = 'pointer';
            img.title = `Image ${idx + 1} of ${images.length} - Click to view`;
            img.onclick = () => openImageModal(imgSrc);
            imageContainer.appendChild(img);
        });

        bubble.appendChild(imageContainer);
    }

    // Header with sender and time
    const header = document.createElement('div');
    header.className = 'chat-page-bubble-header';

    const sender = document.createElement('span');
    sender.className = 'chat-page-sender';
    if (isUser) {
        sender.textContent = 'You';
    } else if (isSystem) {
        sender.textContent = 'System';
    } else {
        // Fix #3b: Use the agent stored on the message, not the current global agent
        const displayName = getAgentDisplayName(msg._agentId || currentAgentId);
        sender.textContent = msg.isStreaming ? `${displayName} is typing...` : displayName;
    }

    const time = document.createElement('span');
    time.className = 'chat-page-bubble-time';
    time.textContent = formatSmartTime(msg.time);
    time.title = formatTime(msg.time); // Show exact time on hover

    header.appendChild(sender);
    header.appendChild(time);

    // Model badge for bot messages - same style as time, relative timestamp preserved
    if (isBot) {
        const { model: bestModel, provider: bestProvider } = getBestModel(msg);
        if (bestModel) {
            const modelBadge = document.createElement('span');
            modelBadge.className = 'chat-page-bubble-time';
            modelBadge.style.marginLeft = '4px';
            const displayModel = formatModelDisplay(bestModel, bestProvider);
            modelBadge.textContent = msg.isStreaming ? `· **${displayModel}**` : `· ${displayModel}`;
            modelBadge.title = bestModel;
            header.appendChild(modelBadge);
        }
    }

    bubble.appendChild(header);

    if (isInterSession && !isSystem) {
        const badge = document.createElement('div');
        badge.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-bottom: 6px;';
        const fromName = msg._sourceAgentName || getAgentDisplayName(msg._agentId || currentAgentId);
        badge.textContent = `Inter-session • from ${fromName}`;
        bubble.appendChild(badge);
    }

    // Content
    const content = document.createElement('div');
    content.className = 'chat-page-bubble-content';
    content.innerHTML = linkifyText(msg.text);
    bubble.appendChild(content);

    // Action buttons (copy, etc.) - show on hover
    if (!msg.isStreaming) {
        const actions = document.createElement('div');
        actions.className = 'chat-page-bubble-actions';

        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'chat-action-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = 'Copy message';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(msg.text);
            copyBtn.innerHTML = '✓';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
                copyBtn.classList.remove('copied');
            }, 1500);
        };
        actions.appendChild(copyBtn);

        // Forward button
        const forwardBtn = document.createElement('button');
        forwardBtn.className = 'chat-action-btn';
        forwardBtn.innerHTML = '↪';
        forwardBtn.title = 'Forward to agent';
        forwardBtn.onclick = (e) => {
            e.stopPropagation();
            openForwardMessageModal(msg);
        };
        actions.appendChild(forwardBtn);

        bubble.appendChild(actions);
    }

    wrapper.appendChild(bubble);
    return wrapper;
}

// Copy text to clipboard with feedback
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success', 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Copied to clipboard!', 'success', 2000);
    });
}

function getForwardableAgents() {
    const baseAgents = ['main', 'dev', 'orion', 'forge', 'quill', 'chip', 'sentinel', 'knox', 'atlas', 'canon', 'vector', 'nova', 'snip', 'luma', 'pulse', 'sterling', 'ledger', 'haven'];
    return [...new Set(baseAgents.map(id => window.resolveAgentId ? window.resolveAgentId(id) : id))];
}

function buildForwardedMessageText(msg) {
    const senderName = msg?.isUser
        ? 'You'
        : msg?.isSystem
            ? 'System'
            : getAgentDisplayName(msg?._agentId || currentAgentId || 'main');
    return `Forwarded message from ${senderName}:\n\n${msg?.text || ''}`;
}

function ensureForwardMessageModal() {
    let modal = document.getElementById('forward-message-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'forward-message-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 560px; width: calc(100vw - 32px);">
            <div class="modal-header">
                <h3 class="modal-title">Forward message</h3>
                <button onclick="closeForwardMessageModal()" class="modal-close">&times;</button>
            </div>
            <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px;">
                <div>
                    <label style="display:block; font-size:12px; font-weight:600; margin-bottom:6px;">Target agent</label>
                    <select id="forward-message-agent" class="input"></select>
                </div>
                <div>
                    <label style="display:block; font-size:12px; font-weight:600; margin-bottom:6px;">Message</label>
                    <textarea id="forward-message-text" class="input" rows="8" style="width:100%; resize:vertical;"></textarea>
                    <div style="font-size:11px; color: var(--text-muted); margin-top:6px;">This switches you to the target agent’s latest session, or creates a new forwarded session if none exists, then drops the forwarded text into the composer.</div>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="closeForwardMessageModal()" class="btn btn-ghost">Cancel</button>
                <button onclick="submitForwardMessage()" class="btn btn-primary">Forward</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

window.openForwardMessageModal = function(msg) {
    const modal = ensureForwardMessageModal();
    modal._forwardMessage = msg;

    const agentSelect = document.getElementById('forward-message-agent');
    if (agentSelect) {
        const current = (msg?._agentId || currentAgentId || 'main');
        agentSelect.innerHTML = getForwardableAgents().map(agentId => {
            const selected = agentId !== current && agentId === (window.currentAgentId || currentAgentId || 'main') ? ' selected' : '';
            return `<option value="${agentId}"${selected}>${escapeHtml(getAgentDisplayName(agentId))}</option>`;
        }).join('');
        if (!agentSelect.value) {
            agentSelect.value = getForwardableAgents().find(id => id !== current) || 'main';
        }
    }

    const textarea = document.getElementById('forward-message-text');
    if (textarea) {
        textarea.value = buildForwardedMessageText(msg);
    }

    requestAnimationFrame(() => {
        modal.classList.add('visible');
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
};

window.closeForwardMessageModal = function() {
    const modal = document.getElementById('forward-message-modal');
    if (!modal) return;
    modal.classList.remove('visible');
};

function buildAutoForwardSessionKey(agentId) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `agent:${agentId}:${agentId}-forwarded-${stamp}`;
}

window.submitForwardMessage = async function() {
    const agentId = document.getElementById('forward-message-agent')?.value?.trim();
    const text = document.getElementById('forward-message-text')?.value?.trim();
    if (!agentId || !text) {
        showToast('Target agent and message are required', 'warning');
        return;
    }

    try {
        let targetSessionKey = null;
        const pool = Array.isArray(window.availableSessions) ? window.availableSessions.slice() : (Array.isArray(availableSessions) ? availableSessions.slice() : []);
        const agentSessions = typeof filterSessionsForAgent === 'function'
            ? filterSessionsForAgent(pool, agentId)
            : pool.filter(s => (s?.key || '').startsWith(`agent:${agentId}:`));

        if (agentSessions.length > 0) {
            agentSessions.sort((a, b) => {
                const aTs = new Date(a.updatedAt || a.lastMessageAt || a.createdAt || 0).getTime() || 0;
                const bTs = new Date(b.updatedAt || b.lastMessageAt || b.createdAt || 0).getTime() || 0;
                return bTs - aTs;
            });
            targetSessionKey = agentSessions[0].key;
        } else {
            targetSessionKey = buildAutoForwardSessionKey(agentId);
        }

        if (typeof switchToSession === 'function') {
            await switchToSession(targetSessionKey);
        }

        const input = document.getElementById('chat-page-input');
        if (input) {
            input.value = text;
            if (typeof resizeChatPageInput === 'function') resizeChatPageInput();
            input.focus();
        }

        closeForwardMessageModal();
        showToast(`Forward loaded for ${getAgentDisplayName(agentId)}${agentSessions.length ? '' : ' in a new session'}`, 'success');
    } catch (err) {
        console.error('Forward failed:', err);
        showToast(`Forward failed: ${err?.message || err}`, 'error');
    }
};

// Notify of new message (for indicator)
function notifyChatPageNewMessage() {
    const container = document.getElementById('chat-page-messages');
    // Show indicator if user is NOT at the bottom
    if (container && !isAtBottom(container)) {
        chatPageNewMessageCount++;
        updateNewMessageIndicator();
    }
}

function handleChatPageImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            processChatPageImageFile(file);
        }
    }
}

function handleChatPagePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) processChatPageImageFile(file);
            return;
        }
    }
}

function processChatPageImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Compress image if larger than 200KB
        let imageData = e.target.result;
        if (!isValidImageDataUri(imageData)) {
            showToast('Invalid image data. Please select the file again.', 'warning');
            return;
        }
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
        }
        if (!isValidImageDataUri(imageData)) {
            showToast('Image processing failed. Please try another image.', 'warning');
            return;
        }

        chatPagePendingImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        });
        renderChatPageImagePreviews();
    };
    reader.readAsDataURL(file);
}

function renderChatPageImagePreviews() {
    const container = document.getElementById('chat-page-image-preview');
    if (!container) return;

    if (chatPagePendingImages.length === 0) {
        container.classList.add('hidden');
        container.classList.remove('visible');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    container.classList.add('visible');
    container.innerHTML = chatPagePendingImages.map((img, idx) => `
        <div class="image-preview-wrapper">
            <img src="${img.data}" alt="Preview ${idx + 1}" />
            <button onclick="removeChatPageImagePreview('${img.id}')" class="image-preview-close">✕</button>
        </div>
    `).join('');
}

function removeChatPageImagePreview(imgId) {
    chatPagePendingImages = chatPagePendingImages.filter(img => img.id !== imgId);
    renderChatPageImagePreviews();
    if (chatPagePendingImages.length === 0) {
        const input = document.getElementById('chat-page-image-upload');
        if (input) input.value = '';
    }
}

function clearChatPageImagePreviews() {
    chatPagePendingImages = [];
    renderChatPageImagePreviews();
    const input = document.getElementById('chat-page-image-upload');
    if (input) input.value = '';
}

function resizeChatPageInput() {
    const input = document.getElementById('chat-page-input');
    if (!input) return;
    input.style.height = 'auto';
    const maxHeight = 150;
    input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
}

function setupChatPageInput() {
    const input = document.getElementById('chat-page-input');
    if (!input) return;

    input.addEventListener('input', resizeChatPageInput);
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.isComposing || e.keyCode === 229) return;
        if (e.shiftKey) return;
        if (!gateway || !gateway.isConnected()) return;
        e.preventDefault();
        sendChatPageMessage();
    });

    resizeChatPageInput();
}

function setActiveSidebarAgent(agentId) {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    agentEls.forEach(el => {
        if (agentId && el.getAttribute('data-agent') === agentId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    // Update currentAgentId and refresh dropdown to show this agent's sessions
    if (agentId) {
        const wasChanged = agentId !== currentAgentId;
        currentAgentId = agentId;

        // Update agent name display in chat header
        const agentNameEl = document.getElementById('chat-page-agent-name');
        if (agentNameEl) {
            agentNameEl.textContent = getAgentLabel(agentId);
        }

        if (wasChanged) {
            populateSessionDropdown();
            // Load this agent's saved model
            if (typeof loadAgentModel === 'function') {
                loadAgentModel(agentId);
            }
        }
    }
}

// Force sync active state (for rapid switches)
function forceSyncActiveAgent(agentId) {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    agentEls.forEach(el => {
        const elAgent = el.getAttribute('data-agent');
        if (agentId && elAgent === agentId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });

    window.currentAgentId = agentId;
    const agentNameEl = document.getElementById('chat-page-agent-name');
    if (agentNameEl) {
        agentNameEl.textContent = getAgentLabel(agentId);
    }
}

// Track last-used session per agent (persisted to localStorage)
function sessionBelongsToAgent(sessionKey, agentId) {
    if (!sessionKey || !agentId) return false;
    const normalizedSession = normalizeDashboardSessionKey(sessionKey);
    const match = normalizedSession.match(/^agent:([^:]+):/);
    if (!match) return false;
    const sessionAgent = window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1];
    const canonicalAgent = window.resolveAgentId ? window.resolveAgentId(agentId) : agentId;
    return sessionAgent === canonicalAgent;
}

function getLastAgentSession(agentId) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        const canonicalAgent = window.resolveAgentId ? window.resolveAgentId(agentId) : agentId;
        const rawSession = map[canonicalAgent] || map[agentId] || null;
        if (!rawSession) return null;

        const normalizedSession = normalizeDashboardSessionKey(rawSession);
        if (!sessionBelongsToAgent(normalizedSession, canonicalAgent)) {
            // Self-heal corrupted mapping so a click can never jump to another agent's session.
            delete map[canonicalAgent];
            delete map[agentId];
            localStorage.setItem('agent_last_sessions', JSON.stringify(map));
            chatLog(`[Sessions] Cleared invalid last-session mapping for ${canonicalAgent}: ${normalizedSession}`);
            return null;
        }
        return normalizedSession;
    } catch { return null; }
}

function saveLastAgentSession(agentId, sessionKey) {
    try {
        const canonicalAgent = window.resolveAgentId ? window.resolveAgentId(agentId) : agentId;
        const normalizedSession = normalizeDashboardSessionKey(sessionKey);
        if (!sessionBelongsToAgent(normalizedSession, canonicalAgent)) {
            chatLog(`[Sessions] Skipping invalid last-session save for ${canonicalAgent}: ${normalizedSession}`);
            return;
        }
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        map[canonicalAgent] = normalizedSession;
        localStorage.setItem('agent_last_sessions', JSON.stringify(map));
    } catch { }
}

function setupSidebarAgents() {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    if (!agentEls.length) return;

    const activateAgentFromEl = (el) => {
        const agentId = el.getAttribute('data-agent');
        if (!agentId) return;
        const canonicalAgentId = window.resolveAgentId ? window.resolveAgentId(agentId) : agentId;

        // IMMEDIATE UI feedback - show active state before switch completes
        forceSyncActiveAgent(canonicalAgentId);

        // Update current agent ID first so dropdown filters correctly
        currentAgentId = canonicalAgentId;

        // Restore last session for this agent, or default to main
        const remembered = getLastAgentSession(canonicalAgentId);
        const sessionKey = remembered || `agent:${canonicalAgentId}:main`;
        showPage('chat');

        // Fire-and-forget switch (queue in sessions.js handles ordering)
        switchToSession(sessionKey).catch(() => { });
    };

    agentEls.forEach(el => {
        // If text gets truncated in the UI, give a native tooltip with the full name.
        const label = el.querySelector('.sidebar-item-text');
        if (label && !label.title) label.title = (label.textContent || '').trim();

        // Only add listener once per element
        if (el._agentClickBound) return;
        el._agentClickBound = true;

        // PATCH: Always handle mousedown to prevent selection from blocking agent switch
        // This ensures sidebar clicks work even when chat text is highlighted
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;  // Left click only

            // Clear any text selection to prevent interference
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) {
                try { selection.removeAllRanges(); } catch { }
            }

            // Always prevent default to avoid any selection-related interference
            e.preventDefault();
            e.stopPropagation();

            // Mark as handled so click doesn't double-fire
            el._handledByMousedown = true;

            // Execute switch
            activateAgentFromEl(el);
        });

        el.addEventListener('click', (e) => {
            // Skip if mousedown already handled it
            if (el._handledByMousedown) {
                el._handledByMousedown = false;
                return;
            }
            // Handle normal click (no selection case)
            activateAgentFromEl(el);
        });
    });

    const currentSession = GATEWAY_CONFIG?.sessionKey || 'main';
    const match = currentSession.match(/^agent:([^:]+):/);
    if (match) {
        const resolvedId = window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1];
        currentAgentId = resolvedId;
        setActiveSidebarAgent(resolvedId);
    }
}

async function sendChatPageMessage() {
    // Stop voice recording if active
    if (voiceInputState === 'listening') {
        chatLog('[Voice] Stopping recording before send');
        stopVoiceInput();
    }

    const input = document.getElementById('chat-page-input');
    const text = input.value.trim();
    if (!text && chatPagePendingImages.length === 0) return;

    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to Gateway. Please connect first in Settings.', 'warning');
        return;
    }

    const rawImagesToSend = [...chatPagePendingImages];
    const { valid: imagesToSend, dropped: droppedImages } = sanitizeImageAttachments(rawImagesToSend, 'chat-page');
    if (droppedImages > 0) {
        showToast(`Skipped ${droppedImages} invalid image attachment${droppedImages > 1 ? 's' : ''}.`, 'warning');
    }
    const imageDataArray = imagesToSend.map(img => getImageDataUri(img)).filter(Boolean);
    const hasImages = imageDataArray.length > 0;
    if (!text && !hasImages) {
        clearChatPageImagePreviews();
        addLocalChatMessage('Failed: selected image is empty or invalid.', 'system');
        renderChat();
        renderChatPage();
        return;
    }
    const sendSignature = buildChatSendSignature(text, imageDataArray);
    if (shouldSuppressDuplicateSend(sendSignature)) {
        chatLog('[Chat] Suppressed duplicate send (chat-page-input)');
        return;
    }
    markChatSendStart(sendSignature);

    if (hasImages) {
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        addLocalChatMessage(displayText, 'user', imageDataArray);
    } else {
        addLocalChatMessage(text, 'user');
    }

    input.value = '';
    accumulatedTranscript = ''; // Clear voice accumulated text
    resizeChatPageInput();
    input.focus();
    clearChatPageImagePreviews();

    // Force scroll to bottom when user sends
    chatPageUserScrolled = false;

    // Show typing indicator immediately
    isProcessing = true;

    // Render both areas
    renderChat();
    renderChatPage();

    // Send via Gateway
    try {
        chatLog(`[Chat] Sending message with model: ${currentModel}`);
        if (hasImages) {
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send:', err);
        addLocalChatMessage(`Failed: ${err.message}`, 'system');
        renderChat();
        renderChatPage();
    } finally {
        markChatSendEnd();
    }
}

// ========================================
// Chat Search Functionality
// ========================================

let chatSearchQuery = '';
let chatSearchResults = [];
let chatSearchCurrentIndex = -1;

function initChatSearch() {
    const searchInput = document.getElementById('chat-search');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        chatSearchQuery = e.target.value.trim().toLowerCase();
        performChatSearch();
    });

    // Keyboard navigation within results
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (chatSearchResults.length > 0) {
                // Navigate to next/previous result
                if (e.shiftKey) {
                    chatSearchCurrentIndex = (chatSearchCurrentIndex - 1 + chatSearchResults.length) % chatSearchResults.length;
                } else {
                    chatSearchCurrentIndex = (chatSearchCurrentIndex + 1) % chatSearchResults.length;
                }
                scrollToChatSearchResult(chatSearchResults[chatSearchCurrentIndex]);
            }
        } else if (e.key === 'Escape') {
            searchInput.blur();
        }
    });
}

function performChatSearch() {
    if (!chatSearchQuery) {
        // Clear any search highlights
        clearChatSearchHighlights();
        chatSearchResults = [];
        chatSearchCurrentIndex = -1;
        return;
    }

    const messages = state.chat?.messages || [];
    chatSearchResults = messages.filter(msg => {
        const text = msg.text?.toLowerCase() || '';
        return text.includes(chatSearchQuery);
    });

    if (chatSearchResults.length > 0) {
        chatSearchCurrentIndex = 0;
        scrollToChatSearchResult(chatSearchResults[0]);
        showToast(`Found ${chatSearchResults.length} match${chatSearchResults.length !== 1 ? 'es' : ''}`, 'info', 2000);
    } else {
        showToast('No matches found', 'warning', 2000);
    }
}

function scrollToChatSearchResult(msg) {
    const container = document.getElementById('chat-page-messages');
    if (!container || !msg) return;

    // Find the message element
    const msgEl = container.querySelector(`[data-msg-id="${msg.id}"]`);
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightChatSearchResult(msgEl);
    }
}

function highlightChatSearchResult(element) {
    // Remove previous highlights
    clearChatSearchHighlights();
    // Add highlight class
    element.classList.add('chat-search-highlight');
    // Remove highlight after 3 seconds
    setTimeout(() => {
        element.classList.remove('chat-search-highlight');
    }, 3000);
}

function clearChatSearchHighlights() {
    const container = document.getElementById('chat-page-messages');
    if (container) {
        container.querySelectorAll('.chat-search-highlight').forEach(el => {
            el.classList.remove('chat-search-highlight');
        });
    }
}

// Initialize search on load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initChatSearch, 100); // Small delay to ensure DOM is ready
});

// === talk-mode.js ===
// js/talk-mode.js — Natural realtime Talk Mode for OpenClaw Gateway
// Uses Gateway talk.realtime.session transports; never exposes provider API keys.

(function () {
    'use strict';

    const TALK_STATES = {
        idle: 'Idle',
        connecting: 'Connecting',
        listening: 'Listening',
        thinking: 'Thinking / Asking OpenClaw',
        speaking: 'Speaking',
        error: 'Error'
    };
    const CONSULT_TOOL = 'openclaw_agent_consult';
    const TALK_DEBUG = false;
    const talkLog = (...args) => { if (TALK_DEBUG) console.log('[Talk]', ...args); };

    let talkState = 'idle';
    let talkError = '';
    let talkProviderLabel = 'Provider unknown';
    let talkSession = null;
    let talkAdapter = null;
    let talkTranscript = [];
    let talkStarting = false;

    function getGateway() {
        try {
            if (typeof gateway !== 'undefined' && gateway) return gateway;
        } catch { }
        return window.gateway || null;
    }

    function getSessionKey() {
        try {
            const key = window.currentSessionName || (typeof currentSessionName !== 'undefined' ? currentSessionName : '') || window.GATEWAY_CONFIG?.sessionKey || (typeof GATEWAY_CONFIG !== 'undefined' ? GATEWAY_CONFIG.sessionKey : '') || 'agent:main:main';
            return typeof normalizeSessionKey === 'function' ? normalizeSessionKey(key) : key;
        } catch {
            return 'agent:main:main';
        }
    }

    function getAudioContextCtor() {
        return window.AudioContext || window.webkitAudioContext;
    }

    function b64FromBytes(bytes) {
        let out = '';
        const chunk = 32768;
        for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return btoa(out);
    }

    function bytesFromB64(value) {
        const raw = atob(String(value || ''));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes;
    }

    function floatToPcm16(float32) {
        const out = new Uint8Array(float32.length * 2);
        const view = new DataView(out.buffer);
        for (let i = 0; i < float32.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32[i] || 0));
            view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        return out;
    }

    function pcm16ToFloat(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = new Float32Array(Math.floor(bytes.byteLength / 2));
        for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
        return out;
    }

    function safeJson(value, fallback = {}) {
        if (!value) return fallback;
        if (typeof value === 'object') return value;
        try { return JSON.parse(String(value)); } catch { return fallback; }
    }

    function showToastSafe(message, type = 'info') {
        if (typeof showToast === 'function') showToast(message, type);
        else console.log(`[Talk] ${message}`);
    }

    function setTalkState(next, message = '') {
        talkState = next;
        talkError = next === 'error' ? String(message || 'Talk failed') : '';
        renderTalkMode();
        if (message && next === 'error') showToastSafe(message, 'error');
    }

    function upsertTranscript(role, text, final = false) {
        const clean = String(text || '').trim();
        if (!clean) return;
        const last = talkTranscript[talkTranscript.length - 1];
        if (last && last.role === role && !last.final) {
            last.text = clean;
            last.final = Boolean(final);
            last.time = Date.now();
        } else {
            talkTranscript.push({ role, text: clean, final: Boolean(final), time: Date.now() });
        }
        talkTranscript = talkTranscript.slice(-20);
        renderTalkMode();
    }

    function getSessionTransport(session) {
        const candidates = [session?.transport, session?.type, session?.kind, session?.provider, session?.protocol, session?.mode].filter(Boolean).map(v => String(v).toLowerCase());
        if (session?.relaySessionId || candidates.some(v => v.includes('relay') || v === 'gateway-relay')) return 'relay';
        if (session?.websocketUrl || candidates.some(v => v.includes('google') || v.includes('websocket') || v.includes('bidi') || v === 'json-pcm-websocket')) return 'google-live';
        if (session?.offerUrl || session?.sdpUrl || session?.url || session?.clientSecret || session?.ephemeralKey || candidates.some(v => v.includes('webrtc') || v.includes('openai') || v === 'webrtc-sdp')) return 'openai-webrtc';
        return 'unknown';
    }

    function describeProvider(session) {
        const transport = getSessionTransport(session);
        const provider = session?.provider || session?.providerName || session?.realtimeProvider || session?.model || transport;
        const timeout = session?.silenceTimeoutMs || session?.config?.silenceTimeoutMs;
        const interrupt = session?.interruptOnSpeech ?? session?.config?.interruptOnSpeech;
        const bits = [String(provider || 'Talk')];
        if (transport !== 'unknown') bits.push(transport);
        if (timeout) bits.push(`${timeout}ms silence`);
        if (interrupt !== undefined) bits.push(interrupt ? 'interrupt on speech' : 'no interrupt');
        return bits.join(' · ');
    }

    function renderTalkMode() {
        const root = document.getElementById('talk-mode-panel');
        const btn = document.getElementById('talk-mode-btn');
        const status = document.getElementById('talk-mode-status');
        const statusText = document.getElementById('talk-mode-status-text');
        const transcriptEl = document.getElementById('talk-mode-transcript');
        const providerEl = document.getElementById('talk-mode-provider');
        if (btn) {
            const active = talkState !== 'idle' && talkState !== 'error';
            btn.classList.toggle('active', active);
            btn.classList.toggle('connecting', talkState === 'connecting');
            btn.classList.toggle('error', talkState === 'error');
            btn.title = active ? 'Stop Talk Mode' : 'Start natural Talk Mode';
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            const label = btn.querySelector('.talk-mode-btn-label');
            if (label) label.textContent = active ? 'Stop Talk' : 'Talk';
        }
        if (root) root.classList.toggle('hidden', talkState === 'idle' && talkTranscript.length === 0);
        if (status) status.className = `talk-mode-dot ${talkState}`;
        if (statusText) statusText.textContent = talkError || TALK_STATES[talkState] || talkState;
        if (providerEl) providerEl.textContent = talkProviderLabel;
        if (transcriptEl) {
            transcriptEl.innerHTML = '';
            if (talkTranscript.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'talk-mode-empty';
                empty.textContent = 'Live voice transcript will appear here.';
                transcriptEl.appendChild(empty);
            } else {
                for (const item of talkTranscript.slice(-8)) {
                    const row = document.createElement('div');
                    row.className = `talk-mode-line ${item.role || 'assistant'} ${item.final ? 'final' : 'interim'}`;
                    const speaker = document.createElement('span');
                    speaker.className = 'talk-mode-speaker';
                    speaker.textContent = item.role === 'user' ? 'You' : 'SoLoBot';
                    const text = document.createElement('span');
                    text.className = 'talk-mode-text';
                    text.textContent = item.text;
                    row.append(speaker, text);
                    transcriptEl.appendChild(row);
                }
                transcriptEl.scrollTop = transcriptEl.scrollHeight;
            }
        }
    }

    async function consultOpenClaw(ctx, callId, args, submit) {
        setTalkState('thinking');
        const parsed = safeJson(args, args || {});
        const question = String(parsed.question || parsed.prompt || parsed.query || '').trim();
        if (!question) {
            submit(callId, { error: `${CONSULT_TOOL} requires a question` });
            setTalkState('listening');
            return;
        }
        const parts = [question];
        const style = parsed.style || parsed.responseStyle || parsed.response_style;
        if (parsed.context) parts.push(`Context:\n${parsed.context}`);
        if (style) parts.push(`Spoken style:\n${style}`);
        try {
            const gw = getGateway();
            const run = await gw.request('chat.send', {
                sessionKey: getSessionKey(),
                message: parts.join('\n\n'),
                idempotencyKey: crypto.randomUUID()
            }, 20000);
            const result = await waitForChatFinal(gw, run?.runId, 120000);
            submit(callId, { result: result || 'OpenClaw finished with no text.' });
        } catch (err) {
            submit(callId, { error: err?.message || String(err) });
        } finally {
            setTalkState('listening');
        }
    }

    function waitForChatFinal(gw, runId, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!runId) return resolve('OpenClaw accepted the request.');
            const timer = setTimeout(() => cleanup(reject, new Error('OpenClaw tool call timed out')), timeoutMs);
            const off = gw.addEventListener?.((evt) => {
                if (evt.event !== 'chat') return;
                const payload = evt.payload || {};
                const message = payload.message || {};
                if ((message.runId || payload.runId) !== runId) return;
                if (payload.state === 'final') cleanup(resolve, extractText(message, payload) || 'OpenClaw finished with no text.');
                if (payload.state === 'error') cleanup(reject, new Error(message.errorMessage || payload.errorMessage || 'OpenClaw tool call failed'));
            });
            function cleanup(fn, value) {
                clearTimeout(timer);
                try { off?.(); } catch { }
                fn(value);
            }
        });
    }

    function extractText(message, payload) {
        if (typeof _extractMessageContent === 'function') return _extractMessageContent(message, payload).text;
        return [message?.text, message?.content, payload?.text, payload?.content].filter(v => typeof v === 'string').join('\n').trim();
    }

    class RelayAdapter {
        constructor(session) { this.session = session; this.media = null; this.inputContext = null; this.outputContext = null; this.inputSource = null; this.inputProcessor = null; this.unsubscribe = null; this.sources = new Set(); this.playhead = 0; this.closed = true; }
        async start() {
            const AudioCtor = getAudioContextCtor();
            if (!navigator.mediaDevices?.getUserMedia || !AudioCtor) throw new Error('Realtime Talk requires browser microphone and Web Audio support');
            this.closed = false;
            this.unsubscribe = getGateway().addEventListener(evt => evt.event?.startsWith?.('talk.realtime.relay') && this.handleEvent(evt.payload || {}));
            this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.inputContext = new AudioCtor({ sampleRate: this.session.audio?.inputSampleRateHz || 16000 });
            this.outputContext = new AudioCtor({ sampleRate: this.session.audio?.outputSampleRateHz || 24000 });
            this.inputSource = this.inputContext.createMediaStreamSource(this.media);
            this.inputProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
            this.inputProcessor.onaudioprocess = (e) => {
                if (this.closed) return;
                getGateway().request('talk.realtime.relayAudio', {
                    relaySessionId: this.session.relaySessionId,
                    audioBase64: b64FromBytes(floatToPcm16(e.inputBuffer.getChannelData(0))),
                    timestamp: Math.round((this.inputContext.currentTime || 0) * 1000)
                }, 10000).catch(() => { });
            };
            this.inputSource.connect(this.inputProcessor);
            this.inputProcessor.connect(this.inputContext.destination);
            setTalkState('listening');
        }
        stop() {
            this.closed = true;
            try { this.unsubscribe?.(); } catch { }
            this.inputProcessor?.disconnect(); this.inputSource?.disconnect();
            this.media?.getTracks().forEach(t => t.stop());
            this.stopOutput();
            this.inputContext?.close(); this.outputContext?.close();
            getGateway()?.request?.('talk.realtime.relayStop', { relaySessionId: this.session.relaySessionId }, 5000).catch(() => { });
        }
        handleEvent(e) {
            if (e.relaySessionId && e.relaySessionId !== this.session.relaySessionId) return;
            if (e.type === 'ready') setTalkState('listening');
            else if (e.type === 'audio' && e.audioBase64) { setTalkState('speaking'); this.playPcm16(e.audioBase64); }
            else if (e.type === 'clear') this.stopOutput();
            else if (e.type === 'mark') this.ackMarkLater();
            else if (e.type === 'transcript') upsertTranscript(e.role, e.text, e.final !== false);
            else if (e.type === 'toolCall') this.handleToolCall(e);
            else if (e.type === 'error') setTalkState('error', e.message || 'Realtime relay failed');
            else if (e.type === 'close') setTalkState(e.reason === 'error' ? 'error' : 'idle', e.reason === 'error' ? 'Realtime relay closed' : '');
        }
        playPcm16(audioBase64) {
            if (!this.outputContext) return;
            const floats = pcm16ToFloat(bytesFromB64(audioBase64));
            const buffer = this.outputContext.createBuffer(1, floats.length, this.session.audio?.outputSampleRateHz || this.outputContext.sampleRate);
            buffer.getChannelData(0).set(floats);
            const source = this.outputContext.createBufferSource();
            this.sources.add(source);
            source.onended = () => { this.sources.delete(source); if (!this.sources.size && talkState === 'speaking') setTalkState('listening'); };
            source.buffer = buffer;
            source.connect(this.outputContext.destination);
            const startAt = Math.max(this.outputContext.currentTime, this.playhead);
            source.start(startAt);
            this.playhead = startAt + buffer.duration;
        }
        stopOutput() { for (const s of this.sources) { try { s.stop(); } catch { } } this.sources.clear(); this.playhead = this.outputContext?.currentTime || 0; }
        ackMarkLater() { setTimeout(() => getGateway()?.request?.('talk.realtime.relayMark', { relaySessionId: this.session.relaySessionId }, 5000).catch(() => { }), 0); }
        async handleToolCall(e) {
            const name = String(e.name || '').trim(); const callId = String(e.callId || e.id || '').trim();
            if (!callId) return;
            if (name !== CONSULT_TOOL) return this.submitToolResult(callId, { error: `Tool "${name}" not available in browser Talk` });
            await consultOpenClaw({}, callId, e.args || {}, (id, result) => this.submitToolResult(id, result));
        }
        submitToolResult(callId, result) { getGateway()?.request?.('talk.realtime.relayToolResult', { relaySessionId: this.session.relaySessionId, callId, result }, 15000).catch(() => { }); }
    }

    class GoogleLiveAdapter {
        constructor(session) { this.session = session; this.ws = null; this.media = null; this.inputContext = null; this.outputContext = null; this.inputSource = null; this.inputProcessor = null; this.playhead = 0; this.sources = new Set(); this.pendingCalls = new Map(); this.closed = true; }
        async start() {
            const AudioCtor = getAudioContextCtor();
            if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioCtor) throw new Error('Realtime Talk requires browser WebSocket, microphone, and Web Audio support');
            this.closed = false;
            this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.inputContext = new AudioCtor({ sampleRate: this.session.audio?.inputSampleRateHz || 16000 });
            this.outputContext = new AudioCtor({ sampleRate: this.session.audio?.outputSampleRateHz || 24000 });
            this.ws = new WebSocket(this.buildUrl());
            this.ws.onopen = () => { this.send(this.session.initialMessage || { setup: {} }); this.startPump(); };
            this.ws.onmessage = (event) => this.handleMessage(event.data);
            this.ws.onerror = () => !this.closed && setTalkState('error', 'Realtime connection failed');
            this.ws.onclose = () => !this.closed && setTalkState('error', 'Realtime connection closed');
        }
        buildUrl() {
            const url = new URL(this.session.websocketUrl);
            if (url.protocol !== 'wss:') throw new Error('Google Live WebSocket URL must be secure');
            if (url.hostname.toLowerCase() !== 'generativelanguage.googleapis.com') throw new Error('Untrusted Google Live WebSocket host');
            if (!/^\/ws\/google\.ai\.generativelanguage\.v[0-9a-z]+\.GenerativeService\.BidiGenerateContent(?:Constrained)?$/.test(url.pathname)) {
                throw new Error('Untrusted Google Live WebSocket path');
            }
            if (url.username || url.password) throw new Error('Google Live WebSocket URL must not include credentials');
            url.search = '';
            const token = this.session.clientSecret || this.session.token || this.session.accessToken;
            if (token) url.searchParams.set('access_token', token);
            return url.toString();
        }
        startPump() {
            this.inputSource = this.inputContext.createMediaStreamSource(this.media);
            this.inputProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
            this.inputProcessor.onaudioprocess = (e) => {
                if (this.ws?.readyState !== WebSocket.OPEN) return;
                this.send({ realtimeInput: { audio: { data: b64FromBytes(floatToPcm16(e.inputBuffer.getChannelData(0))), mimeType: `audio/pcm;rate=${this.inputContext.sampleRate}` } } });
            };
            this.inputSource.connect(this.inputProcessor);
            this.inputProcessor.connect(this.inputContext.destination);
        }
        send(obj) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }
        handleMessage(raw) {
            const msg = safeJson(raw, null); if (!msg) return;
            if (msg.setupComplete) setTalkState('listening');
            const sc = msg.serverContent || {};
            if (sc.interrupted) this.stopOutput();
            if (sc.inputTranscription?.text) upsertTranscript('user', sc.inputTranscription.text, sc.inputTranscription.finished !== false);
            if (sc.outputTranscription?.text) { setTalkState('speaking'); upsertTranscript('assistant', sc.outputTranscription.text, sc.outputTranscription.finished !== false); }
            for (const part of sc.modelTurn?.parts || []) {
                if (part.inlineData?.data) { setTalkState('speaking'); this.playPcm16(part.inlineData.data); }
                if (!part.thought && typeof part.text === 'string' && part.text.trim()) upsertTranscript('assistant', part.text, !!sc.turnComplete);
            }
            for (const call of msg.toolCall?.functionCalls || []) this.handleToolCall(call);
        }
        playPcm16(audioBase64) {
            if (!this.outputContext) return;
            const floats = pcm16ToFloat(bytesFromB64(audioBase64));
            const buffer = this.outputContext.createBuffer(1, floats.length, this.session.audio?.outputSampleRateHz || this.outputContext.sampleRate);
            buffer.getChannelData(0).set(floats);
            const source = this.outputContext.createBufferSource(); source.buffer = buffer; source.connect(this.outputContext.destination);
            this.sources.add(source);
            const startAt = Math.max(this.outputContext.currentTime, this.playhead); source.start(startAt); this.playhead = startAt + buffer.duration;
            source.onended = () => { this.sources.delete(source); if (!this.sources.size && talkState === 'speaking') setTalkState('listening'); };
        }
        async handleToolCall(call) {
            const name = call.name; const id = call.id || call.callId;
            if (!id || !name) return;
            this.pendingCalls.set(id, { name, args: call.args || {} });
            if (name === CONSULT_TOOL) await consultOpenClaw({}, id, call.args || {}, (callId, result) => this.submitToolResult(callId, result));
        }
        submitToolResult(id, result) {
            const pending = this.pendingCalls.get(id); if (!pending) return;
            this.pendingCalls.delete(id);
            this.send({ toolResponse: { functionResponses: [{ id, name: pending.name, scheduling: 'WHEN_IDLE', response: result && typeof result === 'object' ? result : { output: result } }] } });
        }
        stopOutput() { for (const s of this.sources) { try { s.stop(); } catch { } } this.sources.clear(); this.playhead = this.outputContext?.currentTime || 0; }
        stop() { this.closed = true; this.inputProcessor?.disconnect(); this.inputSource?.disconnect(); this.media?.getTracks().forEach(t => t.stop()); this.stopOutput(); this.inputContext?.close(); this.outputContext?.close(); this.ws?.close(); }
    }

    class OpenAIWebRTCAdapter {
        constructor(session) { this.session = session; this.peer = null; this.channel = null; this.media = null; this.audio = null; this.closed = true; this.toolBuffers = new Map(); this.handledToolCalls = new Set(); }
        async start() {
            if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('Realtime Talk requires browser WebRTC and microphone access');
            this.closed = false;
            this.peer = new RTCPeerConnection();
            this.audio = document.createElement('audio'); this.audio.autoplay = true; this.audio.style.display = 'none'; document.body.appendChild(this.audio);
            this.peer.ontrack = (event) => { if (this.audio) this.audio.srcObject = event.streams[0]; setTalkState('speaking'); };
            this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
            for (const track of this.media.getAudioTracks()) this.peer.addTrack(track, this.media);
            this.channel = this.peer.createDataChannel('oai-events');
            this.channel.onopen = () => setTalkState('listening');
            this.channel.onmessage = (event) => this.handleEvent(safeJson(event.data, {}));
            this.channel.onerror = () => !this.closed && setTalkState('error', 'Realtime data channel failed');
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            const answerSdp = await this.exchangeSdp(offer.sdp || '');
            await this.peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        }
        getClientSecret() { return this.session.clientSecret?.value || this.session.clientSecret || this.session.ephemeralKey || this.session.token || this.session.secret; }
        getSdpUrl() { return this.session.offerUrl || this.session.sdpUrl || this.session.url || this.session.endpoint || 'https://api.openai.com/v1/realtime/calls'; }
        async exchangeSdp(sdp) {
            const url = this.getSdpUrl();
            const model = this.session.model || this.session.modelId;
            const finalUrl = model && !String(url).includes('model=') ? `${url}${String(url).includes('?') ? '&' : '?'}model=${encodeURIComponent(model)}` : url;
            const headers = { ...(this.session.headers || {}), 'Content-Type': 'application/sdp' };
            const clientSecret = this.getClientSecret();
            if (clientSecret) headers.Authorization = `Bearer ${clientSecret}`;
            const res = await fetch(finalUrl, { method: 'POST', headers, body: sdp });
            if (!res.ok) throw new Error(`OpenAI realtime SDP failed: ${res.status}`);
            return res.text();
        }
        send(obj) { if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(obj)); }
        handleEvent(e) {
            const type = e.type || '';
            if (type.includes('speech_started')) { setTalkState('listening'); this.send({ type: 'response.cancel' }); }
            if (type === 'conversation.item.input_audio_transcription.completed') upsertTranscript('user', e.transcript, true);
            if (type === 'response.audio_transcript.delta') { setTalkState('speaking'); upsertTranscript('assistant', e.delta, false); }
            if (type === 'response.audio_transcript.done') upsertTranscript('assistant', e.transcript, true);
            if (type === 'response.function_call_arguments.delta') {
                const key = e.item_id || e.call_id;
                if (!key) return;
                const cur = this.toolBuffers.get(key) || { name: e.name || '', callId: e.call_id || '', arguments: '' };
                cur.arguments += e.delta || '';
                if (e.name) cur.name = e.name;
                if (e.call_id) cur.callId = e.call_id;
                this.toolBuffers.set(key, cur);
            }
            if (type === 'response.function_call_arguments.done') {
                const key = e.item_id || e.call_id;
                const cur = this.toolBuffers.get(key) || {};
                if (key) this.toolBuffers.delete(key);
                this.handleToolCall({ call_id: e.call_id || cur.callId, name: e.name || cur.name, arguments: e.arguments || cur.arguments || '{}' });
            }
            if (type === 'response.output_item.done' && e.item?.type === 'function_call') this.handleToolCall(e.item);
            if (type === 'error') setTalkState('error', e.error?.message || 'Realtime provider error');
        }
        async handleToolCall(call) {
            const name = call.name; const callId = call.call_id || call.callId || call.id;
            if (!callId || name !== CONSULT_TOOL || this.handledToolCalls.has(callId)) return;
            this.handledToolCalls.add(callId);
            await consultOpenClaw({}, callId, call.arguments || call.args || {}, (id, result) => this.submitToolResult(id, result));
        }
        submitToolResult(callId, result) {
            const output = typeof result === 'string' ? result : JSON.stringify(result || {});
            this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
            this.send({ type: 'response.create' });
        }
        stop() { this.closed = true; this.channel?.close(); this.peer?.close(); this.media?.getTracks().forEach(t => t.stop()); this.audio?.remove(); }
    }

    async function loadTalkStatus() {
        const gw = getGateway();
        if (!gw?.isConnected?.()) return;
        try {
            const cfg = await gw.request('config.get', {}, 8000);
            const talk = cfg?.config?.talk || cfg?.talk || {};
            if (talk?.provider) {
                const bits = [talk.provider];
                if (talk.silenceTimeoutMs) bits.push(`${talk.silenceTimeoutMs}ms silence`);
                if (talk.interruptOnSpeech !== undefined) bits.push(talk.interruptOnSpeech ? 'interrupt on speech' : 'no interrupt');
                talkProviderLabel = bits.join(' · ');
                renderTalkMode();
            }
        } catch { }
    }

    async function startTalkMode() {
        if (talkStarting || talkAdapter) return;
        const gw = getGateway();
        if (!gw?.isConnected?.()) { showToastSafe('Connect to Gateway before starting Talk Mode.', 'warning'); return; }
        const dictationListening = (typeof voiceInputState !== 'undefined' && voiceInputState === 'listening');
        if (dictationListening && typeof stopVoiceInput === 'function') stopVoiceInput();
        talkStarting = true;
        talkTranscript = [];
        setTalkState('connecting');
        try {
            talkSession = await gw.request('talk.realtime.session', { sessionKey: getSessionKey() }, 20000);
            talkProviderLabel = describeProvider(talkSession);
            const transport = getSessionTransport(talkSession);
            if (transport === 'relay') talkAdapter = new RelayAdapter(talkSession);
            else if (transport === 'google-live') talkAdapter = new GoogleLiveAdapter(talkSession);
            else if (transport === 'openai-webrtc') talkAdapter = new OpenAIWebRTCAdapter(talkSession);
            else throw new Error('Gateway returned an unsupported Talk transport');
            await talkAdapter.start();
            showToastSafe(`Talk Mode started (${talkProviderLabel})`, 'success');
        } catch (err) {
            console.error('[Talk] Start failed:', err);
            stopTalkMode(false);
            setTalkState('error', err?.message || 'Talk Mode failed to start');
        } finally {
            talkStarting = false;
            renderTalkMode();
        }
    }

    function stopTalkMode(reset = true) {
        try { talkAdapter?.stop?.(); } catch (err) { console.warn('[Talk] stop failed', err); }
        talkAdapter = null;
        talkSession = null;
        talkStarting = false;
        if (reset) setTalkState('idle');
        else renderTalkMode();
    }

    function toggleTalkMode() {
        if (talkAdapter || talkStarting) stopTalkMode(true);
        else startTalkMode();
    }

    function initTalkMode() {
        renderTalkMode();
        loadTalkStatus();
    }

    window.toggleTalkMode = toggleTalkMode;
    window.startTalkMode = startTalkMode;
    window.stopTalkMode = stopTalkMode;
    window.renderTalkMode = renderTalkMode;
    window.loadTalkStatus = loadTalkStatus;

    document.addEventListener('DOMContentLoaded', () => setTimeout(initTalkMode, 150));
})();
