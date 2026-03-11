// js/memory-cards.js — True Org-Chart Tree Layout with Pan/Zoom Navigation

(function () {
    'use strict';

    // Guard against early inline handler access before full API registration.
    const memoryCardsApi = window._memoryCards || (window._memoryCards = {});
    const $ = (id) => document.getElementById(id);
    if (typeof memoryCardsApi.wasDragging !== 'boolean') {
        memoryCardsApi.wasDragging = false;
    }

    let agentsData = [];
    let currentDrilledAgent = null;
    let agentMemoryRenderToken = 0;
    let agentCronRenderToken = 0;
    let agentMemoryFiles = [];
    let agentMemorySearch = "";
    let showDailySectionExpanded = false;
    let panzoomInstance = null;
    let isSpacePressed = false;
    let agentMetricsRefreshTimer = null;
    let sessionSwitchHookInstalled = false;
    const cardDetailsCache = new Map();
    const cardDetailsInflight = new Map();

    function sanitizeScale(rawScale, fallback = 1) {
        const n = Number(rawScale);
        if (!Number.isFinite(n) || n <= 0) return fallback;
        return Math.min(2.5, Math.max(0.3, n));
    }

    function setPanzoomScale(instance, scale, opts) {
        if (!instance) return;
        const safeScale = sanitizeScale(scale, 1);
        if (typeof instance.zoomAbs === 'function') {
            instance.zoomAbs(0, 0, safeScale);
            return;
        }
        if (typeof instance.zoomTo === 'function') {
            instance.zoomTo(0, 0, safeScale);
            return;
        }
        if (typeof instance.zoom === 'function') {
            instance.zoom(safeScale, opts);
        }
    }

    const ORG_VIEWPORT_STORAGE_KEY = 'solobot-orgchart-viewport-v2';
    const ORG_GRID_SPAN = 2;

    // ── Org-Tree Data Structure ──
    const ORG_TREE = {
        solo: { name: 'SoLo', role: 'President', title: 'President', emoji: '👑', reports: ['main', 'exec', 'family'], description: 'Founder & President', drillable: false },
        main: { name: 'Halo', role: 'PA', title: 'Personal Assistant', emoji: '🤖', reports: [], description: 'Personal Assistant' },
        exec: { name: 'Elon', role: 'CoS', title: 'CoS', emoji: '👔', reports: ['cfo', 'cto', 'cmp', 'coo'], description: 'Chief of Staff' },
        family: { name: 'Haven', role: 'HOME', title: 'Home', emoji: '🏠', reports: [], description: 'Family & Household' },
        cfo: { name: 'Sterling', role: 'CFO', title: 'CFO', emoji: '💰', reports: ['tax'], description: 'Chief Financial Officer' },
        cto: { name: 'Orion', role: 'CTO', title: 'CTO', emoji: '🧠', reports: ['net', 'dev', 'sec'], description: 'Chief Technical Officer' },
        cmp: { name: 'Vector', role: 'CMP', title: 'CMP', emoji: '📣', reports: ['art', 'smm'], description: 'Chief Marketing & Product' },
        coo: { name: 'Atlas', role: 'COO', title: 'COO', emoji: '📋', reports: [], description: 'Chief Operating Officer' },
        tax: { name: 'Ledger', role: 'TAX', title: 'Tax Specialist', emoji: '📒', reports: [], description: 'Tax Specialist' },
        art: { name: 'Luma', role: 'ART', title: 'Creative Design', emoji: '🎨', reports: [], description: 'Creative Design' },
        smm: { name: 'Nova', role: 'SMM', title: 'Social Media Manager', emoji: '📱', reports: ['youtube'], description: 'Social Media Manager' },
        youtube: { name: 'Snip', role: 'YT', title: 'YouTube Manager', emoji: '🎬', reports: [], description: 'YouTube Manager' },
        net: { name: 'Sentinel', role: 'NET', title: 'Network Admin', emoji: '📡', reports: [], description: 'Network Admin' },
        dev: { name: 'Dev', role: 'ENG', title: 'Head of Engineering', emoji: '⚙️', reports: ['ui', 'swe', 'devops'], description: 'Head of Engineering' },
        sec: { name: 'Knox', role: 'SEC', title: 'Security', emoji: '🔒', reports: [], description: 'Security' },
        ui: { name: 'Quill', role: 'FE/UI', title: 'Frontend/UI', emoji: '✒️', reports: [], description: 'Frontend / UI' },
        swe: { name: 'Chip', role: 'SWE', title: 'Software Engineer', emoji: '💻', reports: [], description: 'Software Engineer' },
        devops: { name: 'Forge', role: 'DEVOPS', title: 'DEVOPS', emoji: '🔨', reports: [], description: 'DevOps' }
    };

    const ORG_LAYOUT = {
        solo: { row: 1, col: 7 },
        main: { row: 2, col: 2 },
        exec: { row: 2, col: 6 },
        family: { row: 2, col: 10 },
        cfo: { row: 3, col: 2 },
        cto: { row: 3, col: 5 },
        cmp: { row: 3, col: 8 },
        coo: { row: 3, col: 11 },
        tax: { row: 4, col: 2 },
        art: { row: 4, col: 7 },
        smm: { row: 4, col: 9 },
        youtube: { row: 5, col: 9 },
        net: { row: 6, col: 3 },
        dev: { row: 6, col: 6 },
        sec: { row: 6, col: 9 },
        ui: { row: 7, col: 3 },
        swe: { row: 7, col: 6 },
        devops: { row: 7, col: 9 }
    };

    const ORG_ORDER = Object.keys(ORG_LAYOUT).sort((left, right) => {
        const leftPos = ORG_LAYOUT[left];
        const rightPos = ORG_LAYOUT[right];
        if (leftPos.row !== rightPos.row) return leftPos.row - rightPos.row;
        return leftPos.col - rightPos.col;
    });

    const ORG_TO_CANONICAL = {
        solo: null,
        main: 'main',
        exec: 'elon',
        cto: 'orion',
        coo: 'atlas',
        cfo: 'sterling',
        dev: 'dev',
        devops: 'forge',
        sec: 'knox',
        net: 'sentinel',
        cmp: 'vector',
        docs: 'canon',
        art: 'luma',
        tax: 'ledger',
        ui: 'quill',
        swe: 'chip',
        smm: 'nova',
        youtube: 'snip',
        family: 'haven'
    };

    const CANONICAL_TO_LEGACY_WORKSPACE = {
        elon: 'exec',
        orion: 'cto',
        atlas: 'coo',
        sterling: 'cfo',
        vector: 'cmp',
        quill: 'ui',
        chip: 'swe',
        snip: 'youtube',
        knox: 'sec',
        sentinel: 'net',
        haven: 'family',
        canon: 'docs',
        luma: 'creative'
    };

    const CANONICAL_TO_ORG = Object.entries(ORG_TO_CANONICAL).reduce((acc, [orgId, agentId]) => {
        if (agentId) acc[agentId] = orgId;
        return acc;
    }, {});

    const ORG_PARENT_MAP = Object.entries(ORG_TREE).reduce((acc, [parentId, info]) => {
        (info.reports || []).forEach((childId) => {
            acc[childId] = parentId;
        });
        return acc;
    }, {});

    function resolveAgentForOrgId(orgId, agentMap) {
        const direct = agentMap[orgId];
        if (direct) return direct;
        const canonical = ORG_TO_CANONICAL[orgId];
        return canonical ? agentMap[canonical] : null;
    }

    function resolveOrgId(agentId) {
        const normalized = String(agentId || '').toLowerCase();
        if (!normalized) return null;
        if (ORG_TREE[normalized]) return normalized;
        return CANONICAL_TO_ORG[normalized] || normalized;
    }

    function getApiAgentCandidates(agentId) {
        const canonical = String(agentId || '').toLowerCase();
        const legacy = CANONICAL_TO_LEGACY_WORKSPACE[canonical];
        return legacy && legacy !== canonical ? [canonical, legacy] : [canonical];
    }

    function escapeInlineJsString(value) {
        return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    async function fetchAgentFileWithFallback(agentId, filename) {
        let lastData = null;
        for (const candidate of getApiAgentCandidates(agentId)) {
            const res = await fetch(`/api/agents/${encodeURIComponent(candidate)}/files/${encodeURIComponent(filename)}?t=${Date.now()}`, { cache: 'no-store' });
            const data = await res.json();
            lastData = data;
            if (!data?.error || !/file not found/i.test(String(data.error || ''))) {
                return { data, apiAgentId: candidate };
            }
        }
        return { data: lastData || { error: 'File not found' }, apiAgentId: String(agentId || '').toLowerCase() };
    }

    function getOrgGridStyle(orgId) {
        const layout = ORG_LAYOUT[orgId];
        if (!layout) return '';
        return `grid-column: ${layout.col} / span ${ORG_GRID_SPAN}; grid-row: ${layout.row};`;
    }

    function addOrgBranch(orgId, visibleIds) {
        if (!ORG_TREE[orgId]) return;
        visibleIds.add(orgId);
        (ORG_TREE[orgId].reports || []).forEach((childId) => addOrgBranch(childId, visibleIds));
    }

    function collectVisibleOrgIds(filter, agentMap) {
        const query = String(filter || '').trim().toLowerCase();
        if (!query) {
            return {
                visibleIds: new Set(ORG_ORDER),
                highlightIds: new Set()
            };
        }

        const highlightIds = new Set();
        ORG_ORDER.forEach((orgId) => {
            const org = ORG_TREE[orgId];
            const agent = resolveAgentForOrgId(orgId, agentMap);
            const searchable = [
                org.name,
                org.title,
                org.role,
                org.description,
                agent?.name,
                agent?.description,
                agent?.role
            ].filter(Boolean).join(' ').toLowerCase();

            const matchesFiles = (agent?.files || []).some((file) =>
                String(file?.name || '').toLowerCase().includes(query)
            );

            if (searchable.includes(query) || matchesFiles) {
                highlightIds.add(orgId);
            }
        });

        if (!highlightIds.size) {
            return {
                visibleIds: new Set(),
                highlightIds
            };
        }

        const visibleIds = new Set();
        highlightIds.forEach((orgId) => {
            addOrgBranch(orgId, visibleIds);

            let cursor = orgId;
            while (ORG_PARENT_MAP[cursor]) {
                cursor = ORG_PARENT_MAP[cursor];
                visibleIds.add(cursor);
            }
        });

        return { visibleIds, highlightIds };
    }

    function getMemoryLayout() {
        const saved = localStorage.getItem('solobot-memory-layout');
        return saved === 'classic' ? 'org-tree' : (saved || 'org-tree');
    }

    function setMemoryLayout(layout) {
        const normalized = layout === 'classic' ? 'org-tree' : layout;
        localStorage.setItem('solobot-memory-layout', normalized);
        applyMemoryLayout();
    }

    function applyMemoryLayout() {
        const layout = getMemoryLayout();
        const cardsView = document.getElementById('memory-cards-view');

        if (cardsView) cardsView.style.display = '';

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

    function setAgentMetricsStatus(agentId, status, metrics) {
        const msgEl = document.getElementById(`agent-metric-msgs-${agentId}`);
        const costEl = document.getElementById(`agent-metric-cost-${agentId}`);
        if (!msgEl || !costEl) return;

        if (status === 'loading') {
            msgEl.textContent = '…';
            costEl.textContent = '…';
            msgEl.style.opacity = '0.7';
            costEl.style.opacity = '0.7';
            return;
        }

        msgEl.style.opacity = '';
        costEl.style.opacity = '';

        if (status === 'error') {
            msgEl.textContent = '—';
            costEl.textContent = '—';
            msgEl.title = 'Metrics unavailable';
            costEl.title = 'Metrics unavailable';
            return;
        }

        const msgs = Number(metrics?.msgsToday);
        const cost = Number(metrics?.estCostToday);

        msgEl.textContent = Number.isFinite(msgs) ? String(msgs) : '—';
        costEl.textContent = Number.isFinite(cost) ? `$${cost.toFixed(4)}` : '—';
        msgEl.title = '';
        costEl.title = '';
    }

    async function refreshAgentMetrics(agentId) {
        if (!agentId) return;
        setAgentMetricsStatus(agentId, 'loading');
        try {
            const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/metrics?range=today`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const metrics = await res.json();
            setAgentMetricsStatus(agentId, 'ready', metrics);
        } catch (e) {
            console.warn('[Agents] metrics refresh failed:', e.message);
            setAgentMetricsStatus(agentId, 'error');
        }
    }

    function scheduleAgentMetricsRefresh(agentId) {
        if (agentMetricsRefreshTimer) {
            clearInterval(agentMetricsRefreshTimer);
            agentMetricsRefreshTimer = null;
        }
        if (!agentId) return;
        refreshAgentMetrics(agentId);
        agentMetricsRefreshTimer = setInterval(() => {
            if (!currentDrilledAgent || currentDrilledAgent.id !== agentId) return;
            refreshAgentMetrics(agentId);
        }, 45000);
    }

    function installSessionSwitchMetricsHook() {
        if (sessionSwitchHookInstalled) return;
        if (typeof window.switchToSession !== 'function') return;

        const original = window.switchToSession;
        if (original && original._memoryCardsMetricsWrapped) {
            sessionSwitchHookInstalled = true;
            return;
        }

        const wrapped = async function(...args) {
            const result = await original.apply(this, args);
            if (currentDrilledAgent?.id) {
                refreshAgentMetrics(currentDrilledAgent.id);
            }
            return result;
        };
        wrapped._memoryCardsMetricsWrapped = true;
        window.switchToSession = wrapped;
        sessionSwitchHookInstalled = true;
    }

    function getStaleFlagFromDate(dateLike) {
        if (!dateLike) return false;
        const ts = new Date(dateLike).getTime();
        if (!Number.isFinite(ts)) return false;
        return (Date.now() - ts) > (2 * 60 * 60 * 1000);
    }

    function normalizeCardDetailsPayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return { activeTaskCount: null, lastUpdateIso: null, isStale: false };
        }

        const activeTaskCount = Number.isFinite(Number(payload.activeTaskCount))
            ? Number(payload.activeTaskCount)
            : Number.isFinite(Number(payload?.meta?.activeTaskCount))
                ? Number(payload.meta.activeTaskCount)
                : null;

        const lastUpdateIso = payload.lastUpdateIso
            || payload.lastUpdateAt
            || payload?.meta?.lastUpdateIso
            || payload?.meta?.lastUpdateAt
            || null;

        const isStale = (typeof payload.isStale === 'boolean')
            ? payload.isStale
            : getStaleFlagFromDate(lastUpdateIso);

        return { activeTaskCount, lastUpdateIso, isStale };
    }

    function applyOrgCardDetails(orgId, details) {
        const tasksEl = document.getElementById(`org-meta-tasks-${orgId}`);
        const updateEl = document.getElementById(`org-meta-update-${orgId}`);
        if (!tasksEl || !updateEl) return;

        const taskText = Number.isFinite(details?.activeTaskCount) ? String(details.activeTaskCount) : '—';
        const updateText = details?.lastUpdateIso ? timeAgo(details.lastUpdateIso) : '—';

        tasksEl.textContent = taskText;
        updateEl.textContent = updateText;

        const stale = !!details?.isStale;
        updateEl.style.opacity = stale ? '0.72' : '';
        updateEl.style.fontStyle = stale ? 'italic' : '';
        updateEl.title = stale ? 'Stale: no updates in >2h' : '';
    }

    async function fetchOrgCardDetails(orgId, agentId) {
        const cacheKey = `${orgId}:${agentId || ''}`;
        if (cardDetailsCache.has(cacheKey)) {
            return cardDetailsCache.get(cacheKey);
        }
        if (cardDetailsInflight.has(cacheKey)) {
            return cardDetailsInflight.get(cacheKey);
        }

        const req = (async () => {
            try {
                const res = await fetch(`/api/agents/${encodeURIComponent(agentId || orgId)}/card-details`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const payload = await res.json();
                const normalized = normalizeCardDetailsPayload(payload);
                cardDetailsCache.set(cacheKey, normalized);
                return normalized;
            } catch (e) {
                console.warn('[Agents] card-details fetch failed:', orgId, agentId, e.message);
                const fallback = { activeTaskCount: null, lastUpdateIso: null, isStale: false };
                cardDetailsCache.set(cacheKey, fallback);
                return fallback;
            } finally {
                cardDetailsInflight.delete(cacheKey);
            }
        })();

        cardDetailsInflight.set(cacheKey, req);
        return req;
    }

    async function hydrateOrgCardDetails(nodes) {
        if (!nodes) return;

        const ids = [];
        (Array.isArray(nodes) ? nodes : Object.values(nodes).flat()).forEach(({ id, agent }) => {
            const targetAgentId = agent?.id || ORG_TO_CANONICAL[id] || null;
            if (!targetAgentId) return;
            ids.push({ orgId: id, agentId: targetAgentId });
        });

        await Promise.all(ids.map(async ({ orgId, agentId }) => {
            const details = await fetchOrgCardDetails(orgId, agentId);
            applyOrgCardDetails(orgId, details);
        }));
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

    function getOrgNodeMetrics(orgId) {
        const canvas = document.getElementById('org-tree-canvas');
        const nodeCard = document.querySelector(`.org-node[data-agent="${orgId}"] .org-node-card`);
        if (!canvas || !nodeCard) return null;

        const canvasRect = canvas.getBoundingClientRect();
        const nodeRect = nodeCard.getBoundingClientRect();

        return {
            centerX: (nodeRect.left - canvasRect.left) + (nodeRect.width / 2),
            topY: nodeRect.top - canvasRect.top,
            bottomY: nodeRect.bottom - canvasRect.top
        };
    }

    function buildConnectorLine(x1, y1, x2, y2) {
        return `<line class="org-connector" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
    }

    function syncOrgCanvasSize() {
        const canvas = document.getElementById('org-tree-canvas');
        const grid = canvas?.querySelector('.org-tree-grid');
        if (!canvas || !grid) return;

        const canvasStyles = window.getComputedStyle(canvas);
        const padX = parseFloat(canvasStyles.paddingLeft || '0') + parseFloat(canvasStyles.paddingRight || '0');
        const padY = parseFloat(canvasStyles.paddingTop || '0') + parseFloat(canvasStyles.paddingBottom || '0');

        canvas.style.width = `${Math.ceil(grid.scrollWidth + padX)}px`;
        canvas.style.height = `${Math.ceil(grid.scrollHeight + padY)}px`;
    }

    function drawOrgConnectors(visibleIds) {
        const svg = document.querySelector('.org-tree-connectors');
        const canvas = document.getElementById('org-tree-canvas');
        if (!svg || !canvas) return;

        const width = Math.ceil(canvas.offsetWidth);
        const height = Math.ceil(canvas.offsetHeight);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        let markup = '';
        Object.entries(ORG_TREE).forEach(([parentId, info]) => {
            if (!visibleIds.has(parentId)) return;
            const parentMetrics = getOrgNodeMetrics(parentId);
            if (!parentMetrics) return;

            const childMetrics = (info.reports || [])
                .filter((childId) => visibleIds.has(childId))
                .map((childId) => ({ id: childId, metrics: getOrgNodeMetrics(childId) }))
                .filter((entry) => entry.metrics);

            if (!childMetrics.length) return;

            const childTopY = Math.min(...childMetrics.map((entry) => entry.metrics.topY));
            const branchY = Math.round(
                parentMetrics.bottomY + Math.max(18, Math.min(54, (childTopY - parentMetrics.bottomY) / 2))
            );

            markup += buildConnectorLine(parentMetrics.centerX, parentMetrics.bottomY, parentMetrics.centerX, branchY);

            if (childMetrics.length === 1) {
                const onlyChild = childMetrics[0].metrics;
                if (Math.abs(onlyChild.centerX - parentMetrics.centerX) > 1) {
                    markup += buildConnectorLine(parentMetrics.centerX, branchY, onlyChild.centerX, branchY);
                }
            } else {
                const childCenters = childMetrics.map((entry) => entry.metrics.centerX).sort((left, right) => left - right);
                markup += buildConnectorLine(childCenters[0], branchY, childCenters[childCenters.length - 1], branchY);
            }

            childMetrics.forEach(({ metrics }) => {
                markup += buildConnectorLine(metrics.centerX, branchY, metrics.centerX, metrics.topY);
            });
        });

        svg.innerHTML = markup;
    }

    // ── Pan/Zoom Navigation ──
    function initPanZoom(forceFit = false) {
        const wrapper = document.querySelector('.org-tree-wrapper');
        const viewport = document.querySelector('.org-tree-viewport');
        if (!wrapper || !viewport || !window.panzoom) return;

        if (panzoomInstance) {
            panzoomInstance.dispose();
        }

        panzoomInstance = window.panzoom(viewport, {
            maxZoom: 2.5,
            minZoom: 0.45,
            zoomSpeed: 0.5,
            panSpeed: 0.5,
            bounds: false,
            boundsPadding: 0.08,
            disablePanOnZoom: false,
            disableZoomOnPan: false,
            exclude: ['.org-node-card'],
            onTouch: function (e) {
                return !e.target.closest('.org-node-card');
            }
        });

        let restored = false;
        if (!forceFit) {
            const savedState = localStorage.getItem(ORG_VIEWPORT_STORAGE_KEY);
            if (savedState) {
                try {
                    const { x, y, scale } = JSON.parse(savedState);
                    const safeX = Number.isFinite(Number(x)) ? Number(x) : 0;
                    const safeY = Number.isFinite(Number(y)) ? Number(y) : 0;
                    panzoomInstance.moveTo(safeX, safeY);
                    setPanzoomScale(panzoomInstance, scale);
                    restored = true;
                } catch (e) {
                    console.warn('Failed to restore org viewport state:', e);
                }
            }
        }

        let rafId = null;
        panzoomInstance.on('panzoom', () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const state = panzoomInstance.getTransform();
                localStorage.setItem(ORG_VIEWPORT_STORAGE_KEY, JSON.stringify({
                    x: state.x,
                    y: state.y,
                    scale: state.scale
                }));
                updateMinimap();
            });
        });

        setTimeout(() => {
            if (!restored || forceFit) {
                fitToContent(false);
            } else {
                updateMinimap();
            }
        }, 60);
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
        fitToContent(true);
    }

    function fitToContent(animate = true) {
        if (!panzoomInstance) return;
        const wrapper = document.querySelector('.org-tree-wrapper');
        const canvas = document.getElementById('org-tree-canvas');
        if (!wrapper || !canvas) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const contentWidth = Number(canvas.offsetWidth);
        const contentHeight = Number(canvas.offsetHeight);

        const safeWrapperW = Number.isFinite(wrapperRect.width) && wrapperRect.width > 0 ? wrapperRect.width : 1;
        const safeWrapperH = Number.isFinite(wrapperRect.height) && wrapperRect.height > 0 ? wrapperRect.height : 1;
        const safeContentW = Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : 1;
        const safeContentH = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : 1;

        const scale = sanitizeScale(Math.min(
            (safeWrapperW - 96) / safeContentW,
            (safeWrapperH - 120) / safeContentH,
            1.05
        ), 1);

        setPanzoomScale(panzoomInstance, scale, animate ? { animate: true } : undefined);

        const x = Math.round((safeWrapperW - (safeContentW * scale)) / 2);
        const y = Math.round((safeWrapperH - (safeContentH * scale)) / 2);
        panzoomInstance.moveTo(x, y);
        updateMinimap();

        localStorage.setItem(ORG_VIEWPORT_STORAGE_KEY, JSON.stringify({ x, y, scale }));
    }

    // ── Minimap Navigator ──
    function drawOrgMinimap(visibleIds) {
        const minimapContent = document.querySelector('.org-minimap-content');
        const canvas = document.getElementById('org-tree-canvas');
        if (!minimapContent || !canvas) return;

        const width = Math.max(canvas.offsetWidth, 1);
        const height = Math.max(canvas.offsetHeight, 1);

        minimapContent.innerHTML = Array.from(visibleIds).map((orgId) => {
            const metrics = getOrgNodeMetrics(orgId);
            if (!metrics) return '';
            const left = ((metrics.centerX / width) * 100).toFixed(3);
            const top = (((metrics.topY + 12) / height) * 100).toFixed(3);
            return `<div class="org-minimap-node" data-agent="${orgId}" style="left:${left}%; top:${top}%;"></div>`;
        }).join('');
    }

    function updateMinimap() {
        const minimap = document.querySelector('.org-minimap');
        const minimapContent = minimap?.querySelector('.org-minimap-content');
        const indicator = minimap?.querySelector('.org-minimap-viewport');
        const wrapper = document.querySelector('.org-tree-wrapper');
        const canvas = document.getElementById('org-tree-canvas');
        if (!minimap || !minimapContent || !indicator || !wrapper || !canvas || !panzoomInstance) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const contentRect = minimapContent.getBoundingClientRect();
        const canvasWidth = Math.max(canvas.offsetWidth, 1);
        const canvasHeight = Math.max(canvas.offsetHeight, 1);
        const state = panzoomInstance.getTransform();
        const scale = state.scale || 1;

        const viewportWidth = wrapperRect.width / scale;
        const viewportHeight = wrapperRect.height / scale;
        const viewportX = -state.x / scale;
        const viewportY = -state.y / scale;
        const scaleX = contentRect.width / canvasWidth;
        const scaleY = contentRect.height / canvasHeight;

        indicator.style.width = `${Math.max(16, viewportWidth * scaleX)}px`;
        indicator.style.height = `${Math.max(12, viewportHeight * scaleY)}px`;
        indicator.style.transform = `translate(${viewportX * scaleX}px, ${viewportY * scaleY}px)`;
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
        agentsData.forEach((agent) => {
            agentMap[agent.id] = agent;
        });

        const { visibleIds, highlightIds } = collectVisibleOrgIds(filter, agentMap);
        const stats = computeStats(agentsData);
        const today = new Date().toDateString();
        const hasSearch = Boolean(String(filter || '').trim());

        cardDetailsCache.clear();

        let html = `
            <div class="agent-stats-bar">
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalAgents}</span><span class="agent-stat-label">Agents</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.totalFiles}</span><span class="agent-stat-label">Files</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.modifiedToday}</span><span class="agent-stat-label">Modified Today</span></div>
                <div class="agent-stat"><span class="agent-stat-value">${stats.activeAgents}</span><span class="agent-stat-label">Active Today</span></div>
            </div>
        `;

        if (!visibleIds.size) {
            container.innerHTML = `${html}
                <div class="empty-state" style="padding:32px; border:1px solid var(--border-default); border-radius:var(--radius-lg); background:var(--surface-1);">
                    <p>No agents match “${escapeHtml(String(filter || '').trim())}”.</p>
                </div>
            `;
            return;
        }

        html += `
            <div class="org-chart-shell">
                <div class="org-nav-controls">
                    <button class="org-nav-btn" onclick="window._memoryCards.zoomIn()" title="Zoom in (+)">+</button>
                    <button class="org-nav-btn" onclick="window._memoryCards.zoomOut()" title="Zoom out (-)">−</button>
                    <button class="org-nav-btn" onclick="window._memoryCards.fitToContent()" title="Fit to screen">⊡</button>
                    <button class="org-nav-btn" onclick="window._memoryCards.resetView()" title="Reset view (0)">⌂</button>
                </div>

                <div class="org-minimap" id="org-minimap">
                    <button class="org-minimap-toggle" onclick="window._memoryCards.toggleMinimap()" title="Toggle minimap">⊡</button>
                    <div class="org-minimap-content"></div>
                    <div class="org-minimap-viewport"></div>
                </div>

                <div class="org-tree-wrapper">
                    <div class="org-tree-viewport">
                        <div class="org-tree-canvas" id="org-tree-canvas">
                            <svg class="org-tree-connectors" aria-hidden="true"></svg>
                            <div class="org-tree-grid">
        `;

        const visibleNodes = [];
        ORG_ORDER.forEach((orgId) => {
            if (!visibleIds.has(orgId)) return;
            const org = ORG_TREE[orgId];
            const agent = resolveAgentForOrgId(orgId, agentMap);
            visibleNodes.push({ id: orgId, agent });
            html += renderOrgNode(orgId, org, agent, today, {
                isHighlighted: highlightIds.has(orgId),
                isContext: highlightIds.size > 0 && !highlightIds.has(orgId)
            });
        });

        html += `
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        const minimap = document.getElementById('org-minimap');
        if (localStorage.getItem('solobot-minimap-collapsed') === 'true' && minimap) {
            minimap.classList.add('collapsed');
        }

        requestAnimationFrame(() => {
            syncOrgCanvasSize();
            drawOrgConnectors(visibleIds);
            drawOrgMinimap(visibleIds);
            initPanZoom(hasSearch);
            updateMinimap();
        });

        hydrateOrgCardDetails(visibleNodes).catch((e) => {
            console.warn('[Agents] Failed to hydrate org card details:', e.message);
        });
    }

    function renderOrgNode(id, org, agent, today, state = {}) {
        const files = agent?.files || [];
        const fileCount = files.length;
        const isDefault = agent?.isDefault;
        const isDrillable = Boolean(agent && org.drillable !== false);
        const isFounderNode = id === 'solo';
        const sortedFiles = [...files].sort((left, right) => {
            if (!left.modified) return 1;
            if (!right.modified) return -1;
            return new Date(right.modified) - new Date(left.modified);
        });
        const lastMod = sortedFiles[0]?.modified;
        const hasToday = files.some((file) => file.modified && new Date(file.modified).toDateString() === today);
        const statusClass = hasToday ? 'status-active' : 'status-idle';

        const nodeClasses = [
            'org-node',
            isDrillable ? 'is-drillable' : 'is-static',
            state.isHighlighted ? 'is-highlighted' : '',
            state.isContext ? 'is-context' : ''
        ].filter(Boolean).join(' ');

        const directReports = ORG_TREE.solo?.reports?.length || 0;
        const executiveLeads = ORG_TREE.exec?.reports?.length || 0;

        const operationalSummary = isDrillable
            ? `
                <div class="org-node-stats">
                    <span class="org-node-stat-chip"><strong>${fileCount}</strong> files</span>
                    <span class="org-node-stat-chip"><strong id="org-meta-tasks-${id}">—</strong> tasks</span>
                </div>
                <div class="org-node-foot">
                    <span>${lastMod ? `Files ${timeAgo(lastMod)}` : 'No files yet'}</span>
                    <span class="org-node-foot-sep">•</span>
                    <span>Updated <span id="org-meta-update-${id}">—</span></span>
                </div>
            `
            : `
                <div class="org-node-stats">
                    <span class="org-node-stat-chip"><strong>${directReports}</strong> direct reports</span>
                    <span class="org-node-stat-chip"><strong>${executiveLeads}</strong> executive leads</span>
                </div>
                <div class="org-node-foot org-node-foot-static">Strategy · priorities · approvals</div>
            `;

        const clickAttr = isDrillable ? `onclick="window._memoryCards.drillInto('${id}')"` : '';

        const topMeta = isDrillable
            ? `
                <div class="org-node-top-meta">
                    <span class="org-node-avatar">${org.emoji || '•'}</span>
                    <span class="org-node-status ${statusClass}"></span>
                </div>
            `
            : `<span class="org-node-avatar">${org.emoji || '•'}</span>`;

        const roleLine = isFounderNode
            ? escapeHtml(org.description || org.role)
            : `${escapeHtml(org.role)}${org.description ? ` · ${escapeHtml(org.description)}` : ''}`;

        return `
            <div class="${nodeClasses}" ${clickAttr} data-agent="${id}" style="${getOrgGridStyle(id)}">
                <div class="org-node-card">
                    <div class="org-node-title-row">
                        <span class="org-node-title">${escapeHtml(org.title || org.role)}</span>
                        ${topMeta}
                    </div>
                    <div class="org-node-name">
                        ${escapeHtml(org.name)}
                        ${isDefault ? '<span class="agent-card-badge">DEFAULT</span>' : ''}
                    </div>
                    <div class="org-node-role">${roleLine}</div>
                    ${operationalSummary}
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
        const org = ORG_TREE[resolveOrgId(agent._orgId || agent.id)] || {};
        tb.innerHTML = `
            <button class="btn btn-ghost btn-sm" onclick="window._memoryCards.backToGrid()" style="flex-shrink:0; white-space:nowrap;">← Agents</button>
            <span style="width:1px; height:24px; background:var(--border-subtle); flex-shrink:0;"></span>
            <span style="font-size:22px; line-height:1; flex-shrink:0;">${org.emoji || agent.emoji || '🤖'}</span>
            <div style="min-width:0; overflow:hidden;">
                <div style="font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(org.name || agent.name)}</div>
                ${(org.title || org.role) ? `<div style="font-size:11px; color:var(--text-muted); white-space:nowrap;">${escapeHtml(org.title || org.role)}</div>` : ''}
            </div>
            <span class="agent-status-badge ${statusClass}" style="flex-shrink:0;">${statusLabel}</span>
            <span style="width:1px; height:24px; background:var(--border-subtle); flex-shrink:0;"></span>
            <button class="btn btn-primary btn-sm" style="flex-shrink:0;" onclick="window._memoryCards.switchToAgentChat('${agent.id}')">💬 Chat</button>
            <button class="btn btn-secondary btn-sm" style="flex-shrink:0;" id="agent-ping-btn-${agent.id}" onclick="window._memoryCards.pingAgent('${agent.id}')">⚡ Ping</button>
            <input type="text" id="memory-search" class="input agents-toolbar-search" placeholder="🔍 Search…"
                oninput="window._memoryCards && window._memoryCards.renderAgentCardsView(this.value)"
                style="margin-left:auto;">
        `;
    }

    function updateToolbarDefault() {
        const tb = document.querySelector('.agents-toolbar');
        if (!tb) return;
        tb.innerHTML = `
            <input type="text" id="memory-search" class="input agents-toolbar-search"
                placeholder="🔍  Search agents…"
                oninput="window._memoryCards && window._memoryCards.renderAgentCardsView(this.value)">
            <button class="btn btn-secondary btn-sm" onclick="syncMemoryFilesNow()">🔄 Sync</button>
            <div id="sync-status" class="sync-status" style="white-space:nowrap; flex-shrink:0; margin-left:auto;">
                <span class="status-dot success"></span>
                <span id="last-memory-sync" style="font-size:11px; color:var(--text-muted);">--</span>
            </div>
        `;
    }

    function drillInto(agentId) {
        // If agentsData not yet loaded, wait for it
        if (!agentsData || !agentsData.length) {
            setTimeout(() => drillInto(agentId), 200);
            return;
        }
        const orgId = resolveOrgId(agentId);
        const canonicalId = ORG_TO_CANONICAL[orgId] || orgId;
        const found = agentsData.find(a => String(a.id || '').toLowerCase() === canonicalId);
        currentDrilledAgent = found ? { ...found, _orgId: orgId } : null;
        if (!currentDrilledAgent) {
            console.warn('[Agents] drillInto: agent not found:', agentId, 'canonical:', canonicalId);
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
        agentCronRenderToken += 1;
        if (agentMetricsRefreshTimer) {
            clearInterval(agentMetricsRefreshTimer);
            agentMetricsRefreshTimer = null;
        }
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

        // Compute token/cost summary from activity log (with resilient fallbacks)
        const activityLog = window.state?.activityLog || [];
        const agentPrefix = `agent:${agent.id}:`;
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();

        const todayEvents = activityLog.filter(e => {
            const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
            return ts >= todayStartMs && (e.session?.startsWith(agentPrefix) || e.agentId === agent.id);
        });

        let msgCount = todayEvents.filter(e => e.type === 'message' || e.type === 'chat').length;
        let tokenCount = todayEvents.reduce((sum, e) => sum + (e.tokens || 0), 0);

        // Fallback #1: derive today's message count from cached chat sessions
        if (msgCount === 0) {
            try {
                const chatSessions = window.state?.chat?.sessions || {};
                for (const s of agentSessions) {
                    const key = s.key;
                    const messages = Array.isArray(chatSessions[key]) ? chatSessions[key] : [];
                    for (const m of messages) {
                        const ts = m?.timestamp
                            ? new Date(m.timestamp).getTime()
                            : (Number.isFinite(m?.time) ? Number(m.time) : 0);
                        const role = String(m?.role || m?.from || '').toLowerCase();
                        if (ts >= todayStartMs && (role === 'user' || role === 'assistant')) {
                            msgCount += 1;
                        }
                    }
                }
            } catch (_) { /* no-op */ }
        }

        // Fallback #2: if no token telemetry events, estimate from today's session token totals
        if (tokenCount === 0) {
            tokenCount = agentSessions.reduce((sum, s) => {
                const ts = s?.updatedAt ? new Date(s.updatedAt).getTime() : 0;
                if (ts >= todayStartMs) {
                    return sum + (Number(s?.totalTokens) || 0);
                }
                return sum;
            }, 0);
        }

        const estCost = (tokenCount * 0.000003).toFixed(4);

        // Recent 5 sessions for this agent
        const recentSessions = agentSessions
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
            .slice(0, 5);

        const agentSectionMap = {
            net: { title: '📟 System', page: 'system', desc: 'System Messages & operations context' },
            cmp: { title: '📦 Products', page: 'products', desc: 'Product catalog and roadmap context' },
            cfo: { title: '💼 Business', page: 'business', desc: 'Business KPIs, finance, and planning' },
            sec: { title: '🛡️ Security', page: 'security', desc: 'Security & access controls' }
        };
        const agentSection = agentSectionMap[resolveOrgId(agent._orgId || agent.id)] || null;

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
                        <div class="agent-dash-stat"><span class="agent-dash-stat-val" id="agent-metric-msgs-${agent.id}">…</span><span class="agent-dash-stat-label">Msgs Today</span></div>
                        <div class="agent-dash-stat"><span class="agent-dash-stat-val" id="agent-metric-cost-${agent.id}">…</span><span class="agent-dash-stat-label">Est. Cost Today</span></div>
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

                <div class="agent-dash-card">
                    <div class="agent-dash-card-title">🛠️ Agent Recovery</div>
                    <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:6px;">
                        <button class="btn btn-secondary btn-sm" onclick="window._agentRecovery && window._agentRecovery.check()">Check Session Health</button>
                        <button class="btn btn-secondary btn-sm" onclick="window._agentRecovery && window._agentRecovery.ping()">Send Async Ping</button>
                        <button class="btn btn-ghost btn-sm" onclick="window._agentRecovery && window._agentRecovery.openChat()">Open Agent Chat</button>
                        <button class="btn btn-ghost btn-sm" onclick="window._agentRecovery && window._agentRecovery.refresh()">Refresh Sessions</button>
                    </div>
                    <div id="agent-recovery-status" style="margin-top:8px; font-size:12px; color:var(--text-muted);">Run recovery actions for this agent.</div>
                </div>

                ${agentSection ? `
                <div class="agent-dash-card">
                    <div class="agent-dash-card-title">${agentSection.title}</div>
                    <div style="color:var(--text-muted); font-size:12px; margin-bottom:10px;">${agentSection.desc}</div>
                    <button class="btn btn-secondary btn-sm" onclick="showPage('${agentSection.page}')">Open ${agentSection.title.replace(/^\S+\s/, '')}</button>
                </div>
                ` : ''}

                <div class="agent-dash-card agent-dash-card-wide">
                    <div class="agent-dash-card-title" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span>⏰ Cron Jobs</span>
                        <button class="btn btn-ghost btn-xs" type="button" onclick="window._memoryCards.openCronPage()">Open Cron</button>
                    </div>
                    <div id="agent-cron-jobs-${agent.id}" class="agent-cron-jobs-body">
                        <div class="agent-cron-empty">Loading…</div>
                    </div>
                </div>

            </div>

            <!-- File Preview Panel (hidden until file selected) -->
            <div class="agent-drill-preview" id="agent-drill-preview" style="display:none;"></div>
        `;

        // Load authoritative backend metrics (immediate + interval refresh)
        scheduleAgentMetricsRefresh(agent.id);

        // Load model config async
        loadAgentModelConfig(agent.id);
        // Load assigned cron jobs async
        loadAgentCronJobs(agent);
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

    function getAgentCronStatusBadgeClass(job, lastStatus) {
        if (job?.enabled === false) return 'badge-default';
        const normalized = String(lastStatus || '').trim().toLowerCase();
        if (normalized === 'ok' || normalized === 'success') return 'badge-success';
        if (normalized === 'error' || normalized === 'failed') return 'badge-error';
        return 'badge-default';
    }

    async function loadAgentCronJobs(agent) {
        const el = document.getElementById(`agent-cron-jobs-${agent.id}`);
        if (!el) return;

        const token = ++agentCronRenderToken;
        const cronApi = window._cronJobs;
        if (!cronApi || typeof cronApi.ensureLoaded !== 'function' || typeof cronApi.getJobs !== 'function') {
            el.innerHTML = `<div class="agent-cron-empty">Cron jobs are unavailable.</div>`;
            return;
        }

        const orgId = resolveOrgId(agent._orgId || agent.id);
        const candidateIds = new Set();
        const canonicalAgentId = String(agent.id || '').trim().toLowerCase();
        if (canonicalAgentId) candidateIds.add(canonicalAgentId);
        if (orgId) candidateIds.add(orgId);
        if (orgId && ORG_TO_CANONICAL[orgId]) candidateIds.add(String(ORG_TO_CANONICAL[orgId]).toLowerCase());

        try {
            await cronApi.ensureLoaded({ silent: true, skipDiagnostics: true });
            if (token !== agentCronRenderToken) return;

            const jobs = cronApi.getJobs();
            const assignedJobs = jobs
                .filter((job) => {
                    const ownerRaw = typeof cronApi.getOwnerAgent === 'function'
                        ? cronApi.getOwnerAgent(job)
                        : (job?.agentId || job?.ownerAgentId || '');
                    const owner = String(ownerRaw || '').trim().toLowerCase();
                    if (!owner) return false;

                    const ownerOrgId = resolveOrgId(owner);
                    const ownerCanonicalId = ownerOrgId && ORG_TO_CANONICAL[ownerOrgId]
                        ? String(ORG_TO_CANONICAL[ownerOrgId]).toLowerCase()
                        : owner;

                    return candidateIds.has(owner) ||
                        (ownerOrgId && candidateIds.has(ownerOrgId)) ||
                        candidateIds.has(ownerCanonicalId);
                })
                .sort((left, right) => String(left?.name || left?.id || '').localeCompare(
                    String(right?.name || right?.id || ''),
                    undefined,
                    { sensitivity: 'base', numeric: true }
                ));

            const hasConnection = typeof cronApi.isConnected === 'function' ? cronApi.isConnected() : true;
            if (!assignedJobs.length) {
                const emptyMessage = !hasConnection && !jobs.length
                    ? 'Connect to the gateway to load cron jobs.'
                    : `No cron jobs assigned to ${agent.name || 'this agent'}.`;
                el.innerHTML = `<div class="agent-cron-empty">${escapeHtml(emptyMessage)}</div>`;
                return;
            }

            el.innerHTML = `
                <div class="agent-cron-summary">${assignedJobs.length} job${assignedJobs.length === 1 ? '' : 's'} assigned</div>
                <div class="agent-cron-list">
                    ${assignedJobs.map((job) => {
                        const jobId = String(job?.id || '');
                        const jobName = job?.name || jobId || 'Unnamed job';
                        const lastStatus = typeof cronApi.getLastStatus === 'function' ? cronApi.getLastStatus(job) : '--';
                        const scheduleText = typeof cronApi.formatSchedule === 'function' ? cronApi.formatSchedule(job) : '--';
                        const nextRun = typeof cronApi.formatNextRun === 'function' ? cronApi.formatNextRun(job) : '--';
                        const lastRun = typeof cronApi.formatLastRun === 'function' ? cronApi.formatLastRun(job) : '--';
                        const summary = String(
                            (typeof cronApi.getPayloadSummary === 'function' ? cronApi.getPayloadSummary(job) : '') ||
                            job?.description ||
                            ''
                        ).trim();
                        const badgeHtml = [
                            job?.enabled === false ? '<span class="badge badge-default">Disabled</span>' : '',
                            lastStatus && lastStatus !== '--'
                                ? `<span class="badge ${getAgentCronStatusBadgeClass(job, lastStatus)}">${escapeHtml(lastStatus)}</span>`
                                : ''
                        ].filter(Boolean).join('');

                        return `
                            <button class="agent-cron-row" type="button" onclick="window._memoryCards.openCronJob('${escapeInlineJsString(jobId)}')">
                                <div class="agent-cron-row-head">
                                    <span class="agent-cron-row-name">${escapeHtml(jobName)}</span>
                                    ${badgeHtml ? `<span class="agent-cron-row-badges">${badgeHtml}</span>` : ''}
                                </div>
                                ${summary ? `<div class="agent-cron-row-summary">${escapeHtml(summary)}</div>` : ''}
                                <div class="agent-cron-row-meta">
                                    <span>${escapeHtml(scheduleText)}</span>
                                    <span>Next ${escapeHtml(nextRun)}</span>
                                    <span>Last ${escapeHtml(lastRun)}</span>
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>
            `;
        } catch (e) {
            if (token !== agentCronRenderToken) return;
            el.innerHTML = `<div class="agent-cron-empty">Could not load cron jobs.</div>`;
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
                document.dispatchEvent(new CustomEvent('modelChanged', {
                    detail: { agentId, modelId, source: 'agents-dashboard' }
                }));
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
                document.dispatchEvent(new CustomEvent('modelChanged', {
                    detail: { agentId, modelId: 'global/default', source: 'agents-dashboard' }
                }));
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

    function openCronPage() {
        if (window._cronJobs && typeof window._cronJobs.openPage === 'function') {
            window._cronJobs.openPage();
            return;
        }
        if (typeof showPage === 'function') showPage('cron');
    }

    function openCronJob(jobId) {
        if (window._cronJobs && typeof window._cronJobs.openJob === 'function') {
            window._cronJobs.openJob(jobId);
            return;
        }
        openCronPage();
    }

    function openAgentMemoryFromUi(evt, agentId) {
        try {
            if (evt) {
                evt.preventDefault();
                evt.stopPropagation();
            }
        } catch (_) {}
        console.log('[Agents] openAgentMemoryFromUi click', agentId);
        return openAgentMemory(agentId, { updateURL: true, forceAgentsPage: true });
    }

    function formatMemorySize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let n = bytes;
        let i = 0;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i += 1;
        }
        return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function getAgentWorkspaceIds() {
        return {
            shell: $('agents-memory-shell'),
            list: $('agent-memory-file-list'),
            summary: $('agent-memory-file-summary'),
            selected: $('agent-memory-selected'),
            selectedMeta: $('agent-memory-selected-meta'),
            preview: $('agent-memory-preview-body'),
            actions: $('agent-memory-actions'),
            filter: $('agents-memory-filter'),
            subtitle: $('agents-memory-subtitle'),
        };
    }

    function renderAgentWorkspaceState(agent, files, query = '') {
        const ctx = getAgentWorkspaceIds();
        if (!ctx.shell || !ctx.list || !ctx.summary) return false;

        const normalized = [...files].map(f => ({
            ...f,
            modifiedTs: f.modified ? new Date(f.modified).getTime() : 0,
        })).sort((a, b) => (b.modifiedTs || 0) - (a.modifiedTs || 0));

        const q = String(query || '').trim().toLowerCase();
        const filtered = q
            ? normalized.filter(f => String(f.name || '').toLowerCase().includes(q))
            : normalized;

        agentMemoryFiles = normalized;
        ctx.summary.textContent = `${agent.id ? agent.id.toUpperCase() : 'AGENT'} • ${filtered.length} shown · ${normalized.length} total`;
        if (ctx.subtitle) ctx.subtitle.textContent = `${agent.isDefault ? 'Global' : 'Agent'} memory scope loaded`; 

        if (!normalized.length) {
            ctx.list.innerHTML = '<div class="agent-memory-empty">No memory files for this agent.</div>';
            return;
        }

        const coreFiles = [];
        const dailyFiles = [];
        const otherFiles = [];

        const normalize = (str) => String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const getBaseName = (name = '') => {
            const parts = String(name).split('/');
            return parts[parts.length - 1] || String(name);
        };
        const getStem = (name = '') => {
            const base = getBaseName(name);
            return base.replace(/\.[^.]+$/, '');
        };

        // STRICT core whitelist only (no partial matching)
        const coreStems = new Set([
            'AGENTS',
            'AGENTT',
            'HEARTBEAT',
            'MEMORY',
            'IDENTITY',
            'IDENITY',
            'USER',
            'SOUL',
            'TOOLS',
            'RUNNING_CONTEXT',
            'RUNNING CONTEXT',
            'RUNNINGCONTEXT'
        ].map(normalize));

        const isCore = (name) => coreStems.has(normalize(getStem(name)));

        // Daily memory: date-based memory files and explicit daily markers
        const isDaily = (name) => {
            const raw = String(name || '').toUpperCase();
            const stem = String(getStem(name || '')).toUpperCase();
            if (/^MEMORY\/(19|20)\d{2}-\d{2}-\d{2}\.MD$/.test(raw)) return true;
            if (/^(19|20)\d{2}-\d{2}-\d{2}$/.test(stem)) return true;
            if (stem.startsWith('DAILY') || stem.includes('DAILY_CONTEXT') || stem.includes('RUNNING_CONTEXT_DAILY')) return true;
            return false;
        };

        filtered.forEach((f) => {
            const name = f?.name || '';
            if (isCore(name)) coreFiles.push(f);
            else if (isDaily(name)) dailyFiles.push(f);
            else otherFiles.push(f);
        });

        const renderRows = (items) => items.map((f) => {
            const icon = f.name && f.name.endsWith('.md') ? '📝' : '📄';
            const date = f.modified ? timeAgo(f.modified) : '—';
            return `
                <button class="agent-memory-item" type="button" onclick="window._memoryCards.previewFile('${escapeHtml(f.name)}')">
                    <span class="agent-memory-row-icon">${icon}</span>
                    <span class="agent-memory-item-name">${escapeHtml(f.name)}</span>
                    <span class="agent-memory-item-meta">${date}</span>
                </button>
            `;
        }).join('');

        const coreCount = coreFiles.length;
        const otherCount = otherFiles.length;
        const dailyCount = dailyFiles.length;

        const coreSection = coreCount
            ? `<div class="agent-memory-section">
                <div class="agent-memory-section-title">CORE FILES <span>(${coreCount} file${coreCount === 1 ? '' : 's'})</span></div>
                <div class="agent-memory-section-list">${renderRows(coreFiles)}</div>
            </div>`
            : '';

        const dailyRows = renderRows(dailyFiles);
        const dailySection = dailyCount
            ? `<div class="agent-memory-section">
                <button class="agent-memory-section-toggle" type="button" onclick="window._memoryCards.toggleDailyFiles()">
                    <span>DAILY MEMORY (${dailyCount} file${dailyCount === 1 ? '' : 's'})</span>
                    <span class="agent-memory-section-toggle-icon">${showDailySectionExpanded ? '▾' : '▸'}</span>
                </button>
                <div class="agent-memory-section-list" style="display:${showDailySectionExpanded ? 'grid' : 'none'};">${dailyRows}</div>
            </div>`
            : '';

        const otherSection = otherCount
            ? `<div class="agent-memory-section">
                <div class="agent-memory-section-title">OTHER FILES <span>(${otherCount} file${otherCount === 1 ? '' : 's'})</span></div>
                <div class="agent-memory-section-list">${renderRows(otherFiles)}</div>
            </div>`
            : '';

        const renderedSections = `${coreSection}${dailySection}${otherSection}`;

        if (!renderedSections.trim()) {
            ctx.list.innerHTML = '<div class="agent-memory-empty">No memory files for this agent.</div>';
            return;
        }

        ctx.list.innerHTML = `<div class="agent-memory-sections">${renderedSections}</div>`;
    }


    function toggleDailyFiles() {
        showDailySectionExpanded = !showDailySectionExpanded;
        if (currentDrilledAgent) {
            const files = Array.isArray(currentDrilledAgent.files) ? [...currentDrilledAgent.files] : [];
            renderAgentWorkspaceState(currentDrilledAgent, files, agentMemorySearch);
        }
    }

    function renderWorkspacePreview(fileMeta) {
        const ctx = getAgentWorkspaceIds();
        if (!ctx.preview || !ctx.selected || !ctx.selectedMeta || !ctx.actions) return;
        const name = fileMeta?.name || 'Unknown';
        ctx.selected.textContent = name;
        ctx.selectedMeta.textContent = `${fileMeta.modified ? `Updated ${timeAgo(fileMeta.modified)}` : 'No update stamp'}${fileMeta.size ? ` • ${formatMemorySize(fileMeta.size)}` : ''}`;
        ctx.actions.innerHTML = `
            <button class="btn btn-ghost btn-xs" onclick="window._memoryCards.openAgentMemoryFromUi(event, '${escapeHtml(fileMeta.agentId || '')}')">Open workspace</button>
            <button class="btn btn-secondary btn-xs" onclick="window._memoryCards && (window._memoryCards.previewFileFromWorkspace ? window._memoryCards.previewFileFromWorkspace('${escapeHtml(name)}') : null)">↻ Reload</button>
            <button class="btn btn-primary btn-xs" onclick="${(fileMeta && fileMeta.agentIsDefault ? `viewMemoryFile('${escapeHtml(name)}')` : `viewAgentFile('${escapeHtml(fileMeta.apiAgentId || fileMeta.agentId || '')}', '${escapeHtml(name)}')`)}">✏️ Edit</button>
        `;
        ctx.preview.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Loading preview...</div>`;
    }

    function filterAgentMemoryFiles(query, forcedAgentId) {
        const token = ++agentMemoryRenderToken;
        const ctxAgentId = forcedAgentId || currentDrilledAgent?.id || currentDrilledAgent?.name;
        const agent = agentsData.find(a => String(a.id || '').toLowerCase() === String(ctxAgentId || '').toLowerCase()) || currentDrilledAgent;
        if (!agent) return;
        const files = Array.isArray(agent.files) ? [...agent.files] : [];
        const q = String(query || '').trim();
        if (agentMemoryRenderToken !== token) return;
        agentMemorySearch = q;
        renderAgentWorkspaceState(agent, files, q);
    }

    function openAgentMemory(agentId, opts = {}) {
        const updateURL = opts.updateURL !== false;
        const forceAgentsPage = opts.forceAgentsPage !== false;

        const orgId = String(agentId || '').toLowerCase();
        const canonicalId = ORG_TO_CANONICAL[orgId] || orgId;
        const found = agentsData.find(a => String(a.id || '').toLowerCase() === canonicalId);
        if (!found) {
            if (typeof renderMemoryFilesForPage === 'function') renderMemoryFilesForPage('');
            return;
        }
        currentDrilledAgent = { ...found, _orgId: orgId };
        showDailySectionExpanded = false;

        if (forceAgentsPage && typeof showPage === 'function') {
            showPage('agents', false);
        }

        const ctx = getAgentWorkspaceIds();
        const orgShell = $('agents-org-shell');
        const logShell = $('agents-log-shell');
        const journalShell = $('agents-journal-shell');
        if (ctx.shell) ctx.shell.style.display = '';
        if (orgShell) orgShell.style.display = 'none';
        if (logShell) logShell.style.display = 'none';
        if (journalShell) journalShell.style.display = 'none';

        const searchEl = $('memory-search');
        if (searchEl) searchEl.value = agentId;

        const workspaceFiles = Array.isArray(found.files) ? [...found.files] : [];
        renderAgentWorkspaceState(found, workspaceFiles, agentMemorySearch);
        if (workspaceFiles[0]) {
            const firstFile = workspaceFiles.sort((a, b) => {
                const am = a?.modified ? new Date(a.modified).getTime() : 0;
                const bm = b?.modified ? new Date(b.modified).getTime() : 0;
                return bm - am;
            })[0];
            previewFileFromWorkspace(firstFile.name);
        } else if (ctx.preview) {
            ctx.preview.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center;">No files available</div>';
            if (ctx.selected) ctx.selected.textContent = 'No file selected';
            if (ctx.selectedMeta) ctx.selectedMeta.textContent = '';
            if (ctx.actions) ctx.actions.innerHTML = '';
        }

        if (updateURL) {
            const nextPath = `/agents/${agentId}/memory`;
            if (window.location.pathname !== nextPath) {
                history.pushState({ page: 'agents', agentId, agentsView: 'memory' }, '', nextPath);
            }
        }
    }

    function previewFileFromWorkspace(filename) {
        const file = (agentMemoryFiles || []).find(f => String(f.name) === String(filename));
        if (!file) return;
        if (typeof previewFile === 'function') {
            return previewFile(file.name);
        }
    }

    async function previewFile(filename) {
        const agent = currentDrilledAgent;
        const mainPreview = $('agent-drill-preview');
        const workspacePreview = $('agent-memory-preview-body');

        if (!agent) return;

        const shell = getAgentWorkspaceIds();
        const target = workspacePreview || mainPreview;
        if (!target) return;

        target.innerHTML = '<div class=\"loading-state\">Loading...</div>';

        try {
            let content, filePath, apiAgentId = agent.id;
            if (agent.isDefault) {
                filePath = filename;
                const res = await fetch(`/api/memory/${encodeURIComponent(filename)}`);
                const data = await res.json();
                content = data.content || data.error || 'Empty file';
            } else {
                filePath = filename;
                const fetched = await fetchAgentFileWithFallback(agent.id, filename);
                const data = fetched.data || {};
                apiAgentId = fetched.apiAgentId || agent.id;
                content = data.content || data.error || 'Empty file';
            }

            const loadedMeta = (agentMemoryFiles || []).find(f => String(f.name) === String(filename)) || {};
            const fileTag = filename.endsWith('.md') ? '📝' : '📄';
            loadedMeta.agentId = agent.id;
            loadedMeta.apiAgentId = apiAgentId || agent.id;
            loadedMeta.agentIsDefault = !!agent.isDefault;

            renderWorkspacePreview(loadedMeta);
            target.innerHTML = `
                <div class=\"agent-preview-header\">
                    <span class=\"agent-preview-filename\">${fileTag} ${escapeHtml(filename)}</span>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-ghost btn-xs" onclick="${agent.isDefault ? `viewMemoryFile('${escapeHtml(filePath)}')` : `viewAgentFile('${escapeHtml(apiAgentId || agent.id)}', '${escapeHtml(filename)}')`}">✏️ Edit</button>
                        <button class="btn btn-secondary btn-xs" onclick="window._memoryCards && window._memoryCards.previewFileFromWorkspace('${escapeHtml(filename)}')">↻ Reload</button>
                    </div>
                </div>
                <div class="agent-preview-content"><pre>${escapeHtml(content)}</pre></div>
            `;
        } catch (e) {
            target.innerHTML = `<div class="empty-state">Error loading file: ${escapeHtml(e.message)}</div>`;
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

        // Session-switch-triggered metrics refresh
        installSessionSwitchMetricsHook();
        setTimeout(installSessionSwitchMetricsHook, 1500);
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
        openCronPage,
        openCronJob,
        openAgentMemory,
        openAgentMemoryFromUi,
        previewFileFromWorkspace,
        filterAgentMemoryFiles,
        toggleDailyFiles,
        customizeFallbacks,
        revertFallbacksToGlobal,
        addFallback,
        removeFallback,
        toggleMinimap: function () {
            const minimap = document.getElementById('org-minimap');
            if (minimap) {
                minimap.classList.toggle('collapsed');
                localStorage.setItem('solobot-minimap-collapsed', minimap.classList.contains('collapsed'));
                if (!minimap.classList.contains('collapsed')) {
                    updateMinimap();
                }
            }
        },
        getCurrentAgentId: function () {
            return currentDrilledAgent?.id || null;
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
