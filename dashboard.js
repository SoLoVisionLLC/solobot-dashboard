// SoLoVision Command Center Dashboard
// Version: 3.0.0 - Unified Chat with Web UI

// ===================
// STATE MANAGEMENT
// ===================

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
        messages: [],
        sessionId: null // Track which session we're synced to
    },
    pendingChat: null
};

// Session sync configuration
const SESSION_SYNC = {
    apiUrl: 'http://51.81.202.92:3456/api',
    currentSessionKey: 'agent:main:main', // Default to main session
    syncInterval: 3000, // Sync every 3 seconds
    maxMessages: 100 // Keep last 100 messages
};

// Unified chat system
const CHAT_SYSTEM = {
    // Messages are synced via the VPS API state
    // Both web UI and dashboard read/write to the same state.chat object
    messageQueue: [],
    lastSyncTime: 0
};

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set();
let editingTaskId = null;
let currentModalTask = null;
let currentModalColumn = null;
let refreshIntervalId = null;

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

// ===================
// SESSION CHAT SYNC
// ===================

// Unified chat system - just display ALL messages from the shared stream
async function syncUnifiedChat() {
    try {
        // Simply render whatever is in the shared state
        // Both web UI and dashboard show the same message stream
        if (state.chat && state.chat.messages) {
            renderChat();
        }
    } catch (error) {
        console.error('Chat sync error:', error);
    }
}

// Send message through the sync API
async function sendChatMessageUnified(text) {
    try {
        // Add message to local state first
        addLocalChatMessage(text, 'user');
        
        // Set pending chat for SoLoBot to pick up
        state.pendingChat = {
            text,
            time: Date.now(),
            from: 'user'
        };
        
        // Save state to trigger SoLoBot response
        saveState(`Chat: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''}`);
        
        return true;
    } catch (error) {
        console.error('Failed to send chat message:', error);
        return false;
    }
}

// ===================
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    render();
    updateLastSync();
    
    // Simple scroll handling - only auto-scroll if user is at bottom
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        // Store reference for renderChat
        chatContainer._wasAtBottom = true;
    }
    
    // Start unified chat sync
    setInterval(syncUnifiedChat, SESSION_SYNC.syncInterval);
    
    // Initial chat sync
    await syncUnifiedChat();
    
    // Auto-refresh state from VPS
    setInterval(async () => {
        try {
            await loadState();
            render();
            updateLastSync();
            
            // Flash sync indicator
            const syncEl = document.getElementById('last-sync');
            if (syncEl) {
                syncEl.style.color = '#22d3ee';
                setTimeout(() => syncEl.style.color = '', 300);
            }
        } catch (e) {
            console.error('Auto-refresh error:', e);
        }
    }, 3000);
    
    // Enter key handlers
    document.getElementById('note-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addNote();
    });
    
    document.getElementById('new-task-title').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitTask();
    });
    
    // Docs search
    document.getElementById('docs-search').addEventListener('input', (e) => {
        renderDocs(e.target.value);
    });
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.task-menu') && !e.target.closest('.task-menu-btn')) {
            closeAllTaskMenus();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAddTask();
            closeAllTaskMenus();
            closeActionModal();
            closeEditTitleModal();
            closeDeleteModal();
            clearSelection();
        }
        if (e.ctrlKey && e.key === 'a' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            selectAllTasks();
        }
    });
    
    // Enter key for edit title modal
    document.getElementById('edit-title-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveEditedTitle();
    });
});

// ===================
// DATA PERSISTENCE
// ===================

async function loadState() {
    // Load from VPS first
    try {
        const response = await fetch('http://51.81.202.92:3456/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            if (!vpsState.tasks) vpsState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!vpsState.tasks.archive) vpsState.tasks.archive = [];
            if (!vpsState.chat) vpsState.chat = { messages: [] };
            state = { ...state, ...vpsState };
            delete state.localModified;
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            console.log('Loaded state from VPS');
            return;
        }
    } catch (e) {
        console.log('VPS not available:', e.message);
    }
    
    // Fallback: localStorage
    const localSaved = localStorage.getItem('solovision-dashboard');
    if (localSaved) {
        state = { ...state, ...JSON.parse(localSaved) };
        console.log('Loaded state from localStorage');
    } else {
        initSampleData();
    }
}

const SYNC_API = 'http://51.81.202.92:3456/api/sync';

async function saveState(changeDescription = null) {
    state.localModified = Date.now();
    if (changeDescription) {
        state.lastChange = changeDescription;
    }
    
    localStorage.setItem('solovision-dashboard', JSON.stringify(state));
    updateLastSync();
    
    // Sync to server
    syncToServer();
}

async function syncToServer() {
    try {
        const response = await fetch(SYNC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        
        if (response.ok) {
            console.log('Synced to server');
            if (state.console && state.console.logs) {
                state.console.logs.push({
                    text: 'State synced to server',
                    type: 'info',
                    time: Date.now()
                });
                if (state.console.logs.length > 100) {
                    state.console.logs = state.console.logs.slice(-100);
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
        done: []
    };
    state.notes = [];
    state.activity = [];
    state.docs = [];
    state.chat = { messages: [] };
    saveState();
}

// ===================
// CHAT FUNCTIONS (UPDATED)
// ===================

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    // Send through unified chat system
    await sendChatMessageUnified(text);
    
    input.value = '';
}

function addLocalChatMessage(text, from) {
    if (!state.chat) state.chat = { messages: [] };
    
    const message = {
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now()
    };
    
    state.chat.messages.push(message);
    
    // Keep only last N messages
    if (state.chat.messages.length > SESSION_SYNC.maxMessages) {
        state.chat.messages = state.chat.messages.slice(-SESSION_SYNC.maxMessages);
    }
    
    renderChat();
}

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    if (!state.chat || !state.chat.messages || state.chat.messages.length === 0) {
        container.innerHTML = `
            <div class="text-gray-500 text-sm text-center py-8">
                💬 Chat with SoLoBot directly. Messages sync with web UI.
            </div>
        `;
        return;
    }
    
    // Check if user is at bottom before rendering
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const wasAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
    
    container.innerHTML = state.chat.messages.map(msg => {
        const isUser = msg.from === 'user';
        const timeStr = formatTime(msg.time);
        const bgClass = isUser ? 'bg-solo-primary/20 ml-8' : 'bg-slate-700 mr-8';
        const alignClass = isUser ? 'text-right' : 'text-left';
        const nameClass = isUser ? 'text-solo-primary' : msg.isTool ? 'text-yellow-400' : 'text-green-400';
        const name = isUser ? 'You' : msg.isTool ? '🔧 Action' : '🤖 SoLoBot';
        
        // Format message with markdown-like support (same as web UI)
        let formattedText = msg.text
            // Headers
            .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-gray-200 mb-2">$1</h3>')
            .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-gray-100 mb-3">$1</h2>')
            .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-white mb-4">$1</h1>')
            // Bold
            .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gray-100 font-semibold">$1</strong>')
            // Italic
            .replace(/\*(.+?)\*/g, '<em class="text-gray-300">$1</em>')
            // Code blocks
            .replace(/```([\s\S]*?)```/g, '<pre class="bg-slate-800 p-3 rounded-lg text-sm overflow-x-auto my-3 border border-slate-600"><code class="text-green-400 font-mono">$1</code></pre>')
            // Inline code
            .replace(/`(.+?)`/g, '<code class="bg-slate-700 px-1.5 py-0.5 rounded text-sm text-cyan-400 font-mono">$1</code>')
            // Lists - handle both * and - bullets
            .replace(/^[*-] (.+)$/gm, '<li class="ml-4 text-gray-200 list-disc">$1</li>')
            // Fix orphaned list items by wrapping in ul
            .replace(/(<li>.*<\/li>)/s, '<ul class="my-2">$1</ul>')
            // Line breaks - preserve paragraph structure
            .replace(/\n\n/g, '</div><div class="mt-3">')
            .replace(/^/gm, '<div>')
            .replace(/$/gm, '</div>')
            // Clean up empty divs
            .replace(/<div><\/div>/g, '')
            // Links
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-solo-primary hover:text-solo-accent underline">$1</a>');
        
        return `
            <div class="${bgClass} rounded-lg p-3 ${alignClass} message-item" data-time="${msg.time}">
                <div class="flex items-center gap-2 mb-2 ${isUser ? 'justify-end' : ''}">
                    <span class="text-xs ${nameClass} font-medium">${name}</span>
                    <span class="text-xs text-gray-500">${timeStr}</span>
                </div>
                <div class="text-sm text-gray-200 leading-relaxed ${msg.isTool ? 'font-mono' : ''}">${formattedText}</div>
            </div>
        `;
    }).join('');
    
    // Only auto-scroll if user was already at bottom
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

// ===================
// RENDERING (OTHER FUNCTIONS REMAIN THE SAME)
// ===================

function render() {
    renderStatus();
    renderConsole();
    renderTasks();
    renderNotes();
    renderActivity();
    renderDocs();
    renderChat();
    renderBulkActionBar();
    updateArchiveBadge();
}

function renderStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const modelEl = document.getElementById('model-name');
    const taskEl = document.getElementById('current-task');
    const taskName = document.getElementById('task-name');
    const subagentBanner = document.getElementById('subagent-banner');
    const subagentTask = document.getElementById('subagent-task');
    
    indicator.className = 'w-3 h-3 rounded-full';
    switch(state.status) {
        case 'working':
            indicator.classList.add('bg-green-500', 'status-pulse');
            text.textContent = 'WORKING';
            break;
        case 'thinking':
            indicator.classList.add('bg-yellow-500', 'status-pulse');
            text.textContent = 'THINKING';
            break;
        case 'offline':
            indicator.classList.add('bg-red-500');
            text.textContent = 'OFFLINE';
            break;
        default:
            indicator.classList.add('bg-green-500');
            text.textContent = 'IDLE';
    }
    
    modelEl.textContent = state.model || 'opus 4.5';
    
    const providerEl = document.getElementById('provider-name');
    if (providerEl) {
        providerEl.textContent = state.provider || 'anthropic';
    }
    
    if (state.currentTask) {
        taskEl.classList.remove('hidden');
        taskName.textContent = state.currentTask;
    } else {
        taskEl.classList.add('hidden');
    }
    
    if (state.subagent) {
        subagentBanner.classList.remove('hidden');
        subagentTask.textContent = state.subagent;
    } else {
        subagentBanner.classList.add('hidden');
    }
}

function renderConsole() {
    const live = state.live || { status: 'idle' };
    const consoleData = state.console || { logs: [] };
    
    const statusBadge = document.getElementById('console-status-badge');
    if (statusBadge) {
        const statusConfig = {
            'working': { text: 'WORKING', color: 'bg-green-500/20 text-green-400' },
            'thinking': { text: 'THINKING', color: 'bg-yellow-500/20 text-yellow-400' },
            'idle': { text: 'IDLE', color: 'bg-blue-500/20 text-blue-400' },
            'offline': { text: 'OFFLINE', color: 'bg-gray-500/20 text-gray-400' }
        };
        const config = statusConfig[live.status] || statusConfig['idle'];
        statusBadge.textContent = config.text;
        statusBadge.className = `text-xs px-2 py-0.5 rounded-full ${config.color} font-mono`;
    }
    
    const output = document.getElementById('console-output');
    if (output && consoleData.logs && consoleData.logs.length > 0) {
        output.innerHTML = consoleData.logs.map(log => {
            const timeStr = formatTimeShort(log.time);
            const colorClass = getLogColor(log.type);
            const prefix = getLogPrefix(log.type);
            return `<div class="${colorClass}"><span class="text-gray-600">[${timeStr}]</span> ${prefix}${escapeHtml(log.text)}</div>`;
        }).join('');
        
        output.scrollTop = output.scrollHeight;
    }
}

function renderTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        const container = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
        const count = document.getElementById(`${column === 'progress' ? 'progress' : column}-count`);
        
        container.innerHTML = state.tasks[column].map((task, index) => {
            const isSelected = selectedTasks.has(task.id);
            return `
            <div class="task-card bg-solo-dark rounded-lg p-3 priority-p${task.priority} ${isSelected ? 'ring-2 ring-solo-accent' : ''} transition group relative cursor-grab hover:bg-slate-700/50 active:cursor-grabbing" 
                 data-task-id="${task.id}" data-column="${column}"
                 draggable="true"
                 ondragstart="handleDragStart(event, '${task.id}', '${column}')"
                 ondragend="handleDragEnd(event)"
                 onclick="openActionModal('${task.id}', '${column}')">
                <div class="flex items-start gap-3">
                    <input type="checkbox" 
                           class="mt-1 w-4 h-4 rounded border-slate-500 bg-solo-darker text-solo-primary focus:ring-solo-primary cursor-pointer"
                           ${isSelected ? 'checked' : ''}
                           onclick="toggleTaskSelection('${task.id}', event)">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                            <span class="text-sm ${column === 'done' ? 'line-through text-gray-500' : ''}">${escapeHtml(task.title)}</span>
                            <div class="flex items-center gap-1">
                                <span class="text-xs px-1.5 py-0.5 rounded ${getPriorityClass(task.priority)}">P${task.priority}</span>
                            </div>
                        </div>
                        <div class="text-xs text-gray-500 mt-1">#${index + 1} • ${formatTime(task.created)}</div>
                    </div>
                </div>
                
                <div class="task-quick-actions absolute -right-2 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition flex flex-col gap-1">
                    ${column !== 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'done', event)" 
                                class="w-8 h-8 bg-green-600 hover:bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg"
                                title="Mark Done">✓</button>
                    ` : ''}
                    ${column === 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'todo', event)" 
                                class="w-8 h-8 bg-slate-600 hover:bg-slate-500 rounded-full flex items-center justify-center text-white shadow-lg"
                                title="Reopen">↩</button>
                    ` : ''}
                </div>
            </div>
        `}).join('');
        
        count.textContent = state.tasks[column].length;
    });
}

function renderNotes() {
    const container = document.getElementById('notes-list');
    container.innerHTML = state.notes.map(note => `
        <div class="bg-solo-dark rounded-lg p-3 ${note.seen ? 'opacity-60' : ''}">
            <div class="flex items-start justify-between">
                <span class="text-sm">${escapeHtml(note.text)}</span>
                ${note.seen ? '<span class="text-xs text-green-500">✓ Seen</span>' : '<span class="text-xs text-yellow-500">Pending</span>'}
            </div>
            <div class="text-xs text-gray-500 mt-2">${formatTime(note.created)}</div>
        </div>
    `).join('');
}

function renderActivity() {
    const container = document.getElementById('activity-log');
    container.innerHTML = state.activity.slice().reverse().slice(0, 20).map(entry => `
        <div class="flex items-start gap-3 text-sm">
            <span class="text-gray-500 whitespace-nowrap">${formatTime(entry.time)}</span>
            <span class="${entry.type === 'success' ? 'text-green-400' : entry.type === 'error' ? 'text-red-400' : 'text-gray-300'}">
                ${escapeHtml(entry.action)}
            </span>
        </div>
    `).join('');
}

function renderDocs(filter = '') {
    const container = document.getElementById('docs-grid');
    const filtered = state.docs.filter(doc => 
        doc.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    container.innerHTML = filtered.map(doc => `
        <a href="${doc.url}" target="_blank" class="bg-solo-card rounded-lg p-4 hover:bg-slate-700 transition block">
            <div class="flex items-center gap-3 mb-2">
                ${getDocIcon(doc.type)}
                <span class="font-medium truncate">${escapeHtml(doc.name)}</span>
            </div>
            <div class="text-xs text-gray-500">Updated: ${formatDate(doc.updated)}</div>
        </a>
    `).join('');
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-sm col-span-full">No documents found</div>';
    }
}

// ===================
// UTILITY FUNCTIONS
// ===================

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
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
    if (p === 0) return 'bg-red-500/20 text-red-400';
    if (p === 1) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-blue-500/20 text-blue-400';
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

function getDocIcon(type) {
    if (type === 'doc') return '<svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>';
    if (type === 'pdf') return '<svg class="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>';
    return '<svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>';
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
    
    if (state.activity.length > 100) {
        state.activity = state.activity.slice(-100);
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

// ===================
// PUBLIC API
// ===================

window.dashboardAPI = {
    setStatus: (status, task) => {
        state.status = status;
        state.currentTask = task;
        saveState();
        render();
    },
    setSubagent: (task) => {
        state.subagent = task;
        saveState();
        render();
    },
    addActivity: (action, type) => {
        addActivity(action, type);
        saveState();
        render();
    },
    addConsoleLog: (text, type) => {
        if (!state.console) state.console = { logs: [] };
        if (!state.console.logs) state.console.logs = [];
        
        state.console.logs.push({
            text,
            type,
            time: Date.now()
        });
        
        if (state.console.logs.length > 100) {
            state.console.logs = state.console.logs.slice(-100);
        }
        
        saveState();
        renderConsole();
    },
    markNoteSeen: (noteId) => {
        const note = state.notes.find(n => n.id === noteId);
        if (note) {
            note.seen = true;
            note.seenAt = Date.now();
            saveState();
            renderNotes();
        }
    },
    getState: () => state,
    setState: (newState) => {
        state = { ...state, ...newState };
        saveState();
        render();
    }
};