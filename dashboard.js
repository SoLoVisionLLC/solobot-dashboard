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
                console.log(`[Dashboard] Restored ${state.system.messages.length} system messages from localStorage`);
            }
        }

        // Chat messages - try localStorage first, then fetch from server
        const savedChat = localStorage.getItem('solobot-chat-messages');
        if (savedChat) {
            const parsed = JSON.parse(savedChat);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const cutoff = Date.now() - (24 * 60 * 60 * 1000);
                state.chat.messages = parsed.filter(m => m.time > cutoff);
                console.log(`[Dashboard] Restored ${state.chat.messages.length} chat messages from localStorage`);
                return; // Have local messages, no need to fetch from server
            }
        }
        
        // No local messages - fetch from server
        loadChatFromServer();
    } catch (e) {
        console.log('[Dashboard] Failed to load persisted messages:', e.message);
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
            console.log(`[Dashboard] Loaded ${state.chat.messages.length} chat messages from server`);
            // Re-render if on chat page
            if (typeof renderChatMessages === 'function') renderChatMessages();
            if (typeof renderChatPage === 'function') renderChatPage();
        }
    } catch (e) {
        console.log('[Dashboard] Failed to load chat from server:', e.message);
    }
}

// Save system messages to localStorage (chat is synced via Gateway)
function persistSystemMessages() {
    try {
        // Only persist system messages - they're local UI noise (limit to 30 to save space)
        const systemToSave = state.system.messages.slice(-30);
        localStorage.setItem('solobot-system-messages', JSON.stringify(systemToSave));
    } catch (e) {
        console.log('[Dashboard] Failed to persist system messages:', e.message);
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
        console.log('[Dashboard] Failed to persist chat messages:', e.message);
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
            console.log('[Dashboard] Chat server sync failed:', e.message);
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
    console.log('[Dashboard] loadGatewaySettingsFromServer called');
    console.log('[Dashboard] state.gatewayConfig:', state.gatewayConfig);
    
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
        
        console.log('[Dashboard] ✓ Loaded gateway settings from server:', GATEWAY_CONFIG.host);
    } else {
        console.log('[Dashboard] ✗ No gateway config in server state');
    }
}

// Gateway client instance
let gateway = null;
let streamingText = '';
let isProcessing = false;
let lastProcessingEndTime = 0; // Track when processing ended to avoid poll conflicts
let historyPollInterval = null;

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set();
let editingTaskId = null;
let currentModalTask = null;
let currentModalColumn = null;
let refreshIntervalId = null;

// DEBUG: Set to true to disable all filtering and show EVERYTHING in chat
const DISABLE_SYSTEM_FILTER = false;

// Classify messages as system/heartbeat noise vs real chat
function isSystemMessage(text, from) {
    // DEBUG MODE: Show everything in chat
    if (DISABLE_SYSTEM_FILTER) {
        console.log('[isSystemMessage] FILTER DISABLED - routing all to CHAT');
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

function initGateway() {
    gateway = new GatewayClient({
        sessionKey: GATEWAY_CONFIG.sessionKey,
        onConnected: (serverName, sessionKey) => {
            console.log(`[Dashboard] Connected to ${serverName}, session: ${sessionKey}`);
            updateConnectionUI('connected', serverName);
            GATEWAY_CONFIG.sessionKey = sessionKey;

            // Load chat history on connect
            // Use mergeHistoryMessages (additive) instead of loadHistoryMessages (replacement)
            // to prevent losing messages during reconnections
            gateway.loadHistory().then(result => {
                if (result?.messages) {
                    // Only do full replacement if chat is empty (first load)
                    if (!state.chat?.messages?.length) {
                        loadHistoryMessages(result.messages);
                    } else {
                        // On reconnect, only merge new messages - don't replace
                        console.log('[Dashboard] Reconnect detected - using merge instead of replace');
                        mergeHistoryMessages(result.messages);
                    }
                }
            }).catch(err => {
                console.log('[Dashboard] chat.history failed:', err.message);
            });

            // Poll history periodically to catch user messages from other clients
            // (Gateway doesn't broadcast user messages as events, only assistant messages)
            startHistoryPolling();
        },
        onDisconnected: (message) => {
            console.log(`[Dashboard] Disconnected: ${message}`);
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
        alert('Please enter a gateway host in Settings');
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
    const { state: eventState, content, role, errorMessage } = event;

    // Log for debugging - full details
    console.log('[Dashboard] handleChatEvent called:', JSON.stringify({
        eventState,
        role,
        contentLength: content?.length,
        contentPreview: content?.substring(0, 100),
        errorMessage
    }));

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
    console.log('[Dashboard] Processing assistant message, state:', eventState);
    switch (eventState) {
        case 'delta':
            // Streaming response - content is cumulative, so REPLACE not append
            console.log('[Dashboard] delta - updating stream:', content?.length, 'chars');
            
            // Safety: If we have significant streaming content and new content is much shorter,
            // this might be a new response starting. Finalize the old one first.
            if (streamingText && streamingText.length > 100 && content.length < streamingText.length * 0.5) {
                console.log('[Dashboard] New response detected mid-stream, finalizing previous');
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
            console.log('[Dashboard] final - content:', finalContent?.length, 'chars, role:', role);
            if (finalContent && role !== 'user') {
                // Check for duplicate - same content within 10 seconds
                const isDuplicate = state.chat.messages.some(m =>
                    m.from === 'solobot' && m.text === finalContent && (Date.now() - m.time) < 10000
                );
                if (!isDuplicate) {
                    console.log('[Dashboard] Adding final message to chat');
                    addLocalChatMessage(finalContent, 'solobot');
                } else {
                    console.log('[Dashboard] Skipping duplicate message');
                }
            } else {
                console.log('[Dashboard] Skipping final message - no content or user role');
            }
            streamingText = '';
            isProcessing = false;
            lastProcessingEndTime = Date.now();
            renderChat();
            renderChatPage();
            break;

        case 'error':
            console.log('[Dashboard] error state:', errorMessage);
            addLocalChatMessage(`Error: ${errorMessage || 'Unknown error'}`, 'system');
            streamingText = '';
            isProcessing = false;
            lastProcessingEndTime = Date.now();
            renderChat();
            renderChatPage();
            break;

        default:
            console.log('[Dashboard] Unknown event state:', eventState);
    }
}

function loadHistoryMessages(messages) {
    // Convert gateway history format and classify as chat vs system
    // IMPORTANT: Preserve ALL local messages since Gateway doesn't save user messages (bug #5735)
    const allLocalChatMessages = state.chat.messages.filter(m => m.id.startsWith('m'));

    const chatMessages = [];
    const systemMessages = [];

    messages.forEach(msg => {
        let textContent = '';
        if (msg.content) {
            for (const part of msg.content) {
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

        gateway.loadHistory().then(result => {
            if (result?.messages) {
                mergeHistoryMessages(result.messages);
            }
        }).catch(err => {
            console.log('[Dashboard] History poll failed:', err.message);
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
    // Merge new messages from history without duplicates, classify as chat vs system
    // This catches user messages from other clients that weren't broadcast as events
    const existingIds = new Set(state.chat.messages.map(m => m.id));
    const existingSystemIds = new Set(state.system.messages.map(m => m.id));
    let newChatCount = 0;
    let newSystemCount = 0;

    for (const msg of messages) {
        const msgId = msg.id || 'm' + msg.timestamp;

        // Skip if already exists in either array
        if (existingIds.has(msgId) || existingSystemIds.has(msgId)) {
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

            // Only add if we have content
            if (textContent) {
                const message = {
                    id: msgId,
                    from: msg.role === 'user' ? 'user' : 'solobot',
                    text: textContent,
                    time: msg.timestamp || Date.now()
                };

                // Classify and route
                if (isSystemMessage(textContent, message.from)) {
                    state.system.messages.push(message);
                    newSystemCount++;
                } else {
                    state.chat.messages.push(message);
                    existingIds.add(msgId);
                    newChatCount++;
                }
            }
        }
    }

    if (newChatCount > 0 || newSystemCount > 0) {
        console.log(`[Dashboard] Merged ${newChatCount} chat, ${newSystemCount} system messages from history`);

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

            // MERGE chat from VPS with current local chat (for cross-computer sync)
            const vpsChat = vpsState.chat?.messages || [];
            const localChat = currentChat?.messages || [];
            
            // Merge and deduplicate by ID
            const allChatIds = new Set();
            const mergedChat = [];
            
            // Add VPS messages first (they may have older messages from other computers)
            for (const msg of vpsChat) {
                if (msg.id && !allChatIds.has(msg.id)) {
                    allChatIds.add(msg.id);
                    mergedChat.push(msg);
                }
            }
            
            // Add local messages (dedup)
            for (const msg of localChat) {
                if (msg.id && !allChatIds.has(msg.id)) {
                    allChatIds.add(msg.id);
                    mergedChat.push(msg);
                }
            }
            
            // Sort by time and trim
            mergedChat.sort((a, b) => (a.time || 0) - (b.time || 0));
            const finalChat = mergedChat.slice(-200); // Keep last 200
            
            // Don't overwrite pendingChat
            delete vpsState.pendingChat;

            state = { 
                ...state, 
                ...vpsState, 
                chat: { messages: finalChat },
                system: currentSystem,  // Keep system messages local
                console: currentConsole  // Keep terminal logs local
            };
            delete state.localModified;
            
            // Save merged chat to localStorage
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
            persistChatMessages(); // Also persist to dedicated chat storage
            
            console.log('Loaded state from VPS (chat preserved)');
            return;
        }
    } catch (e) {
        console.log('VPS not available:', e.message);
    }

    // Fallback: localStorage
    const localSaved = localStorage.getItem('solovision-dashboard');
    if (localSaved) {
        const parsed = JSON.parse(localSaved);
        // Keep local-only data
        delete parsed.system;
        delete parsed.console;
        state = { ...state, ...parsed, chat: currentChat, system: currentSystem, console: currentConsole };
        console.log('Loaded state from localStorage (chat/console preserved)');
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
    syncToServer();
}

async function syncToServer() {
    try {
        const response = await fetch(SYNC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        
        if (response.ok) {
            console.log('Synced to server');
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

// Image handling
let pendingImage = null;

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        processImageFile(file);
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
            console.log(`[Dashboard] Image compressed: ${Math.round(dataUrl.length/1024)}KB -> ${Math.round(compressed.length/1024)}KB`);
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
        
        pendingImage = {
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        };
        showImagePreview(pendingImage.data);
    };
    reader.readAsDataURL(file);
}

function showImagePreview(dataUrl) {
    const container = document.getElementById('image-preview-container');
    const img = document.getElementById('image-preview');
    if (container && img) {
        img.src = dataUrl;
        container.classList.remove('hidden');
    }
}

function clearImagePreview() {
    pendingImage = null;
    const container = document.getElementById('image-preview-container');
    const input = document.getElementById('image-upload');
    if (container) container.classList.add('hidden');
    if (input) input.value = '';
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && !pendingImage) return;

    if (!gateway || !gateway.isConnected()) {
        alert('Not connected to Gateway. Please connect first.');
        return;
    }

    // Build message with optional image
    let messageText = text;
    let imageData = null;
    
    if (pendingImage) {
        imageData = pendingImage.data;
        // Add image indicator to local display
        addLocalChatMessage(text || '📷 Image', 'user', imageData);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    clearImagePreview();

    // Send via Gateway WebSocket
    try {
        if (imageData) {
            // Send with image attachment
            await gateway.sendMessageWithImage(text || 'Image', imageData);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send message:', err);
        addLocalChatMessage(`Failed to send: ${err.message}`, 'system');
    }
}

function addLocalChatMessage(text, from, image = null) {
    if (!state.chat) state.chat = { messages: [] };
    if (!state.system) state.system = { messages: [] };

    const message = {
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now(),
        image: image
    };

    const isSystem = isSystemMessage(text, from);
    const preview = text.substring(0, 80) + (text.length > 80 ? '...' : '');

    console.log(`[addLocalChatMessage] from: ${from}, isSystem: ${isSystem}, text: "${preview}"`);

    // Route to appropriate message array
    if (isSystem) {
        // System message - goes to system tab (local UI noise)
        console.log(`[addLocalChatMessage] → SYSTEM tab (${state.system.messages.length} total)`);
        state.system.messages.push(message);
        if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }
        persistSystemMessages(); // Persist system messages locally
        renderSystemPage();
    } else {
        // Real chat message - goes to chat tab (synced via Gateway)
        console.log(`[addLocalChatMessage] → CHAT tab (${state.chat.messages.length} total)`);
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
            console.log('[Dashboard] Chat synced to VPS for cross-computer access');
        } catch (e) {
            console.log('[Dashboard] Chat sync failed:', e.message);
        }
    }, 2000);
}

// ===================
// CHAT RENDERING (Clean rewrite)
// ===================

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const messages = state.chat?.messages || [];
    const isConnected = gateway?.isConnected();

    console.log(`[renderChat] Rendering ${messages.length} chat messages, streaming: ${!!streamingText}`);
    
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
let chatPagePendingImage = null;
let chatPageScrollPosition = null;
let chatPageUserScrolled = false;
let chatPageNewMessageCount = 0;

// Save scroll position to sessionStorage
function saveChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (container) {
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
        
        // Save position periodically
        saveChatScrollPosition();
    });
    
    container.dataset.scrollListenerAttached = 'true';
}

function renderChatPage() {
    const container = document.getElementById('chat-page-messages');
    if (!container) {
        console.log('[renderChatPage] ❌ Container #chat-page-messages not found!');
        return;
    }

    console.log(`[renderChatPage] Rendering ${state.chat?.messages?.length || 0} messages to Chat PAGE`);

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
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        processChatPageImageFile(file);
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
        
        chatPagePendingImage = {
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        };
        showChatPageImagePreview(chatPagePendingImage.data);
    };
    reader.readAsDataURL(file);
}

function showChatPageImagePreview(dataUrl) {
    const container = document.getElementById('chat-page-image-preview');
    const img = document.getElementById('chat-page-image-preview-img');
    if (container && img) {
        img.src = dataUrl;
        container.classList.remove('hidden');
    }
}

function clearChatPageImagePreview() {
    chatPagePendingImage = null;
    const container = document.getElementById('chat-page-image-preview');
    const input = document.getElementById('chat-page-image-upload');
    if (container) container.classList.add('hidden');
    if (input) input.value = '';
}

async function sendChatPageMessage() {
    const input = document.getElementById('chat-page-input');
    const text = input.value.trim();
    if (!text && !chatPagePendingImage) return;
    
    if (!gateway || !gateway.isConnected()) {
        alert('Not connected to Gateway. Please connect first in Settings.');
        return;
    }
    
    let imageData = null;
    
    if (chatPagePendingImage) {
        imageData = chatPagePendingImage.data;
        addLocalChatMessage(text || '📷 Image', 'user', imageData);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    clearChatPageImagePreview();
    
    // Force scroll to bottom when user sends
    chatPageUserScrolled = false;
    
    // Render both areas
    renderChat();
    renderChatPage();
    
    // Send via Gateway
    try {
        if (imageData) {
            await gateway.sendMessageWithImage(text || 'Image', imageData);
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

async function clearChatHistory() {
    const confirmed = await showConfirm(
        'Clear Chat History',
        'Clear all chat messages? They may reload from Gateway on next sync.',
        'Clear',
        'Cancel',
        true
    );
    
    if (confirmed) {
        state.chat.messages = [];
        chatPageNewMessageCount = 0;
        chatPageUserScrolled = false;
        renderChat();
        renderChatPage();
    }
}

async function startNewSession() {
    const confirmed = await showConfirm(
        'Start New Session',
        'This will clear all chat history and reconnect to the gateway. Continue?',
        'Start New',
        'Cancel',
        false
    );
    
    if (!confirmed) return;
    
    // Clear local chat
    state.chat.messages = [];
    state.system.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;
    
    // Clear localStorage
    localStorage.removeItem('solobot-chat-messages');
    localStorage.removeItem('solobot-system-messages');
    
    // Clear VPS chat state
    fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: { messages: [] } })
    }).catch(() => {});
    
    // Disconnect and reconnect gateway
    if (gateway && gateway.isConnected()) {
        disconnectFromGateway();
        setTimeout(() => {
            connectToGateway();
        }, 500);
    }
    
    renderChat();
    renderChatPage();
    renderSystemPage();
    
    console.log('[Dashboard] Started new session');
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

function clearSystemHistory() {
    if (confirm('Clear all system messages?')) {
        state.system.messages = [];
        persistSystemMessages();
        renderSystemPage();
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

    // Use design system status-dot classes
    indicator.className = 'status-dot';
    switch(state.status) {
        case 'working':
            indicator.classList.add('success', 'pulse');
            text.textContent = 'WORKING';
            break;
        case 'thinking':
            indicator.classList.add('warning', 'pulse');
            text.textContent = 'THINKING';
            break;
        case 'offline':
            indicator.classList.add('error');
            text.textContent = 'OFFLINE';
            break;
        default:
            indicator.classList.add('success');
            text.textContent = 'IDLE';
    }

    modelEl.textContent = state.model || 'opus 4.5';

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
            <div class="task-card priority-p${task.priority} ${isSelected ? 'selected' : ''}"
                 data-task-id="${task.id}" data-column="${column}"
                 draggable="true"
                 ondragstart="handleDragStart(event, '${task.id}', '${column}')"
                 ondragend="handleDragEnd(event)"
                 onclick="openActionModal('${task.id}', '${column}')">
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
                        <div class="task-meta">#${index + 1} • ${formatTime(task.created || task.completedAt || task.id?.replace('t',''))}</div>
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

function openSettingsModal() {
    showModal('settings-modal');

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

function clearArchive() {
    if (confirm('Delete all archived tasks permanently?')) {
        state.tasks.archive = [];
        saveState('Cleared archive');
        renderArchive();
        updateArchiveBadge();
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
    // Settings are stored in localStorage
    localStorage.setItem(`setting_${key}`, JSON.stringify(value));
    console.log(`Setting ${key} = ${value}`);
}

function resetToServerState() {
    if (confirm('This will reload all data from the server. Continue?')) {
        localStorage.removeItem('solovision-dashboard');
        location.reload();
    }
}

function clearAllData() {
    if (confirm('This will delete ALL local data. Are you sure?')) {
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
                <button onclick="window.acknowledgeUpdate && window.acknowledgeUpdate('${escapeHtml(filePath)}')" 
                        class="btn btn-ghost" style="margin-left: 8px; font-size: 12px;">
                    ✓ Mark as Read
                </button>
            `;
        } else {
            titleEl.textContent = data.name;
        }
        
        // Load version history (function from docs-hub-memory-files.js)
        if (typeof window.loadVersionHistory === 'function') {
            console.log('[Dashboard] Calling loadVersionHistory for:', filePath);
            window.loadVersionHistory(filePath);
        } else {
            console.warn('[Dashboard] loadVersionHistory not found!');
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
        alert(`Failed to save: ${error.message}`);
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