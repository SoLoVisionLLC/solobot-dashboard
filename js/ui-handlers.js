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
        
        // Populate model dropdown for current provider
        await updateModelDropdown(modelInfo.provider);
        
    } catch (error) {
        console.error('[Dashboard] Failed to get current model:', error);
        // Fallback
        document.getElementById('current-provider-display').textContent = 'anthropic';
        document.getElementById('current-model-display').textContent = 'anthropic/claude-opus-4-5';
        document.getElementById('setting-provider').value = 'anthropic';
        await updateModelDropdown('anthropic');
    }

    // Populate gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 443;
    if (tokenEl) tokenEl.value = GATEWAY_CONFIG.token || '';
    if (sessionEl) sessionEl.value = GATEWAY_CONFIG.sessionKey || 'main';
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
        const response = await fetch('/api/memory/memory/recent-activity.json');
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


