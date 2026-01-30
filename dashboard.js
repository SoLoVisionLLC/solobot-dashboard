// SoLoVision Command Center Dashboard
// Version: 1.0.0

// ===================
// STATE MANAGEMENT
// ===================

let state = {
    status: 'idle', // idle, working, thinking, offline
    model: 'opus 4.5',
    currentTask: null,
    subagent: null,
    tasks: {
        todo: [],
        progress: [],
        done: []
    },
    notes: [],
    activity: [],
    docs: []
};

let newTaskPriority = 1;
let newTaskColumn = 'todo';

// ===================
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    render();
    updateLastSync();
    
    // Auto-refresh every 10 seconds (poll server state)
    setInterval(async () => {
        await loadState();
        render();
    }, 10000);
    
    // Enter key for note input
    document.getElementById('note-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addNote();
    });
    
    // Enter key for task input
    document.getElementById('new-task-title').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitTask();
    });
    
    // Docs search
    document.getElementById('docs-search').addEventListener('input', (e) => {
        renderDocs(e.target.value);
    });
});

// ===================
// DATA PERSISTENCE
// ===================

// Try to load from server state.json first, fallback to localStorage
async function loadState() {
    try {
        const response = await fetch('data/state.json?' + Date.now());
        if (response.ok) {
            const serverState = await response.json();
            state = { ...state, ...serverState };
            console.log('Loaded state from server');
            return;
        }
    } catch (e) {
        console.log('Server state not available, using localStorage');
    }
    
    // Fallback to localStorage
    const saved = localStorage.getItem('solovision-dashboard');
    if (saved) {
        const parsed = JSON.parse(saved);
        state = { ...state, ...parsed };
    } else {
        initSampleData();
    }
}

function saveState() {
    // Save to localStorage (for offline/local use)
    localStorage.setItem('solovision-dashboard', JSON.stringify(state));
    updateLastSync();
    // Note: Server state is updated via CLI tool, not from browser
}

function initSampleData() {
    state.tasks = {
        todo: [
            { id: 't1', title: 'Review PRD v2', priority: 0, created: Date.now() },
            { id: 't2', title: 'Set up heartbeat schedule', priority: 1, created: Date.now() }
        ],
        progress: [
            { id: 't3', title: 'Build dashboard UI', priority: 0, created: Date.now(), started: Date.now() }
        ],
        done: [
            { id: 't4', title: 'Create Google OAuth', priority: 1, created: Date.now() - 3600000, completed: Date.now() },
            { id: 't5', title: 'Write PRD v2', priority: 0, created: Date.now() - 7200000, completed: Date.now() - 1800000 }
        ]
    };
    
    state.notes = [
        { id: 'n1', text: 'Remember to update RUNNING-CONTEXT.md', created: Date.now() - 1800000, seen: true },
        { id: 'n2', text: 'Check if OAuth tokens need refresh', created: Date.now(), seen: false }
    ];
    
    state.activity = [
        { time: Date.now() - 3600000, action: 'Completed Google OAuth setup', type: 'success' },
        { time: Date.now() - 1800000, action: 'Created PRD v2 with all features', type: 'success' },
        { time: Date.now() - 900000, action: 'Uploaded PRD to Google Drive', type: 'info' },
        { time: Date.now(), action: 'Started building dashboard UI', type: 'info' }
    ];
    
    state.docs = [
        { id: 'd1', name: 'PRD-SoLoVision-Dashboard-v2', type: 'doc', url: 'https://docs.google.com/document/d/17FHVOwZECJTjkLS8XEra0LSt5OXhd_ySzC4CYH0oD1U/edit', updated: Date.now() },
        { id: 'd2', name: 'SoLoBot Dashboard Inspiration', type: 'txt', url: 'https://drive.google.com/file/d/1rf4t1Zo_3dua56pSng5UIAzS7D2Y47Fm/view', updated: Date.now() - 86400000 }
    ];
    
    saveState();
}

// ===================
// RENDERING
// ===================

function render() {
    renderStatus();
    renderTasks();
    renderNotes();
    renderActivity();
    renderDocs();
}

function renderStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const modelEl = document.getElementById('model-name');
    const taskEl = document.getElementById('current-task');
    const taskName = document.getElementById('task-name');
    const subagentBanner = document.getElementById('subagent-banner');
    const subagentTask = document.getElementById('subagent-task');
    
    // Status indicator
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
    
    // Model
    modelEl.textContent = state.model;
    
    // Current task
    if (state.currentTask) {
        taskEl.classList.remove('hidden');
        taskName.textContent = state.currentTask;
    } else {
        taskEl.classList.add('hidden');
    }
    
    // Sub-agent
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
        
        container.innerHTML = state.tasks[column].map(task => `
            <div class="bg-solo-dark rounded-lg p-3 priority-p${task.priority} cursor-pointer hover:bg-slate-700/50 transition" 
                 onclick="showTaskMenu('${task.id}', '${column}')">
                <div class="flex items-start justify-between">
                    <span class="text-sm">${escapeHtml(task.title)}</span>
                    <span class="text-xs px-1.5 py-0.5 rounded ${getPriorityClass(task.priority)}">P${task.priority}</span>
                </div>
                <div class="text-xs text-gray-500 mt-2">${formatTime(task.created)}</div>
            </div>
        `).join('');
        
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
    container.innerHTML = state.activity.slice().reverse().map(entry => `
        <div class="flex items-start gap-3 text-sm">
            <span class="text-gray-500 whitespace-nowrap">${formatTime(entry.time)}</span>
            <span class="${entry.type === 'success' ? 'text-green-400' : entry.type === 'error' ? 'text-red-400' : 'text-gray-300'}">
                ${escapeHtml(entry.action)}
            </span>
        </div>
    `).join('');
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
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
// TASK FUNCTIONS
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

function showTaskMenu(taskId, column) {
    const task = state.tasks[column].find(t => t.id === taskId);
    if (!task) return;
    
    const action = prompt(`Task: ${task.title}\n\nActions:\n1. Move to To-Do\n2. Move to In Progress\n3. Move to Done\n4. Delete\n\nEnter number:`);
    
    if (action === '1') moveTask(taskId, column, 'todo');
    else if (action === '2') moveTask(taskId, column, 'progress');
    else if (action === '3') moveTask(taskId, column, 'done');
    else if (action === '4') deleteTask(taskId, column);
}

function moveTask(taskId, fromColumn, toColumn) {
    const taskIndex = state.tasks[fromColumn].findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = state.tasks[fromColumn].splice(taskIndex, 1)[0];
    
    if (toColumn === 'progress') task.started = Date.now();
    if (toColumn === 'done') task.completed = Date.now();
    
    state.tasks[toColumn].push(task);
    addActivity(`Moved "${task.title}" to ${toColumn}`, 'info');
    saveState();
    render();
}

function deleteTask(taskId, column) {
    const taskIndex = state.tasks[column].findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = state.tasks[column].splice(taskIndex, 1)[0];
    addActivity(`Deleted task: ${task.title}`, 'info');
    saveState();
    render();
}

function clearDone() {
    if (state.tasks.done.length === 0) return;
    if (!confirm('Clear all completed tasks?')) return;
    
    state.tasks.done = [];
    addActivity('Cleared completed tasks', 'info');
    saveState();
    render();
}

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
    addActivity(`Note added: "${text.substring(0, 30)}..."`, 'info');
    saveState();
    render();
    input.value = '';
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
    
    // Keep only last 100 entries
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
// API FUNCTIONS (Future)
// ===================

// These will be implemented for AI integration
async function fetchState() {
    // TODO: Fetch state from JSON file or API
}

async function pushState() {
    // TODO: Push state to JSON file or API
}

// Export for external access
window.dashboardAPI = {
    getState: () => state,
    setState: (newState) => { state = { ...state, ...newState }; saveState(); render(); },
    addTask: (title, priority = 1) => { submitTask(); },
    addNote: (text) => { document.getElementById('note-input').value = text; addNote(); },
    setStatus: (status, task = null) => { state.status = status; state.currentTask = task; saveState(); renderStatus(); },
    setSubagent: (task) => { state.subagent = task; renderStatus(); },
    markNoteSeen: (id) => { const note = state.notes.find(n => n.id === id); if (note) { note.seen = true; saveState(); render(); } },
    addActivity: (action, type) => { addActivity(action, type); saveState(); render(); }
};

console.log('SoLoVision Dashboard loaded. Access API via window.dashboardAPI');
