// js/sessions.js — Session management, switching, agent selection

const SESSION_DEBUG = false;
function sessLog(...args) { if (SESSION_DEBUG) console.log(...args); }

// ===================
// SESSION MANAGEMENT
// ===================

// Agent persona names and role labels
const AGENT_PERSONAS = {
    'main': { name: 'Halo', role: 'PA' },
    'exec': { name: 'Elon', role: 'CoS' },
    'cto': { name: 'Orion', role: 'CTO' },
    'coo': { name: 'Atlas', role: 'COO' },
    'cfo': { name: 'Sterling', role: 'CFO' },
    'cmp': { name: 'Vector', role: 'CMP' },
    'dev': { name: 'Dev', role: 'ENG' },
    'devops': { name: 'Forge', role: 'DEVOPS' },
    'ui': { name: 'Quill', role: 'FE/UI' },
    'swe': { name: 'Chip', role: 'SWE' },
    'youtube': { name: 'Snip', role: 'YT' },
    'sec': { name: 'Knox', role: 'SEC' },
    'net': { name: 'Sentinel', role: 'NET' },
    'smm': { name: 'Nova', role: 'SMM' },
    'family': { name: 'Haven', role: 'FAM' },
    'tax': { name: 'Ledger', role: 'TAX' },
    'docs': { name: 'Canon', role: 'DOC' },
    'art': { name: 'Luma', role: 'ART' }
};

// Helper to extract friendly name from session key (strips agent:agentId: prefix)
function normalizeDashboardSessionKey(key) {
    if (!key || key === 'main') return 'agent:main:main';

    // Auto-migrate legacy agent session keys (e.g. from before agent IDs were stabilized)
    const legacyMigrateMap = {
        'quill': 'ui',
        'forge': 'devops',
        'orion': 'cto',
        'halo': 'main',
        'atlas': 'coo'
    };

    let normalized = key;
    const match = normalized.match(/^agent:([^:]+):(.+)$/);
    if (match) {
        const agentId = match[1];
        if (legacyMigrateMap[agentId]) {
            normalized = `agent:${legacyMigrateMap[agentId]}:${match[2]}`;
            console.log(`[Sessions] Auto-migrated legacy session ${key} -> ${normalized}`);
        }
    }

    return normalized;
}

function getFriendlySessionName(key) {
    if (!key) return 'Halo (PA)';
    const match = key.match(/^agent:([^:]+):(.+)$/);
    if (match) {
        const agentId = resolveAgentId(match[1]);
        const sessionSuffix = match[2];
        const persona = AGENT_PERSONAS[agentId];
        const name = persona ? persona.name : agentId.toUpperCase();
        return sessionSuffix === 'main' ? name : `${name} (${sessionSuffix})`;
    }
    return key;
}

// Initialize session variables on window for global access across modular scripts
window.currentSessionName = window.currentSessionName || null;

// Initialize currentSessionName from localStorage (browser is authoritative for session)
function initCurrentSessionName() {
    const localSession = localStorage.getItem('gateway_session');
    const gatewaySession = (typeof GATEWAY_CONFIG !== 'undefined' && GATEWAY_CONFIG?.sessionKey) ? GATEWAY_CONFIG.sessionKey : null;

    // localStorage is authoritative (user's explicit choice)
    window.currentSessionName = normalizeDashboardSessionKey(localSession || gatewaySession || 'agent:main:main');

    console.log('[initCurrentSessionName] localStorage:', localSession);
    console.log('[initCurrentSessionName] GATEWAY_CONFIG:', gatewaySession);
    console.log('[initCurrentSessionName] Final:', window.currentSessionName);
}

// Initialize immediately (before any other code uses it)
initCurrentSessionName();

window.toggleSessionMenu = function () {
    const menu = document.getElementById('session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

window.renameSession = async function () {
    toggleSessionMenu();
    const newName = prompt('Enter new session name:', window.currentSessionName);
    if (!newName || newName === window.currentSessionName) return;

    try {
        const response = await fetch('/api/session/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName: window.currentSessionName, newName })
        });

        if (response.ok) {
            window.currentSessionName = newName;
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

window.showSessionSwitcher = function () {
    toggleSessionMenu();
    showToast('Session switcher coming soon', 'info');
}

// Chat Page Session Menu Functions
window.toggleChatPageSessionMenu = function () {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
}

// Close session menu when clicking outside
document.addEventListener('click', function (e) {
    const menu = document.getElementById('chat-page-session-menu');
    const trigger = e.target.closest('[onclick*="toggleChatPageSessionMenu"]');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && !trigger) {
        menu.classList.add('hidden');
    }
});

// Session Management
let availableSessions = [];
window.currentAgentId = window.currentAgentId || 'main'; // Track which agent's sessions we're viewing
let _switchInFlight = false;
let _sessionSwitchQueue = []; // Queue array for rapid switches

// Helper for legacy agent session keys (preserves chat history for old alias IDs)
const LEGACY_AGENT_MAP = {
    'chip': 'swe',
    'quill': 'ui',
    'forge': 'devops',
    'snip': 'youtube',
    'creative': 'art'
};

function resolveAgentId(id) {
    if (!id) return 'main';
    id = id.toLowerCase();
    return LEGACY_AGENT_MAP[id] || id;
}
window.resolveAgentId = resolveAgentId;

// Get the agent ID from a session key (e.g., "agent:dev:main" -> "dev")
function getAgentIdFromSession(sessionKey) {
    const match = sessionKey?.match(/^agent:([^:]+):/);
    return match ? resolveAgentId(match[1]) : 'main';
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
        sessLog(`[Dashboard] URL session param detected: ${sessionParam}`);
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
        sessLog(`[Dashboard] Subagent session not found in available sessions: ${currentSessionName}`);
        return;
    }

    const label = session.displayName || session.name || '';
    sessLog(`[Dashboard] Subagent session label: ${label}`);

    // Extract agent ID from label pattern: {agentId}-{taskname}
    const labelMatch = label.match(/^([a-z]+)-/i);
    if (labelMatch) {
        const agentFromLabel = labelMatch[1].toLowerCase();
        sessLog(`[Dashboard] Determined agent from label: ${agentFromLabel}`);

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

let _fetchSessionsInFlight = false;
let _fetchSessionsQueued = false;
async function fetchSessions() {
    // Debounce: if already fetching, queue one follow-up call
    if (_fetchSessionsInFlight) { _fetchSessionsQueued = true; return availableSessions; }
    _fetchSessionsInFlight = true;

    try {
        // Preserve locally-added sessions that might not be in gateway yet
        const localSessions = availableSessions.filter(s => s.sessionId === null);

        // Try gateway first if connected (direct RPC call)
        if (gateway && gateway.isConnected()) {
            try {
                const result = await gateway.listSessions({});
                let sessions = result?.sessions || [];

                const gatewaySessions = sessions.map(s => {
                    const friendlyName = getFriendlySessionName(s.key);
                    return {
                        key: s.key,
                        name: friendlyName,
                        displayName: friendlyName,
                        updatedAt: s.updatedAt,
                        totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                        model: s.model || 'unknown',
                        sessionId: s.sessionId
                    };
                });

                const gatewayKeys = new Set(gatewaySessions.map(s => s.key));
                const mergedLocalSessions = localSessions.filter(s => !gatewayKeys.has(s.key));
                availableSessions = [...gatewaySessions, ...mergedLocalSessions];

                sessLog(`[Dashboard] Fetched ${gatewaySessions.length} from gateway + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);

                handleSubagentSessionAgent();
                populateSessionDropdown();
                if (typeof updateSidebarAgentsFromSessions === 'function') {
                    try { updateSidebarAgentsFromSessions(availableSessions); } catch (e) { console.warn('[SidebarAgents] update failed:', e.message); }
                }
                subscribeToAllSessions();
                return availableSessions;
            } catch (e) {
                console.warn('[Dashboard] Gateway sessions.list failed, falling back to server:', e.message);
            }
        }

        // Fallback to server API
        const response = await fetch('/api/sessions');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const rawServerSessions = data.sessions || [];

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

        const serverKeys = new Set(serverSessions.map(s => s.key));
        const mergedLocalSessions = localSessions.filter(s => !serverKeys.has(s.key));
        availableSessions = [...serverSessions, ...mergedLocalSessions];

        sessLog(`[Dashboard] Fetched ${serverSessions.length} from server + ${mergedLocalSessions.length} local = ${availableSessions.length} total`);

        handleSubagentSessionAgent();
        populateSessionDropdown();
        if (typeof updateSidebarAgentsFromSessions === 'function') {
            try { updateSidebarAgentsFromSessions(availableSessions); } catch (e) { console.warn('[SidebarAgents] update failed:', e.message); }
        }
        return availableSessions;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch sessions:', e);
        return [];
    } finally {
        _fetchSessionsInFlight = false;
        if (_fetchSessionsQueued) { _fetchSessionsQueued = false; setTimeout(fetchSessions, 100); }
    }
}

function populateSessionDropdown() {
    const menu = document.getElementById('chat-page-session-menu');
    if (!menu) return;

    // Filter sessions for current agent only
    const agentSessions = filterSessionsForAgent(availableSessions, currentAgentId);

    sessLog(`[Dashboard] populateSessionDropdown: agent=${currentAgentId}, total=${availableSessions.length}, filtered=${agentSessions.length}`);
    sessLog(`[Dashboard] Available sessions:`, availableSessions.map(s => s.key));

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
        const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

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

// Get human-readable label for an agent ID (persona name)
function getAgentLabel(agentId) {
    const persona = AGENT_PERSONAS[agentId];
    return persona ? persona.name : agentId.toUpperCase();
}

// Get display name for message bubbles (e.g., "SoLoBot-CTO" or persona name)
function getAgentDisplayName(agentId) {
    if (!agentId || agentId === 'main') {
        return 'Halo (PA)';
    }
    const persona = AGENT_PERSONAS[agentId];
    if (persona) {
        return `${persona.name} (${persona.role})`;
    }
    return `SoLoBot-${agentId.toUpperCase()}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.editSessionName = function (sessionKey, currentName) {
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
                    // Even if displayName changes, keep the visible label as the session key
                    if (nameEl) {
                        nameEl.textContent = sessionKey;
                        nameEl.title = sessionKey;
                    }
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

window.deleteSession = async function (sessionKey, sessionName) {
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

window.switchToSessionKey = window.switchToSession = async function (sessionKey) {
    sessionKey = normalizeDashboardSessionKey(sessionKey);

    // Enqueue switch request (FIFO)
    _sessionSwitchQueue.push({ sessionKey, timestamp: Date.now() });

    // If switch already in progress, queue will be processed after current completes
    if (_switchInFlight) {
        return;
    }

    // Process queue until empty (defeats rapid clicks by processing all)
    while (_sessionSwitchQueue.length > 0) {
        const { sessionKey: nextKey } = _sessionSwitchQueue.shift();

        // Skip if already on this session
        if (nextKey === currentSessionName) {
            populateSessionDropdown();
            continue;
        }

        await executeSessionSwitch(nextKey);

        // Check if a newer request superseded this one
        // If queue has items that came in AFTER we started this switch, process them
        // If queue is empty or only has our own re-submit, we're done
    }
}

// Core switch execution (no queue handling)
async function executeSessionSwitch(sessionKey) {
    _switchInFlight = true;

    try {
        toggleChatPageSessionMenu();

        // Clear unread notifications for this session
        clearUnreadForSession(sessionKey);

        showToast(`Switching to ${getFriendlySessionName(sessionKey)}...`, 'info');

        // FIRST: Save current chat messages BEFORE clearing state
        // (order matters: save first, then clear)
        await saveCurrentChat();
        cacheSessionMessages(currentSessionName || GATEWAY_CONFIG.sessionKey, state.chat.messages);

        // THEN: nuke all rendering state synchronously
        streamingText = '';
        _streamingSessionKey = '';
        isProcessing = false;
        state.chat.messages = [];
        renderChat();
        renderChatPage();

        // 2. Increment session version to invalidate any in-flight history loads
        sessionVersion++;
        sessLog(`[Dashboard] Session version now ${sessionVersion}`);

        // 3. Update session config and input field
        const oldSessionName = currentSessionName;
        currentSessionName = sessionKey;
        GATEWAY_CONFIG.sessionKey = sessionKey;
        localStorage.setItem('gateway_session', sessionKey);
        const sessionInput = document.getElementById('gateway-session');
        if (sessionInput) sessionInput.value = sessionKey;

        // 3a. Update current agent ID from session key
        const agentMatch = sessionKey.match(/^agent:([^:]+):/);
        if (agentMatch) {
            currentAgentId = resolveAgentId(agentMatch[1]);
            // Force sync UI immediately (before async work)
            if (typeof forceSyncActiveAgent === 'function') {
                forceSyncActiveAgent(currentAgentId);
            }
        }

        // 4. Clear current chat display
        await clearChatHistory(true, true);

        // 4a. Check in-memory cache for instant switch
        const cached = getCachedSessionMessages(sessionKey);
        if (cached && cached.length > 0) {
            state.chat.messages = cached.slice();
            if (typeof renderChatPage === 'function') renderChatPage();
            sessLog(`[Dashboard] Restored ${cached.length} cached messages for ${sessionKey}`);
        }

        // 5. Switch gateway session key (no disconnect/reconnect needed)
        // Add small delay to allow gateway state to stabilize
        await new Promise(r => setTimeout(r, 50));

        if (gateway && gateway.isConnected()) {
            gateway.setSessionKey(sessionKey);
        } else if (gateway) {
            sessLog(`[Dashboard] Gateway not connected, initiating connect...`);
            connectToGateway();
        }

        // 6. Load history + model override in parallel (not sequential)
        const historyPromise = loadSessionHistory(sessionKey);
        const modelPromise = applySessionModelOverride(sessionKey).catch(() => { });

        // Update UI immediately (don't wait for network)
        const nameEl = document.getElementById('chat-page-session-name');
        if (nameEl) {
            nameEl.textContent = sessionKey;
            nameEl.title = sessionKey;
        }
        populateSessionDropdown();

        // Wait for history (critical path)
        await historyPromise;
        await modelPromise;

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
    } finally {
        _switchInFlight = false;
    }
}

// Navigate to a session by key - can be called from external links
// Usage: window.goToSession('agent:main:subagent:abc123')
// Or via URL: ?session=agent:main:subagent:abc123
window.goToSession = async function (sessionKey) {
    sessionKey = normalizeDashboardSessionKey(sessionKey);
    if (!sessionKey) {
        showToast('No session key provided', 'warning');
        return;
    }

    sessLog(`[Dashboard] goToSession called with: ${sessionKey}`);

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
window.getSessionUrl = function (sessionKey) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?session=${encodeURIComponent(sessionKey)}`;
}

async function saveCurrentChat() {
    // Save current chat messages to state as safeguard
    try {
        const response = await fetch('/api/state');
        const serverState = await response.json();

        // Save chat history to archivedChats
        if (!serverState.archivedChats) serverState.archivedChats = {};
        serverState.archivedChats[currentSessionName] = {
            savedAt: Date.now(),
            messages: state.chat.messages.slice(-100) // Fix #5: was chatHistory (undefined), now state.chat.messages
        };

        await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverState)
        });
    } catch (e) {
        // Silently fail - safeguard is optional
    }
}

async function loadSessionHistory(sessionKey) {
    const loadVersion = sessionVersion;

    // Helper: attempt to load from gateway
    async function tryGatewayLoad() {
        if (!gateway || !gateway.isConnected()) return false;
        try {
            const result = await gateway.loadHistory();
            if (loadVersion !== sessionVersion) {
                sessLog(`[Dashboard] Ignoring stale history load for ${sessionKey}`);
                return true; // Stale but don't retry
            }
            if (result?.messages && result.messages.length > 0) {
                if (state.chat?.messages?.length > 0) {
                    mergeHistoryMessages(result.messages);
                } else {
                    loadHistoryMessages(result.messages);
                }
                sessLog(`[Dashboard] Loaded ${result.messages.length} messages from gateway for ${sessionKey}`);
                return true;
            }
        } catch (e) {
            console.warn('[Dashboard] Gateway history failed:', e.message);
        }
        return false;
    }

    // Try gateway first
    if (await tryGatewayLoad()) return;

    // If gateway wasn't connected, wait briefly for reconnect and retry
    if (gateway && !gateway.isConnected()) {
        sessLog(`[Dashboard] Gateway disconnected during switch to ${sessionKey}, waiting for reconnect...`);
        await new Promise(r => setTimeout(r, 2000));
        if (loadVersion !== sessionVersion) return; // Session changed again
        if (await tryGatewayLoad()) return;
    }

    // Fallback: check in-memory cache
    const cached = getCachedSessionMessages(sessionKey);
    if (cached && cached.length > 0) {
        state.chat.messages = cached.slice();
        renderChat();
        renderChatPage();
        sessLog(`[Dashboard] Loaded ${cached.length} cached messages for ${sessionKey}`);
        return;
    }

    // Last resort: render empty (gateway is source of truth)
    sessLog(`[Dashboard] No history available for ${sessionKey} — rendering empty`);
    renderChat();
    renderChatPage();
}

async function loadArchivedChat(sessionKey) {
    // Just render empty — gateway.loadHistory() is the primary source now
    // Previously this fetched entire /api/state which was very expensive
    chatHistory = [];
    renderChat();
    renderChatPage();
}

// Sessions are fetched when gateway connects (see initGateway onConnected)
// No need to fetch on DOMContentLoaded — gateway isn't connected yet

function initGateway() {
    gateway = new GatewayClient({
        sessionKey: GATEWAY_CONFIG.sessionKey,
        onConnected: (serverName, sessionKey) => {
            sessLog(`[Dashboard] Connected to ${serverName}, session: ${sessionKey}`);
            updateConnectionUI('connected', serverName);

            // On reconnect, the gateway client reports whatever sessionKey it has.
            // If the user switched sessions while disconnected, currentSessionName
            // is authoritative — re-sync the gateway client to match.
            const intendedSession = normalizeDashboardSessionKey(
                GATEWAY_CONFIG.sessionKey || currentSessionName || sessionKey
            );
            if (sessionKey !== intendedSession) {
                sessLog(`[Dashboard] Reconnect mismatch: gateway=${sessionKey}, intended=${intendedSession}. Re-syncing gateway.`);
                if (gateway) gateway.setSessionKey(intendedSession);
            }
            GATEWAY_CONFIG.sessionKey = intendedSession;
            currentSessionName = intendedSession;

            // Fetch live model config from gateway (populates dropdowns),
            // then apply per-session override (authoritative model display).
            fetchModelsFromGateway().then(() => applySessionModelOverride(intendedSession));

            // Update session name displays
            const nameEl = document.getElementById('current-session-name');
            if (nameEl) {
                nameEl.textContent = intendedSession;
                nameEl.title = intendedSession;
            }
            const chatPageNameEl = document.getElementById('chat-page-session-name');
            if (chatPageNameEl) {
                chatPageNameEl.textContent = intendedSession;
                chatPageNameEl.title = intendedSession;
            }

            // Remember this session for the agent
            const agentMatch = intendedSession.match(/^agent:([^:]+):/);
            if (agentMatch) saveLastAgentSession(resolveAgentId(agentMatch[1]), intendedSession);

            checkRestartToast();

            // Load chat history on connect (one-time full load)
            _historyRefreshInFlight = true;
            _lastHistoryLoadTime = Date.now();
            const loadVersion = sessionVersion;
            gateway.loadHistory().then(result => {
                _historyRefreshInFlight = false;
                if (loadVersion !== sessionVersion) {
                    sessLog(`[Dashboard] Ignoring stale history (version ${loadVersion} != ${sessionVersion})`);
                    return;
                }
                if (result?.messages) {
                    // Fix #2: On initial connect, always do a full authoritative replace from gateway.
                    // This ensures hard refresh always shows the correct session's messages.
                    // mergeHistoryMessages() is reserved for the incremental poll path (_doHistoryRefresh).
                    sessLog(`[Dashboard] onConnected: full history replace with ${result.messages.length} messages`);
                    loadHistoryMessages(result.messages);
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
// NEW SESSION MODAL
// ===================

let newSessionModalResolve = null;

window.openNewSessionModal = function (defaultValue) {
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

window.closeNewSessionModal = function (value) {
    const modal = document.getElementById('new-session-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
    if (newSessionModalResolve) {
        newSessionModalResolve(value);
        newSessionModalResolve = null;
    }
};

window.submitNewSessionModal = function () {
    const input = document.getElementById('new-session-name-input');
    const value = input ? input.value : null;
    closeNewSessionModal(value);
};

// Handle Enter key in new session modal
document.addEventListener('keydown', function (e) {
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
window.startNewAgentSession = async function (agentId) {
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
    sessLog(`[Dashboard] Session version now ${sessionVersion} (new agent session)`);

    // Clear local chat and cache
    state.chat.messages = [];
    state.system.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;
    localStorage.removeItem(chatStorageKey());

    // Update agent context
    currentAgentId = agentId;

    // Render immediately to show empty chat
    renderChat();
    renderChatPage();

    // Switch gateway to new session
    currentSessionName = sessionKey;
    GATEWAY_CONFIG.sessionKey = sessionKey;
    // Persist for reload - save to BOTH localStorage AND server state
    localStorage.setItem('gateway_session', sessionKey);
    // Also update server state so refresh doesn't revert to stale cached session
    if (typeof saveGatewaySettings === 'function') {
        saveGatewaySettings(
            GATEWAY_CONFIG.host,
            GATEWAY_CONFIG.port,
            GATEWAY_CONFIG.token,
            sessionKey
        );
    } else if (typeof state !== 'undefined' && state.gatewayConfig) {
        // Fallback: update server state directly if saveGatewaySettings unavailable
        state.gatewayConfig.sessionKey = sessionKey;
        if (typeof saveState === 'function') saveState('Updated session for reload');
    }

    // Update session input field
    const sessionInput = document.getElementById('gateway-session');
    if (sessionInput) sessionInput.value = sessionKey;

    // Update session display (show user's input, not the full session name with agent prefix)
    const displayName = userInput.trim();
    const nameEl = document.getElementById('chat-page-session-name');
    if (nameEl) nameEl.textContent = displayName;

    // Clear streaming state from previous session to prevent cross-session bleed
    streamingText = '';
    isProcessing = false;

    // Switch gateway to new session key (no disconnect needed)
    if (gateway && gateway.isConnected()) {
        gateway.setSessionKey(sessionKey);
    } else if (gateway) {
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
window.startNewSession = async function () {
    await startNewAgentSession(currentAgentId);
}


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
    window.populateSessionDropdown = function () {
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

window.filterSessionDropdown = function (query) {
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
// js/gateway.js — Gateway connection, init, restart, connection UI

// ===================
// GATEWAY CONNECTION
// ===================

async function checkRestartToast() {
    try {
        const response = await fetch('/api/state');
        if (!response.ok) return;
        const state = await response.json();
        if (state.restartPending) {
            showNotificationToast('Gateway', 'Gateway restarted successfully');
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


