// js/memory-cards.js — True Org-Chart Tree Layout for Memory page

(function() {
    'use strict';

    let agentsData = [];
    let currentDrilledAgent = null;

    // ── Org-Tree Data Structure ──
    // Top-down hierarchy with reporting lines
    const ORG_TREE = {
        // Level 0: CEO / Top
        'main': {
            name: 'Halo',
            role: 'PA',
            emoji: '🤖',
            reports: ['exec', 'cto', 'coo', 'cfo'],
            description: 'Orchestrator'
        },
        // Level 1: C-Suite + CoS
        'exec': {
            name: 'Elon',
            role: 'CoS',
            emoji: '👔',
            reports: [],
            description: 'Chief of Staff'
        },
        'cto': {
            name: 'Orion',
            role: 'CTO',
            emoji: '🧠',
            reports: ['dev', 'forge', 'sec'],
            description: 'Architecture & Standards'
        },
        'coo': {
            name: 'Atlas',
            role: 'COO',
            emoji: '📋',
            reports: ['cmp', 'docs', 'creative'],
            description: 'Operations'
        },
        'cfo': {
            name: 'Sterling',
            role: 'CFO',
            emoji: '💰',
            reports: ['tax'],
            description: 'Finance & Tax'
        },
        // Level 2: Reports to CTO
        'dev': {
            name: 'Dev',
            role: 'ENG',
            emoji: '⚙️',
            reports: ['quill', 'chip'],
            description: 'Head of Engineering'
        },
        'forge': {
            name: 'Forge',
            role: 'DEVOPS',
            emoji: '🔨',
            reports: [],
            description: 'DevOps'
        },
        'sec': {
            name: 'Knox',
            role: 'SEC',
            emoji: '🔒',
            reports: [],
            description: 'Security'
        },
        // Level 2: Reports to COO
        'cmp': {
            name: 'Vector',
            role: 'CMP',
            emoji: '📣',
            reports: ['smm', 'snip'],
            description: 'Marketing & Product'
        },
        'docs': {
            name: 'Canon',
            role: 'DOC',
            emoji: '📚',
            reports: [],
            description: 'Knowledge & Docs'
        },
        'creative': {
            name: 'Luma',
            role: 'ART',
            emoji: '🎨',
            reports: [],
            description: 'Creative Director'
        },
        // Level 2: Reports to CFO
        'tax': {
            name: 'Ledger',
            role: 'TAX',
            emoji: '📒',
            reports: [],
            description: 'Tax Compliance'
        },
        // Level 3: Reports to Dev
        'quill': {
            name: 'Quill',
            role: 'FE/UI',
            emoji: '✒️',
            reports: [],
            description: 'Frontend / UI'
        },
        'chip': {
            name: 'Chip',
            role: 'SWE',
            emoji: '💻',
            reports: [],
            description: 'Software Engineer'
        },
        // Level 3: Reports to CMP
        'smm': {
            name: 'Nova',
            role: 'SMM',
            emoji: '📱',
            reports: [],
            description: 'Social Media'
        },
        'snip': {
            name: 'Snip',
            role: 'YT',
            emoji: '🎬',
            reports: [],
            description: 'Content'
        },
        // Personal
        'family': {
            name: 'Haven',
            role: 'FAM',
            emoji: '🏠',
            reports: [],
            description: 'Family & Household'
        }
    };

    // All agent IDs in order (top to bottom, left to right)
    const ORG_ORDER = [
        'main',           // CEO
        'exec', 'cto', 'coo', 'cfo',  // Direct reports
        'dev', 'forge', 'sec',         // Reports to CTO
        'cmp', 'docs', 'creative',     // Reports to COO  
        'tax',                         // Reports to CFO
        'quill', 'chip',               // Reports to Dev
        'smm', 'snip',                 // Reports to CMP
        'family'                       // Personal
    ];

    function getMemoryLayout() {
        return localStorage.getItem('solobot-memory-layout') || 'org-tree';
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
        if (cardsView) cardsView.style.display = layout === 'cards' || layout === 'org-tree' ? '' : 'none';
        if (toggleBtnGrid) toggleBtnGrid.classList.toggle('active', layout !== 'classic');
        if (toggleBtnList) toggleBtnList.classList.toggle('active', layout === 'classic');
        if (settingsToggle) settingsToggle.value = layout;

        if (layout === 'org-tree' || layout === 'cards') {
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

    // ── Render Org-Tree View ──
    async function renderOrgTree(filter) {
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

        if (currentDrilledAgent) {
            renderDrilledView(container);
            return;
        }

        // Build agent map
        const agentMap = {};
        agentsData.forEach(a => { agentMap[a.id] = a; });

        // Filter logic
        let visibleIds = new Set(ORG_ORDER);
        if (filter) {
            const q = filter.toLowerCase();
            visibleIds = new Set(ORG_ORDER.filter(id => {
                const org = ORG_TREE[id];
                const agent = agentMap[id];
                if (!org) return false;
                if (org.name.toLowerCase().includes(q)) return true;
                if (org.role.toLowerCase().includes(q)) return true;
                if (agent?.files?.some(f => f.name.toLowerCase().includes(q))) return true;
                return false;
            }));
        }

        const stats = computeStats(agentsData);
        const today = new Date().toDateString();

        // Build tree levels for rendering
        const levels = {};
        ORG_ORDER.forEach(id => {
            if (!visibleIds.has(id)) return;
            const org = ORG_TREE[id];
            const depth = getDepth(id);
            if (!levels[depth]) levels[depth] = [];
            levels[depth].push({ id, org, agent: agentMap[id] });
        });

        // Generate SVG connectors
        const connectorPaths = generateConnectorPaths(levels);

        let html = `
            <div class="agent-stats-bar">
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalAgents}</span><span class="agent-stat-label">Agents</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalFiles}</span><span class="agent-stat-label">Files</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.modifiedToday}</span><span class="agent-stat-label">Modified Today</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.activeAgents}</span><span class="agent-stat-label">Active Today</span></div>
            </div>
            <div class="org-tree-wrapper">
                <svg class="org-tree-connectors" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet">
                    ${connectorPaths}
                </svg>
                <div class="org-tree-nodes">
        `;

        // Render levels top to bottom
        const levelKeys = Object.keys(levels).sort((a, b) => parseInt(a) - parseInt(b));
        levelKeys.forEach(level => {
            html += `<div class="org-tree-level" data-level="${level}">`;
            levels[level].forEach(({ id, org, agent }) => {
                html += renderOrgNode(id, org, agent, today);
            });
            html += `</div>`;
        });

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    function getDepth(agentId) {
        if (agentId === 'main') return 0;
        for (const [mgr, info] of Object.entries(ORG_TREE)) {
            if (info.reports.includes(agentId)) return getDepth(mgr) + 1;
        }
        return 2;
    }

    function generateConnectorPaths(levels) {
        const levelHeight = 140;
        const nodeWidth = 200;
        const levelKeys = Object.keys(levels).sort((a, b) => parseInt(a) - parseInt(b));
        
        let paths = '';
        
        levelKeys.forEach((level, li) => {
            const y = li * levelHeight + 60;
            const nodes = levels[level];
            
            nodes.forEach((node, ni) => {
                const x = ni * (nodeWidth + 40) + 80;
                const org = node.org;
                
                // Draw line from manager (above) to this node
                if (org.reports && org.reports.length > 0) {
                    org.reports.forEach(reportId => {
                        // Find position of report node
                        const nextLevel = levels[parseInt(level) + 1];
                        if (nextLevel) {
                            const reportIdx = nextLevel.findIndex(n => n.id === reportId);
                            if (reportIdx >= 0) {
                                const reportX = reportIdx * (nodeWidth + 40) + 80 + (nodeWidth / 2);
                                const reportY = (parseInt(level) + 1) * levelHeight + 30;
                                const nodeX = x + nodeWidth / 2;
                                
                                paths += `<path class="org-connector" d="M ${nodeX} ${y + 30} L ${nodeX} ${reportY - 30} L ${reportX} ${reportY - 30}" fill="none" stroke="var(--border-subtle)" stroke-width="2"/>`;
                            }
                        }
                    });
                }
            });
        });

        return paths;
    }

    function renderOrgNode(id, org, agent, today) {
        const files = agent?.files || [];
        const fileCount = files.length;
        const isDefault = agent?.isDefault;
        const sortedFiles = [...files].sort((a, b) => {
            if (!a.modified) return 1;
            if (!b.modified) return -1;
            return new Date(b.modified) - new Date(a.modified);
        });
        const lastMod = sortedFiles[0]?.modified;
        const recentFiles = sortedFiles.slice(0, 2);
        
        const hasToday = files.some(f => f.modified && new Date(f.modified).toDateString() === today);
        const statusClass = hasToday ? 'status-active' : 'status-idle';

        return `
            <div class="org-node" onclick="window._memoryCards.drillInto('${id}')" data-agent="${id}">
                <div class="org-node-connector-top"></div>
                <div class="org-node-card">
                    <div class="org-node-header">
                        <div class="org-node-avatar">${org.emoji}</div>
                        <div class="org-node-info">
                            <div class="org-node-name">
                                ${org.name}
                                ${isDefault ? '<span class="agent-card-badge">DEFAULT</span>' : ''}
                            </div>
                            <div class="org-node-role">${org.role} · ${org.description}</div>
                        </div>
                        <div class="org-node-status ${statusClass}"></div>
                    </div>
                    ${recentFiles.length ? `<div class="org-node-pills">${recentFiles.map(f => `<span class="agent-file-pill">${escapeHtml(f.name)}</span>`).join('')}</div>` : ''}
                    <div class="org-node-meta">${fileCount} file${fileCount !== 1 ? 's' : ''} · ${lastMod ? timeAgo(lastMod) : 'No files'}</div>
                </div>
            </div>
        `;
    }

    // ── Legacy Card Grid (fallback) ──
    async function renderAgentCardsView(filter) {
        const layout = getMemoryLayout();
        if (layout === 'org-tree') {
            return renderOrgTree(filter);
        }
        // Classic cards grid (simplified)
        return renderOrgTree(filter); // Use tree by default
    }

    function drillInto(agentId) {
        currentDrilledAgent = agentsData.find(a => a.id === agentId);
        if (!currentDrilledAgent) return;
        renderAgentCardsView();
    }

    function backToGrid() {
        currentDrilledAgent = null;
        renderAgentCardsView();
    }

    function renderDrilledView(container) {
        const agent = currentDrilledAgent;
        const org = ORG_TREE[agent.id] || {};
        const files = agent.files || [];
        const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

        const rootFiles = sortedFiles.filter(f => !f.name.includes('/'));
        const memoryFiles = sortedFiles.filter(f => f.name.startsWith('memory/'));

        let fileListHtml = '';
        const renderFile = (f) => {
            const active = false;
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
                    <span class="org-node-avatar" style="font-size: 24px; width: 36px; height: 36px;">${org.emoji || '🤖'}</span>
                    <span>${escapeHtml(org.name || agent.name)}</span>
                    ${org.role ? `<span class="agent-card-role-badge">${escapeHtml(org.role)}</span>` : ''}
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
        const agent = currentDrilledAgent;
        const previewEl = document.getElementById('agent-drill-preview');
        if (!previewEl) return;

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
        renderAgentCardsView();
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            applyMemoryLayout();
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
        refresh
    };
})();
