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

// Grouping / departments
const SIDEBAR_AGENT_DEPT_OVERRIDES_KEY = 'sidebar_agents_dept_overrides_v1';
const SIDEBAR_AGENT_GROUP_COLLAPSED_KEY = 'sidebar_agents_group_collapsed_v1';
const SIDEBAR_AGENT_ORDER_BY_DEPT_KEY = 'sidebar_agents_order_by_dept_v1';

// Legacy/alias agent IDs mapped to canonical IDs used by session routing
const AGENT_ID_ALIASES = {
    quill: 'ui',
    forge: 'devops',
    orion: 'cto',
    atlas: 'coo',
    sterling: 'cfo',
    vector: 'cmp',
    nova: 'smm',
    snip: 'youtube',
    knox: 'sec',
    sentinel: 'net',
    canon: 'docs',
    ledger: 'tax',
    haven: 'family',
    halo: 'main',
    elon: 'exec'
};

// Departments requested by user (canonical org grouping)
const DEFAULT_DEPARTMENTS = {
    main: 'Executive',
    exec: 'Executive',

    cto: 'Technology',
    dev: 'Technology',
    devops: 'Technology',
    ui: 'Technology',
    swe: 'Technology',
    net: 'Technology',
    sec: 'Technology',

    coo: 'Operations',
    docs: 'Operations',

    cmp: 'Marketing & Product',
    smm: 'Marketing & Product',
    youtube: 'Marketing & Product',
    art: 'Marketing & Product',

    cfo: 'Finance',
    tax: 'Finance',

    family: 'Family / Household'
};

const DEPARTMENT_ORDER = ['Executive', 'Technology', 'Operations', 'Marketing & Product', 'Finance', 'Family / Household', 'Other'];

const ALLOWED_AGENT_IDS = new Set(Object.keys(DEFAULT_DEPARTMENTS));

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
    } catch { }
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
    } catch { }
}

function getSidebarAgentsOrder() {
    // Legacy global order (kept for backwards compatibility)
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
    } catch { }
}

function getSidebarDeptOverrides() {
    try {
        const raw = JSON.parse(localStorage.getItem(SIDEBAR_AGENT_DEPT_OVERRIDES_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function setSidebarDeptOverrides(map) {
    try {
        localStorage.setItem(SIDEBAR_AGENT_DEPT_OVERRIDES_KEY, JSON.stringify(map || {}));
    } catch { }
}

function getSidebarCollapsedGroupsSet() {
    try {
        const arr = JSON.parse(localStorage.getItem(SIDEBAR_AGENT_GROUP_COLLAPSED_KEY) || '[]');
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function setSidebarCollapsedGroupsSet(set) {
    try {
        localStorage.setItem(SIDEBAR_AGENT_GROUP_COLLAPSED_KEY, JSON.stringify(Array.from(set || [])));
    } catch { }
}

function getSidebarOrderByDept() {
    try {
        const raw = JSON.parse(localStorage.getItem(SIDEBAR_AGENT_ORDER_BY_DEPT_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function setSidebarOrderByDept(map) {
    try {
        localStorage.setItem(SIDEBAR_AGENT_ORDER_BY_DEPT_KEY, JSON.stringify(map || {}));
    } catch { }
}

function normalizeAgentId(agentId) {
    const raw = (agentId || '').toLowerCase().trim();
    return AGENT_ID_ALIASES[raw] || raw;
}

function getAgentDepartment(agentId) {
    const overrides = getSidebarDeptOverrides();
    const normalized = normalizeAgentId(agentId);
    return overrides[normalized] || DEFAULT_DEPARTMENTS[normalized] || 'Other';
}

function setAgentDepartment(agentId, dept) {
    const overrides = getSidebarDeptOverrides();
    overrides[normalizeAgentId(agentId)] = dept;
    setSidebarDeptOverrides(overrides);
}

function getSidebarAgentsContainer() {
    return document.getElementById('sidebar-agents-list');
}

function getSidebarAgentElements() {
    const container = getSidebarAgentsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.sidebar-agent[data-agent]'));
}

function getSidebarGroupElements() {
    const container = getSidebarAgentsContainer();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.sidebar-agent-group[data-dept]'));
}

function getGroupListEl(dept) {
    const container = getSidebarAgentsContainer();
    if (!container) return null;
    return container.querySelector(`.sidebar-agent-group[data-dept="${CSS.escape(dept)}"] .sidebar-agent-group-list`);
}

function applySidebarAgentsOrder() {
    // Apply ordering within each department group.
    const byDept = getSidebarOrderByDept();

    for (const groupEl of getSidebarGroupElements()) {
        const dept = groupEl.getAttribute('data-dept');
        const listEl = groupEl.querySelector('.sidebar-agent-group-list');
        if (!dept || !listEl) continue;

        const desired = Array.isArray(byDept[dept]) ? byDept[dept] : [];
        if (!desired.length) continue;

        const els = Array.from(listEl.querySelectorAll('.sidebar-agent[data-agent]'));
        const map = new Map(els.map(el => [el.getAttribute('data-agent'), el]));

        for (const id of desired) {
            const el = map.get(id);
            if (el) listEl.appendChild(el);
            map.delete(id);
        }
        for (const el of map.values()) listEl.appendChild(el);

        // Save normalized order for this group
        const normalized = Array.from(listEl.querySelectorAll('.sidebar-agent[data-agent]')).map(el => el.getAttribute('data-agent'));
        byDept[dept] = normalized;
    }

    setSidebarOrderByDept(byDept);
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
        const rawAgentId = match ? match[1] : 'main';
        const agentId = window.resolveAgentId ? window.resolveAgentId(rawAgentId) : rawAgentId;
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

function persistDeptOrdersFromDOM() {
    const byDept = {};
    for (const groupEl of getSidebarGroupElements()) {
        const dept = groupEl.getAttribute('data-dept');
        const listEl = groupEl.querySelector('.sidebar-agent-group-list');
        if (!dept || !listEl) continue;
        byDept[dept] = Array.from(listEl.querySelectorAll('.sidebar-agent[data-agent]'))
            .map(el => el.getAttribute('data-agent'));
    }
    setSidebarOrderByDept(byDept);
}

function setupSidebarAgentsDragAndDrop() {
    const els = getSidebarAgentElements();
    if (!els.length) return;

    // Make agent elements draggable + ensure handle
    for (const el of els) {
        el.setAttribute('draggable', 'true');
        el.classList.add('draggable');

        if (!el.querySelector('.agent-drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'agent-drag-handle';
            handle.title = 'Drag to reorder';
            handle.textContent = '⠿';
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
            persistDeptOrdersFromDOM();
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId) return;

            const draggedEl = document.querySelector(`.sidebar-agent[data-agent="${CSS.escape(draggedId)}"]`);
            if (!draggedEl || draggedEl === el) return;

            // If dropped onto an agent, insert before it (within that agent's department list)
            const targetDept = el.getAttribute('data-dept') || getAgentDepartment(el.getAttribute('data-agent'));
            const listEl = getGroupListEl(targetDept);
            if (!listEl) return;

            // Re-home if moved across departments
            if (draggedEl.getAttribute('data-dept') !== targetDept) {
                setAgentDepartment(draggedId, targetDept);
            }

            listEl.insertBefore(draggedEl, el);
            draggedEl.setAttribute('data-dept', targetDept);
            persistDeptOrdersFromDOM();
        });
    }

    // Allow dropping into empty space within a department group
    for (const groupEl of getSidebarGroupElements()) {
        const dept = groupEl.getAttribute('data-dept');
        const listEl = groupEl.querySelector('.sidebar-agent-group-list');
        const headerEl = groupEl.querySelector('.sidebar-agent-group-header');
        if (!dept || !listEl) continue;

        const onDropIntoGroup = (e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData('text/plain');
            if (!draggedId) return;
            const draggedEl = document.querySelector(`.sidebar-agent[data-agent="${CSS.escape(draggedId)}"]`);
            if (!draggedEl) return;

            if (draggedEl.getAttribute('data-dept') !== dept) {
                setAgentDepartment(draggedId, dept);
            }

            listEl.appendChild(draggedEl);
            draggedEl.setAttribute('data-dept', dept);
            persistDeptOrdersFromDOM();
        };

        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        listEl.addEventListener('drop', onDropIntoGroup);

        // Header drop = quick move to group (Notion-ish)
        if (headerEl) {
            headerEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            headerEl.addEventListener('drop', onDropIntoGroup);
        }
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
    try {
        localStorage.removeItem(SIDEBAR_AGENTS_ORDER_KEY);
        localStorage.removeItem(SIDEBAR_AGENT_ORDER_BY_DEPT_KEY);
        localStorage.removeItem(SIDEBAR_AGENT_DEPT_OVERRIDES_KEY);
        localStorage.removeItem(SIDEBAR_AGENT_GROUP_COLLAPSED_KEY);
    } catch { }
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
    const id = normalizeAgentId(agent.id || agent.name);
    const persona = (typeof AGENT_PERSONAS !== 'undefined') && AGENT_PERSONAS[id];
    if (persona) return `${persona.name} (${persona.role})`;
    if (agent.isDefault || id === 'main') return 'Halo (PA)';
    const name = agent.name || id;
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function sanitizeAgentEmoji(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    // Reject template/noise phrases leaking from uninitialized IDENTITY.md files.
    if (/your signature|pick one|workspace-relative|data uri|ghost in the machine/i.test(v)) return '';
    // Keep short values only (emoji, small token).
    if (v.length > 8) return '';
    return v;
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
        const hasMain = agents.some(a => normalizeAgentId(a.id) === 'main' || a.isDefault);
        const allAgentsRaw = hasMain ? agents : [{ id: 'main', name: 'main', emoji: '', isDefault: true }, ...agents];

        // Normalize IDs, dedupe alias/canonical duplicates, and drop unknown/noise IDs.
        // This prevents stray workspace names or template text from becoming sidebar agents.
        const dedupedByCanonicalId = new Map();
        for (const agent of allAgentsRaw) {
            const canonicalId = normalizeAgentId(agent.id);
            if (!ALLOWED_AGENT_IDS.has(canonicalId)) continue;

            const existing = dedupedByCanonicalId.get(canonicalId);
            const normalizedAgent = {
                ...agent,
                id: canonicalId,
                isDefault: canonicalId === 'main' || agent.isDefault === true
            };

            // Prefer canonical/native entries over alias entries when both exist
            if (!existing || existing.id !== canonicalId || agent.id === canonicalId) {
                dedupedByCanonicalId.set(canonicalId, normalizedAgent);
            }
        }

        const allAgents = Array.from(dedupedByCanonicalId.values());

        // Sort: default first, then by id
        allAgents.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return (a.id || '').localeCompare(b.id || '');
        });

        // Group agents by department
        const groups = {};
        for (const agent of allAgents) {
            const dept = getAgentDepartment(agent.id);
            groups[dept] = groups[dept] || [];
            groups[dept].push(agent);
        }

        // Stable group order (Notion-ish)
        const groupNames = Array.from(new Set([
            ...DEPARTMENT_ORDER,
            ...Object.keys(groups).sort()
        ])).filter((d) => groups[d] && groups[d].length > 0);

        // Apply stored per-dept ordering, or default sort by id
        const orderByDept = getSidebarOrderByDept();
        for (const dept of groupNames) {
            const desired = Array.isArray(orderByDept[dept]) ? orderByDept[dept] : [];
            if (!desired.length) {
                groups[dept].sort((a, b) => {
                    if (a.isDefault) return -1;
                    if (b.isDefault) return 1;
                    return (a.id || '').localeCompare(b.id || '');
                });
                continue;
            }

            const map = new Map(groups[dept].map(a => [a.id, a]));
            const ordered = [];
            for (const id of desired) {
                const a = map.get(id);
                if (a) ordered.push(a);
                map.delete(id);
            }
            for (const a of map.values()) ordered.push(a);
            groups[dept] = ordered;
        }

        const collapsed = getSidebarCollapsedGroupsSet();

        container.innerHTML = groupNames.map((dept) => {
            const isCollapsed = collapsed.has(dept);
            const listHtml = groups[dept].map(agent => {
                const avatarUrl = resolveAvatarUrl(agent.id);
                const displayName = agentDisplayName(agent);
                const emoji = sanitizeAgentEmoji(agent.emoji);
                const fallbackInitial = (agent.name || agent.id).charAt(0).toUpperCase();

                return `
                    <div class="sidebar-agent" data-agent="${agent.id}" data-dept="${dept}">
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

            return `
                <div class="sidebar-agent-group" data-dept="${dept}">
                    <div class="sidebar-agent-group-header" role="button" tabindex="0" title="Toggle ${dept}">
                        <span class="sidebar-agent-group-caret">${isCollapsed ? '▶' : '▼'}</span>
                        <span class="sidebar-agent-group-title">${dept}</span>
                        <span class="sidebar-agent-group-count">${groups[dept].length}</span>
                    </div>
                    <div class="sidebar-agent-group-list" style="${isCollapsed ? 'display:none;' : ''}">
                        ${listHtml}
                    </div>
                </div>
            `;
        }).join('');

        // Group collapse handlers
        for (const groupEl of getSidebarGroupElements()) {
            const dept = groupEl.getAttribute('data-dept');
            const header = groupEl.querySelector('.sidebar-agent-group-header');
            const list = groupEl.querySelector('.sidebar-agent-group-list');
            const caret = groupEl.querySelector('.sidebar-agent-group-caret');
            if (!dept || !header || !list || !caret) continue;

            const toggle = () => {
                const set = getSidebarCollapsedGroupsSet();
                const nowCollapsed = !set.has(dept);
                if (nowCollapsed) set.add(dept); else set.delete(dept);
                setSidebarCollapsedGroupsSet(set);
                const isCollapsedNow = set.has(dept);
                list.style.display = isCollapsedNow ? 'none' : '';
                caret.textContent = isCollapsedNow ? '▶' : '▼';
            };

            header.addEventListener('click', (e) => {
                // Don't collapse when dropping onto header
                if (sidebarAgentsDragging) return;
                e.preventDefault();
                e.stopPropagation();
                toggle();
            });

            header.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            });
        }

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
