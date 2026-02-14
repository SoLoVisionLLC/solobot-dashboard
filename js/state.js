// js/state.js — Global state, config constants, persistence, chat storage

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


// Global agent color map — reads from CSS variables (--agent-*) defined in themes.css
// Used by phase10-taskboard.js, phase11-agents.js, phase12-analytics.js
const AGENT_COLORS = new Proxy({}, {
    get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        const cached = target[prop];
        if (cached) return cached;
        const val = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${prop}`).trim();
        if (val) target[prop] = val;
        return val || '';
    }
});

function chatStorageKey(sessionKey) {
    const key = sessionKey || GATEWAY_CONFIG?.sessionKey || localStorage.getItem('gateway_session') || 'main';
    return 'solobot-chat-' + key;
}

// In-memory session message cache (avoids full reload on agent switch)
const _sessionMessageCache = new Map();

function cacheSessionMessages(sessionKey, messages) {
    if (!sessionKey || !messages) return;
    _sessionMessageCache.set(sessionKey, messages.slice(-100));
}

function getCachedSessionMessages(sessionKey) {
    return _sessionMessageCache.get(sessionKey) || null;
}

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
            }
        }

        // Chat messages - use session-scoped key
        const currentKey = chatStorageKey();
        const savedChat = localStorage.getItem(currentKey);
        // Also try legacy global key as fallback (one-time migration)
        const legacyChat = !savedChat ? localStorage.getItem('solobot-chat-messages') : null;
        const chatData = savedChat || legacyChat;
        
        if (chatData) {
            const parsed = JSON.parse(chatData);
            if (Array.isArray(parsed) && parsed.length > 0) {
                state.chat.messages = parsed;
                // Migrate legacy key to session-scoped
                if (legacyChat && !savedChat) {
                    localStorage.setItem(currentKey, chatData);
                }
                return;
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
            localStorage.setItem(chatStorageKey(), JSON.stringify(state.chat.messages));
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
        const chatToSave = state.chat.messages.slice(-200);
        // Use session-scoped key so each agent's chat is stored separately
        const key = chatStorageKey();
        localStorage.setItem(key, JSON.stringify(chatToSave));
        // Also update in-memory cache
        cacheSessionMessages(currentSessionName || GATEWAY_CONFIG.sessionKey, chatToSave);
        
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
    maxMessages: 500
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
        return (t.todo?.length || 0) + (t.progress?.length || 0) + (t.done?.length || 0) + (t.archive?.length || 0);
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

            // Server is authoritative for tasks — always use server tasks and version
            // This prevents stale localStorage from overwriting API-driven task moves
            const serverVersion = vpsState._taskVersion || 0;
            const localVersion = state._taskVersion || 0;
            let tasksToUse;
            
            if (serverVersion >= localVersion) {
                // Server is same or newer — use server tasks
                tasksToUse = vpsState.tasks;
                state._taskVersion = serverVersion;
            } else if (localTaskCount > serverTaskCount && localTasks) {
                // Local has genuinely more tasks (new tasks added locally)
                tasksToUse = localTasks;
                state._taskVersion = localVersion;
            } else {
                tasksToUse = vpsState.tasks;
                state._taskVersion = serverVersion;
            }
            
            // Always merge server archive (server is authoritative for archive)
            if ((vpsState.tasks.archive?.length || 0) > (tasksToUse.archive?.length || 0)) {
                tasksToUse.archive = vpsState.tasks.archive;
                const archivedIds = new Set(tasksToUse.archive.map(t => t.id));
                tasksToUse.done = (tasksToUse.done || []).filter(t => !archivedIds.has(t.id));
            }
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

            // If local had more data, push it back to server (only if local version is newer)
            if ((localTaskCount > serverTaskCount && localVersion > serverVersion) || localActivityCount > serverActivityCount) {
                const pushData = {};
                if (localTaskCount > serverTaskCount && localVersion > serverVersion) {
                    pushData.tasks = tasksToUse;
                    pushData._taskVersion = state._taskVersion;
                }
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
            stateForStorage.chat.messages = stateForStorage.chat.messages.slice(-200);
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
        // PROTECTION: Fetch server state first — check version and counts
        let serverTaskCount = 0;
        let serverActivityCount = 0;
        let serverTaskVersion = 0;
        try {
            const checkResp = await fetch('/api/state', { cache: 'no-store' });
            if (checkResp.ok) {
                const serverState = await checkResp.json();
                const st = serverState.tasks || {};
                serverTaskCount = (st.todo?.length || 0) + (st.progress?.length || 0) + (st.done?.length || 0) + (st.archive?.length || 0);
                serverActivityCount = Array.isArray(serverState.activity) ? serverState.activity.length : 0;
                serverTaskVersion = serverState._taskVersion || 0;
                
                // If server has newer task version, pull server tasks into local state
                if (serverTaskVersion > (state._taskVersion || 0)) {
                    console.log(`[Sync] Server tasks are newer (v${serverTaskVersion} > v${state._taskVersion || 0}) — adopting server tasks`);
                    state.tasks = serverState.tasks;
                    state._taskVersion = serverTaskVersion;
                    // Update localStorage with server tasks
                    try { localStorage.setItem('solovision-dashboard', JSON.stringify(state)); } catch(e) {}
                    renderTasks();
                }
            }
        } catch (e) { /* continue with sync */ }

        // Build sync payload — include task version
        const syncPayload = JSON.parse(JSON.stringify(state));
        if (syncPayload.tasks) syncPayload._taskVersion = state._taskVersion || 0;

        const localTaskCount = (state.tasks?.todo?.length || 0) + (state.tasks?.progress?.length || 0) + (state.tasks?.done?.length || 0) + (state.tasks?.archive?.length || 0);
        const localActivityCount = Array.isArray(state.activity) ? state.activity.length : 0;

        if (serverTaskCount > 0 && localTaskCount < serverTaskCount) {
            console.warn(`[Sync] Skipping tasks — server has ${serverTaskCount}, local has ${localTaskCount}`);
            delete syncPayload.tasks;
        }
        // Also skip if server has newer version
        if (serverTaskVersion > (state._taskVersion || 0)) {
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
// DASHBOARD TASKS INITIALIZATION
// ===================

const DASHBOARD_TASKS = [
    // Phase 1: Visual Design Foundation (P0 - critical)
    { phase: 1, num: 1, title: "Implement glassmorphism cards with blur effect", priority: 0 },
    { phase: 1, num: 2, title: "Add sparklines for Quick Stats widget (mini trend graphs)", priority: 0 },
    { phase: 1, num: 3, title: "Replace progress bars with circular progress rings", priority: 0 },
    { phase: 1, num: 4, title: "Add mini heatmaps for activity patterns", priority: 0 },
    
    // Phase 2: Motion & Microinteractions (P0 - critical)
    { phase: 2, num: 1, title: "Widget fade-in animations when data updates", priority: 0 },
    { phase: 2, num: 2, title: "Hover state lift effects on cards", priority: 0 },
    { phase: 2, num: 3, title: "Drag-and-drop snap animations", priority: 0 },
    { phase: 2, num: 4, title: "Loading shimmer effect (replace spinners)", priority: 0 },
    
    // Phase 3: Widget System (P1 - important)
    { phase: 3, num: 1, title: "Make widgets resizable/minimizable", priority: 1 },
    { phase: 3, num: 2, title: "Save layout preferences per user", priority: 1 },
    { phase: 3, num: 3, title: "Drag-to-rearrange bento grid", priority: 1 },
    { phase: 3, num: 4, title: "Focus mode that hides all except active tasks", priority: 1 },
    
    // Phase 4: Context Awareness (P1 - important)
    { phase: 4, num: 1, title: "Time-of-day layout switching (morning/deep work)", priority: 1 },
    { phase: 4, num: 2, title: "Agent-aware layouts (DEV shows terminal, COO shows tasks)", priority: 1 },
    { phase: 4, num: 3, title: "Workflow-aware widget expansion", priority: 1 },
    
    // Phase 5: Command Palette (P1 - important)
    { phase: 5, num: 1, title: "Universal search to jump pages/widgets", priority: 1 },
    { phase: 5, num: 2, title: "Quick actions: create task, switch agent", priority: 1 },
    { phase: 5, num: 3, title: "Search chat history, notes, memory", priority: 1 },
    
    // Phase 6: AI Insights Widget (P1 - important)
    { phase: 6, num: 1, title: "Weekly task completion summary", priority: 1 },
    { phase: 6, num: 2, title: "Agent idle time alerts", priority: 1 },
    { phase: 6, num: 3, title: "Pattern-based suggestions", priority: 1 },
    { phase: 6, num: 4, title: "Natural language summaries", priority: 1 },
    
    // Phase 7: Activity Visualization (P1 - important)
    { phase: 7, num: 1, title: "Live timeline with icons (replace text log)", priority: 1 },
    { phase: 7, num: 2, title: "Hour/day heatmap", priority: 1 },
    { phase: 7, num: 3, title: "Message volume sparkline", priority: 1 },
    { phase: 7, num: 4, title: "Agent presence indicators", priority: 1 },
    
    // Phase 8: Quick Actions (P1 - important)
    { phase: 8, num: 1, title: "Inline task creation in kanban", priority: 1 },
    { phase: 8, num: 2, title: "Quick note input without modal", priority: 1 },
    { phase: 8, num: 3, title: "One-click agent switch", priority: 1 },
    { phase: 8, num: 4, title: "Built-in Pomodoro timer", priority: 1 },
    
    // Phase 9: Voice Integration (P2 - nice to have)
    { phase: 9, num: 1, title: "Voice commands for dashboard actions", priority: 2 },
    { phase: 9, num: 2, title: "Audio notifications for events", priority: 2 },
    { phase: 9, num: 3, title: "Voice memos with transcription", priority: 2 },
    
    // Phase 10: Task Board Enhancements (P2 - nice to have)
    { phase: 10, num: 1, title: "Swimlane view (group by agent/priority)", priority: 2 },
    { phase: 10, num: 2, title: "Bulk selection improvements", priority: 2 },
    { phase: 10, num: 3, title: "Due date visual indicators (red pulse for overdue)", priority: 2 },
    { phase: 10, num: 4, title: "Task dependency connecting lines", priority: 2 },
    
    // Phase 11: Agent Status Panel (P2 - nice to have)
    { phase: 11, num: 1, title: "Traffic light indicators (green/yellow/red)", priority: 2 },
    { phase: 11, num: 2, title: "Mini sparklines per agent activity", priority: 2 },
    { phase: 11, num: 3, title: "Handoff button between agents", priority: 2 },
    { phase: 11, num: 4, title: "Resource usage display (tokens, runtime)", priority: 2 },
    
    // Phase 12: Analytics Widget (P2 - nice to have)
    { phase: 12, num: 1, title: "Token usage over time (line chart)", priority: 2 },
    { phase: 12, num: 2, title: "Cost breakdown by agent (donut chart)", priority: 2 },
    { phase: 12, num: 3, title: "Session duration heatmap", priority: 2 },
    { phase: 12, num: 4, title: "Week-over-week comparison", priority: 2 },
    
    // Phase 13: Terminal Improvements (P2 - nice to have)
    { phase: 13, num: 1, title: "Resizable/dockable terminal", priority: 2 },
    { phase: 13, num: 2, title: "Syntax highlighting for output", priority: 2 },
    { phase: 13, num: 3, title: "Command history with up-arrow", priority: 2 },
    { phase: 13, num: 4, title: "Clear on new session toggle", priority: 2 },
    
    // Phase 14: UX Polish (P2 - nice to have)
    { phase: 14, num: 1, title: "Zero-state designs with CTAs", priority: 2 },
    { phase: 14, num: 2, title: "Empty state illustrations", priority: 2 },
    { phase: 14, num: 3, title: "Mobile-responsive bento (1/2/3 columns)", priority: 2 },
    { phase: 14, num: 4, title: "Touch-friendly drag handles", priority: 2 },
    
    // Phase 15: Keyboard Shortcuts (P2 - nice to have)
    { phase: 15, num: 1, title: "1-9: switch to agent N", priority: 2 },
    { phase: 15, num: 2, title: "T: new task", priority: 2 },
    { phase: 15, num: 3, title: "N: new note", priority: 2 },
    { phase: 15, num: 4, title: "C: focus chat", priority: 2 },
    { phase: 15, num: 5, title: "Esc: clear selection", priority: 2 },
    
    // Phase 16: Business Features (P2 - nice to have)
    { phase: 16, num: 1, title: "Goals/OKR tracking widget", priority: 2 },
    { phase: 16, num: 2, title: "Weekly/monthly goal progress", priority: 2 },
    { phase: 16, num: 3, title: "Business metrics health check", priority: 2 },
    { phase: 16, num: 4, title: "Time tracking integration", priority: 2 },
    { phase: 16, num: 5, title: "Auto-log time per agent/task", priority: 2 },
    { phase: 16, num: 6, title: "Weekly productivity report", priority: 2 },
    { phase: 16, num: 7, title: "Decision log with context", priority: 2 },
    { phase: 16, num: 8, title: "Link decisions to tasks/outcomes", priority: 2 }
];

function createDashboardTasks() {
    const now = Date.now();
    const tasks = [];
    
    DASHBOARD_TASKS.forEach((taskDef, index) => {
        const id = `dash-${taskDef.phase}-${taskDef.num}-${now + index}`;
        const title = `P${taskDef.phase}.${String(taskDef.num).padStart(3, '0')} ${taskDef.title}`;
        tasks.push({
            id,
            title,
            priority: taskDef.priority,
            created: now + index,
            description: `Dashboard Phase ${taskDef.phase} improvement task`,
            agent: 'dev'
        });
    });
    
    return tasks;
}

function initDashboardTasks() {
    // Check if we already have dashboard tasks
    const allTasks = [...(state.tasks.todo || []), ...(state.tasks.progress || []), ...(state.tasks.done || [])];
    const hasDashboardTasks = allTasks.some(t => t.id && t.id.startsWith('dash-'));
    
    if (!hasDashboardTasks) {
        console.log('[Dashboard] Initializing 70 dashboard improvement tasks...');
        const tasks = createDashboardTasks();
        state.tasks.todo = [...state.tasks.todo, ...tasks];
        saveState('Added 70 dashboard improvement tasks');
        console.log('[Dashboard] ✓ Added 70 tasks to todo column');
    } else {
        console.log('[Dashboard] Dashboard tasks already initialized');
    }
}


