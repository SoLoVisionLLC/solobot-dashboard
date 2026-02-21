// js/state.js — Global state, config constants, persistence, chat storage

// Agent color mappings for UI visualization
const AGENT_COLORS = {
    main: '#3b82f6',
    exec: '#8b5cf6',
    coo: '#10b981',
    cfo: '#f59e0b',
    cmp: '#ec4899',
    dev: '#06b6d4',
    sec: '#ef4444',
    smm: '#f97316',
    family: '#84cc16',
    tax: '#6366f1',
    docs: '#14b8a6',
    cto: '#8b5cf6',
    creative: '#d946ef',
    forge: '#0891b2',
    quill: '#0ea5e9',
    chip: '#22c55e'
};

let state = {
    status: 'idle',
    model: 'opus 4.5',
    currentTask: null,
    subagent: null,
    tasks: { todo: [], progress: [], done: [], archive: [] },
    notes: [],
    activity: [],
    docs: [],
    pendingNotify: null,
    live: { status: 'idle', task: null, taskStarted: null, thoughts: [], lastActive: null, tasksToday: 0 },
    console: { logs: [], expanded: false },
    chat: { messages: [] },
    system: { messages: [] }
};

// ===================
// CHAT PERSISTENCE
// ===================

const CHAT_KEY_PREFIX = 'solobot-chat-';
const SYSTEM_KEY = 'solobot-system-messages';

function chatStorageKey(sessionKey) {
    const key = sessionKey || (typeof window !== 'undefined' ? window.currentSessionName : null) || localStorage.getItem('gateway_session') || 'agent:main:main';
    return CHAT_KEY_PREFIX + key;
}

// In-memory session message cache for fast agent switching
const _sessionMessageCache = new Map();

function cacheSessionMessages(sessionKey, messages) {
    if (!sessionKey || !messages) return;
    _sessionMessageCache.set(sessionKey, messages.slice(-100));
}

function getCachedSessionMessages(sessionKey) {
    return _sessionMessageCache.get(sessionKey) || null;
}

function loadPersistedMessages() {
    // System messages (local-only)
    try {
        const savedSystem = localStorage.getItem(SYSTEM_KEY);
        if (savedSystem) {
            const parsed = JSON.parse(savedSystem);
            if (Array.isArray(parsed)) {
                const cutoff = Date.now() - (24 * 60 * 60 * 1000);
                state.system.messages = parsed.filter(m => m.time > cutoff);
            }
        }
    } catch (e) { /* ignore */ }

    // Chat messages
    const key = chatStorageKey();
    try {
        const saved = localStorage.getItem(key);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                state.chat.messages = parsed;
                return;
            }
        }
    } catch (e) { /* ignore */ }

    loadChatFromServer();
}

// Load chat messages from server (fallback when localStorage is empty)
async function loadChatFromServer() {
    try {
        const response = await fetch('/api/state');
        if (!response.ok) return;
        const serverState = await response.json();
        if (serverState.chat?.messages?.length > 0) {
            state.chat.messages = serverState.chat.messages;
            localStorage.setItem(chatStorageKey(), JSON.stringify(state.chat.messages));
            if (typeof renderChatMessages === 'function') renderChatMessages();
            if (typeof renderChatPage === 'function') renderChatPage();
        }
    } catch (e) { /* ignore */ }
}

function persistSystemMessages() {
    try {
        const systemToSave = state.system.messages.slice(-30);
        localStorage.setItem(SYSTEM_KEY, JSON.stringify(systemToSave));
    } catch (e) { /* ignore */ }
}

// Save chat messages to localStorage + server
function persistChatMessages() {
    try {
        const chatToSave = state.chat.messages.slice(-200);
        const key = chatStorageKey();
        localStorage.setItem(key, JSON.stringify(chatToSave));
        cacheSessionMessages(currentSessionName || window.currentSessionName, chatToSave);
        syncChatToServer(chatToSave);
    } catch (e) { /* ignore */ }
}

// Debounced server sync
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
        } catch (e) { /* ignore */ }
    }, 2000);
}

loadPersistedMessages();

// Gateway config - localStorage only
const GATEWAY_CONFIG = {
    host: localStorage.getItem('gateway_host') || '',
    port: parseInt(localStorage.getItem('gateway_port')) || 443,
    token: localStorage.getItem('gateway_token') || '',
    sessionKey: localStorage.getItem('gateway_session') || 'agent:main:main',
    maxMessages: 100
};

function saveGatewaySettings(host, port, token, sessionKey) {
    const normalized = sessionKey || 'agent:main:main';
    localStorage.setItem('gateway_host', host);
    localStorage.setItem('gateway_port', port.toString());
    localStorage.setItem('gateway_token', token);
    localStorage.setItem('gateway_session', normalized);
    GATEWAY_CONFIG.host = host;
    GATEWAY_CONFIG.port = port;
    GATEWAY_CONFIG.token = token;
    GATEWAY_CONFIG.sessionKey = normalized;
    console.log('[saveGatewaySettings] Saved sessionKey:', normalized);
}

// Gateway client instance
let gateway = null;
let streamingText = '';
let _streamingSessionKey = '';
let isProcessing = false;
let lastProcessingEndTime = 0;
let historyPollInterval = null;
let sessionVersion = 0;

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set();
let editingTaskId = null;
let currentModalTask = null;
let currentModalColumn = null;
let refreshIntervalId = null;
let taskModalOpen = false;

const DISABLE_SYSTEM_FILTER = false;

// ===================
// DATA PERSISTENCE
// ===================

async function loadState() {
    const currentChat = state.chat;
    const currentSystem = state.system;

    // Load from VPS
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            vpsState.tasks = vpsState.tasks || { todo: [], progress: [], done: [], archive: [] };
            vpsState.tasks.archive = vpsState.tasks.archive || [];
            delete vpsState.pendingChat;
            delete vpsState.chat;

            state = { ...state, ...vpsState, tasks: vpsState.tasks, activity: vpsState.activity || [], _taskVersion: vpsState._taskVersion || 0, chat: currentChat, system: currentSystem };
            const taskCount = (vpsState.tasks.todo?.length || 0) + (vpsState.tasks.progress?.length || 0) + (vpsState.tasks.done?.length || 0);
            console.log(`[loadState] Loaded: ${taskCount} tasks, v${vpsState._taskVersion || 0}`);
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            return;
        }
    } catch (e) { /* VPS not available */ }

    // Fallback: localStorage
    const localSaved = localStorage.getItem('solovision-dashboard');
    if (localSaved) {
        const parsed = JSON.parse(localSaved);
        delete parsed.system;
        delete parsed.console;
        state = { ...state, ...parsed, chat: currentChat, system: currentSystem };
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
        // Check server version
        try {
            const checkResp = await fetch('/api/state', { cache: 'no-store' });
            if (checkResp.ok) {
                const serverState = await checkResp.json();
                const serverTaskVersion = serverState._taskVersion || 0;
                if (serverTaskVersion > (state._taskVersion || 0)) {
                    console.log(`[Sync] Server tasks newer (v${serverTaskVersion} > v${state._taskVersion || 0})`);
                    state.tasks = serverState.tasks || state.tasks;
                    state._taskVersion = serverTaskVersion;
                    localStorage.setItem('solovision-dashboard', JSON.stringify(state));
                    renderTasks();
                }
            }
        } catch (e) { /* continue */ }

        // Build sync payload - don't sync tasks/activity (server is authoritative)
        const syncPayload = JSON.parse(JSON.stringify(state));
        delete syncPayload.tasks;
        delete syncPayload._taskVersion;
        delete syncPayload.activity;
        delete syncPayload.chat;
        delete syncPayload.system;
        delete syncPayload.console;

        const response = await fetch(SYNC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload)
        });
        
        if (response.ok && state.console?.logs) {
            state.console.logs.push({ text: 'State synced to server', type: 'info', time: Date.now() });
            if (state.console.logs.length > 500) state.console.logs = state.console.logs.slice(-500);
            renderConsole();
        }
    } catch (err) {
        console.error('Sync error:', err);
    }
}

function initSampleData() {
    state.tasks = { todo: [], progress: [], done: [], archive: [] };
    state.notes = [];
    state.activity = [];
    state.docs = [];
    saveState();
}

function initDashboardTasks() {
    console.log('[Dashboard] Task initialization skipped — tasks managed server-side');
}


