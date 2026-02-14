// js/phase10-taskboard.js — Phase 10: Task Board Enhancements
// Swimlane view, bulk selection improvements, due date indicators, task dependencies

(function() {
    'use strict';

    // ==========================================
    // State
    // ==========================================
    
    let swimlaneView = false;
    let swimlaneGroupBy = 'agent'; // 'agent' or 'priority'
    let taskDependencies = {}; // taskId -> [dependentTaskIds]
    let selectedTasksForBulk = new Set();
    let bulkSelectionMode = false;

    // ==========================================
    // Swimlane View (Group by Agent/Priority)
    // ==========================================

    function toggleSwimlaneView() {
        swimlaneView = !swimlaneView;
        const btn = document.getElementById('swimlane-toggle-btn');
        if (btn) {
            btn.classList.toggle('active', swimlaneView);
        }
        
        if (swimlaneView) {
            renderSwimlaneView();
        } else {
            renderTasks(); // Fallback to standard view
        }
        
        addActivity(swimlaneView ? '📊 Switched to swimlane view' : '📋 Switched to standard view', 'info');
    }

    function setSwimlaneGroupBy(groupBy) {
        swimlaneGroupBy = groupBy;
        if (swimlaneView) {
            renderSwimlaneView();
        }
    }

    function renderSwimlaneView() {
        const container = document.querySelector('.bento-task-board .bento-widget-content');
        if (!container) return;

        // Get all tasks
        const allTasks = [
            ...(state.tasks.todo || []).map(t => ({ ...t, column: 'todo' })),
            ...(state.tasks.progress || []).map(t => ({ ...t, column: 'progress' })),
            ...(state.tasks.done || []).map(t => ({ ...t, column: 'done' }))
        ];

        // Apply filters
        const search = (document.getElementById('task-search')?.value || '').toLowerCase().trim();
        let filtered = allTasks;
        if (search) {
            filtered = filtered.filter(t => 
                (t.title || '').toLowerCase().includes(search) || 
                (t.description || '').toLowerCase().includes(search)
            );
        }

        // Group by selected criteria
        const groups = {};
        
        if (swimlaneGroupBy === 'agent') {
            const agents = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'sec', 'smm', 'family', 'tax'];
            agents.forEach(agent => groups[agent] = []);
            
            filtered.forEach(task => {
                const agent = getTaskAgent(task);
                if (!groups[agent]) groups[agent] = [];
                groups[agent].push(task);
            });
        } else if (swimlaneGroupBy === 'priority') {
            groups['P0 (Critical)'] = filtered.filter(t => t.priority === 0);
            groups['P1 (High)'] = filtered.filter(t => t.priority === 1);
            groups['P2 (Normal)'] = filtered.filter(t => t.priority === 2 || t.priority === undefined);
            groups['P3 (Low)'] = filtered.filter(t => t.priority === 3);
        }

        // Render swimlanes
        let html = `
            <div class="swimlane-header">
                <select id="swimlane-group-select" onchange="setSwimlaneGroupBy(this.value)" class="input" style="padding: 4px 8px; font-size: 12px;">
                    <option value="agent" ${swimlaneGroupBy === 'agent' ? 'selected' : ''}>Group by Agent</option>
                    <option value="priority" ${swimlaneGroupBy === 'priority' ? 'selected' : ''}>Group by Priority</option>
                </select>
                <button onclick="toggleSwimlaneView()" class="btn btn-ghost" style="padding: 4px 8px; font-size: 12px;">
                    📋 Standard View
                </button>
            </div>
            <div class="swimlane-container">
        `;

        for (const [groupName, tasks] of Object.entries(groups)) {
            if (tasks.length === 0 && swimlaneGroupBy === 'agent') continue;
            
            const color = swimlaneGroupBy === 'agent' ? (AGENT_COLORS[groupName] || '#888') : getPriorityColor(groupName);
            
            html += `
                <div class="swimlane-row">
                    <div class="swimlane-label" style="border-left-color: ${color}">
                        <span class="swimlane-name">${groupName.toUpperCase()}</span>
                        <span class="swimlane-count">${tasks.length}</span>
                    </div>
                    <div class="swimlane-tasks">
                        ${renderSwimlaneTasks(tasks)}
                    </div>
                </div>
            `;
        }

        html += '</div>';
        container.innerHTML = html;
    }

    function renderSwimlaneTasks(tasks) {
        if (tasks.length === 0) {
            return '<div class="swimlane-empty">No tasks</div>';
        }

        return tasks.map(task => {
            const agent = getTaskAgent(task);
            const agentColor = AGENT_COLORS[agent] || '#888';
            const columnBadge = {
                todo: '⬜',
                progress: '🔄',
                done: '✅'
            }[task.column] || '⬜';

            return `
                <div class="swimlane-task-card priority-p${task.priority || 1}" 
                     onclick="openTaskDetail('${task.id}', '${task.column}')">
                    <div class="swimlane-task-header">
                        <span class="swimlane-task-column">${columnBadge}</span>
                        <span class="swimlane-task-agent" style="background: ${agentColor}22; color: ${agentColor}">${agent}</span>
                    </div>
                    <div class="swimlane-task-title">${escapeHtml(task.title)}</div>
                    ${task.dueDate ? renderDueDateBadge(task.dueDate) : ''}
                </div>
            `;
        }).join('');
    }

    function getPriorityColor(groupName) {
        if (groupName.includes('P0')) return '#ef4444';
        if (groupName.includes('P1')) return '#f59e0b';
        if (groupName.includes('P2')) return '#3b82f6';
        return '#6b7280';
    }

    // ==========================================
    // Bulk Selection Improvements
    // ==========================================

    function enableBulkSelectionMode() {
        bulkSelectionMode = true;
        selectedTasksForBulk.clear();
        renderTasks();
        updateBulkSelectionUI();
        addActivity('🎯 Bulk selection mode enabled', 'info');
    }

    function disableBulkSelectionMode() {
        bulkSelectionMode = false;
        selectedTasksForBulk.clear();
        renderTasks();
        updateBulkSelectionUI();
    }

    function toggleTaskBulkSelection(taskId, event) {
        if (event) event.stopPropagation();
        
        if (selectedTasksForBulk.has(taskId)) {
            selectedTasksForBulk.delete(taskId);
        } else {
            selectedTasksForBulk.add(taskId);
        }
        
        renderTasks();
        updateBulkSelectionUI();
    }

    function selectAllVisible() {
        const visibleTasks = document.querySelectorAll('.task-card');
        visibleTasks.forEach(card => {
            const taskId = card.dataset.taskId;
            if (taskId) selectedTasksForBulk.add(taskId);
        });
        renderTasks();
        updateBulkSelectionUI();
    }

    function clearBulkSelection() {
        selectedTasksForBulk.clear();
        renderTasks();
        updateBulkSelectionUI();
    }

    function updateBulkSelectionUI() {
        const panel = document.getElementById('bulk-selection-panel');
        if (!panel) return;

        if (!bulkSelectionMode || selectedTasksForBulk.size === 0) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'flex';
        panel.innerHTML = `
            <span class="bulk-count">${selectedTasksForBulk.size} selected</span>
            <div class="bulk-actions">
                <button onclick="bulkMoveSelected('progress')" class="btn btn-ghost">🔄 Start</button>
                <button onclick="bulkMoveSelected('done')" class="btn btn-primary">✅ Done</button>
                <button onclick="bulkSetPriority(0)" class="btn btn-ghost" style="color: #ef4444;">P0</button>
                <button onclick="bulkSetPriority(1)" class="btn btn-ghost" style="color: #f59e0b;">P1</button>
                <button onclick="bulkSetPriority(2)" class="btn btn-ghost" style="color: #3b82f6;">P2</button>
                <button onclick="bulkAssignAgent()" class="btn btn-ghost">👤 Assign</button>
                <button onclick="clearBulkSelection()" class="btn btn-ghost" style="color: var(--text-muted);">Clear</button>
            </div>
        `;
    }

    function bulkMoveSelected(column) {
        const taskIds = Array.from(selectedTasksForBulk);
        let moved = 0;

        ['todo', 'progress', 'done'].forEach(srcCol => {
            state.tasks[srcCol] = (state.tasks[srcCol] || []).map(task => {
                if (taskIds.includes(task.id)) {
                    moved++;
                    return null;
                }
                return task;
            }).filter(Boolean);
        });

        // Add to destination
        if (!state.tasks[column]) state.tasks[column] = [];
        
        // We need to get the full task objects
        const allTasks = [...(state.tasks.todo || []), ...(state.tasks.progress || []), ...(state.tasks.done || [])];
        const tasksToMove = allTasks.filter(t => taskIds.includes(t.id));
        
        // Actually we need to move them properly
        // Re-fetch and move
        taskIds.forEach(taskId => {
            ['todo', 'progress', 'done'].forEach(srcCol => {
                const idx = (state.tasks[srcCol] || []).findIndex(t => t.id === taskId);
                if (idx !== -1) {
                    const task = state.tasks[srcCol].splice(idx, 1)[0];
                    if (!state.tasks[column]) state.tasks[column] = [];
                    if (column === 'done') task.completedAt = Date.now();
                    state.tasks[column].unshift(task);
                }
            });
        });

        saveState(`Bulk moved ${moved} tasks to ${column}`);
        renderTasks();
        clearBulkSelection();
        showToast(`Moved ${moved} tasks to ${column}`, 'success');
    }

    function bulkSetPriority(priority) {
        const taskIds = Array.from(selectedTasksForBulk);
        let updated = 0;

        ['todo', 'progress', 'done'].forEach(col => {
            (state.tasks[col] || []).forEach(task => {
                if (taskIds.includes(task.id)) {
                    task.priority = priority;
                    updated++;
                }
            });
        });

        saveState(`Set P${priority} for ${updated} tasks`);
        renderTasks();
        clearBulkSelection();
        showToast(`Set P${priority} for ${updated} tasks`, 'success');
    }

    function bulkAssignAgent() {
        const agents = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'sec', 'smm', 'family', 'tax'];
        const agent = prompt(`Assign to agent:\n${agents.join(', ')}`, 'main');
        if (!agent || !agents.includes(agent)) return;

        const taskIds = Array.from(selectedTasksForBulk);
        let updated = 0;

        ['todo', 'progress', 'done'].forEach(col => {
            (state.tasks[col] || []).forEach(task => {
                if (taskIds.includes(task.id)) {
                    task.agent = agent;
                    updated++;
                }
            });
        });

        saveState(`Assigned ${updated} tasks to ${agent}`);
        renderTasks();
        clearBulkSelection();
        showToast(`Assigned ${updated} tasks to ${agent.toUpperCase()}`, 'success');
    }

    // ==========================================
    // Due Date Visual Indicators
    // ==========================================

    function setTaskDueDate(taskId, column, date) {
        const task = findTask(taskId, column);
        if (task) {
            task.dueDate = date;
            saveState('Updated due date');
            renderTasks();
            showToast('Due date updated', 'success');
        }
    }

    function findTask(taskId, column) {
        if (column) {
            return (state.tasks[column] || []).find(t => t.id === taskId);
        }
        // Search all columns
        for (const col of ['todo', 'progress', 'done']) {
            const task = (state.tasks[col] || []).find(t => t.id === taskId);
            if (task) return task;
        }
        return null;
    }

    function renderDueDateBadge(dueDate) {
        const due = new Date(dueDate);
        const now = new Date();
        const daysUntil = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
        
        let status, className;
        if (daysUntil < 0) {
            status = `${Math.abs(daysUntil)}d overdue`;
            className = 'due-overdue';
        } else if (daysUntil === 0) {
            status = 'Due today';
            className = 'due-today';
        } else if (daysUntil === 1) {
            status = 'Due tomorrow';
            className = 'due-soon';
        } else if (daysUntil <= 3) {
            status = `${daysUntil}d left`;
            className = 'due-soon';
        } else {
            status = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            className = 'due-future';
        }

        return `<span class="due-date-badge ${className}">${status}</span>`;
    }

    function getDueDateStatus(dueDate) {
        const due = new Date(dueDate);
        const now = new Date();
        const daysUntil = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
        
        if (daysUntil < 0) return 'overdue';
        if (daysUntil <= 1) return 'urgent';
        if (daysUntil <= 3) return 'soon';
        return 'future';
    }

    // ==========================================
    // Task Dependency Lines
    // ==========================================

    function addTaskDependency(taskId, dependsOnId) {
        if (!taskDependencies[taskId]) {
            taskDependencies[taskId] = [];
        }
        if (!taskDependencies[taskId].includes(dependsOnId)) {
            taskDependencies[taskId].push(dependsOnId);
            saveTaskDependencies();
        }
    }

    function removeTaskDependency(taskId, dependsOnId) {
        if (taskDependencies[taskId]) {
            taskDependencies[taskId] = taskDependencies[taskId].filter(id => id !== dependsOnId);
            saveTaskDependencies();
        }
    }

    function saveTaskDependencies() {
        localStorage.setItem('solobot-task-dependencies', JSON.stringify(taskDependencies));
    }

    function loadTaskDependencies() {
        const saved = localStorage.getItem('solobot-task-dependencies');
        if (saved) {
            taskDependencies = JSON.parse(saved);
        }
    }

    function getTaskDependencies(taskId) {
        return taskDependencies[taskId] || [];
    }

    function getDependentTasks(taskId) {
        const dependent = [];
        for (const [tid, deps] of Object.entries(taskDependencies)) {
            if (deps.includes(taskId)) {
                dependent.push(tid);
            }
        }
        return dependent;
    }

    function renderDependencyIndicator(taskId) {
        const deps = getTaskDependencies(taskId);
        const dependent = getDependentTasks(taskId);
        
        if (deps.length === 0 && dependent.length === 0) return '';
        
        let indicators = [];
        if (deps.length > 0) indicators.push(`⬇️ ${deps.length}`);
        if (dependent.length > 0) indicators.push(`⬆️ ${dependent.length}`);
        
        return `<span class="dependency-indicator" title="Dependencies">${indicators.join(' ')}</span>`;
    }

    function checkDependencyBlocking(taskId, targetColumn) {
        if (targetColumn !== 'done') return true;
        
        const deps = getTaskDependencies(taskId);
        if (deps.length === 0) return true;
        
        // Check if all dependencies are done
        for (const depId of deps) {
            const depTask = findTask(depId);
            if (depTask) {
                const isDone = (state.tasks.done || []).some(t => t.id === depId);
                if (!isDone) {
                    return false;
                }
            }
        }
        return true;
    }

    // ==========================================
    // Enhanced Render Functions
    // ==========================================

    // Override renderTasks to include enhancements
    const originalRenderTasks = window.renderTasks;
    window.renderTasks = function() {
        if (swimlaneView) {
            renderSwimlaneView();
            return;
        }
        
        // Call original but with enhancements
        renderEnhancedTasks();
    };

    function renderEnhancedTasks() {
        populateAgentFilter();
        
        ['todo', 'progress', 'done'].forEach(column => {
            const container = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
            const count = document.getElementById(`${column === 'progress' ? 'progress' : column}-count`);

            if (!container) return;

            const tasks = getFilteredSortedTasks(column);
            const totalInColumn = (state.tasks[column] || []).length;

            if (tasks.length === 0) {
                const emptyMsg = totalInColumn > 0 ? 'No tasks match filters' : 'No tasks';
                container.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-6) var(--space-2);">${emptyMsg}</div>`;
                if (count) count.textContent = totalInColumn;
                return;
            }

            container.innerHTML = tasks.map((task) => {
                const isSelected = selectedTasks.has(task.id);
                const isBulkSelected = selectedTasksForBulk.has(task.id);
                const doneStyle = column === 'done' ? 'text-decoration: line-through; color: var(--text-muted);' : '';
                const agent = getTaskAgent(task);
                const agentColor = AGENT_COLORS[agent] || '#888';
                const ageDays = Math.floor((Date.now() - (task.created || 0)) / 86400000);
                const ageLabel = ageDays === 0 ? 'today' : ageDays === 1 ? '1d ago' : `${ageDays}d ago`;
                
                // Due date indicator
                const dueDateHtml = task.dueDate ? renderDueDateBadge(task.dueDate) : '';
                const dueStatus = task.dueDate ? getDueDateStatus(task.dueDate) : null;
                const pulseClass = dueStatus === 'overdue' ? 'overdue-pulse' : '';
                
                // Dependency indicator
                const depHtml = renderDependencyIndicator(task.id);
                
                // Bulk selection checkbox
                const bulkCheckbox = bulkSelectionMode ? `
                    <input type="checkbox" 
                           ${isBulkSelected ? 'checked' : ''} 
                           onclick="toggleTaskBulkSelection('${task.id}', event)"
                           style="margin-right: 6px; accent-color: var(--brand-red);">
                ` : '';

                return `
                <div class="task-card priority-p${task.priority} ${isSelected ? 'selected' : ''} ${isBulkSelected ? 'bulk-selected' : ''} ${pulseClass} ${dueStatus || ''}"
                     data-task-id="${task.id}" data-column="${column}"
                     onclick="openTaskDetail('${task.id}', '${column}')">
                    <div style="display: flex; align-items: flex-start; gap: var(--space-3);">
                        <span class="drag-handle" draggable="true"
                              ondragstart="handleDragStart(event, '${task.id}', '${column}')"
                              ondragend="handleDragEnd(event)"
                              title="Drag to move">⠿</span>
                        ${bulkCheckbox}
                        <input type="checkbox"
                               style="margin-top: 2px; accent-color: var(--brand-red); cursor: pointer;"
                               ${isSelected ? 'checked' : ''}
                               onclick="toggleTaskSelection('${task.id}', event)">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2);">
                                <span class="task-title" style="${doneStyle}">${escapeHtml(task.title)}</span>
                                <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0; flex-wrap: wrap;">
                                    ${dueDateHtml}
                                    ${depHtml}
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

            if (count) {
                count.textContent = tasks.length === totalInColumn ? totalInColumn : `${tasks.length}/${totalInColumn}`;
            }
        });
        
        updateTaskStats();
        updateBulkActionsUI();
        updateBulkSelectionUI();
        
        if (typeof updateQuickStats === 'function') {
            updateQuickStats();
        }
    }

    // ==========================================
    // UI Setup
    // ==========================================

    function setupTaskBoardToolbar() {
        const toolbar = document.getElementById('task-toolbar');
        if (!toolbar || document.getElementById('swimlane-toggle-btn')) return;

        // Add swimlane toggle button
        const swimlaneBtn = document.createElement('button');
        swimlaneBtn.id = 'swimlane-toggle-btn';
        swimlaneBtn.className = 'btn btn-ghost';
        swimlaneBtn.innerHTML = '📊';
        swimlaneBtn.title = 'Toggle Swimlane View';
        swimlaneBtn.style.cssText = 'padding: 1px 4px; font-size: 12px;';
        swimlaneBtn.onclick = toggleSwimlaneView;
        
        // Add bulk selection button
        const bulkBtn = document.createElement('button');
        bulkBtn.id = 'bulk-mode-btn';
        bulkBtn.className = 'btn btn-ghost';
        bulkBtn.innerHTML = '☑️';
        bulkBtn.title = 'Bulk Selection Mode';
        bulkBtn.style.cssText = 'padding: 1px 4px; font-size: 12px;';
        bulkBtn.onclick = () => {
            if (bulkSelectionMode) {
                disableBulkSelectionMode();
            } else {
                enableBulkSelectionMode();
            }
        };

        // Insert before stats
        const statsEl = document.getElementById('task-stats');
        if (statsEl) {
            toolbar.insertBefore(swimlaneBtn, statsEl);
            toolbar.insertBefore(bulkBtn, statsEl);
        }

        // Create bulk selection panel
        const panel = document.createElement('div');
        panel.id = 'bulk-selection-panel';
        panel.className = 'bulk-selection-panel';
        panel.style.display = 'none';
        toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
    }

    // ==========================================
    // Global Exports
    // ==========================================

    window.toggleSwimlaneView = toggleSwimlaneView;
    window.setSwimlaneGroupBy = setSwimlaneGroupBy;
    window.enableBulkSelectionMode = enableBulkSelectionMode;
    window.disableBulkSelectionMode = disableBulkSelectionMode;
    window.toggleTaskBulkSelection = toggleTaskBulkSelection;
    window.selectAllVisible = selectAllVisible;
    window.clearBulkSelection = clearBulkSelection;
    window.bulkMoveSelected = bulkMoveSelected;
    window.bulkSetPriority = bulkSetPriority;
    window.bulkAssignAgent = bulkAssignAgent;
    window.setTaskDueDate = setTaskDueDate;
    window.addTaskDependency = addTaskDependency;
    window.removeTaskDependency = removeTaskDependency;
    window.getTaskDependencies = getTaskDependencies;
    window.getDependentTasks = getDependentTasks;

    // ==========================================
    // Initialization
    // ==========================================

    function init() {
        loadTaskDependencies();
        setupTaskBoardToolbar();
        console.log('[Phase10] Task Board Enhancements initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
