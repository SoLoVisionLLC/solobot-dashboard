// js/phase16-business.js — Phase 16: Business Features
// Invoice tracker, time tracker, revenue widget, expenses, tax deadlines,
// contract links, meeting scheduler, weekly summary

(function () {
    'use strict';

    // ==========================================
    // Storage & State
    // ==========================================

    const STORAGE_KEY = 'solobot-business';

    function loadBusiness() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : getDefaults();
        } catch (e) {
            console.warn('[Phase16] Failed to load business data:', e);
            return getDefaults();
        }
    }

    function saveBusiness(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('[Phase16] Failed to save business data:', e);
        }
        // Also mirror to global state if available
        if (typeof state !== 'undefined') {
            state.business = data;
        }
    }

    function getDefaults() {
        return {
            invoices: [],
            timeEntries: [],     // { id, project, start, end, seconds }
            activeTimers: {},    // { project: startTimestamp }
            expenses: [],
            taxDeadlines: [],
            contracts: [],
            meetings: []
        };
    }

    let biz = loadBusiness();

    // Unique ID helper
    function uid() {
        return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // Format currency
    function fmt$(n) {
        return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Format date for display
    function fmtDate(d) {
        if (!d) return '—';
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Format hours:minutes
    function fmtTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h + 'h ' + m + 'm';
    }

    // ==========================================
    // 1. Invoice / Receipt Tracker
    // ==========================================

    function renderInvoices() {
        const el = document.getElementById('business-invoices');
        if (!el) return;

        // Update overdue statuses
        const now = new Date();
        biz.invoices.forEach(inv => {
            if (inv.status === 'pending' && inv.dueDate && new Date(inv.dueDate) < now) {
                inv.status = 'overdue';
            }
        });

        const sorted = [...biz.invoices].sort((a, b) => new Date(b.date) - new Date(a.date));

        const statusBadge = (s) => {
            const cls = s === 'paid' ? 'biz-badge-success' : s === 'overdue' ? 'biz-badge-danger' : 'biz-badge-warning';
            return '<span class="biz-badge ' + cls + '">' + s + '</span>';
        };

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">📄 Invoices</h4>';
        html += '<button class="biz-btn biz-btn-sm" onclick="Phase16.addInvoice()">+ Add</button>';
        html += '</div>';

        if (sorted.length === 0) {
            html += '<div class="biz-empty">No invoices yet</div>';
        } else {
            html += '<div class="biz-table-wrap"><table class="biz-table">';
            html += '<thead><tr><th>Client</th><th>Amount</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>';
            sorted.forEach(inv => {
                html += '<tr>';
                html += '<td>' + esc(inv.client) + '</td>';
                html += '<td class="biz-mono">' + fmt$(inv.amount) + '</td>';
                html += '<td>' + fmtDate(inv.date) + '</td>';
                html += '<td>' + statusBadge(inv.status) + '</td>';
                html += '<td class="biz-actions">';
                if (inv.status !== 'paid') {
                    html += '<button class="biz-btn-icon" title="Mark Paid" onclick="Phase16.markPaid(\'' + inv.id + '\')">✅</button>';
                }
                html += '<button class="biz-btn-icon" title="Delete" onclick="Phase16.deleteInvoice(\'' + inv.id + '\')">🗑️</button>';
                html += '</td></tr>';
            });
            html += '</tbody></table></div>';
        }

        // Summary row
        const totalPaid = biz.invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
        const totalPending = biz.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + Number(i.amount), 0);
        html += '<div class="biz-summary-row">';
        html += '<span>Paid: <strong class="biz-text-success">' + fmt$(totalPaid) + '</strong></span>';
        html += '<span>Outstanding: <strong class="biz-text-warning">' + fmt$(totalPending) + '</strong></span>';
        html += '</div>';

        el.innerHTML = html;
    }

    function addInvoice() {
        const client = prompt('Client name:');
        if (!client) return;
        const amount = parseFloat(prompt('Amount ($):'));
        if (isNaN(amount)) return;
        const date = prompt('Date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
        if (!date) return;
        const dueDate = prompt('Due date (YYYY-MM-DD, leave blank for none):', '');

        biz.invoices.push({
            id: uid(),
            client: client.trim(),
            amount,
            date,
            dueDate: dueDate || null,
            status: 'pending'
        });
        saveBusiness(biz);
        renderAll();
    }

    function markPaid(id) {
        const inv = biz.invoices.find(i => i.id === id);
        if (inv) {
            inv.status = 'paid';
            inv.paidDate = new Date().toISOString().slice(0, 10);
            saveBusiness(biz);
            renderAll();
        }
    }

    function deleteInvoice(id) {
        biz.invoices = biz.invoices.filter(i => i.id !== id);
        saveBusiness(biz);
        renderAll();
    }

    // ==========================================
    // 2. Client Project Time Tracker
    // ==========================================

    // Tick active timers every second
    let timerInterval = null;

    function renderTimeTracker() {
        const el = document.getElementById('business-time-tracker');
        if (!el) return;

        // Collect unique projects
        const projects = new Set();
        biz.timeEntries.forEach(e => projects.add(e.project));
        Object.keys(biz.activeTimers).forEach(p => projects.add(p));

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">⏱️ Time Tracker</h4>';
        html += '<button class="biz-btn biz-btn-sm" onclick="Phase16.startTimer()">+ New Timer</button>';
        html += '</div>';

        if (projects.size === 0) {
            html += '<div class="biz-empty">No projects tracked yet</div>';
        } else {
            html += '<div class="biz-timer-list">';
            [...projects].sort().forEach(project => {
                const isActive = !!biz.activeTimers[project];
                const loggedSecs = biz.timeEntries
                    .filter(e => e.project === project)
                    .reduce((s, e) => s + (e.seconds || 0), 0);
                const liveSecs = isActive ? Math.floor((Date.now() - biz.activeTimers[project]) / 1000) : 0;
                const totalSecs = loggedSecs + liveSecs;

                html += '<div class="biz-timer-item' + (isActive ? ' biz-timer-active' : '') + '">';
                html += '<div class="biz-timer-info">';
                html += '<span class="biz-timer-project">' + esc(project) + '</span>';
                html += '<span class="biz-timer-total">' + fmtTime(totalSecs) + '</span>';
                html += '</div>';
                html += '<div class="biz-timer-controls">';
                if (isActive) {
                    html += '<button class="biz-btn biz-btn-sm biz-btn-danger" onclick="Phase16.stopTimer(\'' + esc(project) + '\')">⏹ Stop</button>';
                } else {
                    html += '<button class="biz-btn biz-btn-sm biz-btn-success" onclick="Phase16.resumeTimer(\'' + esc(project) + '\')">▶ Start</button>';
                }
                html += '<button class="biz-btn-icon" title="Delete project" onclick="Phase16.deleteProject(\'' + esc(project) + '\')">🗑️</button>';
                html += '</div></div>';
            });
            html += '</div>';
        }

        el.innerHTML = html;
    }

    function startTimer() {
        const project = prompt('Project / client name:');
        if (!project) return;
        biz.activeTimers[project.trim()] = Date.now();
        saveBusiness(biz);
        ensureTimerInterval();
        renderAll();
    }

    function resumeTimer(project) {
        biz.activeTimers[project] = Date.now();
        saveBusiness(biz);
        ensureTimerInterval();
        renderAll();
    }

    function stopTimer(project) {
        const start = biz.activeTimers[project];
        if (start) {
            const seconds = Math.floor((Date.now() - start) / 1000);
            biz.timeEntries.push({
                id: uid(),
                project,
                start,
                end: Date.now(),
                seconds
            });
            delete biz.activeTimers[project];
            saveBusiness(biz);
            renderAll();
        }
    }

    function deleteProject(project) {
        biz.timeEntries = biz.timeEntries.filter(e => e.project !== project);
        delete biz.activeTimers[project];
        saveBusiness(biz);
        renderAll();
    }

    function ensureTimerInterval() {
        if (timerInterval) return;
        timerInterval = setInterval(() => {
            if (Object.keys(biz.activeTimers).length > 0) {
                renderTimeTracker();
            } else {
                clearInterval(timerInterval);
                timerInterval = null;
            }
        }, 1000);
    }

    // ==========================================
    // 3. Revenue Dashboard Mini-Widget
    // ==========================================

    function renderRevenue() {
        const el = document.getElementById('business-revenue');
        if (!el) return;

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">📊 Revenue</h4>';
        html += '</div>';

        // Group paid invoices by month
        const monthly = {};
        biz.invoices.filter(i => i.status === 'paid').forEach(inv => {
            const d = new Date(inv.paidDate || inv.date);
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            monthly[key] = (monthly[key] || 0) + Number(inv.amount);
        });

        const months = Object.keys(monthly).sort().slice(-6);
        if (months.length === 0) {
            html += '<div class="biz-empty">No paid invoices to chart</div>';
            el.innerHTML = html;
            return;
        }

        const maxVal = Math.max(...months.map(m => monthly[m]), 1);

        html += '<div class="biz-chart">';
        months.forEach(m => {
            const pct = Math.max((monthly[m] / maxVal) * 100, 4);
            const label = new Date(m + '-01').toLocaleDateString('en-US', { month: 'short' });
            html += '<div class="biz-chart-col">';
            html += '<div class="biz-chart-bar" style="height:' + pct + '%;" title="' + fmt$(monthly[m]) + '"></div>';
            html += '<span class="biz-chart-label">' + label + '</span>';
            html += '<span class="biz-chart-value">' + fmt$(monthly[m]) + '</span>';
            html += '</div>';
        });
        html += '</div>';

        // Totals
        const totalRev = months.reduce((s, m) => s + monthly[m], 0);
        html += '<div class="biz-summary-row"><span>Total (shown): <strong>' + fmt$(totalRev) + '</strong></span></div>';

        el.innerHTML = html;
    }

    // ==========================================
    // 4. Expense Categorization
    // ==========================================

    function renderExpenses() {
        const el = document.getElementById('business-expenses');
        if (!el) return;

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">💸 Expenses</h4>';
        html += '<button class="biz-btn biz-btn-sm" onclick="Phase16.addExpense()">+ Add</button>';
        html += '</div>';

        // Category totals
        const catTotals = {};
        biz.expenses.forEach(exp => {
            const cat = exp.category || 'Uncategorized';
            catTotals[cat] = (catTotals[cat] || 0) + Number(exp.amount);
        });

        const cats = Object.keys(catTotals).sort();
        const totalExp = biz.expenses.reduce((s, e) => s + Number(e.amount), 0);

        if (cats.length > 0) {
            html += '<div class="biz-cat-list">';
            cats.forEach(cat => {
                const pct = totalExp > 0 ? ((catTotals[cat] / totalExp) * 100).toFixed(0) : 0;
                html += '<div class="biz-cat-row">';
                html += '<span class="biz-cat-name">' + esc(cat) + '</span>';
                html += '<div class="biz-cat-bar-track"><div class="biz-cat-bar-fill" style="width:' + pct + '%;"></div></div>';
                html += '<span class="biz-mono">' + fmt$(catTotals[cat]) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        // Recent expenses
        const recent = [...biz.expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        if (recent.length > 0) {
            html += '<div class="biz-recent-label">Recent</div>';
            html += '<div class="biz-expense-list">';
            recent.forEach(exp => {
                html += '<div class="biz-expense-item">';
                html += '<span>' + esc(exp.description) + ' <small class="biz-text-muted">' + esc(exp.category) + '</small></span>';
                html += '<span class="biz-mono">' + fmt$(exp.amount) + '</span>';
                html += '<button class="biz-btn-icon" onclick="Phase16.deleteExpense(\'' + exp.id + '\')">🗑️</button>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<div class="biz-empty">No expenses recorded</div>';
        }

        html += '<div class="biz-summary-row"><span>Total: <strong class="biz-text-danger">' + fmt$(totalExp) + '</strong></span></div>';
        el.innerHTML = html;
    }

    function addExpense() {
        const description = prompt('Expense description:');
        if (!description) return;
        const amount = parseFloat(prompt('Amount ($):'));
        if (isNaN(amount)) return;
        const category = prompt('Category (e.g. Software, Hardware, Marketing, Travel):', 'General');
        if (!category) return;

        biz.expenses.push({
            id: uid(),
            description: description.trim(),
            amount,
            category: category.trim(),
            date: new Date().toISOString().slice(0, 10)
        });
        saveBusiness(biz);
        renderAll();
    }

    function deleteExpense(id) {
        biz.expenses = biz.expenses.filter(e => e.id !== id);
        saveBusiness(biz);
        renderAll();
    }

    // ==========================================
    // 5. Tax Deadline Reminders
    // ==========================================

    function renderTaxDeadlines() {
        const el = document.getElementById('business-tax');
        if (!el) return;

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">🗓️ Tax Deadlines</h4>';
        html += '<button class="biz-btn biz-btn-sm" onclick="Phase16.addTaxDeadline()">+ Add</button>';
        html += '</div>';

        if (biz.taxDeadlines.length === 0) {
            html += '<div class="biz-empty">No deadlines set</div>';
            el.innerHTML = html;
            return;
        }

        const now = Date.now();
        const sorted = [...biz.taxDeadlines].sort((a, b) => new Date(a.date) - new Date(b.date));

        html += '<div class="biz-deadline-list">';
        sorted.forEach(td => {
            const target = new Date(td.date).getTime();
            const daysLeft = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
            let urgency = 'biz-deadline-ok';
            if (daysLeft < 0) urgency = 'biz-deadline-overdue';
            else if (daysLeft <= 7) urgency = 'biz-deadline-urgent';
            else if (daysLeft <= 30) urgency = 'biz-deadline-soon';

            let countdownText;
            if (daysLeft < 0) countdownText = Math.abs(daysLeft) + 'd overdue!';
            else if (daysLeft === 0) countdownText = 'TODAY!';
            else countdownText = daysLeft + 'd left';

            html += '<div class="biz-deadline-item ' + urgency + '">';
            html += '<div class="biz-deadline-info">';
            html += '<span class="biz-deadline-name">' + esc(td.name) + '</span>';
            html += '<span class="biz-deadline-date">' + fmtDate(td.date) + '</span>';
            html += '</div>';
            html += '<span class="biz-deadline-countdown">' + countdownText + '</span>';
            html += '<button class="biz-btn-icon" onclick="Phase16.deleteTaxDeadline(\'' + td.id + '\')">🗑️</button>';
            html += '</div>';
        });
        html += '</div>';

        el.innerHTML = html;
    }

    function addTaxDeadline() {
        const name = prompt('Deadline name (e.g. Q1 Estimated Tax):');
        if (!name) return;
        const date = prompt('Date (YYYY-MM-DD):');
        if (!date) return;

        biz.taxDeadlines.push({ id: uid(), name: name.trim(), date });
        saveBusiness(biz);
        renderAll();
    }

    function deleteTaxDeadline(id) {
        biz.taxDeadlines = biz.taxDeadlines.filter(t => t.id !== id);
        saveBusiness(biz);
        renderAll();
    }

    // ==========================================
    // 6. Contract / Document Links
    // ==========================================

    function renderContracts() {
        const el = document.getElementById('business-contracts');
        if (!el) return;

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">📎 Contracts & Docs</h4>';
        html += '<button class="biz-btn biz-btn-sm" onclick="Phase16.addContract()">+ Add</button>';
        html += '</div>';

        if (biz.contracts.length === 0) {
            html += '<div class="biz-empty">No documents linked</div>';
            el.innerHTML = html;
            return;
        }

        html += '<div class="biz-contract-list">';
        biz.contracts.forEach(c => {
            html += '<div class="biz-contract-item">';
            html += '<a href="' + esc(c.url) + '" target="_blank" rel="noopener" class="biz-contract-link">';
            html += '📄 ' + esc(c.name);
            html += '</a>';
            html += '<button class="biz-btn-icon" onclick="Phase16.deleteContract(\'' + c.id + '\')">🗑️</button>';
            html += '</div>';
        });
        html += '</div>';

        el.innerHTML = html;
    }

    function addContract() {
        const name = prompt('Document name:');
        if (!name) return;
        const url = prompt('URL:');
        if (!url) return;

        biz.contracts.push({ id: uid(), name: name.trim(), url: url.trim() });
        saveBusiness(biz);
        renderAll();
    }

    function deleteContract(id) {
        biz.contracts = biz.contracts.filter(c => c.id !== id);
        saveBusiness(biz);
        renderAll();
    }

    // ==========================================
    // 7. Meeting Scheduler
    // ==========================================

    function renderMeetings() {
        const el = document.getElementById('business-meetings');
        if (!el) return;

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">📅 Meetings</h4>';
        html += '<button class="biz-btn biz-btn-sm" onclick="Phase16.addMeeting()">+ Add</button>';
        html += '</div>';

        const now = Date.now();
        const upcoming = [...biz.meetings]
            .filter(m => new Date(m.datetime).getTime() > now - 3600000) // Include meetings from last hour
            .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
        const past = [...biz.meetings]
            .filter(m => new Date(m.datetime).getTime() <= now - 3600000)
            .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
            .slice(0, 3);

        if (upcoming.length === 0 && past.length === 0) {
            html += '<div class="biz-empty">No meetings scheduled</div>';
            el.innerHTML = html;
            return;
        }

        if (upcoming.length > 0) {
            html += '<div class="biz-meeting-section-label">Upcoming</div>';
            html += '<div class="biz-meeting-list">';
            upcoming.forEach(m => {
                const dt = new Date(m.datetime);
                const minsUntil = Math.floor((dt.getTime() - now) / 60000);
                let timeLabel;
                if (minsUntil < 0) timeLabel = 'Now';
                else if (minsUntil < 60) timeLabel = minsUntil + 'min';
                else timeLabel = Math.floor(minsUntil / 60) + 'h ' + (minsUntil % 60) + 'm';

                const isImminent = minsUntil >= 0 && minsUntil <= 15;
                html += '<div class="biz-meeting-item' + (isImminent ? ' biz-meeting-imminent' : '') + '">';
                html += '<div class="biz-meeting-info">';
                html += '<span class="biz-meeting-title">' + esc(m.title) + '</span>';
                html += '<span class="biz-meeting-datetime">' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' @ ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '</span>';
                html += '</div>';
                html += '<span class="biz-meeting-countdown">' + timeLabel + '</span>';
                html += '<button class="biz-btn-icon" onclick="Phase16.deleteMeeting(\'' + m.id + '\')">🗑️</button>';
                html += '</div>';
            });
            html += '</div>';
        }

        if (past.length > 0) {
            html += '<div class="biz-meeting-section-label biz-text-muted">Recent past</div>';
            html += '<div class="biz-meeting-list biz-meeting-past">';
            past.forEach(m => {
                const dt = new Date(m.datetime);
                html += '<div class="biz-meeting-item biz-meeting-done">';
                html += '<span class="biz-meeting-title">' + esc(m.title) + '</span>';
                html += '<span class="biz-meeting-datetime">' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        el.innerHTML = html;
    }

    function addMeeting() {
        const title = prompt('Meeting title:');
        if (!title) return;
        const date = prompt('Date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
        if (!date) return;
        const time = prompt('Time (HH:MM, 24h format):', '10:00');
        if (!time) return;

        biz.meetings.push({
            id: uid(),
            title: title.trim(),
            datetime: date + 'T' + time
        });
        saveBusiness(biz);
        renderAll();
    }

    function deleteMeeting(id) {
        biz.meetings = biz.meetings.filter(m => m.id !== id);
        saveBusiness(biz);
        renderAll();
    }

    // ==========================================
    // 8. Weekly Business Summary
    // ==========================================

    function renderWeeklySummary() {
        const el = document.getElementById('business-summary');
        if (!el) return;

        let html = '<div class="biz-section-header">';
        html += '<h4 class="biz-title">📋 Weekly Summary</h4>';
        html += '</div>';

        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

        // Invoices this week
        const weekInvoices = biz.invoices.filter(i => new Date(i.date).getTime() >= weekAgo);
        const weekPaid = weekInvoices.filter(i => i.status === 'paid');
        const weekPaidTotal = weekPaid.reduce((s, i) => s + Number(i.amount), 0);
        const weekPendingTotal = weekInvoices.filter(i => i.status !== 'paid').reduce((s, i) => s + Number(i.amount), 0);

        // Expenses this week
        const weekExpenses = biz.expenses.filter(e => new Date(e.date).getTime() >= weekAgo);
        const weekExpTotal = weekExpenses.reduce((s, e) => s + Number(e.amount), 0);

        // Time tracked this week
        const weekTime = biz.timeEntries.filter(e => e.start >= weekAgo);
        const weekSecs = weekTime.reduce((s, e) => s + (e.seconds || 0), 0);

        // Upcoming meetings (next 7 days)
        const weekLater = now + 7 * 24 * 60 * 60 * 1000;
        const upcomingMeetings = biz.meetings.filter(m => {
            const t = new Date(m.datetime).getTime();
            return t >= now && t <= weekLater;
        });

        // Upcoming tax deadlines (next 30 days)
        const monthLater = now + 30 * 24 * 60 * 60 * 1000;
        const upcomingTax = biz.taxDeadlines.filter(t => {
            const d = new Date(t.date).getTime();
            return d >= now && d <= monthLater;
        });

        // Net
        const net = weekPaidTotal - weekExpTotal;

        html += '<div class="biz-summary-card">';
        html += '<div class="biz-summary-grid">';
        html += '<div class="biz-summary-stat"><span class="biz-summary-value biz-text-success">' + fmt$(weekPaidTotal) + '</span><span class="biz-summary-label">Revenue</span></div>';
        html += '<div class="biz-summary-stat"><span class="biz-summary-value biz-text-danger">' + fmt$(weekExpTotal) + '</span><span class="biz-summary-label">Expenses</span></div>';
        html += '<div class="biz-summary-stat"><span class="biz-summary-value' + (net >= 0 ? ' biz-text-success' : ' biz-text-danger') + '">' + fmt$(net) + '</span><span class="biz-summary-label">Net</span></div>';
        html += '<div class="biz-summary-stat"><span class="biz-summary-value">' + fmtTime(weekSecs) + '</span><span class="biz-summary-label">Hours</span></div>';
        html += '</div>';

        // Text summary
        html += '<div class="biz-summary-text">';
        html += '<p>This week: <strong>' + weekInvoices.length + '</strong> invoice(s) created, ';
        html += '<strong>' + weekPaid.length + '</strong> paid (' + fmt$(weekPaidTotal) + '). ';
        html += 'Outstanding: ' + fmt$(weekPendingTotal) + '.</p>';
        html += '<p><strong>' + weekExpenses.length + '</strong> expense(s) totaling ' + fmt$(weekExpTotal) + '. ';
        html += 'Time logged: ' + fmtTime(weekSecs) + '.</p>';
        if (upcomingMeetings.length > 0) {
            html += '<p>📅 ' + upcomingMeetings.length + ' meeting(s) this week.</p>';
        }
        if (upcomingTax.length > 0) {
            html += '<p>⚠️ ' + upcomingTax.length + ' tax deadline(s) in the next 30 days.</p>';
        }
        html += '</div></div>';

        el.innerHTML = html;
    }

    // ==========================================
    // Escape helper
    // ==========================================

    function esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ==========================================
    // Render All
    // ==========================================

    function renderAll() {
        renderInvoices();
        renderTimeTracker();
        renderRevenue();
        renderExpenses();
        renderTaxDeadlines();
        renderContracts();
        renderMeetings();
        renderWeeklySummary();
    }

    // ==========================================
    // Init
    // ==========================================

    function init() {
        // Ensure containers exist — if not, skip (page may not have business section)
        const ids = [
            'business-invoices', 'business-time-tracker', 'business-revenue',
            'business-expenses', 'business-tax', 'business-contracts',
            'business-meetings', 'business-summary'
        ];
        const anyExist = ids.some(id => document.getElementById(id));
        if (!anyExist) {
            console.log('[Phase16] No business containers found — skipping render');
            return;
        }

        // Mirror to global state
        if (typeof state !== 'undefined') {
            state.business = biz;
        }

        renderAll();

        // Resume active timers
        if (Object.keys(biz.activeTimers).length > 0) {
            ensureTimerInterval();
        }

        // Refresh meetings/deadlines every minute
        setInterval(() => {
            renderTaxDeadlines();
            renderMeetings();
        }, 60000);

        console.log('[Phase16] Business features initialized');
    }

    // ==========================================
    // Public API
    // ==========================================

    window.Phase16 = {
        init,
        renderAll,
        // Invoices
        addInvoice,
        markPaid,
        deleteInvoice,
        // Time Tracker
        startTimer,
        resumeTimer,
        stopTimer,
        deleteProject,
        // Expenses
        addExpense,
        deleteExpense,
        // Tax
        addTaxDeadline,
        deleteTaxDeadline,
        // Contracts
        addContract,
        deleteContract,
        // Meetings
        addMeeting,
        deleteMeeting
    };

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
