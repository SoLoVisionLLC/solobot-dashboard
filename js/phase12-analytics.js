// js/phase12-analytics.js — Phase 12: Analytics Widget
// Token usage line chart, cost breakdown donut chart, session duration heatmap, comparative performance

(function() {
    'use strict';

    // ==========================================
    // Analytics State
    // ==========================================
    
    let tokenHistory = []; // { timestamp, agent, tokens, cost }
    let sessionDurations = []; // { agent, start, end, duration }
    const ANALYTICS_HISTORY_DAYS = 30;

    // ==========================================
    // SVG Chart Helpers
    // ==========================================

    function createSVGElement(tag, attrs = {}) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, val] of Object.entries(attrs)) {
            el.setAttribute(key, val);
        }
        return el;
    }

    // ==========================================
    // Token Usage Line Chart
    // ==========================================

    function renderTokenUsageChart(containerId = 'analytics-content') {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Generate sample data if empty
        if (tokenHistory.length === 0) {
            generateSampleTokenData();
        }

        const width = container.clientWidth || 300;
        const height = 150;
        const padding = { top: 10, right: 10, bottom: 30, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Group by date
        const dailyData = {};
        const cutoff = Date.now() - (ANALYTICS_HISTORY_DAYS * 24 * 60 * 60 * 1000);
        
        tokenHistory.filter(d => d.timestamp > cutoff).forEach(d => {
            const date = new Date(d.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            if (!dailyData[date]) dailyData[date] = 0;
            dailyData[date] += d.tokens;
        });

        const dates = Object.keys(dailyData).slice(-14); // Last 14 days
        const values = dates.map(d => dailyData[d]);
        
        if (values.length === 0) {
            container.innerHTML = '<div class="empty-state">No token data available</div>';
            return;
        }

        const maxValue = Math.max(...values, 1000);
        const minValue = 0;
        const range = maxValue - minValue;

        // Create SVG
        const svg = createSVGElement('svg', {
            width: '100%',
            height: height,
            viewBox: `0 0 ${width} ${height}`,
            class: 'token-usage-chart'
        });

        // Grid lines
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            const line = createSVGElement('line', {
                x1: padding.left,
                y1: y,
                x2: width - padding.right,
                y2: y,
                stroke: 'var(--border-subtle)',
                'stroke-width': 1,
                'stroke-dasharray': '2,2'
            });
            svg.appendChild(line);

            // Y-axis labels
            const label = createSVGElement('text', {
                x: padding.left - 5,
                y: y + 4,
                'text-anchor': 'end',
                fill: 'var(--text-muted)',
                'font-size': '9'
            });
            label.textContent = formatCompactNumber(maxValue - (range / 4) * i);
            svg.appendChild(label);
        }

        // Line path
        if (values.length > 1) {
            const points = values.map((val, i) => {
                const x = padding.left + (i / (values.length - 1)) * chartWidth;
                const y = padding.top + chartHeight - ((val - minValue) / range) * chartHeight;
                return `${x},${y}`;
            }).join(' ');

            // Area under line (gradient)
            const areaPoints = `${padding.left},${padding.top + chartHeight} ${points} ${padding.left + chartWidth},${padding.top + chartHeight}`;
            const area = createSVGElement('polygon', {
                points: areaPoints,
                fill: 'url(#tokenGradient)',
                opacity: '0.3'
            });
            svg.appendChild(area);

            // Line
            const line = createSVGElement('polyline', {
                points: points,
                fill: 'none',
                stroke: '#6366f1',
                'stroke-width': 2,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round'
            });
            svg.appendChild(line);

            // Data points
            values.forEach((val, i) => {
                const x = padding.left + (i / (values.length - 1)) * chartWidth;
                const y = padding.top + chartHeight - ((val - minValue) / range) * chartHeight;
                
                const circle = createSVGElement('circle', {
                    cx: x,
                    cy: y,
                    r: 3,
                    fill: '#6366f1',
                    stroke: 'var(--surface-base)',
                    'stroke-width': 2
                });
                svg.appendChild(circle);
            });
        }

        // X-axis labels
        dates.forEach((date, i) => {
            if (i % 3 !== 0) return; // Show every 3rd label
            const x = padding.left + (i / (dates.length - 1 || 1)) * chartWidth;
            const label = createSVGElement('text', {
                x: x,
                y: height - 5,
                'text-anchor': 'middle',
                fill: 'var(--text-muted)',
                'font-size': '9'
            });
            label.textContent = date;
            svg.appendChild(label);
        });

        // Define gradient
        const defs = createSVGElement('defs');
        const gradient = createSVGElement('linearGradient', {
            id: 'tokenGradient',
            x1: '0%',
            y1: '0%',
            x2: '0%',
            y2: '100%'
        });
        const stop1 = createSVGElement('stop', {
            offset: '0%',
            'stop-color': '#6366f1',
            'stop-opacity': 0.6
        });
        const stop2 = createSVGElement('stop', {
            offset: '100%',
            'stop-color': '#6366f1',
            'stop-opacity': 0
        });
        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
        svg.insertBefore(defs, svg.firstChild);

        // Update container
        const existingChart = container.querySelector('.token-chart-container');
        if (existingChart) {
            existingChart.innerHTML = '';
            existingChart.appendChild(svg);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'token-chart-container';
            wrapper.innerHTML = '<div class="chart-title">Token Usage (14 days)</div>';
            wrapper.appendChild(svg);
            container.appendChild(wrapper);
        }
    }

    function formatCompactNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    // ==========================================
    // Cost Breakdown Donut Chart
    // ==========================================

    function renderCostDonutChart(containerId = 'analytics-content') {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Aggregate costs by agent
        const agentCosts = {};
        tokenHistory.forEach(d => {
            if (!agentCosts[d.agent]) agentCosts[d.agent] = 0;
            agentCosts[d.agent] += d.cost || 0;
        });

        // If no data, use sample
        if (Object.keys(agentCosts).length === 0) {
            agentCosts['dev'] = 12.50;
            agentCosts['exec'] = 8.30;
            agentCosts['main'] = 25.00;
            agentCosts['vector'] = 5.20;
        }

        const total = Object.values(agentCosts).reduce((a, b) => a + b, 0);
        const width = 120;
        const height = 120;
        const radius = 50;
        const centerX = width / 2;
        const centerY = height / 2;

        const svg = createSVGElement('svg', {
            width: width,
            height: height,
            viewBox: `0 0 ${width} ${height}`,
            class: 'cost-donut-chart'
        });

        let currentAngle = -Math.PI / 2; // Start at top

        Object.entries(agentCosts).forEach(([agent, cost]) => {
            const percentage = cost / total;
            const angle = percentage * 2 * Math.PI;
            const endAngle = currentAngle + angle;

            // Create arc path
            const x1 = centerX + radius * Math.cos(currentAngle);
            const y1 = centerY + radius * Math.sin(currentAngle);
            const x2 = centerX + radius * Math.cos(endAngle);
            const y2 = centerY + radius * Math.sin(endAngle);

            const largeArc = angle > Math.PI ? 1 : 0;
            const pathData = [
                `M ${centerX} ${centerY}`,
                `L ${x1} ${y1}`,
                `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
                'Z'
            ].join(' ');

            const path = createSVGElement('path', {
                d: pathData,
                fill: AGENT_COLORS[agent] || '#888',
                stroke: 'var(--surface-base)',
                'stroke-width': 2
            });
            svg.appendChild(path);

            currentAngle = endAngle;
        });

        // Center hole
        const hole = createSVGElement('circle', {
            cx: centerX,
            cy: centerY,
            r: radius * 0.6,
            fill: 'var(--surface-base)'
        });
        svg.appendChild(hole);

        // Center text
        const totalText = createSVGElement('text', {
            x: centerX,
            y: centerY - 2,
            'text-anchor': 'middle',
            fill: 'var(--text-primary)',
            'font-size': '14',
            'font-weight': 'bold'
        });
        totalText.textContent = '$' + total.toFixed(0);
        svg.appendChild(totalText);

        const labelText = createSVGElement('text', {
            x: centerX,
            y: centerY + 12,
            'text-anchor': 'middle',
            fill: 'var(--text-muted)',
            'font-size': '8'
        });
        labelText.textContent = 'total';
        svg.appendChild(labelText);

        // Create or update chart container
        let chartContainer = container.querySelector('.cost-chart-container');
        if (!chartContainer) {
            chartContainer = document.createElement('div');
            chartContainer.className = 'cost-chart-container';
            chartContainer.style.cssText = 'display: flex; align-items: center; gap: 16px; margin-top: 16px;';
            container.appendChild(chartContainer);
        }

        chartContainer.innerHTML = `
            <div>
                <div class="chart-title" style="margin-bottom: 8px;">Cost by Agent</div>
            </div>
        `;
        chartContainer.appendChild(svg);

        // Legend
        const legend = document.createElement('div');
        legend.className = 'cost-legend';
        legend.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 11px;';
        
        Object.entries(agentCosts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([agent, cost]) => {
                const percentage = ((cost / total) * 100).toFixed(1);
                legend.innerHTML += `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${AGENT_COLORS[agent] || '#888'};"></span>
                        <span style="text-transform: uppercase; min-width: 40px;">${agent}</span>
                        <span style="color: var(--text-muted);">$${cost.toFixed(2)} (${percentage}%)</span>
                    </div>
                `;
            });
        
        chartContainer.appendChild(legend);
    }

    // ==========================================
    // Session Duration Heatmap
    // ==========================================

    function renderSessionHeatmap(containerId = 'analytics-content') {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Generate sample session data if empty
        if (sessionDurations.length === 0) {
            generateSampleSessionData();
        }

        // Create hourly heatmap for last 7 days
        const days = 7;
        const hours = 24;
        const heatmapData = {};

        // Initialize
        for (let d = 0; d < days; d++) {
            heatmapData[d] = {};
            for (let h = 0; h < hours; h++) {
                heatmapData[d][h] = 0;
            }
        }

        // Fill with data
        const now = Date.now();
        sessionDurations.forEach(session => {
            const sessionDate = new Date(session.start);
            const dayDiff = Math.floor((now - session.start) / (24 * 60 * 60 * 1000));
            const hour = sessionDate.getHours();
            
            if (dayDiff < days && dayDiff >= 0) {
                heatmapData[dayDiff][hour] += session.duration / (60 * 1000); // Convert to minutes
            }
        });

        // Find max for normalization
        let maxValue = 0;
        for (let d = 0; d < days; d++) {
            for (let h = 0; h < hours; h++) {
                maxValue = Math.max(maxValue, heatmapData[d][h]);
            }
        }
        maxValue = Math.max(maxValue, 1);

        // Create heatmap HTML
        const cellWidth = 12;
        const cellHeight = 12;
        const gap = 2;

        let html = `
            <div class="session-heatmap" style="margin-top: 16px;">
                <div class="chart-title" style="margin-bottom: 8px;">Session Duration Heatmap (7 days)</div>
                <div style="display: flex; gap: 8px;">
                    <div style="display: flex; flex-direction: column; gap: ${gap}px; padding-top: 16px;">
        `;

        // Hour labels
        for (let h = 0; h < hours; h += 4) {
            html += `<div style="height: ${cellHeight}px; font-size: 9px; color: var(--text-muted); line-height: ${cellHeight}px;">${h}:00</div>`;
        }

        html += `</div><div style="display: flex; gap: ${gap}px;">`;

        // Heatmap cells
        for (let d = days - 1; d >= 0; d--) {
            html += `<div style="display: flex; flex-direction: column; gap: ${gap}px;">`;
            
            // Day label
            const dayLabel = new Date(now - d * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { weekday: 'short' });
            html += `<div style="text-align: center; font-size: 9px; color: var(--text-muted); height: 14px;">${dayLabel}</div>`;

            for (let h = 0; h < hours; h += 4) {
                const value = heatmapData[d][h];
                const intensity = value / maxValue;
                const color = getHeatmapColor(intensity);
                
                html += `
                    <div style="
                        width: ${cellWidth}px; 
                        height: ${cellHeight}px; 
                        background: ${color}; 
                        border-radius: 2px;
                        cursor: pointer;
                    " title="${dayLabel} ${h}:00 - ${Math.round(value)} min"></div>
                `;
            }
            html += '</div>';
        }

        html += `
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 10px; color: var(--text-muted);">
                    <span>Less</span>
                    <div style="display: flex; gap: 2px;">
                        <div style="width: 10px; height: 10px; background: #ebedf0; border-radius: 1px;"></div>
                        <div style="width: 10px; height: 10px; background: #9be9a8; border-radius: 1px;"></div>
                        <div style="width: 10px; height: 10px; background: #40c463; border-radius: 1px;"></div>
                        <div style="width: 10px; height: 10px; background: #30a14e; border-radius: 1px;"></div>
                        <div style="width: 10px; height: 10px; background: #216e39; border-radius: 1px;"></div>
                    </div>
                    <span>More</span>
                </div>
            </div>
        `;

        // Append to container
        const existingHeatmap = container.querySelector('.session-heatmap');
        if (existingHeatmap) {
            existingHeatmap.outerHTML = html;
        } else {
            container.insertAdjacentHTML('beforeend', html);
        }
    }

    function getHeatmapColor(intensity) {
        if (intensity === 0) return 'var(--surface-2)';
        if (intensity < 0.25) return '#9be9a8';
        if (intensity < 0.5) return '#40c463';
        if (intensity < 0.75) return '#30a14e';
        return '#216e39';
    }

    // ==========================================
    // Comparative Agent Performance
    // ==========================================

    function renderAgentPerformance(containerId = 'analytics-content') {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Calculate performance metrics per agent
        const metrics = {};
        const agents = ['main', 'dev', 'exec', 'atlas', 'sterling', 'vector', 'knox', 'nova', 'family', 'tax'];
        
        agents.forEach(agent => {
            const tasks = [
                ...(state.tasks.todo || []),
                ...(state.tasks.progress || []),
                ...(state.tasks.done || [])
            ].filter(t => getTaskAgent(t) === agent);

            const done = (state.tasks.done || []).filter(t => getTaskAgent(t) === agent).length;
            const total = tasks.length;
            
            metrics[agent] = {
                total,
                done,
                completion: total > 0 ? (done / total * 100).toFixed(0) : 0,
                avgPriority: total > 0 
                    ? (tasks.reduce((sum, t) => sum + (t.priority || 1), 0) / total).toFixed(1)
                    : 0
            };
        });

        // Create performance table
        let html = `
            <div class="agent-performance" style="margin-top: 16px;">
                <div class="chart-title" style="margin-bottom: 8px;">Agent Performance</div>
                <div style="display: grid; gap: 8px;">
        `;

        Object.entries(metrics)
            .filter(([_, m]) => m.total > 0)
            .sort((a, b) => b[1].completion - a[1].completion)
            .forEach(([agent, m]) => {
                const color = AGENT_COLORS[agent] || '#888';
                html += `
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">
                        <span style="text-transform: uppercase; font-weight: 600; color: ${color}; min-width: 50px;">${agent}</span>
                        <div style="flex: 1; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden;">
                            <div style="width: ${m.completion}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
                        </div>
                        <span style="min-width: 50px; text-align: right; color: var(--text-muted);">${m.completion}%</span>
                        <span style="min-width: 40px; text-align: right; color: var(--text-muted);">${m.done}/${m.total}</span>
                    </div>
                `;
            });

        html += `</div></div>`;

        // Append to container
        const existingPerf = container.querySelector('.agent-performance');
        if (existingPerf) {
            existingPerf.outerHTML = html;
        } else {
            container.insertAdjacentHTML('beforeend', html);
        }
    }

    // ==========================================
    // Data Generation & Recording
    // ==========================================

    function generateSampleTokenData() {
        const agents = ['main', 'dev', 'exec', 'atlas', 'vector'];
        const now = Date.now();
        
        for (let i = 0; i < 30; i++) {
            const date = now - (29 - i) * 24 * 60 * 60 * 1000;
            agents.forEach(agent => {
                tokenHistory.push({
                    timestamp: date,
                    agent,
                    tokens: Math.floor(Math.random() * 5000) + 1000,
                    cost: (Math.random() * 2 + 0.5)
                });
            });
        }
    }

    function generateSampleSessionData() {
        const agents = ['main', 'dev', 'exec', 'atlas'];
        const now = Date.now();
        
        for (let i = 0; i < 50; i++) {
            const start = now - Math.random() * 7 * 24 * 60 * 60 * 1000;
            const duration = Math.random() * 2 * 60 * 60 * 1000; // 0-2 hours
            
            sessionDurations.push({
                agent: agents[Math.floor(Math.random() * agents.length)],
                start,
                end: start + duration,
                duration
            });
        }
    }

    function recordTokenUsage(agent, tokens, cost) {
        tokenHistory.push({
            timestamp: Date.now(),
            agent,
            tokens,
            cost
        });
        
        // Keep only last 30 days
        const cutoff = Date.now() - (ANALYTICS_HISTORY_DAYS * 24 * 60 * 60 * 1000);
        tokenHistory = tokenHistory.filter(t => t.timestamp > cutoff);
    }

    function recordSessionDuration(agent, start, end) {
        sessionDurations.push({
            agent,
            start,
            end,
            duration: end - start
        });
    }

    // ==========================================
    // Main Render Function
    // ==========================================

    function renderAnalyticsWidget() {
        const container = document.getElementById('analytics-content');
        if (!container) return;

        container.innerHTML = ''; // Clear existing

        renderTokenUsageChart();
        renderCostDonutChart();
        renderSessionHeatmap();
        renderAgentPerformance();
    }

    // ==========================================
    // Global Exports
    // ==========================================

    window.renderAnalyticsWidget = renderAnalyticsWidget;
    window.recordTokenUsage = recordTokenUsage;
    window.recordSessionDuration = recordSessionDuration;
    window.renderTokenUsageChart = renderTokenUsageChart;
    window.renderCostDonutChart = renderCostDonutChart;
    window.renderSessionHeatmap = renderSessionHeatmap;
    window.renderAgentPerformance = renderAgentPerformance;

    // ==========================================
    // Initialization
    // ==========================================

    function init() {
        // Override the original analytics render if it exists
        const originalInitAnalytics = window.initAnalyticsWidget;
        window.initAnalyticsWidget = function() {
            renderAnalyticsWidget();
        };

        // Auto-render if on dashboard
        if (document.getElementById('analytics-content')) {
            renderAnalyticsWidget();
        }

        console.log('[Phase12] Analytics Widget initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
