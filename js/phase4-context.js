// js/phase4-context.js — Phase 4: Context Awareness
// Time-of-day layouts, agent-aware layouts, workflow-aware widget expansion

(function () {
    'use strict';

    // ===================
    // TIME-BASED LAYOUTS
    // ===================

    const TimeOfDayManager = {
        currentMode: null,

        // Time ranges for different modes (24h format)
        modes: {
            morning: { start: 6, end: 11, name: 'morning', icon: '🌅' },
            deepWork: { start: 11, end: 17, name: 'deep-work', icon: '🔥' },
            evening: { start: 17, end: 22, name: 'evening', icon: '🌙' },
            night: { start: 22, end: 6, name: 'night', icon: '💤' }
        },

        init() {
            this.applyTimeBasedLayout();
            // Re-check every 15 minutes
            setInterval(() => this.applyTimeBasedLayout(), 15 * 60 * 1000);
        },

        getCurrentMode() {
            const hour = new Date().getHours();
            for (const [key, mode] of Object.entries(this.modes)) {
                if (mode.start <= mode.end) {
                    // Normal range (e.g., 6-11)
                    if (hour >= mode.start && hour < mode.end) return mode;
                } else {
                    // Wrap-around range (e.g., 22-6)
                    if (hour >= mode.start || hour < mode.end) return mode;
                }
            }
            return this.modes.morning;
        },

        applyTimeBasedLayout() {
            const mode = this.getCurrentMode();
            if (this.currentMode === mode.name) return;

            this.currentMode = mode.name;
            document.body.setAttribute('data-time-mode', mode.name);

            // Update time mode indicator if it exists
            this.updateTimeModeIndicator(mode);

            // Apply mode-specific layout adjustments
            this.applyModeLayout(mode);

            console.log(`[Context] Time mode: ${mode.name} ${mode.icon}`);
        },

        updateTimeModeIndicator(mode) {
            let indicator = document.getElementById('time-mode-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'time-mode-indicator';
                indicator.className = 'time-mode-indicator';
                indicator.title = 'Current time mode - click to cycle';
                indicator.onclick = () => this.cycleMode();

                // Insert into header
                const header = document.querySelector('.header-center');
                if (header) header.appendChild(indicator);
            }

            indicator.textContent = mode.icon;
            indicator.setAttribute('data-mode', mode.name);
        },

        applyModeLayout(mode) {
            const bentoGrid = document.querySelector('.bento-grid');
            if (!bentoGrid) return;

            // Remove all mode classes
            Object.keys(this.modes).forEach(m => {
                bentoGrid.classList.remove(`mode-${m}`);
            });

            // Add current mode class
            bentoGrid.classList.add(`mode-${mode.name}`);

            // Mode-specific widget visibility/prominence
            switch (mode.name) {
                case 'morning':
                    this.prioritizeWidgets(['bento-task-board', 'bento-quick-stats', 'bento-activity']);
                    break;
                case 'deep-work':
                    this.prioritizeWidgets(['bento-task-board', 'bento-terminal', 'bento-subagents']);
                    break;
                case 'evening':
                    this.prioritizeWidgets(['bento-activity', 'bento-analytics', 'bento-quick-stats']);
                    break;
                case 'night':
                    this.prioritizeWidgets(['bento-activity']);
                    break;
            }
        },

        prioritizeWidgets(widgetClasses) {
            // Add 'primary' class to important widgets for the current mode
            document.querySelectorAll('.bento-widget').forEach(widget => {
                widget.classList.remove('mode-primary');
            });

            widgetClasses.forEach(cls => {
                const widget = document.querySelector(`.${cls}`);
                if (widget) widget.classList.add('mode-primary');
            });
        },

        cycleMode() {
            const modeNames = Object.keys(this.modes);
            const currentIndex = modeNames.indexOf(this.currentMode);
            const nextIndex = (currentIndex + 1) % modeNames.length;
            const nextModeName = modeNames[nextIndex];
            const nextMode = this.modes[nextModeName];

            // Temporarily override (until next check)
            this.currentMode = nextModeName;
            this.applyModeLayout(nextMode);
            this.updateTimeModeIndicator(nextMode);

            showToast(`Switched to ${nextModeName} mode ${nextMode.icon}`, 'info', 2000);
        }
    };

    // ===================
    // AGENT-AWARE LAYOUTS
    // ===================

    const AgentLayoutManager = {
        currentAgent: null,

        // Agent-specific layout preferences
        agentLayouts: {
            dev: {
                priorityWidgets: ['bento-terminal', 'bento-task-board', 'bento-subagents', 'bento-activity'],
                expandedWidgets: ['bento-terminal'],
                theme: 'midnight'
            },
            coo: {
                priorityWidgets: ['bento-task-board', 'bento-quick-stats', 'bento-analytics', 'bento-activity'],
                expandedWidgets: ['bento-task-board'],
                theme: 'snow'
            },
            research: {
                priorityWidgets: ['bento-activity', 'bento-notes', 'bento-memory'],
                expandedWidgets: ['bento-notes'],
                theme: 'midnight'
            },
            default: {
                priorityWidgets: ['bento-task-board', 'bento-activity', 'bento-quick-stats'],
                expandedWidgets: [],
                theme: null
            }
        },

        init() {
            // Watch for agent changes
            this.detectCurrentAgent();

            // Check periodically (in case agent switched via URL or other means)
            setInterval(() => this.detectCurrentAgent(), 30000);

            // Listen for agent switch events
            document.addEventListener('agentSwitched', (e) => {
                this.applyAgentLayout(e.detail.agent);
            });
        },

        detectCurrentAgent() {
            // Try to detect from session key
            const rawSessionKey = window.GATEWAY_CONFIG?.sessionKey || localStorage.getItem('gateway_session') || 'agent:main:main';
            const sessionKey = (rawSessionKey === 'main') ? 'agent:main:main' : rawSessionKey;
            let agent = 'default';

            if (sessionKey.includes('dev')) agent = 'dev';
            else if (sessionKey.includes('atlas')) agent = 'atlas';
            else if (sessionKey.includes('research')) agent = 'research';
            else if (sessionKey.startsWith('agent:')) {
                const match = sessionKey.match(/^agent:([^:]+):/);
                if (match) agent = window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1];
            }

            if (agent !== this.currentAgent) {
                this.applyAgentLayout(agent);
            }
        },

        applyAgentLayout(agent) {
            if (this.currentAgent === agent) return;
            this.currentAgent = agent;

            const layout = this.agentLayouts[agent] || this.agentLayouts.default;

            // Apply priority widgets
            this.highlightPriorityWidgets(layout.priorityWidgets);

            // Apply expanded widgets
            this.expandWidgets(layout.expandedWidgets);

            // Store preference
            localStorage.setItem('lastAgentLayout', agent);

            console.log(`[Context] Agent layout: ${agent}`);

            // Dispatch event for other components
            document.dispatchEvent(new CustomEvent('agentLayoutChanged', {
                detail: { agent, layout }
            }));
        },

        highlightPriorityWidgets(widgetClasses) {
            document.querySelectorAll('.bento-widget').forEach(widget => {
                widget.classList.remove('agent-priority');
                widget.style.order = '';
            });

            widgetClasses.forEach((cls, index) => {
                const widget = document.querySelector(`.${cls}`);
                if (widget) {
                    widget.classList.add('agent-priority');
                    // Use CSS order to prioritize (lower = earlier)
                    widget.style.order = index - 100;
                }
            });
        },

        expandWidgets(widgetClasses) {
            document.querySelectorAll('.bento-widget').forEach(widget => {
                widget.classList.remove('expanded');
            });

            widgetClasses.forEach(cls => {
                const widget = document.querySelector(`.${cls}`);
                if (widget) {
                    widget.classList.add('expanded');
                    // Auto-expand animation
                    setTimeout(() => {
                        widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            });
        }
    };

    // ===================
    // WORKFLOW-AWARE WIDGET EXPANSION
    // ===================

    const WorkflowManager = {
        currentWorkflow: null,

        workflows: {
            coding: {
                triggers: ['coding', 'developing', 'programming', 'debugging', 'git commit', 'building'],
                expand: ['bento-terminal', 'bento-subagents'],
                minimize: ['bento-notes', 'bento-activity']
            },
            planning: {
                triggers: ['planning', 'roadmap', 'strategy', 'reviewing', 'organizing'],
                expand: ['bento-task-board', 'bento-analytics'],
                minimize: ['bento-terminal']
            },
            research: {
                triggers: ['researching', 'reading', 'learning', 'investigating'],
                expand: ['bento-notes', 'bento-memory'],
                minimize: ['bento-terminal', 'bento-task-board']
            },
            communication: {
                triggers: ['chatting', 'messaging', 'discussing', 'meeting'],
                expand: ['bento-activity', 'bento-channels'],
                minimize: ['bento-terminal']
            },
            focus: {
                triggers: ['focusing', 'deep work', 'concentrating'],
                expand: ['bento-task-board'],
                minimize: ['bento-activity', 'bento-channels', 'bento-analytics']
            }
        },

        init() {
            // Monitor activity for workflow detection
            this.monitorActivity();

            // Listen for explicit workflow changes
            document.addEventListener('workflowChanged', (e) => {
                this.setWorkflow(e.detail.workflow);
            });
        },

        monitorActivity() {
            // Check last activities for workflow hints
            setInterval(() => {
                if (!window.state || !window.state.activity) return;

                const recentActivity = window.state.activity.slice(-5);
                const activityText = recentActivity.map(a => a.action).join(' ').toLowerCase();

                for (const [workflow, config] of Object.entries(this.workflows)) {
                    if (config.triggers.some(trigger => activityText.includes(trigger))) {
                        if (this.currentWorkflow !== workflow) {
                            this.setWorkflow(workflow);
                        }
                        break;
                    }
                }
            }, 30000); // Check every 30 seconds
        },

        setWorkflow(workflow) {
            if (this.currentWorkflow === workflow) return;
            this.currentWorkflow = workflow;

            const config = this.workflows[workflow];
            if (!config) return;

            // Apply workflow layout
            this.applyWorkflowLayout(config);

            console.log(`[Context] Workflow: ${workflow}`);

            // Show subtle indicator
            this.showWorkflowIndicator(workflow);
        },

        applyWorkflowLayout(config) {
            // Expand relevant widgets
            config.expand.forEach(cls => {
                const widget = document.querySelector(`.${cls}`);
                if (widget) {
                    widget.classList.add('workflow-expanded');
                    widget.classList.remove('workflow-minimized');
                }
            });

            // Minimize less relevant widgets
            config.minimize.forEach(cls => {
                const widget = document.querySelector(`.${cls}`);
                if (widget) {
                    widget.classList.add('workflow-minimized');
                    widget.classList.remove('workflow-expanded');
                }
            });
        },

        showWorkflowIndicator(workflow) {
            // Remove existing indicator
            const existing = document.getElementById('workflow-indicator');
            if (existing) existing.remove();

            const indicator = document.createElement('div');
            indicator.id = 'workflow-indicator';
            indicator.className = 'workflow-indicator';
            indicator.innerHTML = `
                <span class="workflow-dot"></span>
                <span class="workflow-name">${workflow}</span>
            `;

            document.body.appendChild(indicator);

            // Auto-remove after 3 seconds
            setTimeout(() => {
                indicator.classList.add('fading');
                setTimeout(() => indicator.remove(), 500);
            }, 3000);
        },

        clearWorkflow() {
            this.currentWorkflow = null;
            document.querySelectorAll('.bento-widget').forEach(widget => {
                widget.classList.remove('workflow-expanded', 'workflow-minimized');
            });
        }
    };

    // ===================
    // CONTEXT AWARENESS API
    // ===================

    window.ContextAwareness = {
        getTimeMode: () => TimeOfDayManager.currentMode,
        getAgentLayout: () => AgentLayoutManager.currentAgent,
        getWorkflow: () => WorkflowManager.currentWorkflow,

        setWorkflow: (workflow) => WorkflowManager.setWorkflow(workflow),
        clearWorkflow: () => WorkflowManager.clearWorkflow(),

        // Manual override for time mode
        setTimeMode: (mode) => {
            const modeData = TimeOfDayManager.modes[mode];
            if (modeData) {
                TimeOfDayManager.currentMode = mode;
                TimeOfDayManager.applyModeLayout(modeData);
                TimeOfDayManager.updateTimeModeIndicator(modeData);
            }
        },

        // Force agent layout
        setAgentLayout: (agent) => AgentLayoutManager.applyAgentLayout(agent)
    };

    // ===================
    // INITIALIZATION
    // ===================

    document.addEventListener('DOMContentLoaded', () => {
        TimeOfDayManager.init();
        AgentLayoutManager.init();
        WorkflowManager.init();

        console.log('[Phase 4] Context Awareness initialized');
    });

})();
