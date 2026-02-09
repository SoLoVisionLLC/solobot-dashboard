// js/cron.js — Cron Jobs Manager page

let cronJobs = [];
let cronInterval = null;

function initCronPage() {
    loadCronJobs();
    if (cronInterval) clearInterval(cronInterval);
    cronInterval = setInterval(loadCronJobs, 30000);
}

async function loadCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div class="empty-state">Connect to gateway to manage cron jobs</div>';
        return;
    }

    try {
        const result = await gateway._request('cron.list', {});
        cronJobs = result?.jobs || result || [];
        renderCronJobs();
    } catch (e) {
        console.warn('[Cron] Failed to fetch jobs:', e.message);
        container.innerHTML = '<div class="empty-state">Could not load cron jobs. The cron RPC may not be available.</div>';
    }
}

function renderCronJobs() {
    const container = document.getElementById('cron-jobs-list');
    if (!container) return;

    if (cronJobs.length === 0) {
        container.innerHTML = '<div class="empty-state">No cron jobs configured</div>';
        return;
    }

    container.innerHTML = cronJobs.map((job, idx) => {
        const enabled = job.enabled !== false;
        const lastStatus = job.lastRunStatus || job.lastStatus || '--';
        const statusClass = lastStatus === 'success' ? 'success' : lastStatus === 'error' ? 'error' : '';
        const nextRun = job.nextRun ? new Date(job.nextRun).toLocaleString() : '--';
        const lastRun = job.lastRun ? timeAgo(new Date(job.lastRun).getTime()) : 'Never';

        return `
        <div class="cron-job-card" style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: 600; font-size: 14px;">${escapeHtml(job.name || job.id || 'Unnamed Job')}</span>
                        ${!enabled ? '<span class="badge" style="background: var(--surface-2); font-size: 10px;">Disabled</span>' : ''}
                        ${statusClass ? `<span class="badge badge-${statusClass}" style="font-size: 10px;">${lastStatus}</span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
                        <code style="background: var(--surface-2); padding: 1px 4px; border-radius: 3px; font-size: 11px;">${escapeHtml(job.schedule || job.cron || '--')}</code>
                        <span style="margin-left: 8px;">Next: ${nextRun}</span>
                        <span style="margin-left: 8px;">Last: ${lastRun}</span>
                    </div>
                    ${job.description ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${escapeHtml(job.description)}</div>` : ''}
                </div>
                <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                    <button onclick="toggleCronJob('${job.id || idx}', ${!enabled})" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="${enabled ? 'Disable' : 'Enable'}">
                        ${enabled ? '⏸' : '▶'}
                    </button>
                    <button onclick="runCronJob('${job.id || idx}')" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="Run Now">
                        🚀
                    </button>
                    <button onclick="showCronHistory('${job.id || idx}')" class="btn btn-ghost" style="padding: 4px 8px; font-size: 11px;" title="History">
                        📋
                    </button>
                </div>
            </div>
            <div id="cron-history-${job.id || idx}" class="cron-history hidden" style="margin-top: 8px; border-top: 1px solid var(--border-default); padding-top: 8px;"></div>
        </div>`;
    }).join('');
}

async function toggleCronJob(jobId, enable) {
    try {
        await gateway._request('cron.toggle', { id: jobId, enabled: enable });
        showToast(`Job ${enable ? 'enabled' : 'disabled'}`, 'success');
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function runCronJob(jobId) {
    try {
        await gateway._request('cron.run', { id: jobId });
        showToast('Job triggered', 'success');
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

async function showCronHistory(jobId) {
    const el = document.getElementById(`cron-history-${jobId}`);
    if (!el) return;
    if (!el.classList.contains('hidden')) {
        el.classList.add('hidden');
        return;
    }

    el.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">Loading...</div>';
    el.classList.remove('hidden');

    try {
        const result = await gateway._request('cron.runs', { id: jobId, limit: 10 });
        const runs = result?.runs || [];
        if (runs.length === 0) {
            el.innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">No run history</div>';
            return;
        }
        el.innerHTML = runs.map(r => {
            const status = r.status || 'unknown';
            const time = r.startedAt ? new Date(r.startedAt).toLocaleString() : '--';
            const cls = status === 'success' ? 'color: var(--success)' : status === 'error' ? 'color: var(--error)' : '';
            return `<div style="font-size: 11px; padding: 2px 0;"><span style="${cls}">${status}</span> — ${time}${r.duration ? ` (${r.duration}ms)` : ''}</div>`;
        }).join('');
    } catch (e) {
        el.innerHTML = '<div style="font-size: 11px; color: var(--error);">Failed to load history</div>';
    }
}

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
    const schedule = document.getElementById('cron-new-schedule')?.value?.trim();
    const command = document.getElementById('cron-new-command')?.value?.trim();

    if (!name || !schedule) {
        showToast('Name and schedule are required', 'warning');
        return;
    }

    try {
        await gateway._request('cron.add', { name, schedule, command });
        showToast('Cron job added', 'success');
        closeAddCronModal();
        loadCronJobs();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};
