// js/perf-guard.js — Performance optimizations
// Gates expensive intervals by active page + tab visibility
// Also wraps native setInterval to enforce visibility checks globally

(function() {
    'use strict';

    let currentPage = 'dashboard';

    // Hook into showPage to track active page
    const _waitForShowPage = setInterval(() => {
        if (typeof window.showPage !== 'function') return;
        clearInterval(_waitForShowPage);

        const origShowPage = window.showPage;
        window.showPage = function(pageName, updateURL) {
            currentPage = pageName || 'dashboard';
            console.log('[PerfGuard] Page switched to:', currentPage);
            return origShowPage.apply(this, arguments);
        };

        // Set initial page from URL
        const path = window.location.pathname.replace(/^\//, '') || 'dashboard';
        currentPage = path;
    }, 50);

    window._activePage = () => currentPage;

    // Guard: wraps a function to skip execution when page/tab isn't relevant
    function guardFn(origFn, pages) {
        return function() {
            if (document.hidden) return;
            if (pages && pages.length && !pages.includes(currentPage)) return;
            return origFn.apply(this, arguments);
        };
    }

    // Patch a global function when it becomes available
    function patchWhenReady(fnName, pages, maxWait) {
        maxWait = maxWait || 8000;
        const start = Date.now();
        const check = setInterval(() => {
            if (Date.now() - start > maxWait) { clearInterval(check); return; }
            if (typeof window[fnName] === 'function' && !window[fnName]._perfGuarded) {
                clearInterval(check);
                const orig = window[fnName];
                window[fnName] = guardFn(orig, pages);
                window[fnName]._perfGuarded = true;
            }
        }, 150);
    }

    // === Gate heavy pollers by page ===

    // 10s intervals
    patchWhenReady('_doHistoryRefresh',     ['chat', 'dashboard']);

    // 15s intervals
    patchWhenReady('loadAgentStatuses',     ['dashboard']);
    patchWhenReady('renderSubagentMonitor', ['dashboard']);

    // 30s intervals
    patchWhenReady('loadChannelStatuses',   ['dashboard']);
    patchWhenReady('loadCronJobs',          ['cron']);
    patchWhenReady('loadSecurityData',      ['security']);
    patchWhenReady('renderActivityHeatmap', ['dashboard']);
    patchWhenReady('syncActivitiesFromFile',['dashboard']);

    // 60s intervals
    patchWhenReady('loadAnalyticsData',     ['dashboard']);
    patchWhenReady('loadCostData',          ['dashboard']);
    patchWhenReady('updateQuickStats',      ['dashboard']);
    patchWhenReady('loadSkills',            ['skills']);

    // === Gate class-based intervals by patching instances ===

    // Phase 7 Activity Viz — 10s timeline updates, only on dashboard
    function patchActivityViz() {
        const maxWait = 10000, start = Date.now();
        const check = setInterval(() => {
            if (Date.now() - start > maxWait) { clearInterval(check); return; }
            if (window.activityVisualization && window.activityVisualization.updateInterval !== undefined) {
                clearInterval(check);
                const viz = window.activityVisualization;
                if (viz.updateInterval) clearInterval(viz.updateInterval);
                viz.updateInterval = setInterval(() => {
                    if (document.hidden || currentPage !== 'dashboard') return;
                    viz.renderTimeline();
                    viz.updateMessageSparkline();
                    viz.updateAgentPresence();
                }, 10000);
                console.log('[PerfGuard] Patched activityVisualization interval');
            }
        }, 200);
    }
    patchActivityViz();

    // Phase 4 Context — activity monitor + detectCurrentAgent already slowed to 30s
    // Gate detectCurrentAgent to only run on dashboard
    function patchContextEngine() {
        const maxWait = 10000, start = Date.now();
        const check = setInterval(() => {
            if (Date.now() - start > maxWait) { clearInterval(check); return; }
            if (window.contextEngine && typeof window.contextEngine.detectCurrentAgent === 'function'
                && !window.contextEngine._perfGuarded) {
                clearInterval(check);
                const orig = window.contextEngine.detectCurrentAgent.bind(window.contextEngine);
                window.contextEngine.detectCurrentAgent = function() {
                    if (document.hidden) return;
                    return orig();
                };
                window.contextEngine._perfGuarded = true;
                console.log('[PerfGuard] Patched contextEngine.detectCurrentAgent');
            }
        }, 200);
    }
    patchContextEngine();

    // === Global: pause ALL intervals when tab is hidden ===
    // Instead of wrapping setInterval globally (risky), we pause/resume
    // by tracking interval IDs and using a visibility toggle
    const _trackedIntervals = new Map(); // id -> { fn, ms, paused }
    const _origSetInterval = window.setInterval;
    const _origClearInterval = window.clearInterval;

    // Wrap setInterval to track intervals > 3s (skip short timers like animations)
    window.setInterval = function(fn, ms, ...args) {
        const id = _origSetInterval.call(window, fn, ms, ...args);
        if (ms >= 3000) {
            _trackedIntervals.set(id, { fn, ms, args });
        }
        return id;
    };

    window.clearInterval = function(id) {
        _trackedIntervals.delete(id);
        return _origClearInterval.call(window, id);
    };

    // When tab becomes hidden, clear all tracked intervals
    // When visible again, restart them
    let _pausedIntervals = [];
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Pause all tracked intervals
            _pausedIntervals = [];
            for (const [id, info] of _trackedIntervals) {
                _pausedIntervals.push({ ...info, oldId: id });
                _origClearInterval.call(window, id);
            }
            _trackedIntervals.clear();
            console.log(`[PerfGuard] Tab hidden — paused ${_pausedIntervals.length} intervals`);
        } else {
            // Resume paused intervals
            for (const info of _pausedIntervals) {
                const newId = _origSetInterval.call(window, info.fn, info.ms, ...info.args);
                _trackedIntervals.set(newId, { fn: info.fn, ms: info.ms, args: info.args });
            }
            console.log(`[PerfGuard] Tab visible — resumed ${_pausedIntervals.length} intervals`);
            _pausedIntervals = [];
        }
    });

    console.log('[PerfGuard] Interval gating initialized (v2 — with global pause)');
})();
