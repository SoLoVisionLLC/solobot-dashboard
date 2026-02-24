// js/system.js — System page rendering

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
        providerEl.textContent = state.provider || 'openai-codex';
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


