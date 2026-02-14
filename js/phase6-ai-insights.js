// js/phase6-ai-insights.js — Phase 6: AI Insights Widget
// Weekly summaries, idle alerts, pattern suggestions, natural language summaries

(function() {
    'use strict';

    // ===================
    // AI INSIGHTS MANAGER
    // ===================
    
    const AIInsights = {
        insights: [],
        lastAnalysis: null,
        analysisInterval: null,
        
        init() {
            this.createWidget();
            this.startAnalysisLoop();
            this.setupEventListeners();
        },
        
        createWidget() {
            // Check if widget already exists
            if (document.querySelector('.bento-ai-insights')) return;
            
            const widget = document.createElement('div');
            widget.className = 'bento-widget bento-ai-insights';
            widget.innerHTML = `
                <div class="bento-widget-header">
                    <div class="bento-widget-title">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                        </svg>
                        AI Insights
                        <span class="ai-badge">AI</span>
                    </div>
                    <div class="bento-widget-actions">
                        <button onclick="AIInsights.analyzeNow()" class="btn-icon" title="Analyze now">
                            🔄
                        </button>
                    </div>
                </div>
                <div class="bento-widget-content">
                    <div id="ai-insights-container" class="ai-insights-container">
                        <div class="ai-insights-loading">
                            <span class="ai-pulse"></span>
                            <span>Analyzing your productivity...</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Insert after quick-stats widget
            const quickStats = document.querySelector('.bento-quick-stats');
            if (quickStats && quickStats.parentNode) {
                quickStats.parentNode.insertBefore(widget, quickStats.nextSibling);
            } else {
                // Fallback: append to bento grid
                const grid = document.querySelector('.bento-grid');
                if (grid) grid.appendChild(widget);
            }
        },
        
        startAnalysisLoop() {
            // Initial analysis
            setTimeout(() => this.analyze(), 2000);
            
            // Periodic analysis every 5 minutes
            this.analysisInterval = setInterval(() => {
                this.analyze();
            }, 5 * 60 * 1000);
        },
        
        setupEventListeners() {
            // Re-analyze when tasks change significantly
            document.addEventListener('taskChanged', () => {
                setTimeout(() => this.analyze(), 1000);
            });
        },
        
        analyzeNow() {
            this.analyze();
            showToast('Analyzing your productivity...', 'info');
        },
        
        analyze() {
            this.lastAnalysis = Date.now();
            this.insights = [];
            
            // Gather data
            const tasks = window.state?.tasks || { todo: [], progress: [], done: [], archive: [] };
            const activity = window.state?.activity || [];
            const notes = window.state?.notes || [];
            
            // Generate insights
            this.generateWeeklySummary(tasks);
            this.checkIdleAlerts(activity);
            this.generatePatternSuggestions(tasks, activity);
            this.generateNaturalLanguageSummary(tasks, activity);
            
            // Render
            this.renderInsights();
        },
        
        // ===================
        // WEEKLY TASK COMPLETION SUMMARY
        // ===================
        
        generateWeeklySummary(tasks) {
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            
            // Count completed tasks this week
            const completedThisWeek = (tasks.done || []).filter(t => 
                t.completedAt && t.completedAt > oneWeekAgo
            ).length;
            
            // Count completed last week for comparison
            const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
            const completedLastWeek = (tasks.done || []).filter(t => 
                t.completedAt && t.completedAt > twoWeeksAgo && t.completedAt <= oneWeekAgo
            ).length;
            
            // Calculate trend
            let trend = 'same';
            let trendIcon = '→';
            if (completedThisWeek > completedLastWeek) {
                trend = 'up';
                trendIcon = '↑';
            } else if (completedThisWeek < completedLastWeek) {
                trend = 'down';
                trendIcon = '↓';
            }
            
            // Calculate completion rate
            const totalActive = (tasks.todo || []).length + (tasks.progress || []).length + completedThisWeek;
            const completionRate = totalActive > 0 ? Math.round((completedThisWeek / totalActive) * 100) : 0;
            
            this.insights.push({
                type: 'weekly-summary',
                priority: 'high',
                icon: '📊',
                title: 'Weekly Progress',
                content: `You completed <strong>${completedThisWeek} tasks</strong> this week ${trendIcon}`,
                details: [
                    `Completion rate: ${completionRate}%`,
                    `In progress: ${tasks.progress?.length || 0}`,
                    `Backlog: ${tasks.todo?.length || 0}`
                ],
                trend: trend
            });
        },
        
        // ===================
        // AGENT IDLE TIME ALERTS
        // ===================
        
        checkIdleAlerts(activity) {
            const now = Date.now();
            const fiveMinutesAgo = now - (5 * 60 * 1000);
            const thirtyMinutesAgo = now - (30 * 60 * 1000);
            
            // Get recent activities
            const recentActivity = activity.filter(a => a.time > thirtyMinutesAgo);
            
            // Check if any agent has been idle
            const agentActivity = {};
            const agents = ['main', 'dev', 'coo', 'research'];
            
            agents.forEach(agent => {
                const agentActs = recentActivity.filter(a => 
                    a.action?.toLowerCase().includes(agent) ||
                    a.source?.toLowerCase().includes(agent)
                );
                
                const lastActive = agentActs.length > 0 ? 
                    Math.max(...agentActs.map(a => a.time)) : 0;
                
                agentActivity[agent] = {
                    lastActive,
                    idleTime: now - lastActive
                };
            });
            
            // Find idle agents
            const idleAgents = Object.entries(agentActivity)
                .filter(([agent, data]) => data.idleTime > 30 * 60 * 1000 && data.lastActive > 0)
                .map(([agent, data]) => ({ agent, ...data }));
            
            if (idleAgents.length > 0) {
                const idleNames = idleAgents.map(a => a.agent.toUpperCase()).join(', ');
                const idleMinutes = Math.round(Math.min(...idleAgents.map(a => a.idleTime)) / 60000);
                
                this.insights.push({
                    type: 'idle-alert',
                    priority: 'medium',
                    icon: '⏰',
                    title: 'Agent Idle Alert',
                    content: `<strong>${idleNames}</strong> ${idleAgents.length === 1 ? 'has' : 'have'} been idle for ${idleMinutes} minutes`,
                    details: idleAgents.map(a => 
                        `${a.agent.toUpperCase()}: ${Math.round(a.idleTime / 60000)}m idle`
                    ),
                    action: {
                        label: 'Wake Agents',
                        handler: () => this.wakeIdleAgents(idleAgents.map(a => a.agent))
                    }
                });
            }
        },
        
        wakeIdleAgents(agents) {
            agents.forEach(agent => {
                addActivity(`Waking up ${agent.toUpperCase()} agent`, 'system');
            });
            showToast(`Waking up ${agents.join(', ').toUpperCase()}...`, 'info');
        },
        
        // ===================
        // PATTERN-BASED SUGGESTIONS
        // ===================
        
        generatePatternSuggestions(tasks, activity) {
            const suggestions = [];
            
            // Pattern 1: Many tasks in progress
            const inProgress = tasks.progress || [];
            if (inProgress.length >= 5) {
                suggestions.push({
                    icon: '🎯',
                    text: `You have ${inProgress.length} tasks in progress. Consider focusing on completing a few before starting new ones.`,
                    type: 'focus'
                });
            }
            
            // Pattern 2: Old todo items
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const oldTodos = (tasks.todo || []).filter(t => t.created < oneWeekAgo);
            if (oldTodos.length >= 3) {
                suggestions.push({
                    icon: '📦',
                    text: `${oldTodos.length} tasks have been in todo for over a week. Consider reviewing or archiving them.`,
                    type: 'cleanup'
                });
            }
            
            // Pattern 3: High priority backlog
            const p0Todos = (tasks.todo || []).filter(t => t.priority === 0);
            if (p0Todos.length >= 3) {
                suggestions.push({
                    icon: '🔥',
                    text: `You have ${p0Todos.length} high-priority (P0) tasks waiting. Consider tackling one now.`,
                    type: 'priority'
                });
            }
            
            // Pattern 4: Completion streak
            const today = new Date().toDateString();
            const completionsToday = (tasks.done || []).filter(t => 
                t.completedAt && new Date(t.completedAt).toDateString() === today
            ).length;
            
            if (completionsToday >= 5) {
                suggestions.push({
                    icon: '🔥',
                    text: `Great job! You've completed ${completionsToday} tasks today. Keep the momentum going!`,
                    type: 'positive'
                });
            }
            
            // Pattern 5: Activity gaps
            const hourlyActivity = this.analyzeHourlyPatterns(activity);
            const peakHours = hourlyActivity.filter(h => h.count > 5).map(h => h.hour);
            if (peakHours.length > 0) {
                const avgPeak = Math.round(peakHours.reduce((a, b) => a + b, 0) / peakHours.length);
                suggestions.push({
                    icon: '📈',
                    text: `Your most productive hours appear to be around ${avgPeak}:00. Consider scheduling deep work then.`,
                    type: 'productivity'
                });
            }
            
            if (suggestions.length > 0) {
                this.insights.push({
                    type: 'suggestions',
                    priority: 'medium',
                    icon: '💡',
                    title: 'Suggestions',
                    suggestions: suggestions.slice(0, 3) // Limit to top 3
                });
            }
        },
        
        analyzeHourlyPatterns(activity) {
            const hourly = {};
            for (let i = 0; i < 24; i++) hourly[i] = 0;
            
            activity.forEach(a => {
                const hour = new Date(a.time).getHours();
                hourly[hour]++;
            });
            
            return Object.entries(hourly)
                .map(([hour, count]) => ({ hour: parseInt(hour), count }))
                .sort((a, b) => b.count - a.count);
        },
        
        // ===================
        // NATURAL LANGUAGE SUMMARIES
        // ===================
        
        generateNaturalLanguageSummary(tasks, activity) {
            const summaries = [];
            
            // Overall status summary
            const totalTasks = (tasks.todo?.length || 0) + (tasks.progress?.length || 0) + (tasks.done?.length || 0);
            const completionRate = totalTasks > 0 ? 
                Math.round((tasks.done?.length || 0) / totalTasks * 100) : 0;
            
            let statusPhrase = '';
            if (completionRate >= 80) statusPhrase = 'crushing it';
            else if (completionRate >= 50) statusPhrase = 'making good progress';
            else if (completionRate >= 20) statusPhrase = 'building momentum';
            else statusPhrase = 'just getting started';
            
            summaries.push(`You're ${statusPhrase} with a ${completionRate}% completion rate.`);
            
            // Workload summary
            if (tasks.progress?.length > 0) {
                summaries.push(`Currently focusing on ${tasks.progress.length} ${tasks.progress.length === 1 ? 'task' : 'tasks'}.`);
            }
            
            // Recent activity summary
            const recentCompletions = (tasks.done || []).filter(t => {
                if (!t.completedAt) return false;
                const hoursAgo = (Date.now() - t.completedAt) / (60 * 60 * 1000);
                return hoursAgo < 24;
            }).length;
            
            if (recentCompletions > 0) {
                summaries.push(`Completed ${recentCompletions} ${recentCompletions === 1 ? 'task' : 'tasks'} in the last 24 hours.`);
            }
            
            // Combine into natural language
            const summaryText = summaries.join(' ');
            
            this.insights.push({
                type: 'summary',
                priority: 'low',
                icon: '🤖',
                title: 'Daily Summary',
                content: summaryText,
                isNLP: true
            });
        },
        
        // ===================
        // RENDERING
        // ===================
        
        renderInsights() {
            const container = document.getElementById('ai-insights-container');
            if (!container) return;
            
            if (this.insights.length === 0) {
                container.innerHTML = `
                    <div class="ai-insights-empty">
                        <span>📊</span>
                        <p>Not enough data for insights yet.</p>
                        <small>Keep using the dashboard to generate insights.</small>
                    </div>
                `;
                return;
            }
            
            // Sort by priority
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            const sortedInsights = [...this.insights].sort((a, b) => 
                priorityOrder[a.priority] - priorityOrder[b.priority]
            );
            
            let html = '';
            
            sortedInsights.forEach(insight => {
                html += this.renderInsightCard(insight);
            });
            
            container.innerHTML = html;
        },
        
        renderInsightCard(insight) {
            const priorityClass = `priority-${insight.priority}`;
            
            let detailsHtml = '';
            if (insight.details && insight.details.length > 0) {
                detailsHtml = `
                    <div class="ai-insight-details">
                        ${insight.details.map(d => `<span class="ai-insight-detail">${d}</span>`).join('')}
                    </div>
                `;
            }
            
            let suggestionsHtml = '';
            if (insight.suggestions && insight.suggestions.length > 0) {
                suggestionsHtml = `
                    <div class="ai-suggestions-list">
                        ${insight.suggestions.map(s => `
                            <div class="ai-suggestion-item type-${s.type}">
                                <span class="ai-suggestion-icon">${s.icon}</span>
                                <span class="ai-suggestion-text">${s.text}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            
            let actionHtml = '';
            if (insight.action) {
                actionHtml = `
                    <button class="ai-insight-action" onclick="(${insight.action.handler.toString()})()">
                        ${insight.action.label}
                    </button>
                `;
            }
            
            const nlpClass = insight.isNLP ? 'ai-nlp-summary' : '';
            
            return `
                <div class="ai-insight-card ${priorityClass} ${nlpClass}">
                    <div class="ai-insight-header">
                        <span class="ai-insight-icon">${insight.icon}</span>
                        <span class="ai-insight-title">${insight.title}</span>
                        ${insight.trend ? `<span class="ai-insight-trend ${insight.trend}">${insight.trend === 'up' ? '↑' : insight.trend === 'down' ? '↓' : '→'}</span>` : ''}
                    </div>
                    <div class="ai-insight-content">${insight.content}</div>
                    ${detailsHtml}
                    ${suggestionsHtml}
                    ${actionHtml}
                </div>
            `;
        }
    };
    
    // ===================
    // EXPOSE GLOBALLY
    // ===================
    
    window.AIInsights = AIInsights;
    
    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => AIInsights.init(), 1000);
        console.log('[Phase 6] AI Insights initialized');
    });

})();