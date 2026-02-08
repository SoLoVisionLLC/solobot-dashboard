// SoLoVision Command Center Dashboard
// Version: 3.21.0 - FIXED: renderChatPage() not being called (showPage bug)
//
// Message Architecture:
// - Chat messages: Synced via Gateway (single source of truth across all devices)
// - System messages: Local UI noise (heartbeats, errors) - persisted to localStorage only
// - DEBUG: DISABLE_SYSTEM_FILTER = true (all messages go to Chat tab for debugging)

// ===================
// STATE MANAGEMENT
// ===================

let state = {
    status: 'idle',
    model: 'opus 4.5',
    currentTask: null,
    subagent: null,
    tasks: {
        todo: [],
        progress: [],
        done: [],
        archive: []
    },
    notes: [],
    activity: [],
    docs: [],
    pendingNotify: null,
    live: {
        status: 'idle',
        task: null,
        taskStarted: null,
        thoughts: [],
        lastActive: null,
        tasksToday: 0
    },
    console: {
        logs: [],
        expanded: false
    },
    chat: {
        messages: []  // User and SoLoBot messages only
    },
    system: {
        messages: []  // System messages, heartbeats, errors, etc.
    }
};

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

// ===================
// KEYBOARD SHORTCUTS ENHANCEMENT
// ===================

function showShortcutsModal() {
    showModal('shortcuts-modal');
}

// Expose functions globally
window.toggleFocusTimer = toggleFocusTimer;
window.resetFocusTimer = resetFocusTimer;
window.showShortcutsModal = showShortcutsModal;

// Initialize focus timer and stats on load
document.addEventListener('DOMContentLoaded', () => {
    checkFocusSessionsReset();
    updateFocusTimerUI();
    updateFocusTimerDisplay();
    updateQuickStats();
});

// Load persisted system messages from localStorage (chat from localStorage + server fallback)
function loadPersistedMessages() {
    try {
        // System messages are local-only (UI noise)
        const savedSystem = localStorage.getItem('solobot-system-messages');
        if (savedSystem) {
            const parsed = JSON.parse(savedSystem);
            if (Array.isArray(parsed)) {
                const cutoff = Date.now() - (24 * 60 * 60 * 1000);
                state.system.messages = parsed.filter(m => m.time > cutoff);
                // console.log(`[Dashboard] Restored ${state.system.messages.length} system messages from localStorage`);
            }
        }

        // Chat messages - try localStorage first, then fetch from server
        const savedChat = localStorage.getItem('solobot-chat-messages');
        if (savedChat) {
            const parsed = JSON.parse(savedChat);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const cutoff = Date.now() - (24 * 60 * 60 * 1000);
                state.chat.messages = parsed.filter(m => m.time > cutoff);
                // console.log(`[Dashboard] Restored ${state.chat.messages.length} chat messages from localStorage`);
                return; // Have local messages, no need to fetch from server
            }
        }
        
        // No local messages - fetch from server
        loadChatFromServer();
    } catch (e) {
        loadChatFromServer();
    }
}

// Load chat messages from server (fallback when localStorage is empty)
async function loadChatFromServer() {
    try {
        const response = await fetch('/api/state');
        const serverState = await response.json();
        if (serverState.chat?.messages?.length > 0) {
            state.chat.messages = serverState.chat.messages;
            localStorage.setItem('solobot-chat-messages', JSON.stringify(state.chat.messages));
            // console.log(`[Dashboard] Loaded ${state.chat.messages.length} chat messages from server`); // Keep quiet
            // Re-render if on chat page
            if (typeof renderChatMessages === 'function') renderChatMessages();
            if (typeof renderChatPage === 'function') renderChatPage();
        }
    } catch (e) {
        // Silently fail - not critical
    }
}

// Save system messages to localStorage (chat is synced via Gateway)
function persistSystemMessages() {
    try {
        // Only persist system messages - they're local UI noise (limit to 30 to save space)
        const systemToSave = state.system.messages.slice(-30);
        localStorage.setItem('solobot-system-messages', JSON.stringify(systemToSave));
    } catch (e) {
        // Silently fail - not critical
    }
}

// Save chat messages to localStorage AND server
// Ensures persistence across browser sessions and deploys
function persistChatMessages() {
    try {
        // Limit to 50 messages to prevent localStorage quota exceeded
        const chatToSave = state.chat.messages.slice(-50);
        localStorage.setItem('solobot-chat-messages', JSON.stringify(chatToSave));
        
        // Also sync to server for persistence across deploys
        syncChatToServer(chatToSave);
    } catch (e) {
        // Silently fail - not critical
    }
}

// Sync chat messages to server (debounced)
let chatSyncTimeout = null;
function syncChatToServer(messages) {
    if (chatSyncTimeout) clearTimeout(chatSyncTimeout);
    chatSyncTimeout = setTimeout(async () => {
        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });
        } catch (e) {
            // Silently fail - not critical
        }
    }, 2000); // Debounce 2 seconds
}

// Load persisted messages immediately
loadPersistedMessages();

// Gateway connection configuration - load from localStorage first, server state as fallback
const GATEWAY_CONFIG = {
    host: localStorage.getItem('gateway_host') || '',
    port: parseInt(localStorage.getItem('gateway_port')) || 443,
    token: localStorage.getItem('gateway_token') || '',
    sessionKey: localStorage.getItem('gateway_session') || 'main',
    maxMessages: 100
};

// Function to save gateway settings to both localStorage AND server state
function saveGatewaySettings(host, port, token, sessionKey) {
    // Save to localStorage
    localStorage.setItem('gateway_host', host);
    localStorage.setItem('gateway_port', port.toString());
    localStorage.setItem('gateway_token', token);
    localStorage.setItem('gateway_session', sessionKey);
    
    // Also save to server state for persistence across deploys
    state.gatewayConfig = { host, port, token, sessionKey };
    saveState('Gateway settings updated');
}

// Function to load gateway settings from server state (called after loadState)
function loadGatewaySettingsFromServer() {
    // console.log('[Dashboard] loadGatewaySettingsFromServer called'); // Keep quiet
    
    if (state.gatewayConfig && state.gatewayConfig.host) {
        // Always prefer server settings if they exist (server is source of truth)
        GATEWAY_CONFIG.host = state.gatewayConfig.host;
        GATEWAY_CONFIG.port = state.gatewayConfig.port || 443;
        GATEWAY_CONFIG.token = state.gatewayConfig.token || '';
        GATEWAY_CONFIG.sessionKey = state.gatewayConfig.sessionKey || 'main';
        
        // Also save to localStorage for faster loading next time
        localStorage.setItem('gateway_host', GATEWAY_CONFIG.host);
        localStorage.setItem('gateway_port', GATEWAY_CONFIG.port.toString());
        localStorage.setItem('gateway_token', GATEWAY_CONFIG.token);
        localStorage.setItem('gateway_session', GATEWAY_CONFIG.sessionKey);
        
        // console.log('[Dashboard] ✓ Loaded gateway settings from server:', GATEWAY_CONFIG.host); // Keep quiet
    }
    // No gateway config in server state - that's fine
}

// Gateway client instance
let gateway = null;
let streamingText = '';
let isProcessing = false;
let lastProcessingEndTime = 0; // Track when processing ended to avoid poll conflicts
let historyPollInterval = null;
let sessionVersion = 0; // Incremented on session switch to ignore stale history data

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set();
let editingTaskId = null;
let currentModalTask = null;
let currentModalColumn = null;
let refreshIntervalId = null;
let taskModalOpen = false; // Flag to pause auto-refresh while editing tasks

// DEBUG: Set to true to disable all filtering and show EVERYTHING in chat
const DISABLE_SYSTEM_FILTER = false;

// ===================
// CUSTOM CONFIRM & TOAST (no browser alerts!)
// ===================

let confirmResolver = null;

// Custom confirm dialog - returns Promise<boolean>
function showConfirm(message, title = 'Confirm', okText = 'OK') {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').innerHTML = message;
        document.getElementById('confirm-modal-ok').textContent = okText;
        showModal('confirm-modal');
    });
}

function closeConfirmModal(result) {
    hideModal('confirm-modal');
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

// Toast notification - replaces alert()
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
        max-width: 350px;
        word-wrap: break-word;
    `;
    
    // Set color based on type
    switch(type) {
        case 'success': toast.style.background = 'var(--success)'; break;
        case 'error': toast.style.background = 'var(--error)'; break;
        case 'warning': toast.style.background = '#f59e0b'; break;
        default: toast.style.background = 'var(--accent)'; break;
    }
    
    toast.textContent = message;
    container.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Make functions globally available
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;
window.showToast = showToast;

// === OVERRIDE NATIVE alert/confirm ===
// Intercept ALL browser dialogs and use our custom UI instead
window.alert = function(message) {
    showToast(message, 'info', 5000);
};

// Store original confirm for emergency use
const _originalConfirm = window.confirm;

window.confirm = function(message) {
    // Show our custom confirm modal
    // Since confirm() is synchronous, we show the modal but return false
    // to block the action. Code should be refactored to use showConfirm().
    console.warn('[Dashboard] Native confirm() intercepted. Use showConfirm() for proper async handling.');
    
    // Show toast explaining what happened
    showToast('Action blocked - please try again', 'warning');
    
    // Show the confirm modal (user can see the message)
    showConfirm(message, 'Confirm');
    
    // Return false to block the synchronous action
    return false;
};

// Classify messages as system/heartbeat noise vs real chat
function isSystemMessage(text, from) {
    // DEBUG MODE: Show everything in chat
    if (DISABLE_SYSTEM_FILTER) {
        return false; // Everything goes to chat
    }

    if (!text) return false;

    const trimmed = text.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    // Only mark as system if from='system' explicitly
    if (from === 'system') return true;

    // === TOOL OUTPUT FILTERING ===
    // Filter out obvious tool results that shouldn't appear in chat
    
    // JSON outputs (API responses, fetch results)
    if (trimmed.startsWith('{') && trimmed.includes('"')) return true;
    
    // Command outputs
    if (trimmed.startsWith('Successfully replaced text in')) return true;
    if (trimmed.startsWith('Successfully wrote')) return true;
    if (trimmed === '(no output)') return true;
    if (trimmed.startsWith('[main ') && trimmed.includes('file changed')) return true;
    if (trimmed.startsWith('To https://github.com')) return true;
    
    // Git/file operation outputs  
    if (/^\[main [a-f0-9]+\]/.test(trimmed)) return true;
    if (trimmed.startsWith('Exported ') && trimmed.includes(' activities')) return true;
    if (trimmed.startsWith('Posted ') && trimmed.includes(' activities')) return true;
    
    // Token/key outputs (security - never show these)
    if (/^ghp_[A-Za-z0-9]+$/.test(trimmed)) return true;
    if (/^sk_[A-Za-z0-9]+$/.test(trimmed)) return true;
    
    // File content dumps (markdown files being read)
    if (trimmed.startsWith('# ') && trimmed.length > 500) return true;
    
    // Grep/search output (line numbers with code)
    if (/^\d+:\s*(if|const|let|var|function|class|return|import|export)\s/.test(trimmed)) return true;
    if (/^\d+[-:].*\.(js|ts|py|md|json|html|css)/.test(trimmed)) return true;
    
    // Multiple line number prefixes (grep output)
    const lineNumberPattern = /^\d+:/;
    const lines = trimmed.split('\n');
    if (lines.length > 2 && lines.filter(l => lineNumberPattern.test(l.trim())).length > lines.length / 2) return true;
    
    // Code blocks with state/config references
    if (trimmed.includes('state.chat.messages') || trimmed.includes('GATEWAY_CONFIG')) return true;
    if (trimmed.includes('maxMessages:') && /\d+:/.test(trimmed)) return true;
    
    // === HEARTBEAT FILTERING ===
    
    // Exact heartbeat matches
    if (trimmed === 'HEARTBEAT_OK') return true;
    
    // === INTERNAL CONTROL MESSAGES ===
    // OpenClaw internal signals that should never appear in chat
    if (trimmed === 'NO_REPLY') return true;
    if (trimmed === 'REPLY_SKIP') return true;
    if (trimmed === 'ANNOUNCE_SKIP') return true;
    if (trimmed.startsWith('Agent-to-agent announce')) return true;
    
    // System timestamped messages
    if (trimmed.startsWith('System: [')) return true;
    if (trimmed.startsWith('System:')) return true;
    if (/^System:\s*\[/i.test(trimmed)) return true;
    
    // HEARTBEAT messages (cron/scheduled)
    if (trimmed.includes('] HEARTBEAT:')) return true;
    if (trimmed.includes('] Cron:')) return true;
    if (trimmed.includes('] EMAIL CHECK:')) return true;

    // Heartbeat prompts
    if (trimmed.startsWith('Read HEARTBEAT.md if it exists')) return true;

    // Short heartbeat patterns
    if (from === 'solobot' && trimmed.length < 200) {
        const exactStartPatterns = [
            'following heartbeat routine',
            'following the heartbeat routine',
            'checking current status via heartbeat',
        ];

        for (const pattern of exactStartPatterns) {
            if (lowerTrimmed.startsWith(pattern)) {
                return true;
            }
        }
    }

    // Don't filter anything else
    return false;
}

// Provider and Model selection functions (currently just for display)
window.changeProvider = function() {
    console.warn('[Dashboard] Provider selection not implemented - providers are configured at OpenClaw gateway level');
    showToast('Providers must be configured at the OpenClaw gateway level', 'warning');
};

window.updateProviderDisplay = function() {
    const providerSelect = document.getElementById('provider-select');
    if (!providerSelect) return;
    
    const selectedProvider = providerSelect.value;
    
    // Update display (with null check)
    const providerNameEl = document.getElementById('provider-name');
    if (providerNameEl) providerNameEl.textContent = selectedProvider;
    
    // Update model dropdown for this provider
    updateModelDropdown(selectedProvider);
};

// Populate provider dropdown dynamically from API
async function populateProviderDropdown() {
    const selects = [
        document.getElementById('provider-select'),
        document.getElementById('setting-provider')
    ].filter(Boolean);
    
    if (selects.length === 0) {
        console.warn('[Dashboard] No provider-select elements found');
        return [];
    }
    
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const allModels = await response.json();
        const providers = Object.keys(allModels);
        
        for (const select of selects) {
            select.innerHTML = '';
            providers.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = provider.split('-').map(w => 
                    w.charAt(0).toUpperCase() + w.slice(1)
                ).join(' ');
                if (provider === currentProvider) option.selected = true;
                select.appendChild(option);
            });
        }

        return providers;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch providers:', e);
        return [];
    }
}

// Handler for settings page provider dropdown change
window.onSettingsProviderChange = async function() {
    const providerSelect = document.getElementById('setting-provider');
    const modelSelect = document.getElementById('setting-model');
    if (!providerSelect || !modelSelect) return;
    
    const provider = providerSelect.value;
    const models = await getModelsForProvider(provider);
    
    modelSelect.innerHTML = '';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        if (model.selected) option.selected = true;
        modelSelect.appendChild(option);
    });
};

// Refresh models from CLI (force cache invalidation)
window.refreshModels = async function() {
    showToast('Refreshing models from CLI...', 'info');
    
    try {
        const response = await fetch('/api/models/refresh', { method: 'POST' });
        const result = await response.json();
        
        if (result.ok) {
            showToast(`${result.message}`, 'success');
            // Refresh the provider dropdown with new models
            await populateProviderDropdown();
            // Update model dropdown for current provider (use currentProvider variable as fallback)
            const providerSelect = document.getElementById('provider-select');
            const provider = providerSelect?.value || currentProvider || 'openrouter';
            await updateModelDropdown(provider);
        } else {
            showToast(result.message || 'Failed to refresh models', 'warning');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to refresh models:', e);
        showToast('Failed to refresh models: ' + e.message, 'error');
    }
}

/**
 * Header dropdown: change model for the CURRENT SESSION only.
 * Uses sessions.patch to set a per-session model override.
 */
window.changeSessionModel = async function() {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect?.value;
    
    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }
    
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to gateway', 'warning');
        return;
    }
    
    try {
        const sessionKey = GATEWAY_CONFIG.sessionKey || 'main';
        console.log(`[Dashboard] Setting session model: ${selectedModel} (session: ${sessionKey})`);
        
        await gateway.patchSession(sessionKey, { model: selectedModel });
        
        // Update local state
        currentModel = selectedModel;
        const provider = selectedModel.split('/')[0];
        currentProvider = provider;
        localStorage.setItem('selected_model', selectedModel);
        localStorage.setItem('selected_provider', provider);
        
        // Update settings display
        const currentModelDisplay = document.getElementById('current-model-display');
        if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;
        const currentProviderDisplay = document.getElementById('current-provider-display');
        if (currentProviderDisplay) currentProviderDisplay.textContent = provider;
        
        // Ensure provider dropdown matches model provider
        const providerSelectEl = document.getElementById('provider-select');
        if (providerSelectEl) {
            const providerOptions = Array.from(providerSelectEl.options);
            if (!providerOptions.find(o => o.value === provider)) {
                const opt = document.createElement('option');
                opt.value = provider;
                opt.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                providerSelectEl.appendChild(opt);
            }
            providerSelectEl.value = provider;
        }
        
        showToast(`Session model → ${selectedModel.split('/').pop()}`, 'success');
    } catch (error) {
        console.error('[Dashboard] Failed to set session model:', error);
        showToast(`Failed: ${error.message}`, 'error');
    }
};

/**
 * Settings: change the GLOBAL DEFAULT model for all agents.
 * Patches openclaw.json via the server API and triggers gateway restart.
 */
window.changeGlobalModel = async function() {
    const modelSelect = document.getElementById('setting-model');
    const providerSelect = document.getElementById('setting-provider');
    const selectedModel = modelSelect?.value;
    const selectedProvider = providerSelect?.value;
    
    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }
    
    if (selectedModel.includes('ERROR')) {
        showToast('Cannot change model - configuration error', 'error');
        return;
    }
    
    try {
        console.log(`[Dashboard] Changing global default model to: ${selectedModel}`);
        
        const response = await fetch('/api/models/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: selectedModel })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentModel = selectedModel;
            const provider = selectedModel.split('/')[0];
            currentProvider = provider;
            localStorage.setItem('selected_provider', provider);
            localStorage.setItem('selected_model', selectedModel);
            
            // Update all displays
            const currentModelDisplay = document.getElementById('current-model-display');
            const currentProviderDisplay = document.getElementById('current-provider-display');
            if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;
            if (currentProviderDisplay) currentProviderDisplay.textContent = provider;
            
            // Sync header dropdown
            selectModelInDropdowns(selectedModel);
            
            showToast(`Global default → ${selectedModel.split('/').pop()}. Gateway restarting...`, 'success');
        } else {
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('[Dashboard] Error changing global model:', error);
        showToast(`Failed: ${error.message}`, 'error');
    }
};

// Legacy alias — keep for any old references
window.changeModel = window.changeSessionModel;

async function updateModelDropdown(provider) {
    const models = await getModelsForProvider(provider);
    
    // Populate both dropdowns independently
    const selects = [
        document.getElementById('model-select'),
        document.getElementById('setting-model')
    ].filter(Boolean);
    
    for (const select of selects) {
        select.innerHTML = '';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.name;
            if (model.selected) option.selected = true;
            select.appendChild(option);
        });
    }
}

async function getModelsForProvider(provider) {
    // Prefer gateway-sourced models (fetched via WebSocket — most reliable)
    if (window._gatewayModels && window._gatewayModels[provider]) {
        const providerModels = window._gatewayModels[provider];
        return providerModels.map(m => ({
            value: m.id,
            name: m.name,
            selected: (m.id === currentModel)
        }));
    }
    
    // Fallback: fetch from server API
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const allModels = await response.json();

        // Get models for the requested provider
        const providerModels = allModels[provider] || [];

        // Transform to expected format and mark current as selected
        const models = providerModels.map(m => ({
            value: m.id,
            name: m.name,
            selected: (m.id === currentModel)
        }));

        return models;
    } catch (e) {
        console.error('[Dashboard] Failed to get models from API:', e);
        return [];
    }
}

function getConfiguredModels() {
    // Fallback to configured models if command fails
    try {
        const exec = require('child_process').execSync;
        const result = exec('moltbot models list 2>/dev/null | tail -n +4', { encoding: 'utf8' });
        
        const models = [];
        const lines = result.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const modelId = parts[0];
                const tags = parts[parts.length - 1] || '';
                
                models.push({
                    value: modelId,
                    name: modelId.split('/').pop() || modelId,
                    selected: tags.includes('default') || tags.includes('configured')
                });
            }
        }
        
        return models;
    } catch (e) {
        return [];
    }
}

// Current model state
let currentProvider = 'anthropic';
let currentModel = 'anthropic/claude-opus-4-5';

/**
 * Sync the model dropdown and display elements with the actual model in use.
 * Called when we get model info from gateway connect or chat responses.
 * This is the source of truth — gateway tells us what model is actually running.
 */
function syncModelDisplay(model, provider) {
    if (!model) return;
    if (model === currentModel && provider === currentProvider) return;
    
    console.log(`[Dashboard] Model sync: ${currentModel} → ${model} (provider: ${provider || currentProvider})`);
    currentModel = model;
    
    // Extract provider from model ID if not provided
    if (!provider && model.includes('/')) {
        provider = model.split('/')[0];
    }
    if (provider) currentProvider = provider;
    
    // Update localStorage
    localStorage.setItem('selected_model', model);
    if (provider) localStorage.setItem('selected_provider', provider);
    
    // Update settings modal displays
    const currentModelDisplay = document.getElementById('current-model-display');
    if (currentModelDisplay) currentModelDisplay.textContent = model;
    
    // Update provider display & dropdown
    if (provider) {
        const currentProviderDisplay = document.getElementById('current-provider-display');
        if (currentProviderDisplay) currentProviderDisplay.textContent = provider;
        
        const providerSelectEl = document.getElementById('provider-select');
        if (providerSelectEl) {
            // Make sure provider option exists
            const providerOptions = Array.from(providerSelectEl.options);
            if (!providerOptions.find(o => o.value === provider)) {
                const opt = document.createElement('option');
                opt.value = provider;
                opt.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                providerSelectEl.appendChild(opt);
            }
            providerSelectEl.value = provider;
        }
        
        // Refresh model dropdown for this provider, then select the right model
        updateModelDropdown(provider).then(() => {
            selectModelInDropdowns(model);
        });
    } else {
        selectModelInDropdowns(model);
    }
}

// Apply per-session model override from availableSessions (if present)
async function applySessionModelOverride(sessionKey) {
    if (!sessionKey) return;
    const session = availableSessions.find(s => s.key === sessionKey);
    const model = session?.model && session.model !== 'unknown' ? session.model : null;
    if (model) {
        const provider = model.includes('/') ? model.split('/')[0] : currentProvider;
        syncModelDisplay(model, provider);
        return;
    }
    // If not found locally, refresh sessions list and retry once
    try {
        const result = await gateway?.listSessions?.({});
        if (result?.sessions?.length) {
            availableSessions = result.sessions.map(s => ({
                key: s.key,
                name: getFriendlySessionName(s.key),
                displayName: getFriendlySessionName(s.key),
                updatedAt: s.updatedAt,
                totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                model: s.model || 'unknown',
                sessionId: s.sessionId
            }));
            const updated = availableSessions.find(s => s.key === sessionKey);
            const updatedModel = updated?.model && updated.model !== 'unknown' ? updated.model : null;
            if (updatedModel) {
                const provider = updatedModel.includes('/') ? updatedModel.split('/')[0] : currentProvider;
                syncModelDisplay(updatedModel, provider);
            }
        }
    } catch (e) {
        console.warn('[Dashboard] Failed to refresh sessions for model override:', e.message);
    }
}

/**
 * Fetch model configuration directly from the gateway via WebSocket RPC.
 * This is the most reliable source — it reads the live openclaw.json from the running gateway.
 */
async function fetchModelsFromGateway() {
    if (!gateway || !gateway.isConnected()) return;
    
    try {
        const config = await gateway.getConfig();
        
        // Parse the config to find model info
        let configData = config;
        if (typeof config === 'string') {
            configData = JSON.parse(config);
        }
        // config.get might return { raw: "...", hash: "..." }
        if (configData?.raw) {
            configData = JSON.parse(configData.raw);
        }
        
        const modelConfig = configData?.agents?.defaults?.model;
        if (!modelConfig) {
            console.warn('[Dashboard] No model config in gateway response');
            return;
        }
        
        const primary = modelConfig.primary;
        const fallbacks = modelConfig.fallbacks || [];
        const picker = modelConfig.picker || [];
        
        // Combine all model IDs
        const allModelIds = [...new Set([
            ...(primary ? [primary] : []),
            ...picker,
            ...fallbacks
        ])];
        
        if (allModelIds.length === 0) return;
        
        console.log(`[Dashboard] Got ${allModelIds.length} models from gateway config`);
        
        // Group by provider
        const modelsByProvider = {};
        for (const modelId of allModelIds) {
            const slashIdx = modelId.indexOf('/');
            if (slashIdx === -1) continue;
            
            const provider = modelId.substring(0, slashIdx);
            const modelName = modelId.substring(slashIdx + 1);
            
            if (!modelsByProvider[provider]) modelsByProvider[provider] = [];
            
            // Create a clean display name
            const isPrimary = modelId === primary;
            const displayName = modelName + (isPrimary ? ' ⭐' : '');
            
            if (!modelsByProvider[provider].some(m => m.id === modelId)) {
                modelsByProvider[provider].push({
                    id: modelId,
                    name: displayName,
                    tier: isPrimary ? 'default' : 'fallback'
                });
            }
        }
        
        // Update the provider dropdown
        const providerSelect = document.getElementById('provider-select');
        if (providerSelect) {
            const providers = Object.keys(modelsByProvider);
            providerSelect.innerHTML = '';
            providers.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                providerSelect.appendChild(opt);
            });
        }
        
        // Store for getModelsForProvider to use
        window._gatewayModels = modelsByProvider;
        
        // Sync current model from primary
        if (primary) {
            syncModelDisplay(primary, primary.split('/')[0]);
        }
        
    } catch (e) {
        console.warn('[Dashboard] Failed to fetch models from gateway:', e.message);
    }
}

/**
 * Select a model in both header and settings dropdowns.
 * Adds the option dynamically if it's not already listed.
 */
function selectModelInDropdowns(model) {
    const shortName = model.split('/').pop() || model;
    
    const modelSelect = document.getElementById('model-select');
    const settingModel = document.getElementById('setting-model');
    
    [modelSelect, settingModel].forEach(select => {
        if (!select) return;
        const options = Array.from(select.options);
        const match = options.find(o => o.value === model);
        if (match) {
            select.value = model;
        } else {
            // Model not in dropdown — add it
            const option = document.createElement('option');
            option.value = model;
            option.textContent = shortName;
            option.selected = true;
            select.appendChild(option);
        }
    });
}

// Initialize provider/model display on page load
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // First populate the provider dropdown dynamically
        await populateProviderDropdown();
        
        // Always fetch current model from server API (reads openclaw.json — source of truth)
        // Don't trust localStorage as it can get stale across sessions/deploys
        let modelId = null;
        let provider = null;
        
        try {
            const response = await fetch('/api/models/current');
            const modelInfo = await response.json();
            modelId = modelInfo?.modelId;
            provider = modelInfo?.provider;
            console.log(`[Dashboard] Model from API: ${modelId} (provider: ${provider})`);
        } catch (e) {
            console.warn('[Dashboard] Failed to fetch current model from API:', e.message);
            // Fall back to localStorage only if API fails
            modelId = localStorage.getItem('selected_model');
            provider = localStorage.getItem('selected_provider');
        }
        
        // Final fallback
        if (!modelId) modelId = 'anthropic/claude-opus-4-5';
        if (!provider) provider = modelId.split('/')[0];
        
        currentProvider = provider;
        currentModel = modelId;

        console.log(`[Dashboard] Init model: ${currentModel} (provider: ${currentProvider})`);
        
        // Update displays
        const currentProviderDisplay = document.getElementById('current-provider-display');
        const currentModelDisplay = document.getElementById('current-model-display');
        const providerSelectEl = document.getElementById('provider-select');
        
        if (currentProviderDisplay) currentProviderDisplay.textContent = currentProvider;
        if (currentModelDisplay) currentModelDisplay.textContent = currentModel;
        if (providerSelectEl) providerSelectEl.value = currentProvider;
        
        // Also sync settings provider dropdown
        const settingProviderEl = document.getElementById('setting-provider');
        if (settingProviderEl) settingProviderEl.value = currentProvider;
        
        // Populate model dropdown for current provider and select current model
        await updateModelDropdown(currentProvider);
        selectModelInDropdowns(currentModel);
        
    } catch (error) {
        console.error('[Dashboard] Failed to initialize model display:', error);
    }
});

// Default settings
const defaultSettings = {
    pickupFreq: 'disabled',
    priorityOrder: 'priority',
    refreshInterval: '10000',
    defaultPriority: '1',
    compactMode: false,
    showLive: true,
    showActivity: true,
    showNotes: true,
    showProducts: true,
    showDocs: true
};

// ===================
// GATEWAY CONNECTION
// ===================

async function checkRestartToast() {
    try {
        const response = await fetch('/api/state');
        if (!response.ok) return;
        const state = await response.json();
        if (state.restartPending) {
            showToast('Gateway restarted successfully', 'success');
            delete state.restartPending;
            await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            });
        }
    } catch (e) {
        console.warn('[Dashboard] Restart toast check failed:', e);
    }
}

// ===================
// SESSION MANAGEMENT
// ===================

// Helper to extract friendly name from session key (strips agent:agentId: prefix)
function getFriendlySessionName(key) {
    if (!key) return 'main';
    // Strip agent:main: or agent:xxx: prefix
    const match = key.match(/^agent:[^:]+:(.+)$/);
    return match ? match[1] : key;
}

let currentSessionName = 'main';

window.toggleSessionMenu = function() {
    const menu = document.getElementById('session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

window.renameSession = async function() {
    toggleSessionMenu();
    const newName = prompt('Enter new session name:', currentSessionName);
    if (!newName || newName === currentSessionName) return;
    
    try {
        const response = await fetch('/api/session/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName: currentSessionName, newName })
        });
        
        if (response.ok) {
            currentSessionName = newName;
            const nameEl = document.getElementById('current-session-name');
            if (nameEl) nameEl.textContent = newName;
            showToast(`Session renamed to "${newName}"`, 'success');
        } else {
            const err = await response.json();
            showToast(`Failed to rename: ${err.error || 'Unknown error'}`, 'error');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to rename session:', e);
        showToast('Failed to rename session', 'error');
    }
}

window.showSessionSwitcher = function() {
    toggleSessionMenu();
    showToast('Session switcher coming soon', 'info');
}

// Chat Page Session Menu Functions
window.toggleChatPageSessionMenu = function() {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

// Close session menu when clicking outside
document.addEventListener('click', function(e) {
    const menu = document.getElementById('chat-page-session-menu');
    const trigger = e.target.closest('[onclick*="toggleChatPageSessionMenu"]');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !trigger) {
        menu.classList.add('hidden');
    }
});

// Session Management
let availableSessions = [];
let currentAgentId = 'main'; // Track which agent's sessions we're viewing

// Get the agent ID from a session key (e.g., "agent:dev:main" -> "dev")
function getAgentIdFromSession(sessionKey) {
    const match = sessionKey?.match(/^agent:([^:]+):/);
    return match ? match[1] : 'main';
}

// Filter sessions to only show those belonging to a specific agent
// Also includes spawned subagent sessions (agent:main:subagent:*) where the label starts with the agentId
// Example: agentId="dev" matches:
//   - agent:dev:main (direct match)
//   - agent:main:subagent:abc123 with label "dev-avatar-fix" (label prefix match)
function filterSessionsForAgent(sessions, agentId) {
    return sessions.filter(s => {
        // Direct match: session belongs to this agent
        const sessAgent = getAgentIdFromSession(s.key);
        if (sessAgent === agentId) return true;
        
        // Subagent match: spawned by main but labeled for this agent
        // Pattern: agent:main:subagent:* with label starting with "{agentId}-"
        if (s.key?.startsWith('agent:main:subagent:')) {
            const label = s.displayName || s.name || '';
            // Label pattern: {agentId}-{taskname} (e.g., "dev-avatar-fix", "cmp-marketing-research")
            if (label.toLowerCase().startsWith(agentId.toLowerCase() + '-')) {
                return true;
            }
        }
        
        return false;
    });
}

// Check URL parameters for auto-session connection
function checkUrlSessionParam() {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) {
        console.log(`[Dashboard] URL session param detected: ${sessionParam}`);
        return sessionParam;
    }
    return null;
}

// For subagent sessions (agent:main:subagent:*), determine the correct agent from the label
// and update currentAgentId so the sidebar highlights correctly
function handleSubagentSessionAgent() {
    if (!currentSessionName?.startsWith('agent:main:subagent:')) {
        return; // Not a subagent session
    }
    
    // Find the session in availableSessions
    const session = availableSessions.find(s => s.key === currentSessionName);
    if (!session) {
        console.log(`[Dashboard] Subagent session not found in available sessions: ${currentSessionName}`);
        return;
    }
    
    const label = session.displayName || session.name || '';
    console.log(`[Dashboard] Subagent session label: ${label}`);
    
    // Extract agent ID from label pattern: {agentId}-{taskname}
    const labelMatch = label.match(/^([a-z]+)-/i);
    if (labelMatch) {
        const agentFromLabel = labelMatch[1].toLowerCase();
        console.log(`[Dashboard] Determined agent from label: ${agentFromLabel}`);
        
        // Update current agent ID
        currentAgentId = agentFromLabel;
        
        // Update sidebar highlight
        setActiveSidebarAgent(agentFromLabel);
        
        // Update agent name display
        const agentNameEl = document.getElementById('chat-page-agent-name');
        if (agentNameEl) {
            agentNameEl.textContent = getAgentLabel(agentFromLabel);
        }
    }
}

async function fetchSessions() {
    // Preserve locally-added sessions that might not be in gateway yet
    const localSessions = availableSessions.filter(s => s.sessionId === null);
    
    // Try gateway first if connected (direct RPC call)
    if (gateway && gateway.isConnected()) {
        try {
            // Fetch all sessions without label filter
            // Note: gateway's label filter checks entry.label but dashboard sessions have origin.label
            // Don't pass label parameter at all - empty string fails validation
            const result = await gateway.listSessions({});
            let sessions = result?.sessions || [];

            // Show all sessions from gateway (main + DMs + dashboard)

            // Map gateway response to expected format
            // Always use friendly name for display (strips agent:main: prefix)
            const gatewaySessions = sessions.map(s => {
                const friendlyName = getFriendlySessionName(s.key);
                return {
                    key: s.key,
                    name: friendlyName,
                    displayName: friendlyName,  // Always use friendly name, not gateway's displayName
                    updatedAt: s.updatedAt,
                    totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                    model: s.model || 'unknown',
                    sessionId: s.sessionId
                };
            });
            
            // Merge: gateway sessions + local sessions not in gateway
            const gatewayKeys = new Set(gatewaySessions.map(s => s.key));
            const mergedLocalSessions = localSessions.filter(s => !gatewayKeys.has(s.key));
            availableSessions = [...gatewaySessions, ...mergedLocalSessions];

            console.log(`[Dashboard] Fetched ${gatewaySessions.length} from gateway + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);
            
            // If current session is a subagent, determine the correct agent from its label
            handleSubagentSessionAgent();
            
            populateSessionDropdown();
            // Subscribe to all sessions for cross-session notifications
            subscribeToAllSessions();
            return availableSessions;
        } catch (e) {
            console.warn('[Dashboard] Gateway sessions.list failed, falling back to server:', e.message);
        }
    }

    // Fallback to server API
    try {
        const response = await fetch('/api/sessions');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const rawServerSessions = data.sessions || [];
        
        // Map server sessions to expected format (same as gateway mapping)
        const serverSessions = rawServerSessions.map(s => {
            const friendlyName = getFriendlySessionName(s.key);
            return {
                key: s.key,
                name: friendlyName,
                displayName: s.displayName || friendlyName,
                updatedAt: s.updatedAt,
                totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                model: s.model || 'unknown',
                sessionId: s.sessionId
            };
        });
        
        // Merge: server sessions + local sessions not in server
        const serverKeys = new Set(serverSessions.map(s => s.key));
        const mergedLocalSessions = localSessions.filter(s => !serverKeys.has(s.key));
        availableSessions = [...serverSessions, ...mergedLocalSessions];
        
        console.log(`[Dashboard] Fetched ${serverSessions.length} from server + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);
        
        // If current session is a subagent, determine the correct agent from its label
        handleSubagentSessionAgent();
        
        populateSessionDropdown();
        return availableSessions;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch sessions:', e);
        return [];
    }
}

function populateSessionDropdown() {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;
    
    // Filter sessions for current agent only
    const agentSessions = filterSessionsForAgent(availableSessions, currentAgentId);
    
    console.log(`[Dashboard] populateSessionDropdown: agent=${currentAgentId}, total=${availableSessions.length}, filtered=${agentSessions.length}`);
    console.log(`[Dashboard] Available sessions:`, availableSessions.map(s => s.key));
    
    // Build the dropdown HTML
    let html = '';
    
    // Header showing which agent's sessions we're viewing
    const agentLabel = getAgentLabel(currentAgentId);
    html += `<div style="padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
        <span>${escapeHtml(agentLabel)} Sessions</span>
        <button onclick="startNewAgentSession('${currentAgentId}')" style="background: var(--brand-red); color: white; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;" title="New session for ${agentLabel}">+ New</button>
    </div>`;
    
    if (agentSessions.length === 0) {
        html += '<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">No sessions for this agent yet</div>';
        menu.innerHTML = html;
        return;
    }
    
    html += agentSessions.map(s => {
        const isActive = s.key === currentSessionName;
        const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
        const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        
        return `
        <div class="session-dropdown-item ${isActive ? 'active' : ''}" data-session-key="${s.key}" onclick="if(event.target.closest('.session-edit-btn')) return; switchToSession('${s.key}')">
            <div class="session-info">
                <div class="session-name">${escapeHtml(s.displayName || s.name || s.key || 'unnamed')}${unreadSessions.get(s.key) ? ` <span class="unread-badge" style="background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 18px; height: 18px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; margin-left: 4px;">${unreadSessions.get(s.key)}</span>` : ''}</div>
                <div class="session-meta">${dateStr} ${timeStr} • ${s.totalTokens?.toLocaleString() || 0} tokens</div>
            </div>
            <span class="session-model">${s.model}</span>
            <div class="session-actions">
                <button class="session-edit-btn" onclick="editSessionName('${s.key}', '${escapeHtml(s.displayName || s.name || s.key || 'unnamed')}')" title="Rename session">
                    ✏️
                </button>
                <button class="session-edit-btn" onclick="deleteSession('${s.key}', '${escapeHtml(s.displayName || s.name || s.key || 'unnamed')}')" title="Delete session" style="color: var(--error);">
                    🗑️
                </button>
            </div>
        </div>
        `;
    }).join('');
    
    menu.innerHTML = html;
}

// Get human-readable label for an agent ID
function getAgentLabel(agentId) {
    const labels = {
        'main': 'SoLoBot',
        'exec': 'EXEC',
        'coo': 'COO',
        'cfo': 'CFO',
        'cmp': 'CMP',
        'dev': 'DEV',
        'family': 'Family',
        'tax': 'Tax',
        'smm': 'SMM'
    };
    return labels[agentId] || agentId.toUpperCase();
}

// Get display name for message bubbles (e.g., "SoLoBot-DEV")
function getAgentDisplayName(agentId) {
    if (!agentId || agentId === 'main') {
        return 'SoLoBot';
    }
    const label = getAgentLabel(agentId);
    return `SoLoBot-${label}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.editSessionName = function(sessionKey, currentName) {
    const newName = prompt('Enter new session name:', currentName);
    if (!newName || newName === currentName) return;
    
    fetch('/api/session/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName: sessionKey, newName })
    }).then(r => r.json()).then(result => {
        if (result.ok) {
            showToast(`Session rename requested. Will update shortly.`, 'success');
            // Update local display immediately
            const session = availableSessions.find(s => s.key === sessionKey);
            if (session) {
                session.displayName = newName;
                populateSessionDropdown();
                if (sessionKey === currentSessionName) {
                    const nameEl = document.getElementById('chat-page-session-name');
                    if (nameEl) nameEl.textContent = newName;
                }
            }
        } else {
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    }).catch(e => {
        console.error('[Dashboard] Failed to rename session:', e);
        showToast('Failed to rename session', 'error');
    });
}

window.deleteSession = async function(sessionKey, sessionName) {
    // Don't allow deleting the current active session
    if (sessionKey === currentSessionName) {
        showToast('Cannot delete the active session. Switch to another session first.', 'warning');
        return;
    }
    
    // Confirm deletion
    if (!confirm(`Delete session "${sessionName}"?\n\nThis will permanently delete all messages in this session.`)) {
        return;
    }
    
    try {
        // Use gateway RPC to delete the session
        if (gateway && gateway.isConnected()) {
            const result = await gateway.request('sessions.delete', { sessionKey });
            if (result && result.ok) {
                showToast(`Session "${sessionName}" deleted`, 'success');
                // Remove from local list
                availableSessions = availableSessions.filter(s => s.key !== sessionKey);
                populateSessionDropdown();
            } else {
                showToast(`Failed to delete: ${result?.error || 'Unknown error'}`, 'error');
            }
        } else {
            showToast('Not connected to gateway', 'error');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to delete session:', e);
        showToast('Failed to delete session: ' + e.message, 'error');
    }
}

window.switchToSessionKey = window.switchToSession = async function(sessionKey) {
    toggleChatPageSessionMenu();
    
    // Clear unread notifications for this session
    clearUnreadForSession(sessionKey);
    
    if (sessionKey === currentSessionName) {
        showToast('Already on this session', 'info');
        return;
    }
    
    showToast(`Switching to ${getFriendlySessionName(sessionKey)}...`, 'info');
    
    try {
        // 1. Save current chat as safeguard
        await saveCurrentChat();

        // 2. Increment session version to invalidate any in-flight history loads
        sessionVersion++;
        console.log(`[Dashboard] Session version now ${sessionVersion}`);

        // 3. Update session config and input field
        currentSessionName = sessionKey;
        GATEWAY_CONFIG.sessionKey = sessionKey;
        localStorage.setItem('gateway_session', sessionKey);  // Persist for reload
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;
        
        // 3a. Update current agent ID from session key
        const agentMatch = sessionKey.match(/^agent:([^:]+):/);
        if (agentMatch) {
            currentAgentId = agentMatch[1];
        }

        // 4. Clear current chat (skip confirmation, clear cache to prevent stale data)
        await clearChatHistory(true, true);

        // 5. Reconnect gateway with new session key
        if (gateway && gateway.isConnected()) {
            gateway.disconnect();
            await new Promise(resolve => setTimeout(resolve, 300));
            connectToGateway();  // This uses GATEWAY_CONFIG.sessionKey
        }

        // 6. Load new session's history
        await loadSessionHistory(sessionKey);
        // Apply per-session model override (if any)
        await applySessionModelOverride(sessionKey);
        const nameEl = document.getElementById('chat-page-session-name');
        if (nameEl) {
            const session = availableSessions.find(s => s.key === sessionKey);
            nameEl.textContent = session ? (session.displayName || session.name) : getFriendlySessionName(sessionKey);
        }
        // Refresh dropdown to show new selection (filtered by agent)
        populateSessionDropdown();

        if (agentMatch) {
            setActiveSidebarAgent(agentMatch[1]);
            saveLastAgentSession(agentMatch[1], sessionKey);
        } else {
            setActiveSidebarAgent(null);
        }

        showToast(`Switched to ${getFriendlySessionName(sessionKey)}`, 'success');
    } catch (e) {
        console.error('[Dashboard] Failed to switch session:', e);
        showToast('Failed to switch session', 'error');
    }
}

// Navigate to a session by key - can be called from external links
// Usage: window.goToSession('agent:main:subagent:abc123')
// Or via URL: ?session=agent:main:subagent:abc123
window.goToSession = async function(sessionKey) {
    if (!sessionKey) {
        showToast('No session key provided', 'warning');
        return;
    }
    
    console.log(`[Dashboard] goToSession called with: ${sessionKey}`);
    
    // Wait for gateway to be connected
    if (!gateway || !gateway.isConnected()) {
        showToast('Connecting to gateway...', 'info');
        // If not connected, set the session key and let auto-connect handle it
        GATEWAY_CONFIG.sessionKey = sessionKey;
        currentSessionName = sessionKey;
        localStorage.setItem('gateway_session', sessionKey);  // Persist for reload
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;
        
        // Try to connect
        if (GATEWAY_CONFIG.host) {
            connectToGateway();
        } else {
            showToast('Please configure gateway settings first', 'warning');
        }
        return;
    }
    
    // Show chat page first
    showPage('chat');
    
    // Switch to the session
    await switchToSession(sessionKey);
}

// Generate a URL for a specific session (for sharing/linking)
window.getSessionUrl = function(sessionKey) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?session=${encodeURIComponent(sessionKey)}`;
}

async function saveCurrentChat() {
    // Save current chat messages to state as safeguard
    try {
        const response = await fetch('/api/state');
        const state = await response.json();
        
        // Save chat history to archivedChats
        if (!state.archivedChats) state.archivedChats = {};
        state.archivedChats[currentSessionName] = {
            savedAt: Date.now(),
            messages: chatHistory.slice(-100) // Last 100 messages
        };
        
        await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
    } catch (e) {
        // Silently fail - safeguard is optional
    }
}

async function loadSessionHistory(sessionKey) {
    try {
        // Find session in available sessions (which now includes messages)
        const session = availableSessions.find(s => s.key === sessionKey);
        
        if (session?.messages && session.messages.length > 0) {
            // Convert to chat format
            chatHistory = session.messages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : msg.role,
                content: msg.content || '',
                timestamp: msg.timestamp || Date.now(),
                name: msg.name
            }));
            
            renderChat();
            renderChatPage();
            console.log(`[Dashboard] Loaded ${session.messages.length} messages from ${sessionKey}`);
        } else {
            console.warn('[Dashboard] No messages in session:', sessionKey);
            // Try loading from archived chats as fallback
            await loadArchivedChat(sessionKey);
        }
    } catch (e) {
        console.error('[Dashboard] Failed to load session history:', e);
        // Fallback to archived chat
        await loadArchivedChat(sessionKey);
    }
}

async function loadArchivedChat(sessionKey) {
    try {
        const response = await fetch('/api/state');
        const state = await response.json();
        
        const archived = state.archivedChats?.[sessionKey];
        if (archived?.messages) {
            chatHistory = archived.messages;
            renderChat();
            renderChatPage();
        } else {
            chatHistory = [];
            renderChat();
            renderChatPage();
        }
    } catch (e) {
        console.warn('[Dashboard] Failed to load archived chat:', e);
        chatHistory = [];
        renderChat();
        renderChatPage();
    }
}

// Fetch sessions on page load
document.addEventListener('DOMContentLoaded', () => {
    fetchSessions();
});

function initGateway() {
    gateway = new GatewayClient({
        sessionKey: GATEWAY_CONFIG.sessionKey,
        onConnected: (serverName, sessionKey) => {
            console.log(`[Dashboard] Connected to ${serverName}, session: ${sessionKey}`);
            updateConnectionUI('connected', serverName);
            GATEWAY_CONFIG.sessionKey = sessionKey;
            
            // Sync model display from server info
            const serverModel = localStorage.getItem('server_model');
            const serverProvider = localStorage.getItem('server_provider');
            if (serverModel) syncModelDisplay(serverModel, serverProvider);
            
            // Fetch model config directly from gateway (most reliable source)
            fetchModelsFromGateway();
            // Apply per-session model override (if any)
            applySessionModelOverride(sessionKey);
            
            // Update session name displays (use friendly name without agent prefix)
            currentSessionName = sessionKey;
            const friendlyName = getFriendlySessionName(sessionKey);
            const nameEl = document.getElementById('current-session-name');
            if (nameEl) nameEl.textContent = friendlyName;
            const chatPageNameEl = document.getElementById('chat-page-session-name');
            if (chatPageNameEl) chatPageNameEl.textContent = friendlyName;
            
            // Remember this session for the agent
            const agentMatch = sessionKey.match(/^agent:([^:]+):/);
            if (agentMatch) saveLastAgentSession(agentMatch[1], sessionKey);
            
            checkRestartToast();

            // Load chat history on connect (one-time full load)
            _historyRefreshInFlight = true;
            _lastHistoryLoadTime = Date.now();
            const loadVersion = sessionVersion;
            gateway.loadHistory().then(result => {
                _historyRefreshInFlight = false;
                if (loadVersion !== sessionVersion) {
                    console.log(`[Dashboard] Ignoring stale history (version ${loadVersion} != ${sessionVersion})`);
                    return;
                }
                if (result?.messages) {
                    if (!state.chat?.messages?.length) {
                        loadHistoryMessages(result.messages);
                    } else {
                        mergeHistoryMessages(result.messages);
                    }
                }
            }).catch(() => { _historyRefreshInFlight = false; });

            // Poll history periodically (guarded — won't overlap with initial load)
            startHistoryPolling();

            // Fetch sessions list from gateway (now that we're connected)
            fetchSessions();
        },
        onDisconnected: (message) => {
            updateConnectionUI('disconnected', message);
            isProcessing = false;
            streamingText = '';
            stopHistoryPolling();
        },
        onChatEvent: (event) => {
            handleChatEvent(event);
        },
        onToolEvent: (event) => {
            // Add tool event to terminal in real-time
            if (event.phase === 'start' && event.summary) {
                addTerminalLog(event.summary, 'info', event.timestamp);
            }
        },
        onCrossSessionMessage: (msg) => {
            handleCrossSessionNotification(msg);
        },
        onError: (error) => {
            console.error(`[Dashboard] Gateway error: ${error}`);
            updateConnectionUI('error', error);
        }
    });
}

// ===================
// CROSS-SESSION NOTIFICATIONS
// ===================
const READ_ACK_PREFIX = '[[read_ack]]';
const unreadSessions = new Map(); // sessionKey → count
const NOTIFICATION_DEBUG = true;
function notifLog(...args){ if (NOTIFICATION_DEBUG) console.log(...args); }

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
            console.log(`[Notifications] Permission: ${perm}`);
        });
    }
}

function subscribeToAllSessions() {
    if (!gateway || !gateway.isConnected()) return;
    const keys = availableSessions.map(s => s.key).filter(k => k);
    if (keys.length > 0) {
        gateway.subscribeToAllSessions(keys);
        console.log(`[Notifications] Subscribed to ${keys.length} sessions for cross-session notifications`);
    }
}

function handleCrossSessionNotification(msg) {
    const { sessionKey, content } = msg;
    const friendlyName = getFriendlySessionName(sessionKey);
    const preview = content.length > 120 ? content.slice(0, 120) + '…' : content;
    
    notifLog(`[Notifications] 🔔 Message from ${friendlyName}: ${preview.slice(0, 60)}`);
    
    // Track unread count
    unreadSessions.set(sessionKey, (unreadSessions.get(sessionKey) || 0) + 1);
    updateUnreadBadges();
    notifLog(`[Notifications] Unread total: ${Array.from(unreadSessions.values()).reduce((a,b)=>a+b,0)}`);
    
    // Always show in-app toast (works regardless of browser notification permission)
    showNotificationToast(friendlyName, preview, sessionKey);
    
    // Browser notification (best-effort — may not be permitted)
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const notification = new Notification(`${friendlyName}`, {
                body: preview,
                icon: '/solobot-avatar.png',
                tag: `session-${sessionKey}`,
                silent: false
            });
            
            notification.onclick = () => {
                window.focus();
                navigateToSession(sessionKey);
                notification.close();
            };
            
            setTimeout(() => notification.close(), 8000);
        } catch (e) {
            console.warn('[Notifications] Browser notification failed:', e);
        }
    }
    
    // Play notification sound
    playNotificationSound();
}

// Navigate to a specific session (used by notification click handlers)
function navigateToSession(sessionKey) {
    if (typeof showPage === 'function') showPage('chat');
    const agentMatch = sessionKey.match(/^agent:([^:]+):/);
    if (agentMatch && typeof setActiveSidebarAgent === 'function') {
        setActiveSidebarAgent(agentMatch[1]);
    }
    if (typeof switchToSessionKey === 'function') {
        switchToSessionKey(sessionKey);
    }
    // Clear unread for this session
    unreadSessions.delete(sessionKey);
    updateUnreadBadges();
}

// In-app toast notification — always visible, no browser permission needed
function showNotificationToast(title, body, sessionKey) {
    // Create toast container if it doesn't exist
    let container = document.getElementById('notification-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-toast-container';
        container.style.cssText = 'position: fixed; top: 12px; right: 12px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; max-width: 360px; pointer-events: none;';
        document.body.appendChild(container);
    }
    
    // Determine agent color from session key
    const agentMatch = sessionKey?.match(/^agent:([^:]+):/);
    const agentId = agentMatch ? agentMatch[1] : 'main';
    const agentColors = { main: '#BC2026', dev: '#6366F1', exec: '#F59E0B', coo: '#10B981', cfo: '#EAB308', cmp: '#EC4899', family: '#14B8A6', tax: '#78716C', sec: '#3B82F6', smm: '#8B5CF6' };
    const color = agentColors[agentId] || '#BC2026';
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.style.cssText = `
        pointer-events: auto; cursor: pointer;
        background: var(--card-bg, #1a1a2e); color: var(--text-primary, #e0e0e0);
        border: 1px solid color-mix(in srgb, ${color} 60%, transparent);
        border-left: 4px solid ${color}; border-radius: 8px;
        padding: 10px 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.35);
        opacity: 0; transform: translateX(100%);
        transition: all 0.3s ease; max-width: 360px;
        font-family: var(--font-family, system-ui);
        backdrop-filter: blur(6px);
    `;
    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0; box-shadow: 0 0 0 2px color-mix(in srgb, ${color} 30%, transparent);"></span>
            <strong style="color: var(--text-primary, #e0e0e0); font-size: 13px;">${title}</strong>
            <span style="margin-left: auto; color: var(--text-muted, #666); font-size: 11px; cursor: pointer;" class="toast-close">✕</span>
        </div>
        <div style="color: var(--text-secondary, #c9c9c9); font-size: 12px; line-height: 1.4; padding-left: 16px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${body.replace(/</g, '&lt;')}</div>
    `;
    
    // Click toast → navigate to session
    toast.addEventListener('click', (e) => {
        if (e.target.classList?.contains('toast-close')) {
            dismissToast(toast);
            return;
        }
        navigateToSession(sessionKey);
        dismissToast(toast);
    });
    
    container.appendChild(toast);
    notifLog(`[Notifications] Toast rendered for ${title} (session=${sessionKey})`);
    
    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });
    
    // Auto-dismiss after 12 seconds
    const timer = setTimeout(() => dismissToast(toast), 12000);
    toast._dismissTimer = timer;
    
    // Limit to 4 toasts max
    while (container.children.length > 4) {
        dismissToast(container.firstChild);
    }
}

function dismissToast(toast) {
    if (!toast || toast._dismissed) return;
    toast._dismissed = true;
    clearTimeout(toast._dismissTimer);
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
}

// Toggle notification panel — click bell to navigate to most-unread session
function toggleNotificationPanel() {
    if (unreadSessions.size === 0) {
        // No unreads — just flash the bell
        const bell = document.getElementById('notification-bell');
        if (bell) {
            bell.style.animation = 'none';
            bell.offsetHeight; // trigger reflow
            bell.style.animation = 'bellPulse 0.3s ease-in-out';
        }
        return;
    }
    
    // Find session with most unreads
    let maxKey = null, maxCount = 0;
    for (const [key, count] of unreadSessions) {
        if (count > maxCount) { maxCount = count; maxKey = key; }
    }
    
    if (maxKey) {
        navigateToSession(maxKey);
    }
}

function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1047, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* audio not available */ }
}

function updateUnreadBadges() {
    // Update session dropdown badges
    document.querySelectorAll('.session-option, [data-session-key]').forEach(el => {
        const key = el.dataset?.sessionKey || el.getAttribute('data-session-key');
        if (!key) return;
        
        let badge = el.querySelector('.unread-badge');
        const count = unreadSessions.get(key) || 0;
        
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'unread-badge';
                el.appendChild(badge);
            }
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.cssText = 'background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 18px; height: 18px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; margin-left: 6px;';
        } else if (badge) {
            badge.remove();
        }
    });

    // Update sidebar agent dots
    document.querySelectorAll('.sidebar-agent[data-agent]').forEach(el => {
        const agentId = el.getAttribute('data-agent');
        if (!agentId) return;
        
        // Sum unread across all sessions for this agent
        let agentUnread = 0;
        for (const [key, count] of unreadSessions) {
            if (key.startsWith(`agent:${agentId}:`) || (agentId === 'main' && key === 'main')) {
                agentUnread += count;
            }
        }
        
        let dot = el.querySelector('.agent-unread-dot');
        if (agentUnread > 0) {
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'agent-unread-dot';
                dot.style.cssText = 'position: absolute; top: 2px; right: 2px; background: var(--brand-red, #BC2026); color: white; border-radius: 50%; min-width: 16px; height: 16px; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 3px; pointer-events: none;';
                el.style.position = 'relative';
                el.appendChild(dot);
            }
            dot.textContent = agentUnread > 99 ? '99+' : agentUnread;
        } else if (dot) {
            dot.remove();
        }
    });

    // Update notification bell badge
    const totalUnread = Array.from(unreadSessions.values()).reduce((a, b) => a + b, 0);
    const bellBadge = document.getElementById('notification-bell-badge');
    if (bellBadge) {
        if (totalUnread > 0) {
            bellBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
            bellBadge.style.display = 'flex';
        } else {
            bellBadge.style.display = 'none';
        }
    }

    // Update the tab/title with total unread count
    const baseTitle = 'SoLoVision Dashboard';
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
}

async function sendReadAck(sessionKey) {
    try {
        if (gateway && gateway.isConnected()) {
            await gateway.injectChat(sessionKey, READ_ACK_PREFIX, 'read-sync');
        }
    } catch (e) {
        console.warn('[Notifications] Failed to send read ack:', e.message);
    }
}

function clearUnreadForSession(sessionKey) {
    if (unreadSessions.has(sessionKey)) {
        unreadSessions.delete(sessionKey);
        updateUnreadBadges();
        // Notify other clients (Android) to clear this session unread
        sendReadAck(sessionKey);
    }
}

function connectToGateway() {
    const host = document.getElementById('gateway-host')?.value || GATEWAY_CONFIG.host;
    const port = parseInt(document.getElementById('gateway-port')?.value) || GATEWAY_CONFIG.port;
    const token = document.getElementById('gateway-token')?.value || GATEWAY_CONFIG.token;
    const sessionKey = document.getElementById('gateway-session')?.value || GATEWAY_CONFIG.sessionKey || 'main';

    if (!host) {
        showToast('Please enter a gateway host in Settings', 'warning');
        return;
    }

    // Save settings to both localStorage AND server state
    GATEWAY_CONFIG.host = host;
    GATEWAY_CONFIG.port = port;
    GATEWAY_CONFIG.token = token;
    GATEWAY_CONFIG.sessionKey = sessionKey;
    saveGatewaySettings(host, port, token, sessionKey);

    updateConnectionUI('connecting', 'Connecting...');

    if (!gateway) {
        initGateway();
    }

    gateway.sessionKey = sessionKey;
    gateway.connect(host, port, token);
}

function disconnectFromGateway() {
    if (gateway) {
        gateway.disconnect();
    }
    updateConnectionUI('disconnected', 'Disconnected');
}

// Restart gateway directly via WebSocket RPC (no bot involved)
window.requestGatewayRestart = async function() {
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to gateway', 'warning');
        return;
    }

    showToast('Restarting gateway...', 'info');

    try {
        await gateway.restartGateway('manual restart from dashboard');
        showToast('Gateway restart initiated. Reconnecting...', 'success');
    } catch (err) {
        console.error('[Dashboard] Gateway restart failed:', err);
        showToast('Restart failed: ' + err.message, 'error');
    }
};

function updateConnectionUI(status, message) {
    // Update chat header status
    const statusEl = document.getElementById('gateway-status');
    const statusDot = document.getElementById('gateway-status-dot');

    // Update settings modal status
    const settingsStatusEl = document.getElementById('settings-gateway-status');
    const settingsDot = document.getElementById('settings-gateway-dot');
    const connectBtn = document.getElementById('gateway-connect-btn');
    const disconnectBtn = document.getElementById('gateway-disconnect-btn');

    const displayMessage = message || status;

    if (statusEl) statusEl.textContent = displayMessage;
    if (settingsStatusEl) settingsStatusEl.textContent = displayMessage;

    // Get status-dot class based on status
    const getStatusClass = () => {
        switch (status) {
            case 'connected': return 'success';
            case 'connecting': return 'warning pulse';
            case 'error': return 'error';
            default: return 'idle';
        }
    };

    const statusClass = getStatusClass();

    // Update chat header dot
    if (statusDot) {
        statusDot.className = `status-dot ${statusClass}`;
    }

    // Update settings modal dot
    if (settingsDot) {
        settingsDot.className = `status-dot ${statusClass}`;
    }

    // Update buttons
    if (connectBtn && disconnectBtn) {
        if (status === 'connected') {
            connectBtn.classList.add('hidden');
            disconnectBtn.classList.remove('hidden');
        } else {
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
        }
    }

    // Re-render chat to update placeholder message
    renderChat();
    renderChatPage();
}

function handleChatEvent(event) {
    const { state: eventState, content, role, errorMessage, model, provider, stopReason, sessionKey } = event;
    
    // Ignore read-ack sync events
    if (content && content.startsWith(READ_ACK_PREFIX)) {
        if (sessionKey) clearUnreadForSession(sessionKey);
        return;
    }

    // Intercept health check events
    if (sessionKey && sessionKey.startsWith('health-check-')) {
        const pending = pendingHealthChecks.get(sessionKey);
        if (pending) {
            if (eventState === 'final') {
                pending.resolve({
                    success: true,
                    content: content,
                    model: model,
                    provider: provider
                });
                pendingHealthChecks.delete(sessionKey);
            } else if (eventState === 'error') {
                pending.reject(new Error(errorMessage || 'Gateway error'));
                pendingHealthChecks.delete(sessionKey);
            }
        }
        // Don't show health check events in the main chat UI
        return;
    }
    
    // Track the current model being used for responses and sync UI
    if (model) {
        window._lastResponseModel = model;
        window._lastResponseProvider = provider;
        syncModelDisplay(model, provider);
    }

    // Handle user messages from other clients (WebUI, Telegram, etc.)
    if (role === 'user' && eventState === 'final' && content) {
        // Check if we already have this message (to avoid duplicates from our own sends)
        const isDuplicate = state.chat.messages.some(m =>
            m.from === 'user' && m.text === content && (Date.now() - m.time) < 5000
        );
        if (!isDuplicate) {
            addLocalChatMessage(content, 'user');
        }
        return;
    }

    // Handle assistant messages
    switch (eventState) {
        case 'start':
        case 'thinking':
            // AI has started processing - show typing indicator
            isProcessing = true;
            streamingText = '';  // Clear any stale streaming text
            renderChat();
            renderChatPage();
            break;
            
        case 'delta':
            // Streaming response - content is cumulative, so REPLACE not append
            // Safety: If we have significant streaming content and new content is much shorter,
            // this might be a new response starting. Finalize the old one first.
            if (streamingText && streamingText.length > 100 && content.length < streamingText.length * 0.5) {
                addLocalChatMessage(streamingText, 'solobot');
            }
            
            streamingText = content;
            isProcessing = true;
            renderChat();
            renderChatPage();
            break;

        case 'final':
            // Final response from assistant
            // Prefer streamingText if available for consistency (avoid content mismatch)
            const finalContent = streamingText || content;
            if (finalContent && role !== 'user') {
                // Check for duplicate - same content within 10 seconds
                const isDuplicate = state.chat.messages.some(m =>
                    m.from === 'solobot' && m.text === finalContent && (Date.now() - m.time) < 10000
                );
                if (!isDuplicate) {
                    addLocalChatMessage(finalContent, 'solobot', window._lastResponseModel);
                }
            }
            streamingText = '';
            isProcessing = false;
            lastProcessingEndTime = Date.now();
            // Schedule a history refresh (guarded, won't spam)
            setTimeout(_doHistoryRefresh, 2000);
            renderChat();
            renderChatPage();
            break;

        case 'error':
            addLocalChatMessage(`Error: ${errorMessage || 'Unknown error'}`, 'system');
            streamingText = '';
            isProcessing = false;
            lastProcessingEndTime = Date.now();
            renderChat();
            renderChatPage();
            break;
    }
}

function loadHistoryMessages(messages) {
    // Removed verbose log - called frequently on history sync
    // Convert gateway history format and classify as chat vs system
    // IMPORTANT: Preserve ALL local messages since Gateway doesn't save user messages (bug #5735)
    const allLocalChatMessages = state.chat.messages.filter(m => m.id.startsWith('m'));

    const chatMessages = [];
    const systemMessages = [];

    const extractContent = (container) => {
        if (!container) return { text: '', images: [] };
        let text = '';
        let images = [];
        
        if (Array.isArray(container.content)) {
            for (const part of container.content) {
                if (part.type === 'text') {
                    text += part.text || '';
                } else if (part.type === 'input_text') {
                    text += part.text || part.input_text || '';
                } else if (part.type === 'image') {
                    // Image attachment - reconstruct data URI
                    if (part.content && part.mimeType) {
                        images.push(`data:${part.mimeType};base64,${part.content}`);
                    } else if (part.source?.data) {
                        // Alternative format: source.data with media_type
                        const mimeType = part.source.media_type || 'image/jpeg';
                        images.push(`data:${mimeType};base64,${part.source.data}`);
                    } else if (part.data) {
                        // Direct data field
                        images.push(`data:image/jpeg;base64,${part.data}`);
                    }
                } else if (part.type === 'image_url' && part.image_url?.url) {
                    // OpenAI-style image_url format
                    images.push(part.image_url.url);
                }
            }
        } else if (typeof container.content === 'string') {
            text = container.content;
        }
        
        // Check for attachments array (our send format)
        if (Array.isArray(container.attachments)) {
            for (const att of container.attachments) {
                if (att.type === 'image' && att.content && att.mimeType) {
                    images.push(`data:${att.mimeType};base64,${att.content}`);
                }
            }
        }
        
        if (!text && typeof container.text === 'string') text = container.text;
        return { text: (text || '').trim(), images };
    };

    messages.forEach(msg => {
        // Skip tool results and tool calls - only show actual text responses
        if (msg.role === 'toolResult' || msg.role === 'tool') {
            return;
        }
        
        let content = extractContent(msg);
        if (!content.text && !content.images.length && msg.message) {
            content = extractContent(msg.message);
        }

        const message = {
            id: msg.id || 'm' + Date.now() + Math.random(),
            from: msg.role === 'user' ? 'user' : 'solobot',
            text: content.text,
            image: content.images[0] || null, // First image as thumbnail
            images: content.images, // All images
            time: msg.timestamp || Date.now()
        };

        // Classify and route
        if (isSystemMessage(textContent, message.from)) {
            systemMessages.push(message);
        } else {
            chatMessages.push(message);
        }
    });

    // Merge chat: combine gateway history with ALL local messages
    // Dedupe by ID first, then by exact text match (not snippet) to be safer
    const historyIds = new Set(chatMessages.map(m => m.id));
    const historyExactTexts = new Set(chatMessages.map(m => m.text));
    const uniqueLocalMessages = allLocalChatMessages.filter(m => {
        // Keep local message if: different ID AND different exact text
        return !historyIds.has(m.id) && !historyExactTexts.has(m.text);
    });

    state.chat.messages = [...chatMessages, ...uniqueLocalMessages];
    console.log(`[Dashboard] Set ${state.chat.messages.length} chat messages (${chatMessages.length} from history, ${uniqueLocalMessages.length} local)`);

    // Sort chat by time and trim
    state.chat.messages.sort((a, b) => a.time - b.time);
    if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
        state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
    }

    // Merge system messages with existing (they're local noise, but good to show from history too)
    state.system.messages = [...state.system.messages, ...systemMessages];
    state.system.messages.sort((a, b) => a.time - b.time);
    if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
        state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
    }

    // Persist both system and chat messages locally (workaround for Gateway bug #5735)
    persistSystemMessages();
    persistChatMessages();

    renderChat();
    renderChatPage();
    renderSystemPage();
}

// Shared refresh function (one instance, never duplicated)
let _historyRefreshFn = null;
let _historyVisibilityFn = null;
let _historyRefreshInFlight = false;
let _lastHistoryLoadTime = 0;
const HISTORY_MIN_INTERVAL = 2000; // Minimum 2 seconds between loads

function _doHistoryRefresh() {
    if (!gateway || !gateway.isConnected() || isProcessing) return;
    if (Date.now() - lastProcessingEndTime < 1500) return;
    if (_historyRefreshInFlight) return; // Prevent overlapping calls
    if (Date.now() - _lastHistoryLoadTime < HISTORY_MIN_INTERVAL) return; // Rate limit
    _historyRefreshInFlight = true;
    _lastHistoryLoadTime = Date.now();
    const pollVersion = sessionVersion;
    gateway.loadHistory().then(result => {
        _historyRefreshInFlight = false;
        if (pollVersion !== sessionVersion) return;
        if (result?.messages) mergeHistoryMessages(result.messages);
    }).catch(() => { _historyRefreshInFlight = false; });
}

function startHistoryPolling() {
    stopHistoryPolling(); // Clear any existing interval + listeners

    // Poll every 3 seconds to catch user messages from other clients
    historyPollInterval = setInterval(_doHistoryRefresh, 3000);

    // Only add focus/visibility listeners ONCE (remove old ones first)
    if (!_historyRefreshFn) {
        _historyRefreshFn = _doHistoryRefresh;
        _historyVisibilityFn = () => {
            if (document.visibilityState === 'visible') _doHistoryRefresh();
        };
        window.addEventListener('focus', _historyRefreshFn);
        document.addEventListener('visibilitychange', _historyVisibilityFn);
    }
}

function stopHistoryPolling() {
    if (historyPollInterval) {
        clearInterval(historyPollInterval);
        historyPollInterval = null;
    }
    // Clean up event listeners
    if (_historyRefreshFn) {
        window.removeEventListener('focus', _historyRefreshFn);
        document.removeEventListener('visibilitychange', _historyVisibilityFn);
        _historyRefreshFn = null;
        _historyVisibilityFn = null;
    }
}

function mergeHistoryMessages(messages) {
    // Removed verbose log - called on every history poll
    // Merge new messages from history without duplicates, classify as chat vs system
    // This catches user messages from other clients that weren't broadcast as events
    const existingIds = new Set(state.chat.messages.map(m => m.id));
    const existingSystemIds = new Set(state.system.messages.map(m => m.id));
    // Also track existing text content to prevent duplicates when IDs differ
    // (local messages use 'm' + Date.now(), history messages have server IDs)
    const existingTexts = new Set(state.chat.messages.map(m => m.text));
    const existingSystemTexts = new Set(state.system.messages.map(m => m.text));
    let newChatCount = 0;
    let newSystemCount = 0;

    const extractContentText = (container) => {
        if (!container) return '';
        let text = '';
        if (Array.isArray(container.content)) {
            for (const part of container.content) {
                if (part.type === 'text') text += part.text || '';
                if (part.type === 'input_text') text += part.text || part.input_text || '';
            }
        } else if (typeof container.content === 'string') {
            text = container.content;
        }
        if (!text && typeof container.text === 'string') text = container.text;
        return (text || '').trim();
    };

    for (const msg of messages) {
        const msgId = msg.id || 'm' + msg.timestamp;

        // Skip if already exists in either array (by ID)
        if (existingIds.has(msgId) || existingSystemIds.has(msgId)) {
            continue;
        }
        
        // Skip tool results and tool calls - only show actual text responses
        if (msg.role === 'toolResult' || msg.role === 'tool') {
            continue;
        }

        {
            let textContent = extractContentText(msg);
            if (!textContent && msg.message) {
                textContent = extractContentText(msg.message);
            }

            // Only add if we have content and it's not a duplicate by text
            if (textContent) {
                const isSystemMsg = isSystemMessage(textContent, msg.role === 'user' ? 'user' : 'solobot');

                // Skip if we already have this exact text content (prevents duplicates when IDs differ)
                if (isSystemMsg && existingSystemTexts.has(textContent)) {
                    continue;
                }
                if (!isSystemMsg && existingTexts.has(textContent)) {
                    continue;
                }

                const message = {
                    id: msgId,
                    from: msg.role === 'user' ? 'user' : 'solobot',
                    text: textContent,
                    time: msg.timestamp || Date.now()
                };

                // Classify and route
                if (isSystemMsg) {
                    state.system.messages.push(message);
                    existingSystemTexts.add(textContent);
                    newSystemCount++;
                } else {
                    state.chat.messages.push(message);
                    existingIds.add(msgId);
                    existingTexts.add(textContent);
                    newChatCount++;
                }
            }
        }
    }

    if (newChatCount > 0 || newSystemCount > 0) {
        // Sort and trim chat
        state.chat.messages.sort((a, b) => a.time - b.time);
        if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Sort and trim system
        state.system.messages.sort((a, b) => a.time - b.time);
        if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Persist system messages (chat comes from Gateway)
        persistSystemMessages();

        // Don't re-render if user has text selected (would destroy their selection)
        const selection = window.getSelection();
        const hasSelection = selection && selection.toString().trim().length > 0;
        if (!hasSelection) {
            renderChat();
            renderChatPage();
            renderSystemPage();
        } else {
            // Defer render until selection is cleared
            console.log('[Dashboard] Deferring render — text is selected');
            if (!window._pendingRender) {
                window._pendingRender = true;
                const checkSelection = () => {
                    const sel = window.getSelection();
                    if (!sel || sel.toString().trim().length === 0) {
                        window._pendingRender = false;
                        renderChat();
                        renderChatPage();
                        renderSystemPage();
                    } else {
                        requestAnimationFrame(checkSelection);
                    }
                };
                requestAnimationFrame(checkSelection);
            }
        }
    }
}

// ===================
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();

    // Log summary after state is loaded
    const provider = localStorage.getItem('selected_provider') || 'anthropic';
    const model = localStorage.getItem('selected_model') || 'claude-3-opus';
    console.log(`[Dashboard] Ready - Provider: ${provider}, Model: ${model}`);
    
    // Load gateway settings from server state if localStorage is empty
    loadGatewaySettingsFromServer();
    
    // Request browser notification permission
    requestNotificationPermission();
    
    render({ includeSystem: true }); // Initial render includes system page
    updateLastSync();

    // Initialize chat input behavior
    setupChatPageInput();

    // Initialize sidebar agent shortcuts
    setupSidebarAgents();
    
    // Initialize agent name display based on current session
    const agentNameEl = document.getElementById('chat-page-agent-name');
    if (agentNameEl) {
        agentNameEl.textContent = getAgentLabel(currentAgentId);
    }

    // Initialize Gateway client
    initGateway();

    // Initialize voice input
    initVoiceInput();
    initPushToTalk();
    updateVoiceAutoSendUI();

    // Populate saved gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 443;
    if (tokenEl) tokenEl.value = GATEWAY_CONFIG.token || '';
    if (sessionEl) sessionEl.value = GATEWAY_CONFIG.sessionKey || 'main';

    // Check URL for session parameter (?session=agent:main:subagent:abc123)
    const urlSession = checkUrlSessionParam();
    if (urlSession) {
        GATEWAY_CONFIG.sessionKey = urlSession;
        currentSessionName = urlSession;
        if (sessionEl) sessionEl.value = urlSession;
        
        // Extract agent ID from session key for sidebar highlighting
        const agentMatch = urlSession.match(/^agent:([^:]+):/);
        if (agentMatch) {
            currentAgentId = agentMatch[1];
        }
        
        // If it's a subagent session, try to determine the target agent from the label
        // We'll do this after sessions are fetched
        
        // Clear URL parameter to avoid re-loading on refresh
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
        
        console.log(`[Dashboard] Will connect to session from URL: ${urlSession}`);
    }

    // Auto-connect if we have saved host
    if (GATEWAY_CONFIG.host) {
        setTimeout(() => connectToGateway(), 500);
    }

    // Auto-refresh dashboard state from VPS (for tasks, notes, etc. - NOT chat)
    setInterval(async () => {
        // Skip auto-refresh while task modal is open (prevents race condition with unsaved changes)
        if (taskModalOpen) {
            return;
        }
        try {
            await loadState();
            // Don't overwrite chat - that comes from Gateway now
            render();
            updateLastSync();

            // Flash sync indicator
            const syncEl = document.getElementById('last-sync');
            if (syncEl) {
                syncEl.style.color = '#22d3ee';
                setTimeout(() => syncEl.style.color = '', 300);
            }
        } catch (e) {
            console.error('Auto-refresh error:', e);
        }
    }, 10000); // Slower refresh since chat is real-time now
    
    // Enter key handlers
    document.getElementById('note-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addNote();
    });
    
    document.getElementById('new-task-title').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitTask();
    });
    
    // Docs search
    const docsSearch = document.getElementById('docs-search'); if (docsSearch) docsSearch.addEventListener('input', (e) => {
        renderDocs(e.target.value);
    });
    
    attachChatInputHandlers();
    
    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.task-menu') && !e.target.closest('.task-menu-btn')) {
            closeAllTaskMenus();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAddTask();
            closeAllTaskMenus();
            closeActionModal();
            closeEditTitleModal();
            closeDeleteModal();
            clearSelection();
        }
        if (e.ctrlKey && e.key === 'a' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            selectAllTasks();
        }
    });
    
    // Enter key for edit title modal
    document.getElementById('edit-title-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveEditedTitle();
    });
    
    // Drag and drop for images on chat page
    setupChatDragDrop();
});

// Set up drag and drop for chat page
function setupChatDragDrop() {
    const chatWrapper = document.querySelector('.chat-page-wrapper');
    if (!chatWrapper) return;
    
    // Prevent default drag behaviors on the whole page
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        chatWrapper.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });
    
    // Highlight drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
        chatWrapper.addEventListener(eventName, () => {
            chatWrapper.classList.add('drag-over');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        chatWrapper.addEventListener(eventName, () => {
            chatWrapper.classList.remove('drag-over');
        }, false);
    });
    
    // Handle drop
    chatWrapper.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                processChatPageImageFile(file);
            }
        }
    }, false);
}

// ===================
// DATA PERSISTENCE
// ===================

async function loadState() {
    // Preserve current messages and logs
    const currentChat = state.chat;
    const currentSystem = state.system;
    const currentConsole = state.console;

    // Count tasks helper
    const countTasks = (s) => {
        if (!s || !s.tasks) return 0;
        const t = s.tasks;
        return (t.todo?.length || 0) + (t.progress?.length || 0) + (t.done?.length || 0);
    };

    // Load localStorage tasks as a safety net (in case server state is empty)
    let localTasks = null;
    try {
        const localSaved = localStorage.getItem('solovision-dashboard');
        if (localSaved) {
            const parsed = JSON.parse(localSaved);
            if (parsed.tasks && countTasks(parsed) > 0) {
                localTasks = JSON.parse(JSON.stringify(parsed.tasks));
            }
        }
    } catch (e) { /* ignore */ }

    // Also check in-memory tasks
    if (!localTasks && countTasks(state) > 0) {
        localTasks = JSON.parse(JSON.stringify(state.tasks));
    }

    // Load from VPS
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            if (!vpsState.tasks) vpsState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!vpsState.tasks.archive) vpsState.tasks.archive = [];

            delete vpsState.pendingChat;
            delete vpsState.chat;

            // BULLETPROOF PROTECTION: Always keep whichever has MORE data
            const serverTaskCount = countTasks(vpsState);
            const localTaskCount = localTasks ? countTasks({ tasks: localTasks }) : 0;
            const serverActivityCount = Array.isArray(vpsState.activity) ? vpsState.activity.length : 0;
            const localActivityCount = Array.isArray(state.activity) ? state.activity.length : 0;

            // Use whichever has more tasks
            const tasksToUse = (localTaskCount > serverTaskCount && localTasks) ? localTasks : vpsState.tasks;
            // Use whichever has more activity
            const activityToUse = (localActivityCount > serverActivityCount) ? state.activity : vpsState.activity;

            if (localTaskCount > serverTaskCount && localTasks) {
                console.warn(`[loadState] Preserving local tasks (${localTaskCount}) over server (${serverTaskCount})`);
            }
            if (localActivityCount > serverActivityCount) {
                console.warn(`[loadState] Preserving local activity (${localActivityCount}) over server (${serverActivityCount})`);
            }

            state = {
                ...state,
                ...vpsState,
                tasks: tasksToUse,
                activity: activityToUse || [],
                chat: currentChat,
                system: currentSystem,
                console: currentConsole
            };

            // If local had more data, push it back to server
            if (localTaskCount > serverTaskCount || localActivityCount > serverActivityCount) {
                const pushData = {};
                if (localTaskCount > serverTaskCount) pushData.tasks = tasksToUse;
                if (localActivityCount > serverActivityCount) pushData.activity = activityToUse;
                fetch('/api/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pushData)
                }).then(() => console.log('[loadState] Pushed preserved data back to server'))
                  .catch(() => {});
            }
            delete state.localModified;
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            return;
        }
    } catch (e) {
        // VPS not available, will use localStorage fallback
    }

    // Fallback: localStorage
    const localSaved = localStorage.getItem('solovision-dashboard');
    if (localSaved) {
        const parsed = JSON.parse(localSaved);
        delete parsed.system;
        delete parsed.console;
        state = { ...state, ...parsed, chat: currentChat, system: currentSystem, console: currentConsole };
    } else {
        initSampleData();
    }
}

const SYNC_API = '/api/sync';

async function saveState(changeDescription = null) {
    state.localModified = Date.now();
    if (changeDescription) {
        state.lastChange = changeDescription;
    }
    
    // Create a trimmed copy for localStorage (limit messages to prevent quota exceeded)
    try {
        const stateForStorage = JSON.parse(JSON.stringify(state));
        // Limit chat messages to last 50 to save space
        if (stateForStorage.chat && stateForStorage.chat.messages) {
            stateForStorage.chat.messages = stateForStorage.chat.messages.slice(-50);
        }
        // Keep more console logs for review (last 500)
        if (stateForStorage.console && stateForStorage.console.logs) {
            stateForStorage.console.logs = stateForStorage.console.logs.slice(-500);
        }
        // Keep more activity for review (last 200)
        if (stateForStorage.activity) {
            stateForStorage.activity = stateForStorage.activity.slice(-200);
        }
        localStorage.setItem('solovision-dashboard', JSON.stringify(stateForStorage));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn('[Dashboard] localStorage full, clearing old data...');
            // Clear and try again with minimal data
            localStorage.removeItem('solovision-dashboard');
            localStorage.removeItem('solobot-chat');
            localStorage.removeItem('solobot-system-messages');
        } else {
            console.error('[Dashboard] saveState error:', e);
        }
    }
    updateLastSync();
    
    // Sync to server
    await syncToServer();
}

async function syncToServer() {
    try {
        // PROTECTION: Fetch server state first and never send fewer tasks/activity
        let serverTaskCount = 0;
        let serverActivityCount = 0;
        try {
            const checkResp = await fetch('/api/state', { cache: 'no-store' });
            if (checkResp.ok) {
                const serverState = await checkResp.json();
                const st = serverState.tasks || {};
                serverTaskCount = (st.todo?.length || 0) + (st.progress?.length || 0) + (st.done?.length || 0);
                serverActivityCount = Array.isArray(serverState.activity) ? serverState.activity.length : 0;
            }
        } catch (e) { /* continue with sync */ }

        // Build sync payload — exclude tasks/activity if we'd wipe server data
        const syncPayload = JSON.parse(JSON.stringify(state));

        const localTaskCount = (state.tasks?.todo?.length || 0) + (state.tasks?.progress?.length || 0) + (state.tasks?.done?.length || 0);
        const localActivityCount = Array.isArray(state.activity) ? state.activity.length : 0;

        if (serverTaskCount > 0 && localTaskCount < serverTaskCount) {
            console.warn(`[Sync] Skipping tasks — server has ${serverTaskCount}, local has ${localTaskCount}`);
            delete syncPayload.tasks;
        }
        if (serverActivityCount > 0 && localActivityCount < serverActivityCount) {
            console.warn(`[Sync] Skipping activity — server has ${serverActivityCount}, local has ${localActivityCount}`);
            delete syncPayload.activity;
        }

        // Don't sync transient local-only data
        delete syncPayload.chat;
        delete syncPayload.system;
        delete syncPayload.console;

        const response = await fetch(SYNC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(syncPayload)
        });
        
        if (response.ok) {
            const result = await response.json();
            if (result.protected?.tasks || result.protected?.activity) {
                console.log('[Sync] Server protected data:', result.protected);
            }
            if (state.console && state.console.logs) {
                state.console.logs.push({
                    text: 'State synced to server',
                    type: 'info',
                    time: Date.now()
                });
                if (state.console.logs.length > 500) {
                    state.console.logs = state.console.logs.slice(-500);
                }
                renderConsole();
            }
        }
    } catch (err) {
        console.error('Sync error:', err);
    }
}

function initSampleData() {
    state.tasks = {
        todo: [],
        progress: [],
        done: [],
        archive: []
    };
    state.notes = [];
    state.activity = [];
    state.docs = [];
    // Don't initialize chat - it's managed by Gateway WebSocket
    saveState();
}

// ===================
// CHAT FUNCTIONS (Gateway WebSocket)
// ===================

// ===================
// VOICE INPUT (Web Speech API)
// ===================

let voiceRecognition = null;
let voiceInputState = 'idle'; // idle, listening, processing
let voiceAutoSend = localStorage.getItem('voice_auto_send') === 'true'; // Auto-send after speech
let voicePushToTalk = false; // Track if currently in push-to-talk mode
let lastVoiceTranscript = ''; // Store last transcript for auto-send

// Live transcript indicator functions (disabled - transcript shows directly in input field)
function showLiveTranscriptIndicator() { }
function hideLiveTranscriptIndicator() { }
function updateLiveTranscriptIndicator(text, isInterim) { }

function initVoiceInput() {
    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    // Update both voice buttons
    const btns = [
        document.getElementById('voice-input-btn'),
        document.getElementById('voice-input-btn-chatpage')
    ];
    
    if (!SpeechRecognition) {
        for (const btn of btns) {
            if (btn) {
                btn.disabled = true;
                btn.title = 'Voice input not supported in this browser';
                btn.innerHTML = '<span class="voice-unsupported">🎤✗</span>';
            }
        }
        console.log('[Voice] Web Speech API not supported');
        return;
    }
    
    if (btns.every(b => !b)) return;

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true; // Keep listening until manually stopped
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
        console.log('[Voice] Started listening, target input:', activeVoiceTarget);
        lastVoiceTranscript = ''; // Reset transcript
        setVoiceState('listening');
        
        // Show live transcript indicator
        showLiveTranscriptIndicator();
        
        // Focus the target input
        const input = document.getElementById(activeVoiceTarget);
        if (input) {
            input.focus();
            input.placeholder = 'Listening... (speak now)';
        }
    };
    
    voiceRecognition.onaudiostart = () => {
        console.log('[Voice] Audio capture started - microphone is working');
    };
    
    voiceRecognition.onsoundstart = () => {
        console.log('[Voice] Sound detected');
    };
    
    voiceRecognition.onspeechstart = () => {
        console.log('[Voice] Speech detected - processing...');
        const input = document.getElementById(activeVoiceTarget);
        if (input) {
            input.placeholder = 'Hearing you...';
        }
    };

    voiceRecognition.onresult = (event) => {
        console.log('[Voice] onresult fired, resultIndex:', event.resultIndex, 'results.length:', event.results.length, 'target:', activeVoiceTarget);
        const input = document.getElementById(activeVoiceTarget);
        if (!input) {
            console.error('[Voice] Input not found:', activeVoiceTarget, '- trying fallback');
            // Fallback: try both inputs
            const fallback = document.getElementById('chat-page-input') || document.getElementById('chat-input');
            if (!fallback) {
                console.error('[Voice] No input found at all!');
                return;
            }
            console.log('[Voice] Using fallback input:', fallback.id);
        }
        const targetInput = input || document.getElementById('chat-page-input') || document.getElementById('chat-input');
        console.log('[Voice] Updating input element:', targetInput?.id, targetInput?.tagName);

        let interimTranscript = '';
        let finalTranscript = '';

        // Process all results
        for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            const confidence = result[0].confidence;
            console.log(`[Voice] Result[${i}]: isFinal=${result.isFinal}, confidence=${confidence?.toFixed(2) || 'n/a'}, text="${transcript}"`);
            if (result.isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Combine: show final + interim (interim in progress)
        const displayText = finalTranscript + interimTranscript;
        console.log('[Voice] Display text:', displayText, '(final:', finalTranscript.length, 'interim:', interimTranscript.length, ')');

        // Update live transcript indicator (banner)
        updateLiveTranscriptIndicator(displayText, !!interimTranscript);

        // Always update the input with current text (even if empty during pauses)
        console.log('[Voice] Setting targetInput.value to:', displayText);
        targetInput.value = displayText;
        
        // Style based on whether we have final or interim
        if (interimTranscript) {
            // Has interim - show as in-progress with subtle indicator
            targetInput.style.fontStyle = 'italic';
            targetInput.style.color = 'var(--text-secondary)';
        } else if (finalTranscript) {
            // Only final content - solid style
            targetInput.style.fontStyle = 'normal';
            targetInput.style.color = 'var(--text-primary)';
        }
        
        // Trigger input event to handle auto-resize and any listeners
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Keep input focused and cursor at end
        targetInput.focus();
        if (targetInput.setSelectionRange) {
            targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length);
        }

        // Store final transcript for auto-send
        if (finalTranscript) {
            lastVoiceTranscript = finalTranscript;
            console.log('[Voice] Final transcript stored:', finalTranscript);
        }
    };

    voiceRecognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error, event.message || '');
        
        if (event.error === 'not-allowed') {
            setVoiceState('idle');
            showToast('Microphone access denied. Click the lock icon in your browser address bar to allow.', 'error');
        } else if (event.error === 'no-speech') {
            // Don't stop on no-speech if continuous mode - just keep listening
            console.log('[Voice] No speech detected yet, still listening...');
            // Only show toast if we're ending
            if (!voiceRecognition || voiceInputState !== 'listening') {
                showToast('No speech detected. Make sure your microphone is working.', 'info');
            }
        } else if (event.error === 'audio-capture') {
            setVoiceState('idle');
            showToast('No microphone found. Please connect a microphone and try again.', 'error');
        } else if (event.error === 'network') {
            setVoiceState('idle');
            showToast('Network error. Speech recognition requires internet connection.', 'error');
        } else if (event.error !== 'aborted') {
            setVoiceState('idle');
            showToast(`Voice error: ${event.error}`, 'error');
        }
    };

    voiceRecognition.onend = () => {
        console.log('[Voice] Ended, last transcript:', lastVoiceTranscript);
        // Note: hideLiveTranscriptIndicator is called by setVoiceState('idle') below
        
        // Reset styling on both inputs
        for (const inputId of ['chat-input', 'chat-page-input']) {
            const input = document.getElementById(inputId);
            if (input) {
                input.style.fontStyle = 'normal';
                input.style.color = 'var(--text-primary)';
                // Reset placeholder
                if (inputId === 'chat-input') {
                    input.placeholder = 'Type a message...';
                } else {
                    input.placeholder = 'Message SoLoBot...';
                }
            }
        }
        
        // Auto-send if enabled and we have a transcript
        if (voiceAutoSend && lastVoiceTranscript.trim()) {
            console.log('[Voice] Auto-sending:', lastVoiceTranscript);
            // Determine which send function to use based on target
            if (activeVoiceTarget === 'chat-page-input') {
                sendChatPageMessage();
            } else {
                sendChatMessage();
            }
            lastVoiceTranscript = '';
        }
        
        setVoiceState('idle');
        voicePushToTalk = false;
        activeVoiceTarget = 'chat-input'; // Reset target
    };

    console.log('[Voice] Initialized successfully');
}

function toggleVoiceInput() {
    if (!voiceRecognition) {
        showToast('Voice input not available', 'error');
        return;
    }

    if (voiceInputState === 'listening') {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
}

function startVoiceInput() {
    if (!voiceRecognition) return;
    
    try {
        voiceRecognition.start();
        console.log('[Voice] Starting...');
    } catch (e) {
        console.error('[Voice] Start error:', e);
        // May already be running
        if (e.message.includes('already started')) {
            stopVoiceInput();
        }
    }
}

function stopVoiceInput() {
    if (!voiceRecognition) return;
    
    try {
        voiceRecognition.stop();
        console.log('[Voice] Stopping...');
    } catch (e) {
        console.error('[Voice] Stop error:', e);
    }
}

function setVoiceState(state, targetInput = 'chat-input') {
    voiceInputState = state;
    
    // Hide live transcript indicator when going idle
    if (state === 'idle') {
        hideLiveTranscriptIndicator();
    }
    
    // Update both buttons to stay in sync
    const btns = [
        { btn: document.getElementById('voice-input-btn'), mic: document.getElementById('voice-icon-mic'), stop: document.getElementById('voice-icon-stop') },
        { btn: document.getElementById('voice-input-btn-chatpage'), mic: document.getElementById('voice-icon-mic-chatpage'), stop: document.getElementById('voice-icon-stop-chatpage') }
    ];
    
    for (const { btn, mic, stop } of btns) {
        if (!btn) continue;
        
        btn.classList.remove('listening', 'processing');
        
        switch (state) {
            case 'listening':
                btn.classList.add('listening');
                btn.title = 'Listening... (click to stop)';
                if (mic) mic.style.display = 'none';
                if (stop) stop.style.display = 'block';
                break;
            case 'processing':
                btn.classList.add('processing');
                btn.title = 'Processing...';
                break;
            default: // idle
                btn.title = 'Voice input (click to speak)';
                if (mic) mic.style.display = 'block';
                if (stop) stop.style.display = 'none';
                break;
        }
    }
}

// Active voice target tracks which input field is receiving voice
let activeVoiceTarget = 'chat-input';

function toggleVoiceInputChatPage() {
    activeVoiceTarget = 'chat-page-input';
    toggleVoiceInput();
}

// Override the original toggleVoiceInput to use the sidebar input
const originalToggleVoiceInput = toggleVoiceInput;
function toggleVoiceInput() {
    // If called directly (not via chat page), target sidebar
    // Only set to chat-input if we're starting a NEW recording
    if (activeVoiceTarget !== 'chat-page-input' && voiceInputState !== 'listening') {
        activeVoiceTarget = 'chat-input';
    }
    
    if (!voiceRecognition) {
        showToast('Voice input not available', 'error');
        return;
    }

    if (voiceInputState === 'listening') {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
    
    // Don't reset target here - it should persist until onend resets it
}

// Toggle auto-send setting
function toggleVoiceAutoSend() {
    voiceAutoSend = !voiceAutoSend;
    localStorage.setItem('voice_auto_send', voiceAutoSend);
    updateVoiceAutoSendUI();
    showToast(voiceAutoSend ? 'Voice auto-send enabled' : 'Voice auto-send disabled', 'info');
}

function updateVoiceAutoSendUI() {
    const toggles = document.querySelectorAll('.voice-auto-send-toggle');
    toggles.forEach(toggle => {
        toggle.classList.toggle('active', voiceAutoSend);
        toggle.title = voiceAutoSend ? 'Auto-send ON (click to disable)' : 'Auto-send OFF (click to enable)';
    });
}

// Push-to-talk: Hold Alt+Space to speak
function initPushToTalk() {
    document.addEventListener('keydown', (e) => {
        // Trigger on Alt+Space (works even in input fields)
        if (e.code === 'Space' && e.altKey && !voicePushToTalk && voiceInputState !== 'listening') {
            e.preventDefault();
            voicePushToTalk = true;
            
            // Determine which input to target based on current page
            const chatPageVisible = document.getElementById('page-chat')?.classList.contains('active');
            activeVoiceTarget = chatPageVisible ? 'chat-page-input' : 'chat-input';
            
            console.log('[Voice] Push-to-talk started (Alt+Space), target:', activeVoiceTarget);
            startVoiceInput();
        }
    });
    
    document.addEventListener('keyup', (e) => {
        // Stop on releasing Space OR releasing Alt while push-to-talk is active
        if ((e.code === 'Space' || e.key === 'Alt') && voicePushToTalk) {
            e.preventDefault();
            console.log('[Voice] Push-to-talk released');
            voicePushToTalk = false;
            stopVoiceInput();
        }
    });
    
    console.log('[Voice] Push-to-talk initialized (hold Alt+Space to speak)');
}

// Check if user is typing in an input field
function isTypingInInput(element) {
    if (!element) return false;
    const tagName = element.tagName.toLowerCase();
    const isEditable = element.isContentEditable;
    const isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    return isInput || isEditable;
}

// ===================
// IMAGE HANDLING
// ===================

// Image handling - supports multiple images
let pendingImages = [];

function handleImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            processImageFile(file);
        }
    }
}

function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) processImageFile(file);
            return;
        }
    }
}

let chatInputSelection = { start: 0, end: 0 };

function handleChatInputKeydown(event) {
    const input = event.target;
    if (event.key !== 'Enter' || !input) return;

    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        sendChatMessage();
        return;
    }

    if (event.shiftKey) {
        event.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const value = input.value;
        const before = value.slice(0, start);
        const after = value.slice(end);
        const newValue = `${before}\n${after}`;
        input.value = newValue;
        const cursor = start + 1;
        input.setSelectionRange(cursor, cursor);
        adjustChatInputHeight(input);
        return;
    }
}

function cacheChatInputSelection(input) {
    if (!input) return;
    chatInputSelection.start = input.selectionStart;
    chatInputSelection.end = input.selectionEnd;
}

function restoreChatInputSelection(input) {
    if (!input) return;
    const length = input.value.length;
    const start = Math.min(chatInputSelection.start ?? length, length);
    const end = Math.min(chatInputSelection.end ?? length, length);
    input.setSelectionRange(start, end);
}

function adjustChatInputHeight(input) {
    if (!input) return;
    input.style.height = 'auto';
    const height = Math.min(input.scrollHeight, 160);
    input.style.height = `${Math.max(height, 36)}px`;
}

function attachChatInputHandlers() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.addEventListener('keydown', handleChatInputKeydown);
    input.addEventListener('blur', () => cacheChatInputSelection(input));
    input.addEventListener('focus', () => {
        restoreChatInputSelection(input);
        adjustChatInputHeight(input);
    });
    input.addEventListener('input', () => adjustChatInputHeight(input));
    adjustChatInputHeight(input);
}

// Compress image to reduce size for WebSocket transmission
async function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Scale down if too large
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to JPEG for better compression (unless PNG transparency needed)
            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
        };
        img.src = dataUrl;
    });
}

function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Compress image if larger than 200KB
        let imageData = e.target.result;
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
        }
        
        pendingImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        });
        renderImagePreviews();
    };
    reader.readAsDataURL(file);
}

function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');
    if (!container) return;
    
    if (pendingImages.length === 0) {
        container.classList.remove('visible');
        container.innerHTML = '';
        return;
    }
    
    container.classList.add('visible');
    container.innerHTML = pendingImages.map((img, idx) => `
        <div class="image-preview-wrapper">
            <img src="${img.data}" alt="Preview ${idx + 1}" />
            <button onclick="removeImagePreview('${img.id}')" class="image-preview-close">✕</button>
        </div>
    `).join('');
}

function removeImagePreview(imgId) {
    pendingImages = pendingImages.filter(img => img.id !== imgId);
    renderImagePreviews();
    if (pendingImages.length === 0) {
        const input = document.getElementById('image-upload');
        if (input) input.value = '';
    }
}

function clearImagePreviews() {
    pendingImages = [];
    renderImagePreviews();
    const input = document.getElementById('image-upload');
    if (input) input.value = '';
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;

    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to Gateway. Please connect first.', 'warning');
        return;
    }

    // Get images to send
    const imagesToSend = [...pendingImages];
    const hasImages = imagesToSend.length > 0;
    
    // Add to local display
    if (hasImages) {
        // Show all images in local preview
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        const imageDataArray = imagesToSend.map(img => img.data);
        addLocalChatMessage(displayText, 'user', imageDataArray);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    clearImagePreviews();
    adjustChatInputHeight(input);
    chatInputSelection = { start: 0, end: 0 };

    // Show typing indicator immediately
    isProcessing = true;
    renderChat();
    renderChatPage();

    // Send via Gateway WebSocket
    try {
        console.log(`[Chat] Sending message with model: ${currentModel}`);
        if (hasImages) {
            // Send with image attachments (send all images)
            const imageDataArray = imagesToSend.map(img => img.data);
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send message:', err);
        addLocalChatMessage(`Failed to send: ${err.message}`, 'system');
    }
}

function addLocalChatMessage(text, from, imageOrModel = null, model = null) {
    if (!state.chat) state.chat = { messages: [] };
    if (!state.system) state.system = { messages: [] };
    
    // Handle multiple parameter signatures:
    // (text, from)
    // (text, from, image) - single image data URI
    // (text, from, images) - array of image data URIs
    // (text, from, model) - model name string
    // (text, from, image, model)
    let images = [];
    let messageModel = model;
    
    if (imageOrModel) {
        if (Array.isArray(imageOrModel)) {
            // Array of images
            images = imageOrModel.filter(img => img && typeof img === 'string' && img.includes('data:'));
        } else if (typeof imageOrModel === 'string') {
            if (imageOrModel.includes('data:image') || imageOrModel.includes('data:application')) {
                // Single image data URI
                images = [imageOrModel];
            } else if (imageOrModel.includes('/') || imageOrModel.includes('claude') || imageOrModel.includes('gpt') || imageOrModel.includes('MiniMax')) {
                // Model name
                messageModel = imageOrModel;
            }
        }
    }
    
    console.log(`[Chat] addLocalChatMessage: text="${text?.slice(0, 50)}", from=${from}, images=${images.length}, model=${messageModel}`);

    const message = {
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now(),
        image: images[0] || null, // Legacy single image field
        images: images, // New array field
        model: messageModel // Store which AI model generated this response
    };

    const isSystem = isSystemMessage(text, from);

    // Route to appropriate message array
    if (isSystem) {
        // System message - goes to system tab (local UI noise)
        state.system.messages.push(message);
        if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }
        persistSystemMessages(); // Persist system messages locally
        renderSystemPage();
    } else {
        // Real chat message - goes to chat tab (synced via Gateway)
        state.chat.messages.push(message);
        if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Notify chat page of new message (for indicator when scrolled up)
        if (from !== 'user' && typeof notifyChatPageNewMessage === 'function') {
            notifyChatPageNewMessage();
        }

        // Persist chat to localStorage (workaround for Gateway bug #5735)
        persistChatMessages();
        
        // Also sync chat to VPS for cross-computer access
        syncChatToVPS();
        
        renderChat();
        renderChatPage();
    }
}

// Debounced sync of chat messages to VPS (so messages persist across computers)
// Note: reuses chatSyncTimeout declared above
function syncChatToVPS() {
    // Debounce - wait 2 seconds after last message before syncing
    if (chatSyncTimeout) clearTimeout(chatSyncTimeout);
    chatSyncTimeout = setTimeout(async () => {
        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: state.chat.messages.slice(-100) })
            });
        } catch (e) {
            // Chat sync failed - not critical
        }
    }, 2000);
}

// ===================
// CHAT RENDERING (Clean rewrite)
// ===================

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) {
        return;
    }
    // Removed verbose log: renderChat called frequently

    const messages = state.chat?.messages || [];
    const isConnected = gateway?.isConnected();

    // Save scroll state BEFORE clearing
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 5;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    // Clear container
    container.innerHTML = '';

    // Show placeholder if no messages
    if (messages.length === 0 && !streamingText) {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-8) 0;';
        placeholder.textContent = isConnected
            ? '💬 Connected! Send a message to start chatting.'
            : '🔌 Connect to Gateway in Settings to start chatting';
        container.appendChild(placeholder);
        return;
    }

    // Render each message (no filtering needed - system messages are in separate array)
    messages.forEach(msg => {
        const msgEl = createChatMessageElement(msg);
        if (msgEl) container.appendChild(msgEl);
    });

    // Render streaming message if active
    if (streamingText) {
        const streamingMsg = createChatMessageElement({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }
    
    // Show typing indicator when processing but no streaming text yet
    if (isProcessing && !streamingText) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">Thinking...</span>
        `;
        container.appendChild(typingIndicator);
    }

    // Auto-scroll if was at bottom, otherwise maintain position
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        // Restore position by maintaining same distance from bottom
        container.scrollTop = container.scrollHeight - container.clientHeight - distanceFromBottom;
    }
}

function createChatMessageElement(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;

    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';

    // Create message container
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = 'var(--space-3)';

    // Create message bubble
    const bubble = document.createElement('div');
    bubble.style.padding = 'var(--space-3)';
    bubble.style.borderRadius = 'var(--radius-md)';
    bubble.style.maxWidth = '85%';
    bubble.style.wordWrap = 'break-word';

    if (isUser) {
        // User message - right aligned, brand red tint
        bubble.style.backgroundColor = 'rgba(188, 32, 38, 0.15)';
        bubble.style.border = '1px solid rgba(188, 32, 38, 0.25)';
        bubble.style.marginLeft = 'auto';
        bubble.style.textAlign = 'right';
    } else if (isSystem) {
        // System message - warning tint
        bubble.style.backgroundColor = 'var(--warning-muted)';
        bubble.style.border = '1px solid rgba(234, 179, 8, 0.2)';
    } else {
        // Bot message - left aligned, surface-2
        bubble.style.backgroundColor = msg.isStreaming ? 'var(--surface-2)' : 'var(--surface-2)';
        bubble.style.border = '1px solid var(--border-default)';
        bubble.style.marginRight = 'auto';
        if (msg.isStreaming) bubble.style.opacity = '0.8';
    }

    // Header with name and time
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = 'var(--space-2)';
    header.style.marginBottom = 'var(--space-2)';
    header.style.fontSize = '12px';
    if (isUser) header.style.justifyContent = 'flex-end';

    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '500';
    if (isUser) {
        nameSpan.style.color = 'var(--brand-red)';
        nameSpan.textContent = 'You';
    } else if (isSystem) {
        nameSpan.style.color = 'var(--warning)';
        nameSpan.textContent = 'System';
    } else {
        nameSpan.style.color = 'var(--success)';
        const displayName = getAgentDisplayName(currentAgentId);
        nameSpan.textContent = msg.isStreaming ? `${displayName} (typing...)` : displayName;
    }
    
    // Model badge for bot messages (shows which AI model generated the response)
    if (!isUser && !isSystem && msg.model) {
        const modelBadge = document.createElement('span');
        modelBadge.style.cssText = 'font-size: 10px; padding: 1px 5px; background: var(--surface-3); border-radius: 3px; color: var(--text-muted); margin-left: 4px;';
        // Show short model name (e.g., 'claude-3-5-sonnet' instead of 'anthropic/claude-3-5-sonnet-latest')
        const shortModel = msg.model.split('/').pop().replace(/-latest$/, '');
        modelBadge.textContent = shortModel;
        modelBadge.title = msg.model; // Full model name on hover
        header.appendChild(modelBadge);
    }

    const timeSpan = document.createElement('span');
    timeSpan.style.color = 'var(--text-muted)';
    timeSpan.textContent = formatTime(msg.time);

    header.appendChild(nameSpan);
    header.appendChild(timeSpan);

    // Message content
    const content = document.createElement('div');
    content.style.fontSize = '14px';
    content.style.color = 'var(--text-primary)';
    content.style.lineHeight = '1.5';
    content.style.whiteSpace = 'pre-wrap';
    content.textContent = msg.text; // Use textContent for safety - no HTML injection

    // Images if present - show thumbnails
    const images = msg.images || (msg.image ? [msg.image] : []);
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '8px';
        imageContainer.style.marginBottom = 'var(--space-2)';
        
        images.forEach((imgSrc, idx) => {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.style.maxWidth = images.length > 1 ? '100px' : '150px';
            img.style.maxHeight = images.length > 1 ? '80px' : '100px';
            img.style.borderRadius = 'var(--radius-md)';
            img.style.cursor = 'pointer';
            img.style.objectFit = 'cover';
            img.style.border = '1px solid var(--border-default)';
            img.title = `Image ${idx + 1} of ${images.length} - Click to view`;
            img.onclick = () => openImageModal(imgSrc);
            imageContainer.appendChild(img);
        });
        
        bubble.appendChild(imageContainer);
    }

    bubble.appendChild(header);
    bubble.appendChild(content);
    wrapper.appendChild(bubble);

    return wrapper;
}

function openImageModal(src) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:1000;cursor:pointer;padding:40px;';
    modal.onclick = () => modal.remove();

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:20px;right:30px;color:white;font-size:28px;cursor:pointer;opacity:0.7;transition:opacity 0.2s;';
    closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.7';
    modal.appendChild(closeBtn);

    // Image container for shadow effect
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'max-width:85vw;max-height:85vh;box-shadow:0 25px 50px rgba(0,0,0,0.5);border-radius:8px;overflow:hidden;';

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'display:block;max-width:85vw;max-height:85vh;object-fit:contain;';
    img.onclick = (e) => e.stopPropagation(); // Don't close when clicking image

    imgContainer.appendChild(img);
    modal.appendChild(imgContainer);

    // Click hint
    const hint = document.createElement('div');
    hint.textContent = 'Click anywhere to close';
    hint.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.5);font-size:12px;';
    modal.appendChild(hint);

    document.body.appendChild(modal);
}


// ===================
// CHAT PAGE FUNCTIONS
// ===================

// Chat page state
let chatPagePendingImages = [];
let chatPageScrollPosition = null;
let chatPageUserScrolled = false;
let chatPageNewMessageCount = 0;

// Save scroll position to sessionStorage
function saveChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (container && container.scrollTop > 0) {
        sessionStorage.setItem('chatScrollPosition', container.scrollTop);
        sessionStorage.setItem('chatScrollHeight', container.scrollHeight);
    }
}

// Restore scroll position from sessionStorage
function restoreChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (!container) return;
    
    const savedPosition = sessionStorage.getItem('chatScrollPosition');
    const savedHeight = sessionStorage.getItem('chatScrollHeight');
    
    if (savedPosition && savedHeight) {
        // Calculate relative position and apply
        const ratio = parseFloat(savedPosition) / parseFloat(savedHeight);
        container.scrollTop = ratio * container.scrollHeight;
    }
}

// Expose scroll functions globally for page navigation
window.saveChatScrollPosition = saveChatScrollPosition;
window.restoreChatScrollPosition = restoreChatScrollPosition;

// Check if user is at the very bottom (strict check for auto-scroll)
function isAtBottom(container) {
    if (!container) return true;
    // Only consider "at bottom" if within 5px - user must be truly at the bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < 5;
}

// Check if user is near the bottom (looser check for indicator hiding)
function isNearBottom(container) {
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// Scroll to bottom
function scrollChatToBottom() {
    const container = document.getElementById('chat-page-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
        chatPageUserScrolled = false;
        chatPageNewMessageCount = 0;
        updateNewMessageIndicator();
    }
}

// Update new message indicator visibility
function updateNewMessageIndicator() {
    const indicator = document.getElementById('chat-page-new-indicator');
    if (!indicator) return;
    
    const container = document.getElementById('chat-page-messages');
    const notAtBottom = container && !isAtBottom(container);
    
    if (notAtBottom && chatPageNewMessageCount > 0) {
        indicator.textContent = `↓ ${chatPageNewMessageCount} new message${chatPageNewMessageCount > 1 ? 's' : ''}`;
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
        if (!notAtBottom) {
            chatPageNewMessageCount = 0; // Reset count when at bottom
        }
    }
}

// Setup scroll listener for chat page
function setupChatPageScrollListener() {
    const container = document.getElementById('chat-page-messages');
    if (!container || container.dataset.scrollListenerAttached) return;
    
    container.addEventListener('scroll', () => {
        // Update indicator based on scroll position
        updateNewMessageIndicator();
        
        // Show/hide floating scroll button
        updateScrollToBottomButton();
        
        // Save position periodically
        saveChatScrollPosition();
    });
    
    container.dataset.scrollListenerAttached = 'true';
}

function updateScrollToBottomButton() {
    const container = document.getElementById('chat-page-messages');
    const btn = document.getElementById('scroll-to-bottom-btn');
    if (!container || !btn) return;
    
    // Show button if scrolled up more than 200px from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 200) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function forceRefreshHistory() {
    // Route through guarded function to prevent spam
    _doHistoryRefresh();
}

function renderChatPage() {
    const container = document.getElementById('chat-page-messages');
    if (!container) {
        return;
    }
    // Removed verbose log: renderChatPage called frequently

    // Setup scroll listener
    setupChatPageScrollListener();

    // Update connection status
    const statusDot = document.getElementById('chat-page-status-dot');
    const statusText = document.getElementById('chat-page-status-text');
    const isConnected = gateway?.isConnected();

    if (statusDot) {
        statusDot.className = `status-dot ${isConnected ? 'success' : 'idle'}`;
    }
    if (statusText) {
        statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
    }

    const messages = state.chat?.messages || [];
    
    // Check if at bottom BEFORE clearing (use strict check to avoid unwanted scrolling)
    const wasAtBottom = isAtBottom(container);
    // Save distance from bottom (how far up the user has scrolled)
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    
    // Clear and re-render
    container.innerHTML = '';
    
    // Show empty state if no messages
    if (messages.length === 0 && !streamingText) {
        const displayName = getAgentDisplayName(currentAgentId);
        container.innerHTML = `
            <div class="chat-page-empty">
                <div class="chat-page-empty-icon">💬</div>
                <div class="chat-page-empty-text">
                    ${isConnected 
                        ? `Start a conversation with ${displayName}` 
                        : 'Connect to Gateway in <a href="#" onclick="openSettingsModal(); return false;">Settings</a> to start chatting'}
                </div>
            </div>
        `;
        return;
    }
    
    // Render messages (no filtering - system messages are in separate array)
    messages.forEach(msg => {
        const msgEl = createChatPageMessage(msg);
        if (msgEl) container.appendChild(msgEl);
    });
    
    // Render streaming message
    if (streamingText) {
        const streamingMsg = createChatPageMessage({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }
    
    // Show typing indicator when processing but no streaming text yet
    if (isProcessing && !streamingText) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.style.cssText = 'margin: 12px 0 12px 12px;';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">Thinking...</span>
        `;
        container.appendChild(typingIndicator);
    }
    
    // Smart scroll behavior - only auto-scroll if user was truly at the bottom
    if (wasAtBottom) {
        // User was at bottom, keep them there
        container.scrollTop = container.scrollHeight;
    } else {
        // Restore position by maintaining same distance from bottom
        // This keeps the user looking at the same messages even as new ones arrive
        container.scrollTop = container.scrollHeight - container.clientHeight - distanceFromBottom;
    }
}

// Create a chat page message element (different styling from widget)
function createChatPageMessage(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;
    
    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';
    const isBot = !isUser && !isSystem;
    
    // Message wrapper
    const wrapper = document.createElement('div');
    wrapper.className = `chat-page-message ${msg.from}${msg.isStreaming ? ' streaming' : ''}`;
    
    // Avatar (for bot and user messages, not system)
    if (!isSystem) {
        const avatar = document.createElement('div');
        avatar.className = 'chat-page-avatar';
        
        if (isUser) {
            // User avatar - initials circle
            avatar.classList.add('user-avatar');
            avatar.textContent = 'U';
        } else {
            // Bot avatar - agent-specific image and color
            const agentId = currentAgentId || 'main';
            avatar.setAttribute('data-agent', agentId);
            
            // Get avatar path (fallback to main for agents without custom avatars)
            const avatarPath = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'family', 'smm'].includes(agentId) 
                ? `/avatars/${agentId === 'main' ? 'solobot' : agentId}.png`
                : (agentId === 'tax' || agentId === 'sec') 
                    ? `/avatars/${agentId}.svg`
                    : '/avatars/solobot.png';
            
            const avatarImg = document.createElement('img');
            avatarImg.src = avatarPath;
            avatarImg.alt = getAgentDisplayName(agentId);
            avatarImg.onerror = () => { avatarImg.style.display = 'none'; avatar.textContent = '🤖'; };
            avatar.appendChild(avatarImg);
        }
        
        wrapper.appendChild(avatar);
    }
    
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'chat-page-bubble';
    
    // Images if present - show thumbnails
    const images = msg.images || (msg.image ? [msg.image] : []);
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '8px';
        imageContainer.style.marginBottom = '8px';
        
        images.forEach((imgSrc, idx) => {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.className = 'chat-page-bubble-image';
            img.style.maxWidth = images.length > 1 ? '100px' : '200px';
            img.style.maxHeight = images.length > 1 ? '100px' : '150px';
            img.style.objectFit = 'cover';
            img.style.cursor = 'pointer';
            img.title = `Image ${idx + 1} of ${images.length} - Click to view`;
            img.onclick = () => openImageModal(imgSrc);
            imageContainer.appendChild(img);
        });
        
        bubble.appendChild(imageContainer);
    }
    
    // Header with sender and time
    const header = document.createElement('div');
    header.className = 'chat-page-bubble-header';
    
    const sender = document.createElement('span');
    sender.className = 'chat-page-sender';
    if (isUser) {
        sender.textContent = 'You';
    } else if (isSystem) {
        sender.textContent = 'System';
    } else {
        const displayName = getAgentDisplayName(currentAgentId);
        sender.textContent = msg.isStreaming ? `${displayName} is typing...` : displayName;
    }
    
    const time = document.createElement('span');
    time.className = 'chat-page-bubble-time';
    time.textContent = formatSmartTime(msg.time);
    time.title = formatTime(msg.time); // Show exact time on hover
    
    header.appendChild(sender);
    header.appendChild(time);
    bubble.appendChild(header);
    
    // Content
    const content = document.createElement('div');
    content.className = 'chat-page-bubble-content';
    content.textContent = msg.text;
    bubble.appendChild(content);
    
    // Action buttons (copy, etc.) - show on hover
    if (!msg.isStreaming) {
        const actions = document.createElement('div');
        actions.className = 'chat-page-bubble-actions';
        
        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'chat-action-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = 'Copy message';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(msg.text);
            copyBtn.innerHTML = '✓';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
                copyBtn.classList.remove('copied');
            }, 1500);
        };
        actions.appendChild(copyBtn);
        
        bubble.appendChild(actions);
    }
    
    wrapper.appendChild(bubble);
    return wrapper;
}

// Copy text to clipboard with feedback
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success', 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Copied to clipboard!', 'success', 2000);
    });
}

// Notify of new message (for indicator)
function notifyChatPageNewMessage() {
    const container = document.getElementById('chat-page-messages');
    // Show indicator if user is NOT at the bottom
    if (container && !isAtBottom(container)) {
        chatPageNewMessageCount++;
        updateNewMessageIndicator();
    }
}

function handleChatPageImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            processChatPageImageFile(file);
        }
    }
}

function handleChatPagePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) processChatPageImageFile(file);
            return;
        }
    }
}

function processChatPageImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Compress image if larger than 200KB
        let imageData = e.target.result;
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
        }
        
        chatPagePendingImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        });
        renderChatPageImagePreviews();
    };
    reader.readAsDataURL(file);
}

function renderChatPageImagePreviews() {
    const container = document.getElementById('chat-page-image-preview');
    if (!container) return;
    
    if (chatPagePendingImages.length === 0) {
        container.classList.add('hidden');
        container.classList.remove('visible');
        container.innerHTML = '';
        return;
    }
    
    container.classList.remove('hidden');
    container.classList.add('visible');
    container.innerHTML = chatPagePendingImages.map((img, idx) => `
        <div class="image-preview-wrapper">
            <img src="${img.data}" alt="Preview ${idx + 1}" />
            <button onclick="removeChatPageImagePreview('${img.id}')" class="image-preview-close">✕</button>
        </div>
    `).join('');
}

function removeChatPageImagePreview(imgId) {
    chatPagePendingImages = chatPagePendingImages.filter(img => img.id !== imgId);
    renderChatPageImagePreviews();
    if (chatPagePendingImages.length === 0) {
        const input = document.getElementById('chat-page-image-upload');
        if (input) input.value = '';
    }
}

function clearChatPageImagePreviews() {
    chatPagePendingImages = [];
    renderChatPageImagePreviews();
    const input = document.getElementById('chat-page-image-upload');
    if (input) input.value = '';
}

function resizeChatPageInput() {
    const input = document.getElementById('chat-page-input');
    if (!input) return;
    input.style.height = 'auto';
    const maxHeight = 150;
    input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
}

function setupChatPageInput() {
    const input = document.getElementById('chat-page-input');
    if (!input) return;

    input.addEventListener('input', resizeChatPageInput);
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.isComposing || e.keyCode === 229) return;
        if (e.shiftKey) return;
        if (!gateway || !gateway.isConnected()) return;
        e.preventDefault();
        sendChatPageMessage();
    });

    resizeChatPageInput();
}

function setActiveSidebarAgent(agentId) {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    agentEls.forEach(el => {
        if (agentId && el.getAttribute('data-agent') === agentId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    // Update currentAgentId and refresh dropdown to show this agent's sessions
    if (agentId) {
        const wasChanged = agentId !== currentAgentId;
        currentAgentId = agentId;
        
        // Update agent name display in chat header
        const agentNameEl = document.getElementById('chat-page-agent-name');
        if (agentNameEl) {
            agentNameEl.textContent = getAgentLabel(agentId);
        }
        
        if (wasChanged) {
            populateSessionDropdown();
        }
    }
}

// Track last-used session per agent (persisted to localStorage)
function getLastAgentSession(agentId) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        return map[agentId] || null;
    } catch { return null; }
}

function saveLastAgentSession(agentId, sessionKey) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        map[agentId] = sessionKey;
        localStorage.setItem('agent_last_sessions', JSON.stringify(map));
    } catch {}
}

function setupSidebarAgents() {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    if (!agentEls.length) return;

    agentEls.forEach(el => {
        el.addEventListener('click', async () => {
            const agentId = el.getAttribute('data-agent');
            if (!agentId) return;
            
            // Update current agent ID first so dropdown filters correctly
            currentAgentId = agentId;
            
            // Restore last session for this agent, or default to main
            const sessionKey = getLastAgentSession(agentId) || `agent:${agentId}:main`;
            showPage('chat');
            await switchToSession(sessionKey);
            setActiveSidebarAgent(agentId);
        });
    });

    const currentSession = GATEWAY_CONFIG?.sessionKey || 'main';
    const match = currentSession.match(/^agent:([^:]+):/);
    if (match) {
        currentAgentId = match[1];
        setActiveSidebarAgent(match[1]);
    }
}

async function sendChatPageMessage() {
    const input = document.getElementById('chat-page-input');
    const text = input.value.trim();
    if (!text && chatPagePendingImages.length === 0) return;
    
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to Gateway. Please connect first in Settings.', 'warning');
        return;
    }
    
    const imagesToSend = [...chatPagePendingImages];
    const hasImages = imagesToSend.length > 0;
    
    if (hasImages) {
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        const imageDataArray = imagesToSend.map(img => img.data);
        addLocalChatMessage(displayText, 'user', imageDataArray);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    resizeChatPageInput();
    input.focus();
    clearChatPageImagePreviews();
    
    // Force scroll to bottom when user sends
    chatPageUserScrolled = false;
    
    // Show typing indicator immediately
    isProcessing = true;
    
    // Render both areas
    renderChat();
    renderChatPage();
    
    // Send via Gateway
    try {
        console.log(`[Chat] Sending message with model: ${currentModel}`);
        if (hasImages) {
            const imageDataArray = imagesToSend.map(img => img.data);
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send:', err);
        addLocalChatMessage(`Failed: ${err.message}`, 'system');
        renderChat();
        renderChatPage();
    }
}

// ===================
// THEMED CONFIRM MODAL (replaces browser confirm)
// ===================

let confirmModalCallback = null;

function showConfirm(title, message, okText = 'OK', cancelText = 'Cancel', isDanger = false) {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('confirm-modal-title');
        const messageEl = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (okBtn) {
            okBtn.textContent = okText;
            okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
        }
        if (cancelBtn) cancelBtn.textContent = cancelText;
        
        confirmModalCallback = resolve;
        showModal('confirm-modal');
    });
}

function closeConfirmModal(result) {
    hideModal('confirm-modal');
    if (confirmModalCallback) {
        confirmModalCallback(result);
        confirmModalCallback = null;
    }
}

// Make globally available
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;

async function clearChatHistory(skipConfirm = false, clearCache = false) {
    if (!skipConfirm) {
        const confirmed = await showConfirm(
            'Clear Chat History',
            'Clear all chat messages? They may reload from Gateway on next sync.',
            'Clear',
            'Cancel',
            true
        );
        if (!confirmed) return;
    }

    state.chat.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;

    // Clear localStorage cache when switching sessions to prevent stale data
    if (clearCache) {
        localStorage.removeItem('solobot-chat-messages');
    }

    renderChat();
    renderChatPage();
}

// ===================
// NEW SESSION MODAL
// ===================

let newSessionModalResolve = null;

window.openNewSessionModal = function(defaultValue) {
    return new Promise((resolve) => {
        newSessionModalResolve = resolve;
        const modal = document.getElementById('new-session-modal');
        const input = document.getElementById('new-session-name-input');
        if (modal && input) {
            input.value = defaultValue || '';
            modal.classList.add('visible');
            // Focus and select all text
            setTimeout(() => {
                input.focus();
                input.select();
            }, 50);
        } else {
            resolve(null);
        }
    });
};

window.closeNewSessionModal = function(value) {
    const modal = document.getElementById('new-session-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
    if (newSessionModalResolve) {
        newSessionModalResolve(value);
        newSessionModalResolve = null;
    }
};

window.submitNewSessionModal = function() {
    const input = document.getElementById('new-session-name-input');
    const value = input ? input.value : null;
    closeNewSessionModal(value);
};

// Handle Enter key in new session modal
document.addEventListener('keydown', function(e) {
    const modal = document.getElementById('new-session-modal');
    if (modal && modal.classList.contains('visible')) {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitNewSessionModal();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeNewSessionModal(null);
        }
    }
});

// Start a new session for a specific agent
window.startNewAgentSession = async function(agentId) {
    // Close dropdown first
    toggleChatPageSessionMenu();
    
    // Generate default name with timestamp: MM/DD/YYYY hh:mm:ss AM/PM
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const defaultTimestamp = `${month}/${day}/${year} ${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
    
    const agentLabel = getAgentLabel(agentId);

    // Open custom modal instead of browser prompt
    const userInput = await openNewSessionModal(defaultTimestamp);
    if (!userInput || !userInput.trim()) return;

    // Always prepend agent ID to the session name (lowercase)
    const sessionName = `${agentId.toLowerCase()}-${userInput.trim()}`;
    
    // Build the full session key: agent:{agentId}:{agentId}-{userInput}
    const sessionKey = `agent:${agentId}:${sessionName}`;

    // Check if session already exists
    if (availableSessions.some(s => s.key === sessionKey)) {
        showToast(`Session "${userInput.trim()}" already exists. Switching to it.`, 'info');
        await switchToSession(sessionKey);
        return;
    }

    showToast(`Creating new ${agentLabel} session "${userInput.trim()}"...`, 'info');

    // Increment session version to invalidate any in-flight history loads
    sessionVersion++;
    console.log(`[Dashboard] Session version now ${sessionVersion} (new agent session)`);

    // Clear local chat and cache
    state.chat.messages = [];
    state.system.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;
    localStorage.removeItem('solobot-chat-messages');

    // Update agent context
    currentAgentId = agentId;

    // Render immediately to show empty chat
    renderChat();
    renderChatPage();

    // Switch gateway to new session
    currentSessionName = sessionKey;
    GATEWAY_CONFIG.sessionKey = sessionKey;
    localStorage.setItem('gateway_session', sessionKey);  // Persist for reload

    // Update session input field
    const sessionInput = document.getElementById('gateway-session');
    if (sessionInput) sessionInput.value = sessionKey;

    // Update session display (show user's input, not the full session name with agent prefix)
    const displayName = userInput.trim();
    const nameEl = document.getElementById('chat-page-session-name');
    if (nameEl) nameEl.textContent = displayName;

    // Disconnect and reconnect with new session key
    if (gateway && gateway.isConnected()) {
        gateway.disconnect();
        await new Promise(resolve => setTimeout(resolve, 300));
        connectToGateway();
    }

    // Add new session to availableSessions locally (gateway won't return it until there's activity)
    const newSession = {
        key: sessionKey,
        name: sessionName,
        displayName: displayName,  // Display without agent prefix for cleaner UI
        updatedAt: Date.now(),
        totalTokens: 0,
        model: currentModel || 'unknown',
        sessionId: null
    };
    
    // Add to beginning of list (most recent)
    availableSessions.unshift(newSession);
    
    // Refresh sessions list from gateway (will merge with our local addition)
    await fetchSessions();
    
    // Ensure our new session is still in the list (in case fetchSessions didn't include it)
    if (!availableSessions.some(s => s.key === sessionKey)) {
        availableSessions.unshift(newSession);
    }
    
    populateSessionDropdown();
    setActiveSidebarAgent(agentId);

    renderChat();
    renderChatPage();
    renderSystemPage();

    showToast(`New ${agentLabel} session "${displayName}" created`, 'success');
}

// Legacy function - creates session for current agent
window.startNewSession = async function() {
    await startNewAgentSession(currentAgentId);
}

// ===================
// SYSTEM PAGE RENDERING
// ===================

function renderSystemPage() {
    const container = document.getElementById('system-page-messages');
    if (!container) return;

    const messages = state.system?.messages || [];

    // Clear and re-render
    container.innerHTML = '';

    // Show empty state if no messages
    if (messages.length === 0) {
        container.innerHTML = `
            <div class="chat-page-empty">
                <div class="chat-page-empty-icon">⚙️</div>
                <div class="chat-page-empty-text">
                    No system messages yet. This tab shows heartbeats, errors, and other system noise.
                </div>
            </div>
        `;
        return;
    }

    // Render messages
    messages.forEach(msg => {
        const msgEl = createSystemMessage(msg);
        if (msgEl) container.appendChild(msgEl);
    });

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function createSystemMessage(msg) {
    if (!msg || typeof msg.text !== 'string') return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'system-message';

    const bubble = document.createElement('div');
    bubble.className = 'system-bubble';

    // Header with time
    const header = document.createElement('div');
    header.className = 'system-bubble-header';

    const sender = document.createElement('span');
    sender.className = 'system-sender';
    sender.textContent = msg.from === 'solobot' ? 'SoLoBot (System)' : 'System';

    const time = document.createElement('span');
    time.className = 'system-bubble-time';
    time.textContent = formatTime(msg.time);

    header.appendChild(sender);
    header.appendChild(time);
    bubble.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'system-bubble-content';
    content.textContent = msg.text;
    bubble.appendChild(content);

    wrapper.appendChild(bubble);
    return wrapper;
}

async function clearSystemHistory() {
    if (await showConfirm('Clear all system messages?', 'Clear History')) {
        state.system.messages = [];
        persistSystemMessages();
        renderSystemPage();
        showToast('System messages cleared', 'success');
    }
}

// RENDERING (OTHER FUNCTIONS REMAIN THE SAME)
// ===================

function render(options = {}) {
    try {
    renderStatus();
    renderConsole();
    renderTasks();
    renderNotes();
    renderActivity();
    renderDocs();
    renderChat();
    renderChatPage();
    // Only render system page on explicit request (not during auto-refresh)
    // System messages are local, not from VPS, so no need to refresh them
    if (options.includeSystem) {
        renderSystemPage();
    }
    renderBulkActionBar();
    updateArchiveBadge();

    // Re-apply scroll containment after rendering
    if (window.setupScrollContainment) {
        window.setupScrollContainment();
    }
    } catch (e) {
        console.error('[render] Error during render:', e);
    }
}

function renderStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const modelEl = document.getElementById('model-name');
    const taskEl = document.getElementById('current-task');
    const taskName = document.getElementById('task-name');
    const subagentBanner = document.getElementById('subagent-banner');
    const subagentTask = document.getElementById('subagent-task');

    // Use design system status-dot classes (with null checks)
    if (indicator) {
        indicator.className = 'status-dot';
        switch(state.status) {
            case 'working':
                indicator.classList.add('success', 'pulse');
                break;
            case 'thinking':
                indicator.classList.add('warning', 'pulse');
                break;
            case 'offline':
                indicator.classList.add('error');
                break;
            default:
                indicator.classList.add('success');
        }
    }
    
    if (text) {
        switch(state.status) {
            case 'working': text.textContent = 'WORKING'; break;
            case 'thinking': text.textContent = 'THINKING'; break;
            case 'offline': text.textContent = 'OFFLINE'; break;
            default: text.textContent = 'IDLE';
        }
    }

    if (modelEl) modelEl.textContent = state.model || 'opus 4.5';

    const providerEl = document.getElementById('provider-name');
    if (providerEl) {
        providerEl.textContent = state.provider || 'anthropic';
    }

    if (state.currentTask) {
        taskEl?.classList.remove('hidden');
        if (taskName) taskName.textContent = state.currentTask;
    } else {
        taskEl?.classList.add('hidden');
    }

    if (state.subagent) {
        subagentBanner?.classList.remove('hidden');
        if (subagentTask) subagentTask.textContent = state.subagent;
    } else {
        subagentBanner?.classList.add('hidden');
    }
}

function renderConsole() {
    const live = state.live || { status: 'idle' };
    const consoleData = state.console || { logs: [] };

    const statusBadge = document.getElementById('console-status-badge');
    if (statusBadge) {
        const statusConfig = {
            'working': { text: 'WORKING', badgeClass: 'badge-success' },
            'thinking': { text: 'THINKING', badgeClass: 'badge-warning' },
            'idle': { text: 'IDLE', badgeClass: 'badge-success' },
            'offline': { text: 'OFFLINE', badgeClass: 'badge-default' }
        };
        const config = statusConfig[live.status] || statusConfig['idle'];
        statusBadge.textContent = config.text;
        statusBadge.className = `badge ${config.badgeClass}`;
    }

    const output = document.getElementById('console-output');
    if (output) {
        if (consoleData.logs && consoleData.logs.length > 0) {
            output.innerHTML = consoleData.logs.map(log => {
                const timeStr = formatTimeShort(log.time);
                const colorClass = getLogColor(log.type);
                const prefix = getLogPrefix(log.type);
                return `<div class="${colorClass}"><span class="info">[${timeStr}]</span> ${prefix}${escapeHtml(log.text)}</div>`;
            }).join('');
            output.scrollTop = output.scrollHeight;
        }
        // Don't clear if empty - keep existing content
    }
}

// ===================
// TASK BOARD: SORTING, FILTERING, SEARCH
// ===================

function getTaskAgent(task) {
    // 1. Direct agent field (set by CLI scripts or API)
    if (task.agent) return task.agent;
    
    // 2. Detect from title prefix patterns or description
    const title = (task.title || '').toLowerCase();
    const desc = (task.description || '').toLowerCase();
    const agents = ['dev', 'exec', 'coo', 'cfo', 'cmp', 'sec', 'smm', 'family', 'tax'];
    
    // Check explicit prefixes
    for (const agent of agents) {
        if (title.startsWith(`${agent}:`) || title.startsWith(`${agent} -`) || title.startsWith(`${agent} `)) return agent;
    }
    
    // Check title patterns
    if (title.startsWith('solobot-android:') || title.startsWith('android:') || title.includes('dashboard:')) return 'dev';
    if (title.includes('android') || title.includes('api ') || title.includes('fix ') || title.includes('deploy') || title.includes('cache') || title.includes('sync') || title.includes('notification') || title.includes('server.js')) return 'dev';
    if (title.includes('marketing') || title.includes('social') || title.includes('content')) return 'cmp';
    if (title.includes('budget') || title.includes('invoice') || title.includes('financial')) return 'cfo';
    if (title.includes('security') || title.includes('audit')) return 'sec';
    
    return 'main'; // default
}

const AGENT_COLORS = {
    main: '#BC2026', dev: '#6366F1', exec: '#F59E0B', coo: '#10B981',
    cfo: '#EAB308', cmp: '#EC4899', family: '#14B8A6', tax: '#78716C',
    sec: '#3B82F6', smm: '#8B5CF6'
};

function getFilteredSortedTasks(column) {
    let tasks = [...(state.tasks[column] || [])];
    
    // Search filter
    const search = (document.getElementById('task-search')?.value || '').toLowerCase().trim();
    if (search) {
        tasks = tasks.filter(t => 
            (t.title || '').toLowerCase().includes(search) || 
            (t.description || '').toLowerCase().includes(search)
        );
    }
    
    // Priority filter
    const priorityFilter = document.getElementById('task-filter-priority')?.value || 'all';
    if (priorityFilter !== 'all') {
        const p = parseInt(priorityFilter);
        tasks = tasks.filter(t => (t.priority ?? 1) === p);
    }
    
    // Agent filter
    const agentFilter = document.getElementById('task-filter-agent')?.value || 'all';
    if (agentFilter !== 'all') {
        tasks = tasks.filter(t => getTaskAgent(t) === agentFilter);
    }
    
    // Sort
    const sortBy = document.getElementById('task-sort')?.value || 'newest';
    switch (sortBy) {
        case 'newest':
            tasks.sort((a, b) => (b.created || 0) - (a.created || 0));
            break;
        case 'oldest':
            tasks.sort((a, b) => (a.created || 0) - (b.created || 0));
            break;
        case 'priority-high':
            tasks.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));
            break;
        case 'priority-low':
            tasks.sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1));
            break;
        case 'alpha-az':
            tasks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
        case 'alpha-za':
            tasks.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
            break;
    }
    
    return tasks;
}

function applyTaskFilters() {
    renderTasks();
    updateBulkActionsUI();
}

function populateAgentFilter() {
    const select = document.getElementById('task-filter-agent');
    if (!select) return;
    
    // Collect all agents from all tasks
    const agents = new Set();
    ['todo', 'progress', 'done'].forEach(col => {
        (state.tasks[col] || []).forEach(t => agents.add(getTaskAgent(t)));
    });
    
    const currentValue = select.value;
    select.innerHTML = '<option value="all">All agents</option>';
    const sortedAgents = [...agents].sort();
    for (const agent of sortedAgents) {
        const color = AGENT_COLORS[agent] || '#888';
        const opt = document.createElement('option');
        opt.value = agent;
        opt.textContent = agent.toUpperCase();
        opt.style.color = color;
        select.appendChild(opt);
    }
    select.value = currentValue || 'all';
}

function updateTaskStats() {
    const el = document.getElementById('task-stats');
    if (!el) return;
    
    const todoCount = (state.tasks.todo || []).length;
    const progressCount = (state.tasks.progress || []).length;
    const doneCount = (state.tasks.done || []).length;
    const total = todoCount + progressCount + doneCount;
    const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    
    el.innerHTML = `${total} tasks • ${completionRate}% done`;
}

function updateBulkActionsUI() {
    const bulkEl = document.getElementById('task-bulk-actions');
    const countEl = document.getElementById('task-selected-count');
    if (!bulkEl) return;
    
    if (selectedTasks.size > 0) {
        bulkEl.style.display = 'flex';
        if (countEl) countEl.textContent = `${selectedTasks.size} selected`;
    } else {
        bulkEl.style.display = 'none';
    }
}

function bulkDelete() {
    if (selectedTasks.size === 0) return;
    if (!confirm(`Delete ${selectedTasks.size} task(s)?`)) return;
    
    ['todo', 'progress', 'done'].forEach(col => {
        state.tasks[col] = (state.tasks[col] || []).filter(t => !selectedTasks.has(t.id));
    });
    selectedTasks.clear();
    saveState('Bulk deleted tasks');
    renderTasks();
}

function renderTasks() {
    populateAgentFilter();
    
    ['todo', 'progress', 'done'].forEach(column => {
        const container = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
        const count = document.getElementById(`${column === 'progress' ? 'progress' : column}-count`);

        if (!container) { console.warn('[renderTasks] Missing container for', column); return; }

        const tasks = getFilteredSortedTasks(column);
        const totalInColumn = (state.tasks[column] || []).length;

        if (tasks.length === 0) {
            const emptyMsg = totalInColumn > 0 ? 'No tasks match filters' : 'No tasks';
            container.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-6) var(--space-2);">${emptyMsg}</div>`;
            if (count) count.textContent = totalInColumn;
            return;
        }

        container.innerHTML = tasks.map((task, index) => {
            const isSelected = selectedTasks.has(task.id);
            const doneStyle = column === 'done' ? 'text-decoration: line-through; color: var(--text-muted);' : '';
            const agent = getTaskAgent(task);
            const agentColor = AGENT_COLORS[agent] || '#888';
            const ageDays = Math.floor((Date.now() - (task.created || 0)) / 86400000);
            const ageLabel = ageDays === 0 ? 'today' : ageDays === 1 ? '1d ago' : `${ageDays}d ago`;
            
            return `
            <div class="task-card priority-p${task.priority} ${isSelected ? 'selected' : ''} ${task.images?.length ? 'has-attachments' : ''}"
                 data-task-id="${task.id}" data-column="${column}"
                 draggable="true"
                 ondragstart="handleDragStart(event, '${task.id}', '${column}')"
                 ondragend="handleDragEnd(event)"
                 onclick="openTaskDetail('${task.id}', '${column}')">
                <div style="display: flex; align-items: flex-start; gap: var(--space-3);">
                    <input type="checkbox"
                           style="margin-top: 2px; accent-color: var(--brand-red); cursor: pointer;"
                           ${isSelected ? 'checked' : ''}
                           onclick="toggleTaskSelection('${task.id}', event)">
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2);">
                            <span class="task-title" style="${doneStyle}">${escapeHtml(task.title)}</span>
                            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                                <span style="font-size: 9px; padding: 1px 5px; border-radius: 8px; background: ${agentColor}22; color: ${agentColor}; font-weight: 600; text-transform: uppercase;">${agent}</span>
                                <span class="badge ${getPriorityBadgeClass(task.priority)}">P${task.priority}</span>
                            </div>
                        </div>
                        ${task.description ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">${escapeHtml(task.description.slice(0, 80))}${task.description.length > 80 ? '…' : ''}</div>` : ''}
                        <div class="task-meta">
                            ${ageLabel} • ${formatTime(task.created || task.completedAt || task.id?.replace('t',''))}
                            ${task.description ? ' • 📝' : ''}
                            ${task.images?.length ? ` • 📎${task.images.length}` : ''}
                        </div>
                    </div>
                </div>

                <div class="task-quick-actions">
                    ${column === 'todo' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'progress', event)"
                                class="btn btn-ghost" style="width: 28px; height: 28px; padding: 0; border-radius: 50%;"
                                title="Start Working">▶</button>
                    ` : ''}
                    ${column !== 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'done', event)"
                                class="btn btn-primary" style="width: 28px; height: 28px; padding: 0; border-radius: 50%;"
                                title="Mark Done">✓</button>
                    ` : ''}
                    ${column === 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'todo', event)"
                                class="btn btn-ghost" style="width: 28px; height: 28px; padding: 0; border-radius: 50%;"
                                title="Reopen">↩</button>
                    ` : ''}
                </div>
            </div>
        `}).join('');

        // Show filtered count vs total
        if (count) count.textContent = tasks.length === totalInColumn ? totalInColumn : `${tasks.length}/${totalInColumn}`;
    });
    
    updateTaskStats();
    updateBulkActionsUI();
    
    // Update quick stats when tasks change
    if (typeof updateQuickStats === 'function') {
        updateQuickStats();
    }
}

function renderNotes() {
    const container = document.getElementById('notes-list');
    container.innerHTML = state.notes.map(note => `
        <div class="note-item" style="${note.seen ? 'opacity: 0.6;' : ''}">
            <div style="display: flex; align-items: flex-start; justify-content: space-between;">
                <span class="note-text">${escapeHtml(note.text)}</span>
                ${note.seen
                    ? '<span class="badge badge-success">✓ Seen</span>'
                    : '<span class="badge badge-warning">Pending</span>'}
            </div>
            <div class="note-meta">${formatTime(note.created)}</div>
        </div>
    `).join('') || '<div style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No notes yet</div>';
}

function renderActivity() {
    const container = document.getElementById('activity-log');
    const entries = state.activity.slice().reverse().slice(0, 20);

    if (entries.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: var(--space-4);">No activity yet</div>';
        return;
    }

    container.innerHTML = entries.map(entry => {
        const typeClass = entry.type === 'success' ? 'success' : entry.type === 'error' ? 'warning' : '';
        return `
        <div class="activity-item">
            <span class="activity-time">${formatTime(entry.time)}</span>
            <span class="activity-text ${typeClass}">${escapeHtml(entry.action)}</span>
        </div>
    `}).join('');
}

function renderDocs(filter = '') {
    const container = document.getElementById('docs-grid');
    
    // If docs-grid doesn't exist (moved to Memory page), skip
    if (!container) return;
    
    // First, render the memory files from our local documentation
    renderMemoryFiles(filter);
    
    // Then, append the existing Google Drive docs (if any) below the memory files
    const filtered = state.docs.filter(doc =>
        doc.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    if (filtered.length > 0) {
        // Add a separator if we have both memory files and Google Drive docs
        if (container.innerHTML && filtered.length > 0) {
            container.innerHTML += '<div class="docs-separator"><h3 class="category-title">Google Drive Documents</h3></div>';
        }
        
        const driveDocsHtml = filtered.map(doc => {
            const iconClass = getDocIconClass(doc.type, doc.url);
            const iconSymbol = getDocIconSymbol(doc.type, doc.url);
            return `
            <a href="${doc.url}" target="_blank" class="doc-card">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                    <div class="doc-icon ${iconClass}">${iconSymbol}</div>
                    <div style="min-width: 0; flex: 1;">
                        <div class="doc-title">${escapeHtml(doc.name)}</div>
                        <div class="doc-meta">Updated: ${formatDate(doc.updated)}</div>
                    </div>
                </div>
            </a>
        `}).join('');
        
        container.innerHTML += driveDocsHtml;
    }
    
    // If completely empty, show message
    if (!container.innerHTML) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; grid-column: 1 / -1; text-align: center; padding: var(--space-4);">No documents found</div>';
    }
}

function getDocIconClass(type, url) {
    if (url?.includes('docs.google.com/document')) return 'gdoc';
    if (url?.includes('docs.google.com/spreadsheets')) return 'gsheet';
    if (type === 'pdf' || url?.includes('.pdf')) return 'pdf';
    return 'default';
}

function getDocIconSymbol(type, url) {
    if (url?.includes('docs.google.com/document')) return '📄';
    if (url?.includes('docs.google.com/spreadsheets')) return '📊';
    if (type === 'pdf' || url?.includes('.pdf')) return '📕';
    return '📁';
}

// ===================
// UTILITY FUNCTIONS
// ===================

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Smart relative time formatting - shows "just now", "2m", "1h", etc.
function formatSmartTime(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    
    // Less than 30 seconds
    if (diff < 30000) return 'just now';
    
    // Less than 1 minute
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    
    // Less than 1 hour
    if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins}m ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }
    
    // Less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }
    
    // Older - show actual date
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeShort(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return formatDate(timestamp);
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateLastSync() {
    document.getElementById('last-sync').textContent = formatTime(Date.now());
}

function getPriorityClass(p) {
    if (p === 0) return 'badge-error';
    if (p === 1) return 'badge-warning';
    return 'badge-default';
}

function getPriorityBadgeClass(p) {
    if (p === 0) return 'badge-error';
    if (p === 1) return 'badge-warning';
    return 'badge-default';
}

function getLogColor(type) {
    switch(type) {
        case 'command': return 'text-green-400';
        case 'success': return 'text-green-300';
        case 'error': return 'text-red-400';
        case 'warning': return 'text-yellow-400';
        case 'info': return 'text-blue-400';
        case 'thinking': return 'text-purple-400';
        case 'output': return 'text-gray-300';
        default: return 'text-gray-400';
    }
}

function getLogPrefix(type) {
    switch(type) {
        case 'command': return '$ ';
        case 'thinking': return '🧠 ';
        case 'success': return '✓ ';
        case 'error': return '✗ ';
        case 'warning': return '⚠ ';
        default: return '';
    }
}

// Legacy function - keeping for backwards compatibility
function getDocIcon(type) {
    return getDocIconSymbol(type, '');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addActivity(action, type = 'info') {
    state.activity.push({
        time: Date.now(),
        action,
        type
    });
    
    if (state.activity.length > 500) {
        state.activity = state.activity.slice(-500);
    }
}

function updateArchiveBadge() {
    const badgeEl = document.getElementById('archive-badge');
    if (!badgeEl) return;
    
    const count = (state.tasks.archive || []).length;
    badgeEl.textContent = count;
    if (count > 0) {
        badgeEl.classList.remove('hidden');
    } else {
        badgeEl.classList.add('hidden');
    }
}

// ===================
// MISSING FUNCTIONS (UI handlers)
// ===================

function renderBulkActionBar() {
    const bar = document.getElementById('bulk-action-bar');
    if (!bar) return;

    if (selectedTasks.size > 0) {
        bar.classList.add('visible');
        const countEl = document.getElementById('bulk-count');
        if (countEl) countEl.textContent = `${selectedTasks.size} selected`;
    } else {
        bar.classList.remove('visible');
    }
}

// Modal helpers
function showModal(id) {
    document.getElementById(id)?.classList.add('visible');
}

function hideModal(id) {
    document.getElementById(id)?.classList.remove('visible');
}

async function openSettingsModal() {
    showModal('settings-modal');

    try {
        // Get current model from OpenClaw
        const response = await fetch('/api/models/current');
        const modelInfo = await response.json();
        
        // Update settings modal display
        document.getElementById('current-provider-display').textContent = modelInfo.provider;
        document.getElementById('current-model-display').textContent = modelInfo.modelId;
        
        // Set provider select to current
        document.getElementById('setting-provider').value = modelInfo.provider;
        
        // Populate model dropdown for current provider
        await updateModelDropdown(modelInfo.provider);
        
    } catch (error) {
        console.error('[Dashboard] Failed to get current model:', error);
        // Fallback
        document.getElementById('current-provider-display').textContent = 'anthropic';
        document.getElementById('current-model-display').textContent = 'anthropic/claude-opus-4-5';
        document.getElementById('setting-provider').value = 'anthropic';
        await updateModelDropdown('anthropic');
    }

    // Populate gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 443;
    if (tokenEl) tokenEl.value = GATEWAY_CONFIG.token || '';
    if (sessionEl) sessionEl.value = GATEWAY_CONFIG.sessionKey || 'main';
}

function closeSettingsModal() {
    hideModal('settings-modal');
}

function syncFromVPS() {
    loadState().then(() => {
        render();
        updateLastSync();
    });
}

function openAddTask(column = 'todo') {
    newTaskColumn = column;
    showModal('add-task-modal');
    document.getElementById('new-task-title')?.focus();
}

function closeAddTask() {
    hideModal('add-task-modal');
    const input = document.getElementById('new-task-title');
    if (input) input.value = '';
}

function setTaskPriority(priority) {
    newTaskPriority = priority;
    [0, 1, 2].forEach(p => {
        const btn = document.getElementById(`priority-btn-${p}`);
        if (btn) {
            btn.classList.toggle('bg-opacity-50', p !== priority);
        }
    });
}

function submitTask() {
    const titleInput = document.getElementById('new-task-title');
    const title = titleInput?.value?.trim();
    if (!title) return;

    const task = {
        id: 't' + Date.now(),
        title,
        priority: newTaskPriority,
        created: Date.now()
    };

    state.tasks[newTaskColumn].push(task);
    saveState('Added task: ' + title);
    closeAddTask();
    renderTasks();
}

function openActionModal(taskId, column) {
    currentModalTask = taskId;
    currentModalColumn = column;

    const task = state.tasks[column]?.find(t => t.id === taskId);
    if (!task) return;

    document.getElementById('action-modal-task-title').textContent = task.title;
    document.getElementById('action-priority-text').textContent = `Change Priority (P${task.priority})`;

    // Hide current column option
    ['todo', 'progress', 'done', 'archive'].forEach(col => {
        const btn = document.getElementById(`action-move-${col}`);
        if (btn) btn.classList.toggle('hidden', col === column);
    });

    showModal('task-action-modal');
}

function closeActionModal() {
    hideModal('task-action-modal');
    currentModalTask = null;
    currentModalColumn = null;
}

function modalMoveTask(targetColumn) {
    if (!currentModalTask || !currentModalColumn) return;

    const taskIndex = state.tasks[currentModalColumn].findIndex(t => t.id === currentModalTask);
    if (taskIndex === -1) return;

    const [task] = state.tasks[currentModalColumn].splice(taskIndex, 1);
    state.tasks[targetColumn].push(task);

    saveState(`Moved task to ${targetColumn}`);
    closeActionModal();
    renderTasks();
    updateArchiveBadge();
}

function modalEditTitle() {
    if (!currentModalTask || !currentModalColumn) return;

    const task = state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask);
    if (!task) return;

    closeActionModal();
    document.getElementById('edit-title-input').value = task.title;
    showModal('edit-title-modal');
    document.getElementById('edit-title-input')?.focus();
}

function closeEditTitleModal() {
    hideModal('edit-title-modal');
}

function saveEditedTitle() {
    if (!currentModalTask || !currentModalColumn) return;

    const task = state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask);
    if (!task) return;

    const newTitle = document.getElementById('edit-title-input')?.value?.trim();
    if (newTitle) {
        task.title = newTitle;
        saveState('Edited task title');
        renderTasks();
    }
    closeEditTitleModal();
}

function modalCyclePriority() {
    if (!currentModalTask || !currentModalColumn) return;

    const task = state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask);
    if (!task) return;

    task.priority = (task.priority + 1) % 3;
    document.getElementById('action-priority-text').textContent = `Change Priority (P${task.priority})`;
    saveState('Changed priority');
    renderTasks();
}

function modalDeleteTask() {
    document.getElementById('delete-modal-task-title').textContent =
        state.tasks[currentModalColumn]?.find(t => t.id === currentModalTask)?.title || '';
    closeActionModal();
    showModal('confirm-delete-modal');
}

function closeDeleteModal() {
    hideModal('confirm-delete-modal');
}

function confirmDeleteTask() {
    if (!currentModalTask || !currentModalColumn) return;

    const taskIndex = state.tasks[currentModalColumn].findIndex(t => t.id === currentModalTask);
    if (taskIndex !== -1) {
        state.tasks[currentModalColumn].splice(taskIndex, 1);
        saveState('Deleted task');
        renderTasks();
    }
    closeDeleteModal();
}

function quickMoveTask(taskId, fromColumn, toColumn, event) {
    event?.stopPropagation();

    const taskIndex = state.tasks[fromColumn].findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks[fromColumn].splice(taskIndex, 1);
    state.tasks[toColumn].push(task);

    saveState(`Moved task to ${toColumn}`);
    renderTasks();
}

function toggleTaskSelection(taskId, event) {
    event?.stopPropagation();

    if (selectedTasks.has(taskId)) {
        selectedTasks.delete(taskId);
    } else {
        selectedTasks.add(taskId);
    }
    renderTasks();
    if (typeof renderBulkActionBar === 'function') renderBulkActionBar();
}

function selectAllTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        state.tasks[column].forEach(task => selectedTasks.add(task.id));
    });
    renderTasks();
    if (typeof renderBulkActionBar === 'function') renderBulkActionBar();
}

function clearSelection() {
    selectedTasks.clear();
    renderTasks();
    if (typeof renderBulkActionBar === 'function') renderBulkActionBar();
}

function bulkMoveTo(targetColumn) {
    if (selectedTasks.size === 0) return;

    selectedTasks.forEach(taskId => {
        // Find and move each selected task
        ['todo', 'progress', 'done'].forEach(column => {
            const taskIndex = state.tasks[column].findIndex(t => t.id === taskId);
            if (taskIndex !== -1) {
                const [task] = state.tasks[column].splice(taskIndex, 1);
                state.tasks[targetColumn].push(task);
            }
        });
    });

    saveState(`Bulk moved ${selectedTasks.size} tasks to ${targetColumn}`);
    clearSelection();
    renderTasks();
    updateArchiveBadge();
}

function clearDone() {
    // Move all done tasks to archive
    const doneTasks = state.tasks.done.splice(0);
    state.tasks.archive.push(...doneTasks);
    saveState('Archived done tasks');
    renderTasks();
    updateArchiveBadge();
}

function openArchiveModal() {
    renderArchive();
    showModal('archive-modal');
}

function renderArchive() {
    const list = document.getElementById('archive-tasks-list');
    const countEl = document.getElementById('archive-modal-count');

    if (!list) return;

    const archived = state.tasks.archive || [];
    if (countEl) countEl.textContent = archived.length;

    list.innerHTML = archived.map(task => `
        <div class="task-card" style="display: flex; align-items: center; justify-content: space-between;">
            <div>
                <span class="task-title">${escapeHtml(task.title)}</span>
                <div class="task-meta">${formatTime(task.created)}</div>
            </div>
            <button onclick="restoreFromArchive('${task.id}')" class="btn btn-ghost" style="font-size: 12px;">
                Restore
            </button>
        </div>
    `).join('') || '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-8);">No archived tasks</div>';
}

function closeArchiveModal() {
    hideModal('archive-modal');
}

function restoreFromArchive(taskId) {
    const taskIndex = state.tasks.archive.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks.archive.splice(taskIndex, 1);
    state.tasks.todo.push(task);

    saveState('Restored task from archive');
    renderArchive(); // Refresh the archive list
    renderTasks();
    updateArchiveBadge();
}

async function clearArchive() {
    if (await showConfirm('Delete all archived tasks permanently?', 'Clear Archive', 'Delete All')) {
        state.tasks.archive = [];
        saveState('Cleared archive');
        renderArchive();
        updateArchiveBadge();
        showToast('Archive cleared', 'success');
    }
}

function addNote() {
    const input = document.getElementById('note-input');
    const text = input?.value?.trim();
    if (!text) return;

    state.notes.push({
        id: 'n' + Date.now(),
        text,
        created: Date.now(),
        seen: false
    });

    input.value = '';
    saveState('Added note');
    renderNotes();
}

function clearConsole() {
    if (state.console) state.console.logs = [];
    saveState();
    renderConsole();
}

// Add a log entry to the terminal
function addTerminalLog(text, type = 'info', timestamp = null) {
    if (!state.console) state.console = { logs: [] };
    
    const log = {
        time: timestamp || Date.now(),
        text: text,
        type: type
    };
    
    // Dedupe - don't add if identical to last entry within 5 seconds
    const lastLog = state.console.logs[state.console.logs.length - 1];
    if (lastLog && lastLog.text === text && Math.abs(log.time - lastLog.time) < 5000) {
        return;
    }
    
    state.console.logs.push(log);
    
    // Keep last 500 entries for review
    if (state.console.logs.length > 500) {
        state.console.logs = state.console.logs.slice(-500);
    }
    
    renderConsole();
}

// Auto-sync activities from transcript file
let lastActivitySync = 0;
async function syncActivitiesFromFile() {
    try {
        const response = await fetch('/api/memory/memory/recent-activity.json');
        if (!response.ok) return;
        
        const wrapper = await response.json();
        // API wraps content in {name, content, modified, size}
        const data = typeof wrapper.content === 'string' ? JSON.parse(wrapper.content) : wrapper.content;
        if (!data || !data.activities || data.updatedMs <= lastActivitySync) return;
        
        lastActivitySync = data.updatedMs;
        
        // Convert activities to console log format
        const activityLogs = data.activities.map(a => ({
            time: a.timestamp,
            text: a.text,
            type: 'info'
        }));
        
        // Merge with existing logs (dedupe by timestamp + text)
        if (!state.console) state.console = { logs: [] };
        const existing = new Set(state.console.logs.map(l => `${l.time}-${l.text}`));
        
        let added = 0;
        for (const log of activityLogs) {
            const key = `${log.time}-${log.text}`;
            if (!existing.has(key)) {
                state.console.logs.push(log);
                existing.add(key);
                added++;
            }
        }
        
        if (added > 0) {
            // Sort by time and keep last 100
            state.console.logs.sort((a, b) => a.time - b.time);
            state.console.logs = state.console.logs.slice(-100);
            renderConsole();
        }
    } catch (e) {
        // Silent fail - file might not exist yet
    }
}

// Poll for activity updates every 30 seconds
setInterval(syncActivitiesFromFile, 30000);
// Also sync on load
setTimeout(syncActivitiesFromFile, 2000);

function toggleConsoleExpand() {
    const section = document.getElementById('console-section');
    const output = document.getElementById('console-output');
    const btn = document.getElementById('console-expand-btn');

    if (!section || !output || !btn) return;

    const isExpanded = output.classList.contains('h-[500px]');

    if (isExpanded) {
        output.classList.remove('h-[500px]');
        output.classList.add('h-[250px]');
        btn.textContent = 'Expand';
    } else {
        output.classList.remove('h-[250px]');
        output.classList.add('h-[500px]');
        btn.textContent = 'Collapse';
    }
}

function updateSetting(key, value) {
    // Handle provider/model changes specially - just show warning
    if (key === 'provider' || key === 'model') {
        console.warn(`[Dashboard] Cannot change ${key} from dashboard - must be configured at OpenClaw gateway level`);
        showToast(`${key.charAt(0).toUpperCase() + key.slice(1)} must be configured at OpenClaw gateway level`, 'warning');
        return;
    }
    
    // Settings are stored in localStorage
    localStorage.setItem(`setting_${key}`, JSON.stringify(value));
}

async function resetToServerState() {
    if (await showConfirm('This will reload all data from the server. Continue?', 'Reset to Server', 'Reload')) {
        localStorage.removeItem('solovision-dashboard');
        location.reload();
    }
}

async function clearAllData() {
    if (await showConfirm('This will delete ALL local data. Are you sure?', '⚠️ Delete All Data', 'Delete Everything')) {
        localStorage.clear();
        state = {
            status: 'idle',
            model: 'opus 4.5',
            tasks: { todo: [], progress: [], done: [], archive: [] },
            notes: [],
            activity: [],
            docs: [],
            console: { logs: [] },
            chat: { messages: [] }
        };
        saveState();
        render();
    }
}

// Drag and drop handlers
let draggedTaskId = null;
let draggedFromColumn = null;

function handleDragStart(event, taskId, column) {
    draggedTaskId = taskId;
    draggedFromColumn = column;
    event.dataTransfer.effectAllowed = 'move';
    event.target.classList.add('opacity-50');
}

function handleDragEnd(event) {
    event.target.classList.remove('opacity-50');
    draggedTaskId = null;
    draggedFromColumn = null;

    // Remove all drag-over styling
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.classList.remove('bg-slate-600/30', 'ring-2', 'ring-solo-primary');
    });
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(event, column) {
    event.preventDefault();
    const zone = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
    zone?.classList.add('bg-slate-600/30', 'ring-2', 'ring-solo-primary');
}

function handleDragLeave(event, column) {
    const zone = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
    zone?.classList.remove('bg-slate-600/30', 'ring-2', 'ring-solo-primary');
}

function handleDrop(event, targetColumn) {
    event.preventDefault();

    const zone = document.getElementById(`${targetColumn === 'progress' ? 'progress' : targetColumn}-tasks`);
    zone?.classList.remove('bg-slate-600/30', 'ring-2', 'ring-solo-primary');

    if (!draggedTaskId || !draggedFromColumn || draggedFromColumn === targetColumn) return;

    const taskIndex = state.tasks[draggedFromColumn].findIndex(t => t.id === draggedTaskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks[draggedFromColumn].splice(taskIndex, 1);
    state.tasks[targetColumn].push(task);

    saveState(`Moved task to ${targetColumn}`);
    renderTasks();
}

function closeAllTaskMenus() {
    document.querySelectorAll('.task-menu').forEach(menu => menu.classList.add('hidden'));
}

// ===================
// PUBLIC API
// ===================

window.dashboardAPI = {
    setStatus: (status, task) => {
        state.status = status;
        state.currentTask = task;
        saveState();
        render();
    },
    setSubagent: (task) => {
        state.subagent = task;
        saveState();
        render();
    },
    addActivity: (action, type) => {
        addActivity(action, type);
        saveState();
        render();
    },
    addConsoleLog: (text, type) => {
        if (!state.console) state.console = { logs: [] };
        if (!state.console.logs) state.console.logs = [];
        
        state.console.logs.push({
            text,
            type,
            time: Date.now()
        });
        
        if (state.console.logs.length > 100) {
            state.console.logs = state.console.logs.slice(-100);
        }
        
        saveState();
        renderConsole();
    },
    markNoteSeen: (noteId) => {
        const note = state.notes.find(n => n.id === noteId);
        if (note) {
            note.seen = true;
            note.seenAt = Date.now();
            saveState();
            renderNotes();
        }
    },
    getState: () => state,
    setState: (newState) => {
        // Preserve local-only data
        const currentConsole = state.console;
        const currentSystem = state.system;
        state = { ...state, ...newState, console: currentConsole, system: currentSystem };
        saveState();
        render();
    }
};

// ===================
// MEMORY FILE FUNCTIONS
// ===================

// Current file being edited
let currentMemoryFile = null;

// View a memory file in the modal
window.viewMemoryFile = async function(filePath) {
    const titleEl = document.getElementById('memory-file-title');
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!titleEl || !contentEl) return;
    
    // Show loading state
    titleEl.textContent = filePath;
    contentEl.value = 'Loading...';
    contentEl.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    
    currentMemoryFile = filePath;
    showModal('memory-file-modal');
    
    try {
        // Fetch file content from API
        const response = await fetch(`/api/memory/${encodeURIComponent(filePath)}`);
        const data = await response.json();
        
        if (data.error) {
            contentEl.value = `Error: ${data.error}`;
            return;
        }
        
        contentEl.value = data.content || '';
        contentEl.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
        
        // Show bot-update badge and acknowledge button if applicable
        if (data.botUpdated && !data.acknowledged) {
            titleEl.innerHTML = `
                ${escapeHtml(data.name)}
                <span class="badge badge-warning" style="margin-left: 8px;">🤖 Updated by SoLoBot</span>
                <button onclick="this.style.color='var(--text-muted)'; this.textContent='✓ Read'; this.disabled=true; window.acknowledgeUpdate && window.acknowledgeUpdate('${escapeHtml(filePath)}')" 
                        class="btn btn-ghost" style="margin-left: 8px; font-size: 12px; color: var(--error);">
                    ✓ Mark as Read
                </button>
            `;
        } else {
            titleEl.textContent = data.name;
        }
        
        // Load version history (function from docs-hub-memory-files.js)
        if (typeof window.loadVersionHistory === 'function') {
            window.loadVersionHistory(filePath);
        }
        
    } catch (error) {
        console.error('Error loading memory file:', error);
        contentEl.value = `Error loading file: ${error.message}`;
    }
};

// Save memory file changes
window.saveMemoryFile = async function() {
    if (!currentMemoryFile) return;
    
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!contentEl) return;
    
    const content = contentEl.value;
    
    // Show saving state
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(currentMemoryFile)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            // Success feedback
            if (saveBtn) {
                saveBtn.textContent = '✓ Saved!';
                setTimeout(() => {
                    saveBtn.textContent = 'Save';
                    saveBtn.disabled = false;
                }, 1500);
            }
            // Refresh the memory files list
            if (typeof renderMemoryFilesForPage === 'function') {
                renderMemoryFilesForPage('');
            }
        } else {
            throw new Error(data.error || 'Save failed');
        }
        
    } catch (error) {
        console.error('Error saving memory file:', error);
        showToast(`Failed to save: ${error.message}`, 'error');
        if (saveBtn) {
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        }
    }
};

// Close memory modal
window.closeMemoryModal = function() {
    currentMemoryFile = null;
    hideModal('memory-file-modal');
};

// ===================
// SYSTEM HEALTH FUNCTIONS
// ===================

let healthTestResults = {};
let healthTestInProgress = false;
let pendingHealthChecks = new Map(); // sessionKey -> { resolve, reject, timer }

// Initialize health page when shown
function initHealthPage() {
    updateHealthGatewayStatus();
    loadHealthModels();
}

// Update gateway connection status
function updateHealthGatewayStatus() {
    const statusEl = document.getElementById('health-gateway-status');
    if (!statusEl) return;
    
    if (gateway && gateway.isConnected()) {
        statusEl.innerHTML = `
            <span style="font-size: 20px;">✅</span>
            <span style="font-weight: 500; color: var(--success);">Connected</span>
        `;
    } else {
        statusEl.innerHTML = `
            <span style="font-size: 20px;">❌</span>
            <span style="font-weight: 500; color: var(--error);">Disconnected</span>
        `;
    }
}

// Load available models from API
async function loadHealthModels() {
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error('Failed to fetch models');
        const data = await response.json();
        
        // API returns models grouped by provider: { anthropic: [...], google: [...] }
        // Flatten into a single array
        let models = [];
        if (data.models) {
            // Direct models array format
            models = data.models;
        } else {
            // Provider-grouped format - flatten it
            for (const provider of Object.keys(data)) {
                if (Array.isArray(data[provider])) {
                    models = models.concat(data[provider]);
                }
            }
        }
        
        const countEl = document.getElementById('health-model-count');
        if (countEl) countEl.textContent = models.length;
        
        // Render initial model list (not tested yet)
        renderHealthModelList(models, {});
        
        return models;
    } catch (error) {
        console.error('[Health] Failed to load models:', error);
        const countEl = document.getElementById('health-model-count');
        if (countEl) countEl.textContent = '?';
        return [];
    }
}

// Test a single model by creating a dedicated session, patching its model, and sending a test message
// Now waits for the actual LLM response event via WebSocket
async function testSingleModel(modelId) {
    const startTime = Date.now();
    
    try {
        // Check if gateway is connected
        if (!gateway || !gateway.isConnected()) {
            return {
                success: false,
                error: 'Gateway not connected',
                latencyMs: Date.now() - startTime
            };
        }
        
        // Create a unique health-check session for this model
        const healthSessionKey = 'health-check-' + modelId.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        
        // Step 1: Patch the session to use the target model
        console.log(`[Health] Setting model for session ${healthSessionKey} to ${modelId}`);
        try {
            await gateway._request('sessions.patch', {
                key: healthSessionKey,
                model: modelId
            }, 10000); // 10s timeout for patch
        } catch (patchError) {
            console.error(`[Health] Failed to patch session model: ${patchError.message}`);
            return {
                success: false,
                error: `Model config failed: ${patchError.message}`,
                latencyMs: Date.now() - startTime
            };
        }
        
        // Step 2: Create a promise that waits for the actual LLM response event
        const responsePromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (pendingHealthChecks.has(healthSessionKey)) {
                    pendingHealthChecks.delete(healthSessionKey);
                    reject(new Error('Response timeout (60s)'));
                }
            }, 60000); // 60s timeout for LLM response
            
            pendingHealthChecks.set(healthSessionKey, {
                resolve: (res) => {
                    clearTimeout(timer);
                    resolve(res);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                }
            });
        });
        
        // Step 3: Send a test message using that session
        console.log(`[Health] Sending test message to ${modelId}`);
        await gateway._request('chat.send', {
            message: 'Respond with exactly: OK',
            sessionKey: healthSessionKey,
            idempotencyKey: crypto.randomUUID()
        }, 10000); // 10s timeout for the SEND REQUEST itself
        
        // Step 4: Wait for the ACTUAL response event
        const result = await responsePromise;
        const latencyMs = Date.now() - startTime;
        
        return {
            success: true,
            response: result?.content || 'OK',
            latencyMs
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message || 'Test failed',
            latencyMs: Date.now() - startTime
        };
    }
}

// Run health checks on all models
window.runAllModelTests = async function() {
    if (healthTestInProgress) {
        showToast('Health check already in progress', 'warning');
        return;
    }
    
    healthTestInProgress = true;
    healthTestResults = {};
    
    const testBtn = document.getElementById('test-all-btn');
    const progressEl = document.getElementById('health-test-progress');
    
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.innerHTML = '⏳ Testing...';
    }
    
    try {
        // Load models
        const models = await loadHealthModels();
        
        if (models.length === 0) {
            showToast('No models found to test', 'warning');
            return;
        }
        
        // Mark all as testing
        models.forEach(m => {
            healthTestResults[m.id] = { status: 'testing' };
        });
        renderHealthModelList(models, healthTestResults);
        
        // Test each model sequentially
        let tested = 0;
        let passed = 0;
        let failed = 0;
        
        for (const model of models) {
            tested++;
            if (progressEl) {
                progressEl.textContent = `Testing ${tested}/${models.length}...`;
            }
            
            const result = await testSingleModel(model.id);
            
            healthTestResults[model.id] = {
                status: result.success ? 'success' : 'error',
                error: result.error,
                latencyMs: result.latencyMs,
                response: result.response
            };
            
            if (result.success) passed++;
            else failed++;
            
            // Re-render after each test for real-time updates
            renderHealthModelList(models, healthTestResults);
        }
        
        // Update last test time
        const lastTestEl = document.getElementById('health-last-test');
        if (lastTestEl) {
            lastTestEl.textContent = new Date().toLocaleTimeString();
        }
        
        if (progressEl) {
            progressEl.textContent = `✅ ${passed} passed, ❌ ${failed} failed`;
        }
        
        showToast(`Health check complete: ${passed}/${models.length} models working`, 
            failed > 0 ? 'warning' : 'success');
        
    } catch (error) {
        console.error('[Health] Test failed:', error);
        showToast('Health check failed: ' + error.message, 'error');
    } finally {
        healthTestInProgress = false;
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '🚀 Test All Models';
        }
    }
};

// Render the model list with test results
function renderHealthModelList(models, results) {
    const container = document.getElementById('health-model-list');
    if (!container) return;
    
    if (models.length === 0) {
        container.innerHTML = `
            <div style="padding: var(--space-4); color: var(--text-muted); text-align: center;">
                <p>No models available. Check gateway connection.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = models.map(model => {
        const result = results[model.id] || { status: 'pending' };
        
        let statusIcon, statusColor, statusText;
        switch (result.status) {
            case 'success':
                statusIcon = '✅';
                statusColor = 'var(--success)';
                statusText = `${result.latencyMs}ms`;
                break;
            case 'error':
                statusIcon = '❌';
                statusColor = 'var(--error)';
                statusText = result.error || 'Failed';
                break;
            case 'testing':
                statusIcon = '⏳';
                statusColor = 'var(--warning)';
                statusText = 'Testing...';
                break;
            default:
                statusIcon = '⚪';
                statusColor = 'var(--text-muted)';
                statusText = 'Not tested';
        }
        
        // Extract provider from model ID (e.g., 'anthropic/claude-3-5-sonnet' -> 'anthropic')
        const provider = model.id.split('/')[0] || 'unknown';
        const modelName = model.id.split('/').slice(1).join('/') || model.id;
        
        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle);">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                    <span style="font-size: 18px;">${statusIcon}</span>
                    <div>
                        <div style="font-weight: 500; color: var(--text-primary);">${modelName}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            <span style="background: var(--surface-3); padding: 1px 6px; border-radius: 3px;">${provider}</span>
                            ${model.displayName ? `<span style="margin-left: 8px;">${model.displayName}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${statusColor}; font-size: 13px; font-weight: 500; margin-bottom: 2px;">${statusText}</div>
                    ${result.status !== 'testing' && !healthTestInProgress ? `
                        <button onclick="testSingleModelUI('${model.id}')" class="btn btn-ghost" style="font-size: 10px; padding: 1px 6px; height: auto;">
                            ${result.status === 'pending' ? 'Test' : 'Re-test'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Test single model from UI button
window.testSingleModelUI = async function(modelId) {
    const models = await loadHealthModels();
    healthTestResults[modelId] = { status: 'testing' };
    renderHealthModelList(models, healthTestResults);
    
    const result = await testSingleModel(modelId);
    healthTestResults[modelId] = {
        status: result.success ? 'success' : 'error',
        error: result.error,
        latencyMs: result.latencyMs
    };
    renderHealthModelList(models, healthTestResults);
    
    showToast(result.success ? `${modelId.split('/').pop()} is working!` : `${modelId.split('/').pop()} failed: ${result.error}`,
        result.success ? 'success' : 'error');
};

// Hook into page navigation to init health page
const originalShowPage = window.showPage;
if (typeof originalShowPage === 'function') {
    window.showPage = function(pageName, updateURL = true) {
        originalShowPage(pageName, updateURL);
        if (pageName === 'health') {
            initHealthPage();
        }
        if (pageName === 'chat') {
            forceRefreshHistory();
        }
    };
}

// ===================
// KEYBOARD SHORTCUTS & COMMAND PALETTE
// ===================

// Command palette state
let commandPaletteOpen = false;
let commandPaletteSelectedIndex = 0;

// Command definitions
const commands = [
    { id: 'chat', icon: '💬', title: 'Go to Chat', desc: 'Open chat page', shortcut: 'C', action: () => showPage('chat') },
    { id: 'system', icon: '🔧', title: 'System Messages', desc: 'View system/debug messages', shortcut: 'S', action: () => showPage('system') },
    { id: 'health', icon: '🏥', title: 'Model Health', desc: 'Check model status', shortcut: 'H', action: () => showPage('health') },
    { id: 'memory', icon: '🧠', title: 'Memory Lane', desc: 'Browse memory files', shortcut: 'M', action: () => showPage('memory') },
    { id: 'settings', icon: '⚙️', title: 'Settings', desc: 'Open settings modal', shortcut: ',', action: () => openSettingsModal() },
    { id: 'theme', icon: '🎨', title: 'Themes', desc: 'Open theme picker', shortcut: 'T', action: () => toggleTheme() },
    { id: 'new-session', icon: '➕', title: 'New Session', desc: 'Create a new chat session', shortcut: 'N', action: () => createNewSession() },
    { id: 'refresh', icon: '🔄', title: 'Refresh Sessions', desc: 'Reload session list', shortcut: 'R', action: () => fetchSessions() },
    { id: 'focus-chat', icon: '⌨️', title: 'Focus Chat Input', desc: 'Jump to chat input', shortcut: '/', action: () => focusChatInput() },
];

// Initialize command palette HTML
function initCommandPalette() {
    // Check if already initialized
    if (document.getElementById('command-palette')) return;
    
    const backdrop = document.createElement('div');
    backdrop.id = 'command-palette-backdrop';
    backdrop.className = 'command-palette-backdrop';
    backdrop.onclick = closeCommandPalette;
    
    const palette = document.createElement('div');
    palette.id = 'command-palette';
    palette.className = 'command-palette';
    palette.innerHTML = `
        <input type="text" class="command-palette-input" placeholder="Type a command... (↑↓ to navigate, Enter to select)" id="command-palette-input">
        <div class="command-palette-results" id="command-palette-results"></div>
    `;
    
    document.body.appendChild(backdrop);
    document.body.appendChild(palette);
    
    // Setup input handler
    const input = document.getElementById('command-palette-input');
    input.addEventListener('input', (e) => filterCommands(e.target.value));
    input.addEventListener('keydown', handlePaletteKeydown);
    
    renderCommands(commands);
}

function renderCommands(cmds) {
    const container = document.getElementById('command-palette-results');
    if (!container) return;
    
    container.innerHTML = cmds.map((cmd, idx) => `
        <div class="command-palette-item${idx === commandPaletteSelectedIndex ? ' selected' : ''}" 
             data-index="${idx}" 
             onclick="executeCommand('${cmd.id}')">
            <span class="command-palette-item-icon">${cmd.icon}</span>
            <div class="command-palette-item-text">
                <div class="command-palette-item-title">${cmd.title}</div>
                <div class="command-palette-item-desc">${cmd.desc}</div>
            </div>
            ${cmd.shortcut ? `<span class="command-palette-shortcut">${cmd.shortcut}</span>` : ''}
        </div>
    `).join('');
}

function filterCommands(query) {
    const q = query.toLowerCase().trim();
    let filtered = commands;
    
    if (q) {
        filtered = commands.filter(cmd => 
            cmd.title.toLowerCase().includes(q) || 
            cmd.desc.toLowerCase().includes(q) ||
            cmd.id.toLowerCase().includes(q)
        );
    }
    
    commandPaletteSelectedIndex = 0;
    renderCommands(filtered);
}

function handlePaletteKeydown(e) {
    const results = document.querySelectorAll('.command-palette-item');
    const maxIndex = results.length - 1;
    
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            commandPaletteSelectedIndex = Math.min(commandPaletteSelectedIndex + 1, maxIndex);
            updatePaletteSelection();
            break;
        case 'ArrowUp':
            e.preventDefault();
            commandPaletteSelectedIndex = Math.max(commandPaletteSelectedIndex - 1, 0);
            updatePaletteSelection();
            break;
        case 'Enter':
            e.preventDefault();
            const selectedItem = results[commandPaletteSelectedIndex];
            if (selectedItem) {
                const idx = parseInt(selectedItem.dataset.index);
                const filtered = getFilteredCommands();
                if (filtered[idx]) {
                    executeCommand(filtered[idx].id);
                }
            }
            break;
        case 'Escape':
            closeCommandPalette();
            break;
    }
}

function getFilteredCommands() {
    const input = document.getElementById('command-palette-input');
    const q = (input?.value || '').toLowerCase().trim();
    if (!q) return commands;
    return commands.filter(cmd => 
        cmd.title.toLowerCase().includes(q) || 
        cmd.desc.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q)
    );
}

function updatePaletteSelection() {
    const items = document.querySelectorAll('.command-palette-item');
    items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === commandPaletteSelectedIndex);
        if (idx === commandPaletteSelectedIndex) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

window.executeCommand = function(id) {
    const cmd = commands.find(c => c.id === id);
    if (cmd) {
        closeCommandPalette();
        cmd.action();
    }
};

function openCommandPalette() {
    initCommandPalette();
    commandPaletteOpen = true;
    commandPaletteSelectedIndex = 0;
    
    const backdrop = document.getElementById('command-palette-backdrop');
    const palette = document.getElementById('command-palette');
    const input = document.getElementById('command-palette-input');
    
    if (backdrop) backdrop.classList.add('visible');
    if (palette) palette.classList.add('visible');
    if (input) {
        input.value = '';
        input.focus();
    }
    
    renderCommands(commands);
}

function closeCommandPalette() {
    commandPaletteOpen = false;
    
    const backdrop = document.getElementById('command-palette-backdrop');
    const palette = document.getElementById('command-palette');
    
    if (backdrop) backdrop.classList.remove('visible');
    if (palette) palette.classList.remove('visible');
}

function focusChatInput() {
    // Navigate to chat page first
    showPage('chat');
    
    // Focus the input after a short delay to allow page transition
    setTimeout(() => {
        const input = document.getElementById('chat-page-input');
        if (input) input.focus();
    }, 100);
}

function createNewSession() {
    // Generate a unique session name
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const newKey = `session-${timestamp}`;
    
    if (typeof switchToSession === 'function') {
        switchToSession(newKey);
        showToast(`Created new session: ${newKey}`, 'success');
    } else {
        showToast('Session creation not available', 'warning');
    }
}

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs (except specific ones)
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    
    // Command palette: Cmd/Ctrl + K
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (commandPaletteOpen) {
            closeCommandPalette();
        } else {
            openCommandPalette();
        }
        return;
    }
    
    // Escape: Close modals/palettes
    if (e.key === 'Escape') {
        if (commandPaletteOpen) {
            closeCommandPalette();
            return;
        }
        // Close any open modal
        const visibleModal = document.querySelector('.modal-overlay.visible');
        if (visibleModal) {
            visibleModal.classList.remove('visible');
            return;
        }
    }
    
    // Don't process other shortcuts if in input
    if (isInput) return;
    
    // Quick navigation (single key shortcuts - only when not typing)
    switch (e.key.toLowerCase()) {
        case 'c':
            showPage('chat');
            break;
        case 's':
            if (e.shiftKey) {
                // Shift+S: Sync tasks
                syncFromVPS();
            } else {
                showPage('system');
            }
            break;
        case 'h':
            showPage('health');
            break;
        case 'm':
            showPage('memory');
            break;
        case 'd':
            showPage('dashboard');
            break;
        case 'p':
            showPage('products');
            break;
        case 't':
            toggleTheme();
            break;
        case 'f':
            if (e.shiftKey) {
                // Shift+F: Reset focus timer
                resetFocusTimer();
            } else {
                // F: Toggle focus timer
                toggleFocusTimer();
            }
            break;
        case 'n':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                createNewSession();
            } else {
                // N: New task
                openAddTask('todo');
            }
            break;
        case '/':
            e.preventDefault();
            focusChatInput();
            break;
        case '?':
            e.preventDefault();
            showModal('shortcuts-modal');
            break;
        case ',':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                openSettingsModal();
            }
            break;
    }
    
    // Number keys 1-9: Switch to session by index
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const sessionIndex = parseInt(e.key) - 1;
        const agentSessions = filterSessionsForAgent(availableSessions, currentAgentId);
        if (agentSessions[sessionIndex]) {
            switchToSession(agentSessions[sessionIndex].key);
            showToast(`Switched to session ${e.key}`, 'success', 1500);
        }
    }
});

// Initialize command palette on page load
document.addEventListener('DOMContentLoaded', () => {
    initCommandPalette();
});

// ===================
// SESSION SEARCH
// ===================

let sessionSearchQuery = '';

function filterSessionsBySearch(sessions, query) {
    if (!query) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(s => {
        const name = (s.displayName || s.name || s.key || '').toLowerCase();
        const model = (s.model || '').toLowerCase();
        return name.includes(q) || model.includes(q);
    });
}

// Update populateSessionDropdown to include search
const originalPopulateSessionDropdown = window.populateSessionDropdown;
if (typeof originalPopulateSessionDropdown === 'function') {
    window.populateSessionDropdown = function() {
        // Call original first
        originalPopulateSessionDropdown();
        
        // Then add search functionality if not already present
        const dropdown = document.getElementById('chat-page-session-menu');
        if (dropdown && !dropdown.querySelector('.session-search')) {
            const searchDiv = document.createElement('div');
            searchDiv.className = 'session-search';
            searchDiv.innerHTML = `
                <input type="text" placeholder="Search sessions..." 
                       oninput="filterSessionDropdown(this.value)"
                       onclick="event.stopPropagation()">
            `;
            dropdown.insertBefore(searchDiv, dropdown.firstChild);
        }
    };
}

window.filterSessionDropdown = function(query) {
    sessionSearchQuery = query;
    const dropdown = document.getElementById('chat-page-session-menu');
    if (!dropdown) return;
    
    const items = dropdown.querySelectorAll('.session-menu-item');
    const q = query.toLowerCase();
    
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? '' : 'none';
    });
};