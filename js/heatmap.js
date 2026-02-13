// js/heatmap.js — Activity Heatmap widget (GitHub-style, 30 days)

function buildHeatmapData() {
    const sessions = Array.isArray(availableSessions) ? availableSessions : [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Bucket: key = "YYYY-MM-DD-HH" → count
    const buckets = {};
    sessions.forEach(s => {
        if (!s.updatedAt) return;
        const d = new Date(s.updatedAt);
        if (d < thirtyDaysAgo) return;
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}`;
        buckets[key] = (buckets[key] || 0) + 1;
    });

    return buckets;
}

function renderHeatmap() {
    const container = document.getElementById('heatmap-container');
    if (!container) return;

    const buckets = buildHeatmapData();
    const now = new Date();
    
    // Build grid: columns = days (last 30), rows = hours (0-23)
    // Simpler layout: rows = days, columns = hours (fits better)
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        days.push(d);
    }

    // Find max for color scaling
    const values = Object.values(buckets);
    const maxCount = Math.max(1, ...values);

    // Day labels (abbreviated)
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    let html = '<div class="heatmap-grid">';
    
    // Hour labels row
    html += '<div class="heatmap-row heatmap-labels"><span class="heatmap-day-label"></span>';
    for (let h = 0; h < 24; h += 3) {
        html += `<span class="heatmap-hour-label" style="grid-column: span 3;">${h}:00</span>`;
    }
    html += '</div>';

    days.forEach(day => {
        const dateStr = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
        const isToday = day.toDateString() === now.toDateString();
        const dayLabel = dayNames[day.getDay()];
        const shortDate = `${day.getMonth()+1}/${day.getDate()}`;
        
        html += `<div class="heatmap-row">`;
        html += `<span class="heatmap-day-label" title="${dateStr}">${isToday ? '▸' : ''}${shortDate}</span>`;
        
        for (let h = 0; h < 24; h++) {
            const key = `${dateStr}-${String(h).padStart(2,'0')}`;
            const count = buckets[key] || 0;
            const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));
            const tooltip = `${dayLabel} ${shortDate} ${h}:00 — ${count} event${count !== 1 ? 's' : ''}`;
            html += `<span class="heatmap-cell heatmap-level-${level}" title="${tooltip}"></span>`;
        }
        html += '</div>';
    });

    html += '</div>';

    // Legend
    html += '<div class="heatmap-legend"><span style="color:var(--text-muted);font-size:10px;">Less</span>';
    for (let i = 0; i <= 4; i++) {
        html += `<span class="heatmap-cell heatmap-level-${i}" style="display:inline-block;"></span>`;
    }
    html += '<span style="color:var(--text-muted);font-size:10px;">More</span></div>';

    container.innerHTML = html;
}

// Refresh with session data
setInterval(() => {
    if (document.getElementById('page-dashboard')?.classList.contains('active')) {
        renderHeatmap();
    }
}, 15000);

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderHeatmap, 2500);
});
