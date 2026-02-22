// js/phase11-agents.js — Phase 11: Agent Status Panel
// Traffic light indicators, sparklines, handoff button, resource usage display

(function () {
    'use strict';

    // ==========================================
    // Agent Status State
    // ==========================================

    const agentActivityHistory = {}; // agentId -> { timestamps: [], tokens: [], runtime: [] }
    const AGENT_HISTORY_LIMIT = 50;

    const agentResourceUsage = {}; // agentId -> { tokensUsed, runtimeSeconds, lastReset }

    const agentStatusConfig = {
        activeThreshold: 5 * 60 * 1000,    // 5 minutes = green
        recentThreshold: 30 * 60 * 1000,   // 30 minutes = yellow
        // beyond = red
    };

    // ==========================================
    // Traffic Light Indicators
    // ==========================================

    function getAgentStatusColor(lastActivity) {
        if (!lastActivity) return { color: 'gray', status: 'idle', text: 'Idle' };

        const elapsed = Date.now() - lastActivity;

        if (elapsed < agentStatusConfig.activeThreshold) {
            return { color: '#22c55e', status: 'active', text: 'Active' }; // Green
        } else if (elapsed < agentStatusConfig.recentThreshold) {
            return { color: '#eab308', status: 'recent', text: 'Recent' }; // Yellow
        } else {
            return { color: '#ef4444', status: 'idle', text: 'Idle' }; // Red
        }
    }

    function renderTrafficLight(status) {
        const colors = {
            active: { bg: '#22c55e', glow: 'rgba(34, 197, 94, 0.4)' },
            recent: { bg: '#eab308', glow: 'rgba(234, 179, 8, 0.4)' },
            idle: { bg: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)' }
        };

        const c = colors[status.status] || colors.idle;

        return `
            <div class="traffic-light" style="
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: ${c.bg};
                box-shadow: 0 0 8px ${c.glow}, 0 0 4px ${c.glow};
                animation: ${status.status === 'active' ? 'pulse-green 2s infinite' : 'none'};
            "></div>
        `;
    }

    // ==========================================
    // Mini Sparklines
    // ==========================================

    function recordAgentActivity(agentId, tokens = 0, runtimeSeconds = 0) {
        if (!agentActivityHistory[agentId]) {
            agentActivityHistory[agentId] = {
                timestamps: [],
                tokens: [],
                runtime: [],
                activity: [] // binary activity per minute
            };
        }

        const history = agentActivityHistory[agentId];
        const now = Date.now();

        history.timestamps.push(now);
        history.tokens.push(tokens);
        history.runtime.push(runtimeSeconds);

        // Keep only recent history
        if (history.timestamps.length > AGENT_HISTORY_LIMIT) {
            history.timestamps.shift();
            history.tokens.shift();
            history.runtime.shift();
        }

        // Track resource usage
        if (!agentResourceUsage[agentId]) {
            agentResourceUsage[agentId] = { tokensUsed: 0, runtimeSeconds: 0, lastReset: now };
        }
        agentResourceUsage[agentId].tokensUsed += tokens;
        agentResourceUsage[agentId].runtimeSeconds += runtimeSeconds;
    }

    function generateSparkline(data, width = 60, height = 20, color = '#6366f1') {
        if (!data || data.length < 2) {
            return `<svg width="${width}" height="${height}" style="opacity: 0.3;">
                <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="8" fill="currentColor">No data</text>
            </svg>`;
        }

        const max = Math.max(...data, 1);
        const min = Math.min(...data, 0);
        const range = max - min || 1;

        const points = data.map((val, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((val - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');

        return `
            <svg width="${width}" height="${height}" class="sparkline">
                <polyline points="${points}" 
                          fill="none" 
                          stroke="${color}" 
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"/>
                <circle cx="${width}" cy="${height - ((data[data.length - 1] - min) / range) * height}" 
                        r="2" fill="${color}"/>
            </svg>
        `;
    }

    function renderAgentSparkline(agentId) {
        const history = agentActivityHistory[agentId];
        if (!history || history.activity.length < 2) {
            return generateSparkline([], 60, 20);
        }

        // Use token usage for sparkline, or activity if no tokens
        const data = history.tokens.some(t => t > 0) ? history.tokens : history.activity;
        const color = AGENT_COLORS[agentId] || '#6366f1';

        return generateSparkline(data.slice(-20), 60, 20, color);
    }

    // ==========================================
    // Resource Usage Display
    // ==========================================

    function formatTokenCount(count) {
        if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
        if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
        return count.toString();
    }

    function formatRuntime(seconds) {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    function renderResourceUsage(agentId) {
        const usage = agentResourceUsage[agentId];
        if (!usage) {
            return `
                <div class="resource-usage">
                    <span class="resource-stat">- tokens</span>
                    <span class="resource-stat">- runtime</span>
                </div>
            `;
        }

        return `
            <div class="resource-usage">
                <span class="resource-stat" title="Tokens used">📝 ${formatTokenCount(usage.tokensUsed)}</span>
                <span class="resource-stat" title="Runtime">⏱️ ${formatRuntime(usage.runtimeSeconds)}</span>
            </div>
        `;
    }

    function resetAgentResources(agentId) {
        if (agentResourceUsage[agentId]) {
            agentResourceUsage[agentId] = {
                tokensUsed: 0,
                runtimeSeconds: 0,
                lastReset: Date.now()
            };
        }
    }

    // ==========================================
    // Handoff Button
    // ==========================================

    function handoffToAgent(fromAgent, toAgent) {
        // Get active task from fromAgent if any
        const agentTasks = {
            todo: (state.tasks.todo || []).filter(t => getTaskAgent(t) === fromAgent),
            progress: (state.tasks.progress || []).filter(t => getTaskAgent(t) === fromAgent)
        };

        // Create handoff message
        const handoffMsg = {
            id: 'sys-' + Date.now(),
            role: 'system',
            text: `🔄 Handoff from ${fromAgent.toUpperCase()} to ${toAgent.toUpperCase()}`,
            time: Date.now()
        };

        state.system.messages.push(handoffMsg);
        persistSystemMessages();

        // Switch to target agent
        if (typeof setActiveSidebarAgent === 'function') {
            setActiveSidebarAgent(toAgent);
        }
        currentAgentId = toAgent;

        // Add activity
        addActivity(`🔄 Handoff: ${fromAgent.toUpperCase()} → ${toAgent.toUpperCase()}`, 'info');

        // Send context summary
        const context = agentTasks.progress.length > 0
            ? `Active task: ${agentTasks.progress[0].title}`
            : agentTasks.todo.length > 0
                ? `Next up: ${agentTasks.todo[0].title}`
                : 'No active tasks';

        // If on chat page, add handoff message
        if (typeof sendToAgent === 'function') {
            sendToAgent(`[Handoff from ${fromAgent.toUpperCase()}] ${context}`);
        }

        showToast(`Handed off to ${toAgent.toUpperCase()}`, 'success');

        // Play audio cue if available
        if (typeof playAudioCue === 'function') {
            playAudioCue('info');
        }
    }

    function showHandoffDialog(fromAgent) {
        const agents = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'sec', 'smm', 'family', 'tax']
            .filter(a => a !== fromAgent);

        const buttons = agents.map(agent => {
            const color = AGENT_COLORS[agent] || '#888';
            return `
                <button onclick="handoffToAgent('${fromAgent}', '${agent}'); closeModal('handoff-modal');"
                        class="btn btn-ghost" 
                        style="border-color: ${color}; color: ${color}; margin: 4px;">
                    ${agent.toUpperCase()}
                </button>
            `;
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'handoff-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <div class="modal-header">
                    <h3 class="modal-title">🔄 Handoff from ${fromAgent.toUpperCase()}</h3>
                    <button onclick="closeModal('handoff-modal')" class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 16px;">Select agent to handoff to:</p>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${buttons}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('visible'), 10);
    }

    // ==========================================
    // Enhanced Agent Status Panel
    // ==========================================

    function renderEnhancedAgentStatuses(sessions) {
        const container = document.getElementById('agent-status-list');
        if (!container) return;

        // Group sessions by agent
        const agents = {};
        const knownAgents = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'family', 'tax', 'sec', 'smm'];

        for (const s of sessions) {
            const match = s.key?.match(/^agent:([^:]+):/);
            const agentId = match ? (window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1]) : 'main';
            if (!agents[agentId]) {
                agents[agentId] = { sessions: [], lastActivity: 0, lastPreview: '', tokens: 0 };
            }
            agents[agentId].sessions.push(s);
            const ts = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
            if (ts > agents[agentId].lastActivity) {
                agents[agentId].lastActivity = ts;
                agents[agentId].lastPreview = s.displayName || s.key || '';
            }
            // Estimate tokens from session data if available
            if (s.tokens) agents[agentId].tokens += s.tokens;
        }

        // Ensure all known agents appear
        for (const id of knownAgents) {
            if (!agents[id]) agents[id] = { sessions: [], lastActivity: 0, lastPreview: '', tokens: 0 };
        }

        // Sort by most recent activity
        const sorted = Object.entries(agents).sort((a, b) => b[1].lastActivity - a[1].lastActivity);

        const agentLabels = {
            main: 'SoLoBot', exec: 'EXEC', coo: 'COO', cfo: 'CFO',
            cmp: 'CMP', dev: 'DEV', family: 'Family', tax: 'Tax', sec: 'SEC', smm: 'SMM'
        };

        container.innerHTML = sorted.map(([id, data]) => {
            const label = agentLabels[id] || id.toUpperCase();
            const sessionCount = data.sessions.length;
            const timeSince = data.lastActivity ? timeAgo(data.lastActivity) : 'No activity';
            const status = getAgentStatusColor(data.lastActivity);
            const color = AGENT_COLORS[id] || '#888';

            // Record activity for sparkline
            if (data.lastActivity) {
                recordAgentActivity(id, data.tokens, 0);
            }

            return `
            <div class="agent-status-row enhanced" data-agent="${id}">
                <div class="agent-status-header" onclick="switchToAgent('${id}')" style="cursor: pointer; flex: 1;">
                    <div class="agent-status-main">
                        ${renderTrafficLight(status)}
                        <div class="agent-info">
                            <div class="agent-name-row">
                                <span class="agent-name" style="color: ${color};">${label}</span>
                                <span class="agent-sessions">${sessionCount} session${sessionCount !== 1 ? 's' : ''}</span>
                            </div>
                            <div class="agent-meta">
                                ${timeSince}${data.lastPreview ? ' · ' + escapeHtml(data.lastPreview.slice(0, 25)) : ''}
                            </div>
                        </div>
                    </div>
                    <div class="agent-sparkline-row">
                        ${renderAgentSparkline(id)}
                    </div>
                </div>
                <div class="agent-actions">
                    <button onclick="event.stopPropagation(); showHandoffDialog('${id}')" 
                            class="btn btn-ghost handoff-btn" 
                            title="Handoff to another agent"
                            style="padding: 2px 6px; font-size: 11px;">
                        🔄
                    </button>
                </div>
            </div>
            <div class="agent-resources" style="padding-left: 24px; margin-bottom: 8px;">
                ${renderResourceUsage(id)}
            </div>
            `;
        }).join('');
    }

    // ==========================================
    // Override Original Functions
    // ==========================================

    // Override loadAgentStatuses to use enhanced version
    const originalLoadAgentStatuses = window.loadAgentStatuses;
    window.loadAgentStatuses = async function () {
        const container = document.getElementById('agent-status-list');
        if (!container) return;

        if (!gateway || !gateway.isConnected()) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 16px;">Connect to gateway to see agents</div>';
            return;
        }

        try {
            const result = await gateway._request('sessions.list', { includeGlobal: true });
            const sessions = result?.sessions || [];
            renderEnhancedAgentStatuses(sessions);
        } catch (e) {
            console.warn('[Agents] Failed to fetch sessions:', e.message);
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center;">Failed to load</div>';
        }
    };

    // ==========================================
    // CSS Animations
    // ==========================================

    function injectStyles() {
        if (document.getElementById('phase11-styles')) return;

        const style = document.createElement('style');
        style.id = 'phase11-styles';
        style.textContent = `
            @keyframes pulse-green {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
            
            .agent-status-row.enhanced {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px;
                border-radius: var(--radius-md);
                transition: background 0.15s;
                border: 1px solid transparent;
            }
            
            .agent-status-row.enhanced:hover {
                background: var(--surface-2);
                border-color: var(--border-subtle);
            }
            
            .agent-status-header {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            
            .agent-status-main {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .agent-info {
                flex: 1;
                min-width: 0;
            }
            
            .agent-name-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .agent-name {
                font-weight: 600;
                font-size: 13px;
            }
            
            .agent-sessions {
                font-size: 10px;
                color: var(--text-muted);
                background: var(--surface-2);
                padding: 1px 6px;
                border-radius: 10px;
            }
            
            .agent-meta {
                font-size: 11px;
                color: var(--text-muted);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .agent-sparkline-row {
                margin-top: 4px;
            }
            
            .sparkline {
                display: block;
            }
            
            .agent-actions {
                display: flex;
                gap: 4px;
            }
            
            .handoff-btn {
                opacity: 0;
                transition: opacity 0.2s;
            }
            
            .agent-status-row.enhanced:hover .handoff-btn {
                opacity: 1;
            }
            
            .resource-usage {
                display: flex;
                gap: 12px;
                font-size: 10px;
                color: var(--text-muted);
            }
            
            .resource-stat {
                display: flex;
                align-items: center;
                gap: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // Global Exports
    // ==========================================

    window.handoffToAgent = handoffToAgent;
    window.showHandoffDialog = showHandoffDialog;
    window.resetAgentResources = resetAgentResources;
    window.getAgentStatusColor = getAgentStatusColor;
    window.recordAgentActivity = recordAgentActivity;

    // Helper for closing modals
    window.closeModal = function (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('visible');
            setTimeout(() => modal.remove(), 300);
        }
    };

    // ==========================================
    // Initialization
    // ==========================================

    function init() {
        injectStyles();
        console.log('[Phase11] Agent Status Panel initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
