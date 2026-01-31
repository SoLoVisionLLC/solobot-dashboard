// SoLoVision Command Center Dashboard
// Version: 2.8.0 - Real-time VPS Sync

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
    pendingNotify: null,  // Set when task moves to In Progress - triggers SoLoBot pickup
    live: {
        status: 'idle',      // idle, working, thinking, offline
        task: null,          // Current task description
        taskStarted: null,   // Timestamp when task started
        thoughts: [],        // Recent thoughts/actions [{text, time}]
        lastActive: null,    // Last activity timestamp
        tasksToday: 0        // Count of tasks completed today
    },
    console: {
        logs: [],            // Console log entries [{text, type, time}]
        expanded: false      // Is console expanded
    },
    chat: {
        messages: []         // Chat messages [{id, from, text, time}]
    },
    pendingChat: null        // Pending chat message for SoLoBot to respond to
};

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set(); // Track selected task IDs
let editingTaskId = null; // Currently editing task
let currentModalTask = null; // Task being edited in modal
let currentModalColumn = null; // Column of task being edited
let refreshIntervalId = null; // Auto-refresh timer

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
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    render();
    updateLastSync();
    
    // Auto-refresh every 3 seconds (pulls from VPS) - LIVE DASHBOARD
    setInterval(async () => {
        try {
            await loadState();
            render();
            updateLastSync();
            // Flash the sync indicator
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
        // Ctrl+A to select all visible tasks
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
    // ALWAYS load from VPS first (SoLoBot's source of truth)
    try {
        const response = await fetch('http://51.81.202.92:3456/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            // Ensure required arrays exist
            if (!vpsState.tasks) vpsState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!vpsState.tasks.archive) vpsState.tasks.archive = [];
            state = { ...state, ...vpsState };
            // Save to localStorage (without localModified so VPS stays authoritative)
            delete state.localModified;
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            console.log('Loaded state from VPS');
            return;
        }
    } catch (e) {
        console.log('VPS not available:', e.message);
    }
    
    // Fallback: try local state.json
    try {
        const response = await fetch('data/state.json?' + Date.now());
        if (response.ok) {
            const serverState = await response.json();
            if (!serverState.tasks) serverState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!serverState.tasks.archive) serverState.tasks.archive = [];
            state = { ...state, ...serverState };
            console.log('Loaded state from local file');
            return;
        }
    } catch (e) {
        console.log('Local state not available');
    }
    
    // Final fallback: localStorage
    const localSaved = localStorage.getItem('solovision-dashboard');
    if (localSaved) {
        state = { ...state, ...JSON.parse(localSaved) };
        console.log('Loaded state from localStorage');
    } else {
        initSampleData();
    }
}

// Fetch live Moltbot logs from VPS sync API
async function fetchConsoleLogs() {
    try {
        const response = await fetch('http://51.81.202.92:3456/api/state', {
            cache: 'no-store'  // Bypass cache without query string (VPS doesn't handle query params)
        });
        if (response.ok) {
            const vpsState = await response.json();
            if (vpsState.console && vpsState.console.logs) {
                state.console = vpsState.console;
                console.log('Loaded console logs from VPS:', vpsState.console.logs.length, 'entries');
            }
            if (vpsState.live) {
                state.live = { ...state.live, ...vpsState.live };
            }
        }
    } catch (e) {
        console.log('Could not fetch VPS console logs:', e.message);
    }
}

const SYNC_API = 'http://51.81.202.92:3456/api/sync';

async function saveState(changeDescription = null) {
    // Mark state as locally modified
    state.localModified = Date.now();
    if (changeDescription) {
        state.lastChange = changeDescription;
    }
    
    // Save locally first (fast)
    localStorage.setItem('solovision-dashboard', JSON.stringify(state));
    updateLastSync();
    
    // Sync to server (async, don't block)
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
            // Add console log entry
            if (state.console && state.console.logs) {
                // Don't call addConsoleLog to avoid infinite loop
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
        } else {
            console.error('Sync failed:', response.status);
        }
    } catch (err) {
        console.error('Sync error:', err);
        // Silently fail - local state is saved
    }
}

function resetToServerState() {
    // Clear local modifications and reload from server
    localStorage.removeItem('solovision-dashboard');
    location.reload();
}

function initSampleData() {
    state.tasks = {
        todo: [
            { id: 't1', title: 'Review PRD v2', priority: 0, created: Date.now() },
            { id: 't2', title: 'Set up heartbeat schedule', priority: 1, created: Date.now() }
        ],
        progress: [],
        done: []
    };
    state.notes = [];
    state.activity = [];
    state.docs = [];
    saveState();
}

// ===================
// DRAG AND DROP
// ===================

let draggedTaskId = null;
let draggedFromColumn = null;

function handleDragStart(e, taskId, column) {
    draggedTaskId = taskId;
    draggedFromColumn = column;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    
    // Add dragging class after a tiny delay (so the drag image captures properly)
    setTimeout(() => {
        e.target.classList.add('opacity-50', 'scale-95');
    }, 0);
}

function handleDragEnd(e) {
    e.target.classList.remove('opacity-50', 'scale-95');
    draggedTaskId = null;
    draggedFromColumn = null;
    
    // Remove all drop zone highlights
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.classList.remove('ring-2', 'ring-solo-accent', 'bg-solo-accent/10');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e, column) {
    e.preventDefault();
    const dropZone = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
    if (dropZone && draggedFromColumn !== column) {
        dropZone.classList.add('ring-2', 'ring-solo-accent', 'bg-solo-accent/10');
    }
}

function handleDragLeave(e, column) {
    const dropZone = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
    // Only remove highlight if we're actually leaving the drop zone (not entering a child)
    if (dropZone && !dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('ring-2', 'ring-solo-accent', 'bg-solo-accent/10');
    }
}

function handleDrop(e, toColumn) {
    e.preventDefault();
    
    const dropZone = document.getElementById(`${toColumn === 'progress' ? 'progress' : toColumn}-tasks`);
    dropZone?.classList.remove('ring-2', 'ring-solo-accent', 'bg-solo-accent/10');
    
    if (!draggedTaskId || !draggedFromColumn || draggedFromColumn === toColumn) {
        return;
    }
    
    moveTask(draggedTaskId, draggedFromColumn, toColumn);
    draggedTaskId = null;
    draggedFromColumn = null;
}

// ===================
// SELECTION MANAGEMENT
// ===================

function toggleTaskSelection(taskId, event) {
    event.stopPropagation();
    
    if (selectedTasks.has(taskId)) {
        selectedTasks.delete(taskId);
    } else {
        selectedTasks.add(taskId);
    }
    
    renderTasks();
    renderBulkActionBar();
}

function selectAllTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        state.tasks[column].forEach(task => {
            selectedTasks.add(task.id);
        });
    });
    renderTasks();
    renderBulkActionBar();
}

function clearSelection() {
    selectedTasks.clear();
    renderTasks();
    renderBulkActionBar();
}

function getSelectedCount() {
    return selectedTasks.size;
}

// ===================
// BULK ACTIONS
// ===================

function renderBulkActionBar() {
    let bar = document.getElementById('bulk-action-bar');
    
    if (selectedTasks.size === 0) {
        if (bar) bar.remove();
        return;
    }
    
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'bulk-action-bar';
        bar.className = 'fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-solo-card border border-slate-600 rounded-xl shadow-2xl px-6 py-4 flex items-center gap-4 z-50';
        document.body.appendChild(bar);
    }
    
    bar.innerHTML = `
        <span class="text-sm font-medium text-solo-accent">${selectedTasks.size} selected</span>
        <div class="h-6 w-px bg-slate-600"></div>
        <button onclick="bulkMove('todo')" class="px-3 py-1.5 text-sm bg-slate-600 hover:bg-slate-500 rounded-lg transition flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-slate-400"></span> To-Do
        </button>
        <button onclick="bulkMove('progress')" class="px-3 py-1.5 text-sm bg-yellow-600 hover:bg-yellow-500 rounded-lg transition flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-yellow-400"></span> In Progress
        </button>
        <button onclick="bulkMove('done')" class="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 rounded-lg transition flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-green-400"></span> Done
        </button>
        <div class="h-6 w-px bg-slate-600"></div>
        <button onclick="bulkDelete()" class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded-lg transition">
            🗑️ Delete
        </button>
        <button onclick="clearSelection()" class="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition">
            ✕ Cancel
        </button>
    `;
}

function bulkMove(toColumn) {
    const tasksToMove = [];
    
    ['todo', 'progress', 'done'].forEach(fromColumn => {
        state.tasks[fromColumn] = state.tasks[fromColumn].filter(task => {
            if (selectedTasks.has(task.id)) {
                if (toColumn === 'progress') task.started = Date.now();
                if (toColumn === 'done') task.completed = Date.now();
                tasksToMove.push(task);
                return false;
            }
            return true;
        });
    });
    
    state.tasks[toColumn].push(...tasksToMove);
    addActivity(`Moved ${tasksToMove.length} tasks to ${toColumn}`, 'info');
    
    clearSelection();
    saveState();
    render();
}

function bulkDelete() {
    if (!confirm(`Delete ${selectedTasks.size} selected tasks?`)) return;
    
    let deletedCount = 0;
    ['todo', 'progress', 'done'].forEach(column => {
        const before = state.tasks[column].length;
        state.tasks[column] = state.tasks[column].filter(task => !selectedTasks.has(task.id));
        deletedCount += before - state.tasks[column].length;
    });
    
    addActivity(`Deleted ${deletedCount} tasks`, 'info');
    clearSelection();
    saveState();
    render();
}

// ===================
// RENDERING
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

function renderConsole() {
    const live = state.live || { status: 'idle' };
    const consoleData = state.console || { logs: [] };
    
    // Status badge
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
    
    // Task timer
    const timerEl = document.getElementById('console-task-timer');
    if (timerEl && live.taskStarted) {
        const elapsed = Math.floor((Date.now() - live.taskStarted) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        timerEl.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
        timerEl.classList.remove('hidden');
    } else if (timerEl) {
        timerEl.classList.add('hidden');
    }
    
    // Current task bar
    const taskbar = document.getElementById('console-taskbar');
    const taskText = document.getElementById('console-current-task');
    if (taskbar && taskText) {
        if (live.task) {
            taskbar.classList.remove('hidden');
            taskText.textContent = live.task;
        } else {
            taskbar.classList.add('hidden');
        }
    }
    
    // Console logs
    const output = document.getElementById('console-output');
    if (output && consoleData.logs && consoleData.logs.length > 0) {
        output.innerHTML = consoleData.logs.map(log => {
            const timeStr = formatTimeShort(log.time);
            const colorClass = getLogColor(log.type);
            const prefix = getLogPrefix(log.type);
            return `<div class="${colorClass}"><span class="text-gray-600">[${timeStr}]</span> ${prefix}${escapeHtml(log.text)}</div>`;
        }).join('');
        
        // Auto-scroll to bottom
        output.scrollTop = output.scrollHeight;
    }
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

function addConsoleLog(text, type = 'output') {
    if (!state.console) state.console = { logs: [] };
    if (!state.console.logs) state.console.logs = [];
    
    state.console.logs.push({
        text,
        type,
        time: Date.now()
    });
    
    // Keep only last 100 logs
    if (state.console.logs.length > 100) {
        state.console.logs = state.console.logs.slice(-100);
    }
    
    saveState();
    renderConsole();
}

function clearConsole() {
    if (!state.console) state.console = { logs: [] };
    state.console.logs = [
        { text: 'Console cleared', type: 'info', time: Date.now() }
    ];
    saveState();
    renderConsole();
}

// Sync full state from VPS (pulls SoLoBot's updates including task movements)
async function syncFromVPS() {
    try {
        addConsoleLog('🔄 Syncing from VPS...', 'info');
        const response = await fetch('http://51.81.202.92:3456/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            // Clear local modified flag so we accept VPS state
            delete vpsState.localModified;
            // Merge VPS state (this will include task updates from SoLoBot)
            state = { ...state, ...vpsState };
            // Save to localStorage without localModified flag
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            render();
            addConsoleLog('✅ Synced from VPS successfully', 'success');
        } else {
            addConsoleLog('❌ VPS sync failed: ' + response.status, 'error');
        }
    } catch (e) {
        addConsoleLog('❌ VPS sync error: ' + e.message, 'error');
    }
}

function toggleConsoleExpand() {
    const output = document.getElementById('console-output');
    const btn = document.getElementById('console-expand-btn');
    
    if (!state.console) state.console = { expanded: false };
    state.console.expanded = !state.console.expanded;
    
    if (state.console.expanded) {
        output.style.height = '400px';
        btn.textContent = 'Collapse';
    } else {
        output.style.height = '200px';
        btn.textContent = 'Expand';
    }
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
    
    // Update provider if element exists
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
                
                <!-- Quick action buttons (visible on hover) -->
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
// TASK MENU FUNCTIONS
// ===================

function toggleTaskMenu(taskId, column, event) {
    event.stopPropagation();
    openActionModal(taskId, column);
}

function closeAllTaskMenus() {
    document.querySelectorAll('.task-menu').forEach(menu => {
        menu.classList.add('hidden');
    });
}

// ===================
// ACTION MODAL FUNCTIONS
// ===================

function openActionModal(taskId, column) {
    const task = state.tasks[column].find(t => t.id === taskId);
    if (!task) return;
    
    currentModalTask = task;
    currentModalColumn = column;
    
    // Set task title in modal
    document.getElementById('action-modal-task-title').textContent = task.title;
    document.getElementById('action-priority-text').textContent = `Change Priority (P${task.priority})`;
    
    // Highlight current column button
    ['todo', 'progress', 'done', 'archive'].forEach(col => {
        const btn = document.getElementById(`action-move-${col}`);
        if (!btn) return;
        if (col === column) {
            btn.classList.add('ring-2', 'ring-solo-primary', 'bg-slate-700');
        } else {
            btn.classList.remove('ring-2', 'ring-solo-primary', 'bg-slate-700');
        }
    });
    
    document.getElementById('task-action-modal').classList.remove('hidden');
}

function closeActionModal() {
    document.getElementById('task-action-modal').classList.add('hidden');
    currentModalTask = null;
    currentModalColumn = null;
}

function modalMoveTask(toColumn) {
    if (!currentModalTask || !currentModalColumn) return;
    if (currentModalColumn === toColumn) {
        closeActionModal();
        return;
    }
    
    moveTask(currentModalTask.id, currentModalColumn, toColumn);
    closeActionModal();
}

function modalEditTitle() {
    if (!currentModalTask) return;
    
    closeActionModal();
    document.getElementById('edit-title-input').value = currentModalTask.title;
    document.getElementById('edit-title-modal').classList.remove('hidden');
    document.getElementById('edit-title-input').focus();
    document.getElementById('edit-title-input').select();
}

function closeEditTitleModal() {
    document.getElementById('edit-title-modal').classList.add('hidden');
}

function saveEditedTitle() {
    if (!currentModalTask || !currentModalColumn) return;
    
    const newTitle = document.getElementById('edit-title-input').value.trim();
    if (newTitle && newTitle !== currentModalTask.title) {
        currentModalTask.title = newTitle;
        addActivity(`Renamed task to: ${newTitle}`, 'info');
        saveState();
        render();
    }
    
    closeEditTitleModal();
    currentModalTask = null;
    currentModalColumn = null;
}

function modalCyclePriority() {
    if (!currentModalTask || !currentModalColumn) return;
    
    currentModalTask.priority = (currentModalTask.priority + 1) % 3;
    document.getElementById('action-priority-text').textContent = `Change Priority (P${currentModalTask.priority})`;
    addActivity(`Changed "${currentModalTask.title}" to P${currentModalTask.priority}`, 'info');
    saveState();
    render();
    
    // Keep modal open to allow further changes
}

function modalDeleteTask() {
    if (!currentModalTask) return;
    
    closeActionModal();
    document.getElementById('delete-modal-task-title').textContent = `"${currentModalTask.title}"`;
    document.getElementById('confirm-delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
    document.getElementById('confirm-delete-modal').classList.add('hidden');
}

function confirmDeleteTask() {
    if (!currentModalTask || !currentModalColumn) return;
    
    const taskIndex = state.tasks[currentModalColumn].findIndex(t => t.id === currentModalTask.id);
    if (taskIndex !== -1) {
        const task = state.tasks[currentModalColumn].splice(taskIndex, 1)[0];
        addActivity(`Deleted: ${task.title}`, 'info');
        saveState();
        render();
    }
    
    closeDeleteModal();
    currentModalTask = null;
    currentModalColumn = null;
}

// ===================
// TASK ACTIONS
// ===================

function openAddTask(column) {
    newTaskColumn = column;
    newTaskPriority = 1;
    document.getElementById('new-task-title').value = '';
    document.getElementById('add-task-modal').classList.remove('hidden');
    document.getElementById('new-task-title').focus();
    updatePriorityButtons();
}

function closeAddTask() {
    document.getElementById('add-task-modal').classList.add('hidden');
}

function setTaskPriority(p) {
    newTaskPriority = p;
    updatePriorityButtons();
}

function updatePriorityButtons() {
    [0, 1, 2].forEach(p => {
        const btn = document.getElementById(`priority-btn-${p}`);
        if (p === newTaskPriority) {
            btn.classList.add('bg-opacity-30');
            if (p === 0) btn.classList.add('bg-red-500');
            if (p === 1) btn.classList.add('bg-yellow-500');
            if (p === 2) btn.classList.add('bg-blue-500');
        } else {
            btn.classList.remove('bg-opacity-30', 'bg-red-500', 'bg-yellow-500', 'bg-blue-500');
        }
    });
}

function submitTask() {
    const title = document.getElementById('new-task-title').value.trim();
    if (!title) return;
    
    const task = {
        id: 't' + Date.now(),
        title,
        priority: newTaskPriority,
        created: Date.now()
    };
    
    state.tasks[newTaskColumn].push(task);
    addActivity(`Added task: ${title}`, 'info');
    saveState();
    render();
    closeAddTask();
}

function quickMoveTask(taskId, fromColumn, toColumn, event) {
    event.stopPropagation();
    moveTask(taskId, fromColumn, toColumn);
}

function moveTask(taskId, fromColumn, toColumn) {
    if (fromColumn === toColumn) return;
    
    const taskIndex = state.tasks[fromColumn].findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = state.tasks[fromColumn].splice(taskIndex, 1)[0];
    
    if (toColumn === 'progress') {
        task.started = Date.now();
        // Set pending notify flag - SoLoBot will pick this up
        state.pendingNotify = {
            taskId: task.id,
            title: task.title,
            priority: task.priority,
            time: Date.now()
        };
        showNotifyBanner(task.title);
    }
    if (toColumn === 'done') task.completed = Date.now();
    if (toColumn === 'archive') task.archived = Date.now();
    
    state.tasks[toColumn].push(task);
    addActivity(`Moved "${task.title}" → ${toColumn}`, 'info');
    closeAllTaskMenus();
    saveState();
    render();
}

function showNotifyBanner(taskTitle) {
    // Show a brief banner that SoLoBot has been notified
    let banner = document.getElementById('notify-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'notify-banner';
        banner.className = 'fixed top-4 right-4 bg-solo-primary text-white px-4 py-3 rounded-lg shadow-xl z-50 flex items-center gap-3 animate-pulse';
        document.body.appendChild(banner);
    }
    banner.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        <span>🤖 SoLoBot notified: <strong>${taskTitle}</strong></span>
    `;
    banner.classList.remove('hidden');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        banner.classList.add('hidden');
    }, 3000);
}

function archiveTask(taskId, column) {
    moveTask(taskId, column, 'archive');
}

function deleteTask(taskId, column) {
    const task = state.tasks[column].find(t => t.id === taskId);
    if (!task) return;
    
    // Use modal instead of confirm
    currentModalTask = task;
    currentModalColumn = column;
    document.getElementById('delete-modal-task-title').textContent = `"${task.title}"`;
    document.getElementById('confirm-delete-modal').classList.remove('hidden');
}

function clearDone() {
    if (state.tasks.done.length === 0) return;
    if (!confirm('Clear all completed tasks?')) return;
    
    state.tasks.done = [];
    addActivity('Cleared completed tasks', 'info');
    saveState();
    render();
}

function clearArchive() {
    if (!state.tasks.archive || state.tasks.archive.length === 0) return;
    if (!confirm('Clear all archived tasks?')) return;
    
    state.tasks.archive = [];
    addActivity('Cleared archived tasks', 'info');
    saveState();
    render();
    renderArchiveModal();
}

// ===================
// ARCHIVE MODAL
// ===================

function openArchiveModal() {
    renderArchiveModal();
    document.getElementById('archive-modal').classList.remove('hidden');
}

function closeArchiveModal() {
    document.getElementById('archive-modal').classList.add('hidden');
}

function renderArchiveModal() {
    const container = document.getElementById('archive-tasks-list');
    const countEl = document.getElementById('archive-modal-count');
    const badgeEl = document.getElementById('archive-badge');
    
    const archived = state.tasks.archive || [];
    
    // Update counts
    if (countEl) countEl.textContent = archived.length;
    if (badgeEl) {
        badgeEl.textContent = archived.length;
        if (archived.length > 0) {
            badgeEl.classList.remove('hidden');
        } else {
            badgeEl.classList.add('hidden');
        }
    }
    
    if (!container) return;
    
    if (archived.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-8">No archived tasks</div>';
        return;
    }
    
    container.innerHTML = archived.map((task, index) => `
        <div class="bg-solo-dark rounded-lg p-3 priority-p${task.priority} flex items-center justify-between group">
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <span class="text-sm">${escapeHtml(task.title)}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded ${getPriorityClass(task.priority)}">P${task.priority}</span>
                </div>
                <div class="text-xs text-gray-500 mt-1">Archived: ${formatDate(task.archived || task.completed || task.created)}</div>
            </div>
            <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                <button onclick="restoreFromArchive('${task.id}')" class="text-xs px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded transition" title="Restore to To-Do">
                    ↩ Restore
                </button>
                <button onclick="deleteFromArchive('${task.id}')" class="text-xs px-2 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded transition" title="Delete permanently">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
}

function restoreFromArchive(taskId) {
    if (!state.tasks.archive) return;
    
    const taskIndex = state.tasks.archive.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = state.tasks.archive.splice(taskIndex, 1)[0];
    delete task.archived;
    delete task.completed;
    state.tasks.todo.unshift(task);
    
    addActivity(`Restored "${task.title}" from archive`, 'info');
    saveState();
    render();
    renderArchiveModal();
}

function deleteFromArchive(taskId) {
    if (!state.tasks.archive) return;
    
    const taskIndex = state.tasks.archive.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = state.tasks.archive.splice(taskIndex, 1)[0];
    addActivity(`Permanently deleted "${task.title}"`, 'info');
    saveState();
    renderArchiveModal();
}

// ===================
// SETTINGS
// ===================

function getSettings() {
    const saved = localStorage.getItem('solovision-settings');
    if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
    }
    return { ...defaultSettings };
}

function saveSettings(settings) {
    localStorage.setItem('solovision-settings', JSON.stringify(settings));
}

function openSettingsModal() {
    loadSettingsIntoForm();
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function loadSettingsIntoForm() {
    const settings = getSettings();
    
    // Dropdowns
    const pickupFreq = document.getElementById('setting-pickup-freq');
    if (pickupFreq) pickupFreq.value = settings.pickupFreq;
    
    const priorityOrder = document.getElementById('setting-priority-order');
    if (priorityOrder) priorityOrder.value = settings.priorityOrder;
    
    const refresh = document.getElementById('setting-refresh');
    if (refresh) refresh.value = settings.refreshInterval;
    
    const defaultPriority = document.getElementById('setting-default-priority');
    if (defaultPriority) defaultPriority.value = settings.defaultPriority;
    
    // Checkboxes
    const compact = document.getElementById('setting-compact');
    if (compact) compact.checked = settings.compactMode;
    
    const showLive = document.getElementById('setting-show-live');
    if (showLive) showLive.checked = settings.showLive;
    
    const showActivity = document.getElementById('setting-show-activity');
    if (showActivity) showActivity.checked = settings.showActivity;
    
    const showNotes = document.getElementById('setting-show-notes');
    if (showNotes) showNotes.checked = settings.showNotes;
    
    const showProducts = document.getElementById('setting-show-products');
    if (showProducts) showProducts.checked = settings.showProducts;
    
    const showDocs = document.getElementById('setting-show-docs');
    if (showDocs) showDocs.checked = settings.showDocs;
}

function updateSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    saveSettings(settings);
    applySettings();
    
    // Special handling for pickup frequency - notify about cron change needed
    if (key === 'pickupFreq') {
        addActivity(`Task pickup frequency changed to ${value === 'disabled' ? 'disabled' : (parseInt(value)/60000) + ' min'}`, 'info');
    }
}

function applySettings() {
    const settings = getSettings();
    
    // Apply default priority
    newTaskPriority = parseInt(settings.defaultPriority);
    
    // Apply auto-refresh interval
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }
    const interval = parseInt(settings.refreshInterval);
    if (interval > 0) {
        refreshIntervalId = setInterval(async () => {
            await loadState();
            render();
        }, interval);
    }
    
    // Apply compact mode
    document.body.classList.toggle('compact-mode', settings.compactMode);
    
    // Apply panel visibility
    const livePanel = document.querySelector('section:has(#live-status-badge)')?.parentElement?.querySelector('section:first-of-type');
    const livePanelSection = document.querySelector('.mb-6:has(#live-status-badge)');
    if (livePanelSection) livePanelSection.style.display = settings.showLive ? '' : 'none';
    
    // We'll use IDs for the sections to toggle them
    toggleSectionVisibility('activity', settings.showActivity);
    toggleSectionVisibility('notes', settings.showNotes);
    toggleSectionVisibility('products', settings.showProducts);
    toggleSectionVisibility('docs', settings.showDocs);
}

function toggleSectionVisibility(sectionType, visible) {
    // Find sections by their content/headers
    const sections = document.querySelectorAll('main > section');
    sections.forEach(section => {
        const header = section.querySelector('h2');
        if (!header) return;
        
        const text = header.textContent.toLowerCase();
        if (sectionType === 'activity' && text.includes('activity')) {
            section.closest('.grid')?.querySelector('.bg-solo-card:first-child')?.style.setProperty('display', visible ? '' : 'none');
        }
        if (sectionType === 'notes' && text.includes('notes')) {
            section.closest('.grid')?.querySelector('.bg-solo-card:last-child')?.style.setProperty('display', visible ? '' : 'none');
        }
        if (sectionType === 'products' && text.includes('product')) {
            section.style.display = visible ? '' : 'none';
        }
        if (sectionType === 'docs' && text.includes('docs')) {
            section.style.display = visible ? '' : 'none';
        }
    });
}

function clearAllData() {
    if (!confirm('This will delete ALL local data including tasks, notes, and activity. Are you sure?')) return;
    if (!confirm('Really? This cannot be undone!')) return;
    
    localStorage.removeItem('solovision-dashboard');
    localStorage.removeItem('solovision-settings');
    location.reload();
}

// Apply settings on load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(applySettings, 100);
});

// ===================
// NOTE FUNCTIONS
// ===================

function addNote() {
    const input = document.getElementById('note-input');
    const text = input.value.trim();
    if (!text) return;
    
    const note = {
        id: 'n' + Date.now(),
        text,
        created: Date.now(),
        seen: false
    };
    
    state.notes.unshift(note);
    addActivity(`Note: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`, 'info');
    saveState();
    render();
    input.value = '';
}

// ===================
// CHAT FUNCTIONS
// ===================

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    // Add message to chat history
    if (!state.chat) state.chat = { messages: [] };
    
    const message = {
        id: 'm' + Date.now(),
        from: 'user',
        text,
        time: Date.now()
    };
    
    state.chat.messages.push(message);
    
    // Also set as pending chat for SoLoBot to pick up
    state.pendingChat = {
        text,
        time: Date.now()
    };
    
    addActivity(`Chat: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`, 'info');
    saveState();
    renderChat();
    input.value = '';
}

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    if (!state.chat || !state.chat.messages || state.chat.messages.length === 0) {
        container.innerHTML = `
            <div class="text-gray-500 text-sm text-center py-8">
                💬 Chat with SoLoBot directly. Messages sync every 3 seconds.
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.chat.messages.map(msg => {
        const isUser = msg.from === 'user';
        const timeStr = formatTime(msg.time);
        const bgClass = isUser ? 'bg-solo-primary/20 ml-8' : 'bg-slate-700 mr-8';
        const alignClass = isUser ? 'text-right' : 'text-left';
        const nameClass = isUser ? 'text-solo-primary' : 'text-green-400';
        const name = isUser ? 'You' : '🤖 SoLoBot';
        
        return `
            <div class="${bgClass} rounded-lg p-3 ${alignClass}">
                <div class="flex items-center gap-2 mb-1 ${isUser ? 'justify-end' : ''}">
                    <span class="text-xs ${nameClass} font-medium">${name}</span>
                    <span class="text-xs text-gray-500">${timeStr}</span>
                </div>
                <p class="text-sm text-gray-200">${escapeHtml(msg.text)}</p>
            </div>
        `;
    }).join('');
    
    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// ===================
// ACTIVITY FUNCTIONS
// ===================

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

// ===================
// UTILITY FUNCTIONS
// ===================

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
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

// ===================
// PUBLIC API
// ===================

window.dashboardAPI = {
    getState: () => state,
    setState: (newState) => { state = { ...state, ...newState }; saveState(); render(); },
    addTask: (title, priority = 1, column = 'todo') => {
        const task = { id: 't' + Date.now(), title, priority, created: Date.now() };
        state.tasks[column].push(task);
        addActivity(`Added: ${title}`, 'info');
        saveState();
        render();
        return task.id;
    },
    moveTask: (taskId, toColumn) => {
        ['todo', 'progress', 'done'].forEach(col => {
            const idx = state.tasks[col].findIndex(t => t.id === taskId);
            if (idx !== -1) moveTask(taskId, col, toColumn);
        });
    },
    deleteTask: (taskId) => {
        ['todo', 'progress', 'done'].forEach(col => {
            const idx = state.tasks[col].findIndex(t => t.id === taskId);
            if (idx !== -1) {
                state.tasks[col].splice(idx, 1);
                saveState();
                render();
            }
        });
    },
    addNote: (text) => { document.getElementById('note-input').value = text; addNote(); },
    setStatus: (status, task = null) => { state.status = status; state.currentTask = task; saveState(); renderStatus(); },
    setSubagent: (task) => { state.subagent = task; renderStatus(); },
    markNoteSeen: (id) => { const note = state.notes.find(n => n.id === id); if (note) { note.seen = true; saveState(); render(); } },
    addActivity: (action, type) => { addActivity(action, type); saveState(); render(); },
    getTasks: () => state.tasks,
    
    // Live status API
    setLiveStatus: (status, task = null) => {
        if (!state.live) state.live = { thoughts: [] };
        state.live.status = status;
        state.live.task = task;
        state.live.lastActive = Date.now();
        if (status === 'working' && task && !state.live.taskStarted) {
            state.live.taskStarted = Date.now();
        } else if (status === 'idle') {
            state.live.taskStarted = null;
        }
        saveState();
        renderLivePanel();
    },
    addThought: (text) => {
        if (!state.live) state.live = { thoughts: [] };
        if (!state.live.thoughts) state.live.thoughts = [];
        state.live.thoughts.push({ text, time: Date.now() });
        // Keep only last 10 thoughts
        if (state.live.thoughts.length > 10) {
            state.live.thoughts = state.live.thoughts.slice(-10);
        }
        state.live.lastActive = Date.now();
        saveState();
        renderLivePanel();
    },
    completeTask: () => {
        if (!state.live) state.live = { thoughts: [], tasksToday: 0 };
        state.live.tasksToday = (state.live.tasksToday || 0) + 1;
        state.live.status = 'idle';
        state.live.task = null;
        state.live.taskStarted = null;
        saveState();
        renderLivePanel();
    },
    getLive: () => state.live,
    
    // Console API
    log: (text, type = 'output') => addConsoleLog(text, type),
    logCommand: (text) => addConsoleLog(text, 'command'),
    logThinking: (text) => addConsoleLog(text, 'thinking'),
    logSuccess: (text) => addConsoleLog(text, 'success'),
    logError: (text) => addConsoleLog(text, 'error'),
    logWarning: (text) => addConsoleLog(text, 'warning'),
    logInfo: (text) => addConsoleLog(text, 'info'),
    clearConsole: () => clearConsole(),
    getConsoleLogs: () => state.console?.logs || [],
    listTasks: () => {
        let list = [];
        let num = 1;
        ['todo', 'progress', 'done'].forEach(col => {
            state.tasks[col].forEach(t => {
                list.push({ num: num++, id: t.id, title: t.title, column: col, priority: t.priority });
            });
        });
        return list;
    }
};

console.log('SoLoVision Dashboard v2.0 loaded');
console.log('Features: Bulk selection, quick actions, context menus');
console.log('Shortcuts: Ctrl+A (select all), Esc (clear selection)');
