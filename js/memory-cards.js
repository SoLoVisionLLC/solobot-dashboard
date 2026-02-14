// js/memory-cards.js — Agent Cards Grid layout for memory page

(function() {
    'use strict';

    let agentsData = [];
    let currentDrilledAgent = null;
    let currentPreviewFile = null;

    // Get layout preference
    function getMemoryLayout() {
        return localStorage.getItem('solobot-memory-layout') || 'cards';
    }

    function setMemoryLayout(layout) {
        localStorage.setItem('solobot-memory-layout', layout);
        applyMemoryLayout();
    }

    // Toggle between layouts
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

    // Fetch agents from API
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

    // Time ago helper
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

    // Compute stats
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

    // Render the main agent cards grid
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

        let agents = agentsData;
        if (filter) {
            const q = filter.toLowerCase();
            agents = agents.filter(a =>
                a.name.toLowerCase().includes(q) ||
                (a.files || []).some(f => f.name.toLowerCase().includes(q))
            );
        }

        const stats = computeStats(agentsData);
        const today = new Date().toDateString();

        let html = `
            <div class="agent-stats-bar">
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalAgents}</span><span class="agent-stat-label">Agents</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalFiles}</span><span class="agent-stat-label">Files</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.modifiedToday}</span><span class="agent-stat-label">Modified Today</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.activeAgents}</span><span class="agent-stat-label">Active Today</span></div>
            </div>
            <div class="agent-cards-grid">
        `;

        agents.forEach(agent => {
            const files = agent.files || [];
            const fileCount = files.length;
            const emoji = agent.emoji || agent.name.charAt(0).toUpperCase();
            const isDefault = agent.isDefault;
            const sortedFiles = [...files].sort((a, b) => {
                if (!a.modified) return 1;
                if (!b.modified) return -1;
                return new Date(b.modified) - new Date(a.modified);
            });
            const lastMod = sortedFiles[0]?.modified;
            const recentFiles = sortedFiles.slice(0, 3);

            // Activity indicator
            const hasToday = files.some(f => f.modified && new Date(f.modified).toDateString() === today);
            const statusClass = hasToday ? 'status-active' : 'status-idle';

            html += `
                <div class="agent-card" onclick="window._memoryCards.drillInto('${agent.id}')">
                    <div class="agent-card-header">
                        <div class="agent-card-avatar">${emoji}</div>
                        <div class="agent-card-info">
                            <div class="agent-card-name">${escapeHtml(agent.name)}${isDefault ? ' <span class="agent-card-badge">DEFAULT</span>' : ''}</div>
                            <div class="agent-card-meta">${fileCount} file${fileCount !== 1 ? 's' : ''} • ${lastMod ? timeAgo(lastMod) : 'No files'}</div>
                        </div>
                        <div class="agent-card-status ${statusClass}"></div>
                    </div>
                    ${recentFiles.length ? `<div class="agent-card-pills">${recentFiles.map(f => `<span class="agent-file-pill">${escapeHtml(f.name)}</span>`).join('')}</div>` : ''}
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // Drill into an agent
    function drillInto(agentId) {
        currentDrilledAgent = agentsData.find(a => a.id === agentId);
        if (!currentDrilledAgent) return;
        currentPreviewFile = null;
        renderAgentCardsView();
    }

    // Back to grid
    function backToGrid() {
        currentDrilledAgent = null;
        currentPreviewFile = null;
        renderAgentCardsView();
    }

    // Render drilled view for one agent
    function renderDrilledView(container) {
        const agent = currentDrilledAgent;
        const files = agent.files || [];
        const emoji = agent.emoji || agent.name.charAt(0).toUpperCase();
        const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

        // Separate root files and memory/ files
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
                <button class="btn btn-ghost" onclick="window._memoryCards.backToGrid()">← Back to Agents</button>
                <div class="agent-drill-title">
                    <span class="agent-card-avatar">${emoji}</span>
                    <span>${escapeHtml(agent.name)}</span>
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

    // Preview a file in the right panel
    async function previewFile(filename) {
        currentPreviewFile = filename;
        const agent = currentDrilledAgent;
        const previewEl = document.getElementById('agent-drill-preview');
        if (!previewEl) return;

        // Update active state in file list
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

    // Refresh data
    async function refresh() {
        agentsData = await fetchAgents();
        if (getMemoryLayout() === 'cards') {
            renderAgentCardsView();
        }
    }

    // Expose API
    window._memoryCards = {
        getLayout: getMemoryLayout,
        setLayout: setMemoryLayout,
        applyLayout: applyMemoryLayout,
        renderAgentCardsView,
        drillInto,
        backToGrid,
        previewFile,
        refresh
    };
})();
