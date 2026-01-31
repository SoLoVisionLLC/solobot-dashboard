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
    const titleEl = document.getElementById('memory-file-title');
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (titleEl) titleEl.textContent = filepath;
    if (contentEl) contentEl.value = 'Loading...';
    if (saveBtn) saveBtn.textContent = '💾 Save';
    
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
    const container = document.getElementById('version-history-list');
    if (!container) return;
    
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">Loading versions...</div>';
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}/versions`);
        const data = await response.json();
        
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

// Preview a specific version
async function previewVersion(filepath, timestamp) {
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}/versions/${timestamp}`);
        const data = await response.json();
        
        if (data.error) {
            alert(`Error: ${data.error}`);
            return;
        }
        
        // Show in a simple alert or separate modal
        const date = new Date(timestamp).toLocaleString();
        const preview = data.content.substring(0, 500) + (data.content.length > 500 ? '...' : '');
        
        if (confirm(`Version from ${date}:\n\n${preview}\n\nRestore this version?`)) {
            restoreVersion(filepath, timestamp);
        }
    } catch (e) {
        alert(`Failed to load version: ${e.message}`);
    }
}

// Restore a specific version
async function restoreVersion(filepath, timestamp) {
    if (!confirm(`Restore file to version from ${new Date(timestamp).toLocaleString()}?\n\nA backup of the current version will be created.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timestamp })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert(`Error: ${data.error}`);
            return;
        }
        
        alert('✅ Version restored successfully!');
        
        // Reload the file
        viewMemoryFile(filepath);
        
        // Clear cache
        memoryFilesCache = [];
        lastFetchTime = 0;
    } catch (e) {
        alert(`Failed to restore: ${e.message}`);
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
            alert(`Failed to save: ${data.error}`);
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
        alert(`Failed to save: ${e.message}`);
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
