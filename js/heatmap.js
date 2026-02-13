// js/heatmap.js — Activity heatmap widget (GitHub-style, last 30 days)

function renderActivityHeatmap() {
  const container = document.getElementById('heatmap-container');
  if (!container) return;

  const sessions = window.availableSessions || [];
  if (sessions.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 12px;">No activity data</div>';
    return;
  }

  // Build hourly buckets for last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const buckets = {}; // "YYYY-MM-DD-HH" -> count

  sessions.forEach(s => {
    const ts = s.updatedAt || s.createdAt;
    if (!ts) return;
    const d = new Date(ts);
    if (d < thirtyDaysAgo) return;
    const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}`;
    buckets[key] = (buckets[key] || 0) + 1;
  });

  // Also count from chat messages if available
  const messages = state?.chat?.messages || [];
  messages.forEach(m => {
    if (!m.time) return;
    const d = new Date(m.time);
    if (d < thirtyDaysAgo) return;
    const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}`;
    buckets[key] = (buckets[key] || 0) + 1;
  });

  const maxCount = Math.max(1, ...Object.values(buckets));

  // Build grid: columns = days (last 30), rows = hours (0-23 grouped into 6 bands)
  // Simplified: show days as columns, 4 time bands as rows
  const bands = [
    { label: 'Night', hours: [0,1,2,3,4,5] },
    { label: 'Morning', hours: [6,7,8,9,10,11] },
    { label: 'Afternoon', hours: [12,13,14,15,16,17] },
    { label: 'Evening', hours: [18,19,20,21,22,23] }
  ];

  // Generate last 30 days
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    days.push(d);
  }

  let html = '<div class="heatmap-grid">';

  // Row labels
  html += '<div class="heatmap-labels">';
  bands.forEach(b => {
    html += `<div class="heatmap-label">${b.label}</div>`;
  });
  html += '</div>';

  // Cells
  html += '<div class="heatmap-cells">';
  bands.forEach(band => {
    html += '<div class="heatmap-row">';
    days.forEach(day => {
      let count = 0;
      band.hours.forEach(h => {
        const key = `${day.getFullYear()}-${pad(day.getMonth()+1)}-${pad(day.getDate())}-${pad(h)}`;
        count += (buckets[key] || 0);
      });
      const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));
      const dateStr = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const title = `${dateStr} ${band.label}: ${count} events`;
      html += `<div class="heatmap-cell heatmap-level-${level}" title="${title}"></div>`;
    });
    html += '</div>';
  });
  html += '</div>';

  // Day labels (show every 5th)
  html += '<div class="heatmap-day-labels">';
  html += '<div class="heatmap-label"></div>'; // spacer for row labels
  days.forEach((day, i) => {
    if (i % 5 === 0) {
      const label = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      html += `<div class="heatmap-day-label" style="grid-column: ${i + 1}">${label}</div>`;
    }
  });
  html += '</div>';

  html += '</div>';

  // Legend
  html += `<div class="heatmap-legend">
    <span style="color: var(--text-muted); font-size: 10px;">Less</span>
    <div class="heatmap-cell level-0" style="width:10px;height:10px"></div>
    <div class="heatmap-cell level-1" style="width:10px;height:10px"></div>
    <div class="heatmap-cell level-2" style="width:10px;height:10px"></div>
    <div class="heatmap-cell level-3" style="width:10px;height:10px"></div>
    <div class="heatmap-cell level-4" style="width:10px;height:10px"></div>
    <span style="color: var(--text-muted); font-size: 10px;">More</span>
  </div>`;

  container.innerHTML = html;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// Auto-init and periodic refresh
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(renderActivityHeatmap, 3000);
  setInterval(renderActivityHeatmap, 30000);
});
