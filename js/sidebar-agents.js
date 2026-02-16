// js/sidebar-agents.js — Dynamic sidebar Agents list (hide/reorder)
//
// Features:
// - Drag-and-drop reordering (persisted to localStorage)
// - Manual hide/show per agent (persisted)
// - Optional auto-hide inactive agents based on recent session activity
//
// Storage keys
const SIDEBAR_AGENTS_ORDER_KEY = 'sidebar_agents_order_v1';
const SIDEBAR_AGENTS_HIDDEN_KEY = 'sidebar_agents_hidden_v1';
const SIDEBAR_AGENTS_PREFS_KEY = 'sidebar_agents_prefs_v1';

function getSidebarAgentsPrefs() {
    try {
        return JSON.parse(localStorage.getItem(SIDEBAR_AGENTS_PREFS_KEY) || '{}');
    } catch {
        return {};
    }
}

function setSidebarAgentsPrefs(prefs) {
    try {
        localStorage.setItem(SIDEBAR_AGENTS_PREFS_KEY, JSON.stringify(prefs || {}));
    } catch {}
}

function getSidebarAgentsHiddenSet() {
    try {
        const arr = JSON.parse(localStorage.getItem(SIDEBAR_AGENTS_HIDDEN_KEY) || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function setSidebarAgentsHiddenSet(set) {
    try {
        localStorage.setItem(SIDEBAR_AGENTS_HIDDEN_KEY, JSON.stringify(Array.from(set || [])));
    } catch {}
}

function getSidebarAgentsOrder() {
    try {
        const arr = JSON.parse(localStorage.getItem(SIDEBAR_AGENTS_ORDER_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function setSidebarAgentsOrder(order) {
    try {
        localStorage.setItem(SIDEBAR_AGENTS_ORDER_KEY, JSON.stringify(order || []));
    } catch {}
}

function getSidebarAgentsContainer() {
    return document.getElementById('sidebar-agents-list');
}

function getSidebarAgentElements() {
    const container = getSidebarAgentsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.sidebar-agent[data-agent]'));
}

function applySidebarAgentsOrder() {
    const container = getSidebarAgentsContainer();
    if (!container) return;

    const order = getSidebarAgentsOrder();
    if (!order.length) return;

    const map = new Map();
    for (const el of getSidebarAgentElements()) {
        map.set(el.getAttribute('data-agent'), el);
    }

    // Append in saved order first
    for (const id of order) {
        const el = map.get(id);
        if (el) container.appendChild(el);
        map.delete(id);
    }

    // Append any new agents not in saved order
    for (const el of map.values()) {
        container.appendChild(el);
    }

    // Save normalized order (includes any new agents)
    const normalized = getSidebarAgentElements().map(el => el.getAttribute('data-agent'));
    setSidebarAgentsOrder(normalized);
}

function applySidebarAgentsHidden() {
    const hidden = getSidebarAgentsHiddenSet();
    for (const el of getSidebarAgentElements()) {
        const id = el.getAttribute('data-agent');
        const isHidden = hidden.has(id);
        el.classList.toggle('is-hidden', isHidden);
    }
}

function computeLastActivityByAgent(sessions) {
    const lastByAgent = {};
    for (const s of (sessions || [])) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? match[1] : 'main';
        const ts = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
        if (!lastByAgent[agentId] || ts > lastByAgent[agentId]) {
            lastByAgent[agentId] = ts;
        }
    }
    return lastByAgent;
}

function updateSidebarAgentActivityIndicators(sessions) {
    const prefs = getSidebarAgentsPrefs();
    const hideInactive = prefs.hideInactive === true;
    const inactivityMs = typeof prefs.inactivityMs === 'number' ? prefs.inactivityMs : 15 * 60 * 1000;

    const lastByAgent = computeLastActivityByAgent(sessions);
    const now = Date.now();

    for (const el of getSidebarAgentElements()) {
        const id = el.getAttribute('data-agent');
        const last = lastByAgent[id] || 0;
        const age = last ? (now - last) : Infinity;

        el.dataset.lastActivity = String(last || '');
        el.classList.toggle('is-inactive', age > inactivityMs);
        el.classList.toggle('is-never-active', !last);

        // Auto-hide (but never hide main)
        const shouldAutoHide = hideInactive && id !== 'main' && (age > inactivityMs);
        el.classList.toggle('auto-hidden', shouldAutoHide);
    }
}

// Called from sessions.js after fetchSessions(), if present
function updateSidebarAgentsFromSessions(availableSessions) {
    updateSidebarAgentActivityIndicators(availableSessions);
    applySidebarAgentsHidden();
}

let sidebarAgentsDragging = false;

function setupSidebarAgentsDragAndDrop() {
    const els = getSidebarAgentElements();
    if (!els.length) return;

    // Add a drag handle (if not present) and make elements draggable
    for (const el of els) {
        el.setAttribute('draggable', 'true');
        el.classList.add('draggable');

        if (!el.querySelector('.agent-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'agent-drag-handle';
            handle.title = 'Drag to reorder';
            handle.textContent = '⠿';
            // Prevent handle clicks from triggering agent switch
            handle.addEventListener('click', (e) => e.stopPropagation());
            handle.addEventListener('mousedown', (e) => e.stopPropagation());
            el.insertBefore(handle, el.firstChild);
        }

        el.addEventListener('dragstart', (e) => {
            sidebarAgentsDragging = true;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.getAttribute('data-agent') || '');
        });

        el.addEventListener('dragend', () => {
            sidebarAgentsDragging = false;
            el.classList.remove('dragging');
            // Persist current DOM order
            const order = getSidebarAgentElements().map(x => x.getAttribute('data-agent'));
            setSidebarAgentsOrder(order);
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            const container = getSidebarAgentsContainer();
            if (!container) return;

            const draggedId = e.dataTransfer.getData('text/plain');
            const draggedEl = container.querySelector(`.sidebar-agent[data-agent="${CSS.escape(draggedId)}"]`);
            if (!draggedEl || draggedEl === el) return;

            // Insert dragged before drop target
            container.insertBefore(draggedEl, el);
        });
    }

    // Guard: if user clicks while dragging, ignore
    els.forEach(el => {
        el.addEventListener('click', (e) => {
            if (sidebarAgentsDragging) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    });
}

function openSidebarAgentsModal() {
    const modal = document.getElementById('sidebar-agents-modal');
    if (!modal) return;
    renderSidebarAgentsModal();
    modal.classList.add('visible');
}

function closeSidebarAgentsModal() {
    const modal = document.getElementById('sidebar-agents-modal');
    if (!modal) return;
    modal.classList.remove('visible');
}

function renderSidebarAgentsModal() {
    const list = document.getElementById('sidebar-agents-modal-list');
    const hideInactive = document.getElementById('sidebar-hide-inactive');
    const inactivity = document.getElementById('sidebar-inactivity-threshold');
    if (!list || !hideInactive || !inactivity) return;

    const prefs = getSidebarAgentsPrefs();
    const hiddenSet = getSidebarAgentsHiddenSet();

    hideInactive.checked = prefs.hideInactive === true;
    const inactivityMs = typeof prefs.inactivityMs === 'number' ? prefs.inactivityMs : 15 * 60 * 1000;
    inactivity.value = String(inactivityMs);

    const agents = getSidebarAgentElements().map(el => {
        const id = el.getAttribute('data-agent');
        const labelEl = el.querySelector('.sidebar-item-text');
        const label = labelEl ? labelEl.textContent.trim() : id;
        const last = Number(el.dataset.lastActivity || 0);
        return { id, label, last };
    });

    agents.sort((a, b) => {
        // Use sidebar order as primary ordering
        return 0;
    });

    list.innerHTML = agents.map(a => {
        const checked = !hiddenSet.has(a.id);
        const lastText = a.last ? (typeof timeAgo === 'function' ? timeAgo(a.last) : '') : 'no activity';
        return `
            <label class="sidebar-agent-pref-row">
                <input type="checkbox" data-agent="${a.id}" ${checked ? 'checked' : ''} />
                <span class="sidebar-agent-pref-label">${a.label}</span>
                <span class="sidebar-agent-pref-meta">${lastText}</span>
            </label>
        `;
    }).join('');

    // Bind checkboxes
    list.querySelectorAll('input[type="checkbox"][data-agent]').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-agent');
            if (!id) return;
            const nextHidden = getSidebarAgentsHiddenSet();
            if (cb.checked) nextHidden.delete(id); else nextHidden.add(id);
            setSidebarAgentsHiddenSet(nextHidden);
            applySidebarAgentsHidden();
        });
    });

    hideInactive.onchange = () => {
        const next = getSidebarAgentsPrefs();
        next.hideInactive = hideInactive.checked;
        next.inactivityMs = Number(inactivity.value || 0) || 15 * 60 * 1000;
        setSidebarAgentsPrefs(next);
        updateSidebarAgentActivityIndicators(window.availableSessions || []);
        applySidebarAgentsHidden();
    };

    inactivity.onchange = () => {
        const next = getSidebarAgentsPrefs();
        next.hideInactive = hideInactive.checked;
        next.inactivityMs = Number(inactivity.value || 0) || 15 * 60 * 1000;
        setSidebarAgentsPrefs(next);
        updateSidebarAgentActivityIndicators(window.availableSessions || []);
        applySidebarAgentsHidden();
    };
}

function resetSidebarAgentsOrder() {
    try { localStorage.removeItem(SIDEBAR_AGENTS_ORDER_KEY); } catch {}
    // Reload page for clean order restore
    location.reload();
}

function setupSidebarAgentsManageButton() {
    const btn = document.getElementById('sidebar-agents-manage-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebarAgentsModal();
    });
}

// Avatar resolution: check for .png first, fall back to .svg, then emoji/initial
const AVATAR_EXTENSIONS = ['png', 'svg'];

function resolveAvatarUrl(agentId) {
    // Main agent has a special avatar
    if (agentId === 'main') return '/avatars/solobot.png';
    // Others: try {id}.png, {id}.svg
    return `/avatars/${agentId}.png`;
}

function agentDisplayName(agent) {
    if (agent.isDefault) return `SoLoBot (Main)`;
    const name = agent.name || agent.id;
    // If name already starts with SoLoBot, use as-is (avoid "SoLoBot-SoLoBot-X")
    if (name.toLowerCase().startsWith('solobot')) return name;
    return `SoLoBot-${name.charAt(0).toUpperCase() + name.slice(1)}`;
}

async function loadSidebarAgents() {
    const container = document.getElementById('sidebar-agents-list');
    if (!container) return;

    try {
        const response = await fetch('/api/agents');
        const data = await response.json();
        const agents = data.agents || [];

        // Include main agent (it's excluded from /api/agents since it uses the shared workspace)
        // Add it at the front if not present
        const hasMain = agents.some(a => a.isDefault || a.id === 'main');
        const allAgents = hasMain ? agents : [{ id: 'main', name: 'main', emoji: '', isDefault: true }, ...agents];

        // Sort: default first, then by id
        allAgents.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return a.id.localeCompare(b.id);
        });

        container.innerHTML = allAgents.map(agent => {
            const avatarUrl = resolveAvatarUrl(agent.id);
            const displayName = agentDisplayName(agent);
            const emoji = agent.emoji || '';
            const fallbackInitial = (agent.name || agent.id).charAt(0).toUpperCase();

            return `
                <div class="sidebar-agent" data-agent="${agent.id}">
                    <img class="agent-avatar"
                         src="${avatarUrl}"
                         alt="${agent.id}"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <span class="agent-avatar-fallback" style="display:none; width:28px; height:28px; border-radius:50%; background:var(--surface-3); align-items:center; justify-content:center; font-size:14px; flex-shrink:0;">
                        ${emoji || fallbackInitial}
                    </span>
                    <span class="sidebar-item-text">${displayName}</span>
                </div>
            `;
        }).join('');

        // Re-init after dynamic load
        applySidebarAgentsOrder();
        applySidebarAgentsHidden();
        setupSidebarAgentsDragAndDrop();

        // Re-attach click handlers (setupSidebarAgents from chat.js)
        if (typeof setupSidebarAgents === 'function') {
            setupSidebarAgents();
        }

        if (window.availableSessions) {
            updateSidebarAgentActivityIndicators(window.availableSessions);
        }

        console.log(`[Sidebar] Loaded ${allAgents.length} agents dynamically`);
    } catch (e) {
        console.warn('[Sidebar] Failed to load agents:', e.message);
    }
}

function initSidebarAgentsUI() {
    setupSidebarAgentsManageButton();
    // Load agents dynamically from API
    loadSidebarAgents();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSidebarAgentsUI, 50);
});

// Expose a couple functions for inline onclick handlers
window.openSidebarAgentsModal = openSidebarAgentsModal;
window.closeSidebarAgentsModal = closeSidebarAgentsModal;
window.resetSidebarAgentsOrder = resetSidebarAgentsOrder;
window.updateSidebarAgentsFromSessions = updateSidebarAgentsFromSessions;
