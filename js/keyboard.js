// js/keyboard.js — Keyboard shortcuts & command palette

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

// Session-scoped localStorage key for chat messages

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


