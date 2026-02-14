// js/phase5-cmdpalette.js — Phase 5: Enhanced Command Palette
// Universal search, quick actions, history search

(function() {
    'use strict';

    // ===================
    // ENHANCED COMMAND PALETTE
    // ===================
    
    const CommandPalette = {
        isOpen: false,
        selectedIndex: 0,
        currentQuery: '',
        allItems: [],
        filteredItems: [],
        recentCommands: [],
        
        // Command definitions with expanded capabilities
        commands: [
            // Navigation
            { id: 'nav-dashboard', icon: '📊', title: 'Dashboard', desc: 'Go to dashboard', category: 'Navigation', shortcut: 'G D', action: () => showPage('dashboard') },
            { id: 'nav-chat', icon: '💬', title: 'Chat', desc: 'Open chat page', category: 'Navigation', shortcut: 'G C', action: () => showPage('chat') },
            { id: 'nav-memory', icon: '🧠', title: 'Memory', desc: 'Browse memory files', category: 'Navigation', shortcut: 'G M', action: () => showPage('memory') },
            { id: 'nav-system', icon: '🔧', title: 'System', desc: 'View system status', category: 'Navigation', shortcut: 'G S', action: () => showPage('system') },
            { id: 'nav-cron', icon: '⏰', title: 'Cron Jobs', desc: 'Manage scheduled tasks', category: 'Navigation', shortcut: 'G R', action: () => showPage('cron') },
            { id: 'nav-security', icon: '🔒', title: 'Security', desc: 'Security settings', category: 'Navigation', shortcut: 'G X', action: () => showPage('security') },
            { id: 'nav-skills', icon: '🎯', title: 'Skills', desc: 'Manage agent skills', category: 'Navigation', shortcut: 'G K', action: () => showPage('skills') },
            { id: 'nav-products', icon: '📦', title: 'Products', desc: 'Product management', category: 'Navigation', shortcut: 'G P', action: () => showPage('products') },
            
            // Quick Actions
            { id: 'action-task', icon: '✓', title: 'Create Task', desc: 'Add a new task', category: 'Actions', shortcut: 'T', action: () => openNewTaskDetail('todo') },
            { id: 'action-note', icon: '📝', title: 'Quick Note', desc: 'Add a quick note', category: 'Actions', shortcut: 'N', action: () => quickAddNote() },
            { id: 'action-agent-dev', icon: '👨‍💻', title: 'Switch to DEV', desc: 'Switch to developer agent', category: 'Actions', shortcut: 'A D', action: () => switchToAgent('dev') },
            { id: 'action-agent-coo', icon: '💼', title: 'Switch to COO', desc: 'Switch to operations agent', category: 'Actions', shortcut: 'A C', action: () => switchToAgent('coo') },
            { id: 'action-agent-main', icon: '🤖', title: 'Switch to Main', desc: 'Switch to main agent', category: 'Actions', shortcut: 'A M', action: () => switchToAgent('main') },
            { id: 'action-focus', icon: '🎯', title: 'Toggle Focus Timer', desc: 'Start/pause Pomodoro', category: 'Actions', shortcut: 'F', action: () => toggleFocusTimer() },
            { id: 'action-sync', icon: '🔄', title: 'Sync from VPS', desc: 'Pull latest state', category: 'Actions', shortcut: 'S', action: () => syncFromVPS() },
            { id: 'action-theme', icon: '🎨', title: 'Change Theme', desc: 'Open theme picker', category: 'Actions', shortcut: '⌘T', action: () => { closePalette(); toggleTheme(); } },
            { id: 'action-settings', icon: '⚙️', title: 'Settings', desc: 'Open settings', category: 'Actions', shortcut: '⌘,', action: () => { closePalette(); openSettingsModal(); } },
            { id: 'action-clear-console', icon: '🧹', title: 'Clear Console', desc: 'Clear terminal output', category: 'Actions', action: () => { clearConsole(); closePalette(); } },
            
            // Context Modes
            { id: 'mode-morning', icon: '🌅', title: 'Morning Mode', desc: 'Switch to morning layout', category: 'Modes', action: () => { ContextAwareness?.setTimeMode('morning'); closePalette(); } },
            { id: 'mode-deep', icon: '🔥', title: 'Deep Work Mode', desc: 'Focus mode layout', category: 'Modes', action: () => { ContextAwareness?.setTimeMode('deep-work'); closePalette(); } },
            { id: 'mode-evening', icon: '🌙', title: 'Evening Mode', desc: 'Evening layout', category: 'Modes', action: () => { ContextAwareness?.setTimeMode('evening'); closePalette(); } },
            { id: 'mode-night', icon: '💤', title: 'Night Mode', desc: 'Night layout', category: 'Modes', action: () => { ContextAwareness?.setTimeMode('night'); closePalette(); } },
        ],
        
        init() {
            this.loadRecentCommands();
            this.createPaletteElement();
            this.setupKeyboardShortcuts();
            this.setupGlobalShortcut();
        },
        
        loadRecentCommands() {
            try {
                const saved = localStorage.getItem('cmdpalette-recent');
                this.recentCommands = saved ? JSON.parse(saved) : [];
            } catch (e) {
                this.recentCommands = [];
            }
        },
        
        saveRecentCommand(commandId) {
            // Add to front, remove duplicates, keep max 10
            this.recentCommands = [commandId, ...this.recentCommands.filter(id => id !== commandId)].slice(0, 10);
            localStorage.setItem('cmdpalette-recent', JSON.stringify(this.recentCommands));
        },
        
        createPaletteElement() {
            // Remove existing if any
            const existing = document.getElementById('enhanced-command-palette');
            if (existing) existing.remove();
            
            const backdrop = document.createElement('div');
            backdrop.id = 'cmdpalette-backdrop';
            backdrop.className = 'cmdpalette-backdrop';
            backdrop.onclick = () => this.close();
            
            const palette = document.createElement('div');
            palette.id = 'enhanced-command-palette';
            palette.className = 'enhanced-command-palette';
            palette.innerHTML = `
                <div class="cmdpalette-search-wrapper">
                    <span class="cmdpalette-search-icon">⌘</span>
                    <input type="text" 
                           id="cmdpalette-input" 
                           class="cmdpalette-input" 
                           placeholder="Search commands, tasks, notes..." 
                           autocomplete="off">
                    <span class="cmdpalette-shortcut-hint">ESC to close</span>
                </div>
                <div class="cmdpalette-tabs">
                    <button class="cmdpalette-tab active" data-tab="all">All</button>
                    <button class="cmdpalette-tab" data-tab="commands">Commands</button>
                    <button class="cmdpalette-tab" data-tab="tasks">Tasks</button>
                    <button class="cmdpalette-tab" data-tab="notes">Notes</button>
                    <button class="cmdpalette-tab" data-tab="history">History</button>
                </div>
                <div id="cmdpalette-results" class="cmdpalette-results"></div>
                <div class="cmdpalette-footer">
                    <span class="cmdpalette-footer-hint">↑↓ to navigate</span>
                    <span class="cmdpalette-footer-hint">↵ to select</span>
                </div>
            `;
            
            document.body.appendChild(backdrop);
            document.body.appendChild(palette);
            
            // Setup input handlers
            const input = document.getElementById('cmdpalette-input');
            input.addEventListener('input', (e) => this.handleInput(e.target.value));
            input.addEventListener('keydown', (e) => this.handleKeydown(e));
            
            // Setup tab handlers
            palette.querySelectorAll('.cmdpalette-tab').forEach(tab => {
                tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
            });
        },
        
        setupGlobalShortcut() {
            document.addEventListener('keydown', (e) => {
                // Cmd/Ctrl + K to open
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                    e.preventDefault();
                    this.toggle();
                }
            });
        },
        
        setupKeyboardShortcuts() {
            // Vim-style navigation in palette
            document.addEventListener('keydown', (e) => {
                if (!this.isOpen) return;
                
                if (e.key === 'Escape') {
                    this.close();
                }
            });
        },
        
        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        },
        
        open() {
            this.isOpen = true;
            this.selectedIndex = 0;
            this.currentQuery = '';
            
            const backdrop = document.getElementById('cmdpalette-backdrop');
            const palette = document.getElementById('enhanced-command-palette');
            const input = document.getElementById('cmdpalette-input');
            
            backdrop?.classList.add('visible');
            palette?.classList.add('visible');
            
            // Reset to all tab
            this.switchTab('all');
            
            // Focus input
            setTimeout(() => input?.focus(), 50);
            
            // Initial render with recent commands
            this.buildAllItems();
            this.filterItems('');
        },
        
        close() {
            this.isOpen = false;
            
            const backdrop = document.getElementById('cmdpalette-backdrop');
            const palette = document.getElementById('enhanced-command-palette');
            
            backdrop?.classList.remove('visible');
            palette?.classList.remove('visible');
        },
        
        switchTab(tab) {
            document.querySelectorAll('.cmdpalette-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.tab === tab);
            });
            
            this.currentTab = tab;
            this.filterItems(this.currentQuery);
        },
        
        buildAllItems() {
            this.allItems = [];
            
            // Add commands
            this.commands.forEach(cmd => {
                this.allItems.push({
                    type: 'command',
                    id: cmd.id,
                    icon: cmd.icon,
                    title: cmd.title,
                    desc: cmd.desc,
                    category: cmd.category,
                    shortcut: cmd.shortcut,
                    action: cmd.action,
                    searchable: `${cmd.title} ${cmd.desc} ${cmd.category}`.toLowerCase()
                });
            });
            
            // Add tasks from state
            if (window.state?.tasks) {
                Object.entries(window.state.tasks).forEach(([column, tasks]) => {
                    tasks.forEach(task => {
                        this.allItems.push({
                            type: 'task',
                            id: task.id,
                            icon: column === 'done' ? '✓' : column === 'progress' ? '▶' : '○',
                            title: task.title,
                            desc: `${column} • P${task.priority || 1}${task.agent ? ` • ${task.agent}` : ''}`,
                            category: 'Tasks',
                            action: () => {
                                this.close();
                                setTimeout(() => openTaskDetail(task.id, column), 100);
                            },
                            searchable: `${task.title} ${task.description || ''}`.toLowerCase()
                        });
                    });
                });
            }
            
            // Add notes
            if (window.state?.notes) {
                window.state.notes.forEach(note => {
                    this.allItems.push({
                        type: 'note',
                        id: note.id,
                        icon: '📝',
                        title: note.text?.substring(0, 50) || 'Note',
                        desc: new Date(note.time).toLocaleString(),
                        category: 'Notes',
                        action: () => {
                            this.close();
                            showPage('dashboard');
                        },
                        searchable: note.text?.toLowerCase() || ''
                    });
                });
            }
            
            // Add chat history search
            if (window.state?.chat?.messages) {
                const recentMessages = window.state.chat.messages.slice(-20);
                recentMessages.forEach((msg, idx) => {
                    if (msg.text) {
                        this.allItems.push({
                            type: 'history',
                            id: `chat-${idx}`,
                            icon: msg.role === 'user' ? '👤' : '🤖',
                            title: msg.text.substring(0, 60),
                            desc: `${msg.role} • ${new Date(msg.time).toLocaleString()}`,
                            category: 'History',
                            action: () => {
                                this.close();
                                showPage('chat');
                            },
                            searchable: msg.text.toLowerCase()
                        });
                    }
                });
            }
        },
        
        handleInput(value) {
            this.currentQuery = value;
            this.filterItems(value);
        },
        
        filterItems(query) {
            const q = query.toLowerCase().trim();
            
            // Filter by tab and query
            let items = this.allItems;
            
            // Apply tab filter
            if (this.currentTab && this.currentTab !== 'all') {
                const typeMap = {
                    'commands': 'command',
                    'tasks': 'task',
                    'notes': 'note',
                    'history': 'history'
                };
                const targetType = typeMap[this.currentTab];
                if (targetType) {
                    items = items.filter(item => item.type === targetType);
                }
            }
            
            // Apply search filter
            if (q) {
                items = items.filter(item => item.searchable?.includes(q));
                
                // Sort by relevance (title match prioritizes)
                items.sort((a, b) => {
                    const aInTitle = a.title.toLowerCase().includes(q);
                    const bInTitle = b.title.toLowerCase().includes(q);
                    if (aInTitle && !bInTitle) return -1;
                    if (!aInTitle && bInTitle) return 1;
                    return 0;
                });
            } else {
                // No query: show recent commands first, then categorized
                const recentIds = new Set(this.recentCommands);
                items.sort((a, b) => {
                    const aRecent = recentIds.has(a.id);
                    const bRecent = recentIds.has(b.id);
                    if (aRecent && !bRecent) return -1;
                    if (!aRecent && bRecent) return 1;
                    return 0;
                });
            }
            
            this.filteredItems = items.slice(0, 20); // Limit results
            this.selectedIndex = 0;
            this.renderResults();
        },
        
        renderResults() {
            const container = document.getElementById('cmdpalette-results');
            if (!container) return;
            
            if (this.filteredItems.length === 0) {
                container.innerHTML = `
                    <div class="cmdpalette-empty">
                        <span class="cmdpalette-empty-icon">🔍</span>
                        <span>No results found</span>
                    </div>
                `;
                return;
            }
            
            // Group by category when no search query
            let html = '';
            let currentCategory = null;
            
            this.filteredItems.forEach((item, idx) => {
                // Add category header when category changes (only for commands with no query)
                if (!this.currentQuery && item.category && item.category !== currentCategory) {
                    currentCategory = item.category;
                    html += `<div class="cmdpalette-category">${currentCategory}</div>`;
                }
                
                const isSelected = idx === this.selectedIndex;
                html += `
                    <div class="cmdpalette-item ${isSelected ? 'selected' : ''}" 
                         data-index="${idx}"
                         onclick="CommandPalette.selectItem(${idx})">
                        <span class="cmdpalette-item-icon">${item.icon}</span>
                        <div class="cmdpalette-item-content">
                            <div class="cmdpalette-item-title">
                                ${this.highlightMatch(item.title, this.currentQuery)}
                            </div>
                            <div class="cmdpalette-item-desc">${item.desc}</div>
                        </div>
                        ${item.shortcut ? `<span class="cmdpalette-item-shortcut">${item.shortcut}</span>` : ''}
                    </div>
                `;
            });
            
            container.innerHTML = html;
        },
        
        highlightMatch(text, query) {
            if (!query) return text;
            const regex = new RegExp(`(${query})`, 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        },
        
        handleKeydown(e) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredItems.length - 1);
                    this.updateSelection();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                    this.updateSelection();
                    break;
                case 'Enter':
                    e.preventDefault();
                    this.executeSelected();
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.close();
                    break;
            }
        },
        
        updateSelection() {
            document.querySelectorAll('.cmdpalette-item').forEach((el, idx) => {
                el.classList.toggle('selected', idx === this.selectedIndex);
                if (idx === this.selectedIndex) {
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        },
        
        selectItem(index) {
            this.selectedIndex = index;
            this.executeSelected();
        },
        
        executeSelected() {
            const item = this.filteredItems[this.selectedIndex];
            if (!item) return;
            
            // Save to recent
            if (item.id) {
                this.saveRecentCommand(item.id);
            }
            
            // Execute action
            if (item.action) {
                item.action();
            }
        }
    };

    // ===================
    // QUICK ACTIONS HELPERS
    // ===================
    
    function quickAddNote() {
        const noteInput = document.getElementById('note-input');
        if (noteInput) {
            noteInput.focus();
            // Scroll to notes widget
            const notesWidget = document.querySelector('.bento-notes');
            if (notesWidget) {
                notesWidget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
    
    function switchToAgent(agent) {
        if (typeof switchToSession === 'function') {
            const sessionKey = `agent:${agent}:main`;
            switchToSession(sessionKey);
            showToast(`Switched to ${agent.toUpperCase()} agent`, 'success');
        }
    }
    
    // ===================
    // EXPOSE GLOBALLY
    // ===================
    
    window.CommandPalette = CommandPalette;
    window.quickAddNote = quickAddNote;
    window.switchToAgent = switchToAgent;
    
    // Legacy command palette compatibility
    window.openCommandPalette = () => CommandPalette.open();
    window.closeCommandPalette = () => CommandPalette.close();
    
    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        CommandPalette.init();
        console.log('[Phase 5] Command Palette initialized');
    });

})();