// SoLoVision Command Center Dashboard
// Version: 2.1.0 - Drag & Drop Update

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
        done: []
    },
    notes: [],
    activity: [],
    docs: []
};

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set(); // Track selected task IDs
let editingTaskId = null; // Currently editing task
let currentModalTask = null; // Task being edited in modal
let currentModalColumn = null; // Column of task being edited

// ===================
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    render();
    updateLastSync();
    
    // Auto-refresh every 10 seconds
    setInterval(async () => {
        await loadState();
        render();
    }, 10000);
    
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
    try {
        const response = await fetch('data/state.json?' + Date.now());
        if (response.ok) {
            const serverState = await response.json();
            state = { ...state, ...serverState };
            return;
        }
    } catch (e) {
        console.log('Server state not available, using localStorage');
    }
    
    const saved = localStorage.getItem('solovision-dashboard');
    if (saved) {
        const parsed = JSON.parse(saved);
        state = { ...state, ...parsed };
    } else {
        initSampleData();
    }
}

function saveState() {
    localStorage.setItem('solovision-dashboard', JSON.stringify(state));
    updateLastSync();
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
    renderTasks();
    renderNotes();
    renderActivity();
    renderDocs();
    renderBulkActionBar();
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
    
    modelEl.textContent = state.model;
    
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
                 onclick="openActionModal('${task.id}', '${column}')">`
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
    ['todo', 'progress', 'done'].forEach(col => {
        const btn = document.getElementById(`action-move-${col}`);
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
    
    if (toColumn === 'progress') task.started = Date.now();
    if (toColumn === 'done') task.completed = Date.now();
    
    state.tasks[toColumn].push(task);
    addActivity(`Moved "${task.title}" → ${toColumn}`, 'info');
    closeAllTaskMenus();
    saveState();
    render();
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
