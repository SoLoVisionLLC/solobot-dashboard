// js/cron.js — Cron Jobs Manager page

let cronJobs = [];
let cronInterval = null;
let cronRunCache = new Map();
let cronDiagnostics = new Map();
let activeCronJobId = null;
let activeCronTimeline = [];
let cronDetailLoadToken = 0;
let cronListFilter = 'all';
let cronListQuery = '';
let cronVisibleCount = 24;
const CRON_CACHE_KEY = 'cronListCache.v1';
const CRON_NAME_MAP_KEY = 'cronJobNameMap.v1';

function initCronPage() {
    const searchInput = document.getElementById('cron-search-input');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = 'true';
        searchInput.addEventListener('input', (event) => {
            cronListQuery = event.target.value.trim().toLowerCase();
            renderCronJobs();
        });
    }

    updateCronFilterChips();
    renderEmptyDetailState();
    loadCronJobs();
    syncCronViewFromURL();
    if (cronInterval) clearInterval(cronInterval);
    cronInterval = setInterval(() => {
        if (activeCronJobId) {
            openCronDetailView(activeCronJobId, { refresh: true, pushState: false });
        } else {
            loadCronJobs({ silent: true });
        }
    }, 30000);
}

function formatCronSchedule(schedule) {
    if (!schedule) return '--';
    if (typeof schedule === 'string') return schedule;

    if (schedule.kind === 'cron') {
        return schedule.tz ? `${schedule.expr || '--'} (${schedule.tz})` : (schedule.expr || '--');
    }
    if (schedule.kind === 'every') {
        const ms = Number(schedule.everyMs || 0);
        if (!ms) return 'every --';
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `every ${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `every ${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `every ${hours}h`;
        const days = Math.floor(hours / 24);
        return `every ${days}d`;
    }
    if (schedule.kind === 'at') {
        try {
            return `at ${new Date(schedule.at).toLocaleString()}`;
        } catch {
            return `at ${schedule.at || '--'}`;
        }
    }

    return JSON.stringify(schedule);
}

function formatDateTime(value) {
    if (value == null || value === '') return '--';
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString();
}

function getCronState(job) {
    return job?.state || {};
}

function formatNextRun(job) {
    const state = getCronState(job);
    const next = state.nextRunAtMs || job.nextRunAtMs || job.nextRun;
    return formatDateTime(next);
}

function formatLastRun(job) {
    const state = getCronState(job);
    const last = state.lastRunAtMs || job.lastRunAtMs || job.lastRun;
    if (!last) return 'Never';
    if (typeof timeAgo === 'function') return timeAgo(Number(last));
    return formatDateTime(last);
}

function getLastStatus(job) {
    const state = getCronState(job);
    return state.lastRunStatus || state.lastStatus || job.lastRunStatus || job.lastStatus || '--';
}

function getLastError(job) {
    const state = getCronState(job);
    return state.lastError || job.lastError || null;
}

function getPayloadSummary(job) {
    const payload = job?.payload;
    if (!payload) return '';
    if (payload.kind === 'systemEvent') return payload.text || '';
    if (payload.kind === 'agentTurn') return payload.message || '';
    return '';
}

function getJobById(jobId) {
    return cronJobs.find(job => String(job.id) === String(jobId));
}

function persistCronNameMap() {
    try {
        const map = {};
        for (const job of cronJobs) {
            if (!job || !job.id) continue;
            map[String(job.id)] = String(job.name || job.id);
        }
        localStorage.setItem(CRON_NAME_MAP_KEY, JSON.stringify(map));
    } catch (e) {
        console.warn('[Cron] Failed to persist cron name map:', e?.message || e);
    }
}

window.getCronFriendlyNameById = function (jobId) {
    if (!jobId) return null;
    try {
        const raw = localStorage.getItem(CRON_NAME_MAP_KEY);
        if (!raw) return null;
        const map = JSON.parse(raw);
        const value = map && map[String(jobId)];
        return value ? String(value) : null;
    } catch {
        return null;
    }
};

function summarizeRuns(runs = []) {
    const sorted = [...runs].sort((a, b) => Number(b.runAtMs || b.ts || 0) - Number(a.runAtMs || a.ts || 0));
    const failures = sorted.filter(r => (r.status || '').toLowerCase() === 'error' || (r.status || '').toLowerCase() === 'failed');
    const successes = sorted.filter(r => (r.status || '').toLowerCase() === 'ok' || (r.status || '').toLowerCase() === 'success');
    const latest = sorted[0] || null;
    const latestFailure = failures[0] || null;
    const latestSuccess = successes[0] || null;

    return {
        latest,
        latestFailure,
        latestSuccess,
        failureCount: failures.length,
        successCount: successes.length,
        totalCount: sorted.length
    };
}

async function fetchCronRuns(jobId, { refresh = false, limit = 20 } = {}) {
    if (!refresh && cronRunCache.has(jobId)) return cronRunCache.get(jobId);
    const result = await gateway._request('cron.runs', { jobId, limit });
    const runs = result?.entries || result?.runs || [];
    cronRunCache.set(jobId, runs);
    cronDiagnostics.set(jobId, summarizeRuns(runs));
    return runs;
}

async function hydrateCronDiagnostics() {
    const jobs = cronJobs.slice(0, 6);
    if (!jobs.length) return;

    const startedAt = performance.now();
    await Promise.all(jobs.map(async (job) => {
        if (!job?.id) return;
        try {
            await fetchCronRuns(job.id, { limit: 10 });
        } catch (e) {
            console.warn('[Cron] Failed to fetch diagnostics for job', job.id, e.message);
        }
    }));

    renderCronJobs();
    console.log(`[Perf][Cron] Warmed diagnostics for ${jobs.length}/${cronJobs.length} jobs in ${Math.round(performance.now() - startedAt)}ms`);
}

function buildDetailURL(jobId) {
    const url = new URL(window.location.href);
    url.pathname = '/cron';
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');
    return `${url.pathname}${url.search}${url.hash}`;
}

function getCronJobStatusTone(job) {
    const status = String(getLastStatus(job) || '').toLowerCase();
    if (job?.enabled === false) return 'disabled';
    if (status === 'error' || status === 'failed') return 'error';
    if (status === 'ok' || status === 'success') return 'success';
    return 'neutral';
}

function getCronJobAccentColor(job) {
    const tone = getCronJobStatusTone(job);
    if (tone === 'error') return 'var(--error)';
    if (tone === 'success') return 'var(--success)';
    if (tone === 'disabled') return 'var(--text-muted)';
    return 'var(--brand, var(--text-primary))';
}

function matchesCronListFilter(job) {
    const tone = getCronJobStatusTone(job);
    const lastRunAt = Number(getCronState(job).lastRunAtMs || job?.lastRunAtMs || job?.lastRun || 0);
    const isRecent = lastRunAt > Date.now() - (24 * 60 * 60 * 1000);

    if (cronListFilter === 'failing') return tone === 'error';
    if (cronListFilter === 'healthy') return tone === 'success';
    if (cronListFilter === 'disabled') return tone === 'disabled';
    if (cronListFilter === 'recent') return isRecent;
    return true;
}

function matchesCronListQuery(job) {
    if (!cronListQuery) return true;
    const haystack = [
        job?.name,
        job?.id,
        formatCronSchedule(job?.schedule || job?.cron),
        job?.description,
        getPayloadSummary(job),
        getLastStatus(job)
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(cronListQuery);
}

function readCronCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CRON_CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.jobs)) return null;
        return cached;
    } catch {
        return null;
    }
}

function writeCronCache(jobs) {
    try {
        localStorage.setItem(CRON_CACHE_KEY, JSON.stringify({ ts: Date.now(), jobs }));
    } catch {}
}

function getVisibleCronJobs() {
    return cronJobs.filter(job => matchesCronListFilter(job) && matchesCronListQuery(job));
}

function getRenderedCronJobs() {
    return getVisibleCronJobs().slice(0, cronVisibleCount);
}

function updateCronListMeta(total = cronJobs.length, visible = getVisibleCronJobs().length) {
    const meta = document.getElementById('cron-list-meta');
    if (!meta) return;
    meta.textContent = visible === total
        ? `${total} jobs`
        : `${visible} of ${total} jobs shown`;
}

function updateCronFilterChips() {
    document.querySelectorAll('[data-cron-filter]').forEach((button) => {
        const isActive = button.dataset.cronFilter === cronListFilter;
        button.style.background = isActive ? 'var(--brand, var(--surface-2))' : 'transparent';
        button.style.color = isActive ? 'white' : 'var(--text-primary)';
        button.style.borderColor = isActive ? 'var(--brand, var(--surface-2))' : 'var(--border-default)';
    });
}

function renderEmptyDetailState(message = 'Choose a cron job on the left to inspect its schedule, failures, and recent runs.') {
    activeCronTimeline = [];
    const summary = document.getElementById('cron-detail-summary');
    const meta = document.getElementById('cron-detail-meta');
    const timeline = document.getElementById('cron-detail-timeline');
    const error = document.getElementById('cron-detail-error');
    const title = document.getElementById('cron-detail-title');
    const subtitle = document.getElementById('cron-detail-subtitle');

    if (title) title.textContent = activeCronJobId ? 'Loading cron job…' : 'Select a cron job';
    if (subtitle) subtitle.textContent = message;
    if (summary) summary.innerHTML = '';
    if (meta) meta.innerHTML = '<div class="empty-state">Select a job to see metadata and configuration details.</div>';
    if (timeline) timeline.innerHTML = '<div class="empty-state">Select a job to view its recent run timeline.</div>';
    if (error) {
        error.classList.add('hidden');
        error.innerHTML = '';
    }
}

function syncCronViewFromURL() {
    const cronPage = document.getElementById('page-cron');
    if (cronPage && !cronPage.classList.contains('active')) return;

    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job');
    if (window.location.pathname === '/cron' && jobId) {
        openCronDetailView(jobId, { pushState: false });
    } else {
        showCronListView();
    }
}

function showCronListView() {
    activeCronJobId = null;
    cronDetailLoadToken += 1;
    document.getElementById('cron-list-view')?.classList.remove('hidden');
    document.getElementById('cron-detail-view')?.classList.remove('hidden');
    renderCronJobs();
    renderEmptyDetailState();
}

function setCronDetailURL(jobId) {
    const url = new URL(window.location.href);
    url.pathname = '/cron';
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');

    const targetPath = `${url.pathname}${url.search}${url.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (targetPath === currentPath) return;

    history.pushState({ page: 'cron', jobId }, '', targetPath);
}

function renderSummaryCard(label, value, tone = 'default', subtext = '') {
    const toneColor = tone === 'error'
        ? 'var(--error)'
        : tone === 'success'
            ? 'var(--success)'
            : 'var(--text-primary)';
    return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 14px; min-height: 88px;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 8px;">${escapeHtml(label)}</div>
            <div style="font-size: 18px; font-weight: 700; color: ${toneColor}; line-height: 1.2;">${escapeHtml(value || '--')}</div>
            ${subtext ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">${escapeHtml(subtext)}</div>` : ''}
        </div>`;
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyJsonToClipboard(data, successMessage = 'Copied JSON to clipboard') {
    const text = JSON.stringify(data, null, 2);
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage, 'success');
    } catch (e) {
        console.warn('[Cron] Clipboard copy failed:', e.message);
        showToast('Clipboard copy failed', 'error');
    }
}

function buildCronListExport() {
    return {
        exportedAt: new Date().toISOString(),
        page: 'cron-list',
        totalJobs: cronJobs.length,
        jobs: cronJobs.map((job) => ({
            ...job,
            diagnostics: cronDiagnostics.get(job.id) || null,
            recentRuns: cronRunCache.get(job.id) || []
        }))
    };
}

function buildCronTimelineExport(jobId) {
    const job = getJobById(jobId);
    return {
        exportedAt: new Date().toISOString(),
        page: 'cron-timeline',
        jobId,
        job,
        diagnostics: cronDiagnostics.get(jobId) || (activeCronTimeline.length ? summarizeRuns(activeCronTimeline) : null),
        runs: activeCronTimeline
    };
}

function renderDetailMeta(job, runs, diagnostics) {
    const state = getCronState(job);
    const meta = [
        ['Job ID', job.id || '--'],
        ['Agent', job.agentId || '--'],
        ['Session target', job.sessionTarget || '--'],
        ['Wake mode', job.wakeMode || '--'],
        ['Enabled', job.enabled !== false ? 'Yes' : 'No'],
        ['Schedule', formatCronSchedule(job.schedule)],
        ['Next scheduled run', formatNextRun(job)],
        ['Current status', getLastStatus(job)],
        ['Consecutive errors', String(state.consecutiveErrors || 0)],
        ['History URL', buildDetailURL(job.id)]
    ];

    const payloadPreview = getPayloadSummary(job);

    document.getElementById('cron-detail-meta').innerHTML = `
        <div style="display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
            <div style="font-size: 14px; font-weight: 600;">Job metadata</div>
            <div style="font-size: 11px; color: var(--text-muted);">Showing ${runs.length} recent attempts</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 12px;">
            ${meta.map(([k, v]) => `
                <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px;">
                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">${escapeHtml(k)}</div>
                    <div style="font-size: 13px; font-family: ${k === 'History URL' || k === 'Job ID' ? 'monospace' : 'inherit'}; word-break: break-word;">${escapeHtml(v)}</div>
                </div>`).join('')}
        </div>
        ${payloadPreview ? `
            <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 12px;">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;">Payload preview</div>
                <div style="font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(payloadPreview)}</div>
            </div>` : ''}
    `;

    const errorEl = document.getElementById('cron-detail-error');
    if (diagnostics.latestFailure) {
        errorEl.classList.remove('hidden');
        errorEl.innerHTML = `
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--error); margin-bottom: 8px;">Latest failed attempt</div>
            <div style="font-size: 16px; font-weight: 700; margin-bottom: 6px;">${escapeHtml(formatDateTime(diagnostics.latestFailure.runAtMs || diagnostics.latestFailure.ts))}</div>
            <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(diagnostics.latestFailure.error || diagnostics.latestFailure.summary || 'No error message recorded')}</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; font-size: 11px; color: var(--text-muted);">
                <span>Status: ${escapeHtml(diagnostics.latestFailure.status || '--')}</span>
                <span>Duration: ${escapeHtml(String(diagnostics.latestFailure.durationMs || '--'))}ms</span>
                <span>Provider: ${escapeHtml(diagnostics.latestFailure.provider || '--')}</span>
                <span>Model: ${escapeHtml(diagnostics.latestFailure.model || '--')}</span>
            </div>
        `;
    } else {
        errorEl.classList.add('hidden');
        errorEl.innerHTML = '';
    }
}

function renderDetailTimeline(runs = []) {
    const timeline = document.getElementById('cron-detail-timeline');
    if (!runs.length) {
        timeline.innerHTML = '<div class="empty-state">No run history available for this job.</div>';
        return;
    }

    timeline.innerHTML = runs.map((entry, index) => {
        const status = (entry.status || 'unknown').toLowerCase();
        const tone = status === 'ok' || status === 'success'
            ? 'var(--success)'
            : status === 'error' || status === 'failed'
                ? 'var(--error)'
                : 'var(--text-primary)';
        const summary = entry.summary || '';
        const error = entry.error || entry.deliveryError || entry.errorMessage || '';
        const usage = entry.usage
            ? Object.entries(entry.usage).map(([k, v]) => `${k}: ${v}`).join(' • ')
            : '';

        return `
            <div style="display: grid; grid-template-columns: 24px 1fr; gap: 14px; align-items: stretch;">
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <div style="width: 12px; height: 12px; border-radius: 999px; background: ${tone}; margin-top: 18px;"></div>
                    ${index < runs.length - 1 ? '<div style="flex: 1; width: 2px; background: var(--border-default); margin-top: 6px;"></div>' : ''}
                </div>
                <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 14px;">
                    <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 10px;">
                        <div>
                            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px;">
                                <span class="badge" style="font-size: 10px; background: ${tone}; color: white;">${escapeHtml(entry.status || 'unknown')}</span>
                                <span class="badge" style="font-size: 10px;">${escapeHtml(entry.action || 'run')}</span>
                                ${entry.deliveryStatus ? `<span class="badge" style="font-size: 10px;">delivery: ${escapeHtml(entry.deliveryStatus)}</span>` : ''}
                            </div>
                            <div style="font-size: 15px; font-weight: 700;">${escapeHtml(formatDateTime(entry.runAtMs || entry.ts))}</div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Duration: ${escapeHtml(String(entry.durationMs || '--'))}ms · Next run: ${escapeHtml(formatDateTime(entry.nextRunAtMs))}</div>
                        </div>
                        <div style="text-align: right; font-size: 11px; color: var(--text-muted); min-width: 180px;">
                            <div>Provider: ${escapeHtml(entry.provider || '--')}</div>
                            <div>Model: ${escapeHtml(entry.model || '--')}</div>
                            <div>Session: ${escapeHtml(entry.sessionId || '--')}</div>
                        </div>
                    </div>

                    ${error ? `
                        <div style="background: color-mix(in srgb, var(--error) 10%, transparent); border: 1px solid color-mix(in srgb, var(--error) 28%, var(--border-default)); border-radius: var(--radius-sm); padding: 10px; margin-bottom: 10px;">
                            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--error); margin-bottom: 6px;">Error details</div>
                            <div style="font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;">${escapeHtml(error)}</div>
                        </div>` : ''}

                    ${summary ? `
                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 6px;">Summary / output</div>
                            <div style="font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;">${escapeHtml(summary)}</div>
                        </div>` : ''}

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 8px;">
                        <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px;">
                            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Session key</div>
                            <div style="font-size: 12px; font-family: monospace; word-break: break-word;">${escapeHtml(entry.sessionKey || '--')}</div>
                        </div>
                        <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px;">
                            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Token usage</div>
                            <div style="font-size: 12px; word-break: break-word;">${escapeHtml(usage || '--')}</div>
                        </div>
                        <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px;">
                            <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Delivery</div>
                            <div style="font-size: 12px; word-break: break-word;">${escapeHtml(entry.delivered ? 'Delivered' : 'Not delivered')} ${entry.deliveryError ? `• ${escapeHtml(entry.deliveryError)}` : ''}</div>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');
}

async function openCronDetailView(jobId, { refresh = false, pushState = true } = {}) {
    const detailView = document.getElementById('cron-detail-view');
    const listView = document.getElementById('cron-list-view');
    const timeline = document.getElementById('cron-detail-timeline');
    if (!detailView || !listView || !timeline) return;

    const loadToken = ++cronDetailLoadToken;
    activeCronJobId = jobId;
    listView.classList.remove('hidden');
    detailView.classList.remove('hidden');
    renderCronJobs();
    timeline.innerHTML = '<div class="empty-state">Loading run timeline...</div>';
    document.getElementById('cron-detail-summary').innerHTML = '';
    document.getElementById('cron-detail-meta').innerHTML = '<div class="empty-state">Loading job metadata...</div>';
    document.getElementById('cron-detail-error').classList.add('hidden');
    document.getElementById('cron-detail-error').innerHTML = '';

    if (pushState) setCronDetailURL(jobId);

    let job = getJobById(jobId);
    if (!job) {
        await loadCronJobs({ silent: true, skipDiagnostics: true });
        if (loadToken !== cronDetailLoadToken) return;
        job = getJobById(jobId);
    }
    if (!job) {
        if (loadToken !== cronDetailLoadToken) return;
        activeCronJobId = null;
        renderCronJobs();
        renderEmptyDetailState('That cron job could not be found.');
        return;
    }

    document.getElementById('cron-detail-title').textContent = job.name || job.id || 'Cron Job History';
    document.getElementById('cron-detail-subtitle').textContent = `${formatCronSchedule(job.schedule)} · ${job.id}`;

    document.getElementById('cron-detail-run-btn').onclick = () => runCronJob(job.id);
    document.getElementById('cron-detail-refresh-btn').onclick = () => openCronDetailView(job.id, { refresh: true, pushState: false });
    document.getElementById('cron-detail-copy-btn').onclick = () => copyCronTimelineJson();
    document.getElementById('cron-detail-export-btn').onclick = () => exportCronTimelineJson();

    try {
        const runs = await fetchCronRuns(job.id, { refresh, limit: 50 });
        if (loadToken !== cronDetailLoadToken) return;
        activeCronTimeline = runs;
        const diagnostics = cronDiagnostics.get(job.id) || summarizeRuns(runs);
        document.getElementById('cron-detail-summary').innerHTML = [
            renderSummaryCard('Last run', formatDateTime(diagnostics.latest?.runAtMs || diagnostics.latest?.ts), (diagnostics.latest?.status || '').toLowerCase() === 'error' ? 'error' : 'default', diagnostics.latest?.status || '--'),
            renderSummaryCard('Last failed attempt', diagnostics.latestFailure ? formatDateTime(diagnostics.latestFailure.runAtMs || diagnostics.latestFailure.ts) : 'None in recent history', diagnostics.latestFailure ? 'error' : 'success', diagnostics.latestFailure?.provider || ''),
            renderSummaryCard('Last successful attempt', diagnostics.latestSuccess ? formatDateTime(diagnostics.latestSuccess.runAtMs || diagnostics.latestSuccess.ts) : 'None in recent history', diagnostics.latestSuccess ? 'success' : 'default', diagnostics.latestSuccess?.provider || ''),
            renderSummaryCard('History window', `${diagnostics.totalCount} attempts`, 'default', `${diagnostics.failureCount} failed · ${diagnostics.successCount} successful`),
            renderSummaryCard('Consecutive errors', String(getCronState(job).consecutiveErrors || 0), (getCronState(job).consecutiveErrors || 0) > 0 ? 'error' : 'success', `Current status: ${getLastStatus(job)}`),
            renderSummaryCard('Next run', formatNextRun(job), 'default', job.enabled !== false ? 'Enabled' : 'Disabled')
        ].join('');
        renderDetailMeta(job, runs, diagnostics);
        renderDetailTimeline(runs);
    } catch (e) {
        if (loadToken !== cronDetailLoadToken) return;
        timeline.innerHTML = `<div class="empty-state">Failed to load run timeline: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }
}

window.closeCronDetailView = function() {
    showCronListView();
    activeCronTimeline = [];
    const targetPath = buildDetailURL(null);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (targetPath !== currentPath) {
        history.pushState({ page: 'cron' }, '', targetPath);
    }
};

window.setCronListFilter = function(filter) {
    cronListFilter = filter || 'all';
    updateCronFilterChips();
    renderCronJobs();
};

window.copyCronListJson = async function() {
    await copyJsonToClipboard(buildCronListExport(), 'Copied cron list JSON');
};

window.exportCronListJson = function() {
    downloadJson(`cron-list-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, buildCronListExport());
    showToast('Cron list JSON exported', 'success');
};

window.copyCronTimelineJson = async function() {
    if (!activeCronJobId) {
        showToast('Open a cron timeline first', 'warning');
        return;
    }
    await copyJsonToClipboard(buildCronTimelineExport(activeCronJobId), 'Copied cron timeline JSON');
};

window.exportCronTimelineJson = function() {
    if (!activeCronJobId) {
        showToast('Open a cron timeline first', 'warning');
        return;
    }
    downloadJson(`cron-timeline-${activeCronJobId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, buildCronTimelineExport(activeCronJobId));
    showToast('Cron timeline JSON exported', 'success');
};

async function loadCronJobs({ silent = false, skipDiagnostics = false } = {}) {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    const startedAt = performance.now();

    if (!silent) {
        container.innerHTML = '<div class="empty-state">Loading cron jobs...</div>';
    }

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div class="empty-state">Connect to gateway to manage cron jobs</div>';
        return;
    }

    try {
        const result = await gateway._request('cron.list', { includeDisabled: true });
        cronJobs = Array.isArray(result?.jobs) ? result.jobs : (Array.isArray(result) ? result : []);
        persistCronNameMap();
        if (activeCronJobId && !getJobById(activeCronJobId)) {
            activeCronJobId = null;
            renderEmptyDetailState('The previously selected job is no longer available.');
        }
        renderCronJobs();
        console.log(`[Perf][Cron] cron.list + first render: ${Math.round(performance.now() - startedAt)}ms for ${cronJobs.length} jobs`);
        if (!skipDiagnostics) {
            console.log('[Perf][Cron] Skipping history warm-up on initial page load');
        }
    } catch (e) {
        console.warn('[Cron] Failed to fetch jobs:', e.message);
        container.innerHTML = `<div class="empty-state">Could not load cron jobs: ${escapeHtml(e.message || 'Unknown error')}</div>`;
    }
}

function renderCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    updateCronFilterChips();
    updateCronListMeta();

    if (cronJobs.length === 0) {
        container.innerHTML = '<div class="empty-state">No cron jobs configured</div>';
        return;
    }

    const visibleJobs = getVisibleCronJobs();
    updateCronListMeta(cronJobs.length, visibleJobs.length);

    if (!visibleJobs.length) {
        container.innerHTML = '<div class="empty-state">No jobs match the current search/filter.</div>';
        return;
    }

    container.innerHTML = visibleJobs.map((job, idx) => {
        const enabled = job.enabled !== false;
        const lastStatus = getLastStatus(job);
        const nextRun = formatNextRun(job);
        const lastRun = formatLastRun(job);
        const scheduleText = formatCronSchedule(job.schedule || job.cron);
        const payloadPreview = getPayloadSummary(job) || job.description || 'No summary available';
        const state = getCronState(job);
        const diagnostics = cronDiagnostics.get(job.id);
        const latestFailure = diagnostics?.latestFailure;
        const latestFailureMessage = latestFailure?.error || latestFailure?.summary || getLastError(job) || '';
        const accent = getCronJobAccentColor(job);
        const isActive = String(activeCronJobId) === String(job.id || idx);
        const failureCount = diagnostics?.failureCount || 0;
        const successCount = diagnostics?.successCount || 0;

        return `
        <button onclick="openCronDetailView('${job.id || idx}')" class="cron-job-card" style="width: 100%; text-align: left; background: ${isActive ? 'color-mix(in srgb, var(--brand, #5b8cff) 14%, var(--surface-1))' : 'var(--surface-1)'}; border: 1px solid ${isActive ? 'color-mix(in srgb, var(--brand, #5b8cff) 55%, var(--border-default))' : 'var(--border-default)'}; border-left: 4px solid ${accent}; border-radius: var(--radius-md); padding: 14px; margin-bottom: 10px; box-shadow: ${isActive ? '0 10px 30px rgba(0,0,0,0.12)' : 'none'}; cursor: pointer;">
            <div style="display: grid; gap: 10px;">
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
                    <div style="min-width: 0; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                            <span style="width: 10px; height: 10px; border-radius: 999px; background: ${accent}; display: inline-block; flex-shrink: 0;"></span>
                            <span style="font-weight: 700; font-size: 15px; line-height: 1.35;">${escapeHtml(job.name || job.id || 'Unnamed Job')}</span>
                            ${!enabled ? '<span class="badge" style="font-size: 10px;">Disabled</span>' : ''}
                            ${lastStatus && lastStatus !== '--' ? `<span class="badge" style="font-size: 10px;">${escapeHtml(lastStatus)}</span>` : ''}
                            ${job.sessionTarget ? `<span class="badge" style="font-size: 10px;">${escapeHtml(job.sessionTarget)}</span>` : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-family: monospace; word-break: break-word;">${escapeHtml(job.id || '--')}</div>
                        <div style="font-size: 12px; color: var(--text-secondary, var(--text-muted)); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(payloadPreview)}</div>
                    </div>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;" onclick="event.stopPropagation();">
                        <button onclick="toggleCronJob('${job.id || idx}', ${!enabled})" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="${enabled ? 'Disable' : 'Enable'}">${enabled ? '⏸' : '▶'}</button>
                        <button onclick="runCronJob('${job.id || idx}')" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="Run Now">🚀</button>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">
                    <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px;">
                        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 4px;">Next run</div>
                        <div style="font-size: 12px; font-weight: 600; line-height: 1.4;">${escapeHtml(nextRun)}</div>
                    </div>
                    <div style="background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px;">
                        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 4px;">Last result</div>
                        <div style="font-size: 12px; font-weight: 600; line-height: 1.4;">${escapeHtml(lastRun)}</div>
                    </div>
                </div>

                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 11px; color: var(--text-muted);">
                    <code style="background: var(--surface-2); padding: 2px 6px; border-radius: 4px; font-size: 10px;">${escapeHtml(scheduleText)}</code>
                    ${state.consecutiveErrors ? `<span style="color: var(--error); font-weight: 600;">${escapeHtml(String(state.consecutiveErrors))} consecutive errors</span>` : ''}
                    ${(failureCount || successCount) ? `<span>${failureCount} failed · ${successCount} successful</span>` : ''}
                </div>

                ${latestFailureMessage && getCronJobStatusTone(job) === 'error' ? `
                    <div style="background: color-mix(in srgb, var(--error) 10%, transparent); border: 1px solid color-mix(in srgb, var(--error) 22%, var(--border-default)); border-radius: var(--radius-sm); padding: 10px;">
                        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--error); margin-bottom: 4px;">Latest failure</div>
                        <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(latestFailureMessage)}</div>
                    </div>` : ''}
            </div>
        </button>`;
    }).join('');
}

async function toggleCronJob(jobId, enable) {
    try {
        await gateway._request('cron.update', { jobId, patch: { enabled: enable } });
        showToast(`Job ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function runCronJob(jobId) {
    try {
        await gateway._request('cron.run', { jobId, mode: 'force' });
        showToast('Job triggered', 'success');
        cronRunCache.delete(jobId);
        cronDiagnostics.delete(jobId);
        if (activeCronJobId === jobId) {
            openCronDetailView(jobId, { refresh: true, pushState: false });
        } else {
            loadCronJobs({ silent: true });
        }
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

window.refreshCronDiagnostics = async function() {
    cronRunCache.clear();
    cronDiagnostics.clear();
    await loadCronJobs();
    showToast('Cron diagnostics refreshed', 'success');
};

window.openAddCronModal = function() {
    const modal = document.getElementById('add-cron-modal');
    if (modal) modal.classList.add('visible');
};

window.closeAddCronModal = function() {
    const modal = document.getElementById('add-cron-modal');
    if (modal) modal.classList.remove('visible');
};

window.submitNewCronJob = async function() {
    const name = document.getElementById('cron-new-name')?.value?.trim();
    const scheduleExpr = document.getElementById('cron-new-schedule')?.value?.trim();
    const command = document.getElementById('cron-new-command')?.value?.trim();

    if (!name || !scheduleExpr || !command) {
        showToast('Name, schedule, and message are required', 'warning');
        return;
    }

    const job = {
        name,
        schedule: {
            kind: 'cron',
            expr: scheduleExpr,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        },
        sessionTarget: 'main',
        wakeMode: 'now',
        payload: {
            kind: 'systemEvent',
            text: command
        },
        enabled: true
    };

    try {
        await gateway._request('cron.add', job);
        showToast('Cron job added', 'success');
        closeAddCronModal();
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.addEventListener('popstate', () => {
    if (window.location.pathname === '/cron') {
        syncCronViewFromURL();
    }
});
