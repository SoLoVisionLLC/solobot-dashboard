// js/focus-timer.js — Focus timer functionality

// ===================
// FOCUS TIMER
// ===================

let focusTimer = {
    running: false,
    isBreak: false,
    timeLeft: 25 * 60, // 25 minutes in seconds
    interval: null,
    sessions: parseInt(localStorage.getItem('focusSessions') || '0'),
    workDuration: 25 * 60,
    breakDuration: 5 * 60,
    sessionStart: null
};

function toggleFocusTimer() {
    if (focusTimer.running) {
        pauseFocusTimer();
    } else {
        startFocusTimer();
    }
}

function startFocusTimer() {
    focusTimer.running = true;
    focusTimer.sessionStart = Date.now();
    updateFocusTimerUI();
    
    focusTimer.interval = setInterval(() => {
        focusTimer.timeLeft--;
        updateFocusTimerDisplay();
        
        if (focusTimer.timeLeft <= 0) {
            completeFocusSession();
        }
    }, 1000);
    
    showToast(focusTimer.isBreak ? '☕ Break started!' : '🎯 Focus session started!', 'success', 2000);
}

function pauseFocusTimer() {
    focusTimer.running = false;
    clearInterval(focusTimer.interval);
    updateFocusTimerUI();
    showToast('⏸️ Timer paused', 'info', 1500);
}

function resetFocusTimer() {
    focusTimer.running = false;
    focusTimer.isBreak = false;
    clearInterval(focusTimer.interval);
    focusTimer.timeLeft = focusTimer.workDuration;
    updateFocusTimerUI();
    updateFocusTimerDisplay();
    showToast('🔄 Timer reset', 'info', 1500);
}

function completeFocusSession() {
    clearInterval(focusTimer.interval);
    focusTimer.running = false;
    
    if (!focusTimer.isBreak) {
        // Completed a work session
        focusTimer.sessions++;
        localStorage.setItem('focusSessions', focusTimer.sessions.toString());
        localStorage.setItem('focusSessionsDate', new Date().toDateString());
        updateQuickStats();
        
        // Play notification sound (if available)
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2telehn2d7DYv49iHxtfns/hoGwaCEGWz9+1aTIOO4nK2sBxIg0zdsXN0HgsEjFnusbRgjQXKVmrxNKTPSkfSJ28zZpDKhhAd6/J0p9JLRlAd6/J0p9JLRlAd6/K0p9JLRlAd6/K0p9JLRk/dq/K0p9JLRk/dq/K0aBKLRk/dq/K0aBKLRk=');
            audio.volume = 0.3;
            audio.play().catch(() => {});
        } catch (e) {}
        
        showToast(`🎉 Focus session complete! (${focusTimer.sessions} today)`, 'success', 3000);
        
        // Start break
        focusTimer.isBreak = true;
        focusTimer.timeLeft = focusTimer.breakDuration;
    } else {
        // Completed a break
        showToast('☕ Break over! Ready for another focus session?', 'info', 3000);
        focusTimer.isBreak = false;
        focusTimer.timeLeft = focusTimer.workDuration;
    }
    
    updateFocusTimerUI();
    updateFocusTimerDisplay();
}

function updateFocusTimerUI() {
    const timer = document.getElementById('focus-timer');
    const playIcon = document.getElementById('focus-play-icon');
    const pauseIcon = document.getElementById('focus-pause-icon');
    const sessionsEl = document.getElementById('focus-sessions');
    
    if (!timer) return;
    
    timer.classList.remove('active', 'break');
    if (focusTimer.running) {
        timer.classList.add(focusTimer.isBreak ? 'break' : 'active');
    }
    
    if (playIcon && pauseIcon) {
        playIcon.style.display = focusTimer.running ? 'none' : 'block';
        pauseIcon.style.display = focusTimer.running ? 'block' : 'none';
    }
    
    if (sessionsEl) {
        sessionsEl.textContent = `${focusTimer.sessions} 🎯`;
    }
}

function updateFocusTimerDisplay() {
    const display = document.getElementById('focus-timer-display');
    if (!display) return;
    
    const minutes = Math.floor(focusTimer.timeLeft / 60);
    const seconds = focusTimer.timeLeft % 60;
    display.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Check if we need to reset sessions (new day)
function checkFocusSessionsReset() {
    const lastDate = localStorage.getItem('focusSessionsDate');
    const today = new Date().toDateString();
    if (lastDate !== today) {
        focusTimer.sessions = 0;
        localStorage.setItem('focusSessions', '0');
        localStorage.setItem('focusSessionsDate', today);
    }
}


