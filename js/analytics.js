// js/analytics.js — Session Analytics widget

let analyticsInterval = null;

function initAnalytics() {
    loadAnalyticsData();
    if (analyticsInterval) clearInterval(analyticsInterval);
    analyticsInterval = setInterval(loadAnalyticsData, 60000);
}

async function loadAnalyticsData() {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                </svg>
                <div class="empty-state-title">No Analytics Data</div>
                <div class="empty-state-desc">Connect to gateway to view session analytics</div>
            </div>
        `;
        return;
    }

    try {
        const result = await gateway._request('sessions.list', { includeGlobal: true });
        const sessions = result?.sessions || [];
        renderAnalytics(sessions);
    } catch (e) {
        console.warn('[Analytics] Failed:', e.message);
    }
}

function renderAnalytics(sessions) {
    const container = document.getElementById('analytics-content');
    if (!container) return;

    // Messages per agent (channel breakdown)
    const agentMessages = {};
    const dayBuckets = {};
    const now = Date.now();

    for (const s of sessions) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? (window.resolveAgentId ? window.resolveAgentId(match[1]) : match[1]) : 'main';
        const tokens = s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0);
        if (!agentMessages[agentId]) agentMessages[agentId] = 0;
        agentMessages[agentId] += tokens > 0 ? 1 : 0;

        // Bucket by day (last 7 days)
        if (s.updatedAt) {
            const d = new Date(s.updatedAt);
            const dayKey = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayMs = d.getTime();
            if (now - dayMs < 7 * 86400000) {
                if (!dayBuckets[dayKey]) dayBuckets[dayKey] = 0;
                dayBuckets[dayKey]++;
            }
        }
    }

    // Most active sessions
    const activeSessions = [...sessions]
        .filter(s => s.updatedAt)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5);

    const maxAgent = Math.max(...Object.values(agentMessages), 1);
    const maxDay = Math.max(...Object.values(dayBuckets), 1);

    container.innerHTML = `
        <div style="margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Sessions by Agent</div>
            ${Object.entries(agentMessages).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => {
        const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${id}`).trim() || '#888';
        const pct = (count / maxAgent * 100);
        return `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                    <span style="width: 40px; font-size: 10px; color: ${color}; font-weight: 600; text-align: right;">${id.toUpperCase()}</span>
                    <div style="flex: 1; height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 3px;"></div>
                    </div>
                    <span style="width: 24px; font-size: 10px; color: var(--text-muted);">${count}</span>
                </div>`;
    }).join('')}
        </div>
        <div style="margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Activity (7 days)</div>
            <div style="display: flex; align-items: flex-end; gap: 4px; height: 40px;">
                ${Object.entries(dayBuckets).slice(-7).map(([day, count]) => {
        const h = Math.max(4, (count / maxDay) * 36);
        return `<div style="flex: 1; text-align: center;">
                        <div style="height: ${h}px; background: var(--brand-red); border-radius: 2px; margin: 0 auto; width: 80%;"></div>
                        <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">${day}</div>
                    </div>`;
    }).join('')}
            </div>
        </div>
        <div>
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">Most Active</div>
            ${activeSessions.map(s => {
        const name = s.displayName || s.key?.replace(/^agent:[^:]+:/, '') || 'unnamed';
        const ago = s.updatedAt ? timeAgo(new Date(s.updatedAt).getTime()) : '';
        return `<div style="font-size: 11px; padding: 2px 0; display: flex; justify-content: space-between;">
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</span>
                    <span style="color: var(--text-muted); flex-shrink: 0; margin-left: 8px;">${ago}</span>
                </div>`;
    }).join('')}
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAnalytics, 3500);
});
