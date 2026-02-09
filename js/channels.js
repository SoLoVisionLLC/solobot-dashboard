// js/channels.js — Channel Status & Health widget

let channelStatusInterval = null;

function initChannelStatus() {
    loadChannelStatuses();
    if (channelStatusInterval) clearInterval(channelStatusInterval);
    channelStatusInterval = setInterval(loadChannelStatuses, 30000);
}

async function loadChannelStatuses() {
    const container = document.getElementById('channel-status-list');
    if (!container) return;

    if (!gateway || !gateway.isConnected()) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">Connect to gateway</div>';
        return;
    }

    try {
        const result = await gateway._request('channels.status', {});
        renderChannelStatuses(result?.channels || result || []);
    } catch (e) {
        // Fallback: show known channels as unknown
        renderChannelStatuses([
            { name: 'WhatsApp', status: 'unknown' },
            { name: 'Telegram', status: 'unknown' },
            { name: 'Discord', status: 'unknown' },
            { name: 'Signal', status: 'unknown' },
            { name: 'Webchat', status: 'connected' }
        ]);
    }
}

function renderChannelStatuses(channels) {
    const container = document.getElementById('channel-status-list');
    if (!container) return;

    const icons = {
        whatsapp: '📱', telegram: '✈️', discord: '🎮', signal: '🔒',
        webchat: '💬', email: '📧', sms: '📲'
    };

    // If it's an object with channel names as keys
    let channelList = Array.isArray(channels) ? channels : Object.entries(channels).map(([name, data]) => ({
        name, ...(typeof data === 'object' ? data : { status: data })
    }));

    if (channelList.length === 0) {
        channelList = [
            { name: 'WhatsApp', status: 'unknown' },
            { name: 'Telegram', status: 'unknown' },
            { name: 'Discord', status: 'unknown' },
            { name: 'Signal', status: 'unknown' },
            { name: 'Webchat', status: 'connected' }
        ];
    }

    container.innerHTML = channelList.map(ch => {
        const name = ch.name || ch.channel || 'Unknown';
        const status = (ch.status || ch.state || 'unknown').toLowerCase();
        const icon = icons[name.toLowerCase()] || '📡';
        const dotClass = status === 'connected' || status === 'online' || status === 'ready' ? 'success'
            : status === 'error' || status === 'disconnected' || status === 'failed' ? 'error'
            : 'warning';
        const lastMsg = ch.lastMessageAt ? timeAgo(new Date(ch.lastMessageAt).getTime()) : '';

        return `
        <div class="channel-status-row">
            <span style="font-size: 16px;">${icon}</span>
            <div style="flex: 1; min-width: 0;">
                <span style="font-weight: 500; font-size: 13px;">${escapeHtml(name)}</span>
                ${lastMsg ? `<span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">${lastMsg}</span>` : ''}
            </div>
            <span class="status-dot ${dotClass}"></span>
        </div>`;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initChannelStatus, 2500);
});
