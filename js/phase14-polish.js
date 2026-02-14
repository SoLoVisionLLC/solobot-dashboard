/**
 * Phase 14: UX Polish
 * - Smooth page transitions between views
 * - Skeleton loading states for widgets
 * - Empty state illustrations/messages
 * - Responsive mobile layout improvements
 */

(function() {
    'use strict';

    // =================== PAGE TRANSITIONS ===================
    
    const PageTransitions = {
        duration: 250,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        
        init() {
            this.addTransitionStyles();
            this.hijackNavigation();
        },
        
        addTransitionStyles() {
            if (document.getElementById('page-transition-styles')) return;
            
            const styles = document.createElement('style');
            styles.id = 'page-transition-styles';
            styles.textContent = `
                .page {
                    opacity: 0;
                    transform: translateY(8px);
                    transition: opacity ${this.duration}ms ${this.easing},
                                transform ${this.duration}ms ${this.easing};
                    will-change: opacity, transform;
                }
                .page.active {
                    opacity: 1;
                    transform: translateY(0);
                }
                .page.exiting {
                    opacity: 0;
                    transform: translateY(-8px);
                }
            `;
            document.head.appendChild(styles);
        },
        
        hijackNavigation() {
            // Override the global showPage function
            const originalShowPage = window.showPage;
            if (!originalShowPage) return;
            
            window.showPage = (pageName, updateURL = true) => {
                const currentPage = document.querySelector('.page.active');
                const targetPage = document.getElementById('page-' + pageName);
                
                if (!targetPage || (currentPage && currentPage.id === targetPage.id)) {
                    return originalShowPage(pageName, updateURL);
                }
                
                // Animate out current page
                if (currentPage) {
                    currentPage.classList.add('exiting');
                    currentPage.classList.remove('active');
                }
                
                // Small delay for exit animation
                setTimeout(() => {
                    if (currentPage) currentPage.classList.remove('exiting');
                    originalShowPage(pageName, updateURL);
                    
                    // Trigger skeleton loading for widgets on new page
                    SkeletonLoader.showForWidgets(targetPage);
                }, this.duration / 2);
            };
        }
    };

    // =================== SKELETON LOADING ===================
    
    const SkeletonLoader = {
        init() {
            this.addSkeletonStyles();
        },
        
        addSkeletonStyles() {
            if (document.getElementById('skeleton-styles')) return;
            
            const styles = document.createElement('style');
            styles.id = 'skeleton-styles';
            styles.textContent = `
                .skeleton {
                    background: linear-gradient(
                        90deg,
                        var(--surface-2) 25%,
                        var(--surface-3) 50%,
                        var(--surface-2) 75%
                    );
                    background-size: 200% 100%;
                    animation: skeleton-loading 1.5s ease-in-out infinite;
                    border-radius: var(--radius-md);
                }
                
                @keyframes skeleton-loading {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                
                .skeleton-text {
                    height: 12px;
                    margin-bottom: 8px;
                }
                
                .skeleton-text.short { width: 60%; }
                .skeleton-text.medium { width: 80%; }
                .skeleton-text.long { width: 100%; }
                
                .skeleton-title {
                    height: 16px;
                    width: 120px;
                    margin-bottom: 12px;
                }
                
                .skeleton-avatar {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    flex-shrink: 0;
                }
                
                .skeleton-card {
                    height: 60px;
                    margin-bottom: 8px;
                }
                
                .skeleton-widget {
                    pointer-events: none;
                }
                
                .skeleton-widget .bento-widget-content {
                    opacity: 0.5;
                }
                
                .skeleton-row {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 12px;
                }
                
                /* Widget-specific skeleton layouts */
                .skeleton-task-board .skeleton-card {
                    height: 50px;
                }
                
                .skeleton-activity .skeleton-row {
                    margin-bottom: 16px;
                }
                
                .skeleton-stats {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }
                
                .skeleton-stat-box {
                    height: 60px;
                }
            `;
            document.head.appendChild(styles);
        },
        
        createSkeleton(type) {
            const templates = {
                'task-board': `
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-card"></div>
                    <div class="skeleton skeleton-card"></div>
                    <div class="skeleton skeleton-card"></div>
                `,
                'activity': `
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-avatar"></div>
                        <div style="flex: 1;">
                            <div class="skeleton skeleton-text medium"></div>
                            <div class="skeleton skeleton-text short"></div>
                        </div>
                    </div>
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-avatar"></div>
                        <div style="flex: 1;">
                            <div class="skeleton skeleton-text medium"></div>
                            <div class="skeleton skeleton-text short"></div>
                        </div>
                    </div>
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-avatar"></div>
                        <div style="flex: 1;">
                            <div class="skeleton skeleton-text medium"></div>
                            <div class="skeleton skeleton-text short"></div>
                        </div>
                    </div>
                `,
                'stats': `
                    <div class="skeleton-stats">
                        <div class="skeleton skeleton-stat-box"></div>
                        <div class="skeleton skeleton-stat-box"></div>
                        <div class="skeleton skeleton-stat-box"></div>
                        <div class="skeleton skeleton-stat-box"></div>
                    </div>
                `,
                'notes': `
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-text long"></div>
                    <div class="skeleton skeleton-text medium"></div>
                `,
                'terminal': `
                    <div class="skeleton skeleton-text medium"></div>
                    <div class="skeleton skeleton-text long"></div>
                    <div class="skeleton skeleton-text long"></div>
                    <div class="skeleton skeleton-text short"></div>
                `,
                'agents': `
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-avatar"></div>
                        <div class="skeleton skeleton-text medium" style="flex: 1;"></div>
                    </div>
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-avatar"></div>
                        <div class="skeleton skeleton-text medium" style="flex: 1;"></div>
                    </div>
                    <div class="skeleton-row">
                        <div class="skeleton skeleton-avatar"></div>
                        <div class="skeleton skeleton-text medium" style="flex: 1;"></div>
                    </div>
                `,
                'default': `
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-text long"></div>
                    <div class="skeleton skeleton-text medium"></div>
                    <div class="skeleton skeleton-text short"></div>
                `
            };
            
            const wrapper = document.createElement('div');
            wrapper.className = `skeleton-content skeleton-${type}`;
            wrapper.innerHTML = templates[type] || templates['default'];
            return wrapper;
        },
        
        showForWidget(widget, type) {
            const content = widget.querySelector('.bento-widget-content');
            if (!content) return;
            
            // Store original content
            if (!content.dataset.originalContent) {
                content.dataset.originalContent = content.innerHTML;
            }
            
            content.innerHTML = '';
            content.appendChild(this.createSkeleton(type));
            widget.classList.add('skeleton-widget');
        },
        
        hideForWidget(widget) {
            const content = widget.querySelector('.bento-widget-content');
            if (!content || !content.dataset.originalContent) return;
            
            content.innerHTML = content.dataset.originalContent;
            delete content.dataset.originalContent;
            widget.classList.remove('skeleton-widget');
        },
        
        showForWidgets(container) {
            const widgets = container.querySelectorAll('.bento-widget');
            widgets.forEach(widget => {
                let type = 'default';
                if (widget.classList.contains('bento-task-board')) type = 'task-board';
                else if (widget.classList.contains('bento-activity')) type = 'activity';
                else if (widget.classList.contains('bento-quick-stats')) type = 'stats';
                else if (widget.classList.contains('bento-notes')) type = 'notes';
                else if (widget.classList.contains('bento-terminal')) type = 'terminal';
                else if (widget.classList.contains('bento-agents')) type = 'agents';
                else if (widget.classList.contains('bento-channels')) type = 'agents';
                
                this.showForWidget(widget, type);
            });
            
            // Auto-hide skeletons after delay (simulating data load)
            setTimeout(() => {
                widgets.forEach(widget => this.hideForWidget(widget));
            }, 600);
        }
    };

    // =================== EMPTY STATES ===================
    
    const EmptyStates = {
        illustrations: {
            tasks: `<svg viewBox="0 0 120 120" fill="none" style="width: 80px; height: 80px; opacity: 0.5;">
                <rect x="20" y="30" width="80" height="60" rx="8" stroke="currentColor" stroke-width="2"/>
                <path d="M35 50h50M35 65h40M35 80h30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <circle cx="85" cy="25" r="12" fill="var(--surface-2)" stroke="currentColor" stroke-width="2"/>
                <path d="M80 25l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`,
            activity: `<svg viewBox="0 0 120 120" fill="none" style="width: 80px; height: 80px; opacity: 0.5;">
                <circle cx="60" cy="40" r="20" stroke="currentColor" stroke-width="2"/>
                <path d="M60 30v10l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <rect x="30" y="70" width="60" height="8" rx="4" fill="var(--surface-2)"/>
                <rect x="40" y="85" width="40" height="8" rx="4" fill="var(--surface-2)"/>
            </svg>`,
            notes: `<svg viewBox="0 0 120 120" fill="none" style="width: 80px; height: 80px; opacity: 0.5;">
                <rect x="25" y="20" width="70" height="80" rx="6" stroke="currentColor" stroke-width="2"/>
                <path d="M40 45h40M40 60h40M40 75h25" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <circle cx="80" cy="85" r="12" fill="var(--surface-2)" stroke="currentColor" stroke-width="2"/>
                <path d="M80 79v12M74 85h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>`,
            search: `<svg viewBox="0 0 120 120" fill="none" style="width: 80px; height: 80px; opacity: 0.5;">
                <circle cx="55" cy="55" r="25" stroke="currentColor" stroke-width="2"/>
                <path d="M73 73l15 15" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                <circle cx="55" cy="55" r="15" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
            </svg>`,
            default: `<svg viewBox="0 0 120 120" fill="none" style="width: 80px; height: 80px; opacity: 0.5;">
                <rect x="30" y="30" width="60" height="60" rx="8" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
                <path d="M45 60h30M60 45v30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>`
        },
        
        messages: {
            tasks: {
                title: 'No tasks yet',
                subtitle: 'Click the + button to add your first task',
                action: { text: 'Add Task', handler: () => window.openNewTaskDetail && window.openNewTaskDetail('todo') }
            },
            activity: {
                title: 'No activity yet',
                subtitle: 'Your recent actions will appear here'
            },
            notes: {
                title: 'No notes yet',
                subtitle: 'Jot down ideas or reminders here'
            },
            archive: {
                title: 'No archived tasks',
                subtitle: 'Completed tasks stay here for reference'
            },
            search: {
                title: 'No results found',
                subtitle: 'Try adjusting your search terms'
            },
            default: {
                title: 'Nothing here yet',
                subtitle: 'Items will appear here when available'
            }
        },
        
        create(type, customMessage) {
            const config = this.messages[type] || this.messages.default;
            const illustration = this.illustrations[type] || this.illustrations.default;
            const message = customMessage || config;
            
            const container = document.createElement('div');
            container.className = 'empty-state-container';
            container.innerHTML = `
                <div style="text-align: center; padding: 32px 16px; color: var(--text-muted);">
                    ${illustration}
                    <div style="font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-top: 16px;">
                        ${message.title || config.title}
                    </div>
                    <div style="font-size: 13px; margin-top: 8px; opacity: 0.8;">
                        ${message.subtitle || config.subtitle}
                    </div>
                    ${config.action ? `
                        <button class="btn btn-primary" style="margin-top: 16px;" onclick="(${config.action.handler.toString()})()">
                            ${config.action.text}
                        </button>
                    ` : ''}
                </div>
            `;
            
            return container;
        },
        
        showIn(container, type, customMessage) {
            if (typeof container === 'string') {
                container = document.getElementById(container);
            }
            if (!container) return;
            
            container.innerHTML = '';
            container.appendChild(this.create(type, customMessage));
        }
    };

    // =================== MOBILE RESPONSIVENESS ===================
    
    const MobileResponsive = {
        breakpoint: 768,
        
        init() {
            this.addMobileStyles();
            this.setupMobileNav();
            this.setupTouchGestures();
            this.handleResize();
            
            window.addEventListener('resize', () => this.handleResize());
        },
        
        addMobileStyles() {
            if (document.getElementById('mobile-responsive-styles')) return;
            
            const styles = document.createElement('style');
            styles.id = 'mobile-responsive-styles';
            styles.textContent = `
                /* Mobile-first responsive improvements */
                @media (max-width: 768px) {
                    .app-container {
                        flex-direction: column;
                    }
                    
                    .sidebar {
                        width: 100% !important;
                        height: auto !important;
                        position: fixed;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        top: auto;
                        z-index: 100;
                        flex-direction: row;
                        padding: 8px;
                        border-top: 1px solid var(--border-default);
                        border-right: none;
                        transform: translateY(0) !important;
                    }
                    
                    .sidebar-header,
                    .sidebar-footer {
                        display: none;
                    }
                    
                    .sidebar-nav {
                        flex-direction: row;
                        justify-content: space-around;
                        width: 100%;
                        gap: 4px;
                    }
                    
                    .sidebar-item {
                        flex-direction: column;
                        padding: 8px 4px;
                        font-size: 10px;
                        gap: 4px;
                        flex: 1;
                        text-align: center;
                    }
                    
                    .sidebar-item svg {
                        width: 20px;
                        height: 20px;
                    }
                    
                    .main-content {
                        padding-bottom: 80px;
                    }
                    
                    .bento-grid {
                        grid-template-columns: 1fr;
                        gap: 12px;
                    }
                    
                    .bento-widget {
                        grid-column: span 1 !important;
                    }
                    
                    .bento-task-board {
                        order: -1;
                    }
                    
                    .grid-3 {
                        grid-template-columns: 1fr;
                    }
                    
                    .column {
                        min-height: 150px;
                    }
                    
                    .drop-zone {
                        max-height: 250px;
                    }
                    
                    .modal {
                        width: 95%;
                        max-height: 90vh;
                        margin: 16px;
                    }
                    
                    .modal-overlay {
                        padding: 0;
                    }
                    
                    /* Mobile-optimized touch targets */
                    .task-card {
                        min-height: 60px;
                        padding: 12px;
                    }
                    
                    .btn, .btn-icon {
                        min-height: 44px;
                        min-width: 44px;
                    }
                    
                    /* Swipe indicator for mobile */
                    .mobile-swipe-hint {
                        display: block;
                        text-align: center;
                        padding: 8px;
                        font-size: 11px;
                        color: var(--text-muted);
                        opacity: 0.7;
                    }
                    
                    .mobile-swipe-hint::after {
                        content: '← swipe to navigate →';
                    }
                }
                
                @media (min-width: 769px) {
                    .mobile-swipe-hint {
                        display: none;
                    }
                    
                    .mobile-menu-toggle {
                        display: none !important;
                    }
                }
                
                /* Tablet adjustments */
                @media (min-width: 769px) and (max-width: 1200px) {
                    .bento-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                    
                    .bento-task-board {
                        grid-column: span 2;
                    }
                    
                    .grid-3 {
                        grid-template-columns: repeat(3, 1fr);
                    }
                }
                
                /* Pull-to-refresh indicator */
                .pull-indicator {
                    position: fixed;
                    top: 0;
                    left: 50%;
                    transform: translateX(-50%) translateY(-100%);
                    padding: 12px 24px;
                    background: var(--surface-2);
                    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
                    box-shadow: var(--shadow-md);
                    transition: transform 0.2s ease;
                    z-index: 200;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: var(--text-secondary);
                }
                
                .pull-indicator.visible {
                    transform: translateX(-50%) translateY(0);
                }
                
                .pull-indicator.spinning::after {
                    content: '';
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--border-strong);
                    border-top-color: var(--brand-red);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(styles);
        },
        
        setupMobileNav() {
            // Add mobile menu toggle button for sidebar on smaller screens
            const header = document.querySelector('.app-header');
            if (!header || document.getElementById('mobile-menu-toggle')) return;
            
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'mobile-menu-toggle';
            toggleBtn.className = 'btn btn-ghost mobile-menu-toggle';
            toggleBtn.innerHTML = '☰';
            toggleBtn.style.cssText = 'padding: 8px; font-size: 18px;';
            toggleBtn.onclick = () => this.toggleMobileSidebar();
            
            const headerLeft = header.querySelector('.flex');
            if (headerLeft) {
                headerLeft.insertBefore(toggleBtn, headerLeft.firstChild);
            }
        },
        
        toggleMobileSidebar() {
            const sidebar = document.querySelector('.sidebar');
            if (!sidebar) return;
            
            sidebar.classList.toggle('mobile-expanded');
        },
        
        setupTouchGestures() {
            let startX = 0;
            let startY = 0;
            let startTime = 0;
            
            document.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                startTime = Date.now();
            }, { passive: true });
            
            document.addEventListener('touchend', (e) => {
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const endTime = Date.now();
                
                const deltaX = endX - startX;
                const deltaY = endY - startY;
                const deltaTime = endTime - startTime;
                
                // Only handle horizontal swipes
                if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50 && deltaTime < 300) {
                    this.handleSwipe(deltaX > 0 ? 'right' : 'left');
                }
            }, { passive: true });
            
            // Pull-to-refresh simulation
            this.setupPullToRefresh();
        },
        
        handleSwipe(direction) {
            if (window.innerWidth > this.breakpoint) return;
            
            const pages = window.VALID_PAGES || ['dashboard', 'memory', 'chat', 'system'];
            const currentPage = document.querySelector('.page.active');
            if (!currentPage) return;
            
            const currentId = currentPage.id.replace('page-', '');
            const currentIndex = pages.indexOf(currentId);
            
            if (direction === 'left' && currentIndex < pages.length - 1) {
                window.showPage(pages[currentIndex + 1]);
            } else if (direction === 'right' && currentIndex > 0) {
                window.showPage(pages[currentIndex - 1]);
            }
        },
        
        setupPullToRefresh() {
            let pullStartY = 0;
            let isPulling = false;
            
            const indicator = document.createElement('div');
            indicator.className = 'pull-indicator';
            indicator.textContent = 'Pull to refresh';
            document.body.appendChild(indicator);
            
            document.addEventListener('touchstart', (e) => {
                if (window.scrollY === 0) {
                    pullStartY = e.touches[0].clientY;
                    isPulling = true;
                }
            }, { passive: true });
            
            document.addEventListener('touchmove', (e) => {
                if (!isPulling) return;
                
                const pullDistance = e.touches[0].clientY - pullStartY;
                if (pullDistance > 80 && window.scrollY === 0) {
                    indicator.classList.add('visible');
                }
            }, { passive: true });
            
            document.addEventListener('touchend', () => {
                if (indicator.classList.contains('visible')) {
                    indicator.textContent = 'Refreshing...';
                    indicator.classList.add('spinning');
                    
                    // Trigger refresh
                    setTimeout(() => {
                        location.reload();
                    }, 500);
                }
                isPulling = false;
            }, { passive: true });
        },
        
        handleResize() {
            const isMobile = window.innerWidth <= this.breakpoint;
            document.body.classList.toggle('is-mobile', isMobile);
            document.body.classList.toggle('is-desktop', !isMobile);
        }
    };

    // =================== INITIALIZATION ===================
    
    document.addEventListener('DOMContentLoaded', () => {
        PageTransitions.init();
        SkeletonLoader.init();
        MobileResponsive.init();
        
        // Expose utilities globally
        window.SkeletonLoader = SkeletonLoader;
        window.EmptyStates = EmptyStates;
        
        console.log('[Phase 14] UX Polish loaded');
    });
})();