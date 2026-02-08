// js/quick-stats.js — Quick stats and streak tracking

// ===================
// QUICK STATS
// ===================

let statsState = {
    tasksDoneThisWeek: 0,
    messagesToday: 0,
    streak: parseInt(localStorage.getItem('dashboardStreak') || '0'),
    sessionStartTime: Date.now()
};

function updateQuickStats() {
    // Tasks done this week
    const tasksDone = state.tasks?.done?.length || 0;
    const tasksDoneEl = document.getElementById('stat-tasks-done');
    if (tasksDoneEl) tasksDoneEl.textContent = tasksDone;
    
    // Focus sessions
    const focusEl = document.getElementById('stat-focus-sessions');
    if (focusEl) focusEl.textContent = focusTimer.sessions;
    
    // Messages today (count from chat)
    const today = new Date().toDateString();
    const messagesToday = (state.chat?.messages || []).filter(m => {
        const msgDate = new Date(m.time).toDateString();
        return msgDate === today;
    }).length;
    const messagesEl = document.getElementById('stat-messages');
    if (messagesEl) messagesEl.textContent = messagesToday;
    
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

// Update stats every minute
setInterval(updateQuickStats, 60000);


