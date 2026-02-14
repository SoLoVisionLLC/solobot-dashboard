// js/state.js — Global state, config constants, persistence, chat storage

let state = {
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
const AGENT_COLORS = new Proxy({}, {
    get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        const cached = target[prop];
        if (cached) return cached;
        const val = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${prop}`).trim();
        if (val) target[prop] = val;
        return val || '';
    }
});

function chatStorageKey(sessionKey) {
    const key = sessionKey || GATEWAY_CONFIG?.sessionKey || localStorage.getItem('gateway_session') || 'main';
    return 'solobot-chat-' + key;
}

// In-memory session message cache (avoids full reload on agent switch)
const _sessionMessageCache = new Map();

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
                state.chat.messages = parsed;
                // Migrate legacy key to session-scoped
                if (legacyChat && !savedChat) {
                    localStorage.setItem(currentKey, chatData);
                }
                return;
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
        if (serverState.chat?.messages?.length > 0) {
            state.chat.messages = serverState.chat.messages;
            localStorage.setItem(chatStorageKey(), JSON.stringify(state.chat.messages));
            // console.log(`[Dashboard] Loaded ${state.chat.messages.length} chat messages from server`); // Keep quiet
            // Re-render if on chat page
            if (typeof renderChatMessages === 'function') renderChatMessages();
            if (typeof renderChatPage === 'function') renderChatPage();
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
        const key = chatStorageKey();
        localStorage.setItem(key, JSON.stringify(chatToSave));
        // Also update in-memory cache
        cacheSessionMessages(currentSessionName || GATEWAY_CONFIG.sessionKey, chatToSave);
        
        // Also sync to server for persistence across deploys
        syncChatToServer(chatToSave);
    } catch (e) {
        // Silently fail - not critical
    }
}

// Sync chat messages to server (debounced)
let chatSyncTimeout = null;
function syncChatToServer(messages) {
    if (chatSyncTimeout) clearTimeout(chatSyncTimeout);
    chatSyncTimeout = setTimeout(async () => {
        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });
        } catch (e) {
            // Silently fail - not critical
        }
    }, 2000); // Debounce 2 seconds
}

// Load persisted messages immediately
loadPersistedMessages();

// Gateway connection configuration - load from localStorage first, server state as fallback

const GATEWAY_CONFIG = {
    host: localStorage.getItem('gateway_host') || '',
    port: parseInt(localStorage.getItem('gateway_port')) || 443,
    token: localStorage.getItem('gateway_token') || '',
    sessionKey: localStorage.getItem('gateway_session') || 'main',
    maxMessages: 500
};

// Function to save gateway settings to both localStorage AND server state
function saveGatewaySettings(host, port, token, sessionKey) {
    // Save to localStorage
    localStorage.setItem('gateway_host', host);
    localStorage.setItem('gateway_port', port.toString());
    localStorage.setItem('gateway_token', token);
    localStorage.setItem('gateway_session', sessionKey);
    
    // Also save to server state for persistence across deploys
    state.gatewayConfig = { host, port, token, sessionKey };
    saveState('Gateway settings updated');
}

// Function to load gateway settings from server state (called after loadState)
function loadGatewaySettingsFromServer() {
    // console.log('[Dashboard] loadGatewaySettingsFromServer called'); // Keep quiet
    
    if (state.gatewayConfig && state.gatewayConfig.host) {
        // Always prefer server settings if they exist (server is source of truth)
        GATEWAY_CONFIG.host = state.gatewayConfig.host;
        GATEWAY_CONFIG.port = state.gatewayConfig.port || 443;
        GATEWAY_CONFIG.token = state.gatewayConfig.token || '';
        GATEWAY_CONFIG.sessionKey = state.gatewayConfig.sessionKey || 'main';
        
        // Also save to localStorage for faster loading next time
        localStorage.setItem('gateway_host', GATEWAY_CONFIG.host);
        localStorage.setItem('gateway_port', GATEWAY_CONFIG.port.toString());
        localStorage.setItem('gateway_token', GATEWAY_CONFIG.token);
        localStorage.setItem('gateway_session', GATEWAY_CONFIG.sessionKey);
        
        // console.log('[Dashboard] ✓ Loaded gateway settings from server:', GATEWAY_CONFIG.host); // Keep quiet
    }
    // No gateway config in server state - that's fine
}

// Gateway client instance

let gateway = null;
let streamingText = '';
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
                    try { localStorage.setItem('solovision-dashboard', JSON.stringify(state)); } catch(e) {}
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

// REMOVED: 70 hardcoded DASHBOARD_TASKS array — tasks are now managed server-side via agents
const DASHBOARD_TASKS = []; // kept empty for compatibility
    
    // Phase 2: Motion & Microinteractions (P0 - critical)
    
    // Phase 3: Widget System (P1 - important)
    
    // Phase 4: Context Awareness (P1 - important)
    
    // Phase 5: Command Palette (P1 - important)
    
    // Phase 6: AI Insights Widget (P1 - important)
    
    // Phase 7: Activity Visualization (P1 - important)
    
    // Phase 8: Quick Actions (P1 - important)
    
    // Phase 9: Voice Integration (P2 - nice to have)
    
    // Phase 10: Task Board Enhancements (P2 - nice to have)
    
    // Phase 11: Agent Status Panel (P2 - nice to have)
    
    // Phase 12: Analytics Widget (P2 - nice to have)
    
    // Phase 13: Terminal Improvements (P2 - nice to have)
    
    // Phase 14: UX Polish (P2 - nice to have)
    
    // Phase 15: Keyboard Shortcuts (P2 - nice to have)
    
    // Phase 16: Business Features (P2 - nice to have)
];

function createDashboardTasks() {
    const now = Date.now();
    const tasks = [];
    
    DASHBOARD_TASKS.forEach((taskDef, index) => {
        const id = `dash-${taskDef.phase}-${taskDef.num}-${now + index}`;
        const title = `P${taskDef.phase}.${String(taskDef.num).padStart(3, '0')} ${taskDef.title}`;
        tasks.push({
            id,
            title,
            priority: taskDef.priority,
            created: now + index,
            description: `Dashboard Phase ${taskDef.phase} improvement task`,
            agent: 'dev'
        });
    });
    
    return tasks;
}

function initDashboardTasks() {
    // DISABLED: Tasks are managed by agents via dashboard-sync API, not auto-generated.
    // The old code created 70 hardcoded improvement tasks on every page load when none had 'dash-' prefix IDs.
    console.log('[Dashboard] Task initialization skipped — tasks managed server-side');
}


