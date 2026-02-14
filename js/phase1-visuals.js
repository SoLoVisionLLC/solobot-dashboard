// ========================================
// PHASE 1: VISUAL DESIGN FOUNDATION
// Glassmorphism, Sparklines, Progress Rings, Heatmaps
// ========================================

/**
 * Sparkline Chart Generator
 * Creates mini trend graphs for Quick Stats widget
 */
const Sparklines = {
    /**
     * Generate SVG sparkline path from data array
     * @param {number[]} data - Array of values
     * @param {number} width - SVG width
     * @param {number} height - SVG height
     * @returns {string} SVG path string
     */
    generatePath(data, width = 60, height = 24) {
        if (!data || data.length < 2) return '';
        
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        
        const points = data.map((value, index) => {
            const x = (index / (data.length - 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        });
        
        return `M ${points.join(' L ')}`;
    },

    /**
     * Generate area path for sparkline (closed at bottom)
     */
    generateAreaPath(data, width = 60, height = 24) {
        if (!data || data.length < 2) return '';
        
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        
        const points = data.map((value, index) => {
            const x = (index / (data.length - 1)) * width;
            const y = height - ((value - min) / range) * height;
            return `${x},${y}`;
        });
        
        return `M ${points.join(' L ')} L ${width},${height} L 0,${height} Z`;
    },

    /**
     * Render sparkline SVG element
     * @param {string} containerId - Target container ID
     * @param {number[]} data - Data points
     * @param {string} type - 'positive' | 'negative' | 'neutral'
     */
    render(containerId, data, type = 'neutral') {
        const container = document.getElementById(containerId);
        if (!container || !data || data.length < 2) return;
        
        const width = 60;
        const height = 24;
        const strokeColor = type === 'positive' ? 'var(--success)' : 
                           type === 'negative' ? 'var(--error)' : 'var(--brand-red)';
        const fillColor = type === 'positive' ? 'var(--success)' : 
                         type === 'negative' ? 'var(--error)' : 'var(--brand-red)';
        
        const path = this.generatePath(data, width, height);
        const areaPath = this.generateAreaPath(data, width, height);
        
        container.innerHTML = `
            <svg class="sparkline sparkline-${type}" viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
                <path class="sparkline-area" d="${areaPath}" fill="${fillColor}" opacity="0.15"></path>
                <path class="sparkline-path" d="${path}" stroke="${strokeColor}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
        `;
    },

    /**
     * Generate sample data for demo/testing
     */
    generateSampleData(points = 10, trend = 'random') {
        const data = [];
        let value = 50;
        
        for (let i = 0; i < points; i++) {
            if (trend === 'up') {
                value += Math.random() * 10 - 2;
            } else if (trend === 'down') {
                value -= Math.random() * 10 - 2;
            } else {
                value += Math.random() * 20 - 10;
            }
            value = Math.max(0, Math.min(100, value));
            data.push(value);
        }
        
        return data;
    }
};

/**
 * Circular Progress Ring
 * Replaces traditional progress bars with SVG rings
 */
const ProgressRings = {
    /**
     * Render circular progress ring
     * @param {string} containerId - Target container ID
     * @param {number} percent - 0-100
     * @param {string} label - Center label text
     * @param {number} size - Ring size in pixels
     * @param {number} strokeWidth - Stroke width
     */
    render(containerId, percent, label = '', size = 48, strokeWidth = 4) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percent / 100) * circumference;
        
        // Color based on percentage
        let color = 'var(--brand-red)';
        if (percent >= 80) color = 'var(--success)';
        else if (percent >= 50) color = 'var(--warning)';
        
        container.innerHTML = `
            <div class="progress-ring" style="width: ${size}px; height: ${size}px;">
                <svg width="${size}" height="${size}">
                    <circle class="progress-ring-bg" 
                            cx="${size/2}" cy="${size/2}" r="${radius}" 
                            fill="none" stroke-width="${strokeWidth}"></circle>
                    <circle class="progress-ring-circle" 
                            cx="${size/2}" cy="${size/2}" r="${radius}" 
                            fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                            stroke-dasharray="${circumference}" 
                            stroke-dashoffset="${offset}"></circle>
                </svg>
                ${label ? `<span class="progress-ring-value">${label}</span>` : ''}
            </div>
        `;
    },

    /**
     * Render multiple rings for stats display
     */
    renderStats(containerId, stats) {
        const container = document.getElementById(containerId);
        if (!container || !stats) return;
        
        const html = stats.map(stat => {
            const size = 40;
            const strokeWidth = 3;
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (stat.percent / 100) * circumference;
            
            let color = 'var(--brand-red)';
            if (stat.percent >= 80) color = 'var(--success)';
            else if (stat.percent >= 50) color = 'var(--warning)';
            
            return `
                <div class="stat-ring-item" style="text-align: center;">
                    <div class="progress-ring" style="width: ${size}px; height: ${size}px; margin: 0 auto;">
                        <svg width="${size}" height="${size}">
                            <circle class="progress-ring-bg" 
                                    cx="${size/2}" cy="${size/2}" r="${radius}" 
                                    fill="none" stroke-width="${strokeWidth}"></circle>
                            <circle class="progress-ring-circle" 
                                    cx="${size/2}" cy="${size/2}" r="${radius}" 
                                    fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                                    stroke-dasharray="${circumference}" 
                                    stroke-dashoffset="${offset}"></circle>
                        </svg>
                        <span class="progress-ring-value" style="font-size: 11px;">${stat.value}</span>
                    </div>
                    <div class="progress-ring-label">${stat.label}</div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = `<div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">${html}</div>`;
    }
};

/**
 * Mini Heatmap Generator
 * For activity patterns visualization
 */
const MiniHeatmap = {
    /**
     * Generate activity heatmap
     * @param {string} containerId - Target container ID
     * @param {number[]} data - Array of intensity values (0-5)
     * @param {string} type - 'week' | 'day' | 'hour'
     */
    render(containerId, data, type = 'week') {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        let cols = 7;
        let rows = 1;
        
        if (type === 'day') {
            cols = 24;
            rows = 1;
        } else if (type === 'hour') {
            cols = 12;
            rows = 1;
        }
        
        const cells = data.map((level, index) => {
            const levelClass = `level-${Math.min(5, Math.max(0, level))}`;
            return `<div class="heatmap-cell ${levelClass}" title="Activity level: ${level}"></div>`;
        }).join('');
        
        container.innerHTML = `
            <div class="mini-heatmap" style="grid-template-columns: repeat(${cols}, 1fr);">
                ${cells}
            </div>
        `;
    },

    /**
     * Generate sample activity data
     */
    generateSampleData(count = 28) {
        return Array.from({ length: count }, () => Math.floor(Math.random() * 6));
    },

    /**
     * Render week-based activity heatmap with day labels
     */
    renderWeekHeatmap(containerId, weekData) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const cells = weekData.map((level, index) => {
            const dayName = days[index % 7];
            const levelClass = `level-${Math.min(5, Math.max(0, level))}`;
            return `
                <div style="text-align: center;">
                    <div class="heatmap-cell ${levelClass}" title="${dayName}: Activity level ${level}"></div>
                    <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">${dayName}</div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = `<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">${cells}</div>`;
    }
};

/**
 * Enhanced Quick Stats Widget
 * Combines sparklines, progress rings, and heatmaps
 */
const QuickStatsEnhanced = {
    /**
     * Initialize enhanced stats display
     */
    init() {
        this.renderSparklines();
        this.renderProgressRings();
        this.renderActivityHeatmap();
    },

    /**
     * Render sparklines for stats
     */
    renderSparklines() {
        // Sample data - in production, this would come from actual activity history
        const taskTrend = Sparklines.generateSampleData(10, 'up');
        const messageTrend = Sparklines.generateSampleData(10, 'random');
        
        // Find or create sparkline containers
        const statItems = document.querySelectorAll('.stat-item');
        statItems.forEach((item, index) => {
            // Add sparkline after the value
            const valueEl = item.querySelector('.stat-value');
            if (valueEl && !item.querySelector('.sparkline')) {
                const sparklineId = `sparkline-stat-${index}`;
                const sparklineContainer = document.createElement('div');
                sparklineContainer.id = sparklineContainer;
                sparklineContainer.className = 'sparkline';
                sparklineContainer.style.cssText = 'width: 40px; height: 16px; margin-top: 4px;';
                
                // Insert after label
                const labelEl = item.querySelector('.stat-label');
                if (labelEl) {
                    labelEl.after(sparklineContainer);
                }
                
                // Render sparkline
                const type = index % 2 === 0 ? 'positive' : 'neutral';
                const data = index % 2 === 0 ? taskTrend : messageTrend;
                Sparklines.render(sparklineContainer, data, type);
            }
        });
    },

    /**
     * Render circular progress rings for completion stats
     */
    renderProgressRings() {
        // Look for task completion containers
        const taskBoard = document.querySelector('.bento-task-board');
        if (taskBoard && !taskBoard.querySelector('.progress-ring')) {
            const header = taskBoard.querySelector('.bento-widget-header');
            if (header) {
                const ringContainer = document.createElement('div');
                ringContainer.id = 'task-completion-ring';
                ringContainer.style.cssText = 'margin-left: auto;';
                
                const actions = header.querySelector('.bento-widget-actions');
                if (actions) {
                    actions.before(ringContainer);
                    
                    // Calculate completion percentage
                    const todo = state.tasks?.todo?.length || 0;
                    const progress = state.tasks?.progress?.length || 0;
                    const done = state.tasks?.done?.length || 0;
                    const total = todo + progress + done;
                    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                    
                    ProgressRings.render('task-completion-ring', percent, `${percent}%`, 36, 3);
                }
            }
        }
    },

    /**
     * Render activity heatmap
     */
    renderActivityHeatmap() {
        const activityWidget = document.querySelector('.bento-activity');
        if (activityWidget && !activityWidget.querySelector('.mini-heatmap')) {
            const content = activityWidget.querySelector('.bento-widget-content');
            if (content) {
                const heatmapContainer = document.createElement('div');
                heatmapContainer.id = 'activity-heatmap-mini';
                heatmapContainer.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);';
                heatmapContainer.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px;">Activity Pattern (Last 7 Days)</div>';
                
                const heatmapGrid = document.createElement('div');
                heatmapGrid.id = 'activity-heatmap-grid';
                heatmapContainer.appendChild(heatmapGrid);
                
                content.appendChild(heatmapContainer);
                
                // Generate and render sample activity data
                const activityData = MiniHeatmap.generateSampleData(7);
                MiniHeatmap.renderWeekHeatmap('activity-heatmap-grid', activityData);
            }
        }
    },

    /**
     * Update all enhanced stats
     */
    update() {
        this.renderProgressRings();
    }
};

/**
 * Widget Animation Controller
 * Handles fade-in and stagger animations
 */
const WidgetAnimations = {
    /**
     * Apply fade-in animation to widgets
     */
    fadeInWidgets() {
        const widgets = document.querySelectorAll('.bento-widget');
        widgets.forEach((widget, index) => {
            widget.style.opacity = '0';
            widget.style.transform = 'translateY(10px)';
            widget.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            
            setTimeout(() => {
                widget.style.opacity = '1';
                widget.style.transform = 'translateY(0)';
            }, index * 50);
        });
    },

    /**
     * Apply hover lift effect
     */
    setupHoverEffects() {
        document.querySelectorAll('.bento-widget').forEach(widget => {
            widget.addEventListener('mouseenter', () => {
                widget.style.transform = 'translateY(-3px)';
            });
            widget.addEventListener('mouseleave', () => {
                widget.style.transform = 'translateY(0)';
            });
        });
    }
};

// Initialize Phase 1 features when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for dashboard to be rendered
    setTimeout(() => {
        QuickStatsEnhanced.init();
        WidgetAnimations.fadeInWidgets();
        WidgetAnimations.setupHoverEffects();
    }, 500);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Sparklines, ProgressRings, MiniHeatmap, QuickStatsEnhanced, WidgetAnimations };
}
