// js/phase7-activity-viz.js — Phase 7: Activity Visualization
// Live timeline, hour/day heatmap, message sparkline, agent presence

(function() {
    'use strict';

    // ===================
    // ACTIVITY VISUALIZATION MANAGER
    // ===================
    
    const ActivityVisualization = {
        maxTimelineItems: 50,
        updateInterval: null,
        
        init() {
            this.enhanceActivityWidget();
            this.startRealtimeUpdates();
            this.createMessageSparkline();
            this.createAgentPresence();
        },
        
        // ===================
        // 1. LIVE TIMELINE WITH ICONS
        // ===================
        
        enhanceActivityWidget() {
            const activityWidget = document.querySelector('.bento-activity');
            if (!activityWidget) return;
            
            // Update header with view toggle
            const header = activityWidget.querySelector('.bento-widget-header');
            if (header) {
                header.innerHTML = `
                    <div class="bento-widget-title">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Activity Timeline
                    </div>
                    <div class="activity-view-toggle">
                        <button class="active" data-view="timeline" title="Timeline view">📋</button>
                        <button data-view="heatmap" title="Heatmap view">🔥</button>
                    </div>
                `;
                
                // Add toggle handlers
                header.querySelectorAll('.activity-view-toggle button').forEach(btn => {
                    btn.addEventListener('click', () => this.switchActivityView(btn.dataset.view));
                });
            }
            
            // Update content structure
            const content = activityWidget.querySelector('.bento-widget-content');
            if (content) {
                content.innerHTML = `
                    <div id="activity-timeline-view" class="activity-view active">
                        <div id="activity-log" class="activity-timeline"></div>
                    </div>
                    <div id="activity-heatmap-view" class="activity-view">
                        <div id="activity-daily-heatmap" class="daily-heatmap"></div>
                    </div>
                `;
            }
            
            // Initial render
            this.renderTimeline();
        },
        
        switchActivityView(view) {
            document.querySelectorAll('.activity-view-toggle button').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
            
            document.querySelectorAll('.activity-view').forEach(v => {
                v.classList.toggle('active', v.id === `activity-${view}-view`);
            });
            
            if (view === 'heatmap') {
                this.renderDailyHeatmap();
            }
        },
        
        getActivityIcon(type, action) {
            const actionLower = action?.toLowerCase() || '';
            
            // Type-based icons
            if (type === 'error') return '❌';
            if (type === 'success') return '✅';
            if (type === 'warning') return '⚠️';
            if (type === 'system') return '⚙️';
            
            // Action-based icons
            if (actionLower.includes('task')) {
                if (actionLower.includes('complet')) return '✓';
                if (actionLower.includes('add')) return '📝';
                if (actionLower.includes('move')) return '↔️';
                if (actionLower.includes('delet')) return '🗑️';
                return '📋';
            }
            if (actionLower.includes('note')) return '📝';
            if (actionLower.includes('message') || actionLower.includes('chat')) return '💬';
            if (actionLower.includes('agent')) return '🤖';
            if (actionLower.includes('sync')) return '🔄';
            if (actionLower.includes('connect')) return '🔌';
            if (actionLower.includes('file') || actionLower.includes('upload')) return '📁';
            if (actionLower.includes('theme')) return '🎨';
            if (actionLower.includes('timer') || actionLower.includes('focus')) return '⏱️';
            if (actionLower.includes('subagent')) return '👥';
            
            return '•';
        },
        
        getActivityColor(type) {
            const colors = {
                error: '#ef4444',
                success: '#22c55e',
                warning: '#f59e0b',
                system: '#6b7280',
                info: '#3b82f6'
            };
            return colors[type] || colors.info;
        },
        
        _lastActivityHash: '',
        
        renderTimeline() {
            const container = document.getElementById('activity-log');
            if (!container) return;
            
            const activities = window.state?.activity?.slice(-this.maxTimelineItems) || [];
            
            if (activities.length === 0) {
                if (!this._lastActivityHash) return; // Already empty
                this._lastActivityHash = '';
                container.innerHTML = `
                    <div class="activity-empty">
                        <span>📊</span>
                        <p>No activity yet</p>
                    </div>
                `;
                return;
            }
            
            // Skip re-render if data hasn't changed
            const hash = activities.length + '_' + (activities[activities.length - 1]?.time || '');
            if (hash === this._lastActivityHash) return;
            this._lastActivityHash = hash;
            
            let html = '';
            let lastDate = null;
            
            activities.slice().reverse().forEach((activity, index) => {
                const date = new Date(activity.time).toLocaleDateString();
                const time = new Date(activity.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const icon = this.getActivityIcon(activity.type, activity.action);
                const color = this.getActivityColor(activity.type);
                
                // Add date separator
                if (date !== lastDate) {
                    html += `<div class="activity-date-separator">${date === new Date().toLocaleDateString() ? 'Today' : date}</div>`;
                    lastDate = date;
                }
                
                const isNew = index < 3; // Mark recent items
                
                html += `
                    <div class="activity-timeline-item ${isNew ? 'recent' : ''}" style="--activity-color: ${color}">
                        <div class="activity-timeline-line"></div>
                        <div class="activity-timeline-dot" style="background: ${color}">
                            <span>${icon}</span>
                        </div>
                        <div class="activity-timeline-content">
                            <div class="activity-timeline-text">${activity.action}</div>
                            <div class="activity-timeline-meta">
                                <span class="activity-time">${time}</span>
                                ${activity.source ? `<span class="activity-source">${activity.source}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            container.innerHTML = html;
        },
        
        // ===================
        // 2. HOUR/DAY HEATMAP
        // ===================
        
        renderDailyHeatmap() {
            const container = document.getElementById('activity-daily-heatmap');
            if (!container) return;
            
            const activities = window.state?.activity || [];
            
            // Calculate activity by hour for last 24 hours
            const hourlyData = {};
            const now = Date.now();
            const oneDayAgo = now - (24 * 60 * 60 * 1000);
            
            // Initialize all hours
            for (let i = 0; i < 24; i++) {
                hourlyData[i] = 0;
            }
            
            activities.forEach(a => {
                if (a.time > oneDayAgo) {
                    const hour = new Date(a.time).getHours();
                    hourlyData[hour]++;
                }
            });
            
            // Find max for normalization
            const maxCount = Math.max(...Object.values(hourlyData), 1);
            
            // Generate heatmap HTML
            let html = '<div class="hourly-heatmap">';
            
            for (let hour = 0; hour < 24; hour++) {
                const count = hourlyData[hour];
                const intensity = count / maxCount;
                const opacity = 0.1 + (intensity * 0.9);
                
                html += `
                    <div class="heatmap-hour" 
                         style="--heat-opacity: ${opacity}"
                         title="${hour}:00 - ${count} activities">
                        <span class="hour-label">${hour}</span>
                        <div class="heat-bar" style="height: ${Math.max(intensity * 100, 5)}%"></div>
                    </div>
                `;
            }
            
            html += '</div>';
            html += '<div class="heatmap-legend">Last 24 hours</div>';
            
            container.innerHTML = html;
        },
        
        // ===================
        // 3. MESSAGE VOLUME SPARKLINE
        // ===================
        
        createMessageSparkline() {
            const quickStats = document.querySelector('.bento-quick-stats');
            if (!quickStats) return;
            
            // Add sparkline container to the messages stat
            const messagesStat = quickStats.querySelector('#sparkline-messages');
            if (messagesStat && !messagesStat.querySelector('.message-sparkline')) {
                messagesStat.innerHTML = '<svg class="message-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>';
            }
            
            this.updateMessageSparkline();
        },
        
        updateMessageSparkline() {
            const svg = document.querySelector('.message-sparkline');
            if (!svg) return;
            
            // Get message counts by hour
            const messages = window.state?.chat?.messages || [];
            const hourlyCounts = {};
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            
            // Initialize
            for (let i = 0; i < 24; i++) hourlyCounts[i] = 0;
            
            messages.forEach(m => {
                if (m.time > oneDayAgo) {
                    const hour = new Date(m.time).getHours();
                    hourlyCounts[hour]++;
                }
            });
            
            // Generate sparkline path
            const data = Object.values(hourlyCounts);
            const max = Math.max(...data, 1);
            const points = data.map((count, i) => {
                const x = (i / 23) * 100;
                const y = 30 - ((count / max) * 28) - 1;
                return `${x},${y}`;
            }).join(' ');
            
            svg.innerHTML = `
                <defs>
                    <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:var(--brand-primary);stop-opacity:0.3" />
                        <stop offset="100%" style="stop-color:var(--brand-primary);stop-opacity:0" />
                    </linearGradient>
                </defs>
                <polygon points="0,30 ${points} 100,30" fill="url(#sparkline-gradient)" />
                <polyline points="${points}" fill="none" stroke="var(--brand-primary)" stroke-width="2" vector-effect="non-scaling-stroke" />
                ${data.map((count, i) => {
                    const x = (i / 23) * 100;
                    const y = 30 - ((count / max) * 28) - 1;
                    return count > 0 ? `<circle cx="${x}" cy="${y}" r="1.5" fill="var(--brand-primary)" />` : '';
                }).join('')}
            `;
        },
        
        // ===================
        // 4. AGENT PRESENCE INDICATORS
        // ===================
        
        createAgentPresence() {
            // Check if already exists
            if (document.querySelector('.agent-presence-panel')) return;
            
            const widget = document.createElement('div');
            widget.className = 'bento-widget bento-agent-presence';
            widget.innerHTML = `
                <div class="bento-widget-header">
                    <div class="bento-widget-title">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                        Agent Presence
                    </div>
                </div>
                <div class="bento-widget-content">
                    <div id="agent-presence-list" class="agent-presence-list"></div>
                </div>
            `;
            
            // Insert after agents widget
            const agentsWidget = document.querySelector('.bento-agents');
            if (agentsWidget && agentsWidget.parentNode) {
                agentsWidget.parentNode.insertBefore(widget, agentsWidget.nextSibling);
            }
            
            this.updateAgentPresence();
        },
        
        updateAgentPresence() {
            const container = document.getElementById('agent-presence-list');
            if (!container) return;
            
            const agents = [
                { id: 'main', name: 'Main', color: '#ef4444' },
                { id: 'dev', name: 'DEV', color: '#3b82f6' },
                { id: 'atlas', name: 'COO', color: '#22c55e' },
                { id: 'research', name: 'Research', color: '#8b5cf6' }
            ];
            
            const now = Date.now();
            const activities = window.state?.activity || [];
            
            let html = '';
            
            agents.forEach(agent => {
                // Find last activity for this agent
                const lastActivity = activities
                    .filter(a => a.source?.toLowerCase().includes(agent.id) || 
                                 a.action?.toLowerCase().includes(agent.id))
                    .sort((a, b) => b.time - a.time)[0];
                
                const lastActiveTime = lastActivity?.time || 0;
                const idleMs = now - lastActiveTime;
                const idleMinutes = Math.floor(idleMs / 60000);
                
                // Determine status
                let status = 'offline';
                let statusText = 'Offline';
                let pulseClass = '';
                
                if (idleMs < 5 * 60 * 1000) {
                    status = 'online';
                    statusText = 'Active';
                    pulseClass = 'pulse';
                } else if (idleMs < 30 * 60 * 1000) {
                    status = 'away';
                    statusText = `Idle ${idleMinutes}m`;
                }
                
                // Calculate activity sparkline (last 6 hours)
                const sixHoursAgo = now - (6 * 60 * 60 * 1000);
                const agentActivities = activities.filter(a => 
                    (a.source?.toLowerCase().includes(agent.id) || 
                     a.action?.toLowerCase().includes(agent.id)) &&
                    a.time > sixHoursAgo
                );
                
                // Create mini sparkline
                const hourlyBuckets = [0, 0, 0, 0, 0, 0];
                agentActivities.forEach(a => {
                    const hoursAgo = Math.floor((now - a.time) / (60 * 60 * 1000));
                    if (hoursAgo < 6) hourlyBuckets[5 - hoursAgo]++;
                });
                
                const maxBucket = Math.max(...hourlyBuckets, 1);
                const sparklineSvg = hourlyBuckets.map((count, i) => {
                    const height = (count / maxBucket) * 12;
                    return `<rect x="${i * 4}" y="${12 - height}" width="3" height="${height}" rx="1" fill="${agent.color}" opacity="0.6"/>`;
                }).join('');
                
                html += `
                    <div class="agent-presence-item ${status}">
                        <div class="agent-presence-avatar" style="--agent-color: ${agent.color}">
                            <span class="agent-presence-status ${pulseClass}"></span>
                        </div>
                        <div class="agent-presence-info">
                            <div class="agent-presence-name">${agent.name}</div>
                            <div class="agent-presence-status-text">${statusText}</div>
                        </div>
                        <svg class="agent-presence-sparkline" viewBox="0 0 24 12">
                            ${sparklineSvg}
                        </svg>
                    </div>
                `;
            });
            
            container.innerHTML = html;
        },
        
        // ===================
        // REALTIME UPDATES
        // ===================
        
        startRealtimeUpdates() {
            // Update timeline every 10 seconds
            this.updateInterval = setInterval(() => {
                this.renderTimeline();
                this.updateMessageSparkline();
                this.updateAgentPresence();
            }, 10000);
        },
        
        // ===================
        // PUBLIC API
        // ===================
        
        refresh() {
            this.renderTimeline();
            this.updateMessageSparkline();
            this.updateAgentPresence();
        }
    };
    
    // ===================
    // EXPOSE GLOBALLY
    // ===================
    
    window.ActivityVisualization = ActivityVisualization;
    
    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => ActivityVisualization.init(), 500);
        console.log('[Phase 7] Activity Visualization initialized');
    });

})();