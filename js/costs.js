// js/costs.js — Cost & Usage Tracker widget

let costsInterval = null;

function initCostTracker() {
    loadCostData();
    if (costsInterval) clearInterval(costsInterval);
    costsInterval = setInterval(loadCostData, 60000);
}

async function loadCostData() {
    const container = document.getElementById('cost-tracker-content');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div class="empty-state-title">No Cost Data</div>
                <div class="empty-state-desc">Connect to gateway to view usage & costs</div>
            </div>
        `;
        return;
    }

    try {
        const result = await gateway._request('sessions.list', { includeGlobal: true });
        const sessions = result?.sessions || [];

        // Also try to get status for model info
        let statusInfo = null;
        try {
            statusInfo = await gateway._request('status', {});
        } catch (e) { /* optional */ }

        renderCostData(sessions, statusInfo);
    } catch (e) {
        console.warn('[Costs] Failed:', e.message);
    }
}

function renderCostData(sessions, statusInfo) {
    const container = document.getElementById('cost-tracker-content');
    if (!container) return;

    // Aggregate tokens by agent
    const agentTokens = {};
    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;

    for (const s of sessions) {
        const match = s.key?.match(/^agent:([^:]+):/);
        const agentId = match ? match[1] : 'main';
        if (!agentTokens[agentId]) agentTokens[agentId] = { input: 0, output: 0, total: 0 };

        const input = s.inputTokens || 0;
        const output = s.outputTokens || 0;
        const total = s.totalTokens || (input + output);

        agentTokens[agentId].input += input;
        agentTokens[agentId].output += output;
        agentTokens[agentId].total += total;
        totalTokens += total;
        totalInput += input;
        totalOutput += output;
    }

    // Rough cost estimate ($3/1M input, $15/1M output for Claude)
    const estCost = ((totalInput * 3 + totalOutput * 15) / 1000000).toFixed(2);

    const sorted = Object.entries(agentTokens).sort((a, b) => b[1].total - a[1].total);
    const maxTokens = sorted.length > 0 ? sorted[0][1].total : 1;

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
            <div>
                <span style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${formatTokens(totalTokens)}</span>
                <span style="font-size: 11px; color: var(--text-muted);"> tokens</span>
            </div>
            <div style="text-align: right;">
                <span style="font-size: 16px; font-weight: 600; color: var(--success);">~$${estCost}</span>
                <div style="font-size: 10px; color: var(--text-muted);">est. cost</div>
            </div>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 10px; font-size: 11px; color: var(--text-muted);">
            <span>↗ In: ${formatTokens(totalInput)}</span>
            <span>↙ Out: ${formatTokens(totalOutput)}</span>
            <span>📊 ${sessions.length} sessions</span>
        </div>
        <div style="space-y: 4px;">
            ${sorted.slice(0, 6).map(([id, data]) => {
                const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${id}`).trim() || '#888';
                const pct = maxTokens > 0 ? (data.total / maxTokens * 100) : 0;
                const label = (typeof getAgentLabel === 'function') ? getAgentLabel(id) : id.toUpperCase();
                return `
                <div style="margin-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                        <span style="color: ${color}; font-weight: 600;">${label}</span>
                        <span style="color: var(--text-muted);">${formatTokens(data.total)}</span>
                    </div>
                    <div style="height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden;">
                        <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 2px;"></div>
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCostTracker, 3000);
});
