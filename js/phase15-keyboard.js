/**
 * Phase 15: Keyboard Shortcuts
 * - Global shortcut overlay (show on ?)
 * - Navigate between widgets with arrow keys
 * - Quick-add task with keyboard (n)
 * - Toggle sidebar/panels (b)
 * - Focus search (/)
 */

(function() {
    'use strict';

    // =================== KEYBOARD SHORTCUTS MANAGER ===================
    
    const KeyboardShortcuts = {
        shortcuts: {},
        isOverlayOpen: false,
        focusedWidgetIndex: -1,
        widgets: [],
        
        // Default shortcuts configuration
        defaultShortcuts: {
            '?': { action: 'toggleHelp', description: 'Show/hide keyboard shortcuts', global: true },
            'Escape': { action: 'closeModal', description: 'Close modal/overlay', global: true },
            'n': { action: 'newTask', description: 'Quick-add new task', global: true },
            'b': { action: 'toggleSidebar', description: 'Toggle sidebar', global: true },
            '/': { action: 'focusSearch', description: 'Focus search', global: true },
            'ArrowUp': { action: 'navigateUp', description: 'Navigate up', context: 'widget' },
            'ArrowDown': { action: 'navigateDown', description: 'Navigate down', context: 'widget' },
            'ArrowLeft': { action: 'navigateLeft', description: 'Navigate left', context: 'widget' },
            'ArrowRight': { action: 'navigateRight', description: 'Navigate right', context: 'widget' },
            'Enter': { action: 'selectWidget', description: 'Open/select widget', context: 'widget' },
            't': { action: 'toggleTheme', description: 'Toggle theme', global: true },
            'g d': { action: 'goDashboard', description: 'Go to Dashboard', global: true },
            'g t': { action: 'goTasks', description: 'Go to Tasks', global: true },
            'g m': { action: 'goMemory', description: 'Go to Memory', global: true },
            'g c': { action: 'goChat', description: 'Go to Chat', global: true },
            'g s': { action: 'goSystem', description: 'Go to System', global: true },
            '1': { action: 'goPage', params: ['dashboard'], description: 'Go to Dashboard', global: true },
            '2': { action: 'goPage', params: ['memory'], description: 'Go to Memory', global: true },
            '3': { action: 'goPage', params: ['chat'], description: 'Go to Chat', global: true },
            '4': { action: 'goPage', params: ['system'], description: 'Go to System', global: true },
            '5': { action: 'goPage', params: ['cron'], description: 'Go to Cron', global: true },
            '6': { action: 'goPage', params: ['security'], description: 'Go to Security', global: true },
            '7': { action: 'goPage', params: ['skills'], description: 'Go to Skills', global: true },
        },
        
        init() {
            this.shortcuts = { ...this.defaultShortcuts };
            this.addStyles();
            this.setupEventListeners();
            this.updateWidgetList();
            console.log('[Phase 15] Keyboard shortcuts initialized');
        },
        
        addStyles() {
            if (document.getElementById('keyboard-shortcuts-styles')) return;
            
            const styles = document.createElement('style');
            styles.id = 'keyboard-shortcuts-styles';
            styles.textContent = `
                /* Keyboard Shortcuts Overlay */
                .shortcuts-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(8px);
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    visibility: hidden;
                    transition: opacity 0.2s ease, visibility 0.2s ease;
                }
                
                .shortcuts-overlay.visible {
                    opacity: 1;
                    visibility: visible;
                }
                
                .shortcuts-modal {
                    background: var(--surface-1);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-xl);
                    width: 90%;
                    max-width: 700px;
                    max-height: 85vh;
                    overflow: hidden;
                    box-shadow: var(--shadow-xl);
                    transform: scale(0.95);
                    transition: transform 0.2s ease;
                }
                
                .shortcuts-overlay.visible .shortcuts-modal {
                    transform: scale(1);
                }
                
                .shortcuts-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 20px 24px;
                    border-bottom: 1px solid var(--border-default);
                }
                
                .shortcuts-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-primary);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .shortcuts-close {
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    font-size: 24px;
                    cursor: pointer;
                    padding: 4px;
                    line-height: 1;
                    transition: color 0.15s;
                }
                
                .shortcuts-close:hover {
                    color: var(--text-primary);
                }
                
                .shortcuts-body {
                    padding: 20px 24px;
                    overflow-y: auto;
                    max-height: calc(85vh - 80px);
                }
                
                .shortcuts-search {
                    margin-bottom: 20px;
                }
                
                .shortcuts-search input {
                    width: 100%;
                    padding: 10px 14px;
                    background: var(--surface-2);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-md);
                    color: var(--text-primary);
                    font-size: 14px;
                }
                
                .shortcuts-search input:focus {
                    outline: none;
                    border-color: var(--brand-red);
                    box-shadow: 0 0 0 3px rgba(229, 57, 53, 0.1);
                }
                
                .shortcuts-section {
                    margin-bottom: 24px;
                }
                
                .shortcuts-section-title {
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    color: var(--text-muted);
                    margin-bottom: 12px;
                }
                
                .shortcuts-list {
                    display: grid;
                    gap: 8px;
                }
                
                .shortcut-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    background: var(--surface-2);
                    border-radius: var(--radius-md);
                    transition: background 0.15s;
                }
                
                .shortcut-item:hover {
                    background: var(--surface-3);
                }
                
                .shortcut-description {
                    font-size: 14px;
                    color: var(--text-secondary);
                }
                
                .shortcut-keys {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                
                .kbd {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 28px;
                    height: 28px;
                    padding: 0 8px;
                    background: var(--surface-3);
                    border: 1px solid var(--border-strong);
                    border-radius: var(--radius-sm);
                    font-family: ui-monospace, monospace;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-primary);
                    box-shadow: 0 2px 0 var(--border-default);
                }
                
                .kbd-sm {
                    min-width: 22px;
                    height: 22px;
                    padding: 0 6px;
                    font-size: 11px;
                }
                
                /* Widget Focus Indicator */
                .bento-widget.focused {
                    outline: 2px solid var(--brand-red);
                    outline-offset: 2px;
                    box-shadow: 0 0 20px rgba(229, 57, 53, 0.2);
                }
                
                .bento-widget {
                    transition: outline 0.15s, box-shadow 0.15s;
                }
                
                /* Search Focus Indicator */
                .search-highlight {
                    animation: search-pulse 0.5s ease;
                }
                
                @keyframes search-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(229, 57, 53, 0.4); }
                    50% { box-shadow: 0 0 0 4px rgba(229, 57, 53, 0.1); }
                }
                
                /* Keyboard shortcut hint badges */
                .key-hint {
                    position: absolute;
                    top: 4px;
                    right: 4px;
                    background: var(--surface-3);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-sm);
                    padding: 2px 6px;
                    font-size: 10px;
                    font-family: ui-monospace, monospace;
                    color: var(--text-muted);
                    opacity: 0;
                    transition: opacity 0.15s;
                }
                
                body.show-key-hints .key-hint {
                    opacity: 1;
                }
                
                /* Shortcut toast notification */
                .shortcut-toast {
                    position: fixed;
                    bottom: 24px;
                    left: 50%;
                    transform: translateX(-50%) translateY(100px);
                    background: var(--surface-2);
                    border: 1px solid var(--border-default);
                    border-radius: var(--radius-lg);
                    padding: 12px 20px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    box-shadow: var(--shadow-lg);
                    z-index: 999;
                    transition: transform 0.3s ease;
                }
                
                .shortcut-toast.visible {
                    transform: translateX(-50%) translateY(0);
                }
                
                .shortcut-toast-icon {
                    width: 24px;
                    height: 24px;
                    background: var(--brand-red);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                }
                
                .shortcut-toast-text {
                    font-size: 14px;
                    color: var(--text-primary);
                }
            `;
            document.head.appendChild(styles);
        },
        
        setupEventListeners() {
            // Track modifier keys
            this.modifiers = {
                ctrl: false,
                alt: false,
                shift: false,
                meta: false
            };
            
            document.addEventListener('keydown', (e) => this.handleKeyDown(e));
            document.addEventListener('keyup', (e) => this.handleKeyUp(e));
            
            // Handle modifier keys
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Control') this.modifiers.ctrl = true;
                if (e.key === 'Alt') this.modifiers.alt = true;
                if (e.key === 'Shift') this.modifiers.shift = true;
                if (e.key === 'Meta') this.modifiers.meta = true;
            });
            
            document.addEventListener('keyup', (e) => {
                if (e.key === 'Control') this.modifiers.ctrl = false;
                if (e.key === 'Alt') this.modifiers.alt = false;
                if (e.key === 'Shift') this.modifiers.shift = false;
                if (e.key === 'Meta') this.modifiers.meta = false;
            });
            
            // Update widget list when DOM changes
            const observer = new MutationObserver(() => {
                this.updateWidgetList();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        },
        
        handleKeyDown(e) {
            // Don't trigger shortcuts when typing in input fields
            if (this.isTyping(e.target)) {
                // Except for Escape and some navigation
                if (e.key !== 'Escape' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
                    return;
                }
            }
            
            const key = this.getKeyString(e);
            const shortcut = this.shortcuts[key];
            
            if (shortcut) {
                e.preventDefault();
                this.executeAction(shortcut.action, shortcut.params);
            }
            
            // Handle vim-style navigation in widget context
            if (this.focusedWidgetIndex >= 0) {
                if (e.key === 'j') this.navigateDown();
                if (e.key === 'k') this.navigateUp();
                if (e.key === 'h') this.navigateLeft();
                if (e.key === 'l') this.navigateRight();
            }
        },
        
        handleKeyUp(e) {
            // Clean up
        },
        
        getKeyString(e) {
            const parts = [];
            
            // Handle sequences (like 'g d')
            if (this.pendingSequence) {
                const sequence = this.pendingSequence + ' ' + e.key.toLowerCase();
                this.pendingSequence = null;
                return sequence;
            }
            
            // Check for sequence starters
            if (e.key.toLowerCase() === 'g' && !this.isTyping(e.target)) {
                this.pendingSequence = 'g';
                setTimeout(() => { this.pendingSequence = null; }, 500);
                return null;
            }
            
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey && e.key.length > 1) parts.push('Shift');
            if (e.metaKey) parts.push('Cmd');
            
            // Special keys
            const specialKeys = {
                'ArrowUp': '↑',
                'ArrowDown': '↓',
                'ArrowLeft': '←',
                'ArrowRight': '→',
                'Enter': 'Enter',
                'Escape': 'Escape',
                'Tab': 'Tab',
                'Backspace': 'Backspace',
                'Delete': 'Delete',
                ' ': 'Space'
            };
            
            let key = specialKeys[e.key] || e.key;
            
            // For single character keys, preserve case if Shift is the only modifier
            if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                return key.toLowerCase();
            }
            
            parts.push(key);
            return parts.join('+');
        },
        
        isTyping(element) {
            return element && (
                element.tagName === 'INPUT' ||
                element.tagName === 'TEXTAREA' ||
                element.contentEditable === 'true'
            );
        },
        
        executeAction(action, params = []) {
            const actions = {
                toggleHelp: () => this.toggleOverlay(),
                closeModal: () => this.closeModal(),
                newTask: () => this.newTask(),
                toggleSidebar: () => this.toggleSidebar(),
                focusSearch: () => this.focusSearch(),
                toggleTheme: () => this.toggleTheme(),
                navigateUp: () => this.navigateUp(),
                navigateDown: () => this.navigateDown(),
                navigateLeft: () => this.navigateLeft(),
                navigateRight: () => this.navigateRight(),
                selectWidget: () => this.selectWidget(),
                goDashboard: () => this.goPage('dashboard'),
                goTasks: () => this.goPage('dashboard'),
                goMemory: () => this.goPage('memory'),
                goChat: () => this.goPage('chat'),
                goSystem: () => this.goPage('system'),
                goPage: (page) => this.goPage(page)
            };
            
            if (actions[action]) {
                actions[action](...params);
                this.showToast(action);
            }
        },
        
        // =================== ACTIONS ===================
        
        toggleOverlay() {
            if (this.isOverlayOpen) {
                this.closeOverlay();
            } else {
                this.openOverlay();
            }
        },
        
        openOverlay() {
            if (document.getElementById('shortcuts-overlay')) {
                document.getElementById('shortcuts-overlay').classList.add('visible');
            } else {
                this.createOverlay();
            }
            this.isOverlayOpen = true;
            
            // Focus search input
            setTimeout(() => {
                const search = document.getElementById('shortcuts-search');
                if (search) search.focus();
            }, 100);
        },
        
        closeOverlay() {
            const overlay = document.getElementById('shortcuts-overlay');
            if (overlay) overlay.classList.remove('visible');
            this.isOverlayOpen = false;
        },
        
        createOverlay() {
            const overlay = document.createElement('div');
            overlay.id = 'shortcuts-overlay';
            overlay.className = 'shortcuts-overlay';
            
            const shortcutsByCategory = {
                'Navigation': [
                    { key: '?', desc: 'Show/hide this help' },
                    { key: '1-7', desc: 'Go to page (Dashboard, Memory, Chat, etc.)' },
                    { key: 'g d', desc: 'Go to Dashboard' },
                    { key: 'g m', desc: 'Go to Memory' },
                    { key: 'g c', desc: 'Go to Chat' },
                    { key: 'g s', desc: 'Go to System' },
                ],
                'Actions': [
                    { key: 'n', desc: 'Quick-add new task' },
                    { key: '/', desc: 'Focus search' },
                    { key: 'b', desc: 'Toggle sidebar' },
                    { key: 't', desc: 'Toggle theme' },
                    { key: 'Esc', desc: 'Close modal or overlay' },
                ],
                'Widget Navigation': [
                    { key: '↑ or k', desc: 'Navigate up' },
                    { key: '↓ or j', desc: 'Navigate down' },
                    { key: '← or h', desc: 'Navigate left' },
                    { key: '→ or l', desc: 'Navigate right' },
                    { key: 'Enter', desc: 'Open/select focused widget' },
                ]
            };
            
            let sectionsHtml = '';
            for (const [category, items] of Object.entries(shortcutsByCategory)) {
                sectionsHtml += `
                    <div class="shortcuts-section">
                        <div class="shortcuts-section-title">${category}</div>
                        <div class="shortcuts-list">
                            ${items.map(item => `
                                <div class="shortcut-item">
                                    <span class="shortcut-description">${item.desc}</span>
                                    <span class="shortcut-keys">
                                        ${item.key.split(' or ').map(k => `<span class="kbd">${k}</span>`).join('<span style="color: var(--text-muted); margin: 0 4px;">or</span>')}
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
            
            overlay.innerHTML = `
                <div class="shortcuts-modal">
                    <div class="shortcuts-header">
                        <div class="shortcuts-title">
                            <span>⌨️</span>
                            Keyboard Shortcuts
                        </div>
                        <button class="shortcuts-close" onclick="KeyboardShortcuts.closeOverlay()">×</button>
                    </div>
                    <div class="shortcuts-body">
                        <div class="shortcuts-search">
                            <input type="text" id="shortcuts-search" placeholder="Search shortcuts...">
                        </div>
                        ${sectionsHtml}
                    </div>
                </div>
            `;
            
            // Close on backdrop click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeOverlay();
            });
            
            // Search functionality
            setTimeout(() => {
                const searchInput = overlay.querySelector('#shortcuts-search');
                if (searchInput) {
                    searchInput.addEventListener('input', (e) => {
                        this.filterShortcuts(e.target.value);
                    });
                }
            }, 0);
            
            document.body.appendChild(overlay);
        },
        
        filterShortcuts(query) {
            const items = document.querySelectorAll('.shortcut-item');
            const lowerQuery = query.toLowerCase();
            
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(lowerQuery) ? 'flex' : 'none';
            });
            
            // Hide empty sections
            document.querySelectorAll('.shortcuts-section').forEach(section => {
                const visibleItems = section.querySelectorAll('.shortcut-item:not([style*="none"])');
                section.style.display = visibleItems.length > 0 ? 'block' : 'none';
            });
        },
        
        closeModal() {
            // Close any open modals
            document.querySelectorAll('.modal-overlay.visible').forEach(modal => {
                modal.classList.remove('visible');
            });
            this.closeOverlay();
        },
        
        newTask() {
            if (window.openNewTaskDetail) {
                window.openNewTaskDetail('todo');
            }
        },
        
        toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('collapsed');
                localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
            }
        },
        
        focusSearch() {
            const searchInput = document.getElementById('task-search') || 
                               document.getElementById('memory-search');
            if (searchInput) {
                searchInput.focus();
                searchInput.classList.add('search-highlight');
                setTimeout(() => searchInput.classList.remove('search-highlight'), 500);
            }
        },
        
        toggleTheme() {
            if (window.toggleTheme) {
                window.toggleTheme();
            }
        },
        
        updateWidgetList() {
            this.widgets = Array.from(document.querySelectorAll('.bento-widget'));
        },
        
        navigateUp() {
            this.focusWidget(this.focusedWidgetIndex - 1);
        },
        
        navigateDown() {
            this.focusWidget(this.focusedWidgetIndex + 1);
        },
        
        navigateLeft() {
            // Find widget to the left in the grid
            const current = this.widgets[this.focusedWidgetIndex];
            if (!current) return;
            
            const currentRect = current.getBoundingClientRect();
            let closest = null;
            let closestDistance = Infinity;
            
            this.widgets.forEach((widget, index) => {
                if (index === this.focusedWidgetIndex) return;
                const rect = widget.getBoundingClientRect();
                
                // Check if widget is to the left
                if (rect.right <= currentRect.left) {
                    const distance = Math.hypot(
                        rect.left - currentRect.left,
                        rect.top - currentRect.top
                    );
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closest = index;
                    }
                }
            });
            
            if (closest !== null) {
                this.focusWidget(closest);
            }
        },
        
        navigateRight() {
            // Find widget to the right in the grid
            const current = this.widgets[this.focusedWidgetIndex];
            if (!current) return;
            
            const currentRect = current.getBoundingClientRect();
            let closest = null;
            let closestDistance = Infinity;
            
            this.widgets.forEach((widget, index) => {
                if (index === this.focusedWidgetIndex) return;
                const rect = widget.getBoundingClientRect();
                
                // Check if widget is to the right
                if (rect.left >= currentRect.right) {
                    const distance = Math.hypot(
                        rect.left - currentRect.left,
                        rect.top - currentRect.top
                    );
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closest = index;
                    }
                }
            });
            
            if (closest !== null) {
                this.focusWidget(closest);
            }
        },
        
        focusWidget(index) {
            // Remove current focus
            this.widgets.forEach(w => w.classList.remove('focused'));
            
            // Clamp index
            if (index < 0) index = 0;
            if (index >= this.widgets.length) index = this.widgets.length - 1;
            
            this.focusedWidgetIndex = index;
            const widget = this.widgets[index];
            
            if (widget) {
                widget.classList.add('focused');
                widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },
        
        selectWidget() {
            const widget = this.widgets[this.focusedWidgetIndex];
            if (!widget) return;
            
            // Trigger appropriate action based on widget type
            if (widget.classList.contains('bento-task-board')) {
                this.newTask();
            } else if (widget.querySelector('.bento-widget-content')) {
                // Try to find a primary action button
                const btn = widget.querySelector('.btn-primary, .btn-icon');
                if (btn) btn.click();
            }
        },
        
        goPage(page) {
            if (window.showPage) {
                window.showPage(page);
            }
        },
        
        showToast(action) {
            const messages = {
                toggleHelp: 'Keyboard shortcuts',
                newTask: 'New task',
                toggleSidebar: 'Sidebar toggled',
                focusSearch: 'Search focused',
                toggleTheme: 'Theme changed',
                goDashboard: 'Dashboard',
                goMemory: 'Memory',
                goChat: 'Chat',
                goSystem: 'System'
            };
            
            const message = messages[action];
            if (!message) return;
            
            // Remove existing toast
            const existing = document.querySelector('.shortcut-toast');
            if (existing) existing.remove();
            
            const toast = document.createElement('div');
            toast.className = 'shortcut-toast';
            toast.innerHTML = `
                <div class="shortcut-toast-icon">⌨️</div>
                <span class="shortcut-toast-text">${message}</span>
            `;
            
            document.body.appendChild(toast);
            
            // Animate in
            requestAnimationFrame(() => {
                toast.classList.add('visible');
            });
            
            // Remove after delay
            setTimeout(() => {
                toast.classList.remove('visible');
                setTimeout(() => toast.remove(), 300);
            }, 1500);
        }
    };

    // =================== INITIALIZATION ===================
    
    document.addEventListener('DOMContentLoaded', () => {
        KeyboardShortcuts.init();
        
        // Expose globally
        window.KeyboardShortcuts = KeyboardShortcuts;
        
        console.log('[Phase 15] Keyboard shortcuts loaded - press "?" for help');
    });
})();