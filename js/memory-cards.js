// js/memory-cards.js — Agent Cards Grid layout for memory page (org-chart view)

(function() {
    'use strict';

    let agentsData = [];
    let currentDrilledAgent = null;
    let currentPreviewFile = null;

    // ── Org-chart hierarchy definition ──
    const ORG_HIERARCHY = [
        {
            id: 'leadership',
            label: '👑 Leadership',
            desc: 'Orchestration & Executive',
            agents: ['main', 'exec']
        },
        {
            id: 'c-suite',
            label: '🏛️ C-Suite',
            desc: 'Architecture · Operations · Finance',
            agents: ['cto', 'coo', 'cfo']
        },
        {
            id: 'engineering',
            label: '⚙️ Engineering',
            desc: 'Development · DevOps · Frontend',
            agents: ['dev', 'forge', 'quill', 'chip']
        },
        {
            id: 'product-marketing',
            label: '📣 Product & Marketing',
            desc: 'Marketing · Social · Content',
            agents: ['cmp', 'smm', 'snip']
        },
        {
            id: 'security-compliance',
            label: '🔒 Security & Compliance',
            desc: 'Security · Tax',
            agents: ['sec', 'tax']
        },
        {
            id: 'creative-knowledge',
            label: '🎨 Creative & Knowledge',
            desc: 'Documentation · Creative',
            agents: ['creative', 'docs']
        },
        {
            id: 'personal',
            label: '🏠 Personal',
            desc: 'Family & Household',
            agents: ['family']
        }
    ];

    // Agent metadata (matches AGENT_PERSONAS from sessions.js)
    const AGENT_META = {
        'main':     { name: 'Halo',     role: 'PA',     emoji: '🤖' },
        'exec':     { name: 'Elon',     role: 'CoS',    emoji: '👔' },
        'cto':      { name: 'Orion',    role: 'CTO',    emoji: '🧠' },
        'coo':      { name: 'Atlas',    role: 'COO',    emoji: '📋' },
        'cfo':      { name: 'Sterling', role: 'CFO',    emoji: '💰' },
        'cmp':      { name: 'Vector',   role: 'CMP',    emoji: '📣' },
        'dev':      { name: 'Dev',      role: 'ENG',    emoji: '⚙️' },
        'forge':    { name: 'Forge',    role: 'DEVOPS', emoji: '🔨' },
        'quill':    { name: 'Quill',    role: 'FE/UI',  emoji: '✒️' },
        'chip':     { name: 'Chip',     role: 'SWE',    emoji: '💻' },
        'snip':     { name: 'Snip',     role: 'YT',     emoji: '🎬' },
        'sec':      { name: 'Knox',     role: 'SEC',    emoji: '🔒' },
        'smm':      { name: 'Nova',     role: 'SMM',    emoji: '📱' },
        'family':   { name: 'Haven',    role: 'FAM',    emoji: '🏠' },
        'tax':      { name: 'Ledger',   role: 'TAX',    emoji: '📒' },
        'docs':     { name: 'Canon',    role: 'DOC',    emoji: '📚' },
        'creative': { name: 'Luma',     role: 'ART',    emoji: '🎨' }
    };

    // Reporting lines for visual connectors (who reports to whom)
    const REPORTS_TO = {
        'dev': 'cto', 'forge': 'cto', 'quill': 'dev', 'chip': 'dev',
        'cmp': 'coo', 'smm': 'cmp', 'snip': 'cmp',
        'sec': 'cto', 'tax': 'cfo',
        'docs': 'coo', 'creative': 'coo',
        'cto': 'main', 'coo': 'main', 'cfo': 'main', 'exec': 'main'
    };

    function getMemoryLayout() {
        return localStorage.getItem('solobot-memory-layout') || 'cards';
    }

    function setMemoryLayout(layout) {
        localStorage.setItem('solobot-memory-layout', layout);
        applyMemoryLayout();
    }

    function applyMemoryLayout() {
        const layout = getMemoryLayout();
        const classicView = document.getElementById('memory-classic-view');
        const cardsView = document.getElementById('memory-cards-view');
        const toggleBtnGrid = document.getElementById('memory-toggle-grid');
        const toggleBtnList = document.getElementById('memory-toggle-list');
        const settingsToggle = document.getElementById('setting-memory-layout');

        if (classicView) classicView.style.display = layout === 'classic' ? '' : 'none';
        if (cardsView) cardsView.style.display = layout === 'cards' ? '' : 'none';
        if (toggleBtnGrid) toggleBtnGrid.classList.toggle('active', layout === 'cards');
        if (toggleBtnList) toggleBtnList.classList.toggle('active', layout === 'classic');
        if (settingsToggle) settingsToggle.value = layout;

        if (layout === 'cards') {
            renderAgentCardsView();
        }
    }

    async function fetchAgents() {
        try {
            const res = await fetch('/api/agents');
            const data = await res.json();
            return Array.isArray(data) ? data : (data.agents || []);
        } catch (e) {
            console.error('Failed to fetch agents:', e);
            return [];
        }
    }

    function timeAgo(dateStr) {
        if (!dateStr) return 'Unknown';
        const now = Date.now();
        const then = new Date(dateStr).getTime();
        const diff = now - then;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        return new Date(dateStr).toLocaleDateString();
    }

    function computeStats(agents) {
        const totalAgents = agents.length;
        let totalFiles = 0;
        let modifiedToday = 0;
        let activeAgents = 0;
        const today = new Date().toDateString();

        agents.forEach(a => {
            const files = a.files || [];
            totalFiles += files.length;
            let hasRecent = false;
            files.forEach(f => {
                if (f.modified && new Date(f.modified).toDateString() === today) {
                    modifiedToday++;
                    hasRecent = true;
                }
            });
            if (hasRecent) activeAgents++;
        });

        return { totalAgents, totalFiles, modifiedToday, activeAgents };
    }

    // ── Main render ──
    async function renderAgentCardsView(filter) {
        const container = document.getElementById('memory-cards-view');
        if (!container) return;

        if (!agentsData.length) {
            container.innerHTML = '<div class="loading-state">Loading agents...</div>';
            agentsData = await fetchAgents();
        }

        if (!agentsData.length) {
            container.innerHTML = '<div class="empty-state"><p>⚠️ No agents found</p></div>';
            return;
        }

        // If drilled in, show that view
        if (currentDrilledAgent) {
            renderDrilledView(container);
            return;
        }

        // Build a lookup map: agentId -> agentData
        const agentMap = {};
        agentsData.forEach(a => { agentMap[a.id] = a; });

        let agents = agentsData;
        if (filter) {
            const q = filter.toLowerCase();
            agents = agents.filter(a =>
                a.name.toLowerCase().includes(q) ||
                (a.files || []).some(f => f.name.toLowerCase().includes(q))
            );
        }
        const filteredIds = new Set(agents.map(a => a.id));

        const stats = computeStats(agentsData);
        const today = new Date().toDateString();

        let html = `
            <div class="agent-stats-bar">
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalAgents}</span><span class="agent-stat-label">Agents</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalFiles}</span><span class="agent-stat-label">Files</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.modifiedToday}</span><span class="agent-stat-label">Modified Today</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.activeAgents}</span><span class="agent-stat-label">Active Today</span></div>
            </div>
            <div class="org-chart">
        `;

        // Track which agents are placed in groups
        const placedIds = new Set();

        ORG_HIERARCHY.forEach(group => {
            // Filter to agents that exist in data AND match search filter
            const groupAgents = group.agents
                .filter(id => agentMap[id] && filteredIds.has(id));
            
            if (groupAgents.length === 0 && filter) return; // hide empty groups when filtering

            html += `
                <div class="org-section" data-group="${group.id}">
                    <div class="org-section-header">
                        <div class="org-section-label">${group.label}</div>
                        <div class="org-section-desc">${group.desc}</div>
                    </div>
                    <div class="org-section-cards">
            `;

            if (groupAgents.length === 0) {
                html += '<div class="org-empty-slot">No agents in this group</div>';
            } else {
                groupAgents.forEach(agentId => {
                    const agent = agentMap[agentId];
                    placedIds.add(agentId);
                    html += renderAgentCard(agent, today);
                });
            }

            html += `
                    </div>
                </div>
            `;
        });

        // Render any uncategorized agents
        const uncategorized = agents.filter(a => !placedIds.has(a.id));
        if (uncategorized.length > 0) {
            html += `
                <div class="org-section" data-group="other">
                    <div class="org-section-header">
                        <div class="org-section-label">🔧 Other</div>
                        <div class="org-section-desc">Uncategorized agents</div>
                    </div>
                    <div class="org-section-cards">
            `;
            uncategorized.forEach(agent => {
                html += renderAgentCard(agent, today);
            });
            html += '</div></div>';
        }

        html += '</div>'; // close .org-chart
        container.innerHTML = html;
    }

    function renderAgentCard(agent, today) {
        const files = agent.files || [];
        const fileCount = files.length;
        const meta = AGENT_META[agent.id] || {};
        const emoji = meta.emoji || agent.emoji || agent.name.charAt(0).toUpperCase();
        const roleBadge = meta.role || '';
        const displayName = meta.name || agent.name;
        const isDefault = agent.isDefault;
        const reportsTo = REPORTS_TO[agent.id];
        const reportsToMeta = reportsTo ? AGENT_META[reportsTo] : null;

        const sortedFiles = [...files].sort((a, b) => {
            if (!a.modified) return 1;
            if (!b.modified) return -1;
            return new Date(b.modified) - new Date(a.modified);
        });
        const lastMod = sortedFiles[0]?.modified;
        const recentFiles = sortedFiles.slice(0, 3);

        const hasToday = files.some(f => f.modified && new Date(f.modified).toDateString() === today);
        const statusClass = hasToday ? 'status-active' : 'status-idle';

        return `
            <div class="agent-card" onclick="window._memoryCards.drillInto('${agent.id}')">
                <div class="agent-card-header">
                    <div class="agent-card-avatar">${emoji}</div>
                    <div class="agent-card-info">
                        <div class="agent-card-name">
                            ${escapeHtml(displayName)}
                            ${roleBadge ? `<span class="agent-card-role-badge">${escapeHtml(roleBadge)}</span>` : ''}
                            ${isDefault ? ' <span class="agent-card-badge">DEFAULT</span>' : ''}
                        </div>
                        <div class="agent-card-meta">${fileCount} file${fileCount !== 1 ? 's' : ''} · ${lastMod ? timeAgo(lastMod) : 'No files'}</div>
                        ${reportsToMeta ? `<div class="agent-card-reports">↳ reports to ${escapeHtml(reportsToMeta.name)}</div>` : ''}
                    </div>
                    <div class="agent-card-status ${statusClass}"></div>
                </div>
                ${recentFiles.length ? `<div class="agent-card-pills">${recentFiles.map(f => `<span class="agent-file-pill">${escapeHtml(f.name)}</span>`).join('')}</div>` : ''}
            </div>
        `;
    }

    function drillInto(agentId) {
        currentDrilledAgent = agentsData.find(a => a.id === agentId);
        if (!currentDrilledAgent) return;
        currentPreviewFile = null;
        renderAgentCardsView();
    }

    function backToGrid() {
        currentDrilledAgent = null;
        currentPreviewFile = null;
        renderAgentCardsView();
    }

    function renderDrilledView(container) {
        const agent = currentDrilledAgent;
        const files = agent.files || [];
        const meta = AGENT_META[agent.id] || {};
        const emoji = meta.emoji || agent.emoji || agent.name.charAt(0).toUpperCase();
        const displayName = meta.name || agent.name;
        const roleBadge = meta.role || '';
        const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

        const rootFiles = sortedFiles.filter(f => !f.name.includes('/'));
        const memoryFiles = sortedFiles.filter(f => f.name.startsWith('memory/'));

        let fileListHtml = '';
        const renderFile = (f) => {
            const active = currentPreviewFile === f.name ? 'active' : '';
            return `<div class="agent-file-item ${active}" onclick="window._memoryCards.previewFile('${escapeHtml(f.name)}')">
                <span class="agent-file-icon">📄</span>
                <span class="agent-file-name">${escapeHtml(f.name)}</span>
                <span class="agent-file-date">${f.modified ? timeAgo(f.modified) : ''}</span>
            </div>`;
        };

        if (rootFiles.length) {
            fileListHtml += '<div class="agent-file-group-title">Root Files</div>';
            fileListHtml += rootFiles.map(renderFile).join('');
        }
        if (memoryFiles.length) {
            fileListHtml += '<div class="agent-file-group-title">Memory</div>';
            fileListHtml += memoryFiles.map(renderFile).join('');
        }

        container.innerHTML = `
            <div class="agent-drill-header">
                <button class="btn btn-ghost" onclick="window._memoryCards.backToGrid()">← Back to Org Chart</button>
                <div class="agent-drill-title">
                    <span class="agent-card-avatar">${emoji}</span>
                    <span>${escapeHtml(displayName)}</span>
                    ${roleBadge ? `<span class="agent-card-role-badge" style="font-size: 12px;">${escapeHtml(roleBadge)}</span>` : ''}
                </div>
            </div>
            <div class="agent-drill-layout">
                <div class="agent-drill-files">
                    <div class="agent-drill-files-header">Files (${files.length})</div>
                    ${fileListHtml || '<div class="empty-state" style="padding: var(--space-4);">No files</div>'}
                </div>
                <div class="agent-drill-preview" id="agent-drill-preview">
                    <div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px;">Select a file to preview</div>
                </div>
            </div>
        `;
    }

    async function previewFile(filename) {
        currentPreviewFile = filename;
        const agent = currentDrilledAgent;
        const previewEl = document.getElementById('agent-drill-preview');
        if (!previewEl) return;

        document.querySelectorAll('.agent-file-item').forEach(el => el.classList.remove('active'));
        event?.target?.closest?.('.agent-file-item')?.classList.add('active');

        previewEl.innerHTML = '<div class="loading-state">Loading...</div>';

        try {
            let content, filePath;
            if (agent.isDefault) {
                filePath = filename;
                const res = await fetch(`/api/memory/${encodeURIComponent(filename)}`);
                const data = await res.json();
                content = data.content || data.error || 'Empty file';
            } else {
                filePath = filename;
                const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/files/${encodeURIComponent(filename)}`);
                const data = await res.json();
                content = data.content || data.error || 'Empty file';
            }

            previewEl.innerHTML = `
                <div class="agent-preview-header">
                    <span class="agent-preview-filename">${escapeHtml(filename)}</span>
                    <button class="btn btn-sm btn-secondary" onclick="${agent.isDefault ? `viewMemoryFile('${escapeHtml(filePath)}')` : `viewAgentFile('${escapeHtml(agent.id)}', '${escapeHtml(filename)}')`}">✏️ Edit</button>
                </div>
                <div class="agent-preview-content"><pre>${escapeHtml(content)}</pre></div>
            `;
        } catch (e) {
            previewEl.innerHTML = `<div class="empty-state">Error loading file: ${escapeHtml(e.message)}</div>`;
        }
    }

    async function refresh() {
        agentsData = await fetchAgents();
        if (getMemoryLayout() === 'cards') {
            renderAgentCardsView();
        }
    }

    // ── Cleanup: dismiss any stale overlays/modals when memory page is shown ──
    function cleanupStaleOverlays() {
        // Remove any orphaned tooltips, popovers, or floating elements
        document.querySelectorAll('.tooltip-floating, .popover-stale, [data-memory-overlay]').forEach(el => el.remove());
        
        // Ensure no skeleton loaders linger on the memory page
        const memPage = document.getElementById('page-memory');
        if (memPage) {
            memPage.querySelectorAll('.skeleton').forEach(el => el.remove());
        }
    }

    // Auto-init on load
    document.addEventListener('DOMContentLoaded', () => {
        // Delay slightly to let other scripts set up showPage
        setTimeout(() => {
            applyMemoryLayout();
            cleanupStaleOverlays();
        }, 200);
    });

    window._memoryCards = {
        getLayout: getMemoryLayout,
        setLayout: setMemoryLayout,
        applyLayout: applyMemoryLayout,
        renderAgentCardsView,
        drillInto,
        backToGrid,
        previewFile,
        refresh,
        cleanup: cleanupStaleOverlays
    };
})();
