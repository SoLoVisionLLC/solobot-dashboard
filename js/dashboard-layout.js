// js/dashboard-layout.js — Dashboard calm mode and collapsible sections

(function() {
    'use strict';

    const STORAGE_KEY = 'solobot-dashboard-sections-v1';
    const DEFAULT_STATE = {
        operations: false,
        insights: false
    };

    const state = loadState();

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            return { ...DEFAULT_STATE, ...(saved || {}) };
        } catch {
            return { ...DEFAULT_STATE };
        }
    }

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {}
    }

    function apply() {
        const shell = document.querySelector('#page-dashboard .dashboard-shell');
        if (!shell) return;

        ['operations', 'insights'].forEach((name) => {
            const section = shell.querySelector(`.dashboard-collapsible-section[data-section="${name}"]`);
            const open = !!state[name];
            shell.classList.toggle(`section-${name}-collapsed`, !open);
            if (section) {
                section.classList.toggle('is-open', open);
                const toggle = section.querySelector('.dashboard-section-toggle');
                if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            }
        });
    }

    function toggleSection(name) {
        if (!(name in state)) return;
        state[name] = !state[name];
        persist();
        apply();
    }

    function focusTaskboard() {
        const taskboard = document.querySelector('.bento-task-board');
        if (!taskboard) return;
        if (window.WidgetSystem && typeof window.WidgetSystem.toggleFocusMode === 'function') {
            if (!document.body.classList.contains('focus-mode') || !taskboard.classList.contains('widget-focused')) {
                window.WidgetSystem.toggleFocusMode(taskboard);
            }
        }
        taskboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    document.addEventListener('DOMContentLoaded', () => {
        apply();
    });

    window.DashboardLayout = {
        toggleSection,
        focusTaskboard,
        apply,
        state
    };
})();
