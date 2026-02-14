// ========================================
// PHASE 3: WIDGET SYSTEM
// Resizable/minimizable, layout persistence, drag-to-rearrange, focus mode
// ========================================

/**
 * Widget System - Advanced widget management with layout persistence
 */
const WidgetSystem = {
    // State
    state: {
        widgets: new Map(),
        layout: {},
        focusMode: false,
        minimizedWidgets: new Set(),
        isDragging: false,
        draggedWidget: null,
        dragSourceIndex: -1
    },

    // Configuration
    config: {
        storageKey: 'solobot-widget-layout',
        resizeHandleSize: 8,
        minWidth: 200,
        minHeight: 150,
        snapThreshold: 20
    },

    /**
     * Initialize widget system
     */
    init() {
        this.loadLayout();
        this.setupWidgetControls();
        this.setupDragToRearrange();
        this.setupResizable();
        this.setupFocusMode();
        this.applySavedLayout();
        this.addWidgetToolbar();
    },

    // ==================== LAYOUT PERSISTENCE ====================

    /**
     * Load saved layout from localStorage
     */
    loadLayout() {
        try {
            const saved = localStorage.getItem(this.config.storageKey);
            if (saved) {
                this.state.layout = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load widget layout:', e);
            this.state.layout = {};
        }
    },

    /**
     * Save current layout to localStorage
     */
    saveLayout() {
        try {
            const widgets = document.querySelectorAll('.bento-widget');
            const layout = {};

            widgets.forEach((widget, index) => {
                const widgetId = this.getWidgetId(widget);
                layout[widgetId] = {
                    index: index,
                    minimized: widget.classList.contains('widget-minimized'),
                    width: widget.style.width || null,
                    height: widget.style.height || null,
                    gridColumn: widget.style.gridColumn || null,
                    gridRow: widget.style.gridRow || null,
                    order: widget.style.order || null
                };
            });

            this.state.layout = layout;
            localStorage.setItem(this.config.storageKey, JSON.stringify(layout));
        } catch (e) {
            console.warn('Failed to save widget layout:', e);
        }
    },

    /**
     * Get unique ID for a widget
     */
    getWidgetId(widget) {
        // Try to find existing ID
        let id = widget.dataset.widgetId;
        if (!id) {
            // Generate ID from class or content
            const classes = Array.from(widget.classList);
            const bentoClass = classes.find(c => c.startsWith('bento-') && c !== 'bento-widget');
            id = bentoClass || `widget-${Math.random().toString(36).substr(2, 9)}`;
            widget.dataset.widgetId = id;
        }
        return id;
    },

    /**
     * Apply saved layout to widgets
     */
    applySavedLayout() {
        const widgets = document.querySelectorAll('.bento-widget');
        const grid = document.querySelector('.bento-grid');
        
        if (!grid || Object.keys(this.state.layout).length === 0) return;

        // Sort widgets based on saved order
        const widgetArray = Array.from(widgets);
        
        widgetArray.forEach(widget => {
            const widgetId = this.getWidgetId(widget);
            const savedConfig = this.state.layout[widgetId];
            
            if (savedConfig) {
                // Apply minimized state
                if (savedConfig.minimized) {
                    this.minimizeWidget(widget, false);
                }
                
                // Apply custom dimensions
                if (savedConfig.width) widget.style.width = savedConfig.width;
                if (savedConfig.height) widget.style.height = savedConfig.height;
                if (savedConfig.gridColumn) widget.style.gridColumn = savedConfig.gridColumn;
                if (savedConfig.gridRow) widget.style.gridRow = savedConfig.gridRow;
                if (savedConfig.order) widget.style.order = savedConfig.order;
            }
        });

        // Reorder DOM elements if needed
        this.reorderWidgets();
    },

    /**
     * Reorder widgets in DOM based on saved layout
     */
    reorderWidgets() {
        const grid = document.querySelector('.bento-grid');
        if (!grid) return;

        const widgets = Array.from(grid.querySelectorAll('.bento-widget'));
        
        widgets.sort((a, b) => {
            const idA = this.getWidgetId(a);
            const idB = this.getWidgetId(b);
            const orderA = this.state.layout[idA]?.index ?? 999;
            const orderB = this.state.layout[idB]?.index ?? 999;
            return orderA - orderB;
        });

        widgets.forEach(widget => grid.appendChild(widget));
    },

    // ==================== WIDGET CONTROLS ====================

    /**
     * Add control buttons to widget headers
     */
    addWidgetToolbar() {
        const widgets = document.querySelectorAll('.bento-widget');
        
        widgets.forEach(widget => {
            const header = widget.querySelector('.bento-widget-header');
            if (!header) return;

            // Check if controls already exist
            if (header.querySelector('.widget-controls')) return;

            const actions = header.querySelector('.bento-widget-actions');
            
            // Create controls container
            const controls = document.createElement('div');
            controls.className = 'widget-controls';
            controls.innerHTML = `
                <button class="widget-btn widget-minimize" title="Minimize">−</button>
                <button class="widget-btn widget-focus" title="Focus Mode">◎</button>
            `;

            // Insert before existing actions or append to header
            if (actions) {
                actions.insertBefore(controls, actions.firstChild);
            } else {
                header.appendChild(controls);
            }

            // Bind events
            controls.querySelector('.widget-minimize').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMinimize(widget);
            });

            controls.querySelector('.widget-focus').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFocusMode(widget);
            });
        });

        // Add control styles
        this.injectControlStyles();
    },

    /**
     * Inject widget control styles
     */
    injectControlStyles() {
        if (document.getElementById('widget-control-styles')) return;

        const styles = `
            /* Widget Controls */
            .widget-controls {
                display: flex;
                gap: 4px;
                margin-right: 8px;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            
            .bento-widget:hover .widget-controls,
            .bento-widget.widget-minimized .widget-controls {
                opacity: 1;
            }
            
            .widget-btn {
                width: 20px;
                height: 20px;
                border: none;
                background: transparent;
                color: var(--text-muted);
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }
            
            .widget-btn:hover {
                background: var(--surface-2);
                color: var(--text-primary);
            }
            
            /* Minimized State */
            .bento-widget.widget-minimized {
                min-height: auto !important;
            }
            
            .bento-widget.widget-minimized .bento-widget-content {
                display: none !important;
            }
            
            .bento-widget.widget-minimized .bento-widget-header {
                border-bottom: none;
            }
            
            /* Resize Handle */
            .widget-resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: ${this.config.resizeHandleSize * 2}px;
                height: ${this.config.resizeHandleSize * 2}px;
                cursor: se-resize;
                opacity: 0;
                transition: opacity 0.2s ease;
                z-index: 100;
            }
            
            .bento-widget:hover .widget-resize-handle {
                opacity: 1;
            }
            
            .widget-resize-handle::after {
                content: '';
                position: absolute;
                bottom: 4px;
                right: 4px;
                width: 8px;
                height: 8px;
                border-right: 2px solid var(--text-muted);
                border-bottom: 2px solid var(--text-muted);
                border-radius: 0 0 2px 0;
            }
            
            /* Drag Handle */
            .widget-drag-handle {
                cursor: grab;
                padding: 4px 8px;
                margin-right: 8px;
                color: var(--text-muted);
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            
            .bento-widget:hover .widget-drag-handle {
                opacity: 1;
            }
            
            .widget-drag-handle:active {
                cursor: grabbing;
            }
            
            .widget-drag-handle::before {
                content: '⋮⋮';
                font-size: 10px;
                letter-spacing: -2px;
            }
            
            /* Dragging State */
            .bento-widget.widget-dragging {
                opacity: 0.5;
                transform: scale(0.98);
                z-index: 1000;
            }
            
            .bento-widget.widget-drop-target {
                border: 2px dashed var(--brand-red);
                background: rgba(var(--brand-red-rgb, 188, 32, 38), 0.05);
            }
            
            /* Focus Mode Styles */
            body.focus-mode .bento-widget {
                opacity: 0.2;
                pointer-events: none;
                filter: grayscale(0.5);
                transition: opacity 0.3s ease, filter 0.3s ease;
            }
            
            body.focus-mode .bento-widget.widget-focused {
                opacity: 1;
                pointer-events: auto;
                filter: none;
                box-shadow: 0 0 0 3px rgba(var(--brand-red-rgb, 188, 32, 38), 0.3);
            }
            
            body.focus-mode .bento-widget.widget-focused .bento-widget-header {
                background: rgba(var(--brand-red-rgb, 188, 32, 38), 0.1);
            }
            
            /* Focus Mode Overlay */
            .focus-mode-indicator {
                position: fixed;
                top: 70px;
                right: 20px;
                background: var(--brand-red);
                color: white;
                padding: 8px 16px;
                border-radius: var(--radius-md);
                font-size: 13px;
                font-weight: 500;
                z-index: 1000;
                display: none;
                align-items: center;
                gap: 8px;
                animation: focusPulse 2s ease-in-out infinite;
            }
            
            body.focus-mode .focus-mode-indicator {
                display: flex;
            }
            
            @keyframes focusPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.8; }
            }
            
            /* Exit Focus Mode Button */
            .exit-focus-btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                padding: 2px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                transition: background 0.2s;
            }
            
            .exit-focus-btn:hover {
                background: rgba(255, 255, 255, 0.3);
            }
        `;

        const styleEl = document.createElement('style');
        styleEl.id = 'widget-control-styles';
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    },

    /**
     * Setup widget controls
     */
    setupWidgetControls() {
        // Add resize handles
        const widgets = document.querySelectorAll('.bento-widget');
        widgets.forEach(widget => {
            if (!widget.querySelector('.widget-resize-handle')) {
                const handle = document.createElement('div');
                handle.className = 'widget-resize-handle';
                widget.style.position = 'relative';
                widget.appendChild(handle);
            }
        });
    },

    // ==================== MINIMIZE/MAXIMIZE ====================

    /**
     * Toggle minimize state of a widget
     */
    toggleMinimize(widget) {
        const isMinimized = widget.classList.toggle('widget-minimized');
        const btn = widget.querySelector('.widget-minimize');
        if (btn) btn.textContent = isMinimized ? '+' : '−';
        
        this.saveLayout();
        
        // Animate the transition
        if (isMinimized) {
            widget.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        } else {
            widget.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            // Trigger content animation
            const content = widget.querySelector('.bento-widget-content');
            if (content) {
                content.style.opacity = '0';
                content.style.transform = 'translateY(-10px)';
                setTimeout(() => {
                    content.style.transition = 'all 0.3s ease';
                    content.style.opacity = '1';
                    content.style.transform = 'translateY(0)';
                }, 50);
            }
        }
    },

    /**
     * Minimize a widget (used on load)
     */
    minimizeWidget(widget, animate = true) {
        widget.classList.add('widget-minimized');
        const btn = widget.querySelector('.widget-minimize');
        if (btn) btn.textContent = '+';
    },

    // ==================== DRAG TO REARRANGE ====================

    /**
     * Setup drag-to-rearrange functionality
     */
    setupDragToRearrange() {
        const grid = document.querySelector('.bento-grid');
        if (!grid) return;

        let draggedWidget = null;
        let placeholder = null;

        // Make widgets draggable
        const makeDraggable = () => {
            const widgets = grid.querySelectorAll('.bento-widget');
            
            widgets.forEach(widget => {
                // Add drag handle to header
                const header = widget.querySelector('.bento-widget-header');
                if (header && !header.querySelector('.widget-drag-handle')) {
                    const dragHandle = document.createElement('div');
                    dragHandle.className = 'widget-drag-handle';
                    dragHandle.title = 'Drag to rearrange';
                    header.insertBefore(dragHandle, header.firstChild);
                    
                    // Make widget draggable
                    widget.draggable = true;
                    
                    // Use drag handle for initiation
                    dragHandle.addEventListener('mousedown', () => {
                        widget.draggable = true;
                    });
                    
                    header.addEventListener('mousedown', (e) => {
                        if (e.target.closest('.widget-controls') || 
                            e.target.closest('.bento-widget-actions') ||
                            e.target.closest('button')) {
                            widget.draggable = false;
                        } else {
                            widget.draggable = true;
                        }
                    });
                }

                // Drag events
                widget.addEventListener('dragstart', (e) => {
                    if (!widget.draggable) {
                        e.preventDefault();
                        return;
                    }
                    
                    draggedWidget = widget;
                    widget.classList.add('widget-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    
                    // Create placeholder
                    placeholder = document.createElement('div');
                    placeholder.className = 'bento-widget placeholder';
                    placeholder.style.border = '2px dashed var(--border-strong)';
                    placeholder.style.background = 'rgba(var(--brand-red-rgb, 188, 32, 38), 0.05)';
                    placeholder.style.opacity = '0.5';
                    
                    // Set drag image
                    const rect = widget.getBoundingClientRect();
                    e.dataTransfer.setDragImage(widget, rect.width / 2, 20);
                    
                    setTimeout(() => {
                        widget.style.display = 'none';
                        grid.insertBefore(placeholder, widget.nextSibling);
                    }, 0);
                });

                widget.addEventListener('dragend', () => {
                    widget.classList.remove('widget-dragging');
                    widget.style.display = '';
                    
                    if (placeholder && placeholder.parentNode) {
                        placeholder.parentNode.replaceChild(widget, placeholder);
                    }
                    
                    draggedWidget = null;
                    placeholder = null;
                    
                    // Save new layout
                    this.saveLayout();
                    
                    // Animate the drop
                    widget.style.animation = 'snapIn 0.3s ease';
                    setTimeout(() => {
                        widget.style.animation = '';
                    }, 300);
                });

                widget.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (!draggedWidget || widget === draggedWidget) return;
                    
                    const rect = widget.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    if (e.clientY < midpoint) {
                        grid.insertBefore(placeholder, widget);
                    } else {
                        grid.insertBefore(placeholder, widget.nextSibling);
                    }
                });
            });
        };

        makeDraggable();

        // Re-apply when new widgets are added
        const observer = new MutationObserver(() => {
            makeDraggable();
        });
        
        observer.observe(grid, { childList: true });
    },

    // ==================== RESIZABLE WIDGETS ====================

    /**
     * Setup resizable widgets
     */
    setupResizable() {
        const widgets = document.querySelectorAll('.bento-widget');
        
        widgets.forEach(widget => {
            const handle = widget.querySelector('.widget-resize-handle');
            if (!handle) return;

            let isResizing = false;
            let startX, startY, startWidth, startHeight;

            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = widget.offsetWidth;
                startHeight = widget.offsetHeight;
                
                widget.style.transition = 'none';
                document.body.style.cursor = 'se-resize';
                document.body.style.userSelect = 'none';
                
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                
                const newWidth = Math.max(this.config.minWidth, startWidth + dx);
                const newHeight = Math.max(this.config.minHeight, startHeight + dy);
                
                widget.style.width = newWidth + 'px';
                widget.style.height = newHeight + 'px';
            });

            document.addEventListener('mouseup', () => {
                if (!isResizing) return;
                
                isResizing = false;
                widget.style.transition = '';
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                this.saveLayout();
            });
        });
    },

    // ==================== FOCUS MODE ====================

    /**
     * Setup focus mode functionality
     */
    setupFocusMode() {
        // Add focus mode indicator to body
        if (!document.querySelector('.focus-mode-indicator')) {
            const indicator = document.createElement('div');
            indicator.className = 'focus-mode-indicator';
            indicator.innerHTML = `
                <span>🔍 Focus Mode</span>
                <button class="exit-focus-btn">Exit</button>
            `;
            
            indicator.querySelector('.exit-focus-btn').addEventListener('click', () => {
                this.exitFocusMode();
            });
            
            document.body.appendChild(indicator);
        }

        // Add keyboard shortcut (F)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                    return;
                }
                this.toggleFocusMode();
            }
            
            if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
                this.exitFocusMode();
            }
        });
    },

    /**
     * Toggle focus mode for a specific widget or globally
     */
    toggleFocusMode(targetWidget = null) {
        const body = document.body;
        const isFocusMode = body.classList.contains('focus-mode');
        
        if (targetWidget && !isFocusMode) {
            // Focus on specific widget
            body.classList.add('focus-mode');
            
            // Clear previous focus
            document.querySelectorAll('.bento-widget').forEach(w => {
                w.classList.remove('widget-focused');
            });
            
            // Focus target
            targetWidget.classList.add('widget-focused');
            
            // Scroll into view
            targetWidget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
        } else if (isFocusMode) {
            // Exit focus mode
            this.exitFocusMode();
        } else {
            // Default: focus on task board
            const taskBoard = document.querySelector('.bento-task-board');
            if (taskBoard) {
                body.classList.add('focus-mode');
                document.querySelectorAll('.bento-widget').forEach(w => {
                    w.classList.remove('widget-focused');
                });
                taskBoard.classList.add('widget-focused');
                taskBoard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        
        this.state.focusMode = !isFocusMode;
    },

    /**
     * Exit focus mode
     */
    exitFocusMode() {
        document.body.classList.remove('focus-mode');
        document.querySelectorAll('.bento-widget').forEach(w => {
            w.classList.remove('widget-focused');
        });
        this.state.focusMode = false;
    },

    // ==================== UTILITY METHODS ====================

    /**
     * Reset layout to defaults
     */
    resetLayout() {
        localStorage.removeItem(this.config.storageKey);
        location.reload();
    },

    /**
     * Get current layout configuration
     */
    getLayout() {
        return this.state.layout;
    },

    /**
     * Set layout programmatically
     */
    setLayout(layout) {
        this.state.layout = layout;
        this.saveLayout();
        this.applySavedLayout();
    },

    /**
     * Inject styles helper
     */
    injectStyles(id, css) {
        if (!document.getElementById(id)) {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Delay to ensure all other scripts have loaded
    setTimeout(() => {
        WidgetSystem.init();
    }, 200);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WidgetSystem };
}
