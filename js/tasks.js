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

const AGENT_COLORS = {
    main: '#BC2026', dev: '#6366F1', exec: '#F59E0B', coo: '#10B981',
    cfo: '#EAB308', cmp: '#EC4899', family: '#14B8A6', tax: '#78716C',
    sec: '#3B82F6', smm: '#8B5CF6'
};

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
        const color = AGENT_COLORS[agent] || '#888';
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
            const agentColor = AGENT_COLORS[agent] || '#888';
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
    
    // Update quick stats when tasks change
    if (typeof updateQuickStats === 'function') {
        updateQuickStats();
    }
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
    const entries = state.activity.slice().reverse().slice(0, 20);

    if (entries.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No activity yet</div>';
        return;
    }

    container.innerHTML = entries.map(entry => {
        const typeClass = entry.type === 'success' ? 'success' : entry.type === 'error' ? 'warning' : '';
        return `
        <div class="activity-item">
            <span class="activity-time">${formatTime(entry.time)}</span>
            <span class="activity-text ${typeClass}">${escapeHtml(entry.action)}</span>
        </div>
    `}).join('');
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


