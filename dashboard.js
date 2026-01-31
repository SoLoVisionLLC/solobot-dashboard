// SoLoVision Command Center Dashboard
// Version: 3.1.0 - Gateway WebSocket Chat (mirrors Android app)

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
        messages: []
    }
};

// Gateway connection configuration
const GATEWAY_CONFIG = {
    host: localStorage.getItem('gateway_host') || '',
    port: parseInt(localStorage.getItem('gateway_port')) || 443,
    token: localStorage.getItem('gateway_token') || '',
    sessionKey: localStorage.getItem('gateway_session') || 'main',
    maxMessages: 100
};

// Gateway client instance
let gateway = null;
let streamingText = '';
let isProcessing = false;

let newTaskPriority = 1;
let newTaskColumn = 'todo';
let selectedTasks = new Set();
let editingTaskId = null;
let currentModalTask = null;
let currentModalColumn = null;
let refreshIntervalId = null;

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

let historyPollInterval = null;

function initGateway() {
    gateway = new GatewayClient({
        sessionKey: GATEWAY_CONFIG.sessionKey,
        onConnected: (serverName, sessionKey) => {
            console.log(`[Dashboard] Connected to ${serverName}, session: ${sessionKey}`);
            updateConnectionUI('connected', serverName);
            GATEWAY_CONFIG.sessionKey = sessionKey;

            // Load chat history
            gateway.loadHistory().then(result => {
                if (result?.messages) {
                    loadHistoryMessages(result.messages);
                }
            });

            // Poll for new messages from other clients every 3 seconds
            if (historyPollInterval) clearInterval(historyPollInterval);
            historyPollInterval = setInterval(pollChatHistory, 3000);
        },
        onDisconnected: (message) => {
            console.log(`[Dashboard] Disconnected: ${message}`);
            updateConnectionUI('disconnected', message);
            isProcessing = false;
            streamingText = '';
            // Stop polling when disconnected
            if (historyPollInterval) {
                clearInterval(historyPollInterval);
                historyPollInterval = null;
            }
        },
        onChatEvent: (event) => {
            handleChatEvent(event);
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

    // Save settings
    GATEWAY_CONFIG.host = host;
    GATEWAY_CONFIG.port = port;
    GATEWAY_CONFIG.token = token;
    GATEWAY_CONFIG.sessionKey = sessionKey;
    localStorage.setItem('gateway_host', host);
    localStorage.setItem('gateway_port', port.toString());
    localStorage.setItem('gateway_token', token);
    localStorage.setItem('gateway_session', sessionKey);

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

    // Get color class based on status
    const getColorClass = () => {
        switch (status) {
            case 'connected': return 'bg-green-500';
            case 'connecting': return 'bg-yellow-500 animate-pulse';
            case 'error': return 'bg-red-500';
            default: return 'bg-gray-500';
        }
    };

    const colorClass = getColorClass();

    // Update chat header dot (w-2 h-2)
    if (statusDot) {
        statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
    }

    // Update settings modal dot (w-3 h-3)
    if (settingsDot) {
        settingsDot.className = `w-3 h-3 rounded-full ${colorClass}`;
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
}

function handleChatEvent(event) {
    const { state: eventState, content, role, errorMessage } = event;

    // Log for debugging
    console.log('[Dashboard] Chat event:', { eventState, role, content: content?.substring(0, 50) });

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
            // Streaming response
            streamingText += content;
            isProcessing = true;
            renderChat();
            break;

        case 'final':
            // Final response from assistant
            const finalContent = content || streamingText;
            if (finalContent && role !== 'user') {
                addLocalChatMessage(finalContent, 'solobot');
            }
            streamingText = '';
            isProcessing = false;
            renderChat();
            break;

        case 'error':
            addLocalChatMessage(`Error: ${errorMessage || 'Unknown error'}`, 'system');
            streamingText = '';
            isProcessing = false;
            renderChat();
            break;
    }
}

function loadHistoryMessages(messages) {
    // Convert gateway history format to our format
    state.chat.messages = messages.map(msg => {
        let textContent = '';
        if (msg.content) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    textContent += part.text || '';
                }
            }
        }

        return {
            id: msg.id || 'm' + Date.now() + Math.random(),
            from: msg.role === 'user' ? 'user' : 'solobot',
            text: textContent,
            time: msg.timestamp || Date.now()
        };
    });

    renderChat();
}

// ===================
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    render();
    updateLastSync();

    // Initialize Gateway client
    initGateway();

    // Populate saved gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 18789;
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
    document.getElementById('docs-search').addEventListener('input', (e) => {
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
});

// ===================
// DATA PERSISTENCE
// ===================

async function loadState() {
    // Preserve chat messages - they come from Gateway WebSocket, not VPS
    const currentChat = state.chat;

    // Load from VPS first
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (response.ok) {
            const vpsState = await response.json();
            if (!vpsState.tasks) vpsState.tasks = { todo: [], progress: [], done: [], archive: [] };
            if (!vpsState.tasks.archive) vpsState.tasks.archive = [];

            // Don't overwrite chat - it's managed by Gateway now
            delete vpsState.chat;
            delete vpsState.pendingChat;

            state = { ...state, ...vpsState, chat: currentChat };
            delete state.localModified;
            localStorage.setItem('solovision-dashboard', JSON.stringify(state));
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
        // Don't overwrite chat from localStorage either
        delete parsed.chat;
        state = { ...state, ...parsed, chat: currentChat };
        console.log('Loaded state from localStorage (chat preserved)');
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
    
    localStorage.setItem('solovision-dashboard', JSON.stringify(state));
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
                if (state.console.logs.length > 100) {
                    state.console.logs = state.console.logs.slice(-100);
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

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    if (!gateway || !gateway.isConnected()) {
        alert('Not connected to Gateway. Please connect first.');
        return;
    }

    // Add user message to local state immediately
    addLocalChatMessage(text, 'user');
    input.value = '';

    // Send via Gateway WebSocket
    try {
        await gateway.sendMessage(text);
    } catch (err) {
        console.error('Failed to send message:', err);
        addLocalChatMessage(`Failed to send: ${err.message}`, 'system');
    }
}

function addLocalChatMessage(text, from) {
    if (!state.chat) state.chat = { messages: [] };
    
    const message = {
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now()
    };
    
    state.chat.messages.push(message);
    
    // Keep only last N messages
    if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
        state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
    }
    
    renderChat();
}

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const hasMessages = state.chat?.messages?.length > 0;
    const hasStreaming = streamingText.length > 0;

    if (!hasMessages && !hasStreaming) {
        const isConnected = gateway?.isConnected();
        container.innerHTML = `
            <div class="text-gray-500 text-sm text-center py-8">
                ${isConnected
                    ? '💬 Connected! Chat mirrors your Telegram session.'
                    : '🔌 Connect to Gateway to start chatting'}
            </div>
        `;
        return;
    }

    // Check if user is at bottom before rendering
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const wasAtBottom = scrollHeight - scrollTop <= clientHeight + 50;

    let html = state.chat.messages.map(msg => renderChatMessage(msg)).join('');

    // Add streaming message if active
    if (streamingText) {
        html += renderChatMessage({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true
        });
    }

    container.innerHTML = html;

    // Only auto-scroll if user was already at bottom
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

function renderChatMessage(msg) {
    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';
    const timeStr = formatTime(msg.time);

    let bgClass, alignClass, nameClass, name;

    if (isUser) {
        bgClass = 'bg-solo-primary/20 ml-8';
        alignClass = 'text-right';
        nameClass = 'text-solo-primary';
        name = 'You';
    } else if (isSystem) {
        bgClass = 'bg-red-500/10 border border-red-500/20';
        alignClass = 'text-left';
        nameClass = 'text-red-400';
        name = '⚠️ System';
    } else {
        bgClass = msg.isStreaming ? 'bg-slate-700/50 mr-8 border border-slate-600' : 'bg-slate-700 mr-8';
        alignClass = 'text-left';
        nameClass = 'text-green-400';
        name = msg.isStreaming ? '🤖 SoLoBot (typing...)' : '🤖 SoLoBot';
    }

    // Format message with markdown-like support
    let formattedText = formatMarkdown(msg.text);

    return `
        <div class="${bgClass} rounded-lg p-3 ${alignClass} message-item" data-time="${msg.time}">
            <div class="flex items-center gap-2 mb-2 ${isUser ? 'justify-end' : ''}">
                <span class="text-xs ${nameClass} font-medium">${name}</span>
                <span class="text-xs text-gray-500">${timeStr}</span>
            </div>
            <div class="text-sm text-gray-200 leading-relaxed">${formattedText}</div>
        </div>
    `;
}

function formatMarkdown(text) {
    if (!text) return '';

    return text
        // Headers
        .replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-gray-200 mb-2">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-gray-100 mb-3">$1</h2>')
        .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-white mb-4">$1</h1>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gray-100 font-semibold">$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em class="text-gray-300">$1</em>')
        // Code blocks
        .replace(/```([\s\S]*?)```/g, '<pre class="bg-slate-800 p-3 rounded-lg text-sm overflow-x-auto my-3 border border-slate-600"><code class="text-green-400 font-mono">$1</code></pre>')
        // Inline code
        .replace(/`(.+?)`/g, '<code class="bg-slate-700 px-1.5 py-0.5 rounded text-sm text-cyan-400 font-mono">$1</code>')
        // Lists
        .replace(/^[*-] (.+)$/gm, '<li class="ml-4 text-gray-200 list-disc">$1</li>')
        // Links
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-solo-primary hover:text-solo-accent underline">$1</a>')
        // Line breaks
        .replace(/\n/g, '<br>');
}

// ===================
// RENDERING (OTHER FUNCTIONS REMAIN THE SAME)
// ===================

function render() {
    renderStatus();
    renderConsole();
    renderTasks();
    renderNotes();
    renderActivity();
    renderDocs();
    renderChat();
    renderBulkActionBar();
    updateArchiveBadge();
}

function renderStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const modelEl = document.getElementById('model-name');
    const taskEl = document.getElementById('current-task');
    const taskName = document.getElementById('task-name');
    const subagentBanner = document.getElementById('subagent-banner');
    const subagentTask = document.getElementById('subagent-task');
    
    indicator.className = 'w-3 h-3 rounded-full';
    switch(state.status) {
        case 'working':
            indicator.classList.add('bg-green-500', 'status-pulse');
            text.textContent = 'WORKING';
            break;
        case 'thinking':
            indicator.classList.add('bg-yellow-500', 'status-pulse');
            text.textContent = 'THINKING';
            break;
        case 'offline':
            indicator.classList.add('bg-red-500');
            text.textContent = 'OFFLINE';
            break;
        default:
            indicator.classList.add('bg-green-500');
            text.textContent = 'IDLE';
    }
    
    modelEl.textContent = state.model || 'opus 4.5';
    
    const providerEl = document.getElementById('provider-name');
    if (providerEl) {
        providerEl.textContent = state.provider || 'anthropic';
    }
    
    if (state.currentTask) {
        taskEl.classList.remove('hidden');
        taskName.textContent = state.currentTask;
    } else {
        taskEl.classList.add('hidden');
    }
    
    if (state.subagent) {
        subagentBanner.classList.remove('hidden');
        subagentTask.textContent = state.subagent;
    } else {
        subagentBanner.classList.add('hidden');
    }
}

function renderConsole() {
    const live = state.live || { status: 'idle' };
    const consoleData = state.console || { logs: [] };
    
    const statusBadge = document.getElementById('console-status-badge');
    if (statusBadge) {
        const statusConfig = {
            'working': { text: 'WORKING', color: 'bg-green-500/20 text-green-400' },
            'thinking': { text: 'THINKING', color: 'bg-yellow-500/20 text-yellow-400' },
            'idle': { text: 'IDLE', color: 'bg-blue-500/20 text-blue-400' },
            'offline': { text: 'OFFLINE', color: 'bg-gray-500/20 text-gray-400' }
        };
        const config = statusConfig[live.status] || statusConfig['idle'];
        statusBadge.textContent = config.text;
        statusBadge.className = `text-xs px-2 py-0.5 rounded-full ${config.color} font-mono`;
    }
    
    const output = document.getElementById('console-output');
    if (output && consoleData.logs && consoleData.logs.length > 0) {
        output.innerHTML = consoleData.logs.map(log => {
            const timeStr = formatTimeShort(log.time);
            const colorClass = getLogColor(log.type);
            const prefix = getLogPrefix(log.type);
            return `<div class="${colorClass}"><span class="text-gray-600">[${timeStr}]</span> ${prefix}${escapeHtml(log.text)}</div>`;
        }).join('');
        
        output.scrollTop = output.scrollHeight;
    }
}

function renderTasks() {
    ['todo', 'progress', 'done'].forEach(column => {
        const container = document.getElementById(`${column === 'progress' ? 'progress' : column}-tasks`);
        const count = document.getElementById(`${column === 'progress' ? 'progress' : column}-count`);
        
        container.innerHTML = state.tasks[column].map((task, index) => {
            const isSelected = selectedTasks.has(task.id);
            return `
            <div class="task-card bg-solo-dark rounded-lg p-3 priority-p${task.priority} ${isSelected ? 'ring-2 ring-solo-accent' : ''} transition group relative cursor-grab hover:bg-slate-700/50 active:cursor-grabbing" 
                 data-task-id="${task.id}" data-column="${column}"
                 draggable="true"
                 ondragstart="handleDragStart(event, '${task.id}', '${column}')"
                 ondragend="handleDragEnd(event)"
                 onclick="openActionModal('${task.id}', '${column}')">
                <div class="flex items-start gap-3">
                    <input type="checkbox" 
                           class="mt-1 w-4 h-4 rounded border-slate-500 bg-solo-darker text-solo-primary focus:ring-solo-primary cursor-pointer"
                           ${isSelected ? 'checked' : ''}
                           onclick="toggleTaskSelection('${task.id}', event)">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                            <span class="text-sm ${column === 'done' ? 'line-through text-gray-500' : ''}">${escapeHtml(task.title)}</span>
                            <div class="flex items-center gap-1">
                                <span class="text-xs px-1.5 py-0.5 rounded ${getPriorityClass(task.priority)}">P${task.priority}</span>
                            </div>
                        </div>
                        <div class="text-xs text-gray-500 mt-1">#${index + 1} • ${formatTime(task.created)}</div>
                    </div>
                </div>
                
                <div class="task-quick-actions absolute -right-2 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition flex flex-col gap-1">
                    ${column !== 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'done', event)" 
                                class="w-8 h-8 bg-green-600 hover:bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg"
                                title="Mark Done">✓</button>
                    ` : ''}
                    ${column === 'done' ? `
                        <button onclick="quickMoveTask('${task.id}', '${column}', 'todo', event)" 
                                class="w-8 h-8 bg-slate-600 hover:bg-slate-500 rounded-full flex items-center justify-center text-white shadow-lg"
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
        <div class="bg-solo-dark rounded-lg p-3 ${note.seen ? 'opacity-60' : ''}">
            <div class="flex items-start justify-between">
                <span class="text-sm">${escapeHtml(note.text)}</span>
                ${note.seen ? '<span class="text-xs text-green-500">✓ Seen</span>' : '<span class="text-xs text-yellow-500">Pending</span>'}
            </div>
            <div class="text-xs text-gray-500 mt-2">${formatTime(note.created)}</div>
        </div>
    `).join('');
}

function renderActivity() {
    const container = document.getElementById('activity-log');
    container.innerHTML = state.activity.slice().reverse().slice(0, 20).map(entry => `
        <div class="flex items-start gap-3 text-sm">
            <span class="text-gray-500 whitespace-nowrap">${formatTime(entry.time)}</span>
            <span class="${entry.type === 'success' ? 'text-green-400' : entry.type === 'error' ? 'text-red-400' : 'text-gray-300'}">
                ${escapeHtml(entry.action)}
            </span>
        </div>
    `).join('');
}

function renderDocs(filter = '') {
    const container = document.getElementById('docs-grid');
    const filtered = state.docs.filter(doc => 
        doc.name.toLowerCase().includes(filter.toLowerCase())
    );
    
    container.innerHTML = filtered.map(doc => `
        <a href="${doc.url}" target="_blank" class="bg-solo-card rounded-lg p-4 hover:bg-slate-700 transition block">
            <div class="flex items-center gap-3 mb-2">
                ${getDocIcon(doc.type)}
                <span class="font-medium truncate">${escapeHtml(doc.name)}</span>
            </div>
            <div class="text-xs text-gray-500">Updated: ${formatDate(doc.updated)}</div>
        </a>
    `).join('');
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-sm col-span-full">No documents found</div>';
    }
}

// ===================
// UTILITY FUNCTIONS
// ===================

function formatTime(timestamp) {
    const date = new Date(timestamp);
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
    if (p === 0) return 'bg-red-500/20 text-red-400';
    if (p === 1) return 'bg-yellow-500/20 text-yellow-400';
    return 'bg-blue-500/20 text-blue-400';
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

function getDocIcon(type) {
    if (type === 'doc') return '<svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>';
    if (type === 'pdf') return '<svg class="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>';
    return '<svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/></svg>';
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
    
    if (state.activity.length > 100) {
        state.activity = state.activity.slice(-100);
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
        bar.classList.remove('hidden');
        const countEl = bar.querySelector('#selected-count');
        if (countEl) countEl.textContent = selectedTasks.size;
    } else {
        bar.classList.add('hidden');
    }
}

function openSettingsModal() {
    document.getElementById('settings-modal')?.classList.remove('hidden');

    // Populate gateway settings
    const hostEl = document.getElementById('gateway-host');
    const portEl = document.getElementById('gateway-port');
    const tokenEl = document.getElementById('gateway-token');
    const sessionEl = document.getElementById('gateway-session');

    if (hostEl) hostEl.value = GATEWAY_CONFIG.host || '';
    if (portEl) portEl.value = GATEWAY_CONFIG.port || 18789;
    if (tokenEl) tokenEl.value = GATEWAY_CONFIG.token || '';
    if (sessionEl) sessionEl.value = GATEWAY_CONFIG.sessionKey || 'main';
}

function closeSettingsModal() {
    document.getElementById('settings-modal')?.classList.add('hidden');
}

function syncFromVPS() {
    loadState().then(() => {
        render();
        updateLastSync();
    });
}

function openAddTask(column = 'todo') {
    newTaskColumn = column;
    document.getElementById('add-task-modal')?.classList.remove('hidden');
    document.getElementById('new-task-title')?.focus();
}

function closeAddTask() {
    document.getElementById('add-task-modal')?.classList.add('hidden');
    document.getElementById('new-task-title').value = '';
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

    document.getElementById('task-action-modal')?.classList.remove('hidden');
}

function closeActionModal() {
    document.getElementById('task-action-modal')?.classList.add('hidden');
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
    document.getElementById('edit-title-modal')?.classList.remove('hidden');
    document.getElementById('edit-title-input')?.focus();
}

function closeEditTitleModal() {
    document.getElementById('edit-title-modal')?.classList.add('hidden');
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
    document.getElementById('confirm-delete-modal')?.classList.remove('hidden');
}

function closeDeleteModal() {
    document.getElementById('confirm-delete-modal')?.classList.add('hidden');
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

function clearDone() {
    // Move all done tasks to archive
    const doneTasks = state.tasks.done.splice(0);
    state.tasks.archive.push(...doneTasks);
    saveState('Archived done tasks');
    renderTasks();
    updateArchiveBadge();
}

function openArchiveModal() {
    const modal = document.getElementById('archive-modal');
    const list = document.getElementById('archive-tasks-list');
    const countEl = document.getElementById('archive-modal-count');

    if (!modal || !list) return;

    const archived = state.tasks.archive || [];
    countEl.textContent = archived.length;

    list.innerHTML = archived.map(task => `
        <div class="bg-solo-dark rounded-lg p-3 flex items-center justify-between">
            <div>
                <span class="text-sm">${escapeHtml(task.title)}</span>
                <div class="text-xs text-gray-500">${formatTime(task.created)}</div>
            </div>
            <button onclick="restoreFromArchive('${task.id}')"
                    class="text-xs text-solo-primary hover:text-solo-accent px-2 py-1 rounded hover:bg-slate-700">
                Restore
            </button>
        </div>
    `).join('') || '<div class="text-gray-500 text-sm text-center py-8">No archived tasks</div>';

    modal.classList.remove('hidden');
}

function closeArchiveModal() {
    document.getElementById('archive-modal')?.classList.add('hidden');
}

function restoreFromArchive(taskId) {
    const taskIndex = state.tasks.archive.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const [task] = state.tasks.archive.splice(taskIndex, 1);
    state.tasks.todo.push(task);

    saveState('Restored task from archive');
    openArchiveModal(); // Refresh the modal
    renderTasks();
    updateArchiveBadge();
}

function clearArchive() {
    if (confirm('Delete all archived tasks permanently?')) {
        state.tasks.archive = [];
        saveState('Cleared archive');
        openArchiveModal();
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
        state = { ...state, ...newState };
        saveState();
        render();
    }
};