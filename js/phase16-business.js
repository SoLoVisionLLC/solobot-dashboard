/**
 * Phase 16: Business Features
 * 1. Invoice/receipt tracker widget
 * 2. Client project time tracker
 * 3. Revenue dashboard mini-widget
 * 4. Expense categorization
 * 5. Tax deadline reminders
 * 6. Contract/document links
 * 7. Meeting scheduler integration
 * 8. Weekly business summary email trigger
 */

(function() {
    'use strict';

    // ==========================================
    // Business State Management
    // ==========================================

    const BIZ_STORAGE_KEY = 'solobot-business';
    const BIZ_VERSION = 1;

    function getDefaultBusinessState() {
        return {
            version: BIZ_VERSION,
            invoices: [],
            timeEntries: [],
            activeTimer: null, // { id, project, client, startTime, paused, pausedElapsed }
            expenses: [],
            taxDeadlines: [],
            contracts: [],
            meetings: [],
            summaryEmail: null, // last sent timestamp
            settings: {
                currency: 'USD',
                currencySymbol: '$',
                hourlyRate: 150,
                taxRate: 0.25,
                emailRecipient: ''
            }
        };
    }

    let bizState = getDefaultBusinessState();

    function loadBizState() {
        try {
            const saved = localStorage.getItem(BIZ_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                bizState = { ...getDefaultBusinessState(), ...parsed };
            }
        } catch (e) {
            console.warn('[Phase 16] Failed to load business state:', e);
        }
    }

    function saveBizState() {
        try {
            localStorage.setItem(BIZ_STORAGE_KEY, JSON.stringify(bizState));
        } catch (e) {
            console.warn('[Phase 16] Failed to save business state:', e);
        }
    }

    // ==========================================
    // Utility Helpers
    // ==========================================

    const fmt = {
        currency(amount) {
            const sym = bizState.settings.currencySymbol || '$';
            return sym + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        date(ts) {
            if (!ts) return '';
            return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        },
        shortDate(ts) {
            if (!ts) return '';
            return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        },
        time(ts) {
            if (!ts) return '';
            return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        },
        duration(ms) {
            const totalSec = Math.floor(ms / 1000);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
            return `${m}m ${s.toString().padStart(2, '0')}s`;
        },
        durationHM(ms) {
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            return `${h}h ${m}m`;
        },
        daysUntil(ts) {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const target = new Date(ts);
            target.setHours(0, 0, 0, 0);
            return Math.ceil((target - now) / 86400000);
        },
        uid() {
            return 'biz_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
        }
    };

    // ==========================================
    // Demo Data Generator
    // ==========================================

    function generateDemoData() {
        const now = Date.now();
        const DAY = 86400000;

        bizState.invoices = [
            { id: fmt.uid(), number: 'INV-2026-001', client: 'Acme Corp', amount: 4500, status: 'paid', date: now - 30 * DAY, dueDate: now - 15 * DAY, paidDate: now - 18 * DAY, description: 'Web Development - January' },
            { id: fmt.uid(), number: 'INV-2026-002', client: 'TechStart Inc', amount: 2800, status: 'paid', date: now - 20 * DAY, dueDate: now - 5 * DAY, paidDate: now - 7 * DAY, description: 'API Integration' },
            { id: fmt.uid(), number: 'INV-2026-003', client: 'DesignLab', amount: 1200, status: 'pending', date: now - 10 * DAY, dueDate: now + 5 * DAY, description: 'UI/UX Consultation' },
            { id: fmt.uid(), number: 'INV-2026-004', client: 'Acme Corp', amount: 5200, status: 'sent', date: now - 3 * DAY, dueDate: now + 27 * DAY, description: 'Web Development - February' },
            { id: fmt.uid(), number: 'INV-2026-005', client: 'CloudNine', amount: 850, status: 'overdue', date: now - 45 * DAY, dueDate: now - 15 * DAY, description: 'Server Migration' },
        ];

        bizState.timeEntries = [
            { id: fmt.uid(), project: 'Dashboard Redesign', client: 'Acme Corp', duration: 7200000, date: now - 1 * DAY, notes: 'Header and nav components' },
            { id: fmt.uid(), project: 'API Integration', client: 'TechStart Inc', duration: 10800000, date: now - 1 * DAY, notes: 'REST endpoints' },
            { id: fmt.uid(), project: 'Dashboard Redesign', client: 'Acme Corp', duration: 5400000, date: now - 2 * DAY, notes: 'Bento grid layout' },
            { id: fmt.uid(), project: 'UI Consultation', client: 'DesignLab', duration: 3600000, date: now - 2 * DAY, notes: 'Design review session' },
            { id: fmt.uid(), project: 'Server Migration', client: 'CloudNine', duration: 14400000, date: now - 3 * DAY, notes: 'Docker setup and DNS' },
            { id: fmt.uid(), project: 'Dashboard Redesign', client: 'Acme Corp', duration: 6300000, date: now - 4 * DAY, notes: 'Widget system' },
            { id: fmt.uid(), project: 'Mobile App', client: 'TechStart Inc', duration: 9000000, date: now - 5 * DAY, notes: 'React Native scaffolding' },
        ];

        bizState.expenses = [
            { id: fmt.uid(), description: 'AWS Hosting', amount: 245.50, category: 'hosting', date: now - 5 * DAY, recurring: true },
            { id: fmt.uid(), description: 'Figma Pro', amount: 15, category: 'software', date: now - 10 * DAY, recurring: true },
            { id: fmt.uid(), description: 'GitHub Teams', amount: 44, category: 'software', date: now - 10 * DAY, recurring: true },
            { id: fmt.uid(), description: 'CoWorking Desk', amount: 350, category: 'office', date: now - 3 * DAY, recurring: true },
            { id: fmt.uid(), description: 'Client Lunch - Acme', amount: 78.40, category: 'meals', date: now - 7 * DAY },
            { id: fmt.uid(), description: 'Monitor Stand', amount: 129, category: 'equipment', date: now - 15 * DAY },
            { id: fmt.uid(), description: 'Domain Renewal', amount: 38, category: 'hosting', date: now - 20 * DAY },
            { id: fmt.uid(), description: 'Anthropic API', amount: 180, category: 'software', date: now - 2 * DAY, recurring: true },
        ];

        bizState.taxDeadlines = [
            { id: fmt.uid(), name: 'Quarterly Estimated Tax (Q1)', description: 'Federal estimated tax payment', date: new Date(2026, 3, 15).getTime(), type: 'federal' },
            { id: fmt.uid(), name: 'State Sales Tax', description: 'Monthly state sales tax filing', date: new Date(2026, 2, 20).getTime(), type: 'state' },
            { id: fmt.uid(), name: 'Annual LLC Filing', description: 'State annual report due', date: new Date(2026, 4, 1).getTime(), type: 'state' },
            { id: fmt.uid(), name: 'Quarterly Estimated Tax (Q2)', description: 'Federal estimated tax payment', date: new Date(2026, 5, 15).getTime(), type: 'federal' },
        ];

        bizState.contracts = [
            { id: fmt.uid(), name: 'Acme Corp - Web Dev MSA', type: 'msa', url: '#', startDate: now - 180 * DAY, endDate: now + 185 * DAY, client: 'Acme Corp', status: 'active' },
            { id: fmt.uid(), name: 'TechStart - API SOW', type: 'sow', url: '#', startDate: now - 30 * DAY, endDate: now + 60 * DAY, client: 'TechStart Inc', status: 'active' },
            { id: fmt.uid(), name: 'DesignLab - NDA', type: 'nda', url: '#', startDate: now - 90 * DAY, endDate: now + 275 * DAY, client: 'DesignLab', status: 'active' },
            { id: fmt.uid(), name: 'CloudNine - Service Agreement', type: 'sow', url: '#', startDate: now - 60 * DAY, endDate: now - 5 * DAY, client: 'CloudNine', status: 'expired' },
        ];

        bizState.meetings = [
            { id: fmt.uid(), title: 'Sprint Review', client: 'Acme Corp', date: now + 2 * 3600000, duration: 60, link: 'https://meet.google.com/abc', notes: 'Demo new dashboard' },
            { id: fmt.uid(), title: 'API Kickoff', client: 'TechStart Inc', date: now + 26 * 3600000, duration: 30, link: 'https://zoom.us/j/123', notes: 'Discuss endpoints' },
            { id: fmt.uid(), title: 'Design Review', client: 'DesignLab', date: now + 50 * 3600000, duration: 45, link: '', notes: 'Mockup review' },
            { id: fmt.uid(), title: 'Tax Consultation', client: 'CPA Office', date: now + 7 * DAY, duration: 60, link: '', notes: 'Q1 review' },
        ];

        saveBizState();
    }

    // ==========================================
    // 1. INVOICE/RECEIPT TRACKER
    // ==========================================

    function renderInvoices() {
        const container = document.getElementById('biz-invoices-content');
        if (!container) return;

        const invoices = bizState.invoices || [];

        // Summary stats
        const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
        const totalPending = invoices.filter(i => i.status === 'pending' || i.status === 'sent').reduce((s, i) => s + i.amount, 0);
        const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);

        let html = `
            <div class="invoice-summary-row">
                <div class="invoice-stat stat-income">
                    <div class="stat-value">${fmt.currency(totalPaid)}</div>
                    <div class="stat-label">Collected</div>
                </div>
                <div class="invoice-stat stat-pending">
                    <div class="stat-value">${fmt.currency(totalPending)}</div>
                    <div class="stat-label">Pending</div>
                </div>
                <div class="invoice-stat stat-overdue">
                    <div class="stat-value">${fmt.currency(totalOverdue)}</div>
                    <div class="stat-label">Overdue</div>
                </div>
            </div>
            <ul class="biz-list">`;

        if (invoices.length === 0) {
            html += `<div class="biz-empty"><div class="biz-empty-icon">🧾</div><div class="biz-empty-text">No invoices yet. Click + Add to create one.</div></div>`;
        } else {
            // Sort: overdue first, then pending, then sent, then paid
            const statusOrder = { overdue: 0, pending: 1, sent: 2, draft: 3, paid: 4 };
            const sorted = [...invoices].sort((a, b) => (statusOrder[a.status] || 5) - (statusOrder[b.status] || 5));

            sorted.forEach(inv => {
                html += `
                <li class="biz-list-item">
                    <div class="biz-icon">🧾</div>
                    <div class="biz-info">
                        <div class="biz-title">${inv.number} — ${esc(inv.client)}</div>
                        <div class="biz-subtitle">${esc(inv.description || '')} · Due ${fmt.shortDate(inv.dueDate)}</div>
                    </div>
                    <span class="biz-badge biz-badge-${inv.status}">${inv.status}</span>
                    <div class="biz-amount">${fmt.currency(inv.amount)}</div>
                    <div class="biz-actions">
                        ${inv.status !== 'paid' ? `<button class="biz-action-btn" onclick="BusinessFeatures.markInvoicePaid('${inv.id}')" title="Mark Paid">✓</button>` : ''}
                        <button class="biz-action-btn" onclick="BusinessFeatures.deleteInvoice('${inv.id}')" title="Delete">✕</button>
                    </div>
                </li>`;
            });
        }

        html += '</ul>';
        container.innerHTML = html;
    }

    // ==========================================
    // 2. CLIENT PROJECT TIME TRACKER
    // ==========================================

    let timerInterval = null;

    function renderTimeTracker() {
        const container = document.getElementById('biz-timetracker-content');
        if (!container) return;

        let html = '';

        // Active timer
        if (bizState.activeTimer) {
            const t = bizState.activeTimer;
            const elapsed = t.paused
                ? (t.pausedElapsed || 0)
                : (Date.now() - t.startTime + (t.pausedElapsed || 0));

            html += `
            <div class="time-tracker-active">
                <div>
                    <div class="timer-display" id="biz-timer-display">${fmt.duration(elapsed)}</div>
                </div>
                <div style="flex:1">
                    <div class="timer-project">${esc(t.project)}</div>
                    <div class="timer-client">${esc(t.client || 'No client')}</div>
                </div>
                ${t.paused
                    ? `<button class="timer-btn timer-btn-start" onclick="BusinessFeatures.resumeTimer()" title="Resume">▶</button>`
                    : `<button class="timer-btn timer-btn-pause" onclick="BusinessFeatures.pauseTimer()" title="Pause">⏸</button>`
                }
                <button class="timer-btn timer-btn-stop" onclick="BusinessFeatures.stopTimer()" title="Stop & Log">⏹</button>
            </div>`;

            // Start interval for live update
            startTimerInterval();
        } else {
            stopTimerInterval();

            // Quick start buttons
            const recentProjects = getRecentProjects();
            html += `<div style="display:flex;gap:6px;margin-bottom:var(--space-3);flex-wrap:wrap">`;
            if (recentProjects.length > 0) {
                recentProjects.slice(0, 3).forEach(p => {
                    html += `<button class="biz-action-btn" onclick="BusinessFeatures.quickStartTimer('${esc(p.project)}','${esc(p.client)}')" style="padding:4px 10px">▶ ${esc(p.project)}</button>`;
                });
            }
            html += `<button class="biz-action-btn" onclick="BusinessFeatures.showStartTimer()" style="padding:4px 10px;border-color:#22c55e;color:#22c55e">+ New Timer</button>`;
            html += `</div>`;
        }

        // Recent time logs
        const entries = (bizState.timeEntries || []).slice().sort((a, b) => b.date - a.date).slice(0, 8);
        if (entries.length > 0) {
            html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;font-weight:600">RECENT ENTRIES</div>`;
            entries.forEach(e => {
                html += `
                <div class="time-log-entry">
                    <span class="log-duration">${fmt.durationHM(e.duration)}</span>
                    <span class="log-project">${esc(e.project)}</span>
                    <span style="color:var(--text-muted);font-size:11px">${esc(e.client || '')}</span>
                    <span class="log-date">${fmt.shortDate(e.date)}</span>
                    <button class="biz-action-btn" onclick="BusinessFeatures.deleteTimeEntry('${e.id}')" title="Delete" style="opacity:0.5">✕</button>
                </div>`;
            });
        } else {
            html += `<div class="biz-empty"><div class="biz-empty-icon">⏱️</div><div class="biz-empty-text">No time entries yet. Start a timer!</div></div>`;
        }

        container.innerHTML = html;
    }

    function getRecentProjects() {
        const seen = new Map();
        (bizState.timeEntries || []).slice().sort((a, b) => b.date - a.date).forEach(e => {
            if (!seen.has(e.project)) {
                seen.set(e.project, { project: e.project, client: e.client || '' });
            }
        });
        return Array.from(seen.values());
    }

    function startTimerInterval() {
        if (timerInterval) return;
        timerInterval = setInterval(() => {
            const display = document.getElementById('biz-timer-display');
            if (!display || !bizState.activeTimer || bizState.activeTimer.paused) {
                stopTimerInterval();
                return;
            }
            const elapsed = Date.now() - bizState.activeTimer.startTime + (bizState.activeTimer.pausedElapsed || 0);
            display.textContent = fmt.duration(elapsed);
        }, 1000);
    }

    function stopTimerInterval() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    // ==========================================
    // 3. REVENUE DASHBOARD
    // ==========================================

    function renderRevenue() {
        const container = document.getElementById('biz-revenue-content');
        if (!container) return;

        const periodEl = document.getElementById('biz-revenue-period');
        const period = periodEl ? periodEl.value : 'month';

        const now = Date.now();
        const DAY = 86400000;
        let periodStart, periodLabel, prevStart, prevEnd;

        switch (period) {
            case 'week':
                periodStart = now - 7 * DAY;
                prevStart = now - 14 * DAY;
                prevEnd = now - 7 * DAY;
                periodLabel = 'This Week';
                break;
            case 'quarter':
                periodStart = now - 90 * DAY;
                prevStart = now - 180 * DAY;
                prevEnd = now - 90 * DAY;
                periodLabel = 'This Quarter';
                break;
            case 'year':
                periodStart = now - 365 * DAY;
                prevStart = now - 730 * DAY;
                prevEnd = now - 365 * DAY;
                periodLabel = 'This Year';
                break;
            default: // month
                periodStart = now - 30 * DAY;
                prevStart = now - 60 * DAY;
                prevEnd = now - 30 * DAY;
                periodLabel = 'This Month';
        }

        // Revenue from paid invoices
        const currentRev = (bizState.invoices || [])
            .filter(i => i.status === 'paid' && i.paidDate >= periodStart)
            .reduce((s, i) => s + i.amount, 0);

        const prevRev = (bizState.invoices || [])
            .filter(i => i.status === 'paid' && i.paidDate >= prevStart && i.paidDate < prevEnd)
            .reduce((s, i) => s + i.amount, 0);

        // Expenses in period
        const currentExp = (bizState.expenses || [])
            .filter(e => e.date >= periodStart)
            .reduce((s, e) => s + e.amount, 0);

        const profit = currentRev - currentExp;
        const change = prevRev > 0 ? ((currentRev - prevRev) / prevRev * 100) : 0;

        // Mini bar chart - last 7 data points
        const chartData = generateRevenueChart(period);

        let html = `
        <div class="revenue-chart-container">
            ${renderRevenueBarChart(chartData)}
        </div>
        <div class="revenue-stats-row">
            <div class="revenue-stat">
                <div class="rev-value" style="color:#22c55e">${fmt.currency(currentRev)}</div>
                <div class="rev-label">Revenue</div>
                <div class="rev-change ${change >= 0 ? 'positive' : 'negative'}">${change >= 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}%</div>
            </div>
            <div class="revenue-stat">
                <div class="rev-value" style="color:#ef4444">${fmt.currency(currentExp)}</div>
                <div class="rev-label">Expenses</div>
            </div>
            <div class="revenue-stat">
                <div class="rev-value" style="color:${profit >= 0 ? '#6366f1' : '#ef4444'}">${fmt.currency(profit)}</div>
                <div class="rev-label">Net Profit</div>
            </div>
        </div>`;

        container.innerHTML = html;
    }

    function generateRevenueChart(period) {
        const now = Date.now();
        const DAY = 86400000;
        const points = [];
        const count = period === 'year' ? 12 : period === 'quarter' ? 12 : 7;
        const span = period === 'year' ? 30 * DAY : period === 'quarter' ? 7 * DAY : DAY;

        for (let i = count - 1; i >= 0; i--) {
            const start = now - (i + 1) * span;
            const end = now - i * span;
            const rev = (bizState.invoices || [])
                .filter(inv => inv.status === 'paid' && inv.paidDate >= start && inv.paidDate < end)
                .reduce((s, inv) => s + inv.amount, 0);
            const exp = (bizState.expenses || [])
                .filter(e => e.date >= start && e.date < end)
                .reduce((s, e) => s + e.amount, 0);

            const d = new Date(end);
            const label = period === 'year'
                ? d.toLocaleDateString('en-US', { month: 'short' })
                : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            points.push({ label, revenue: rev, expenses: exp });
        }
        return points;
    }

    function renderRevenueBarChart(data) {
        if (!data || data.length === 0) return '';

        const w = 320, h = 110;
        const padding = { top: 5, right: 5, bottom: 20, left: 5 };
        const cw = w - padding.left - padding.right;
        const ch = h - padding.top - padding.bottom;
        const barWidth = Math.floor(cw / data.length * 0.6);
        const gap = Math.floor(cw / data.length * 0.4);
        const maxVal = Math.max(...data.map(d => Math.max(d.revenue, d.expenses)), 100);

        let bars = '';
        data.forEach((d, i) => {
            const x = padding.left + i * (barWidth + gap) + gap / 2;
            const revH = (d.revenue / maxVal) * ch;
            const expH = (d.expenses / maxVal) * ch;

            bars += `<rect x="${x}" y="${padding.top + ch - revH}" width="${barWidth / 2 - 1}" height="${revH}" fill="#22c55e" rx="2" opacity="0.8"/>`;
            bars += `<rect x="${x + barWidth / 2}" y="${padding.top + ch - expH}" width="${barWidth / 2 - 1}" height="${expH}" fill="#ef4444" rx="2" opacity="0.6"/>`;
            bars += `<text x="${x + barWidth / 2}" y="${h - 3}" text-anchor="middle" fill="var(--text-secondary)" font-size="8">${d.label}</text>`;
        });

        return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:100%">
            <line x1="${padding.left}" y1="${padding.top + ch}" x2="${w - padding.right}" y2="${padding.top + ch}" stroke="var(--border)" stroke-width="0.5"/>
            ${bars}
        </svg>`;
    }

    // ==========================================
    // 4. EXPENSE CATEGORIZATION
    // ==========================================

    const EXPENSE_CATEGORIES = {
        software: { label: 'Software & SaaS', color: '#6366f1', icon: '💻' },
        hosting: { label: 'Hosting & Cloud', color: '#22c55e', icon: '☁️' },
        office: { label: 'Office & CoWork', color: '#f59e0b', icon: '🏢' },
        meals: { label: 'Meals & Entertainment', color: '#ec4899', icon: '🍽️' },
        equipment: { label: 'Equipment', color: '#14b8a6', icon: '🖥️' },
        travel: { label: 'Travel', color: '#8b5cf6', icon: '✈️' },
        marketing: { label: 'Marketing', color: '#f97316', icon: '📣' },
        other: { label: 'Other', color: '#94a3b8', icon: '📦' }
    };

    function renderExpenses() {
        const container = document.getElementById('biz-expenses-content');
        if (!container) return;

        const expenses = bizState.expenses || [];

        if (expenses.length === 0) {
            container.innerHTML = `<div class="biz-empty"><div class="biz-empty-icon">💰</div><div class="biz-empty-text">No expenses tracked yet. Click + Add.</div></div>`;
            return;
        }

        // Group by category
        const byCategory = {};
        let total = 0;
        expenses.forEach(e => {
            const cat = e.category || 'other';
            if (!byCategory[cat]) byCategory[cat] = 0;
            byCategory[cat] += e.amount;
            total += e.amount;
        });

        // Donut chart
        const donutHtml = renderExpenseDonut(byCategory, total);

        // Legend
        let legendHtml = '';
        Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .forEach(([cat, amount]) => {
                const info = EXPENSE_CATEGORIES[cat] || EXPENSE_CATEGORIES.other;
                const pct = total > 0 ? (amount / total * 100).toFixed(0) : 0;
                legendHtml += `
                <div class="expense-legend-item">
                    <span class="expense-legend-dot" style="background:${info.color}"></span>
                    <span class="expense-legend-label">${info.label}</span>
                    <span class="expense-legend-value">${fmt.currency(amount)} (${pct}%)</span>
                </div>`;
            });

        // Recent expenses list
        let listHtml = '';
        const sorted = [...expenses].sort((a, b) => b.date - a.date).slice(0, 6);
        sorted.forEach(e => {
            const cat = EXPENSE_CATEGORIES[e.category] || EXPENSE_CATEGORIES.other;
            listHtml += `
            <li class="biz-list-item">
                <div class="biz-icon">${cat.icon}</div>
                <div class="biz-info">
                    <div class="biz-title">${esc(e.description)}</div>
                    <div class="biz-subtitle">${cat.label} · ${fmt.shortDate(e.date)}${e.recurring ? ' · 🔁' : ''}</div>
                </div>
                <div class="biz-amount" style="color:#ef4444">-${fmt.currency(e.amount)}</div>
                <div class="biz-actions">
                    <button class="biz-action-btn" onclick="BusinessFeatures.deleteExpense('${e.id}')" title="Delete">✕</button>
                </div>
            </li>`;
        });

        container.innerHTML = `
            <div class="expense-donut-container">
                ${donutHtml}
                <div class="expense-legend">${legendHtml}</div>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;font-weight:600">RECENT EXPENSES (Total: ${fmt.currency(total)})</div>
            <ul class="biz-list">${listHtml}</ul>`;
    }

    function renderExpenseDonut(byCategory, total) {
        const size = 100;
        const cx = size / 2, cy = size / 2, r = 36, strokeWidth = 14;
        const circumference = 2 * Math.PI * r;
        let offset = 0;
        let arcs = '';

        const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

        entries.forEach(([cat, amount]) => {
            const info = EXPENSE_CATEGORIES[cat] || EXPENSE_CATEGORIES.other;
            const pct = total > 0 ? amount / total : 0;
            const dashLen = circumference * pct;
            const dashGap = circumference - dashLen;

            arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${info.color}" 
                stroke-width="${strokeWidth}" stroke-dasharray="${dashLen} ${dashGap}" 
                stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" opacity="0.85"/>`;
            offset += dashLen;
        });

        return `<svg viewBox="0 0 ${size} ${size}" style="width:100px;height:100px">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeWidth}" opacity="0.2"/>
            ${arcs}
            <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--text-primary)" font-size="11" font-weight="700">${fmt.currency(total).replace(bizState.settings.currencySymbol, '')}</text>
            <text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="var(--text-secondary)" font-size="7">TOTAL</text>
        </svg>`;
    }

    // ==========================================
    // 5. TAX DEADLINE REMINDERS
    // ==========================================

    function renderTaxDeadlines() {
        const container = document.getElementById('biz-tax-content');
        if (!container) return;

        const deadlines = (bizState.taxDeadlines || []).slice().sort((a, b) => a.date - b.date);

        if (deadlines.length === 0) {
            container.innerHTML = `<div class="biz-empty"><div class="biz-empty-icon">🏛️</div><div class="biz-empty-text">No tax deadlines set. Click + Add.</div></div>`;
            return;
        }

        let html = '';
        deadlines.forEach(d => {
            const daysLeft = fmt.daysUntil(d.date);
            let urgency = 'normal';
            if (daysLeft < 0) urgency = 'urgent';
            else if (daysLeft <= 14) urgency = 'urgent';
            else if (daysLeft <= 30) urgency = 'soon';

            const dateObj = new Date(d.date);
            const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' });
            const dayStr = dateObj.getDate();

            const countdownText = daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` :
                daysLeft === 0 ? 'Today!' :
                daysLeft === 1 ? 'Tomorrow' :
                `${daysLeft}d left`;

            html += `
            <div class="tax-deadline-card ${urgency}">
                <div class="tax-deadline-date">
                    <div class="tax-month">${monthStr}</div>
                    <div class="tax-day">${dayStr}</div>
                </div>
                <div class="tax-deadline-info">
                    <div class="tax-name">${esc(d.name)}</div>
                    <div class="tax-desc">${esc(d.description || '')}</div>
                </div>
                <span class="tax-countdown ${urgency}">${countdownText}</span>
                <div class="biz-actions">
                    <button class="biz-action-btn" onclick="BusinessFeatures.deleteTaxDeadline('${d.id}')" title="Delete">✕</button>
                </div>
            </div>`;
        });

        container.innerHTML = html;
    }

    // ==========================================
    // 6. CONTRACT/DOCUMENT LINKS
    // ==========================================

    function renderContracts() {
        const container = document.getElementById('biz-contracts-content');
        if (!container) return;

        const contracts = bizState.contracts || [];

        if (contracts.length === 0) {
            container.innerHTML = `<div class="biz-empty"><div class="biz-empty-icon">📄</div><div class="biz-empty-text">No contracts yet. Click + Add.</div></div>`;
            return;
        }

        const typeIcons = { msa: '📋', sow: '📝', nda: '🔒', contract: '📄', other: '📁' };

        let html = '<div style="display:flex;flex-direction:column;gap:var(--space-2)">';
        const sorted = [...contracts].sort((a, b) => {
            // Active first, then by endDate
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (b.status === 'active' && a.status !== 'active') return 1;
            return (b.endDate || 0) - (a.endDate || 0);
        });

        sorted.forEach(c => {
            const icon = typeIcons[c.type] || typeIcons.other;
            const daysLeft = c.endDate ? fmt.daysUntil(c.endDate) : null;
            const statusText = c.status === 'expired' ? 'Expired'
                : daysLeft !== null && daysLeft <= 30 ? `${daysLeft}d left`
                : c.status === 'active' ? 'Active' : c.status;

            const statusColor = c.status === 'expired' ? '#94a3b8'
                : daysLeft !== null && daysLeft <= 30 ? '#f59e0b'
                : '#22c55e';

            html += `
            <div class="contract-card" onclick="${c.url && c.url !== '#' ? `window.open('${c.url}','_blank')` : ''}">
                <div class="contract-icon">${icon}</div>
                <div class="contract-info">
                    <div class="contract-name">${esc(c.name)}</div>
                    <div class="contract-meta">
                        <span>${esc(c.client || '')}</span>
                        <span>${c.type ? c.type.toUpperCase() : ''}</span>
                        <span style="color:${statusColor};font-weight:600">${statusText}</span>
                    </div>
                </div>
                <div class="biz-actions" style="opacity:1">
                    <button class="biz-action-btn" onclick="event.stopPropagation();BusinessFeatures.deleteContract('${c.id}')" title="Delete">✕</button>
                </div>
            </div>`;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // ==========================================
    // 7. MEETING SCHEDULER
    // ==========================================

    function renderMeetings() {
        const container = document.getElementById('biz-meetings-content');
        if (!container) return;

        const meetings = (bizState.meetings || []).slice().sort((a, b) => a.date - b.date);
        const now = Date.now();

        // Filter to upcoming + today
        const upcoming = meetings.filter(m => m.date + (m.duration || 30) * 60000 >= now);

        if (upcoming.length === 0) {
            container.innerHTML = `<div class="biz-empty"><div class="biz-empty-icon">📅</div><div class="biz-empty-text">No upcoming meetings. Click + New.</div></div>`;
            return;
        }

        let html = '';
        upcoming.forEach(m => {
            const d = new Date(m.date);
            const isToday = new Date().toDateString() === d.toDateString();
            const isTomorrow = new Date(now + 86400000).toDateString() === d.toDateString();
            const cls = isToday ? 'meeting-today' : isTomorrow ? 'meeting-tomorrow' : '';

            const hours = d.getHours();
            const mins = d.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const hourDisplay = hours % 12 || 12;
            const timeStr = `${hourDisplay}:${mins.toString().padStart(2, '0')}`;

            const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fmt.shortDate(m.date);

            html += `
            <div class="meeting-card ${cls}">
                <div class="meeting-time">
                    <div class="meeting-hour">${timeStr}</div>
                    <div class="meeting-ampm">${ampm}</div>
                </div>
                <div class="meeting-details">
                    <div class="meeting-title">${esc(m.title)}</div>
                    <div class="meeting-with">${esc(m.client || '')} · ${dayLabel} · ${m.duration || 30}min</div>
                    ${m.link ? `<a class="meeting-link" href="${esc(m.link)}" target="_blank" onclick="event.stopPropagation()">🔗 Join meeting</a>` : ''}
                </div>
                <div class="biz-actions">
                    <button class="biz-action-btn" onclick="BusinessFeatures.deleteMeeting('${m.id}')" title="Delete">✕</button>
                </div>
            </div>`;
        });

        container.innerHTML = html;
    }

    // ==========================================
    // 8. WEEKLY BUSINESS SUMMARY
    // ==========================================

    function renderWeeklySummary() {
        const container = document.getElementById('biz-summary-content');
        if (!container) return;

        const summary = calculateWeeklySummary();

        let html = `
        <div class="summary-preview">
            <div class="summary-row">
                <span class="summary-label">📈 Revenue (7d)</span>
                <span class="summary-value" style="color:#22c55e">${fmt.currency(summary.revenue)}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">💰 Expenses (7d)</span>
                <span class="summary-value" style="color:#ef4444">${fmt.currency(summary.expenses)}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">💵 Net Profit</span>
                <span class="summary-value" style="color:${summary.profit >= 0 ? '#6366f1' : '#ef4444'}">${fmt.currency(summary.profit)}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">⏱️ Hours Tracked</span>
                <span class="summary-value">${summary.hoursTracked.toFixed(1)}h</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">🧾 Invoices Sent</span>
                <span class="summary-value">${summary.invoicesSent}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">🤝 Meetings</span>
                <span class="summary-value">${summary.meetingsCount}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">📄 Active Contracts</span>
                <span class="summary-value">${summary.activeContracts}</span>
            </div>
            <div class="summary-row">
                <span class="summary-label">🏛️ Next Tax Deadline</span>
                <span class="summary-value">${summary.nextTaxDeadline || 'None'}</span>
            </div>
        </div>

        <div style="display:flex;gap:var(--space-2);flex-direction:column">
            <button class="summary-send-btn" onclick="BusinessFeatures.triggerWeeklyEmail()">
                📧 Generate Summary Email
            </button>
            ${bizState.summaryEmail ? `<div style="font-size:11px;color:var(--text-secondary);text-align:center">Last sent: ${fmt.date(bizState.summaryEmail)}</div>` : ''}
        </div>`;

        container.innerHTML = html;
    }

    function calculateWeeklySummary() {
        const now = Date.now();
        const weekAgo = now - 7 * 86400000;

        const revenue = (bizState.invoices || [])
            .filter(i => i.status === 'paid' && i.paidDate >= weekAgo)
            .reduce((s, i) => s + i.amount, 0);

        const expenses = (bizState.expenses || [])
            .filter(e => e.date >= weekAgo)
            .reduce((s, e) => s + e.amount, 0);

        const hoursTracked = (bizState.timeEntries || [])
            .filter(e => e.date >= weekAgo)
            .reduce((s, e) => s + (e.duration || 0), 0) / 3600000;

        const invoicesSent = (bizState.invoices || [])
            .filter(i => i.date >= weekAgo && (i.status === 'sent' || i.status === 'pending'))
            .length;

        const meetingsCount = (bizState.meetings || [])
            .filter(m => m.date >= weekAgo && m.date <= now)
            .length;

        const activeContracts = (bizState.contracts || [])
            .filter(c => c.status === 'active').length;

        const nextDeadline = (bizState.taxDeadlines || [])
            .filter(d => d.date >= now)
            .sort((a, b) => a.date - b.date)[0];

        return {
            revenue,
            expenses,
            profit: revenue - expenses,
            hoursTracked,
            invoicesSent,
            meetingsCount,
            activeContracts,
            nextTaxDeadline: nextDeadline ? `${nextDeadline.name} (${fmt.shortDate(nextDeadline.date)})` : null
        };
    }

    // ==========================================
    // MODAL / FORM HELPERS
    // ==========================================

    function showBizModal(title, formHtml, onSave) {
        // Reuse existing modal or create one
        let overlay = document.getElementById('biz-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'biz-modal-overlay';
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal" style="max-width:440px;width:90%">
                    <div class="modal-header">
                        <h3 id="biz-modal-title"></h3>
                        <button class="modal-close" onclick="BusinessFeatures.closeBizModal()">✕</button>
                    </div>
                    <div class="modal-body" id="biz-modal-body"></div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => {
                if (e.target === overlay) BusinessFeatures.closeBizModal();
            });
        }

        document.getElementById('biz-modal-title').textContent = title;
        document.getElementById('biz-modal-body').innerHTML = formHtml;
        overlay.classList.add('visible');
        overlay._onSave = onSave;

        // Focus first input
        setTimeout(() => {
            const firstInput = overlay.querySelector('input,select,textarea');
            if (firstInput) firstInput.focus();
        }, 100);
    }

    function closeBizModal() {
        const overlay = document.getElementById('biz-modal-overlay');
        if (overlay) overlay.classList.remove('visible');
    }

    function esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==========================================
    // PUBLIC API — BusinessFeatures
    // ==========================================

    const BusinessFeatures = {
        init() {
            loadBizState();

            // If no data, generate demo
            if (!bizState.invoices || bizState.invoices.length === 0) {
                generateDemoData();
            }

            this.renderAll();
            console.log('[Phase 16] Business features initialized');
        },

        renderAll() {
            renderInvoices();
            renderTimeTracker();
            renderRevenue();
            renderExpenses();
            renderTaxDeadlines();
            renderContracts();
            renderMeetings();
            renderWeeklySummary();
        },

        renderRevenue,

        // === Invoice Actions ===
        showAddInvoice() {
            const html = `
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Invoice #</label>
                        <input type="text" id="biz-inv-number" placeholder="INV-2026-006" value="INV-2026-${String((bizState.invoices || []).length + 1).padStart(3, '0')}">
                    </div>
                    <div class="biz-form-group">
                        <label>Amount</label>
                        <input type="number" id="biz-inv-amount" placeholder="0.00" step="0.01">
                    </div>
                </div>
                <div class="biz-form-group">
                    <label>Client</label>
                    <input type="text" id="biz-inv-client" placeholder="Client name">
                </div>
                <div class="biz-form-group">
                    <label>Description</label>
                    <input type="text" id="biz-inv-desc" placeholder="Service description">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Due Date</label>
                        <input type="date" id="biz-inv-due">
                    </div>
                    <div class="biz-form-group">
                        <label>Status</label>
                        <select id="biz-inv-status">
                            <option value="draft">Draft</option>
                            <option value="sent">Sent</option>
                            <option value="pending" selected>Pending</option>
                        </select>
                    </div>
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:var(--brand-red);color:white" onclick="BusinessFeatures.saveInvoice()">Save Invoice</button>
                </div>`;
            showBizModal('Add Invoice', html);
        },

        saveInvoice() {
            const number = document.getElementById('biz-inv-number')?.value?.trim();
            const amount = parseFloat(document.getElementById('biz-inv-amount')?.value) || 0;
            const client = document.getElementById('biz-inv-client')?.value?.trim();
            const desc = document.getElementById('biz-inv-desc')?.value?.trim();
            const dueStr = document.getElementById('biz-inv-due')?.value;
            const status = document.getElementById('biz-inv-status')?.value || 'pending';

            if (!client || !amount) {
                if (typeof showToast === 'function') showToast('Client and amount are required', 'error');
                return;
            }

            const due = dueStr ? new Date(dueStr + 'T00:00:00').getTime() : Date.now() + 30 * 86400000;

            bizState.invoices.push({
                id: fmt.uid(),
                number: number || `INV-${Date.now()}`,
                client,
                amount,
                status,
                date: Date.now(),
                dueDate: due,
                description: desc
            });

            saveBizState();
            closeBizModal();
            this.renderAll();
            if (typeof showToast === 'function') showToast('Invoice added!', 'success');
        },

        markInvoicePaid(id) {
            const inv = (bizState.invoices || []).find(i => i.id === id);
            if (inv) {
                inv.status = 'paid';
                inv.paidDate = Date.now();
                saveBizState();
                this.renderAll();
                if (typeof showToast === 'function') showToast('Invoice marked as paid!', 'success');
            }
        },

        deleteInvoice(id) {
            bizState.invoices = (bizState.invoices || []).filter(i => i.id !== id);
            saveBizState();
            this.renderAll();
        },

        // === Time Tracker Actions ===
        showStartTimer() {
            const html = `
                <div class="biz-form-group">
                    <label>Project</label>
                    <input type="text" id="biz-timer-project" placeholder="Project name">
                </div>
                <div class="biz-form-group">
                    <label>Client</label>
                    <input type="text" id="biz-timer-client" placeholder="Client name (optional)">
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:#22c55e;color:white" onclick="BusinessFeatures.startTimer()">▶ Start Timer</button>
                </div>`;
            showBizModal('Start Timer', html);
        },

        startTimer() {
            const project = document.getElementById('biz-timer-project')?.value?.trim();
            const client = document.getElementById('biz-timer-client')?.value?.trim();

            if (!project) {
                if (typeof showToast === 'function') showToast('Project name is required', 'error');
                return;
            }

            bizState.activeTimer = {
                id: fmt.uid(),
                project,
                client: client || '',
                startTime: Date.now(),
                paused: false,
                pausedElapsed: 0
            };

            saveBizState();
            closeBizModal();
            renderTimeTracker();
            if (typeof showToast === 'function') showToast('Timer started!', 'success');
        },

        quickStartTimer(project, client) {
            bizState.activeTimer = {
                id: fmt.uid(),
                project,
                client: client || '',
                startTime: Date.now(),
                paused: false,
                pausedElapsed: 0
            };
            saveBizState();
            renderTimeTracker();
            if (typeof showToast === 'function') showToast(`Timer started: ${project}`, 'success');
        },

        pauseTimer() {
            if (!bizState.activeTimer) return;
            bizState.activeTimer.pausedElapsed = (bizState.activeTimer.pausedElapsed || 0) + (Date.now() - bizState.activeTimer.startTime);
            bizState.activeTimer.paused = true;
            saveBizState();
            stopTimerInterval();
            renderTimeTracker();
        },

        resumeTimer() {
            if (!bizState.activeTimer) return;
            bizState.activeTimer.startTime = Date.now();
            bizState.activeTimer.paused = false;
            saveBizState();
            renderTimeTracker();
        },

        stopTimer() {
            if (!bizState.activeTimer) return;
            const t = bizState.activeTimer;
            const elapsed = t.paused
                ? (t.pausedElapsed || 0)
                : (Date.now() - t.startTime + (t.pausedElapsed || 0));

            if (elapsed > 60000) { // Only log if > 1 minute
                bizState.timeEntries.push({
                    id: fmt.uid(),
                    project: t.project,
                    client: t.client,
                    duration: elapsed,
                    date: Date.now(),
                    notes: ''
                });
            }

            bizState.activeTimer = null;
            stopTimerInterval();
            saveBizState();
            this.renderAll();
            if (typeof showToast === 'function') showToast(`Logged ${fmt.durationHM(elapsed)}`, 'success');
        },

        showAddTimeEntry() {
            const html = `
                <div class="biz-form-group">
                    <label>Project</label>
                    <input type="text" id="biz-te-project" placeholder="Project name">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Client</label>
                        <input type="text" id="biz-te-client" placeholder="Client">
                    </div>
                    <div class="biz-form-group">
                        <label>Hours</label>
                        <input type="number" id="biz-te-hours" placeholder="0" step="0.25" min="0">
                    </div>
                </div>
                <div class="biz-form-group">
                    <label>Notes</label>
                    <input type="text" id="biz-te-notes" placeholder="What did you work on?">
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:#6366f1;color:white" onclick="BusinessFeatures.saveTimeEntry()">Save Entry</button>
                </div>`;
            showBizModal('Log Time Entry', html);
        },

        saveTimeEntry() {
            const project = document.getElementById('biz-te-project')?.value?.trim();
            const client = document.getElementById('biz-te-client')?.value?.trim();
            const hours = parseFloat(document.getElementById('biz-te-hours')?.value) || 0;
            const notes = document.getElementById('biz-te-notes')?.value?.trim();

            if (!project || !hours) {
                if (typeof showToast === 'function') showToast('Project and hours required', 'error');
                return;
            }

            bizState.timeEntries.push({
                id: fmt.uid(),
                project,
                client: client || '',
                duration: hours * 3600000,
                date: Date.now(),
                notes: notes || ''
            });

            saveBizState();
            closeBizModal();
            this.renderAll();
            if (typeof showToast === 'function') showToast('Time entry logged!', 'success');
        },

        deleteTimeEntry(id) {
            bizState.timeEntries = (bizState.timeEntries || []).filter(e => e.id !== id);
            saveBizState();
            renderTimeTracker();
        },

        // === Expense Actions ===
        showAddExpense() {
            const catOptions = Object.entries(EXPENSE_CATEGORIES)
                .map(([key, val]) => `<option value="${key}">${val.icon} ${val.label}</option>`).join('');

            const html = `
                <div class="biz-form-group">
                    <label>Description</label>
                    <input type="text" id="biz-exp-desc" placeholder="What was the expense?">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Amount</label>
                        <input type="number" id="biz-exp-amount" placeholder="0.00" step="0.01">
                    </div>
                    <div class="biz-form-group">
                        <label>Category</label>
                        <select id="biz-exp-category">${catOptions}</select>
                    </div>
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Date</label>
                        <input type="date" id="biz-exp-date" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div class="biz-form-group" style="display:flex;align-items:flex-end;gap:var(--space-2)">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                            <input type="checkbox" id="biz-exp-recurring"> Recurring
                        </label>
                    </div>
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:#ef4444;color:white" onclick="BusinessFeatures.saveExpense()">Add Expense</button>
                </div>`;
            showBizModal('Add Expense', html);
        },

        saveExpense() {
            const desc = document.getElementById('biz-exp-desc')?.value?.trim();
            const amount = parseFloat(document.getElementById('biz-exp-amount')?.value) || 0;
            const category = document.getElementById('biz-exp-category')?.value || 'other';
            const dateStr = document.getElementById('biz-exp-date')?.value;
            const recurring = document.getElementById('biz-exp-recurring')?.checked || false;

            if (!desc || !amount) {
                if (typeof showToast === 'function') showToast('Description and amount required', 'error');
                return;
            }

            bizState.expenses.push({
                id: fmt.uid(),
                description: desc,
                amount,
                category,
                date: dateStr ? new Date(dateStr + 'T00:00:00').getTime() : Date.now(),
                recurring
            });

            saveBizState();
            closeBizModal();
            this.renderAll();
            if (typeof showToast === 'function') showToast('Expense added!', 'success');
        },

        deleteExpense(id) {
            bizState.expenses = (bizState.expenses || []).filter(e => e.id !== id);
            saveBizState();
            this.renderAll();
        },

        // === Tax Deadline Actions ===
        showAddTaxDeadline() {
            const html = `
                <div class="biz-form-group">
                    <label>Deadline Name</label>
                    <input type="text" id="biz-tax-name" placeholder="e.g. Quarterly Estimated Tax">
                </div>
                <div class="biz-form-group">
                    <label>Description</label>
                    <input type="text" id="biz-tax-desc" placeholder="Details (optional)">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Due Date</label>
                        <input type="date" id="biz-tax-date">
                    </div>
                    <div class="biz-form-group">
                        <label>Type</label>
                        <select id="biz-tax-type">
                            <option value="federal">Federal</option>
                            <option value="state">State</option>
                            <option value="local">Local</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:#6366f1;color:white" onclick="BusinessFeatures.saveTaxDeadline()">Add Deadline</button>
                </div>`;
            showBizModal('Add Tax Deadline', html);
        },

        saveTaxDeadline() {
            const name = document.getElementById('biz-tax-name')?.value?.trim();
            const desc = document.getElementById('biz-tax-desc')?.value?.trim();
            const dateStr = document.getElementById('biz-tax-date')?.value;
            const type = document.getElementById('biz-tax-type')?.value || 'federal';

            if (!name || !dateStr) {
                if (typeof showToast === 'function') showToast('Name and date required', 'error');
                return;
            }

            bizState.taxDeadlines.push({
                id: fmt.uid(),
                name,
                description: desc || '',
                date: new Date(dateStr + 'T00:00:00').getTime(),
                type
            });

            saveBizState();
            closeBizModal();
            renderTaxDeadlines();
            if (typeof showToast === 'function') showToast('Tax deadline added!', 'success');
        },

        deleteTaxDeadline(id) {
            bizState.taxDeadlines = (bizState.taxDeadlines || []).filter(d => d.id !== id);
            saveBizState();
            renderTaxDeadlines();
        },

        // === Contract Actions ===
        showAddContract() {
            const html = `
                <div class="biz-form-group">
                    <label>Contract Name</label>
                    <input type="text" id="biz-con-name" placeholder="e.g. Acme Corp - MSA">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Client</label>
                        <input type="text" id="biz-con-client" placeholder="Client name">
                    </div>
                    <div class="biz-form-group">
                        <label>Type</label>
                        <select id="biz-con-type">
                            <option value="msa">MSA</option>
                            <option value="sow">SOW</option>
                            <option value="nda">NDA</option>
                            <option value="contract">Contract</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                </div>
                <div class="biz-form-group">
                    <label>Document URL</label>
                    <input type="url" id="biz-con-url" placeholder="https://...">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Start Date</label>
                        <input type="date" id="biz-con-start" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                    <div class="biz-form-group">
                        <label>End Date</label>
                        <input type="date" id="biz-con-end">
                    </div>
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:var(--brand-red);color:white" onclick="BusinessFeatures.saveContract()">Add Contract</button>
                </div>`;
            showBizModal('Add Contract/Document', html);
        },

        saveContract() {
            const name = document.getElementById('biz-con-name')?.value?.trim();
            const client = document.getElementById('biz-con-client')?.value?.trim();
            const type = document.getElementById('biz-con-type')?.value || 'contract';
            const url = document.getElementById('biz-con-url')?.value?.trim();
            const startStr = document.getElementById('biz-con-start')?.value;
            const endStr = document.getElementById('biz-con-end')?.value;

            if (!name) {
                if (typeof showToast === 'function') showToast('Contract name is required', 'error');
                return;
            }

            bizState.contracts.push({
                id: fmt.uid(),
                name,
                client: client || '',
                type,
                url: url || '#',
                startDate: startStr ? new Date(startStr + 'T00:00:00').getTime() : Date.now(),
                endDate: endStr ? new Date(endStr + 'T00:00:00').getTime() : null,
                status: 'active'
            });

            saveBizState();
            closeBizModal();
            renderContracts();
            if (typeof showToast === 'function') showToast('Contract added!', 'success');
        },

        deleteContract(id) {
            bizState.contracts = (bizState.contracts || []).filter(c => c.id !== id);
            saveBizState();
            renderContracts();
        },

        // === Meeting Actions ===
        showAddMeeting() {
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = `${String(now.getHours() + 1).padStart(2, '0')}:00`;

            const html = `
                <div class="biz-form-group">
                    <label>Meeting Title</label>
                    <input type="text" id="biz-mtg-title" placeholder="e.g. Sprint Review">
                </div>
                <div class="biz-form-group">
                    <label>With (Client/Person)</label>
                    <input type="text" id="biz-mtg-client" placeholder="Client or person name">
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Date</label>
                        <input type="date" id="biz-mtg-date" value="${dateStr}">
                    </div>
                    <div class="biz-form-group">
                        <label>Time</label>
                        <input type="time" id="biz-mtg-time" value="${timeStr}">
                    </div>
                </div>
                <div class="biz-form-row">
                    <div class="biz-form-group">
                        <label>Duration (min)</label>
                        <input type="number" id="biz-mtg-duration" value="30" min="5" step="5">
                    </div>
                    <div class="biz-form-group">
                        <label>Meeting Link</label>
                        <input type="url" id="biz-mtg-link" placeholder="https://meet.google.com/...">
                    </div>
                </div>
                <div class="biz-form-group">
                    <label>Notes</label>
                    <input type="text" id="biz-mtg-notes" placeholder="Agenda or notes">
                </div>
                <div class="biz-form-actions">
                    <button class="btn btn-ghost" onclick="BusinessFeatures.closeBizModal()">Cancel</button>
                    <button class="btn" style="background:#6366f1;color:white" onclick="BusinessFeatures.saveMeeting()">Schedule Meeting</button>
                </div>`;
            showBizModal('Schedule Meeting', html);
        },

        saveMeeting() {
            const title = document.getElementById('biz-mtg-title')?.value?.trim();
            const client = document.getElementById('biz-mtg-client')?.value?.trim();
            const dateStr = document.getElementById('biz-mtg-date')?.value;
            const timeStr = document.getElementById('biz-mtg-time')?.value;
            const duration = parseInt(document.getElementById('biz-mtg-duration')?.value) || 30;
            const link = document.getElementById('biz-mtg-link')?.value?.trim();
            const notes = document.getElementById('biz-mtg-notes')?.value?.trim();

            if (!title || !dateStr || !timeStr) {
                if (typeof showToast === 'function') showToast('Title, date, and time required', 'error');
                return;
            }

            const dateTime = new Date(`${dateStr}T${timeStr}`).getTime();

            bizState.meetings.push({
                id: fmt.uid(),
                title,
                client: client || '',
                date: dateTime,
                duration,
                link: link || '',
                notes: notes || ''
            });

            saveBizState();
            closeBizModal();
            renderMeetings();
            if (typeof showToast === 'function') showToast('Meeting scheduled!', 'success');
        },

        deleteMeeting(id) {
            bizState.meetings = (bizState.meetings || []).filter(m => m.id !== id);
            saveBizState();
            renderMeetings();
        },

        // === Weekly Summary Email ===
        triggerWeeklyEmail() {
            const summary = calculateWeeklySummary();
            const subject = `Weekly Business Summary — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

            const body = `Weekly Business Summary
========================

Revenue (7d): ${fmt.currency(summary.revenue)}
Expenses (7d): ${fmt.currency(summary.expenses)}
Net Profit: ${fmt.currency(summary.profit)}
Hours Tracked: ${summary.hoursTracked.toFixed(1)}h
Invoices Sent: ${summary.invoicesSent}
Meetings: ${summary.meetingsCount}
Active Contracts: ${summary.activeContracts}
Next Tax Deadline: ${summary.nextTaxDeadline || 'None'}

---
Generated by SoLoVision Command Center`;

            // Copy to clipboard as a fallback
            if (navigator.clipboard) {
                navigator.clipboard.writeText(body).then(() => {
                    if (typeof showToast === 'function') showToast('Summary copied to clipboard! 📋', 'success');
                }).catch(() => {});
            }

            // Open mailto link
            const recipient = bizState.settings.emailRecipient || '';
            const mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.open(mailto, '_blank');

            bizState.summaryEmail = Date.now();
            saveBizState();
            renderWeeklySummary();
        },

        generateSummary() {
            renderWeeklySummary();
            if (typeof showToast === 'function') showToast('Summary refreshed!', 'success');
        },

        // === Utilities ===
        closeBizModal: closeBizModal,

        exportData() {
            const dataStr = JSON.stringify(bizState, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `solobot-business-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            if (typeof showToast === 'function') showToast('Business data exported!', 'success');
        },

        resetDemo() {
            if (!confirm('Reset all business data to demo values?')) return;
            bizState = getDefaultBusinessState();
            generateDemoData();
            this.renderAll();
            if (typeof showToast === 'function') showToast('Demo data restored!', 'success');
        }
    };

    // Expose globally
    window.BusinessFeatures = BusinessFeatures;

    // ==========================================
    // Auto-init when page is shown
    // ==========================================

    let initialized = false;

    function tryInit() {
        if (initialized) return;
        if (document.getElementById('biz-invoices-content')) {
            initialized = true;
            BusinessFeatures.init();
        }
    }

    // Init on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        // If business page is already visible
        tryInit();

        // Also re-render when navigating to business page
        const origShowPage = window.showPage;
        if (origShowPage) {
            window.showPage = function(pageName, ...args) {
                const result = origShowPage.call(this, pageName, ...args);
                if (pageName === 'business') {
                    tryInit();
                    if (initialized) BusinessFeatures.renderAll();
                }
                return result;
            };
        }
    });

    // Fallback: try init after a short delay
    setTimeout(tryInit, 1000);

})();
