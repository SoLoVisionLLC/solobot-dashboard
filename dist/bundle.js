// SoLoBot Dashboard — Bundled JS
// Generated: 2026-02-21T20:54:23Z
// Modules: 25


// === state.js ===
// js/state.js — Global state, config constants, persistence, chat storage

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
    maxMessages: 500
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



// === ui.js ===
// js/ui.js — Confirm dialogs, toasts, alert/confirm overrides


// ===================
// CUSTOM CONFIRM & TOAST (no browser alerts!)
// ===================

let confirmResolver = null;

// Custom confirm dialog - returns Promise<boolean>
function showConfirm(message, title = 'Confirm', okText = 'OK') {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').innerHTML = message;
        document.getElementById('confirm-modal-ok').textContent = okText;
        showModal('confirm-modal');
    });
}

function closeConfirmModal(result) {
    hideModal('confirm-modal');
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

// Toast notification - replaces alert()
function showToast(message, type = 'info', duration = 4000) {
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
    switch(type) {
        case 'success': toast.style.background = 'var(--success)'; break;
        case 'error': toast.style.background = 'var(--error)'; break;
        case 'warning': toast.style.background = '#f59e0b'; break;
        default: toast.style.background = 'var(--accent)'; break;
    }
    
    toast.textContent = message;
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
        focus: JSON.parse(localStorage.getItem('stats_history_focus') || '[]'),
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
    
    // Focus sessions
    const focusEl = document.getElementById('stat-focus-sessions');
    if (focusEl) {
        focusEl.textContent = focusTimer.sessions;
        updateSparklineData('focus', focusTimer.sessions);
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
    
    // Focus sparkline
    const focusSparklineEl = document.getElementById('sparkline-focus');
    if (focusSparklineEl) {
        focusSparklineEl.innerHTML = generateSparkline(statsState.history.focus, 60, 24, 'positive');
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
    const keys = ['tasks', 'messages', 'focus', 'activity'];
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
setInterval(updateQuickStats, 60000);

// Export for use in other modules
window.QuickStats = {
    update: updateQuickStats,
    generateSparkline,
    generateProgressRing,
    generateMiniHeatmap,
    generateActivityHeatmap
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
    const knownAgents = ['main', 'exec', 'coo', 'cfo', 'cmp', 'dev', 'family', 'tax', 'sec', 'smm'];

    for (const s of sessions) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? match[1] : 'main';
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
        const agentId = match ? match[1] : 'main';
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
        const agentId = match ? match[1] : 'main';
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
    { id: 'memory', icon: '🧠', title: 'Memory Lane', desc: 'Browse memory files', shortcut: 'M', action: () => showPage('memory') },
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
    
    // Command palette: Cmd/Ctrl + K
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
        case 'm':
            showPage('memory');
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
window.viewMemoryFile = async function(filePath) {
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
window.saveMemoryFile = async function() {
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
window.closeMemoryModal = function() {
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

function isSystemMessage(text, from) {
    // DEBUG MODE: Show everything in chat
    if (DISABLE_SYSTEM_FILTER) {
        return false; // Everything goes to chat
    }

    if (!text) return false;

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

// Provider and Model selection functions
window.changeProvider = function() {
    const providerSelect = document.getElementById('provider-select');
    if (!providerSelect) return;
    
    const selectedProvider = providerSelect.value;
    
    // Update display
    const providerNameEl = document.getElementById('provider-name');
    if (providerNameEl) providerNameEl.textContent = selectedProvider;
    
    // Update model dropdown for this provider
    updateModelDropdown(selectedProvider);
};

window.updateProviderDisplay = function() {
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
window.onSettingsProviderChange = async function() {
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
window.refreshModels = async function() {
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
            const provider = providerSelect?.value || currentProvider || 'anthropic';
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
window.changeSessionModel = async function() {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect?.value;
    
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
    
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to gateway', 'warning');
        return;
    }
    
    // Track manual change to prevent UI reversion
    window._lastManualModelChange = Date.now();
    
    try {
        const sessionKey = GATEWAY_CONFIG.sessionKey || 'main';
        console.log(`[Dashboard] Changing model to: ${selectedModel} (session: ${sessionKey})`);

        if (selectedModel === 'global/default') {
            // Remove per-agent model override — revert to global default
            const agentId = currentAgentId || 'main';
            await fetch('/api/models/set-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, modelId: 'global/default' })
            });
            
            // Also clear session override
            try { 
                await gateway.patchSession(sessionKey, { model: null }); 
                // Refresh session cache to update the model
                try {
                    const result = await gateway?.listSessions?.({});
                    if (result?.sessions?.length) {
                        availableSessions = result.sessions.map(s => ({
                            key: s.key,
                            name: getFriendlySessionName(s.key),
                            displayName: getFriendlySessionName(s.key),
                            updatedAt: s.updatedAt,
                            totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                            model: s.model || 'unknown',
                            sessionId: s.sessionId
                        }));
                    }
                } catch (e) {
                    console.warn('[Dashboard] Failed to refresh sessions after model change:', e.message);
                }
            } catch (_) {}
            
            // Fetch current global default to update UI
            const response = await fetch('/api/models/current');
            const globalModel = await response.json();
            
            if (globalModel?.modelId) {
                currentModel = globalModel.modelId;
                const provider = globalModel.provider || currentModel.split('/')[0];
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
                await gateway.patchSession(sessionKey, { model: selectedModel });
                // Refresh session cache to update the model
                try {
                    const result = await gateway?.listSessions?.({});
                    if (result?.sessions?.length) {
                        availableSessions = result.sessions.map(s => ({
                            key: s.key,
                            name: getFriendlySessionName(s.key),
                            displayName: getFriendlySessionName(s.key),
                            updatedAt: s.updatedAt,
                            totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                            model: s.model || 'unknown',
                            sessionId: s.sessionId
                        }));
                    }
                } catch (e) {
                    console.warn('[Dashboard] Failed to refresh sessions after model change:', e.message);
                }
            } catch (e) {
                console.warn('[Dashboard] sessions.patch model failed (may need gateway restart):', e.message);
            }
            
            // Update local state
            currentModel = selectedModel;
            const provider = selectedModel.split('/')[0];
            currentProvider = provider;
            localStorage.setItem('selected_model', selectedModel);
            localStorage.setItem('selected_provider', provider);
            
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
window.changeGlobalModel = async function() {
    const modelSelect = document.getElementById('setting-model');
    const providerSelect = document.getElementById('setting-provider');
    const selectedModel = modelSelect?.value;
    const selectedProvider = providerSelect?.value;
    
    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }
    
    if (!selectedModel.includes('/')) {
        showToast('Invalid model format. Please select a valid model.', 'warning');
        return;
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
            const provider = selectedModel.split('/')[0];
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
        if (configData?.raw) configData = JSON.parse(configData.raw);
        
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
            const slashIdx = modelId.indexOf('/');
            if (slashIdx === -1) continue;
            
            const provider = modelId.substring(0, slashIdx);
            const modelName = modelId.substring(slashIdx + 1);
            
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
        } catch (_) {}
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
let currentProvider = 'anthropic';
let currentModel = 'anthropic/claude-opus-4-5';

/**
 * Resolve a bare model name (e.g. "claude-opus-4-6") to its full "provider/model" ID.
 * The gateway sessions.list often returns model names without the provider prefix.
 * Uses known prefixes to resolve the model.
 */
function resolveFullModelId(modelStr) {
    if (!modelStr) return modelStr;
    // Already has a provider prefix
    if (modelStr.includes('/')) return modelStr;
    
    // Well-known provider prefixes
    const knownPrefixes = {
        'claude': 'anthropic',
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

/**
 * Sync the model dropdown and display elements with the actual model in use.
 * Called when we get model info from gateway connect or chat responses.
 * This is the source of truth — gateway tells us what model is actually running.
 */
function syncModelDisplay(model, provider) {
    if (!model) return;
    
    // Ignore updates if manual change happened recently (prevent reversion flicker)
    // Use a shorter timeout and more precise tracking
    const now = Date.now();
    if (window._lastManualModelChange && (now - window._lastManualModelChange < 2000)) {
        console.log('[Dashboard] Skipping model sync due to recent manual change');
        return;
    }
    
    // Resolve bare model names to full provider/model IDs
    model = resolveFullModelId(model);
    
    if (model === currentModel && provider === currentProvider) return;
    
    console.log(`[Dashboard] Model sync: ${currentModel} → ${model} (provider: ${provider || currentProvider})`);
    currentModel = model;
    
    // Extract provider from model ID if not provided
    if (!provider && model.includes('/')) {
        provider = model.split('/')[0];
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

// Apply per-session model override from availableSessions (if present)
async function applySessionModelOverride(sessionKey) {
    if (!sessionKey) return;
    
    let sessionModel = null;
    
    // 1. Check local availableSessions cache (model = last used model from sessions.list)
    const session = availableSessions.find(s => s.key === sessionKey);
    const cachedModel = session?.model && session.model !== 'unknown' ? session.model : null;
    if (cachedModel) {
        sessionModel = cachedModel;
    }
    
    // 2. If not cached, refresh sessions list from gateway
    if (!sessionModel) {
        try {
            const result = await gateway?.listSessions?.({});
            if (result?.sessions?.length) {
                availableSessions = result.sessions.map(s => ({
                    key: s.key,
                    name: getFriendlySessionName(s.key),
                    displayName: getFriendlySessionName(s.key),
                    updatedAt: s.updatedAt,
                    totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                    model: s.model || 'unknown',
                    sessionId: s.sessionId
                }));
                const updated = availableSessions.find(s => s.key === sessionKey);
                const updatedModel = updated?.model && updated.model !== 'unknown' ? updated.model : null;
                if (updatedModel) sessionModel = updatedModel;
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to refresh sessions for model override:', e.message);
        }
    }
    
    // 3. Check per-agent model override via server API
    if (!sessionModel) {
        try {
            // Extract agentId from sessionKey to get per-agent model
            const agentIdMatch = sessionKey.match(/^agent:([^:]+):/);
            const agentId = agentIdMatch ? agentIdMatch[1] : 'main';
            
            const response = await fetch(`/api/models/current?agentId=${encodeURIComponent(agentId)}`);
            if (response.ok) {
                const modelInfo = await response.json();
                if (modelInfo?.modelId) {
                    sessionModel = modelInfo.modelId;
                    console.log(`[Dashboard] Session ${sessionKey} using per-agent model from API: ${sessionModel} (agent: ${agentId})`);
                }
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to fetch model config from server:', e.message);
        }
    }
    
    if (sessionModel) {
        sessionModel = resolveFullModelId(sessionModel);
        const provider = sessionModel.includes('/') ? sessionModel.split('/')[0] : currentProvider;
        console.log(`[Dashboard] applySessionModelOverride: Setting model to ${sessionModel} for session ${sessionKey}`);
        syncModelDisplay(sessionModel, provider);
    } else {
        console.log(`[Dashboard] applySessionModelOverride: No override for ${sessionKey}, keeping current display`);
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
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // First fetch current model from server API (reads openclaw.json — source of truth)
        // Don't trust localStorage as it can get stale across sessions/deploys
        let modelId = null;
        let provider = null;
        
        try {
            // Extract agentId from session key - this is more reliable than currentAgentId which may not be set yet
            const sessionKey = localStorage.getItem('gateway_session') || 'agent:main:main';
            const agentIdMatch = sessionKey.match(/^agent:([^:]+):/);
            const agentId = agentIdMatch ? agentIdMatch[1] : 'main';
            
            const response = await fetch(`/api/models/current?agentId=${encodeURIComponent(agentId)}`);
            const modelInfo = await response.json();
            modelId = modelInfo?.modelId;
            provider = modelInfo?.provider;
            console.log(`[Dashboard] Model from API: ${modelId} (provider: ${provider}, agent: ${agentId})`);
        } catch (e) {
            console.warn('[Dashboard] Failed to fetch current model from API:', e.message);
            // Fall back to localStorage only if API fails
            modelId = localStorage.getItem('selected_model');
            provider = localStorage.getItem('selected_provider');
        }
        
        // Final fallback
        if (!modelId) modelId = 'anthropic/claude-opus-4-5';
        if (!provider) provider = modelId.split('/')[0];
        
        currentProvider = provider;
        currentModel = modelId;

        console.log(`[Dashboard] Init model: ${currentModel} (provider: ${currentProvider})`);
        
        // NOW populate the provider dropdown with currentProvider set
        await populateProviderDropdown();
        
        // Update displays
        const currentProviderDisplay = document.getElementById('current-provider-display');
        const currentModelDisplay = document.getElementById('current-model-display');
        const providerSelectEl = document.getElementById('provider-select');
        
        if (currentProviderDisplay) currentProviderDisplay.textContent = currentProvider;
        if (currentModelDisplay) currentModelDisplay.textContent = currentModel;
        if (providerSelectEl) providerSelectEl.value = currentProvider;
        
        // Also sync settings provider dropdown
        const settingProviderEl = document.getElementById('setting-provider');
        if (settingProviderEl) settingProviderEl.value = currentProvider;
        
        // Populate model dropdown for current provider and select current model
        
        // Set up periodic model sync (every 5 minutes)
        setInterval(async () => {
            try {
                const response = await fetch('/api/models/current');
                const modelInfo = await response.json();
                if (modelInfo?.modelId && modelInfo?.provider) {
                    // Only update if different from current
                    if (modelInfo.modelId !== currentModel || modelInfo.provider !== currentProvider) {
                        console.log(`[Dashboard] Model changed on server: ${currentModel} → ${modelInfo.modelId}`);
                        syncModelDisplay(modelInfo.modelId, modelInfo.provider);
                    }
                }
            } catch (e) {
                // Silent fail for periodic sync
            }
        }, 5 * 60 * 1000); // 5 minutes
        await updateModelDropdown(currentProvider);
        selectModelInDropdowns(currentModel);
        
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
    notifLog(`[Notifications] 📥 Cross-session notification received: session=${sessionKey}, content=${(content||'').slice(0,80)}..., images=${images?.length || 0}`);

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
    if (model) {
        window._lastResponseModel = model;
        window._lastResponseProvider = provider;
        syncModelDisplay(model, provider);
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
            streamingText = '';  // Clear any stale streaming text
            renderChat();
            renderChatPage();
            break;
            
        case 'delta':
            // Streaming response - content is cumulative, so REPLACE not append
            streamingText = content;
            _streamingSessionKey = sessionKey || currentSessionName || '';
            isProcessing = true;
            renderChat();
            renderChatPage();
            break;

        case 'final':
            // Final response from assistant
            // Prefer streamingText if available for consistency (avoid content mismatch)
            const finalContent = streamingText || content;
            // Skip gateway-injected internal messages
            if (finalContent && /^\s*\[read-sync\]\s*(\n\s*\[\[read_ack\]\])?\s*$/s.test(finalContent)) {
                streamingText = '';
                isProcessing = false;
                lastProcessingEndTime = Date.now();
                break;
            }
            if (finalContent && role !== 'user') {
                // Check for duplicate - by runId first, then by trimmed text within 10 seconds
                const trimmed = finalContent.trim();
                const isDuplicate = state.chat.messages.some(m =>
                    (runId && m.runId === runId) ||
                    (m.from === 'solobot' && m.text?.trim() === trimmed && (Date.now() - m.time) < 10000)
                );
                if (!isDuplicate) {
                    const msg = addLocalChatMessage(finalContent, 'solobot', images, window._lastResponseModel);
                    // Tag with runId for dedup against history merge
                    if (msg && runId) msg.runId = runId;
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
                    time: msg.timestamp || Date.now()
                };

                // Classify and route
                if (isSystemMsg) {
                    state.system.messages.push(message);
                    existingSystemTexts.add(textContent); // already trimmed by extractContentText
                    newSystemCount++;
                } else {
                    state.chat.messages.push(message);
                    existingIds.add(msgId);
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
// Make sessLog globally available
window.sessLog = function(...args) { if (SESSION_DEBUG) console.log(...args); }
function sessLog(...args) { if (SESSION_DEBUG) console.log(...args); }

const AGENT_PERSONAS = {
    'main':   { name: 'Halo',     role: 'PA' },
    'exec':   { name: 'Elon',     role: 'CoS' },
    'cto':    { name: 'Orion',    role: 'CTO' },
    'coo':    { name: 'Atlas',    role: 'COO' },
    'cfo':    { name: 'Sterling', role: 'CFO' },
    'cmp':    { name: 'Vector',   role: 'CMP' },
    'dev':    { name: 'Dev',      role: 'ENG' },
    'forge':  { name: 'Forge',   role: 'DEVOPS' },
    'quill':  { name: 'Quill',   role: 'FE/UI' },
    'chip':    { name: 'Chip',    role: 'SWE' },
    'snip':    { name: 'Snip',    role: 'YT' },
    'sec':     { name: 'Knox',    role: 'SEC' },
    'smm':    { name: 'Nova',    role: 'SMM' },
    'family':  { name: 'Haven',   role: 'FAM' },
    'tax':     { name: 'Ledger',  role: 'TAX' },
    'docs':    { name: 'Canon',   role: 'DOC' }
};

function normalizeDashboardSessionKey(key) {
    if (!key || key === 'main') return 'agent:main:main';
    return key;
}

function getFriendlySessionName(key) {
    if (!key) return 'Halo (PA)';
    const match = key.match(/^agent:([^:]+):(.+)$/);
    if (match) {
        const agentId = match[1];
        const sessionSuffix = match[2];
        const persona = AGENT_PERSONAS[agentId];
        const name = persona ? persona.name : agentId.toUpperCase();
        return sessionSuffix === 'main' ? name : `${name} (${sessionSuffix})`;
    }
    return key;
}

let currentSessionName;
window.currentSessionName = currentSessionName; // Expose globally for other modules

function initCurrentSessionName() {
    const localSession = localStorage.getItem('gateway_session');
    const gatewaySession = (typeof GATEWAY_CONFIG !== 'undefined' && GATEWAY_CONFIG?.sessionKey) ? GATEWAY_CONFIG.sessionKey : null;
    currentSessionName = normalizeDashboardSessionKey(localSession || gatewaySession || 'agent:main:main');
    window.currentSessionName = currentSessionName; // Keep exposed value in sync
    console.log('[initCurrentSessionName] localStorage:', localSession, 'Final:', currentSessionName);
}

initCurrentSessionName();

window.toggleSessionMenu = function() {
    const menu = document.getElementById('session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

window.renameSession = async function() {
    toggleSessionMenu();
    const newName = prompt('Enter new session name:', currentSessionName);
    if (!newName || newName === currentSessionName) return;
    
    try {
        const response = await fetch('/api/session/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName: currentSessionName, newName })
        });
        
        if (response.ok) {
            currentSessionName = newName;
            window.currentSessionName = currentSessionName; // Sync to window for other modules
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

window.showSessionSwitcher = function() {
    toggleSessionMenu();
    showToast('Session switcher coming soon', 'info');
}

// Chat Page Session Menu Functions
window.toggleChatPageSessionMenu = function() {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

// Close session menu when clicking outside
document.addEventListener('click', function(e) {
    const menu = document.getElementById('chat-page-session-menu');
    const trigger = e.target.closest('[onclick*="toggleChatPageSessionMenu"]');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !trigger) {
        menu.classList.add('hidden');
    }
});

// Session Management
let availableSessions = [];
let currentAgentId = 'main';
window.currentAgentId = currentAgentId; // Expose for other modules
let _switchInFlight = false;
let _sessionSwitchQueue = [];

function getAgentIdFromSession(sessionKey) {
    const match = sessionKey?.match(/^agent:([^:]+):/);
    return match ? match[1] : 'main';
}

function filterSessionsForAgent(sessions, agentId) {
    return sessions.filter(s => {
        const sessAgent = getAgentIdFromSession(s.key);
        if (sessAgent === agentId) return true;
        if (s.key?.startsWith('agent:main:subagent:')) {
            const label = s.displayName || s.name || '';
            if (label.toLowerCase().startsWith(agentId.toLowerCase() + '-')) return true;
        }
        return false;
    });
}

function checkUrlSessionParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
}

function handleSubagentSessionAgent() {
    if (!currentSessionName?.startsWith('agent:main:subagent:')) return;
    
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
        window.currentAgentId = agentFromLabel;
        
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
async function fetchSessions() {
    // Debounce: if already fetching, queue one follow-up call
    if (_fetchSessionsInFlight) { _fetchSessionsQueued = true; return availableSessions; }
    _fetchSessionsInFlight = true;

    try {
        // Preserve locally-added sessions that might not be in gateway yet
        const localSessions = availableSessions.filter(s => s.sessionId === null);

        // Try gateway first if connected (direct RPC call)
        if (gateway && gateway.isConnected()) {
            try {
                const result = await gateway.listSessions({});
                let sessions = result?.sessions || [];

                const gatewaySessions = sessions.map(s => {
                    const friendlyName = getFriendlySessionName(s.key);
                    return {
                        key: s.key,
                        name: friendlyName,
                        displayName: friendlyName,
                        updatedAt: s.updatedAt,
                        totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                        model: s.model || 'unknown',
                        sessionId: s.sessionId
                    };
                });

                const gatewayKeys = new Set(gatewaySessions.map(s => s.key));
                const mergedLocalSessions = localSessions.filter(s => !gatewayKeys.has(s.key));
                availableSessions = [...gatewaySessions, ...mergedLocalSessions];

                sessLog(`[Dashboard] Fetched ${gatewaySessions.length} from gateway + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);

                handleSubagentSessionAgent();
                populateSessionDropdown();
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

        const serverSessions = rawServerSessions.map(s => {
            const friendlyName = getFriendlySessionName(s.key);
            return {
                key: s.key,
                name: friendlyName,
                displayName: s.displayName || friendlyName,
                updatedAt: s.updatedAt,
                totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                model: s.model || 'unknown',
                sessionId: s.sessionId
            };
        });

        const serverKeys = new Set(serverSessions.map(s => s.key));
        const mergedLocalSessions = localSessions.filter(s => !serverKeys.has(s.key));
        availableSessions = [...serverSessions, ...mergedLocalSessions];

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
        const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        
        return `
        <div class="session-dropdown-item ${isActive ? 'active' : ''}" data-session-key="${s.key}" onclick="if(event.target.closest('.session-edit-btn')) return; switchToSession('${s.key}')">
            <div class="session-info">
                <div class="session-name">${escapeHtml(s.displayName || s.name || s.key || 'unnamed')}${unreadSessions.get(s.key) ? ` <span class="unread-badge" style="background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 18px; height: 18px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; margin-left: 4px;">${unreadSessions.get(s.key)}</span>` : ''}</div>
                <div class="session-meta">${dateStr} ${timeStr} • ${s.totalTokens?.toLocaleString() || 0} tokens</div>
            </div>
            <span class="session-model">${s.model}</span>
            <div class="session-actions">
                <button class="session-edit-btn" onclick="editSessionName('${s.key}', '${escapeHtml(s.displayName || s.name || s.key || 'unnamed')}')" title="Rename session">
                    ✏️
                </button>
                <button class="session-edit-btn" onclick="deleteSession('${s.key}', '${escapeHtml(s.displayName || s.name || s.key || 'unnamed')}')" title="Delete session" style="color: var(--error);">
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

window.editSessionName = function(sessionKey, currentName) {
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
                    // Even if displayName changes, keep the visible label as the session key
                    if (nameEl) {
                        nameEl.textContent = sessionKey;
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

window.deleteSession = async function(sessionKey, sessionName) {
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
                availableSessions = availableSessions.filter(s => s.key !== sessionKey);
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

window.switchToSessionKey = window.switchToSession = async function(sessionKey) {
    sessionKey = normalizeDashboardSessionKey(sessionKey);
    
    // Enqueue switch request (FIFO)
    _sessionSwitchQueue.push({ sessionKey, timestamp: Date.now() });
    
    // If switch already in progress, queue will be processed after current completes
    if (_switchInFlight) {
        return;
    }
    
    // Process queue until empty (defeats rapid clicks by processing all)
    while (_sessionSwitchQueue.length > 0) {
        const { sessionKey: nextKey } = _sessionSwitchQueue.shift();
        
        // Skip if already on this session
        if (nextKey === currentSessionName) {
            populateSessionDropdown();
            continue;
        }
        
        await executeSessionSwitch(nextKey);
        
        // Check if a newer request superseded this one
        // If queue has items that came in AFTER we started this switch, process them
        // If queue is empty or only has our own re-submit, we're done
    }
}

// Core switch execution (no queue handling)
async function executeSessionSwitch(sessionKey) {
    _switchInFlight = true;

    try {
        toggleChatPageSessionMenu();

        // Clear unread notifications for this session
        clearUnreadForSession(sessionKey);

        showToast(`Switching to ${getFriendlySessionName(sessionKey)}...`, 'info');

        // FIRST: nuke all rendering state synchronously — before any async work
        streamingText = '';
        _streamingSessionKey = '';
        isProcessing = false;
        state.chat.messages = [];
        renderChat();
        renderChatPage();

        // 1. Save current chat and cache it for fast switching back
        await saveCurrentChat();
        cacheSessionMessages(currentSessionName || GATEWAY_CONFIG.sessionKey, state.chat.messages);

        // 2. Increment session version to invalidate any in-flight history loads
        sessionVersion++;
        sessLog(`[Dashboard] Session version now ${sessionVersion}`);

        // 3. Update session config and input field
        const oldSessionName = currentSessionName;
        currentSessionName = sessionKey;
        window.currentSessionName = currentSessionName; // Sync to window for other modules
        GATEWAY_CONFIG.sessionKey = sessionKey;
        localStorage.setItem('gateway_session', sessionKey);
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;

        // 3a. Update current agent ID from session key
        const agentMatch = sessionKey.match(/^agent:([^:]+):/);
        if (agentMatch) {
            currentAgentId = agentMatch[1];
            window.currentAgentId = agentMatch[1];
            // Force sync UI immediately (before async work)
            if (typeof forceSyncActiveAgent === 'function') {
                forceSyncActiveAgent(agentMatch[1]);
            }
        }

        // 4. Clear current chat display
        await clearChatHistory(true, true);

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
        const modelPromise = applySessionModelOverride(sessionKey).catch(() => {});

        // Update UI immediately (don't wait for network)
        const nameEl = document.getElementById('chat-page-session-name');
        if (nameEl) {
            nameEl.textContent = sessionKey;
            nameEl.title = sessionKey;
        }
        populateSessionDropdown();

        // Wait for history (critical path)
        await historyPromise;
        await modelPromise;

        if (agentMatch) {
            setActiveSidebarAgent(agentMatch[1]);
            saveLastAgentSession(agentMatch[1], sessionKey);
        } else {
            setActiveSidebarAgent(null);
        }

        showToast(`Switched to ${getFriendlySessionName(sessionKey)}`, 'success');
    } catch (e) {
        console.error('[Dashboard] Failed to switch session:', e);
        showToast('Failed to switch session', 'error');
    } finally {
        _switchInFlight = false;
    }
}

// Navigate to a session by key - can be called from external links
// Usage: window.goToSession('agent:main:subagent:abc123')
// Or via URL: ?session=agent:main:subagent:abc123
window.goToSession = async function(sessionKey) {
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
        window.currentSessionName = currentSessionName; // Sync to window for other modules
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
window.getSessionUrl = function(sessionKey) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?session=${encodeURIComponent(sessionKey)}`;
}

async function saveCurrentChat() {
    // Save current chat messages to state as safeguard
    try {
        const response = await fetch('/api/state');
        const state = await response.json();
        
        // Save chat history to archivedChats
        if (!state.archivedChats) state.archivedChats = {};
        state.archivedChats[currentSessionName] = {
            savedAt: Date.now(),
            messages: chatHistory.slice(-100) // Last 100 messages
        };
        
        await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
    } catch (e) {
        // Silently fail - safeguard is optional
    }
}

async function loadSessionHistory(sessionKey) {
    const loadVersion = sessionVersion;
    
    // Helper: attempt to load from gateway
    async function tryGatewayLoad() {
        if (!gateway || !gateway.isConnected()) return false;
        try {
            const result = await gateway.loadHistory();
            if (loadVersion !== sessionVersion) {
                sessLog(`[Dashboard] Ignoring stale history load for ${sessionKey}`);
                return true; // Stale but don't retry
            }
            if (result?.messages && result.messages.length > 0) {
                if (state.chat?.messages?.length > 0) {
                    mergeHistoryMessages(result.messages);
                } else {
                    loadHistoryMessages(result.messages);
                }
                sessLog(`[Dashboard] Loaded ${result.messages.length} messages from gateway for ${sessionKey}`);
                return true;
            }
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
            window.currentSessionName = currentSessionName; // Sync to window for other modules
            
            // Fetch live model config from gateway (populates dropdowns),
            // then apply per-session override (authoritative model display).
            fetchModelsFromGateway().then(() => applySessionModelOverride(intendedSession));
            
            // Update session name displays
            const nameEl = document.getElementById('current-session-name');
            if (nameEl) {
                nameEl.textContent = intendedSession;
                nameEl.title = intendedSession;
            }
            const chatPageNameEl = document.getElementById('chat-page-session-name');
            if (chatPageNameEl) {
                chatPageNameEl.textContent = intendedSession;
                chatPageNameEl.title = intendedSession;
            }
            
            // Remember this session for the agent
            const agentMatch = intendedSession.match(/^agent:([^:]+):/);
            if (agentMatch) saveLastAgentSession(agentMatch[1], intendedSession);
            
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
                    // ALWAYS merge on reconnect — never replace.
                    // loadHistoryMessages wipes local messages which causes data loss.
                    // If chat is empty, try restoring from localStorage first.
                    if (!state.chat?.messages?.length) {
                        try {
                            const key = chatStorageKey();
                            const saved = localStorage.getItem(key);
                            if (saved) {
                                const parsed = JSON.parse(saved);
                                if (Array.isArray(parsed) && parsed.length > 0) {
                                    state.chat.messages = parsed;
                                    sessLog(`[Dashboard] Restored ${parsed.length} messages from localStorage before merge`);
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                    mergeHistoryMessages(result.messages);
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
            if (event.phase === 'start' && event.summary) {
                addTerminalLog(event.summary, 'info', event.timestamp);
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

window.openNewSessionModal = function(defaultValue) {
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

window.closeNewSessionModal = function(value) {
    const modal = document.getElementById('new-session-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
    if (newSessionModalResolve) {
        newSessionModalResolve(value);
        newSessionModalResolve = null;
    }
};

window.submitNewSessionModal = function() {
    const input = document.getElementById('new-session-name-input');
    const value = input ? input.value : null;
    closeNewSessionModal(value);
};

// Handle Enter key in new session modal
document.addEventListener('keydown', function(e) {
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
window.startNewAgentSession = async function(agentId) {
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
    window.currentAgentId = agentId;

    // Render immediately to show empty chat
    renderChat();
    renderChatPage();

    // Switch gateway to new session
    currentSessionName = sessionKey;
    window.currentSessionName = currentSessionName; // Sync to window for other modules
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
window.startNewSession = async function() {
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
    window.populateSessionDropdown = function() {
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

window.filterSessionDropdown = function(query) {
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
            showToast('Gateway restarted successfully', 'success');
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
    } catch {}
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
    } catch {}
}

function getSidebarAgentsOrder() {
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
    } catch {}
}

function getSidebarAgentsContainer() {
    return document.getElementById('sidebar-agents-list');
}

function getSidebarAgentElements() {
    const container = getSidebarAgentsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.sidebar-agent[data-agent]'));
}

function applySidebarAgentsOrder() {
    const container = getSidebarAgentsContainer();
    if (!container) return;

    const order = getSidebarAgentsOrder();
    if (!order.length) return;

    const map = new Map();
    for (const el of getSidebarAgentElements()) {
        map.set(el.getAttribute('data-agent'), el);
    }

    // Append in saved order first
    for (const id of order) {
        const el = map.get(id);
        if (el) container.appendChild(el);
        map.delete(id);
    }

    // Append any new agents not in saved order
    for (const el of map.values()) {
        container.appendChild(el);
    }

    // Save normalized order (includes any new agents)
    const normalized = getSidebarAgentElements().map(el => el.getAttribute('data-agent'));
    setSidebarAgentsOrder(normalized);
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
        const agentId = match ? match[1] : 'main';
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

function setupSidebarAgentsDragAndDrop() {
    const els = getSidebarAgentElements();
    if (!els.length) return;

    // Add a drag handle (if not present) and make elements draggable
    for (const el of els) {
        el.setAttribute('draggable', 'true');
        el.classList.add('draggable');

        if (!el.querySelector('.agent-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'agent-drag-handle';
            handle.title = 'Drag to reorder';
            handle.textContent = '⠿';
            // Prevent handle clicks from triggering agent switch
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
            // Persist current DOM order
            const order = getSidebarAgentElements().map(x => x.getAttribute('data-agent'));
            setSidebarAgentsOrder(order);
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            const container = getSidebarAgentsContainer();
            if (!container) return;

            const draggedId = e.dataTransfer.getData('text/plain');
            const draggedEl = container.querySelector(`.sidebar-agent[data-agent="${CSS.escape(draggedId)}"]`);
            if (!draggedEl || draggedEl === el) return;

            // Insert dragged before drop target
            container.insertBefore(draggedEl, el);
        });
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
    try { localStorage.removeItem(SIDEBAR_AGENTS_ORDER_KEY); } catch {}
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

function resolveAvatarUrl(agentId) {
    // Main agent has a special avatar
    if (agentId === 'main') return '/avatars/solobot.png';
    // Others: try {id}.png, {id}.svg
    return `/avatars/${agentId}.png`;
}

function agentDisplayName(agent) {
    const id = agent.id || agent.name;
    const persona = (typeof AGENT_PERSONAS !== 'undefined') && AGENT_PERSONAS[id];
    if (persona) return `${persona.name} (${persona.role})`;
    if (agent.isDefault) return 'Halo (PA)';
    const name = agent.name || agent.id;
    return name.charAt(0).toUpperCase() + name.slice(1);
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
        const hasMain = agents.some(a => a.isDefault || a.id === 'main');
        const allAgents = hasMain ? agents : [{ id: 'main', name: 'main', emoji: '', isDefault: true }, ...agents];

        // Sort: default first, then by id
        allAgents.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return a.id.localeCompare(b.id);
        });

        container.innerHTML = allAgents.map(agent => {
            const avatarUrl = resolveAvatarUrl(agent.id);
            const displayName = agentDisplayName(agent);
            const emoji = agent.emoji || '';
            const fallbackInitial = (agent.name || agent.id).charAt(0).toUpperCase();

            return `
                <div class="sidebar-agent" data-agent="${agent.id}">
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

const skillsUi = {
    search: '',
    onlyIssues: false,
    onlyInstalled: true
};

function getHiddenSkills() {
    try { return JSON.parse(localStorage.getItem('hiddenSkills') || '[]'); } catch { return []; }
}

function setHiddenSkills(arr) {
    localStorage.setItem('hiddenSkills', JSON.stringify(arr));
}

function initSkillsPage() {
    bindSkillsPageControls();
    loadSkills();

    if (skillsInterval) clearInterval(skillsInterval);
    skillsInterval = setInterval(loadSkills, 60000);
}

function bindSkillsPageControls() {
    if (skillsPageBound) return;
    skillsPageBound = true;

    const search = document.getElementById('skills-search');
    const onlyIssues = document.getElementById('skills-only-issues');
    const refresh = document.getElementById('skills-refresh');

    if (search) {
        search.addEventListener('input', () => {
            skillsUi.search = (search.value || '').trim().toLowerCase();
            renderSkills();
        });
    }

    if (onlyIssues) {
        onlyIssues.addEventListener('change', () => {
            skillsUi.onlyIssues = Boolean(onlyIssues.checked);
            renderSkills();
        });
    }

    const onlyInstalled = document.getElementById('skills-only-installed');
    if (onlyInstalled) {
        onlyInstalled.checked = skillsUi.onlyInstalled;
        onlyInstalled.addEventListener('change', () => {
            skillsUi.onlyInstalled = Boolean(onlyInstalled.checked);
            renderSkills();
        });
    }

    const showHidden = document.getElementById('skills-show-hidden');
    if (showHidden) {
        showHidden.addEventListener('change', () => {
            skillsUi.showHidden = Boolean(showHidden.checked);
            renderSkills();
        });
    }

    if (refresh) {
        refresh.addEventListener('click', () => loadSkills());
    }
}

async function loadSkills() {
    const container = document.getElementById('skills-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div class="empty-state">Connect to gateway to view skills</div>';
        return;
    }

    try {
        // Prefer skills.status (rich, includes install options + requirements).
        // Fallback to skills.list for older gateways.
        let result;
        try {
            result = await gateway._request('skills.status', {});
            skillsList = result?.skills || [];
        } catch (e) {
            result = await gateway._request('skills.list', {});
            skillsList = result?.skills || result || [];
        }

        renderSkills();
    } catch (e) {
        console.warn('[Skills] Failed:', e.message);
        container.innerHTML = '<div class="empty-state">Could not load skills. The skills RPC may not be available.</div>';
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
            if (!skillsUi.onlyInstalled) return true;
            // "Installed" means actually usable: ready (no missing bins) AND eligible for this OS
            const missing = skill?.missing || {};
            const missingBins = (missing.bins?.length || 0) + (missing.anyBins?.length || 0);
            const missingOs = (missing.os || []).length > 0;
            if (missingOs || missingBins > 0) return false;
            return skill?.installed === true || skill?.bundled === true || skill?.enabled !== false;
        })
        .filter(skill => skillsUi.onlyIssues ? skillHasIssues(skill) : true)
        .filter(skill => {
            if (skillsUi.showHidden) return true;
            const hidden = getHiddenSkills();
            const key = skill?.skillKey || skill?.name || '';
            return !hidden.includes(key);
        })
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
        providerEl.textContent = state.provider || 'anthropic';
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

    // Init memory layout setting
    const layoutSel = document.getElementById('setting-memory-layout');
    if (layoutSel && window._memoryCards) layoutSel.value = window._memoryCards.getLayout();

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
        // Fallback
        document.getElementById('current-provider-display').textContent = 'anthropic';
        document.getElementById('current-model-display').textContent = 'anthropic/claude-opus-4-5';
        document.getElementById('setting-provider').value = 'anthropic';
        await updateModelDropdown('anthropic');
        
        // Set fallback model after dropdown is populated
        const settingModelSelect = document.getElementById('setting-model');
        if (settingModelSelect) {
            settingModelSelect.value = 'anthropic/claude-opus-4-5';
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
setInterval(syncActivitiesFromFile, 30000);
// Also sync on load
setTimeout(syncActivitiesFromFile, 2000);

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

function initCronPage() {
    loadCronJobs();
    if (cronInterval) clearInterval(cronInterval);
    cronInterval = setInterval(loadCronJobs, 30000);
}

async function loadCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div class="empty-state">Connect to gateway to manage cron jobs</div>';
        return;
    }

    try {
        const result = await gateway._request('cron.list', {});
        cronJobs = result?.jobs || result || [];
        renderCronJobs();
    } catch (e) {
        console.warn('[Cron] Failed to fetch jobs:', e.message);
        container.innerHTML = '<div class="empty-state">Could not load cron jobs. The cron RPC may not be available.</div>';
    }
}

function renderCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    if (cronJobs.length === 0) {
        container.innerHTML = '<div class="empty-state">No cron jobs configured</div>';
        return;
    }

    container.innerHTML = cronJobs.map((job, idx) => {
        const enabled = job.enabled !== false;
        const lastStatus = job.lastRunStatus || job.lastStatus || '--';
        const statusClass = lastStatus === 'success' ? 'success' : lastStatus === 'error' ? 'error' : '';
        const nextRun = job.nextRun ? new Date(job.nextRun).toLocaleString() : '--';
        const lastRun = job.lastRun ? timeAgo(new Date(job.lastRun).getTime()) : 'Never';

        return `
        <div class="cron-job-card" style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: 600; font-size: 14px;">${escapeHtml(job.name || job.id || 'Unnamed Job')}</span>
                        ${!enabled ? '<span class="badge" style="background: var(--surface-2); font-size: 10px;">Disabled</span>' : ''}
                        ${statusClass ? `<span class="badge badge-${statusClass}" style="font-size: 10px;">${lastStatus}</span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                        <code style="background: var(--surface-2); padding: 1px 4px; border-radius: 3px; font-size: 11px;">${escapeHtml(job.schedule || job.cron || '--')}</code>
                        <span style="margin-left: 8px;">Next: ${nextRun}</span>
                        <span style="margin-left: 8px;">Last: ${lastRun}</span>
                    </div>
                    ${job.description ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(job.description)}</div>` : ''}
                </div>
                <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                    <button onclick="toggleCronJob('${job.id || idx}', ${!enabled})" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="${enabled ? 'Disable' : 'Enable'}">
                        ${enabled ? '⏸' : '▶'}
                    </button>
                    <button onclick="runCronJob('${job.id || idx}')" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="Run Now">
                        🚀
                    </button>
                    <button onclick="showCronHistory('${job.id || idx}')" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="History">
                        📋
                    </button>
                </div>
            </div>
            <div id="cron-history-${job.id || idx}" class="cron-history hidden" style="margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 8px;"></div>
        </div>`;
    }).join('');
}

async function toggleCronJob(jobId, enable) {
    try {
        await gateway._request('cron.toggle', { id: jobId, enabled: enable });
        showToast(`Job ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function runCronJob(jobId) {
    try {
        await gateway._request('cron.run', { id: jobId });
        showToast('Job triggered', 'success');
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function showCronHistory(jobId) {
    const el = document.getElementById(`cron-history-${jobId}`);
    if (!el) return;
    if (!el.classList.contains('hidden')) {
        el.classList.add('hidden');
        return;
    }

    el.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">Loading...</div>';
    el.classList.remove('hidden');

    try {
        const result = await gateway._request('cron.runs', { id: jobId, limit: 10 });
        const runs = result?.runs || [];
        if (runs.length === 0) {
            el.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">No run history</div>';
            return;
        }
        el.innerHTML = runs.map(r => {
            const status = r.status || 'unknown';
            const time = r.startedAt ? new Date(r.startedAt).toLocaleString() : '--';
            const cls = status === 'success' ? 'color: var(--success)' : status === 'error' ? 'color: var(--error)' : '';
            return `<div style="font-size: 11px; padding: 2px 0;"><span style="${cls}">${status}</span> — ${time}${r.duration ? ` (${r.duration}ms)` : ''}</div>`;
        }).join('');
    } catch (e) {
        el.innerHTML = '<div style="font-size: 11px; color: var(--error);">Failed to load history</div>';
    }
}

window.openAddCronModal = function() {
    const modal = document.getElementById('add-cron-modal');
    if (modal) modal.classList.add('visible');
};

window.closeAddCronModal = function() {
    const modal = document.getElementById('add-cron-modal');
    if (modal) modal.classList.remove('visible');
};

window.submitNewCronJob = async function() {
    const name = document.getElementById('cron-new-name')?.value?.trim();
    const schedule = document.getElementById('cron-new-schedule')?.value?.trim();
    const command = document.getElementById('cron-new-command')?.value?.trim();

    if (!name || !schedule) {
        showToast('Name and schedule are required', 'warning');
        return;
    }

    try {
        await gateway._request('cron.add', { name, schedule, command });
        showToast('Cron job added', 'success');
        closeAddCronModal();
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

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

// Test a single model using the EXACT same code path as regular chat
// Uses gateway.sendTestMessage() which is identical to sendMessage() but with a model override
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
        
        console.log(`[Health] Testing model ${modelId} using SAME path as chat`);
        
        // Use the SAME method as chat.send but with model override
        // This goes through the exact same WebSocket, auth, and routing
        const result = await gateway.sendTestMessage('Respond with exactly: OK', modelId);
        
        // The response will come back as a chat event (same as normal chat)
        // We wait for it using the same mechanism that handles regular chat responses
        const latencyMs = Date.now() - startTime;
        
        return {
            success: true,
            runId: result?.runId,
            latencyMs,
            note: 'Response will arrive via chat event (same as regular chat)'
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
window.runAllModelTests = async function() {
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
        const provider = model.id.split('/')[0] || 'unknown';
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
window.testSingleModelUI = async function(modelId) {
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
    window.showPage = function(pageName, updateURL = true) {
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
// js/chat.js — Chat event handling, message rendering, voice input, image handling

// Make chatLog globally available
const CHAT_DEBUG = false;
window.chatLog = function(...args) { if (CHAT_DEBUG) console.log(...args); }
function chatLog(...args) { if (CHAT_DEBUG) console.log(...args); }

function linkifyText(text) {
    if (!text) return '';
    const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
    return parts.map((part, i) => {
        if (i % 2 === 1) {
            return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        let safe = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        safe = safe.replace(/(^|["'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
        return safe.replace(/\n/g, '<br>');
    }).join('');
}

// ===================
// VOICE INPUT (Web Speech API)
// ===================

let voiceRecognition = null;
let voiceInputState = 'idle';
let voiceAutoSend = localStorage.getItem('voice_auto_send') === 'true';
let lastVoiceTranscript = '';
let accumulatedTranscript = '';

function initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btns = [document.getElementById('voice-input-btn'), document.getElementById('voice-input-btn-chatpage')];

    if (!SpeechRecognition) {
        btns.forEach(btn => {
            if (btn) { btn.disabled = true; btn.title = 'Voice input not supported'; btn.innerHTML = '🎤✗'; }
        });
        return;
    }

    if (btns.every(b => !b)) return;

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
        setVoiceState('listening');
        const input = document.getElementById(activeVoiceTarget);
        if (input) { input.focus(); input.placeholder = 'Listening...'; if (accumulatedTranscript) input.value = accumulatedTranscript; }
    };

    voiceRecognition.onaudiostart = () => { };
    voiceRecognition.onsoundstart = () => { };
    voiceRecognition.onspeechstart = () => {
        const input = document.getElementById(activeVoiceTarget);
        if (input) input.placeholder = 'Hearing you...';
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

        const displayText = accumulatedTranscript + interimTranscript;
        if (targetInput) {
            targetInput.value = displayText;
            if (interimTranscript) { targetInput.style.fontStyle = 'italic'; targetInput.style.color = 'var(--text-secondary)'; }
            else if (finalTranscript) { targetInput.style.fontStyle = 'normal'; targetInput.style.color = 'var(--text-primary)'; }
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.focus();
            if (targetInput.setSelectionRange) targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length);
        }
        if (finalTranscript) lastVoiceTranscript = finalTranscript;
    };

    voiceRecognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error);
        if (event.error === 'not-allowed') { setVoiceState('idle'); showToast('Microphone access denied.', 'error'); }
        else if (event.error === 'no-speech') { chatLog('[Voice] No speech detected'); }
        else if (event.error === 'audio-capture') { setVoiceState('idle'); showToast('No microphone found.', 'error'); }
        else if (event.error === 'network') { setVoiceState('idle'); showToast('Network error.', 'error'); }
        else if (event.error !== 'aborted') { setVoiceState('idle'); showToast(`Voice error: ${event.error}`, 'error'); }
    };

    voiceRecognition.onend = () => {
        ['chat-input', 'chat-page-input'].forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) { input.style.fontStyle = 'normal'; input.style.color = 'var(--text-primary)'; input.placeholder = inputId === 'chat-input' ? 'Type a message...' : 'Message SoLoBot...'; }
        });

        if (voiceAutoSend && accumulatedTranscript.trim()) {
            if (activeVoiceTarget === 'chat-page-input') sendChatPageMessage();
            else sendChatMessage();
            accumulatedTranscript = '';
            const input = document.getElementById(activeVoiceTarget);
            if (input) input.value = '';
        }
        setVoiceState('idle');
        activeVoiceTarget = 'chat-input';
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
    activeVoiceTarget = 'chat-page-input';
    toggleVoiceInput();
}

// Override the original toggleVoiceInput to use the sidebar input
const originalToggleVoiceInput = toggleVoiceInput;
function toggleVoiceInput() {
    // If called directly (not via chat page), target sidebar
    // Only set to chat-input if we're starting a NEW recording
    if (activeVoiceTarget !== 'chat-page-input' && voiceInputState !== 'listening') {
        activeVoiceTarget = 'chat-input';
    }

    if (!voiceRecognition) {
        showToast('Voice input not available', 'error');
        return;
    }

    if (voiceInputState === 'listening') {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }

    // Don't reset target here - it should persist until onend resets it
}

// ===================
// IMAGE HANDLING
// ===================

let pendingImages = [];

function handleImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) processImageFile(file);
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

function handleChatInputKeydown(event) {
    const input = event.target;
    if (event.key !== 'Enter' || !input) return;
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); sendChatMessage(); return; }
    if (event.shiftKey) {
        event.preventDefault();
        const start = input.selectionStart;
        const value = input.value;
        input.value = `${value.slice(0, start)}\n${value.slice(start)}`;
        input.setSelectionRange(start + 1, start + 1);
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
    const len = input.value.length;
    input.setSelectionRange(Math.min(chatInputSelection.start ?? len, len), Math.min(chatInputSelection.end ?? len, len));
}

function adjustChatInputHeight(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 36), 160)}px`;
}

function attachChatInputHandlers() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.addEventListener('keydown', handleChatInputKeydown);
    input.addEventListener('blur', () => cacheChatInputSelection(input));
    input.addEventListener('focus', () => { restoreChatInputSelection(input); adjustChatInputHeight(input); });
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
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
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
    const imagesToSend = [...pendingImages];
    const hasImages = imagesToSend.length > 0;

    // Add to local display
    if (hasImages) {
        // Show all images in local preview
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        const imageDataArray = imagesToSend.map(img => img.data);
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
        if (hasImages) {
            // Send with image attachments (send all images)
            const imageDataArray = imagesToSend.map(img => img.data);
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send message:', err);
        addLocalChatMessage(`Failed to send: ${err.message}`, 'system');
    }
}

function addLocalChatMessage(text, from, imageOrModel = null, model = null) {
    // DEFENSIVE: Hard session gate - validate incoming messages match current session
    // Check if this message already has a session tag from outside
    const incomingSession = (imageOrModel?._sessionKey || '').toLowerCase();
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
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now(),
        image: images[0] || null, // Legacy single image field
        images: images, // New array field
        model: messageModel, // Store which AI model generated this response
        _sessionKey: currentSessionName || GATEWAY_CONFIG?.sessionKey || '' // Tag with session to prevent cross-session bleed
    };

    const isSystem = isSystemMessage(text, from);

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
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: state.chat.messages.slice(-100) })
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

    const messages = state.chat?.messages || [];
    const isConnected = gateway?.isConnected();

    // Save scroll state BEFORE clearing
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 5;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

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
        if (msgSession && activeKey && msgSession !== activeKey) {
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
            isStreaming: true
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }

    // Show typing indicator when processing but no streaming text yet
    if (isProcessing && !streamingText) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">Thinking...</span>
        `;
        container.appendChild(typingIndicator);
    }

    // Auto-scroll if was at bottom, otherwise maintain position
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        // Restore position by maintaining same distance from bottom
        container.scrollTop = container.scrollHeight - container.clientHeight - distanceFromBottom;
    }
}

function createChatMessageElement(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;

    const isUser = msg.from === 'user';
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
        const displayName = getAgentDisplayName(currentAgentId);
        nameSpan.textContent = msg.isStreaming ? `${displayName} (typing...)` : displayName;
    }

    const timeSpan = document.createElement('span');
    timeSpan.style.color = 'var(--text-muted)';
    timeSpan.textContent = formatTime(msg.time);

    header.appendChild(nameSpan);
    header.appendChild(timeSpan);

    // Provider/Model badge - shows full provider/model (e.g., "ollama/qwen2.5:14b", "openai/gpt-4o")
    if (!isUser && !isSystem && msg.model) {
        const providerModelSpan = document.createElement('span');
        providerModelSpan.style.cssText = 'font-size: 10px; color: var(--text-secondary); font-family: monospace; background: var(--surface-3); padding: 1px 4px; border-radius: 3px; margin-left: 4px;';
        providerModelSpan.textContent = msg.model;
        providerModelSpan.title = msg.model;
        header.appendChild(providerModelSpan);
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

    const messages = state.chat?.messages || [];

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
    // Save distance from bottom (how far up the user has scrolled)
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

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
            if (msgSession && activeKeyCP && msgSession !== activeKeyCP) {
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
            isStreaming: true
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }

    // Show typing indicator when processing but no streaming text yet
    if (isProcessing && !streamingText) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.style.cssText = 'margin: 12px 0 12px 12px;';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">Thinking...</span>
        `;
        container.appendChild(typingIndicator);
    }

    // Smart scroll behavior - only auto-scroll if user was truly at the bottom
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = container.scrollHeight - container.clientHeight - distanceFromBottom;
    }
}

// Create a chat page message element (different styling from widget)
function createChatPageMessage(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;

    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';
    const isBot = !isUser && !isSystem;

    // Message wrapper
    const wrapper = document.createElement('div');
    wrapper.className = `chat-page-message ${msg.from}${msg.isStreaming ? ' streaming' : ''}`;
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
            const agentId = currentAgentId || 'main';
            avatar.setAttribute('data-agent', agentId);

            // Get avatar path (fallback to main for agents without custom avatars)
            const avatarPath = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'family', 'smm'].includes(agentId)
                ? `/avatars/${agentId === 'main' ? 'solobot' : agentId}.png`
                : (agentId === 'tax' || agentId === 'sec')
                    ? `/avatars/${agentId}.svg`
                    : '/avatars/solobot.png';

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
        const displayName = getAgentDisplayName(currentAgentId);
        sender.textContent = msg.isStreaming ? `${displayName} is typing...` : displayName;
    }

    const time = document.createElement('span');
    time.className = 'chat-page-bubble-time';
    time.textContent = formatSmartTime(msg.time);
    time.title = formatTime(msg.time); // Show exact time on hover

    header.appendChild(sender);
    header.appendChild(time);

    // Provider/Model badge for bot messages - shows full provider/model ID
    if (isBot && msg.model) {
        const providerModelSpan = document.createElement('span');
        providerModelSpan.className = 'chat-page-provider-model';
        providerModelSpan.style.cssText = 'font-size: 10px; color: var(--text-secondary); font-family: monospace; background: var(--surface-3); padding: 1px 5px; border-radius: 3px; margin-left: 4px;';
        providerModelSpan.textContent = msg.model;
        providerModelSpan.title = msg.model;
        header.appendChild(providerModelSpan);
    }
    bubble.appendChild(header);

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
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
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

    currentAgentId = agentId;
    const agentNameEl = document.getElementById('chat-page-agent-name');
    if (agentNameEl) {
        agentNameEl.textContent = getAgentLabel(agentId);
    }
}

// Track last-used session per agent (persisted to localStorage)
function getLastAgentSession(agentId) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        return map[agentId] || null;
    } catch { return null; }
}

function saveLastAgentSession(agentId, sessionKey) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        map[agentId] = sessionKey;
        localStorage.setItem('agent_last_sessions', JSON.stringify(map));
    } catch { }
}

function setupSidebarAgents() {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    if (!agentEls.length) return;

    const activateAgentFromEl = (el) => {
        const agentId = el.getAttribute('data-agent');
        if (!agentId) return;

        // IMMEDIATE UI feedback - show active state before switch completes
        forceSyncActiveAgent(agentId);

        // Update current agent ID first so dropdown filters correctly
        currentAgentId = agentId;

        // Restore last session for this agent, or default to main
        const sessionKey = getLastAgentSession(agentId) || `agent:${agentId}:main`;
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
        currentAgentId = match[1];
        setActiveSidebarAgent(match[1]);
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

    const imagesToSend = [...chatPagePendingImages];
    const hasImages = imagesToSend.length > 0;

    if (hasImages) {
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        const imageDataArray = imagesToSend.map(img => img.data);
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
            const imageDataArray = imagesToSend.map(img => img.data);
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send:', err);
        addLocalChatMessage(`Failed: ${err.message}`, 'system');
        renderChat();
        renderChatPage();
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




