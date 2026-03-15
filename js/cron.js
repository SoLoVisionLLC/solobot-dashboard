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
let cronDetailDrawerOpen = false;
let cronAgentFilter = 'all';
let cronEnabledFilter = 'all';
let cronActivityFilter = 'all';
let cronSortBy = 'nextRun';
let cronSortDirection = 'asc';
let cronAdvancedControlsOpen = false;
let cronListLoadPromise = null;
let cronLastLoadedAt = 0;
const CRON_CACHE_KEY = 'cronListCache.v1';
const CRON_NAME_MAP_KEY = 'cronJobNameMap.v1';
const CRON_MIN_REFRESH_INTERVAL_MS = 15000;
const CRON_REQUEST_TIMEOUT_MS = 10000;
const CRON_DETAIL_INITIAL_RUN_LIMIT = 12;
const CRON_DETAIL_FULL_RUN_LIMIT = 40;

function initCronPage() {
    const searchInput = document.getElementById('cron-search-input');
    if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = 'true';
        searchInput.addEventListener('input', (event) => {
            cronListQuery = event.target.value.trim().toLowerCase();
            renderCronJobs();
        });
    }
    if (searchInput) searchInput.value = cronListQuery;

    const agentFilter = document.getElementById('cron-agent-filter');
    if (agentFilter && !agentFilter.dataset.bound) {
        agentFilter.dataset.bound = 'true';
        agentFilter.addEventListener('change', (event) => {
            cronAgentFilter = event.target.value || 'all';
            updateCronAdvancedControlsUI();
            renderCronJobs();
        });
    }

    const enabledFilter = document.getElementById('cron-enabled-filter');
    if (enabledFilter && !enabledFilter.dataset.bound) {
        enabledFilter.dataset.bound = 'true';
        enabledFilter.addEventListener('change', (event) => {
            cronEnabledFilter = event.target.value || 'all';
            updateCronAdvancedControlsUI();
            renderCronJobs();
        });
    }
    if (enabledFilter) enabledFilter.value = cronEnabledFilter;

    const activityFilter = document.getElementById('cron-activity-filter');
    if (activityFilter && !activityFilter.dataset.bound) {
        activityFilter.dataset.bound = 'true';
        activityFilter.addEventListener('change', (event) => {
            cronActivityFilter = event.target.value || 'all';
            updateCronAdvancedControlsUI();
            renderCronJobs();
        });
    }
    if (activityFilter) activityFilter.value = cronActivityFilter;

    const sortBySelect = document.getElementById('cron-sort-by');
    if (sortBySelect && !sortBySelect.dataset.bound) {
        sortBySelect.dataset.bound = 'true';
        sortBySelect.addEventListener('change', (event) => {
            cronSortBy = event.target.value || 'nextRun';
            renderCronJobs();
        });
    }
    if (sortBySelect) sortBySelect.value = cronSortBy;

    const sortDirectionBtn = document.getElementById('cron-sort-direction-btn');
    if (sortDirectionBtn && !sortDirectionBtn.dataset.bound) {
        sortDirectionBtn.dataset.bound = 'true';
        sortDirectionBtn.addEventListener('click', () => {
            cronSortDirection = cronSortDirection === 'asc' ? 'desc' : 'asc';
            updateCronSortDirectionButton();
            renderCronJobs();
        });
    }

    updateCronFilterChips();
    updateCronSortDirectionButton();
    updateCronAdvancedControlsUI();
    const hydratedFromCache = hydrateCronJobsFromCache();
    if (!hydratedFromCache) {
        populateCronAgentFilterOptions();
    }

    const params = new URLSearchParams(window.location.search);
    const hasDeepLinkedJob = window.location.pathname === '/cron' && params.has('job');
    if (hasDeepLinkedJob) {
        renderEmptyDetailState();
        setCronDetailDrawerOpen(false);
        syncCronViewFromURL();
    } else {
        activeCronJobId = null;
        activeCronTimeline = [];
        renderEmptyDetailState();
        setCronDetailDrawerOpen(false);
    }

    const shouldRefresh = !cronJobs.length || (Date.now() - cronLastLoadedAt > CRON_MIN_REFRESH_INTERVAL_MS);
    if (shouldRefresh) {
        loadCronJobs({ silent: hydratedFromCache });
    } else {
        renderCronJobs();
    }

    if (cronInterval) clearInterval(cronInterval);
    cronInterval = setInterval(() => {
        const cronPage = document.getElementById('page-cron');
        if (!cronPage || !cronPage.classList.contains('active')) return;

        if (activeCronJobId && cronDetailDrawerOpen) {
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

function getCachedCronRuns(jobId) {
    const cached = cronRunCache.get(jobId);
    if (Array.isArray(cached)) return cached;
    if (cached && Array.isArray(cached.runs)) return cached.runs;
    return [];
}

function getCachedCronRunLimit(jobId) {
    const cached = cronRunCache.get(jobId);
    if (Array.isArray(cached)) return cached.length;
    if (cached && Number.isFinite(Number(cached.limit))) return Number(cached.limit);
    if (cached && Array.isArray(cached.runs)) return cached.runs.length;
    return 0;
}

async function fetchCronRuns(jobId, { refresh = false, limit = 20 } = {}) {
    const cachedRuns = getCachedCronRuns(jobId);
    const cachedLimit = getCachedCronRunLimit(jobId);
    if (!refresh && cachedRuns.length && cachedLimit >= limit) return cachedRuns;

    const result = await gateway._request('cron.runs', { jobId, limit }, CRON_REQUEST_TIMEOUT_MS);
    const runs = result?.entries || result?.runs || [];
    cronRunCache.set(jobId, {
        runs,
        limit,
        ts: Date.now()
    });
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

function getRunStatusTone(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'ok' || normalized === 'success') return 'success';
    if (normalized === 'error' || normalized === 'failed') return 'error';
    return 'neutral';
}

function getCronJobAccentColor(job) {
    const tone = getCronJobStatusTone(job);
    if (tone === 'error') return 'var(--error)';
    if (tone === 'success') return 'var(--success)';
    if (tone === 'disabled') return 'var(--text-muted)';
    return 'var(--brand, var(--text-primary))';
}

function getCronJobOwnerAgent(job) {
    const owner = String(job?.agentId || job?.ownerAgentId || '').trim();
    return owner;
}

function parseTimestamp(value) {
    if (value == null || value === '') return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getCronJobLastRunMs(job) {
    const state = getCronState(job);
    return parseTimestamp(state.lastRunAtMs || job?.lastRunAtMs || job?.lastRun);
}

function getCronJobNextRunMs(job) {
    const state = getCronState(job);
    return parseTimestamp(state.nextRunAtMs || job?.nextRunAtMs || job?.nextRun);
}

function getCronJobFailureCount(job) {
    const diagnostics = cronDiagnostics.get(job?.id);
    if (diagnostics && Number.isFinite(Number(diagnostics.failureCount))) {
        return Number(diagnostics.failureCount);
    }
    return getCronJobStatusTone(job) === 'error' ? 1 : 0;
}

function getCronJobConsecutiveErrors(job) {
    return Number(getCronState(job).consecutiveErrors || 0);
}

function compareNumbers(a, b, direction = 'asc') {
    const left = Number(a || 0);
    const right = Number(b || 0);
    if (left === right) return 0;
    if (direction === 'asc') return left < right ? -1 : 1;
    return left > right ? -1 : 1;
}

function compareStrings(a, b, direction = 'asc') {
    const left = String(a || '');
    const right = String(b || '');
    const result = left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
    return direction === 'asc' ? result : -result;
}

function getCronStatusSeverity(job) {
    const tone = getCronJobStatusTone(job);
    if (tone === 'error') return 4;
    if (tone === 'disabled') return 3;
    if (tone === 'neutral') return 2;
    if (tone === 'success') return 1;
    return 0;
}

function getComparableNextRunMs(job) {
    const next = getCronJobNextRunMs(job);
    if (next > 0) return next;
    return cronSortDirection === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

function getComparableLastRunMs(job) {
    const last = getCronJobLastRunMs(job);
    if (last > 0) return last;
    return cronSortDirection === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
}

function matchesCronListAdvancedFilters(job) {
    const owner = getCronJobOwnerAgent(job);
    if (cronAgentFilter === '__unassigned') {
        if (owner) return false;
    } else if (cronAgentFilter !== 'all' && owner !== cronAgentFilter) {
        return false;
    }

    const enabled = job?.enabled !== false;
    if (cronEnabledFilter === 'enabled' && !enabled) return false;
    if (cronEnabledFilter === 'disabled' && enabled) return false;

    const now = Date.now();
    const lastRunMs = getCronJobLastRunMs(job);
    const nextRunMs = getCronJobNextRunMs(job);
    if (cronActivityFilter === 'ran_24h' && !(lastRunMs > now - (24 * 60 * 60 * 1000))) return false;
    if (cronActivityFilter === 'stale_7d' && !(lastRunMs > 0 && lastRunMs < now - (7 * 24 * 60 * 60 * 1000))) return false;
    if (cronActivityFilter === 'never' && lastRunMs > 0) return false;
    if (cronActivityFilter === 'next_24h' && !(nextRunMs > now && nextRunMs <= now + (24 * 60 * 60 * 1000))) return false;

    return true;
}

function sortCronJobs(jobs = []) {
    const sorted = [...jobs];
    sorted.sort((a, b) => {
        let result = 0;

        if (cronSortBy === 'name') {
            result = compareStrings(a?.name || a?.id, b?.name || b?.id, cronSortDirection);
        } else if (cronSortBy === 'agent') {
            result = compareStrings(getCronJobOwnerAgent(a) || 'zzzzzz', getCronJobOwnerAgent(b) || 'zzzzzz', cronSortDirection);
        } else if (cronSortBy === 'nextRun') {
            result = compareNumbers(getComparableNextRunMs(a), getComparableNextRunMs(b), cronSortDirection);
        } else if (cronSortBy === 'lastRun') {
            result = compareNumbers(getComparableLastRunMs(a), getComparableLastRunMs(b), cronSortDirection);
        } else if (cronSortBy === 'status') {
            result = compareNumbers(getCronStatusSeverity(a), getCronStatusSeverity(b), cronSortDirection);
        } else if (cronSortBy === 'errors') {
            result = compareNumbers(getCronJobConsecutiveErrors(a), getCronJobConsecutiveErrors(b), cronSortDirection);
        } else if (cronSortBy === 'failures') {
            result = compareNumbers(getCronJobFailureCount(a), getCronJobFailureCount(b), cronSortDirection);
        }

        if (result !== 0) return result;
        return compareStrings(a?.name || a?.id, b?.name || b?.id, 'asc');
    });
    return sorted;
}

function populateCronAgentFilterOptions() {
    const select = document.getElementById('cron-agent-filter');
    if (!select) return;

    const currentValue = cronAgentFilter;
    const owners = Array.from(new Set(cronJobs.map(getCronJobOwnerAgent).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    const hasUnassigned = cronJobs.some(job => !getCronJobOwnerAgent(job));

    select.innerHTML = '';
    const addOption = (value, label) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    };

    addOption('all', 'All agents');
    if (hasUnassigned) addOption('__unassigned', 'Unassigned');
    owners.forEach((owner) => addOption(owner, owner));

    if (currentValue === 'all') {
        select.value = 'all';
        return;
    }
    if (currentValue === '__unassigned' && hasUnassigned) {
        select.value = currentValue;
        return;
    }
    if (owners.includes(currentValue)) {
        select.value = currentValue;
        return;
    }

    cronAgentFilter = 'all';
    select.value = 'all';
}

function updateCronSortDirectionButton() {
    const button = document.getElementById('cron-sort-direction-btn');
    if (!button) return;
    button.textContent = cronSortDirection === 'asc' ? 'Asc' : 'Desc';
    button.title = cronSortDirection === 'asc' ? 'Sort ascending' : 'Sort descending';
}

function updateCronAdvancedControlsUI() {
    const advanced = document.getElementById('cron-advanced-controls');
    const toggle = document.getElementById('cron-advanced-toggle-btn');
    const activeAdvancedCount = Number(cronAgentFilter !== 'all') +
        Number(cronEnabledFilter !== 'all') +
        Number(cronActivityFilter !== 'all');

    if (advanced) advanced.classList.toggle('hidden', !cronAdvancedControlsOpen);
    if (toggle) {
        const badge = activeAdvancedCount > 0 ? ` (${activeAdvancedCount})` : '';
        toggle.textContent = cronAdvancedControlsOpen ? `Hide filters${badge}` : `Filters${badge}`;
        toggle.setAttribute('aria-expanded', cronAdvancedControlsOpen ? 'true' : 'false');
    }
}

function getCronSortLabel() {
    if (cronSortBy === 'name') return 'name';
    if (cronSortBy === 'agent') return 'agent owner';
    if (cronSortBy === 'nextRun') return 'next run';
    if (cronSortBy === 'lastRun') return 'last run';
    if (cronSortBy === 'status') return 'status';
    if (cronSortBy === 'errors') return 'consecutive errors';
    if (cronSortBy === 'failures') return 'failure count';
    return 'next run';
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

function hydrateCronJobsFromCache() {
    const cached = readCronCache();
    if (!cached || !Array.isArray(cached.jobs) || !cached.jobs.length) return false;

    cronJobs = cached.jobs;
    cronLastLoadedAt = Number(cached.ts || 0);
    populateCronAgentFilterOptions();
    renderCronJobs();
    return true;
}

function getVisibleCronJobs() {
    const filtered = cronJobs.filter(job =>
        matchesCronListFilter(job) &&
        matchesCronListQuery(job) &&
        matchesCronListAdvancedFilters(job)
    );
    return sortCronJobs(filtered);
}

function getRenderedCronJobs() {
    return getVisibleCronJobs().slice(0, cronVisibleCount);
}

function updateCronListMeta(total = cronJobs.length, visible = getVisibleCronJobs().length) {
    const meta = document.getElementById('cron-list-meta');
    if (!meta) return;
    const countText = visible === total
        ? `${total} jobs`
        : `${visible} of ${total} jobs shown`;
    meta.textContent = countText;
}

function truncateForList(value, maxChars = 220) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function updateCronFilterChips() {
    document.querySelectorAll('[data-cron-filter]').forEach((button) => {
        const isActive = button.dataset.cronFilter === cronListFilter;
        button.classList.toggle('is-active', isActive);
    });
}

function setCronDetailDrawerOpen(open) {
    const shouldOpen = Boolean(open && activeCronJobId);
    const page = document.getElementById('page-cron');
    const detailView = document.getElementById('cron-detail-view');
    const peekButton = document.getElementById('cron-detail-peek-btn');

    cronDetailDrawerOpen = shouldOpen;
    if (page) page.classList.toggle('cron-detail-open', shouldOpen);
    if (detailView) detailView.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    if (peekButton) {
        const shouldShowPeek = !shouldOpen && Boolean(activeCronJobId);
        peekButton.classList.toggle('hidden', !shouldShowPeek);
    }
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
    setCronDetailDrawerOpen(false);
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
    const toneClass = tone === 'error' || tone === 'success' ? ` cron-tone-${tone}` : '';
    return `
        <div class="cron-summary-card${toneClass}">
            <div class="cron-summary-label">${escapeHtml(label)}</div>
            <div class="cron-summary-value">${escapeHtml(value || '--')}</div>
            ${subtext ? `<div class="cron-summary-subtext">${escapeHtml(subtext)}</div>` : ''}
        </div>`;
}

function renderCronDetailSummary(job, diagnostics) {
    const state = getCronState(job);
    return [
        renderSummaryCard('Last run', formatDateTime(diagnostics.latest?.runAtMs || diagnostics.latest?.ts), (diagnostics.latest?.status || '').toLowerCase() === 'error' ? 'error' : 'default', diagnostics.latest?.status || '--'),
        renderSummaryCard('Last failed attempt', diagnostics.latestFailure ? formatDateTime(diagnostics.latestFailure.runAtMs || diagnostics.latestFailure.ts) : 'None in recent history', diagnostics.latestFailure ? 'error' : 'success', diagnostics.latestFailure?.provider || ''),
        renderSummaryCard('Last successful attempt', diagnostics.latestSuccess ? formatDateTime(diagnostics.latestSuccess.runAtMs || diagnostics.latestSuccess.ts) : 'None in recent history', diagnostics.latestSuccess ? 'success' : 'default', diagnostics.latestSuccess?.provider || ''),
        renderSummaryCard('History window', `${diagnostics.totalCount} attempts`, 'default', `${diagnostics.failureCount} failed · ${diagnostics.successCount} successful`),
        renderSummaryCard('Consecutive errors', String(state.consecutiveErrors || 0), (state.consecutiveErrors || 0) > 0 ? 'error' : 'success', `Current status: ${getLastStatus(job)}`),
        renderSummaryCard('Next run', formatNextRun(job), 'default', job.enabled !== false ? 'Enabled' : 'Disabled')
    ].join('');
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
            recentRuns: getCachedCronRuns(job.id)
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
        <div class="cron-meta-header">
            <div class="cron-meta-title">Job metadata</div>
            <div class="cron-meta-window">Showing ${runs.length} recent attempts</div>
        </div>
        <div class="cron-meta-grid">
            ${meta.map(([k, v]) => `
                <div class="cron-meta-item">
                    <div class="cron-meta-label">${escapeHtml(k)}</div>
                    <div class="cron-meta-value${k === 'History URL' || k === 'Job ID' ? ' is-code' : ''}">${escapeHtml(v)}</div>
                </div>`).join('')}
        </div>
        ${payloadPreview ? `
            <div class="cron-meta-payload">
                <div class="cron-meta-label">Payload preview</div>
                <p class="cron-meta-payload-text">${escapeHtml(payloadPreview)}</p>
            </div>` : ''}
    `;

    const errorEl = document.getElementById('cron-detail-error');
    if (diagnostics.latestFailure) {
        errorEl.classList.remove('hidden');
        errorEl.innerHTML = `
            <div class="cron-run-error-label">Latest failed attempt</div>
            <div class="cron-run-at">${escapeHtml(formatDateTime(diagnostics.latestFailure.runAtMs || diagnostics.latestFailure.ts))}</div>
            <div class="cron-run-error-text">${escapeHtml(diagnostics.latestFailure.error || diagnostics.latestFailure.summary || 'No error message recorded')}</div>
            <div class="cron-run-subline">Status: ${escapeHtml(diagnostics.latestFailure.status || '--')} · Duration: ${escapeHtml(String(diagnostics.latestFailure.durationMs || '--'))}ms · Provider: ${escapeHtml(diagnostics.latestFailure.provider || '--')} · Model: ${escapeHtml(diagnostics.latestFailure.model || '--')}</div>
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
        const tone = getRunStatusTone(entry.status);
        const summary = truncateForList(entry.summary || '', 900);
        const error = truncateForList(entry.error || entry.deliveryError || entry.errorMessage || '', 700);
        const usage = entry.usage
            ? Object.entries(entry.usage).map(([k, v]) => `${k}: ${v}`).join(' • ')
            : '';

        return `
            <article class="cron-timeline-item">
                <div class="cron-timeline-rail">
                    <div class="cron-timeline-dot cron-tone-${tone}"></div>
                    ${index < runs.length - 1 ? '<div class="cron-timeline-line"></div>' : ''}
                </div>
                <div class="cron-timeline-card">
                    <div class="cron-run-head">
                        <div>
                            <div class="cron-run-badges">
                                <span class="badge cron-tone-${tone}">${escapeHtml(entry.status || 'unknown')}</span>
                                <span class="badge">${escapeHtml(entry.action || 'run')}</span>
                                ${entry.deliveryStatus ? `<span class="badge">delivery: ${escapeHtml(entry.deliveryStatus)}</span>` : ''}
                            </div>
                            <div class="cron-run-at">${escapeHtml(formatDateTime(entry.runAtMs || entry.ts))}</div>
                            <div class="cron-run-subline">Duration: ${escapeHtml(String(entry.durationMs || '--'))}ms · Next run: ${escapeHtml(formatDateTime(entry.nextRunAtMs))}</div>
                        </div>
                        <div class="cron-run-tech">
                            <div>Provider: ${escapeHtml(entry.provider || '--')}</div>
                            <div>Model: ${escapeHtml(entry.model || '--')}</div>
                            <div>Session: ${escapeHtml(entry.sessionId || '--')}</div>
                        </div>
                    </div>

                    ${error ? `
                        <div class="cron-run-error">
                            <div class="cron-run-error-label">Error details</div>
                            <div class="cron-run-error-text">${escapeHtml(error)}</div>
                        </div>` : ''}

                    ${summary ? `
                        <div class="cron-run-summary">
                            <div class="cron-run-summary-label">Summary / output</div>
                            <div class="cron-run-summary-text">${escapeHtml(summary)}</div>
                        </div>` : ''}

                    <div class="cron-run-grid">
                        <div class="cron-run-cell">
                            <div class="cron-run-cell-label">Session key</div>
                            <div class="cron-run-cell-value is-code">${escapeHtml(entry.sessionKey || '--')}</div>
                        </div>
                        <div class="cron-run-cell">
                            <div class="cron-run-cell-label">Token usage</div>
                            <div class="cron-run-cell-value">${escapeHtml(usage || '--')}</div>
                        </div>
                        <div class="cron-run-cell">
                            <div class="cron-run-cell-label">Delivery</div>
                            <div class="cron-run-cell-value">${escapeHtml(entry.delivered ? 'Delivered' : 'Not delivered')} ${entry.deliveryError ? `• ${escapeHtml(entry.deliveryError)}` : ''}</div>
                        </div>
                    </div>
                </div>
            </article>`;
    }).join('');
}

async function openCronDetailView(jobId, { refresh = false, pushState = true } = {}) {
    const detailView = document.getElementById('cron-detail-view');
    const listView = document.getElementById('cron-list-view');
    const timeline = document.getElementById('cron-detail-timeline');
    if (!detailView || !listView || !timeline) return;

    const detailStartedAt = performance.now();
    const loadToken = ++cronDetailLoadToken;
    activeCronJobId = jobId;
    listView.classList.remove('hidden');
    detailView.classList.remove('hidden');
    setCronDetailDrawerOpen(true);
    renderCronJobs();
    timeline.innerHTML = '<div class="empty-state">Loading run timeline...</div>';
    document.getElementById('cron-detail-summary').innerHTML = '';
    document.getElementById('cron-detail-meta').innerHTML = '<div class="empty-state">Loading job metadata...</div>';
    document.getElementById('cron-detail-error').classList.add('hidden');
    document.getElementById('cron-detail-error').innerHTML = '';

    if (pushState) setCronDetailURL(jobId);

    const initialRunLimit = refresh ? Math.min(CRON_DETAIL_FULL_RUN_LIMIT, 24) : CRON_DETAIL_INITIAL_RUN_LIMIT;
    const initialRunsPromise = fetchCronRuns(jobId, { refresh, limit: initialRunLimit });

    let job = getJobById(jobId);
    let listReadyAt = performance.now();
    if (!job) {
        await loadCronJobs({ silent: true, skipDiagnostics: true });
        if (loadToken !== cronDetailLoadToken) return;
        job = getJobById(jobId);
        listReadyAt = performance.now();
    }
    if (!job) {
        initialRunsPromise.catch(() => {});
        if (loadToken !== cronDetailLoadToken) return;
        activeCronJobId = null;
        setCronDetailDrawerOpen(false);
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
        const runs = await initialRunsPromise;
        if (loadToken !== cronDetailLoadToken) return;
        activeCronTimeline = runs;
        const diagnostics = cronDiagnostics.get(job.id) || summarizeRuns(runs);
        document.getElementById('cron-detail-summary').innerHTML = renderCronDetailSummary(job, diagnostics);
        renderDetailMeta(job, runs, diagnostics);
        renderDetailTimeline(runs);
        console.log(`[Perf][Cron] detail open for ${job.id}: list ready ${Math.round(listReadyAt - detailStartedAt)}ms, initial runs ${Math.round(performance.now() - listReadyAt)}ms`);

        const cachedLimit = getCachedCronRunLimit(job.id);
        if (!refresh && cachedLimit < CRON_DETAIL_FULL_RUN_LIMIT) {
            setTimeout(async () => {
                try {
                    const fullRuns = await fetchCronRuns(job.id, { refresh: true, limit: CRON_DETAIL_FULL_RUN_LIMIT });
                    if (loadToken !== cronDetailLoadToken) return;
                    if (String(activeCronJobId) !== String(job.id) || !cronDetailDrawerOpen) return;

                    activeCronTimeline = fullRuns;
                    const fullDiagnostics = cronDiagnostics.get(job.id) || summarizeRuns(fullRuns);
                    document.getElementById('cron-detail-summary').innerHTML = renderCronDetailSummary(job, fullDiagnostics);
                    renderDetailMeta(job, fullRuns, fullDiagnostics);
                    renderDetailTimeline(fullRuns);
                } catch (backgroundErr) {
                    console.warn('[Cron] Background timeline expansion failed:', backgroundErr?.message || backgroundErr);
                }
            }, 0);
        }
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

window.tuckCronDetailView = function() {
    setCronDetailDrawerOpen(false);
};

window.reopenCronDetailView = function() {
    if (!activeCronJobId) {
        showToast('Select a cron job first', 'warning');
        return;
    }
    openCronDetailView(activeCronJobId, { pushState: false });
};

window.setCronListFilter = function(filter) {
    cronListFilter = filter || 'all';
    updateCronFilterChips();
    renderCronJobs();
};

window.toggleCronAdvancedControls = function() {
    cronAdvancedControlsOpen = !cronAdvancedControlsOpen;
    updateCronAdvancedControlsUI();
};

window.resetCronListControls = function() {
    cronListFilter = 'all';
    cronListQuery = '';
    cronAgentFilter = 'all';
    cronEnabledFilter = 'all';
    cronActivityFilter = 'all';
    cronSortBy = 'nextRun';
    cronSortDirection = 'asc';
    cronAdvancedControlsOpen = false;

    const searchInput = document.getElementById('cron-search-input');
    if (searchInput) searchInput.value = '';
    const enabledFilter = document.getElementById('cron-enabled-filter');
    if (enabledFilter) enabledFilter.value = 'all';
    const activityFilter = document.getElementById('cron-activity-filter');
    if (activityFilter) activityFilter.value = 'all';
    const sortBySelect = document.getElementById('cron-sort-by');
    if (sortBySelect) sortBySelect.value = 'nextRun';
    populateCronAgentFilterOptions();

    updateCronFilterChips();
    updateCronSortDirectionButton();
    updateCronAdvancedControlsUI();
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
    if (!container) return cronJobs;

    if (cronListLoadPromise) {
        return cronListLoadPromise;
    }

    const startedAt = performance.now();

    if (!silent && !cronJobs.length) {
        container.innerHTML = '<div class="empty-state">Loading cron jobs...</div>';
    }

    if (!gateway || !gateway.isConnected()) {
        if (!cronJobs.length) {
            container.innerHTML = '<div class="empty-state">Connect to gateway to manage cron jobs</div>';
        }
        return cronJobs;
    }

    cronListLoadPromise = (async () => {
        try {
            const result = await gateway._request('cron.list', { includeDisabled: true }, CRON_REQUEST_TIMEOUT_MS);
            cronJobs = Array.isArray(result?.jobs) ? result.jobs : (Array.isArray(result) ? result : []);
            cronLastLoadedAt = Date.now();
            writeCronCache(cronJobs);
            persistCronNameMap();
            populateCronAgentFilterOptions();
            if (activeCronJobId && !getJobById(activeCronJobId)) {
                activeCronJobId = null;
                renderEmptyDetailState('The previously selected job is no longer available.');
                setCronDetailDrawerOpen(false);
            }
            renderCronJobs();
            console.log(`[Perf][Cron] cron.list + first render: ${Math.round(performance.now() - startedAt)}ms for ${cronJobs.length} jobs`);
            if (!skipDiagnostics) {
                console.log('[Perf][Cron] Skipping history warm-up on initial page load');
            }
            return cronJobs;
        } catch (e) {
            console.warn('[Cron] Failed to fetch jobs:', e.message);
            if (!cronJobs.length) {
                container.innerHTML = `<div class="empty-state">Could not load cron jobs: ${escapeHtml(e.message || 'Unknown error')}</div>`;
            } else if (!silent && typeof showToast === 'function') {
                showToast('Using cached cron jobs while refresh retries', 'warning');
            }
            return cronJobs;
        } finally {
            cronListLoadPromise = null;
        }
    })();

    return cronListLoadPromise;
}

function renderCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    updateCronFilterChips();

    if (cronJobs.length === 0) {
        updateCronListMeta(0, 0);
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
        const statusTone = getRunStatusTone(lastStatus);
        const nextRun = formatNextRun(job);
        const lastRun = formatLastRun(job);
        const scheduleText = formatCronSchedule(job.schedule || job.cron);
        const payloadPreview = truncateForList(getPayloadSummary(job) || job.description || 'No summary available');
        const state = getCronState(job);
        const diagnostics = cronDiagnostics.get(job.id);
        const latestFailure = diagnostics?.latestFailure;
        const latestFailureMessage = latestFailure?.error || latestFailure?.summary || getLastError(job) || '';
        const accent = getCronJobAccentColor(job);
        const jobId = String(job.id || idx);
        const jobIdJs = jobId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const isActive = String(activeCronJobId) === jobId;
        const failureCount = diagnostics?.failureCount || 0;
        const successCount = diagnostics?.successCount || 0;
        const ownerAgent = getCronJobOwnerAgent(job);
        const activeClass = isActive ? ' is-active' : '';
        const statusToneClass = statusTone !== 'neutral' ? ` cron-tone-${statusTone}` : '';

        return `
        <article class="cron-job-card${activeClass}" style="--cron-accent: ${accent};" role="button" tabindex="0" onclick="openCronDetailView('${jobIdJs}')" onkeydown="if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); openCronDetailView('${jobIdJs}'); }">
            <div class="cron-job-header">
                <div class="cron-job-main">
                    <div class="cron-job-title-row">
                        <span class="cron-job-status-dot"></span>
                        <span class="cron-job-title">${escapeHtml(job.name || job.id || 'Unnamed Job')}</span>
                        ${ownerAgent ? `<span class="badge cron-job-badge">${escapeHtml(ownerAgent)}</span>` : ''}
                        ${!enabled ? '<span class="badge cron-job-badge">Disabled</span>' : ''}
                        ${lastStatus && lastStatus !== '--' ? `<span class="badge cron-job-badge${statusToneClass}">${escapeHtml(lastStatus)}</span>` : ''}
                        ${job.sessionTarget ? `<span class="badge cron-job-badge">${escapeHtml(job.sessionTarget)}</span>` : ''}
                    </div>
                    <div class="cron-job-id">${escapeHtml(job.id || '--')}</div>
                    <p class="cron-job-preview">${escapeHtml(payloadPreview)}</p>
                </div>
                <div class="cron-job-actions" onclick="event.stopPropagation();">
                    <button onclick="event.stopPropagation(); toggleCronJob('${jobIdJs}', ${!enabled});" class="cron-job-action-btn" title="${enabled ? 'Disable job' : 'Enable job'}">${enabled ? 'Pause' : 'Enable'}</button>
                    <button onclick="event.stopPropagation(); runCronJob('${jobIdJs}');" class="cron-job-action-btn cron-job-action-run" title="Run now">Run now</button>
                </div>
            </div>

            <div class="cron-job-divider"></div>

            <div class="cron-job-kpis">
                <div class="cron-job-kpi">
                    <div class="cron-job-kpi-label">Next run</div>
                    <div class="cron-job-kpi-value">${escapeHtml(nextRun)}</div>
                </div>
                <div class="cron-job-kpi">
                    <div class="cron-job-kpi-label">Last result</div>
                    <div class="cron-job-kpi-value">${escapeHtml(lastRun)}</div>
                </div>
            </div>

            <div class="cron-job-divider"></div>

            <div class="cron-job-footer">
                <code class="cron-schedule-code">${escapeHtml(scheduleText)}</code>
                ${state.consecutiveErrors ? `<span class="cron-job-consecutive-errors">${escapeHtml(String(state.consecutiveErrors))} consecutive errors</span>` : ''}
                ${(failureCount || successCount) ? `<span>${failureCount} failed · ${successCount} successful</span>` : ''}
            </div>

            ${latestFailureMessage && getCronJobStatusTone(job) === 'error' ? `
                <div class="cron-job-latest-failure">
                    <div class="cron-job-latest-failure-label">Latest failure</div>
                    <div class="cron-job-latest-failure-text">${escapeHtml(latestFailureMessage)}</div>
                </div>` : ''}
        </article>`;
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
        if (activeCronJobId === jobId && cronDetailDrawerOpen) {
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

window._cronJobs = Object.assign(window._cronJobs || {}, {
    ensureLoaded: async function (options = {}) {
        return loadCronJobs(options);
    },
    getJobs: function () {
        return Array.isArray(cronJobs) ? cronJobs.slice() : [];
    },
    getOwnerAgent: function (job) {
        return getCronJobOwnerAgent(job);
    },
    getLastStatus: function (job) {
        return getLastStatus(job);
    },
    getPayloadSummary: function (job) {
        return getPayloadSummary(job);
    },
    formatSchedule: function (job) {
        return formatCronSchedule(job?.schedule || job?.cron);
    },
    formatNextRun: function (job) {
        return formatNextRun(job);
    },
    formatLastRun: function (job) {
        return formatLastRun(job);
    },
    isConnected: function () {
        return Boolean(gateway && typeof gateway.isConnected === 'function' && gateway.isConnected());
    },
    openPage: function () {
        if (typeof showPage === 'function') showPage('cron');
    },
    openJob: function (jobId) {
        const safeJobId = String(jobId || '').trim();
        if (!safeJobId) return;

        const openDetail = (attempts = 0) => {
            const detailView = document.getElementById('cron-detail-view');
            if (detailView && typeof openCronDetailView === 'function') {
                openCronDetailView(safeJobId, { pushState: true });
                return;
            }
            if (attempts < 8) {
                setTimeout(() => openDetail(attempts + 1), 80);
            }
        };

        if (typeof showPage === 'function') showPage('cron');
        setTimeout(() => openDetail(), 80);
    }
});

window.addEventListener('popstate', () => {
    if (window.location.pathname === '/cron') {
        syncCronViewFromURL();
    }
});
