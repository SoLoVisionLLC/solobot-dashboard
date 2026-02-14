// js/quick-stats.js — Quick stats with sparklines and circular progress rings

// ===================
// QUICK STATS
// ===================

let statsState = {
    tasksDoneThisWeek: 0,
    messagesToday: 0,
    streak: parseInt(localStorage.getItem('dashboardStreak') || '0'),
    sessionStartTime: Date.now(),
    // History for sparklines (keep last 7 data points)
    history: {
        tasks: JSON.parse(localStorage.getItem('stats_history_tasks') || '[]'),
        messages: JSON.parse(localStorage.getItem('stats_history_messages') || '[]'),
        focus: JSON.parse(localStorage.getItem('stats_history_focus') || '[]'),
        activity: JSON.parse(localStorage.getItem('stats_history_activity') || '[]')
    }
};

// ===================
// SPARKLINE GENERATOR
// ===================

function generateSparkline(data, width = 60, height = 24, type = 'neutral') {
    if (!data || data.length < 2) {
        return `<svg width="${width}" height="${height}" class="sparkline"><line x1="0" y1="${height/2}" x2="${width}" y2="${height/2}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,2"/></svg>`;
    }
    
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    
    const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');
    
    // Create area path (closed)
    const areaPoints = `0,${height} ${points} ${width},${height}`;
    
    const colorClass = type === 'positive' ? 'sparkline-positive' : 
                       type === 'negative' ? 'sparkline-negative' : 'sparkline-neutral';
    
    return `
        <svg width="${width}" height="${height}" class="sparkline ${colorClass}" viewBox="0 0 ${width} ${height}">
            <polygon points="${areaPoints}" class="sparkline-area" />
            <polyline points="${points}" class="sparkline-path" />
        </svg>
    `;
}

function updateSparklineData(key, value) {
    const arr = statsState.history[key];
    arr.push(value);
    if (arr.length > 7) arr.shift();
    localStorage.setItem(`stats_history_${key}`, JSON.stringify(arr));
}

// ===================
// CIRCULAR PROGRESS RING
// ===================

function generateProgressRing(value, max, size = 50, strokeWidth = 4, color = null) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(Math.max(value / max, 0), 1);
    const offset = circumference - progress * circumference;
    
    const strokeColor = color || 'var(--brand-red)';
    
    return `
        <div class="progress-ring" style="width: ${size}px; height: ${size}px;">
            <svg width="${size}" height="${size}">
                <circle
                    class="progress-ring-bg"
                    cx="${size/2}" cy="${size/2}" r="${radius}"
                    fill="none"
                    stroke-width="${strokeWidth}"
                />
                <circle
                    class="progress-ring-circle"
                    cx="${size/2}" cy="${size/2}" r="${radius}"
                    fill="none"
                    stroke="${strokeColor}"
                    stroke-width="${strokeWidth}"
                    stroke-linecap="round"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}"
                />
            </svg>
            <span class="progress-ring-value">${Math.round(progress * 100)}%</span>
        </div>
    `;
}

// ===================
// MINI HEATMAP
// ===================

function generateMiniHeatmap(data, rows = 4, cols = 7) {
    // data should be array of values 0-5
    const cells = [];
    for (let i = 0; i < rows * cols; i++) {
        const level = data[i] || 0;
        const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i % 7];
        cells.push(`<div class="heatmap-cell level-${level}" title="${dayLabel}: Level ${level}"></div>`);
    }
    
    return `<div class="mini-heatmap" style="grid-template-columns: repeat(${cols}, 1fr);">${cells.join('')}</div>`;
}

function generateActivityHeatmap(hourlyData) {
    // hourlyData: array of 24 values (0-5) representing activity per hour
    const cells = hourlyData.map((level, hour) => {
        const timeLabel = `${hour}:00`;
        return `<div class="activity-heatmap-cell ${level > 0 ? 'active' : ''}" style="opacity: ${0.2 + (level / 5) * 0.8}" title="${timeLabel}: Level ${level}"></div>`;
    }).join('');
    
    return `<div class="activity-heatmap">${cells}</div>`;
}

// Generate sample activity data for the last 28 days
function generateActivityData() {
    const data = [];
    for (let i = 0; i < 28; i++) {
        // Random activity level 0-5, with higher probability of lower values
        const rand = Math.random();
        let level = 0;
        if (rand > 0.6) level = 1;
        if (rand > 0.75) level = 2;
        if (rand > 0.85) level = 3;
        if (rand > 0.93) level = 4;
        if (rand > 0.98) level = 5;
        data.push(level);
    }
    return data;
}

// Generate hourly activity data (24 hours)
function generateHourlyActivityData() {
    const data = [];
    for (let i = 0; i < 24; i++) {
        // More activity during working hours (9-17)
        let base = 0;
        if (i >= 9 && i <= 17) base = 2;
        if (i >= 13 && i <= 15) base = 3;
        
        const rand = Math.random();
        let level = base;
        if (rand > 0.7) level = Math.min(base + 1, 5);
        if (rand > 0.9) level = Math.min(base + 2, 5);
        if (rand < 0.3 && base > 0) level = Math.max(base - 1, 0);
        
        data.push(level);
    }
    return data;
}

// ===================
// ENHANCED STATS UPDATE
// ===================

function updateQuickStats() {
    // Tasks done this week
    const tasksDone = state.tasks?.done?.length || 0;
    const tasksDoneEl = document.getElementById('stat-tasks-done');
    if (tasksDoneEl) {
        tasksDoneEl.textContent = tasksDone;
        // Update history
        updateSparklineData('tasks', tasksDone);
    }
    
    // Focus sessions
    const focusEl = document.getElementById('stat-focus-sessions');
    if (focusEl) {
        focusEl.textContent = focusTimer.sessions;
        updateSparklineData('focus', focusTimer.sessions);
    }
    
    // Messages today (count from chat)
    const today = new Date().toDateString();
    const messagesToday = (state.chat?.messages || []).filter(m => {
        const msgDate = new Date(m.time).toDateString();
        return msgDate === today;
    }).length;
    const messagesEl = document.getElementById('stat-messages');
    if (messagesEl) {
        messagesEl.textContent = messagesToday;
        updateSparklineData('messages', messagesToday);
    }
    
    // Streak
    updateStreak();
    const streakEl = document.getElementById('stat-streak');
    if (streakEl) streakEl.textContent = statsState.streak;
    
    // Session time
    const uptimeEl = document.getElementById('stat-uptime');
    if (uptimeEl) {
        const elapsed = Math.floor((Date.now() - statsState.sessionStartTime) / 60000);
        if (elapsed < 60) {
            uptimeEl.textContent = `${elapsed}m`;
        } else {
            const hours = Math.floor(elapsed / 60);
            const mins = elapsed % 60;
            uptimeEl.textContent = `${hours}h ${mins}m`;
        }
    }
    
    // Update timestamp
    const lastUpdatedEl = document.getElementById('stats-last-updated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = 'Updated just now';
    }
    
    // Render sparklines if containers exist
    renderSparklines();
    
    // Render heatmaps if containers exist
    renderHeatmaps();
    
    // Render progress rings if containers exist
    renderProgressRings();
}

function renderSparklines() {
    // Tasks sparkline with trend
    const tasksSparklineEl = document.getElementById('sparkline-tasks');
    if (tasksSparklineEl) {
        const trend = statsState.history.tasks.length > 1 ? 
            statsState.history.tasks[statsState.history.tasks.length - 1] - statsState.history.tasks[statsState.history.tasks.length - 2] : 0;
        const type = trend > 0 ? 'positive' : trend < 0 ? 'negative' : 'neutral';
        tasksSparklineEl.innerHTML = generateSparkline(statsState.history.tasks, 60, 24, type);
        
        const trendEl = document.getElementById('trend-tasks');
        if (trendEl) {
            trendEl.textContent = trend >= 0 ? `+${trend}` : trend;
            trendEl.className = `stat-change ${trend > 0 ? 'positive' : trend < 0 ? 'negative' : ''}`;
        }
    }
    
    // Messages sparkline
    const messagesSparklineEl = document.getElementById('sparkline-messages');
    if (messagesSparklineEl) {
        messagesSparklineEl.innerHTML = generateSparkline(statsState.history.messages, 60, 24, 'neutral');
    }
    
    // Focus sparkline
    const focusSparklineEl = document.getElementById('sparkline-focus');
    if (focusSparklineEl) {
        focusSparklineEl.innerHTML = generateSparkline(statsState.history.focus, 60, 24, 'positive');
    }
}

function renderHeatmaps() {
    // Activity heatmap
    const activityHeatmapEl = document.getElementById('activity-heatmap-container');
    if (activityHeatmapEl && !activityHeatmapEl.dataset.initialized) {
        const activityData = generateActivityData();
        activityHeatmapEl.innerHTML = generateMiniHeatmap(activityData, 4, 7);
        activityHeatmapEl.dataset.initialized = 'true';
    }
    
    // Hourly activity heatmap
    const hourlyHeatmapEl = document.getElementById('hourly-heatmap-container');
    if (hourlyHeatmapEl && !hourlyHeatmapEl.dataset.initialized) {
        const hourlyData = generateHourlyActivityData();
        hourlyHeatmapEl.innerHTML = generateActivityHeatmap(hourlyData);
        hourlyHeatmapEl.dataset.initialized = 'true';
    }
}

function renderProgressRings() {
    // Task completion progress
    const taskProgressEl = document.getElementById('progress-ring-tasks');
    if (taskProgressEl) {
        const total = (state.tasks?.todo?.length || 0) + (state.tasks?.progress?.length || 0) + (state.tasks?.done?.length || 0);
        const done = state.tasks?.done?.length || 0;
        taskProgressEl.innerHTML = generateProgressRing(done, total || 1, 36, 3, 'var(--success)');
    }
    
    // Daily goal progress (example: 10 tasks/day goal)
    const dailyGoalEl = document.getElementById('progress-ring-daily');
    if (dailyGoalEl) {
        const today = new Date().toDateString();
        const doneToday = (state.tasks?.done || []).filter(t => {
            const completedDate = t.completedAt ? new Date(t.completedAt).toDateString() : null;
            return completedDate === today;
        }).length;
        dailyGoalEl.innerHTML = generateProgressRing(doneToday, 10, 36, 3, 'var(--brand-red)');
    }
}

function updateStreak() {
    const lastActiveDate = localStorage.getItem('lastActiveDate');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    if (lastActiveDate === today) {
        // Already active today, streak maintained
        return;
    } else if (lastActiveDate === yesterday) {
        // Was active yesterday, increment streak
        statsState.streak++;
    } else if (lastActiveDate !== today) {
        // Streak broken or first day
        statsState.streak = 1;
    }
    
    localStorage.setItem('dashboardStreak', statsState.streak.toString());
    localStorage.setItem('lastActiveDate', today);
}

// Initialize sparkline data if empty
function initSparklineData() {
    const keys = ['tasks', 'messages', 'focus', 'activity'];
    keys.forEach(key => {
        const stored = localStorage.getItem(`stats_history_${key}`);
        if (!stored || stored === '[]') {
            // Generate some sample historical data
            const sampleData = [];
            for (let i = 0; i < 7; i++) {
                sampleData.push(Math.floor(Math.random() * 10) + 5);
            }
            localStorage.setItem(`stats_history_${key}`, JSON.stringify(sampleData));
            statsState.history[key] = sampleData;
        }
    });
}

// Initialize on load
initSparklineData();

// Update stats every minute
setInterval(updateQuickStats, 60000);

// Export for use in other modules
window.QuickStats = {
    update: updateQuickStats,
    generateSparkline,
    generateProgressRing,
    generateMiniHeatmap,
    generateActivityHeatmap
};
