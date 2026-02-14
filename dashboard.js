// SoLoVision Command Center Dashboard v4.2.0
// Modular architecture — see js/*.js for module files
//
// Message Architecture:
// - Chat messages: Synced via Gateway (single source of truth across all devices)
// - System messages: Local UI noise (heartbeats, errors) - persisted to localStorage only

// ===================
// STATE MANAGEMENT
// ===================


// ===================
// INITIALIZATION
// ===================

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    
    // Initialize dashboard improvement tasks
    initDashboardTasks();

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
    
    // Initialize dashboard improvement tasks
    initDashboardTasks();
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
            // Only hijack Ctrl+A for task selection when the Tasks page is active
            const tasksPage = document.getElementById('page-tasks');
            if (tasksPage && tasksPage.style.display !== 'none' && tasksPage.contains(e.target)) {
                e.preventDefault();
                selectAllTasks();
            }
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


