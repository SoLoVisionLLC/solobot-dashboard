// js/memory-cards.js — True Org-Chart Tree Layout with Pan/Zoom Navigation

(function () {
    'use strict';

    // Guard against early inline handler access before full API registration.
    const memoryCardsApi = window._memoryCards || (window._memoryCards = {});
    if (typeof memoryCardsApi.wasDragging !== 'boolean') {
        memoryCardsApi.wasDragging = false;
    }

    let agentsData = [];
    let currentDrilledAgent = null;
    let panzoomInstance = null;
    let isSpacePressed = false;

    function sanitizeScale(rawScale, fallback = 1) {
        const n = Number(rawScale);
        if (!Number.isFinite(n) || n <= 0) return fallback;
        return Math.min(2.5, Math.max(0.3, n));
    }

    function setPanzoomScale(instance, scale, opts) {
        if (!instance) return;
        const safeScale = sanitizeScale(scale, 1);
        if (typeof instance.zoom === 'function') {
            instance.zoom(safeScale, opts);
            return;
        }
        if (typeof instance.zoomAbs === 'function') {
            instance.zoomAbs(0, 0, safeScale);
            return;
        }
        if (typeof instance.zoomTo === 'function') {
            instance.zoomTo(0, 0, safeScale);
        }
    }

    // ── Org-Tree Data Structure ──
    const ORG_TREE = {
        'main': { name: 'Halo', role: 'PA', emoji: '🤖', reports: ['exec', 'cto', 'coo', 'cfo'], description: 'Orchestrator' },
        'exec': { name: 'Elon', role: 'CoS', emoji: '👔', reports: [], description: 'Chief of Staff' },
        'cto': { name: 'Orion', role: 'CTO', emoji: '🧠', reports: ['dev', 'devops', 'sec', 'net'], description: 'Architecture & Standards' },
        'coo': { name: 'Atlas', role: 'COO', emoji: '📋', reports: ['cmp', 'docs', 'art'], description: 'Operations' },
        'cfo': { name: 'Sterling', role: 'CFO', emoji: '💰', reports: ['tax'], description: 'Finance & Tax' },
        'dev': { name: 'Dev', role: 'ENG', emoji: '⚙️', reports: ['ui', 'swe'], description: 'Head of Engineering' },
        'devops': { name: 'Forge', role: 'DEVOPS', emoji: '🔨', reports: [], description: 'DevOps' },
        'sec': { name: 'Knox', role: 'SEC', emoji: '🔒', reports: [], description: 'Security' },
        'net': { name: 'Sentinel', role: 'NET', emoji: '📡', reports: [], description: 'Networking & Infrastructure' },
        'cmp': { name: 'Vector', role: 'CMP', emoji: '📣', reports: ['smm', 'youtube'], description: 'Marketing & Product' },
        'docs': { name: 'Canon', role: 'DOC', emoji: '📚', reports: [], description: 'Knowledge & Docs' },
        'art': { name: 'Luma', role: 'ART', emoji: '🎨', reports: [], description: 'Creative Director' },
        'tax': { name: 'Ledger', role: 'TAX', emoji: '📒', reports: [], description: 'Tax Compliance' },
        'ui': { name: 'Quill', role: 'FE/UI', emoji: '✒️', reports: [], description: 'Frontend / UI' },
        'swe': { name: 'Chip', role: 'SWE', emoji: '💻', reports: [], description: 'Software Engineer' },
        'smm': { name: 'Nova', role: 'SMM', emoji: '📱', reports: [], description: 'Social Media' },
        'youtube': { name: 'Snip', role: 'YT', emoji: '🎬', reports: [], description: 'Content' },
        'family': { name: 'Haven', role: 'FAM', emoji: '🏠', reports: [], description: 'Family & Household' }
    };

    const ORG_ORDER = ['main', 'exec', 'cto', 'coo', 'cfo', 'dev', 'devops', 'sec', 'net', 'cmp', 'docs', 'art', 'tax', 'ui', 'swe', 'smm', 'youtube', 'family'];

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
        if (cardsView) cardsView.style.display = layout === 'org-tree' || layout === 'cards' ? '' : 'none';
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

    function getDepth(agentId) {
        if (agentId === 'main') return 0;
        for (const [mgr, info] of Object.entries(ORG_TREE)) {
            if (info.reports.includes(agentId)) return getDepth(mgr) + 1;
        }
        return 2;
    }

    // ── Pan/Zoom Navigation ──
    function initPanZoom() {
        const wrapper = document.querySelector('.org-tree-wrapper');
        const viewport = document.querySelector('.org-tree-viewport');
        const connectors = document.querySelector('.org-tree-connectors');
        if (!wrapper || !viewport || !window.panzoom) return;

        // Destroy existing instance
        if (panzoomInstance) {
            panzoomInstance.dispose();
        }

        panzoomInstance = window.panzoom(viewport, {
            maxZoom: 2.5,
            minZoom: 0.3,
            zoomSpeed: 0.5,
            panSpeed: 0.5,
            bounds: true,
            boundsPadding: 0.1,
            disablePanOnZoom: false,
            disableZoomOnPan: false,
            exclude: ['.org-node-card'],
            onTouch: function (e) {
                // Allow touch on nodes for click
                return !e.target.closest('.org-node-card');
            }
        });

        // Sync transform to connector SVG (keeps lines attached to nodes)
        const syncConnectors = () => {
            if (!panzoomInstance || !connectors) return;
            const state = panzoomInstance.getTransform();
            // Match the transform on the connector SVG so lines stay aligned
            connectors.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
            connectors.style.transformOrigin = '0 0';
        };

        // Load persisted state
        const savedState = localStorage.getItem('solobot-orgchart-viewport');
        if (savedState) {
            try {
                const { x, y, scale } = JSON.parse(savedState);
                const safeX = Number.isFinite(Number(x)) ? Number(x) : 0;
                const safeY = Number.isFinite(Number(y)) ? Number(y) : 0;
                panzoomInstance.moveTo(safeX, safeY);
                setPanzoomScale(panzoomInstance, scale);
                syncConnectors();
            } catch (e) {
                console.warn('Failed to restore viewport state:', e);
            }
        }

        // Save state and sync connectors on pan/zoom (throttled with rAF)
        let rafId = null;
        panzoomInstance.on('panzoom', () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const state = panzoomInstance.getTransform();
                localStorage.setItem('solobot-orgchart-viewport', JSON.stringify({
                    x: state.x,
                    y: state.y,
                    scale: state.scale
                }));
                syncConnectors();
            });
        });

        // Initial sync
        syncConnectors();

        // Fit to content on load
        setTimeout(() => {
            fitToContent();
            syncConnectors();
        }, 300);
    }

    function zoomIn() {
        if (panzoomInstance) {
            panzoomInstance.zoomIn({ animate: true });
        }
    }

    function zoomOut() {
        if (panzoomInstance) {
            panzoomInstance.zoomOut({ animate: true });
        }
    }

    function resetView() {
        if (panzoomInstance) {
            panzoomInstance.moveTo(0, 0);
            setPanzoomScale(panzoomInstance, 1, { animate: true });
        }
    }

    function fitToContent() {
        if (!panzoomInstance) return;
        const wrapper = document.querySelector('.org-tree-wrapper');
        const viewport = document.querySelector('.org-tree-viewport');
        if (!wrapper || !viewport) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const contentWidth = Number(viewport.scrollWidth);
        const contentHeight = Number(viewport.scrollHeight);

        const safeWrapperW = Number.isFinite(wrapperRect.width) && wrapperRect.width > 0 ? wrapperRect.width : 1;
        const safeWrapperH = Number.isFinite(wrapperRect.height) && wrapperRect.height > 0 ? wrapperRect.height : 1;
        const safeContentW = Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : 1;
        const safeContentH = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : 1;

        const scale = sanitizeScale(Math.min(
            (safeWrapperW * 0.8) / safeContentW,
            (safeWrapperH * 0.8) / safeContentH,
            1.5
        ), 1);

        panzoomInstance.moveTo(0, 0);
        setPanzoomScale(panzoomInstance, scale, { animate: true });
    }

    // ── Minimap Navigator ──
    function updateMinimap() {
        const minimap = document.querySelector('.org-minimap');
        const viewport = document.querySelector('.org-tree-viewport');
        if (!minimap || !viewport || !panzoomInstance) return;

        const wrapper = document.querySelector('.org-tree-wrapper');
        const wrapperRect = wrapper.getBoundingClientRect();

        const state = panzoomInstance.getTransform();
        const scale = state.scale;

        // Update viewport indicator
        const indicator = minimap.querySelector('.org-minimap-viewport');
        if (indicator) {
            const viewportWidth = wrapperRect.width / scale;
            const viewportHeight = wrapperRect.height / scale;
            const viewportX = -state.x / scale;
            const viewportY = -state.y / scale;

            indicator.style.width = `${Math.min(viewportWidth, 800)}px`;
            indicator.style.height = `${Math.min(viewportHeight, 600)}px`;
            indicator.style.transform = `translate(${viewportX}px, ${viewportY}px)`;
        }
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

        const agentMap = {};
        agentsData.forEach(a => { agentMap[a.id] = a; });

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

        const levels = {};
        ORG_ORDER.forEach(id => {
            if (!visibleIds.has(id)) return;
            const org = ORG_TREE[id];
            const depth = getDepth(id);
            if (!levels[depth]) levels[depth] = [];
            levels[depth].push({ id, org, agent: agentMap[id] });
        });

        const connectorPaths = generateConnectorPaths(levels);

        let html = `
            <div class="agent-stats-bar">
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalAgents}</span><span class="agent-stat-label">Agents</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalFiles}</span><span class="agent-stat-label">Files</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.modifiedToday}</span><span class="agent-stat-label">Modified Today</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.activeAgents}</span><span class="agent-stat-label">Active Today</span></div>
            </div>

            <!-- Navigation Controls -->
            <div class="org-nav-controls">
                <button class="org-nav-btn" onclick="window._memoryCards.zoomIn()" title="Zoom In (+)">+</button>
                <button class="org-nav-btn" onclick="window._memoryCards.zoomOut()" title="Zoom Out (-)">−</button>
                <button class="org-nav-btn" onclick="window._memoryCards.fitToContent()" title="Fit to Screen">⊡</button>
                <button class="org-nav-btn" onclick="window._memoryCards.resetView()" title="Reset View (0)">⌂</button>
            </div>

            <!-- Minimap Navigator -->
            <div class="org-minimap" id="org-minimap">
                <button class="org-minimap-toggle" onclick="window._memoryCards.toggleMinimap()" title="Toggle minimap">⊡</button>
                <div class="org-minimap-content">
                    ${generateMinimapContent(levels)}
                </div>
                <div class="org-minimap-viewport"></div>
            </div>

            <!-- Pan/Zoom Viewport -->
            <div class="org-tree-wrapper">
                <div class="org-tree-viewport">
                    <svg class="org-tree-connectors">
                        ${connectorPaths}
                    </svg>
                    <div class="org-tree-nodes">
        `;

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
            </div>
        `;

        container.innerHTML = html;

        // Initialize pan/zoom after render
        setTimeout(() => {
            initPanZoom();
            updateMinimap();
        }, 50);
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

                if (org.reports && org.reports.length > 0) {
                    const nextLevel = levels[parseInt(level) + 1];
                    if (nextLevel) {
                        org.reports.forEach(reportId => {
                            const reportIdx = nextLevel.findIndex(n => n.id === reportId);
                            if (reportIdx >= 0) {
                                const reportX = reportIdx * (nodeWidth + 40) + 80 + (nodeWidth / 2);
                                const reportY = (parseInt(level) + 1) * levelHeight + 30;
                                const nodeX = x + nodeWidth / 2;

                                paths += `<path class="org-connector" d="M ${nodeX} ${y + 30} L ${nodeX} ${reportY - 30} L ${reportX} ${reportY - 30}" fill="none" stroke="var(--border-subtle)" stroke-width="2"/>`;
                            }
                        });
                    }
                }
            });
        });

        return paths;
    }

    function generateMinimapContent(levels) {
        let html = '';
        const levelKeys = Object.keys(levels).sort((a, b) => parseInt(a) - parseInt(b));
        const nodeWidth = 24;
        const nodeHeight = 18;
        const gap = 4;

        levelKeys.forEach((level, li) => {
            const nodes = levels[level];
            const y = li * (nodeHeight + gap) + 20;
            nodes.forEach((node, ni) => {
                const x = ni * (nodeWidth + gap) + 20;
                html += `<div class="org-minimap-node" data-agent="${node.id}" style="left: ${x}px; top: ${y}px;"></div>`;
            });
        });
        return html;
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

    async function renderAgentCardsView(filter) {
        const layout = getMemoryLayout();
        if (layout === 'org-tree') {
            return renderOrgTree(filter);
        }
        return renderOrgTree(filter);
    }

    // ── Toolbar update helpers ──
    // Called by drillInto / backToGrid to swap toolbar content
    function updateToolbarForAgent(agent, statusLabel, statusClass) {
        const tb = document.querySelector('.agents-toolbar');
        if (!tb) return;
        const org = ORG_TREE[agent.id] || {};
        tb.innerHTML = `
            <button class="btn btn-ghost btn-sm" onclick="window._memoryCards.backToGrid()" style="flex-shrink:0; white-space:nowrap;">← Agents</button>
            <span style="width:1px; height:24px; background:var(--border-subtle); flex-shrink:0;"></span>
            <span style="font-size:22px; line-height:1; flex-shrink:0;">${org.emoji || agent.emoji || '🤖'}</span>
            <div style="min-width:0; overflow:hidden;">
                <div style="font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(org.name || agent.name)}</div>
                ${org.role ? `<div style="font-size:11px; color:var(--text-muted); white-space:nowrap;">${escapeHtml(org.role)}</div>` : ''}
            </div>
            <span class="agent-status-badge ${statusClass}" style="flex-shrink:0;">${statusLabel}</span>
            <span style="width:1px; height:24px; background:var(--border-subtle); flex-shrink:0;"></span>
            <button class="btn btn-primary btn-sm" style="flex-shrink:0;" onclick="window._memoryCards.switchToAgentChat('${agent.id}')">💬 Chat</button>
            <button class="btn btn-secondary btn-sm" style="flex-shrink:0;" onclick="window._memoryCards.openAgentMemory('${agent.id}')">🧠 Memory</button>
            <button class="btn btn-secondary btn-sm" style="flex-shrink:0;" id="agent-ping-btn-${agent.id}" onclick="window._memoryCards.pingAgent('${agent.id}')">⚡ Ping</button>
            <input type="text" id="memory-search" class="input agents-toolbar-search" placeholder="🔍 Search…"
                oninput="window._memoryCards && window._memoryCards.renderAgentCardsView(this.value)"
                style="margin-left:auto;">
            <div class="memory-layout-toggle" style="flex-shrink:0;">
                <button id="memory-toggle-grid" title="Org Chart" onclick="window._memoryCards && window._memoryCards.setLayout('org-tree')">⊞</button>
                <button id="memory-toggle-list" title="List View" onclick="window._memoryCards && window._memoryCards.setLayout('classic')">☰</button>
            </div>
        `;
        // Keep active button state correct
        const layout = getMemoryLayout();
        const g = tb.querySelector('#memory-toggle-grid');
        const l = tb.querySelector('#memory-toggle-list');
        if (g) g.classList.toggle('active', layout !== 'classic');
        if (l) l.classList.toggle('active', layout === 'classic');
    }

    function updateToolbarDefault() {
        const tb = document.querySelector('.agents-toolbar');
        if (!tb) return;
        tb.innerHTML = `
            <input type="text" id="memory-search" class="input agents-toolbar-search"
                placeholder="🔍  Search agents or files…"
                oninput="if(window._memoryCards && window._memoryCards.getLayout()==='classic'){renderMemoryFiles(this.value)}else{window._memoryCards && window._memoryCards.renderAgentCardsView(this.value)}">
            <button class="btn btn-secondary btn-sm" onclick="syncMemoryFilesNow()">🔄 Sync</button>
            <div id="sync-status" class="sync-status" style="white-space:nowrap; flex-shrink:0;">
                <span class="status-dot success"></span>
                <span id="last-memory-sync" style="font-size:11px; color:var(--text-muted);">--</span>
            </div>
            <div class="memory-layout-toggle" style="margin-left:auto; flex-shrink:0;">
                <button id="memory-toggle-grid" title="Org Chart" onclick="window._memoryCards && window._memoryCards.setLayout('org-tree')">⊞</button>
                <button id="memory-toggle-list" title="List View" onclick="window._memoryCards && window._memoryCards.setLayout('classic')">☰</button>
            </div>
        `;
        const layout = getMemoryLayout();
        const g = tb.querySelector('#memory-toggle-grid');
        const l = tb.querySelector('#memory-toggle-list');
        if (g) g.classList.toggle('active', layout !== 'classic');
        if (l) l.classList.toggle('active', layout === 'classic');
    }

    function drillInto(agentId) {
        // If agentsData not yet loaded, wait for it
        if (!agentsData || !agentsData.length) {
            setTimeout(() => drillInto(agentId), 200);
            return;
        }
        currentDrilledAgent = agentsData.find(a => a.id === agentId);
        if (!currentDrilledAgent) {
            console.warn('[Agents] drillInto: agent not found:', agentId);
            return;
        }
        // Push deep-link URL
        const newPath = `/agents/${agentId}`;
        if (window.location.pathname !== newPath) {
            history.pushState({ page: 'agents', agentId }, '', newPath);
        }
        renderAgentCardsView();
    }

    function backToGrid() {
        currentDrilledAgent = null;
        // Restore /agents URL
        if (window.location.pathname !== '/agents') {
            history.pushState({ page: 'agents', agentId: null }, '', '/agents');
        }
        updateToolbarDefault();
        renderAgentCardsView();
    }


    // ── Full Agent Dashboard (replaces simple file list) ──
    function renderDrilledView(container) {
        const agent = currentDrilledAgent;
        const org = ORG_TREE[agent.id] || {};
        const files = agent.files || [];

        // Determine live status from available sessions
        const sessions = window.availableSessions || [];
        const agentSessions = sessions.filter(s => s.key?.startsWith(`agent:${agent.id}:`));
        const lastActivity = agentSessions.reduce((max, s) => {
            const ts = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
            return ts > max ? ts : max;
        }, 0);
        const isActive = lastActivity && (Date.now() - lastActivity < 5 * 60 * 1000);
        const isRecent = lastActivity && (Date.now() - lastActivity < 60 * 60 * 1000);
        const statusLabel = isActive ? 'Active' : isRecent ? 'Recent' : 'Idle';
        const statusClass = isActive ? 'success' : isRecent ? 'warning' : '';
        const lastSession = agentSessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];

        // Compute token/cost summary from activity log
        const activityLog = window.state?.activityLog || [];
        const agentPrefix = `agent:${agent.id}:`;
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEvents = activityLog.filter(e => {
            const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
            return ts >= todayStart.getTime() && (e.session?.startsWith(agentPrefix) || e.agentId === agent.id);
        });
        const msgCount = todayEvents.filter(e => e.type === 'message' || e.type === 'chat').length;
        const estCost = (todayEvents.reduce((sum, e) => sum + (e.tokens || 0), 0) * 0.000003).toFixed(4);

        // File summary
        const sortedFiles = [...files].sort((a, b) => {
            if (!a.modified) return 1;
            if (!b.modified) return -1;
            return new Date(b.modified) - new Date(a.modified);
        });
        const rootFiles = sortedFiles.filter(f => !f.name.includes('/'));
        const memFiles = sortedFiles.filter(f => f.name.startsWith('memory/'));

        // Recent 5 sessions for this agent
        const recentSessions = agentSessions
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
            .slice(0, 5);

        container.innerHTML = ``;

        // Update the fixed toolbar with agent nav + actions
        updateToolbarForAgent(agent, statusLabel, statusClass);

        container.innerHTML = `
            <!-- Dashboard Grid -->
            <div class="agent-dashboard-grid">

                <!-- Status Card -->
                <div class="agent-dash-card">
                    <div class="agent-dash-card-title">📊 Status & Activity</div>
                    <div class="agent-dash-stats">
                        <div class="agent-dash-stat"><span class="agent-dash-stat-val">${agentSessions.length}</span><span class="agent-dash-stat-label">Sessions</span></div>
                        <div class="agent-dash-stat"><span class="agent-dash-stat-val">${lastActivity ? timeAgo(lastActivity) : '—'}</span><span class="agent-dash-stat-label">Last Active</span></div>
                        <div class="agent-dash-stat"><span class="agent-dash-stat-val">${msgCount}</span><span class="agent-dash-stat-label">Msgs Today</span></div>
                        <div class="agent-dash-stat"><span class="agent-dash-stat-val">$${estCost}</span><span class="agent-dash-stat-label">Est. Cost Today</span></div>
                    </div>
                    ${lastSession ? `<div class="agent-last-session">Last session: <strong>${escapeHtml(lastSession.displayName || lastSession.key)}</strong></div>` : ''}
                </div>

                <!-- Model Config Card -->
                <div class="agent-dash-card">
                    <div class="agent-dash-card-title">🤖 Model Configuration</div>
                    <div id="agent-model-config-${agent.id}" class="agent-model-config-body">
                        <div style="color:var(--text-muted); font-size:12px;">Loading...</div>
                    </div>
                </div>

                <!-- Recent Sessions Card -->
                <div class="agent-dash-card">
                    <div class="agent-dash-card-title">🕐 Recent Sessions</div>
                    ${recentSessions.length ? recentSessions.map(s => `
                        <div class="agent-session-row" onclick="window._memoryCards.switchToSession('${escapeHtml(s.key)}')">
                            <span class="agent-session-name">${escapeHtml(s.displayName || s.key.replace(`agent:${agent.id}:`, ''))}</span>
                            <span class="agent-session-time">${timeAgo(new Date(s.updatedAt || 0).getTime())}</span>
                        </div>
                    `).join('') : '<div style="color:var(--text-muted); font-size:12px; padding:8px 0;">No sessions yet</div>'}
                </div>

                <!-- Memory Files Card -->
                <div class="agent-dash-card agent-dash-card-wide">
                    <div class="agent-dash-card-title" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>📁 Memory Files (${files.length})</span>
                        <button class="btn btn-ghost btn-xs" onclick="window._memoryCards.openAgentMemory('${agent.id}')">View All →</button>
                    </div>
                    <div class="agent-files-compact">
                        ${sortedFiles.slice(0, 8).map(f => `
                            <div class="agent-file-compact-row" onclick="window._memoryCards.previewFile('${escapeHtml(f.name)}')">
                                <span class="agent-file-compact-icon">${f.name.endsWith('.md') ? '📝' : '📄'}</span>
                                <span class="agent-file-compact-name">${escapeHtml(f.name)}</span>
                                <span class="agent-file-compact-date">${f.modified ? timeAgo(f.modified) : ''}</span>
                            </div>
                        `).join('') || '<div style="color:var(--text-muted); font-size:12px; padding:8px 0;">No files found</div>'}
                        ${files.length > 8 ? `<div style="color:var(--text-muted); font-size:11px; padding:6px 0;">+${files.length - 8} more — click "View All"</div>` : ''}
                    </div>
                </div>

                <!-- System Prompt Card -->
                <div class="agent-dash-card agent-dash-card-wide" id="agent-identity-card-${agent.id}">
                    <div class="agent-dash-card-title" style="display:flex; justify-content:space-between; align-items:center;">
                        <span>📋 System Prompt</span>
                        <button class="btn btn-ghost btn-xs" onclick="window._memoryCards.toggleIdentityExpand('${agent.id}')">Expand</button>
                    </div>
                    <div class="agent-identity-preview" id="agent-identity-preview-${agent.id}">
                        <div style="color:var(--text-muted); font-size:12px;">Loading...</div>
                    </div>
                </div>

            </div>

            <!-- File Preview Panel (hidden until file selected) -->
            <div class="agent-drill-preview" id="agent-drill-preview" style="display:none;"></div>
        `;

        // Load model config async
        loadAgentModelConfig(agent.id);
        // Load identity preview async
        loadAgentIdentityPreview(agent.id, agent, org);
    }

    async function loadAgentModelConfig(agentId) {
        const el = document.getElementById(`agent-model-config-${agentId}`);
        if (!el) return;

        try {
            const [agentModelRes, allModelsRes] = await Promise.all([
                fetch(`/api/models/agent/${agentId}`).then(r => r.json()),
                fetch('/api/models/list').then(r => r.json())
            ]);

            const currentModelId = (agentModelRes?.modelId && agentModelRes.modelId !== 'global/default')
                ? agentModelRes.modelId : null;
            const agentFallbacks = agentModelRes?.fallbackModels || null; // null = using global
            const globalFallbacks = agentModelRes?.globalFallbacks || [];
            const usingGlobalFallbacks = agentFallbacks === null;

            // Flatten all models for dropdowns
            const allModels = [];
            for (const [provider, models] of Object.entries(allModelsRes || {})) {
                for (const m of models) {
                    allModels.push({ id: m.id, name: m.name || m.id.split('/').pop(), provider });
                }
            }

            const modelOptions = allModels.map(m =>
                `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} <span style="opacity:0.6">(${escapeHtml(m.provider)})</span></option>`
            ).join('');

            // Build fallback list display
            const displayFallbacks = usingGlobalFallbacks ? globalFallbacks : agentFallbacks;
            const fallbackListHtml = (displayFallbacks || []).map((fb, i) => `
                <div class="agent-fallback-row" data-index="${i}" data-model="${escapeHtml(fb)}" ${usingGlobalFallbacks ? '' : 'draggable="true"'}>
                    <span class="agent-fallback-grip">⠿</span>
                    <span class="agent-fallback-num">${i + 1}</span>
                    <span class="agent-fallback-name">${escapeHtml(fb.split('/').pop())}</span>
                    <span class="agent-fallback-provider">${escapeHtml(window.getProviderFromModelId ? window.getProviderFromModelId(fb) : (fb.split('/')[0] || ''))}</span>
                    ${usingGlobalFallbacks ? '' : `<button class="agent-fallback-remove" onclick="window._memoryCards.removeFallback('${agentId}', ${i})" title="Remove">×</button>`}
                </div>
            `).join('') || `<div style="color:var(--text-muted); font-size:11px; padding:4px 0;">No fallbacks configured</div>`;

            el.innerHTML = `
                <!-- Primary model -->
                <div class="agent-model-row">
                    <label class="agent-model-label">Primary Model</label>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <select id="agent-primary-model-${agentId}" class="input agent-model-select">
                            <option value="global/default" ${!currentModelId ? 'selected' : ''}>🌐 Global Default</option>
                            ${allModels.map(m => `<option value="${escapeHtml(m.id)}" ${currentModelId === m.id ? 'selected' : ''}>${escapeHtml(m.name)} (${escapeHtml(m.provider)})</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Fallback chain -->
                <div class="agent-model-row" style="margin-top:10px;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                        <label class="agent-model-label" style="margin:0;">Fallback Chain</label>
                        ${usingGlobalFallbacks
                    ? `<span class="agent-fallback-source-badge">🌐 Global</span>`
                    : `<span class="agent-fallback-source-badge agent-fallback-source-custom">✏️ Custom</span>`
                }
                        ${usingGlobalFallbacks
                    ? `<button class="btn btn-ghost btn-xs" style="margin-left:auto;" onclick="window._memoryCards.customizeFallbacks('${agentId}')">Override →</button>`
                    : `<button class="btn btn-ghost btn-xs" style="margin-left:auto;" onclick="window._memoryCards.revertFallbacksToGlobal('${agentId}')">↩ Use Global</button>`
                }
                    </div>
                    <div id="agent-fallback-list-${agentId}" class="agent-fallback-list ${usingGlobalFallbacks ? 'agent-fallback-readonly' : ''}">
                        ${fallbackListHtml}
                    </div>
                    ${!usingGlobalFallbacks ? `
                    <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap; align-items:center;">
                        <select id="agent-fallback-add-${agentId}" class="input agent-model-select" style="max-width:200px;">
                            <option value="">— Add fallback —</option>
                            ${allModels.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)} (${escapeHtml(m.provider)})</option>`).join('')}
                        </select>
                        <button class="btn btn-secondary btn-xs" onclick="window._memoryCards.addFallback('${agentId}')">+ Add</button>
                    </div>` : ''}
                </div>

                <!-- Save row -->
                <div style="display:flex; gap:8px; align-items:center; margin-top:12px; padding-top:10px; border-top: 1px solid var(--border-subtle);">
                    <button class="btn btn-primary btn-sm" onclick="window._memoryCards.saveAgentModel('${agentId}')">💾 Save</button>
                    <button class="btn btn-ghost btn-sm" onclick="window._memoryCards.resetAgentModel('${agentId}')">↩ Reset to Global</button>
                    <div id="agent-model-save-status-${agentId}" style="font-size:11px; color:var(--text-muted); margin-left:auto; min-height:16px;"></div>
                </div>
                <div style="font-size:10px; color:var(--text-faint); margin-top:4px;">
                    Active: <strong>${escapeHtml(currentModelId || 'Global Default')}</strong>
                    · Fallbacks: <strong>${usingGlobalFallbacks ? 'Global (' + globalFallbacks.length + ')' : 'Custom (' + (agentFallbacks || []).length + ')'}</strong>
                </div>
            `;

            // Store current fallback state on element for mutations
            el.dataset.agentFallbacks = JSON.stringify(usingGlobalFallbacks ? null : (agentFallbacks || []));
            el.dataset.globalFallbacks = JSON.stringify(globalFallbacks);
            el.dataset.allModels = JSON.stringify(allModels);

            if (!usingGlobalFallbacks) {
                setTimeout(() => setupFallbackDragAndDrop(agentId), 0);
            }

        } catch (e) {
            el.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Failed to load model config</div>`;
        }
    }

    function getFallbackList(agentId) {
        const el = document.getElementById(`agent-model-config-${agentId}`);
        try { return JSON.parse(el?.dataset.agentFallbacks || 'null'); } catch { return null; }
    }

    function setFallbackList(agentId, list) {
        const el = document.getElementById(`agent-model-config-${agentId}`);
        if (el) el.dataset.agentFallbacks = JSON.stringify(list);
        // Re-render the fallback list rows
        const listEl = document.getElementById(`agent-fallback-list-${agentId}`);
        if (!listEl) return;
        const allModels = JSON.parse(el?.dataset.allModels || '[]');
        listEl.innerHTML = (list || []).map((fb, i) => `
            <div class="agent-fallback-row" data-index="${i}" data-model="${escapeHtml(fb)}" draggable="true">
                <span class="agent-fallback-grip">⠿</span>
                <span class="agent-fallback-num">${i + 1}</span>
                <span class="agent-fallback-name">${escapeHtml(fb.split('/').pop())}</span>
                <span class="agent-fallback-provider">${escapeHtml(window.getProviderFromModelId ? window.getProviderFromModelId(fb) : (fb.split('/')[0] || ''))}</span>
                <button class="agent-fallback-remove" onclick="window._memoryCards.removeFallback('${agentId}', ${i})" title="Remove">×</button>
            </div>
        `).join('') || `<div style="color:var(--text-muted); font-size:11px; padding:4px 0;">No fallbacks — add one below</div>`;

        setupFallbackDragAndDrop(agentId);
    }

    function setupFallbackDragAndDrop(agentId) {
        const listEl = document.getElementById(`agent-fallback-list-${agentId}`);
        if (!listEl) return;

        let dragSrcEl = null;
        let dragSrcIndex = -1;
        const rows = listEl.querySelectorAll('.agent-fallback-row[draggable="true"]');

        rows.forEach(row => {
            row.addEventListener('dragstart', function (e) {
                dragSrcEl = this;
                dragSrcIndex = parseInt(this.dataset.index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', this.dataset.index);
                this.style.opacity = '0.4';
            });

            row.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                return false;
            });

            row.addEventListener('dragenter', function (e) {
                if (this !== dragSrcEl) {
                    const targetIndex = parseInt(this.dataset.index);
                    this.style.borderTop = targetIndex < dragSrcIndex ? '2px solid var(--accent)' : '';
                    this.style.borderBottom = targetIndex > dragSrcIndex ? '2px solid var(--accent)' : '';
                }
            });

            row.addEventListener('dragleave', function (e) {
                this.style.borderTop = '';
                this.style.borderBottom = '';
            });

            row.addEventListener('drop', function (e) {
                e.stopPropagation();
                this.style.borderTop = '';
                this.style.borderBottom = '';

                if (dragSrcEl !== this) {
                    const toIndex = parseInt(this.dataset.index);
                    const current = getFallbackList(agentId) || [];
                    const movedItem = current.splice(dragSrcIndex, 1)[0];
                    current.splice(toIndex, 0, movedItem);
                    setFallbackList(agentId, current);
                }
                return false;
            });

            row.addEventListener('dragend', function (e) {
                this.style.opacity = '1';
                rows.forEach(r => {
                    r.style.borderTop = '';
                    r.style.borderBottom = '';
                });
            });
        });
    }

    function customizeFallbacks(agentId) {
        // Copy global fallbacks as starting point for custom chain
        const el = document.getElementById(`agent-model-config-${agentId}`);
        const globalFallbacks = JSON.parse(el?.dataset.globalFallbacks || '[]');
        setFallbackList(agentId, [...globalFallbacks]);
        // Re-render entire config to show edit UI
        loadAgentModelConfig(agentId);
        // Temporarily override to show as custom
        requestAnimationFrame(() => {
            const el2 = document.getElementById(`agent-model-config-${agentId}`);
            if (el2) el2.dataset.agentFallbacks = JSON.stringify([...globalFallbacks]);
            setFallbackList(agentId, [...globalFallbacks]);
        });
    }

    function revertFallbacksToGlobal(agentId) {
        const el = document.getElementById(`agent-model-config-${agentId}`);
        if (el) el.dataset.agentFallbacks = JSON.stringify(null);
        loadAgentModelConfig(agentId);
    }

    function addFallback(agentId) {
        const sel = document.getElementById(`agent-fallback-add-${agentId}`);
        if (!sel || !sel.value) return;
        const modelId = sel.value;
        const current = getFallbackList(agentId) || [];
        if (!current.includes(modelId)) {
            setFallbackList(agentId, [...current, modelId]);
        }
        sel.value = '';
    }

    function removeFallback(agentId, index) {
        const current = getFallbackList(agentId) || [];
        current.splice(index, 1);
        setFallbackList(agentId, current);
    }

    async function saveAgentModel(agentId) {
        const select = document.getElementById(`agent-primary-model-${agentId}`);
        const status = document.getElementById(`agent-model-save-status-${agentId}`);
        if (!select) return;

        const modelId = select.value;
        const fallbackModels = getFallbackList(agentId); // null = use global, array = custom
        status.textContent = 'Saving...';
        status.style.color = 'var(--text-muted)';

        try {
            const res = await fetch('/api/models/set-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, modelId, fallbackModels })
            });
            const data = await res.json();
            if (data.ok) {
                status.textContent = '✅ Saved';
                status.style.color = 'var(--success)';
                setTimeout(() => loadAgentModelConfig(agentId), 800);
            } else {
                status.textContent = `❌ ${data.error || 'Failed to save'}`;
                status.style.color = 'var(--brand-red)';
            }
        } catch (e) {
            status.textContent = `❌ Network error`;
            status.style.color = 'var(--brand-red)';
        }
    }

    async function resetAgentModel(agentId) {
        const status = document.getElementById(`agent-model-save-status-${agentId}`);
        if (status) { status.textContent = 'Resetting...'; status.style.color = 'var(--text-muted)'; }
        try {
            const res = await fetch('/api/models/set-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, modelId: 'global/default', fallbackModels: null })
            });
            const data = await res.json();
            if (data.ok) {
                if (status) { status.textContent = '✅ Reset to global'; status.style.color = 'var(--success)'; }
                setTimeout(() => loadAgentModelConfig(agentId), 800);
            }
        } catch (e) {
            if (status) { status.textContent = '❌ Failed'; status.style.color = 'var(--brand-red)'; }
        }
    }

    async function pingAgent(agentId) {
        const btn = document.getElementById(`agent-ping-btn-${agentId}`);
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        btn.textContent = '⏳ Pinging...';

        try {
            // Get this agent's configured model
            const agentModelRes = await fetch(`/api/models/agent/${agentId}`).then(r => r.json());
            const modelId = (agentModelRes?.modelId && agentModelRes.modelId !== 'global/default')
                ? agentModelRes.modelId
                : (window.currentModel || 'openrouter/auto');

            const start = Date.now();
            const res = await fetch('/api/models/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelId, prompt: 'Ping' })
            });
            const data = await res.json();
            const latency = data.latencyMs || (Date.now() - start);

            if (data.success) {
                btn.textContent = `✅ ${latency}ms`;
                btn.style.color = 'var(--success)';
            } else {
                btn.textContent = `❌ Error`;
                btn.style.color = 'var(--brand-red)';
                btn.title = data.error || 'Ping failed';
            }
        } catch (e) {
            btn.textContent = '❌ Failed';
            btn.style.color = 'var(--brand-red)';
        }

        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '⚡ Ping';
            btn.style.color = '';
        }, 5000);
    }

    async function loadAgentIdentityPreview(agentId, agent, org) {
        const el = document.getElementById(`agent-identity-preview-${agentId}`);
        if (!el) return;

        try {
            let content = null;
            // Try to load IDENTITY.md
            const identityFile = agent.files?.find(f => f.name === 'IDENTITY.md' || f.name === 'identity.md');
            if (identityFile) {
                const endpoint = agent.isDefault
                    ? `/api/memory/${encodeURIComponent(identityFile.name)}`
                    : `/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(identityFile.name)}`;
                const res = await fetch(endpoint);
                const data = await res.json();
                content = data.content || null;
            }

            if (content) {
                // Show first 300 chars collapsed, expand on button click
                const preview = content.slice(0, 300);
                const hasMore = content.length > 300;
                el.innerHTML = `
                    <div id="agent-identity-text-${agentId}" class="agent-identity-text collapsed">
                        <pre style="white-space:pre-wrap; font-size:11px; color:var(--text-secondary); margin:0;">${escapeHtml(preview)}${hasMore ? '...' : ''}</pre>
                    </div>
                    ${hasMore ? `<div id="agent-identity-full-${agentId}" class="agent-identity-text" style="display:none;"><pre style="white-space:pre-wrap; font-size:11px; color:var(--text-secondary); margin:0;">${escapeHtml(content)}</pre></div>` : ''}
                    <div style="margin-top:8px; display:flex; gap:8px;">
                        ${identityFile ? `<button class="btn btn-ghost btn-xs" onclick="${agent.isDefault ? `viewMemoryFile('${escapeHtml(identityFile.name)}')` : `viewAgentFile('${escapeHtml(agentId)}', '${escapeHtml(identityFile.name)}')`}">✏️ Edit</button>` : ''}
                    </div>
                `;
            } else {
                el.innerHTML = `<div style="color:var(--text-muted); font-size:12px; padding:4px 0;">No IDENTITY.md found. <button class="btn btn-ghost btn-xs" onclick="window._memoryCards.openAgentMemory('${agentId}')">Browse files →</button></div>`;
            }
        } catch (e) {
            el.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Could not load identity</div>`;
        }
    }

    function toggleIdentityExpand(agentId) {
        const collapsed = document.getElementById(`agent-identity-text-${agentId}`);
        const full = document.getElementById(`agent-identity-full-${agentId}`);
        const btn = document.querySelector(`#agent-identity-card-${agentId} .btn-ghost`);
        if (!collapsed) return;
        const isCollapsed = collapsed.style.display !== 'none';
        if (isCollapsed) {
            collapsed.style.display = 'none';
            if (full) full.style.display = '';
            if (btn) btn.textContent = 'Collapse';
        } else {
            collapsed.style.display = '';
            if (full) full.style.display = 'none';
            if (btn) btn.textContent = 'Expand';
        }
    }

    function switchToAgentChat(agentId) {
        if (typeof switchToAgent === 'function') switchToAgent(agentId);
        else if (typeof showPage === 'function') showPage('chat');
    }

    function switchToSession(sessionKey) {
        if (typeof window.switchToSession === 'function') {
            window.switchToSession(sessionKey);
            if (typeof showPage === 'function') showPage('chat');
        }
    }

    function openAgentMemory(agentId) {
        // Switch to classic view filtered to this agent's files
        if (window._memoryCards) window._memoryCards.setLayout('classic');
        const searchEl = document.getElementById('memory-search');
        if (searchEl) {
            searchEl.value = agentId;
            if (typeof renderMemoryFiles === 'function') renderMemoryFiles(agentId);
        }
        // Back out of drill-down
        currentDrilledAgent = null;
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

    // ── Keyboard Shortcuts ──
    function initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Only active when on memory page
            const memPage = document.getElementById('page-agents');
            if (!memPage || memPage.style.display === 'none') return;

            // Space + drag = pan
            if (e.code === 'Space') {
                isSpacePressed = true;
                document.body.classList.add('space-panning');
            }

            // Zoom shortcuts
            if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                zoomIn();
            }
            if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                zoomOut();
            }
            if (e.key === '0') {
                e.preventDefault();
                resetView();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                isSpacePressed = false;
                document.body.classList.remove('space-panning');
            }
        });
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
        initKeyboardShortcuts();
        setTimeout(() => {
            applyMemoryLayout();
        }, 200);
    });

    Object.assign(memoryCardsApi, {
        getLayout: getMemoryLayout,
        setLayout: setMemoryLayout,
        applyLayout: applyMemoryLayout,
        renderAgentCardsView,
        drillInto,
        backToGrid,
        previewFile,
        refresh,
        zoomIn,
        zoomOut,
        resetView,
        fitToContent,
        saveAgentModel,
        resetAgentModel,
        pingAgent,
        switchToAgentChat,
        switchToSession,
        openAgentMemory,
        toggleIdentityExpand,
        customizeFallbacks,
        revertFallbacksToGlobal,
        addFallback,
        removeFallback,
        toggleMinimap: function () {
            const minimap = document.getElementById('org-minimap');
            if (minimap) {
                minimap.classList.toggle('collapsed');
                localStorage.setItem('solobot-minimap-collapsed', minimap.classList.contains('collapsed'));
            }
        }
    });

    // Restore minimap state
    document.addEventListener('DOMContentLoaded', () => {
        const collapsed = localStorage.getItem('solobot-minimap-collapsed') === 'true';
        if (collapsed) {
            const minimap = document.getElementById('org-minimap');
            if (minimap) minimap.classList.add('collapsed');
        }
    });
})();
