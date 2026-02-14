// ========================================
// PHASE 2: MOTION & MICROINTERACTIONS
// Widget animations, hover effects, drag-drop, shimmer loading
// ========================================

/**
 * Motion Controller - Handles all widget animations and microinteractions
 */
const MotionController = {
    // Configuration
    config: {
        fadeDuration: 400,
        staggerDelay: 50,
        hoverLift: 4,
        snapSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Bouncy spring
        shimmerSpeed: 1.5,
    },

    /**
     * Initialize all motion effects
     */
    init() {
        this.setupWidgetFadeIn();
        this.setupHoverLiftEffects();
        this.setupDragDropAnimations();
        this.setupShimmerEffects();
        this.setupDataUpdateAnimations();
        this.setupScrollReveal();
    },

    // ==================== WIDGET FADE-IN ANIMATIONS ====================

    /**
     * Apply fade-in animation to widgets when data updates
     */
    setupWidgetFadeIn() {
        // Add fade-in styles if not present
        if (!document.getElementById('motion-styles')) {
            const styles = document.createElement('style');
            styles.id = 'motion-styles';
            styles.textContent = `
                @keyframes widgetFadeIn {
                    from {
                        opacity: 0;
                        transform: translateY(12px) scale(0.98);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }
                
                @keyframes widgetPulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.02); }
                }
                
                @keyframes contentSlideIn {
                    from {
                        opacity: 0;
                        transform: translateX(-8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
                
                .widget-fade-in {
                    animation: widgetFadeIn ${this.config.fadeDuration}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
                }
                
                .widget-content-update {
                    animation: widgetPulse 300ms ease-in-out;
                }
                
                .content-slide-in {
                    animation: contentSlideIn 300ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
                }
                
                /* Stagger children animations */
                .stagger-children > * {
                    opacity: 0;
                    animation: widgetFadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                }
                
                .stagger-children > *:nth-child(1) { animation-delay: 0.05s; }
                .stagger-children > *:nth-child(2) { animation-delay: 0.1s; }
                .stagger-children > *:nth-child(3) { animation-delay: 0.15s; }
                .stagger-children > *:nth-child(4) { animation-delay: 0.2s; }
                .stagger-children > *:nth-child(5) { animation-delay: 0.25s; }
                .stagger-children > *:nth-child(6) { animation-delay: 0.3s; }
                .stagger-children > *:nth-child(7) { animation-delay: 0.35s; }
                .stagger-children > *:nth-child(8) { animation-delay: 0.4s; }
            `;
            document.head.appendChild(styles);
        }

        // Initial page load animation
        this.animateWidgetsOnLoad();
    },

    /**
     * Animate widgets when page loads
     */
    animateWidgetsOnLoad() {
        const widgets = document.querySelectorAll('.bento-widget');
        widgets.forEach((widget, index) => {
            widget.style.opacity = '0';
            widget.style.transform = 'translateY(12px) scale(0.98)';
            widget.style.transition = 'none';
            
            setTimeout(() => {
                widget.style.transition = `all ${this.config.fadeDuration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
                widget.style.opacity = '1';
                widget.style.transform = 'translateY(0) scale(1)';
            }, index * this.config.staggerDelay);
        });
    },

    /**
     * Animate a specific widget when its data updates
     * @param {HTMLElement|string} widget - Widget element or selector
     */
    animateWidgetUpdate(widget) {
        const el = typeof widget === 'string' ? document.querySelector(widget) : widget;
        if (!el) return;

        // Remove existing animation class
        el.classList.remove('widget-content-update');
        
        // Force reflow
        void el.offsetWidth;
        
        // Add animation class
        el.classList.add('widget-content-update');
        
        // Clean up after animation
        setTimeout(() => {
            el.classList.remove('widget-content-update');
        }, 300);
    },

    /**
     * Animate content items within a widget
     * @param {HTMLElement} container - Container element
     */
    animateContentItems(container) {
        if (!container) return;
        const items = container.children;
        Array.from(items).forEach((item, index) => {
            item.style.opacity = '0';
            item.style.transform = 'translateX(-8px)';
            item.style.transition = 'none';
            
            setTimeout(() => {
                item.style.transition = 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)';
                item.style.opacity = '1';
                item.style.transform = 'translateX(0)';
            }, index * 40);
        });
    },

    // ==================== HOVER LIFT EFFECTS ====================

    /**
     * Setup hover lift effects on cards
     */
    setupHoverLiftEffects() {
        // Add hover styles
        const hoverStyles = `
            .bento-widget {
                transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                            box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .bento-widget:hover {
                transform: translateY(-${this.config.hoverLift}px);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2),
                            0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            .bento-widget.lift-active {
                transform: translateY(-${this.config.hoverLift * 1.5}px) scale(1.01);
                box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25),
                            0 6px 16px rgba(0, 0, 0, 0.2);
                z-index: 10;
            }
            
            /* Task card hover effects */
            .task-card {
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .task-card:hover {
                transform: translateY(-2px) scale(1.01);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            /* Button hover micro-interactions */
            .btn, .btn-icon {
                transition: transform 0.15s ease, background 0.2s ease, box-shadow 0.2s ease;
            }
            
            .btn:active, .btn-icon:active {
                transform: scale(0.96);
            }
            
            /* Link hover underline animation */
            .link-animated {
                position: relative;
                text-decoration: none;
            }
            
            .link-animated::after {
                content: '';
                position: absolute;
                bottom: -2px;
                left: 0;
                width: 0;
                height: 1px;
                background: currentColor;
                transition: width 0.3s ease;
            }
            
            .link-animated:hover::after {
                width: 100%;
            }
        `;
        
        this.injectStyles('hover-lift-styles', hoverStyles);

        // Setup mouse tracking for subtle parallax
        this.setupParallaxHover();
    },

    /**
     * Setup subtle parallax effect on widget hover
     */
    setupParallaxHover() {
        const widgets = document.querySelectorAll('.bento-widget');
        
        widgets.forEach(widget => {
            widget.addEventListener('mousemove', (e) => {
                const rect = widget.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                
                // Subtle rotation based on mouse position
                const rotateX = y * -2;
                const rotateY = x * 2;
                
                if (widget.classList.contains('lift-active')) {
                    widget.style.transform = `
                        translateY(-${this.config.hoverLift * 1.5}px) 
                        scale(1.01)
                        perspective(1000px)
                        rotateX(${rotateX}deg)
                        rotateY(${rotateY}deg)
                    `;
                }
            });
            
            widget.addEventListener('mouseleave', () => {
                widget.style.transform = '';
            });
            
            // Lift on click/hold
            widget.addEventListener('mousedown', () => {
                widget.classList.add('lift-active');
            });
            
            widget.addEventListener('mouseup', () => {
                widget.classList.remove('lift-active');
            });
        });
    },

    // ==================== DRAG & DROP ANIMATIONS ====================

    /**
     * Setup drag and drop snap animations
     */
    setupDragDropAnimations() {
        const dragStyles = `
            /* Drag placeholder */
            .dragging {
                opacity: 0.5;
                transform: scale(0.95);
                cursor: grabbing !important;
            }
            
            /* Drop zone highlight */
            .drop-zone {
                transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
            }
            
            .drop-zone.drag-over {
                background-color: rgba(var(--brand-red-rgb, 188, 32, 38), 0.08);
                border: 2px dashed rgba(var(--brand-red-rgb, 188, 32, 38), 0.4);
                box-shadow: inset 0 0 20px rgba(var(--brand-red-rgb, 188, 32, 38), 0.1);
            }
            
            /* Snap animation for dropped items */
            @keyframes snapIn {
                0% {
                    transform: scale(0.9) translateY(-10px);
                    opacity: 0;
                }
                60% {
                    transform: scale(1.02) translateY(2px);
                }
                100% {
                    transform: scale(1) translateY(0);
                    opacity: 1;
                }
            }
            
            .snap-in {
                animation: snapIn 0.4s ${this.config.snapSpring} forwards;
            }
            
            /* Ghost drag image enhancement */
            .drag-ghost {
                opacity: 0.9;
                transform: rotate(3deg) scale(1.05);
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
            }
            
            /* Task card drag states */
            .task-card {
                cursor: grab;
            }
            
            .task-card:active {
                cursor: grabbing;
            }
            
            /* Drop indicator line */
            .drop-indicator {
                height: 3px;
                background: var(--brand-red);
                border-radius: 2px;
                margin: 4px 0;
                opacity: 0;
                transform: scaleX(0);
                transition: opacity 0.15s, transform 0.15s;
            }
            
            .drop-indicator.active {
                opacity: 1;
                transform: scaleX(1);
            }
            
            /* Column header pulse on drop */
            @keyframes columnPulse {
                0%, 100% { background-color: transparent; }
                50% { background-color: rgba(var(--brand-red-rgb, 188, 32, 38), 0.1); }
            }
            
            .column-header.pulse {
                animation: columnPulse 0.4s ease;
            }
        `;
        
        this.injectStyles('drag-drop-styles', dragStyles);

        // Enhance existing drag handlers
        this.enhanceDragHandlers();
    },

    /**
     * Enhance existing drag and drop handlers with animations
     */
    enhanceDragHandlers() {
        // Store original handlers if they exist
        const originalHandleDragStart = window.handleDragStart;
        const originalHandleDrop = window.handleDrop;
        
        // Override handleDragStart
        window.handleDragStart = function(event, taskId, column) {
            event.target.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({ taskId, column }));
            
            // Add ghost styling after a brief delay (browser needs time to create drag image)
            setTimeout(() => {
                event.target.classList.add('drag-ghost');
            }, 0);
            
            // Call original if exists
            if (typeof originalHandleDragStart === 'function') {
                originalHandleDragStart(event, taskId, column);
            }
        };
        
        // Override handleDrop
        window.handleDrop = function(event, targetColumn) {
            event.preventDefault();
            
            // Remove drag-over states
            document.querySelectorAll('.drop-zone').forEach(zone => {
                zone.classList.remove('drag-over');
            });
            
            // Get drag data
            const data = event.dataTransfer.getData('text/plain');
            if (!data) return;
            
            try {
                const { taskId, column: sourceColumn } = JSON.parse(data);
                
                if (sourceColumn !== targetColumn) {
                    // Find the task element
                    const taskEl = document.querySelector(`[data-task-id="${taskId}"]`);
                    if (taskEl) {
                        // Remove dragging states
                        taskEl.classList.remove('dragging', 'drag-ghost');
                        
                        // Add snap animation
                        taskEl.classList.add('snap-in');
                        setTimeout(() => {
                            taskEl.classList.remove('snap-in');
                        }, 400);
                        
                        // Pulse the column header
                        const columnHeader = event.currentTarget.closest('.column')?.querySelector('.column-header');
                        if (columnHeader) {
                            columnHeader.classList.add('pulse');
                            setTimeout(() => columnHeader.classList.remove('pulse'), 400);
                        }
                    }
                }
            } catch (e) {
                console.error('Drop animation error:', e);
            }
            
            // Call original if exists
            if (typeof originalHandleDrop === 'function') {
                originalHandleDrop(event, targetColumn);
            }
        };
        
        // Enhance drag enter/leave for visual feedback
        const zones = document.querySelectorAll('.drop-zone');
        zones.forEach(zone => {
            zone.addEventListener('dragenter', (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
            
            zone.addEventListener('dragleave', (e) => {
                // Only remove if leaving the zone (not entering a child)
                if (!zone.contains(e.relatedTarget)) {
                    zone.classList.remove('drag-over');
                }
            });
        });
    },

    // ==================== SHIMMER LOADING EFFECTS ====================

    /**
     * Setup shimmer loading effects (replaces spinners)
     */
    setupShimmerEffects() {
        const shimmerStyles = `
            /* Shimmer animation */
            @keyframes shimmer {
                0% {
                    background-position: -200% 0;
                }
                100% {
                    background-position: 200% 0;
                }
            }
            
            .shimmer {
                background: linear-gradient(
                    90deg,
                    var(--surface-2) 25%,
                    var(--surface-3) 50%,
                    var(--surface-2) 75%
                );
                background-size: 200% 100%;
                animation: shimmer ${this.config.shimmerSpeed}s infinite linear;
                border-radius: var(--radius-md);
            }
            
            .shimmer-text {
                height: 1em;
                margin-bottom: 0.5em;
            }
            
            .shimmer-card {
                height: 60px;
                margin-bottom: 8px;
            }
            
            .shimmer-circle {
                border-radius: 50%;
            }
            
            /* Widget loading state */
            .widget-loading {
                position: relative;
                overflow: hidden;
            }
            
            .widget-loading::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(
                    90deg,
                    transparent 0%,
                    rgba(255, 255, 255, 0.03) 50%,
                    transparent 100%
                );
                background-size: 200% 100%;
                animation: shimmer 1.5s infinite;
                pointer-events: none;
            }
            
            /* Replace spinner with shimmer */
            .loading-state {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 16px;
            }
            
            .loading-state .shimmer:first-child {
                width: 60%;
                height: 20px;
            }
            
            .loading-state .shimmer:nth-child(2) {
                width: 80%;
                height: 12px;
            }
            
            .loading-state .shimmer:nth-child(3) {
                width: 40%;
                height: 12px;
            }
            
            /* Content reveal transition */
            .content-reveal {
                opacity: 0;
                animation: widgetFadeIn 0.4s ease forwards;
            }
        `;
        
        this.injectStyles('shimmer-styles', shimmerStyles);

        // Replace existing loading spinners
        this.replaceLoadingSpinners();
    },

    /**
     * Replace loading spinners with shimmer effects
     */
    replaceLoadingSpinners() {
        // Find all loading states and replace with shimmer
        const loadingStates = document.querySelectorAll('.loading-state');
        loadingStates.forEach(el => {
            if (!el.querySelector('.shimmer')) {
                el.innerHTML = `
                    <div class="shimmer shimmer-text"></div>
                    <div class="shimmer shimmer-text"></div>
                    <div class="shimmer shimmer-text"></div>
                `;
            }
        });
    },

    /**
     * Show shimmer loading state in a container
     * @param {HTMLElement|string} container - Container element or selector
     * @param {number} lines - Number of shimmer lines
     */
    showShimmer(container, lines = 3) {
        const el = typeof container === 'string' ? document.querySelector(container) : container;
        if (!el) return;

        const shimmerHTML = Array(lines).fill(0).map((_, i) => {
            const width = 60 + Math.random() * 30;
            return `<div class="shimmer shimmer-text" style="width: ${width}%"></div>`;
        }).join('');

        el.innerHTML = `<div class="loading-state">${shimmerHTML}</div>`;
    },

    /**
     * Hide shimmer and reveal content with animation
     * @param {HTMLElement|string} container - Container element or selector
     * @param {string} content - Content to reveal
     */
    hideShimmer(container, content) {
        const el = typeof container === 'string' ? document.querySelector(container) : container;
        if (!el) return;

        el.innerHTML = content;
        el.classList.add('content-reveal');
        
        setTimeout(() => {
            el.classList.remove('content-reveal');
        }, 400);
    },

    // ==================== DATA UPDATE ANIMATIONS ====================

    /**
     * Setup animations for when data updates
     */
    setupDataUpdateAnimations() {
        // Watch for stat value changes
        this.observeStatChanges();
    },

    /**
     * Observe stat value changes and animate
     */
    observeStatChanges() {
        // Create a mutation observer to watch for text content changes
        const statsToWatch = [
            '#stat-tasks-done',
            '#stat-messages',
            '#stat-focus-sessions',
            '#todo-count',
            '#progress-count',
            '#done-count'
        ];

        statsToWatch.forEach(selector => {
            const el = document.querySelector(selector);
            if (!el) return;

            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'characterData' || mutation.type === 'childList') {
                        this.animateValueChange(el);
                    }
                });
            });

            observer.observe(el, {
                characterData: true,
                childList: true,
                subtree: true
            });
        });
    },

    /**
     * Animate a value change
     * @param {HTMLElement} el - Element to animate
     */
    animateValueChange(el) {
        el.style.transition = 'transform 0.2s ease, color 0.2s ease';
        el.style.transform = 'scale(1.2)';
        el.style.color = 'var(--brand-red)';
        
        setTimeout(() => {
            el.style.transform = 'scale(1)';
            el.style.color = '';
        }, 200);
    },

    // ==================== SCROLL REVEAL ====================

    /**
     * Setup scroll reveal animations
     */
    setupScrollReveal() {
        const revealStyles = `
            .reveal {
                opacity: 0;
                transform: translateY(20px);
                transition: opacity 0.5s ease, transform 0.5s ease;
            }
            
            .reveal.active {
                opacity: 1;
                transform: translateY(0);
            }
            
            .reveal-left {
                opacity: 0;
                transform: translateX(-20px);
                transition: opacity 0.5s ease, transform 0.5s ease;
            }
            
            .reveal-left.active {
                opacity: 1;
                transform: translateX(0);
            }
            
            .reveal-right {
                opacity: 0;
                transform: translateX(20px);
                transition: opacity 0.5s ease, transform 0.5s ease;
            }
            
            .reveal-right.active {
                opacity: 1;
                transform: translateX(0);
            }
        `;
        
        this.injectStyles('reveal-styles', revealStyles);

        // Setup intersection observer
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('active');
                        observer.unobserve(entry.target);
                    }
                });
            }, {
                threshold: 0.1,
                rootMargin: '0px 0px -50px 0px'
            });

            // Observe all widgets on init
            document.querySelectorAll('.bento-widget').forEach(widget => {
                widget.classList.add('reveal');
                observer.observe(widget);
            });
        }
    },

    // ==================== UTILITY METHODS ====================

    /**
     * Inject styles into document head
     * @param {string} id - Style element ID
     * @param {string} css - CSS content
     */
    injectStyles(id, css) {
        if (!document.getElementById(id)) {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = css;
            document.head.appendChild(style);
        }
    },

    /**
     * Animate a counter from one value to another
     * @param {HTMLElement} el - Element to animate
     * @param {number} from - Starting value
     * @param {number} to - Ending value
     * @param {number} duration - Animation duration in ms
     */
    animateCounter(el, from, to, duration = 500) {
        const startTime = performance.now();
        const diff = to - from;
        
        const update = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(from + diff * easeOut);
            
            el.textContent = current;
            
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        
        requestAnimationFrame(update);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure other scripts have initialized
    setTimeout(() => {
        MotionController.init();
    }, 100);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MotionController };
}
