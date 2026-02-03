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
    const providerSelect = document.getElementById('provider-select');
    if (!providerSelect) {
        console.warn('[Dashboard] provider-select element not found');
        return [];
    }
    
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const allModels = await response.json();
        const providers = Object.keys(allModels);
        
        // Clear existing options
        providerSelect.innerHTML = '';
        
        // Add options for each provider
        providers.forEach(provider => {
            const option = document.createElement('option');
            option.value = provider;
            // Format display name (capitalize, replace hyphens)
            option.textContent = provider.split('-').map(w => 
                w.charAt(0).toUpperCase() + w.slice(1)
            ).join(' ');
            providerSelect.appendChild(option);
        });

        return providers;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch providers:', e);
        return [];
    }
}

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

window.changeModel = async function() {
    // Support both model-select and setting-model IDs
    const modelSelect = document.getElementById('model-select') || document.getElementById('setting-model');
    const selectedModel = modelSelect?.value;
    
    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }
    
    if (selectedModel.includes('ERROR')) {
        showToast('Cannot change model - configuration error', 'error');
        return;
    }
    
    try {
        console.log(`[Dashboard] Attempting to change model to: ${selectedModel}`);
        
        const response = await fetch('/api/models/set', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ modelId: selectedModel })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            console.log(`[Dashboard] Model successfully changed to: ${selectedModel}`);

            // Update state (with null checks)
            const providerSelectEl = document.getElementById('provider-select');
            currentModel = selectedModel;
            if (providerSelectEl) currentProvider = providerSelectEl.value;

            // Sync to localStorage so gateway client uses correct model
            localStorage.setItem('selected_provider', currentProvider);
            localStorage.setItem('selected_model', currentModel);

            // Update displays
            const modelNameEl = document.getElementById('model-name');
            const currentModelDisplay = document.getElementById('current-model-display');

            if (modelNameEl) modelNameEl.textContent = selectedModel;
            if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;

            // Refresh model list in settings
            if (providerSelectEl) await updateModelDropdown(providerSelectEl.value);

            // Gateway will automatically reload when the server updates openclaw.json
            showToast(`Model changed to ${selectedModel}. System updating...`, 'success');
        } else {
            console.error('[Dashboard] Failed to change model:', result);
            showToast(`Failed to change model: ${result.error || 'Unknown error'}`, 'error');
            
            // Make error visible - don't hide it
            throw new Error(`Model change failed: ${result.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('[Dashboard] Error changing model:', error);
        showToast(`Failed to change model: ${error.message}`, 'error');
        
        // Re-throw to make error visible
        throw error;
    }
};

async function updateModelDropdown(provider) {
    // Support both model-select and setting-model IDs
    const modelSelect = document.getElementById('model-select') || document.getElementById('setting-model');
    if (!modelSelect) {
        console.warn('[Dashboard] No model select element found (tried model-select and setting-model)');
        return;
    }
    
    const models = await getModelsForProvider(provider);
    
    // Clear current options
    modelSelect.innerHTML = '';
    
    // Add new options
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        if (model.selected) option.selected = true;
        modelSelect.appendChild(option);
    });
    
    // Also update setting-model if it's a different element
    const settingModel = document.getElementById('setting-model');
    if (settingModel && settingModel !== modelSelect) {
        settingModel.innerHTML = modelSelect.innerHTML;
    }
}

async function getModelsForProvider(provider) {
    try {
        // Fetch models from server API
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
        // Return empty array on error - don't hide the problem
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

// Initialize provider/model display on page load
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // First populate the provider dropdown dynamically
        await populateProviderDropdown();
        
        // Get current model from OpenClaw
        const response = await fetch('/api/models/current');
        const modelInfo = await response.json();
        
        currentProvider = modelInfo.provider;
        currentModel = modelInfo.modelId;

        // Sync to localStorage so gateway client uses correct model
        localStorage.setItem('selected_provider', currentProvider);
        localStorage.setItem('selected_model', currentModel);

        console.log(`[Dashboard] Current model: ${currentModel}`);
        
        // Update displays (with null checks)
        const providerNameEl = document.getElementById('provider-name');
        const modelNameEl = document.getElementById('model-name');
        const currentProviderDisplay = document.getElementById('current-provider-display');
        const currentModelDisplay = document.getElementById('current-model-display');
        const providerSelectEl = document.getElementById('provider-select');
        
        if (providerNameEl) providerNameEl.textContent = currentProvider;
        if (modelNameEl) modelNameEl.textContent = currentModel;
        if (currentProviderDisplay) currentProviderDisplay.textContent = currentProvider;
        if (currentModelDisplay) currentModelDisplay.textContent = currentModel;
        if (providerSelectEl) providerSelectEl.value = currentProvider;
        
        // Populate model dropdown for current provider
        await updateModelDropdown(currentProvider);
        
    } catch (error) {
        console.error('[Dashboard] Failed to get current model:', error);
        // Don't crash the whole page - just log the error
        console.warn('[Dashboard] Model display may be incomplete');
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

// Session Management
let availableSessions = [];

async function fetchSessions() {
    // Try gateway first if connected (direct RPC call)
    if (gateway && gateway.isConnected()) {
        try {
            // Fetch all sessions without label filter
            // Note: gateway's label filter checks entry.label but dashboard sessions have origin.label
            // Don't pass label parameter at all - empty string fails validation
            const result = await gateway.listSessions({});
            let sessions = result?.sessions || [];

            // Filter on client side: include sessions with origin.label matching "SoLoBot Dashboard"
            // or sessions without any label/origin (custom dashboard sessions)
            const dashboardLabel = 'SoLoBot Dashboard';
            sessions = sessions.filter(s => {
                // Include if origin.label matches
                if (s.origin?.label === dashboardLabel) return true;
                // Include if entry.label matches (older format)
                if (s.label === dashboardLabel) return true;
                // Include sessions created with custom keys from dashboard (no label/origin)
                // These are direct sessions without group info
                if (s.kind === 'direct' && !s.origin?.label && !s.label) return true;
                return false;
            });

            // Map gateway response to expected format
            // Always use friendly name for display (strips agent:main: prefix)
            availableSessions = sessions.map(s => {
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

            console.log(`[Dashboard] Fetched ${availableSessions.length} sessions from gateway (filtered from ${result?.sessions?.length || 0} total)`);
            populateSessionDropdown();
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
        availableSessions = data.sessions || [];
        console.log(`[Dashboard] Fetched ${availableSessions.length} sessions from server`);
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
    
    if (availableSessions.length === 0) {
        menu.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 13px;">No sessions available</div>';
        return;
    }
    
    menu.innerHTML = availableSessions.map(s => {
        const isActive = s.key === currentSessionName;
        const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : '';
        const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
        
        return `
        <div class="session-dropdown-item ${isActive ? 'active' : ''}" onclick="if(event.target.closest('.session-edit-btn')) return; switchToSession('${s.key}')">
            <div class="session-info">
                <div class="session-name">${escapeHtml(s.displayName || s.name)}</div>
                <div class="session-meta">${dateStr} ${timeStr} • ${s.totalTokens?.toLocaleString() || 0} tokens</div>
            </div>
            <span class="session-model">${s.model}</span>
            <div class="session-actions">
                <button class="session-edit-btn" onclick="editSessionName('${s.key}', '${escapeHtml(s.displayName || s.name)}')" title="Rename session">
                    ✏️
                </button>
            </div>
        </div>
        `;
    }).join('');
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

window.switchToSession = async function(sessionKey) {
    toggleChatPageSessionMenu();
    
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
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;

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
        const nameEl = document.getElementById('chat-page-session-name');
        if (nameEl) {
            const session = availableSessions.find(s => s.key === sessionKey);
            nameEl.textContent = session ? (session.displayName || session.name) : sessionKey;
        }
        // Refresh dropdown to show new selection
        populateSessionDropdown();

        showToast(`Switched to ${getFriendlySessionName(sessionKey)}`, 'success');
    } catch (e) {
        console.error('[Dashboard] Failed to switch session:', e);
        showToast('Failed to switch session', 'error');
    }
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
            
            // Update session name displays (use friendly name without agent prefix)
            currentSessionName = sessionKey;
            const friendlyName = getFriendlySessionName(sessionKey);
            const nameEl = document.getElementById('current-session-name');
            if (nameEl) nameEl.textContent = friendlyName;
            const chatPageNameEl = document.getElementById('chat-page-session-name');
            if (chatPageNameEl) chatPageNameEl.textContent = friendlyName;
            
            checkRestartToast();

            // Load chat history on connect
            // Capture session version to detect stale responses after session switch
            const loadVersion = sessionVersion;
            gateway.loadHistory().then(result => {
                // Ignore if session changed during async load
                if (loadVersion !== sessionVersion) {
                    console.log(`[Dashboard] Ignoring stale history (version ${loadVersion} != ${sessionVersion})`);
                    return;
                }
                if (result?.messages) {
                    // Only do full replacement if chat is empty (first load)
                    if (!state.chat?.messages?.length) {
                        loadHistoryMessages(result.messages);
                    } else {
                        // On reconnect, only merge new messages - don't replace
                        mergeHistoryMessages(result.messages);
                    }
                }
            }).catch(() => {
                // History load failed - not critical
            });

            // Poll history periodically to catch user messages from other clients
            // (Gateway doesn't broadcast user messages as events, only assistant messages)
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
        onError: (error) => {
            console.error(`[Dashboard] Gateway error: ${error}`);
            updateConnectionUI('error', error);
        }
    });
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
    
    // Track the current model being used for responses
    if (model) {
        window._lastResponseModel = model;
        window._lastResponseProvider = provider;
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

    messages.forEach(msg => {
        // Skip tool results and tool calls - only show actual text responses
        if (msg.role === 'toolResult' || msg.role === 'tool') {
            return;
        }
        
        let textContent = '';
        if (msg.content) {
            for (const part of msg.content) {
                // Only extract actual text, skip tool calls
                if (part.type === 'text') {
                    textContent += part.text || '';
                }
            }
        }

        const message = {
            id: msg.id || 'm' + Date.now() + Math.random(),
            from: msg.role === 'user' ? 'user' : 'solobot',
            text: textContent,
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

function startHistoryPolling() {
    stopHistoryPolling(); // Clear any existing interval

    // Poll every 10 seconds to catch user messages from other clients
    // Increased interval and added buffer to prevent race conditions
    historyPollInterval = setInterval(() => {
        // Skip if not connected, processing, or just finished processing (3 second buffer)
        if (!gateway || !gateway.isConnected() || isProcessing) return;
        if (Date.now() - lastProcessingEndTime < 3000) return;

        // Capture session version to detect stale responses
        const pollVersion = sessionVersion;
        gateway.loadHistory().then(result => {
            // Ignore if session changed during async load
            if (pollVersion !== sessionVersion) {
                console.log(`[Dashboard] Ignoring stale poll history (version ${pollVersion} != ${sessionVersion})`);
                return;
            }
            if (result?.messages) {
                mergeHistoryMessages(result.messages);
            }
        }).catch(() => {
            // History poll failed - not critical
        });
    }, 10000);
}

function stopHistoryPolling() {
    if (historyPollInterval) {
        clearInterval(historyPollInterval);
        historyPollInterval = null;
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
            let textContent = '';
            if (msg.content) {
                for (const part of msg.content) {
                    if (part.type === 'text') {
                        textContent += part.text || '';
                    }
                }
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

        renderChat();
        renderChatPage();
        renderSystemPage();
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
    
    render({ includeSystem: true }); // Initial render includes system page
    updateLastSync();

    // Initialize Gateway client
    initGateway();

    // Populate saved gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 443;
    if (tokenEl) tokenEl.value = GATEWAY_CONFIG.token || '';
    if (sessionEl) sessionEl.value = GATEWAY_CONFIG.sessionKey || 'main';

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

    // Load from VPS first
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            if (!vpsState.tasks) vpsState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!vpsState.tasks.archive) vpsState.tasks.archive = [];

            // Don't overwrite pendingChat
            delete vpsState.pendingChat;
            // Don't overwrite chat - it's session-specific and comes from Gateway
            delete vpsState.chat;

            state = {
                ...state,
                ...vpsState,
                chat: currentChat,  // Keep current session's chat
                system: currentSystem,  // Keep system messages local
                console: currentConsole  // Keep terminal logs local
            };
            delete state.localModified;

            // Save state to localStorage (without overwriting chat)
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
        // Keep local-only data
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
        const response = await fetch(SYNC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        
        if (response.ok) {
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
        // Show first image in local preview, note if there are more
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        addLocalChatMessage(displayText, 'user', imagesToSend[0].data);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    clearImagePreviews();

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
    
    // Handle both (text, from, image) and (text, from, model) call signatures
    // If third param is a string that looks like a model name, treat it as model
    let image = null;
    let messageModel = model;
    if (imageOrModel && typeof imageOrModel === 'string') {
        if (imageOrModel.includes('/') || imageOrModel.includes('claude') || imageOrModel.includes('gpt') || imageOrModel.includes('MiniMax')) {
            messageModel = imageOrModel;
        } else if (imageOrModel.startsWith('data:')) {
            image = imageOrModel;
        }
    }

    const message = {
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now(),
        image: image,
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
        nameSpan.textContent = msg.isStreaming ? 'SoLoBot (typing...)' : 'SoLoBot';
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

    // Image if present - small thumbnail
    if (msg.image) {
        const img = document.createElement('img');
        img.src = msg.image;
        img.style.maxWidth = '150px';
        img.style.maxHeight = '100px';
        img.style.borderRadius = 'var(--radius-md)';
        img.style.marginBottom = 'var(--space-2)';
        img.style.cursor = 'pointer';
        img.style.objectFit = 'cover';
        img.style.border = '1px solid var(--border-default)';
        img.onclick = () => openImageModal(msg.image);
        bubble.appendChild(img);
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
        container.innerHTML = `
            <div class="chat-page-empty">
                <div class="chat-page-empty-icon">💬</div>
                <div class="chat-page-empty-text">
                    ${isConnected 
                        ? 'Start a conversation with SoLoBot' 
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
    
    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';
    const isBot = !isUser && !isSystem;
    
    // Message wrapper
    const wrapper = document.createElement('div');
    wrapper.className = `chat-page-message ${msg.from}${msg.isStreaming ? ' streaming' : ''}`;
    
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'chat-page-bubble';
    
    // Image if present
    if (msg.image) {
        const img = document.createElement('img');
        img.src = msg.image;
        img.className = 'chat-page-bubble-image';
        img.onclick = () => openImageModal(msg.image);
        bubble.appendChild(img);
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
        sender.textContent = msg.isStreaming ? 'SoLoBot is typing...' : 'SoLoBot';
    }
    
    const time = document.createElement('span');
    time.className = 'chat-page-bubble-time';
    time.textContent = formatTime(msg.time);
    
    header.appendChild(sender);
    header.appendChild(time);
    bubble.appendChild(header);
    
    // Content
    const content = document.createElement('div');
    content.className = 'chat-page-bubble-content';
    content.textContent = msg.text;
    bubble.appendChild(content);
    
    wrapper.appendChild(bubble);
    return wrapper;
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
        addLocalChatMessage(displayText, 'user', imagesToSend[0].data);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    clearChatPageImagePreviews();
    
    // Force scroll to bottom when user sends
    chatPageUserScrolled = false;
    
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

window.startNewSession = async function() {
    // Generate a new session name: "Dashboard" + timestamp
    const now = new Date();
    const timestamp = now.toISOString().slice(5, 16).replace('T', '-').replace(':', ''); // MM-DD-HHMM
    const defaultName = `Dashboard-${timestamp}`;

    const newSessionKey = prompt('Enter name for new session:', defaultName);
    if (!newSessionKey || !newSessionKey.trim()) return;

    const sessionKey = newSessionKey.trim();

    // Check if session already exists
    if (availableSessions.some(s => s.key === sessionKey)) {
        showToast(`Session "${sessionKey}" already exists. Switching to it.`, 'info');
        await switchToSession(sessionKey);
        return;
    }

    showToast(`Creating new session "${sessionKey}"...`, 'info');

    // Increment session version to invalidate any in-flight history loads
    sessionVersion++;
    console.log(`[Dashboard] Session version now ${sessionVersion} (new session)`);

    // Clear local chat and cache
    console.log(`[Dashboard] Clearing chat (had ${state.chat.messages.length} messages)`);
    state.chat.messages = [];
    state.system.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;
    localStorage.removeItem('solobot-chat-messages');
    console.log(`[Dashboard] Chat cleared, now ${state.chat.messages.length} messages`);

    // Render immediately to show empty chat
    renderChat();
    renderChatPage();

    // Switch gateway to new session - need to reconnect with new session key
    currentSessionName = sessionKey;
    GATEWAY_CONFIG.sessionKey = sessionKey;

    // Update session input field (so connectToGateway uses it)
    const sessionInput = document.getElementById('gateway-session');
    if (sessionInput) sessionInput.value = sessionKey;

    // Update session display
    const nameEl = document.getElementById('chat-page-session-name');
    if (nameEl) nameEl.textContent = sessionKey;

    // Disconnect and reconnect with new session key
    if (gateway && gateway.isConnected()) {
        gateway.disconnect();
        // Short delay then reconnect
        await new Promise(resolve => setTimeout(resolve, 300));
        connectToGateway();  // This uses GATEWAY_CONFIG.sessionKey
    }

    // Refresh sessions list to include the new one
    await fetchSessions();
    populateSessionDropdown();

    renderChat();
    renderChatPage();
    renderSystemPage();

    showToast(`New session "${sessionKey}" created`, 'success');
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

function renderTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        const container = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
        const count = document.getElementById(`${column === 'progress' ? 'progress' : column}-count`);

        container.innerHTML = state.tasks[column].map((task, index) => {
            const isSelected = selectedTasks.has(task.id);
            const doneStyle = column === 'done' ? 'text-decoration: line-through; color: var(--text-muted);' : '';
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
                            <span class="badge ${getPriorityBadgeClass(task.priority)}">P${task.priority}</span>
                        </div>
                        <div class="task-meta">
                            #${index + 1} • ${formatTime(task.created || task.completedAt || task.id?.replace('t',''))}
                            ${task.description ? ' • 📝' : ''}
                            ${task.images?.length ? ` • 📎${task.images.length}` : ''}
                        </div>
                    </div>
                </div>

                <div class="task-quick-actions">
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

        count.textContent = state.tasks[column].length;
    });
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
    renderBulkActionBar();
}

function selectAllTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        state.tasks[column].forEach(task => selectedTasks.add(task.id));
    });
    renderTasks();
    renderBulkActionBar();
}

function clearSelection() {
    selectedTasks.clear();
    renderTasks();
    renderBulkActionBar();
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
    };
}