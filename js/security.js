// js/security.js — Security & Access Log page

let securityInterval = null;

function initSecurityPage() {
    loadSecurityData();
    if (securityInterval) clearInterval(securityInterval);
    securityInterval = setInterval(loadSecurityData, 30000);
}

async function loadSecurityData() {
    if (!gateway || !gateway.isConnected()) {
        renderSecurityDisconnected();
        return;
    }

    // Load exec approvals
    try {
        const approvals = await gateway._request('exec.approvals.list', {});
        renderExecApprovals(approvals?.items || approvals || []);
    } catch (e) {
        renderExecApprovals([]);
    }

    // Load connection events
    try {
        const events = await gateway._request('audit.events', { limit: 50 });
        renderConnectionLog(events?.events || events || []);
    } catch (e) {
        renderConnectionLog([]);
    }

    // Load devices if available
    try {
        const devices = await gateway._request('devices.list', {});
        renderDevices(devices?.devices || devices || []);
    } catch (e) {
        renderDevices([]);
    }
}

function renderSecurityDisconnected() {
    const el = document.getElementById('exec-approvals');
    if (el) el.innerHTML = '<div class="empty-state">Connect to gateway</div>';
    const cl = document.getElementById('connection-log');
    if (cl) cl.innerHTML = '';
}

function renderExecApprovals(items) {
    const container = document.getElementById('exec-approvals');
    if (!container) return;

    if (items.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 16px;">No pending approvals</div>';
        return;
    }

    container.innerHTML = items.map(item => {
        const status = item.status || 'pending';
        const dotClass = status === 'approved' ? 'success' : status === 'denied' ? 'error' : 'warning';
        const time = item.createdAt ? new Date(item.createdAt).toLocaleString() : '';
        return `
        <div style="background: var(--surface-1); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 10px; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="status-dot ${dotClass}"></span>
                        <span style="font-weight: 600; font-size: 13px;">${escapeHtml(item.command || item.action || 'Unknown')}</span>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        ${item.agent ? `Agent: ${escapeHtml(item.agent)} · ` : ''}${time}
                    </div>
                    ${item.reason ? `<div style="font-size: 11px; color: var(--text-muted);">Reason: ${escapeHtml(item.reason)}</div>` : ''}
                </div>
                ${status === 'pending' ? `
                <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button onclick="approveExec('${item.id}')" class="btn btn-primary" style="padding: 4px 10px; font-size: 11px;">Approve</button>
                    <button onclick="denyExec('${item.id}')" class="btn btn-ghost" style="padding: 4px 10px; font-size: 11px; color: var(--error);">Deny</button>
                </div>` : ''}
            </div>
        </div>`;
    }).join('');
}

window.approveExec = async function(id) {
    try {
        await gateway._request('exec.approvals.approve', { id });
        showToast('Approved', 'success');
        loadSecurityData();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

window.denyExec = async function(id) {
    try {
        await gateway._request('exec.approvals.deny', { id });
        showToast('Denied', 'success');
        loadSecurityData();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
};

function renderConnectionLog(events) {
    const container = document.getElementById('connection-log');
    if (!container) return;

    if (events.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No events recorded</div>';
        return;
    }

    container.innerHTML = events.slice(0, 30).map(ev => {
        const type = ev.type || ev.event || 'event';
        const icon = type.includes('connect') ? '🔗' : type.includes('disconnect') ? '🔌' : type.includes('error') ? '⚠️' : '📋';
        const time = ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '';
        return `
        <div style="font-size: 11px; padding: 4px 0; display: flex; gap: 6px; border-bottom: 1px solid var(--border-default);">
            <span>${icon}</span>
            <span style="flex: 1;">${escapeHtml(ev.message || ev.description || type)}</span>
            <span style="color: var(--text-muted); flex-shrink: 0;">${time}</span>
        </div>`;
    }).join('');
}

function renderDevices(devices) {
    const container = document.getElementById('devices-list');
    if (!container) return;

    if (devices.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 8px;">No devices</div>';
        return;
    }

    container.innerHTML = devices.map(d => {
        return `
        <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border-default);">
            <span style="font-size: 16px;">💻</span>
            <div style="flex: 1;">
                <div style="font-size: 13px; font-weight: 500;">${escapeHtml(d.name || d.id || 'Unknown')}</div>
                <div style="font-size: 10px; color: var(--text-muted);">${d.lastSeen ? new Date(d.lastSeen).toLocaleString() : ''}</div>
            </div>
            <span class="status-dot ${d.online ? 'success' : 'idle'}"></span>
        </div>`;
    }).join('');
}
