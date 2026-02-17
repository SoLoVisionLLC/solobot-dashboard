// js/notion-kanban.js — Notion KANBAN Widget
// Fetches tasks from Notion and renders as a KANBAN board

(function() {
    'use strict';

    // ===================
    // NOTION KANBAN WIDGET
    // ===================

    class NotionKabanWidget {
        constructor(container) {
            this.container = container;
            this.tasks = [];
            this.loading = true;
            this.error = null;
            this.refreshInterval = null;
            this.init();
        }

        async init() {
            this.renderLoading();
            await this.fetchTasks();
            this.render();
            this.startAutoRefresh();
        }

        async fetchTasks() {
            try {
                const response = await fetch('/api/notion/tasks');
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }
                
                this.tasks = data.tasks || [];
                this.cached = data.cached || false;
                this.loading = false;
            } catch (err) {
                this.error = err.message;
                this.loading = false;
            }
        }

        renderLoading() {
            this.container.innerHTML = `
                <div class="notion-kanban-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading Notion tasks...</p>
                </div>
            `;
        }

        renderError() {
            this.container.innerHTML = `
                <div class="notion-kanban-error">
                    <span class="error-icon">⚠️</span>
                    <p>Failed to load Notion tasks</p>
                    <small>${this.error}</small>
                    <button onclick="notionKanbanWidget.refresh()" class="btn btn-ghost">Retry</button>
                </div>
            `;
        }

        render() {
            if (this.loading) {
                this.renderLoading();
                return;
            }

            if (this.error) {
                this.renderError();
                return;
            }

            // Group tasks by status
            const columns = {
                'Todo': this.tasks.filter(t => !t.status || t.status === 'Todo'),
                'Doing': this.tasks.filter(t => t.status === 'Doing'),
                'Done': this.tasks.filter(t => t.status === 'Done')
            };

            this.container.innerHTML = `
                <div class="notion-kanban-header">
                    <div class="notion-kanban-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                        </svg>
                        Notion Tasks
                    </div>
                    <div class="notion-kanban-actions">
                        <button onclick="notionKanbanWidget.refresh()" class="btn btn-ghost" title="Refresh">
                            🔄
                        </button>
                        <a href="https://www.notion.so/5cc6c5a18d7448e9a6924a40cff496a0" target="_blank" class="btn btn-ghost" title="Open in Notion">
                            📝
                        </a>
                    </div>
                </div>
                <div class="notion-kanban-board">
                    ${this.renderColumn('Todo', columns['Todo'], '#f59e0b')}
                    ${this.renderColumn('Doing', columns['Doing'], '#3b82f6')}
                    ${this.renderColumn('Done', columns['Done'], '#22c55e')}
                </div>
                <div class="notion-kanban-footer">
                    <small class="cache-indicator">${this.cached ? '📦 Cached' : '🔄 Live'}</small>
                </div>
            `;
        }

        renderColumn(title, tasks, color) {
            return `
                <div class="notion-kanban-column">
                    <div class="notion-kanban-column-header" style="border-top: 3px solid ${color}">
                        <span class="column-title">${title}</span>
                        <span class="column-count">${tasks.length}</span>
                    </div>
                    <div class="notion-kanban-cards">
                        ${tasks.map(task => this.renderTaskCard(task)).join('')}
                        ${tasks.length === 0 ? '<div class="notion-kanban-empty">No tasks</div>' : ''}
                    </div>
                </div>
            `;
        }

        renderTaskCard(task) {
            const priorityColors = ['#ef4444', '#f59e0b', '#3b82f6', '#6b7280'];
            const priority = task.priority ?? 2;
            const priorityColor = priorityColors[priority] || priorityColors[2];
            
            return `
                <div class="notion-kanban-card" onclick="window.open('${task.url}', '_blank')">
                    <div class="notion-kanban-card-header">
                        <span class="priority-badge" style="background: ${priorityColor}">P${priority}</span>
                        ${task.owner ? `<span class="owner-badge">${task.owner}</span>` : ''}
                    </div>
                    <div class="notion-kanban-card-title">${this.escapeHtml(task.title)}</div>
                    ${task.description ? `<div class="notion-kanban-card-desc">${this.escapeHtml(task.description.slice(0, 60))}${task.description.length > 60 ? '...' : ''}</div>` : ''}
                    ${task.dueDate ? `<div class="due-date">📅 ${new Date(task.dueDate).toLocaleDateString()}</div>` : ''}
                </div>
            `;
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        async refresh() {
            this.loading = true;
            this.error = null;
            this.renderLoading();
            await this.fetchTasks();
            this.render();
        }

        startAutoRefresh() {
            // Refresh every 60 seconds
            this.refreshInterval = setInterval(() => {
                this.fetchTasks().then(() => {
                    if (!this.loading && !this.error) {
                        this.render();
                    }
                });
            }, 60000);
        }

        destroy() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
        }
    }

    // ===================
    // INITIALIZATION
    // ===================

    let widgetInstance = null;

    function initNotionKanbanWidget() {
        const container = document.getElementById('notion-kanban-widget');
        if (!container) return;

        // Only initialize once
        if (widgetInstance) {
            widgetInstance.destroy();
        }

        widgetInstance = new NotionKabanWidget(container);
        window.notionKanbanWidget = widgetInstance;
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNotionKanbanWidget);
    } else {
        initNotionKanbanWidget();
    }

    // Export for manual initialization
    window.initNotionKanbanWidget = initNotionKanbanWidget;

})();
