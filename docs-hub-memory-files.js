// docs-hub-memory-files.js - Live memory files from OpenClaw workspace
// Version 2.0.0 - Added version history and bot-update badges

// Local escapeHtml function
function escapeHtmlLocal(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Cache for memory files list
let memoryFilesCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Current file being edited
window.currentMemoryFile = null;

// Categorize files based on name
function categorizeFile(filename) {
    const coreDocs = ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md', 'IDENTITY.md'];
    const guideDocs = ['SOLOBOT-GUIDE.md', 'LESSONS-LEARNED.md', 'DEPLOY_INSTRUCTIONS.md'];
    
    if (filename.startsWith('memory/') || filename.match(/^\d{4}-\d{2}-\d{2}\.md$/)) {
        return 'Daily Logs';
    } else if (coreDocs.includes(filename)) {
        return 'Core Identity';
    } else if (guideDocs.includes(filename)) {
        return 'Guides & Reference';
    } else {
        return 'Other Documents';
    }
}

// Get file description based on name
function getFileDescription(filename) {
    const descriptions = {
        'SOUL.md': 'Who SoLoBot is, core beliefs, personality, and operational guidelines',
        'USER.md': 'Information about SoLo (Jeremy Smith) - goals, work style, preferences',
        'AGENTS.md': 'Workspace guidelines, memory management rules, and procedures',
        'MEMORY.md': 'Long-term curated memories, decisions, and important context',
        'TOOLS.md': 'Tool configurations, credentials, and technical setup notes',
        'HEARTBEAT.md': 'Proactive check schedule, task management, and maintenance',
        'IDENTITY.md': 'Bot identity summary and avatar information',
        'SOLOBOT-GUIDE.md': 'Comprehensive guide for working with SoLoBot',
        'LESSONS-LEARNED.md': 'Documented mistakes and lessons for future reference',
        'RUNNING-CONTEXT.md': 'Current work context and active project status'
    };
    
    if (filename.startsWith('memory/')) {
        const date = filename.replace('memory/', '').replace('.md', '');
        return `Daily activity log for ${date}`;
    }
    
    return descriptions[filename] || 'Documentation file';
}

// Fetch memory files list from server
async function fetchMemoryFiles() {
    const now = Date.now();
    if (memoryFilesCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
        return memoryFilesCache;
    }
    
    try {
        const response = await fetch('/api/memory');
        const data = await response.json();
        
        if (data.error) {
            console.error('Memory API error:', data.error);
            return [];
        }
        
        memoryFilesCache = data.files.map(file => ({
            ...file,
            category: file.category || categorizeFile(file.name),
            description: getFileDescription(file.name)
        }));
        lastFetchTime = now;
        
        return memoryFilesCache;
    } catch (e) {
        console.error('Failed to fetch memory files:', e);
        return [];
    }
}

// Render memory files in Docs Hub (or Memory page)
async function renderMemoryFiles(filter = '') {
    let container = document.getElementById('memory-files-grid') || document.getElementById('docs-grid');
    if (!container) return;
    
    container.innerHTML = '<div class="loading-state">Loading memory files...</div>';
    
    const files = await fetchMemoryFiles();
    
    if (files.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>⚠️ Memory files not available</p>
                <p style="font-size: 12px; margin-top: 8px;">
                    The OpenClaw workspace may not be mounted. Check Coolify volume configuration.
                </p>
            </div>
        `;
        return;
    }
    
    // Filter files
    const filtered = files.filter(file =>
        file.name.toLowerCase().includes(filter.toLowerCase()) ||
        file.description.toLowerCase().includes(filter.toLowerCase()) ||
        file.category.toLowerCase().includes(filter.toLowerCase())
    );
    
    // Group by category
    const grouped = filtered.reduce((groups, file) => {
        const category = file.category;
        if (!groups[category]) groups[category] = [];
        groups[category].push(file);
        return groups;
    }, {});
    
    // Sort categories
    const categoryOrder = ['Core Identity', 'Guides & Reference', 'Daily Logs', 'Other Documents'];
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        return categoryOrder.indexOf(a) - categoryOrder.indexOf(b);
    });
    
    const escape = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlLocal;
    let html = '';
    
    sortedCategories.forEach(category => {
        html += `<div class="docs-category">`;
        html += `<h3 class="category-title">${escape(category)}</h3>`;
        html += `<div class="docs-category-grid">`;
        
        const sortedFiles = grouped[category].sort((a, b) => {
            if (category === 'Daily Logs') return b.name.localeCompare(a.name);
            return a.name.localeCompare(b.name);
        });
        
        sortedFiles.forEach(file => {
            const modifiedDate = new Date(file.modified).toLocaleDateString();
            const botBadge = file.botUpdated && !file.acknowledged 
                ? `<span class="badge badge-warning bot-updated-badge" title="Updated by SoLoBot - click to acknowledge">🤖 Updated</span>` 
                : '';
            
            html += `
                <div class="doc-card memory-file ${file.botUpdated && !file.acknowledged ? 'bot-updated' : ''}" 
                     onclick="viewMemoryFile('${escape(file.path)}')"
                     data-filepath="${escape(file.path)}">
                    <div style="display: flex; align-items: center; gap: var(--space-3);">
                        <div class="doc-icon icon-md">📄</div>
                        <div style="min-width: 0; flex: 1;">
                            <div class="doc-title" style="display: flex; align-items: center; gap: var(--space-2);">
                                ${escape(file.name)}
                                ${botBadge}
                            </div>
                            <div class="doc-description">${escape(file.description)}</div>
                            <div class="doc-meta">Modified: ${modifiedDate}</div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `</div></div>`;
    });
    
    if (filtered.length === 0) {
        html = '<p class="empty-state">No memory files match your search</p>';
    }
    
    container.innerHTML = html;
}

// View a memory file - fetch content and show in modal
async function viewMemoryFile(filepath) {
    console.log('[Memory] viewMemoryFile called with:', filepath);
    const titleEl = document.getElementById('memory-file-title');
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    console.log('[Memory] Elements found:', { titleEl: !!titleEl, contentEl: !!contentEl, saveBtn: !!saveBtn });
    
    if (titleEl) titleEl.textContent = filepath;
    if (contentEl) contentEl.value = 'Loading...';
    if (saveBtn) saveBtn.textContent = '💾 Save';
    
    console.log('[Memory] Showing modal...');
    showModal('memory-file-modal');
    
    try {
        // Fetch file content
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}`);
        const data = await response.json();
        
        if (data.error) {
            contentEl.value = `Error: ${data.error}`;
            return;
        }
        
        if (titleEl) titleEl.textContent = data.name;
        if (contentEl) contentEl.value = data.content;
        
        // Store current file for editing
        window.currentMemoryFile = {
            path: filepath,
            content: data.content,
            botUpdated: data.botUpdated
        };
        
        // Load version history
        loadVersionHistory(filepath);
        
        // If bot-updated, show acknowledge option in title
        const file = memoryFilesCache.find(f => f.path === filepath);
        if (file && file.botUpdated && !file.acknowledged) {
            titleEl.innerHTML = `
                ${escapeHtmlLocal(data.name)}
                <span class="badge badge-warning" style="margin-left: 8px;">🤖 Updated by SoLoBot</span>
                <button onclick="acknowledgeUpdate('${escapeHtmlLocal(filepath)}')" 
                        class="btn btn-ghost" style="margin-left: 8px; font-size: 12px;">
                    ✓ Mark as Read
                </button>
            `;
        }
    } catch (e) {
        contentEl.value = `Failed to load file: ${e.message}`;
    }
}

// Acknowledge bot update
async function acknowledgeUpdate(filepath) {
    try {
        await fetch('/api/memory-meta/acknowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filepath })
        });
        
        // Update cache
        const file = memoryFilesCache.find(f => f.path === filepath);
        if (file) {
            file.botUpdated = false;
            file.acknowledged = true;
        }
        
        // Update title
        const titleEl = document.getElementById('memory-file-title');
        if (titleEl && window.currentMemoryFile) {
            titleEl.textContent = window.currentMemoryFile.path;
        }
        
        // Refresh file list
        renderMemoryFiles(document.getElementById('memory-search')?.value || '');
    } catch (e) {
        console.error('Failed to acknowledge:', e);
    }
}

// Load version history for a file
async function loadVersionHistory(filepath) {
    console.log('[Memory] loadVersionHistory called for:', filepath);
    const container = document.getElementById('version-history-list');
    console.log('[Memory] version-history-list container:', container);
    if (!container) {
        console.error('[Memory] version-history-list container NOT FOUND!');
        return;
    }
    
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">Loading versions...</div>';
    
    try {
        const url = `/api/memory/${encodeURIComponent(filepath)}/versions`;
        console.log('Fetching versions from:', url);
        const response = await fetch(url);
        const data = await response.json();
        console.log('Versions response:', data);
        
        if (!data.versions || data.versions.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">No previous versions</div>';
            return;
        }
        
        let html = '';
        data.versions.forEach((version, index) => {
            const date = new Date(version.timestamp);
            const timeAgo = getTimeAgo(date);
            const dateStr = date.toLocaleString();
            
            html += `
                <div class="version-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid var(--border-subtle);">
                    <div>
                        <div style="font-size: 13px; color: var(--text-primary);">${timeAgo}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">${dateStr}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="previewVersion('${escapeHtmlLocal(filepath)}', ${version.timestamp})" 
                                class="btn btn-ghost" style="font-size: 12px; padding: 4px 8px;">
                            👁️ View
                        </button>
                        <button onclick="restoreVersion('${escapeHtmlLocal(filepath)}', ${version.timestamp})" 
                                class="btn btn-ghost" style="font-size: 12px; padding: 4px 8px;">
                            ↩️ Restore
                        </button>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color: var(--error); font-size: 12px;">Failed to load versions</div>`;
    }
}

// Get human-readable time ago
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString();
}

// Store current diff context for restore
let diffContext = { filepath: null, timestamp: null };

// Preview a specific version with diff view
async function previewVersion(filepath, timestamp) {
    try {
        // Fetch both current and historical versions
        const [currentRes, historicalRes] = await Promise.all([
            fetch(`/api/memory/${encodeURIComponent(filepath)}`),
            fetch(`/api/memory/${encodeURIComponent(filepath)}/versions/${timestamp}`)
        ]);
        
        const currentData = await currentRes.json();
        const historicalData = await historicalRes.json();
        
        if (currentData.error || historicalData.error) {
            showToast(`Error: ${currentData.error || historicalData.error}`, 'error');
            return;
        }
        
        // Store context for restore button
        diffContext = { filepath, timestamp };
        
        // Update modal title and date
        const date = new Date(timestamp).toLocaleString();
        document.getElementById('diff-modal-title').textContent = `Compare: ${filepath}`;
        document.getElementById('diff-version-date').textContent = `Version from ${date}`;
        
        // Render diff
        renderDiff(currentData.content, historicalData.content);
        
        // Show modal
        showModal('diff-modal');
    } catch (e) {
        showToast(`Failed to load version: ${e.message}`, 'error');
    }
}

// Simple line-by-line diff renderer
function renderDiff(currentText, historicalText) {
    const currentLines = currentText.split('\n');
    const historicalLines = historicalText.split('\n');
    
    const currentContainer = document.getElementById('diff-current');
    const historicalContainer = document.getElementById('diff-historical');
    
    // Build a simple LCS-based diff
    const diff = computeLineDiff(historicalLines, currentLines);
    
    let currentHtml = '';
    let historicalHtml = '';
    
    diff.forEach(item => {
        const escapedLine = escapeHtmlLocal(item.line);
        if (item.type === 'same') {
            currentHtml += `<div style="padding: 2px 4px;">${escapedLine || '&nbsp;'}</div>`;
            historicalHtml += `<div style="padding: 2px 4px;">${escapedLine || '&nbsp;'}</div>`;
        } else if (item.type === 'added') {
            currentHtml += `<div style="padding: 2px 4px; background: rgba(46, 160, 67, 0.3); border-left: 3px solid var(--success);">${escapedLine || '&nbsp;'}</div>`;
            historicalHtml += `<div style="padding: 2px 4px; opacity: 0.3;">&nbsp;</div>`;
        } else if (item.type === 'removed') {
            currentHtml += `<div style="padding: 2px 4px; opacity: 0.3;">&nbsp;</div>`;
            historicalHtml += `<div style="padding: 2px 4px; background: rgba(248, 81, 73, 0.3); border-left: 3px solid var(--error);">${escapedLine || '&nbsp;'}</div>`;
        }
    });
    
    currentContainer.innerHTML = currentHtml;
    historicalContainer.innerHTML = historicalHtml;
}

// Compute line-by-line diff using simple algorithm
function computeLineDiff(oldLines, newLines) {
    const result = [];
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    
    let oldIdx = 0, newIdx = 0;
    
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (oldIdx >= oldLines.length) {
            // Remaining new lines are additions
            result.push({ type: 'added', line: newLines[newIdx++] });
        } else if (newIdx >= newLines.length) {
            // Remaining old lines are deletions
            result.push({ type: 'removed', line: oldLines[oldIdx++] });
        } else if (oldLines[oldIdx] === newLines[newIdx]) {
            // Lines match
            result.push({ type: 'same', line: oldLines[oldIdx] });
            oldIdx++;
            newIdx++;
        } else if (!newSet.has(oldLines[oldIdx])) {
            // Old line not in new - it was removed
            result.push({ type: 'removed', line: oldLines[oldIdx++] });
        } else if (!oldSet.has(newLines[newIdx])) {
            // New line not in old - it was added
            result.push({ type: 'added', line: newLines[newIdx++] });
        } else {
            // Both exist elsewhere - treat as remove then add
            result.push({ type: 'removed', line: oldLines[oldIdx++] });
        }
    }
    
    return result;
}

// Close diff modal
function closeDiffModal() {
    const modal = document.getElementById('diff-modal');
    if (modal) modal.classList.remove('visible');
    diffContext = { filepath: null, timestamp: null };
}

// Restore from diff view
function restoreFromDiff() {
    if (diffContext.filepath && diffContext.timestamp) {
        closeDiffModal();
        restoreVersion(diffContext.filepath, diffContext.timestamp);
    }
}

// Restore a specific version
async function restoreVersion(filepath, timestamp) {
    const dateStr = new Date(timestamp).toLocaleString();
    const confirmed = await showConfirm(
        `Restore to version from ${dateStr}?\n\nA backup of current version will be created.`,
        'Restore Version',
        'Restore'
    );
    if (!confirmed) return;
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showToast(`Error: ${data.error}`, 'error');
            return;
        }
        
        showToast('Version restored successfully!', 'success');
        
        // Reload the file
        viewMemoryFile(filepath);
        
        // Clear cache
        memoryFilesCache = [];
        lastFetchTime = 0;
    } catch (e) {
        showToast(`Failed to restore: ${e.message}`, 'error');
    }
}

// Close memory modal
function closeMemoryModal() {
    hideModal('memory-file-modal');
    window.currentMemoryFile = null;
}

// Save memory file (with updatedBy tracking)
async function saveMemoryFile() {
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!contentEl || !window.currentMemoryFile) return;
    
    const newContent = contentEl.value;
    const filepath = window.currentMemoryFile.path;
    
    if (saveBtn) saveBtn.textContent = '⏳ Saving...';
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                content: newContent,
                updatedBy: 'user'  // Track that user made this edit
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            showToast(`Failed to save: ${data.error}`, 'error');
            if (saveBtn) saveBtn.textContent = '💾 Save';
            return;
        }
        
        if (saveBtn) saveBtn.textContent = '✓ Saved!';
        setTimeout(() => {
            if (saveBtn) saveBtn.textContent = '💾 Save';
        }, 2000);
        
        // Update stored content
        window.currentMemoryFile.content = newContent;
        
        // Clear cache and refresh
        memoryFilesCache = [];
        lastFetchTime = 0;
        
        // Reload version history
        loadVersionHistory(filepath);
        
        // Refresh file list in background
        renderMemoryFiles(document.getElementById('memory-search')?.value || '');
    } catch (e) {
        showToast(`Failed to save: ${e.message}`, 'error');
        if (saveBtn) saveBtn.textContent = '💾 Save';
    }
}

// Make functions globally available
window.viewMemoryFile = viewMemoryFile;
window.saveMemoryFile = saveMemoryFile;
window.closeMemoryModal = closeMemoryModal;
window.renderMemoryFiles = renderMemoryFiles;
window.fetchMemoryFiles = fetchMemoryFiles;
window.acknowledgeUpdate = acknowledgeUpdate;
window.loadVersionHistory = loadVersionHistory;
window.previewVersion = previewVersion;
window.restoreVersion = restoreVersion;
window.closeDiffModal = closeDiffModal;
window.restoreFromDiff = restoreFromDiff;
