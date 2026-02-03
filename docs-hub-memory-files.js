// docs-hub-memory-files.js - Live memory files from OpenClaw workspace
// Version 2.1.0 - keeps the Markdown formatter while keeping version history + badges

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

let memoryFilesCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30000;
window.currentMemoryFile = null;

function categorizeFile(filename) {
    const coreDocs = ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md', 'IDENTITY.md'];
    const guideDocs = ['SOLOBOT-GUIDE.md', 'LESSONS-LEARNED.md', 'DEPLOY_INSTRUCTIONS.md'];
    if (filename.startsWith('memory/') || filename.match(/^\d{4}-\d{2}-\d{2}\.md$/)) return 'Daily Logs';
    if (coreDocs.includes(filename)) return 'Core Identity';
    if (guideDocs.includes(filename)) return 'Guides & Reference';
    return 'Other Documents';
}

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

async function renderMemoryFiles(filter = '') {
    const container = document.getElementById('memory-files-grid');
    if (!container) return;
    container.innerHTML = '<div class="loading-state">Loading memory files...</div>';
    const files = await fetchMemoryFiles();
    if (files.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>⚠️ Memory files not found</p></div>';
        return;
    }
    const filtered = files.filter(file =>
        file.name.toLowerCase().includes(filter.toLowerCase()) ||
        file.description.toLowerCase().includes(filter.toLowerCase()) ||
        file.category.toLowerCase().includes(filter.toLowerCase())
    );
    const grouped = filtered.reduce((groups, file) => {
        const category = file.category;
        if (!groups[category]) groups[category] = [];
        groups[category].push(file);
        return groups;
    }, {});
    const order = ['Core Identity', 'Guides & Reference', 'Daily Logs', 'Other Documents'];
    const sorted = Object.keys(grouped).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const escape = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlLocal;
    let html = '';
    sorted.forEach(category => {
        html += `<div class="docs-category"><h3 class="category-title">${escape(category)}</h3><div class="docs-category-grid">`;
        const filesInCat = grouped[category].sort((a, b) => {
            if (category === 'Daily Logs') return b.name.localeCompare(a.name);
            return a.name.localeCompare(b.name);
        });
        filesInCat.forEach(file => {
            const modified = file.modified ? new Date(file.modified).toLocaleDateString() : '';
            const badge = file.botUpdated && !file.acknowledged ? '<span class="badge badge-warning">🤖 Updated</span>' : '';
            html += `
                <div class="doc-card memory-file" onclick="viewMemoryFile('${escape(file.path)}')">
                    <div style="display: flex; align-items: center; gap: var(--space-3);">
                        <div class="doc-icon icon-md">📄</div>
                        <div style="flex: 1;">
                            <div class="doc-title" style="display: flex; align-items: center; gap: 6px;">${escape(file.name)} ${badge}</div>
                            <div class="doc-description">${escape(file.description)}</div>
                            ${modified ? `<div class="doc-meta">Modified: ${modified}</div>` : ''}
                        </div>
                    </div>
                </div>`;
        });
        html += '</div></div>';
    });
    if (filtered.length === 0) html = '<p class="empty-state">No memory files match your search</p>';
    container.innerHTML = html;
}

function updateMemoryModalFooter(editMode = false) {
    const footer = document.querySelector('#memory-file-modal .modal-footer');
    if (!footer) return;
    footer.innerHTML = editMode
        ? '<button onclick="cancelEditMemoryFile()" class="btn btn-secondary">Cancel</button><button onclick="saveMemoryFile()" class="btn btn-primary">💾 Save Changes</button>'
        : '<button onclick="hideModal(\'memory-file-modal\')" class="btn btn-secondary">Close</button><button onclick="editMemoryFile()" class="btn btn-primary">✏️ Edit</button>';
}

function getMemoryContainer() {
    return document.getElementById('memory-file-container');
}

function renderMemoryPre(text) {
    const container = getMemoryContainer();
    if (!container) return;
    const pre = document.createElement('pre');
    pre.id = 'memory-file-content';
    pre.style.cssText = 'margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: \'SF Mono\', \'Monaco\', \'Consolas\', monospace; font-size: 13px; line-height: 1.5; background: var(--surface-1); color: var(--text-primary); padding: 12px;';
    pre.textContent = text;
    container.innerHTML = '';
    container.appendChild(pre);
}

function renderMemoryTextarea(text) {
    const container = getMemoryContainer();
    if (!container) return;
    const textarea = document.createElement('textarea');
    textarea.id = 'memory-file-editor';
    textarea.value = text;
    textarea.style.cssText = 'width: 100%; min-height: 60vh; font-family: \'SF Mono\', \'Monaco\', \'Consolas\', monospace; font-size: 13px; line-height: 1.5; padding: 12px; border: 1px solid var(--border-default); background: var(--surface-1); color: var(--text-primary); resize: vertical;';
    container.innerHTML = '';
    container.appendChild(textarea);
    textarea.focus();
}

async function viewMemoryFile(filepath) {
    const titleEl = document.getElementById('memory-file-title');
    if (titleEl) titleEl.textContent = filepath;
    showModal('memory-file-modal');
    updateMemoryModalFooter(false);
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}`);
        const data = await response.json();
        if (data.error) {
            renderMemoryPre(`Error: ${data.error}`);
            return;
        }
        if (titleEl) titleEl.textContent = data.name;
        renderMemoryPre(data.content || '');
        window.currentMemoryFile = {
            path: filepath,
            content: data.content || '',
            botUpdated: data.botUpdated
        };
        loadVersionHistory(filepath);
        const file = memoryFilesCache.find(f => f.path === filepath);
        if (file && file.botUpdated && !file.acknowledged && titleEl) {
            titleEl.innerHTML = `
                ${escapeHtmlLocal(data.name)}
                <span class="badge badge-warning" style="margin-left: 8px;">🤖 Updated by SoLoBot</span>
                <button onclick="acknowledgeUpdate('${escapeHtmlLocal(filepath)}')" class="btn btn-ghost" style="margin-left: 8px; font-size: 12px;">✓ Mark as Read</button>`;
        }
    } catch (e) {
        renderMemoryPre(`Failed to load file: ${e.message}`);
    }
}

function editMemoryFile() {
    if (!window.currentMemoryFile) return;
    renderMemoryTextarea(window.currentMemoryFile.content);
    updateMemoryModalFooter(true);
}

function cancelEditMemoryFile() {
    if (!window.currentMemoryFile) return;
    renderMemoryPre(window.currentMemoryFile.content);
    updateMemoryModalFooter(false);
}

async function saveMemoryFile() {
    const textarea = document.getElementById('memory-file-editor');
    if (!textarea || !window.currentMemoryFile) return;
    const saveBtn = document.getElementById('memory-save-btn');
    const newContent = textarea.value;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';
    }
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(window.currentMemoryFile.path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent, updatedBy: 'user' })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        if (saveBtn) {
            saveBtn.textContent = '✓ Saved!';
            setTimeout(() => { if (saveBtn) saveBtn.textContent = '💾 Save'; }, 1500);
        }
        window.currentMemoryFile.content = newContent;
        renderMemoryPre(newContent);
        updateMemoryModalFooter(false);
        memoryFilesCache = [];
        lastFetchTime = 0;
        loadVersionHistory(window.currentMemoryFile.path);
        renderMemoryFiles();
    } catch (e) {
        alert(`Failed to save: ${e.message}`);
        renderMemoryTextarea(window.currentMemoryFile.content);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save';
        }
    }
}

async function acknowledgeUpdate(filepath) {
    try {
        await fetch('/api/memory-meta/acknowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filepath })
        });
        const file = memoryFilesCache.find(f => f.path === filepath);
        if (file) {
            file.botUpdated = false;
            file.acknowledged = true;
        }
        renderMemoryFiles(document.getElementById('memory-search')?.value || '');
    } catch (e) {
        console.error('Failed to acknowledge:', e);
    }
}

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
        data.versions.forEach(version => {
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
                        <button onclick="previewVersion('${escapeHtmlLocal(filepath)}', ${version.timestamp})" class="btn btn-ghost" style="font-size: 12px; padding: 4px 8px;">👁️ View</button>
                        <button onclick="restoreVersion('${escapeHtmlLocal(filepath)}', ${version.timestamp})" class="btn btn-ghost" style="font-size: 12px; padding: 4px 8px;">↩️ Restore</button>
                    </div>
                </div>`;
        });
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div style="color: var(--error); font-size: 12px;">Failed to load versions</div>';
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString();
}

async function previewVersion(filepath, timestamp) {
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}/versions/${timestamp}`);
        const data = await response.json();
        if (data.error) {
            alert(`Error: ${data.error}`);
            return;
        }
        const date = new Date(timestamp).toLocaleString();
        const preview = data.content.substring(0, 500) + (data.content.length > 500 ? '...' : '');
        if (confirm(`Version from ${date}:\n\n${preview}\n\nRestore this version?`)) {
            restoreVersion(filepath, timestamp);
        }
    } catch (e) {
        alert(`Failed to load version: ${e.message}`);
    }
}

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
        viewMemoryFile(filepath);
        memoryFilesCache = [];
        lastFetchTime = 0;
    } catch (e) {
        alert(`Failed to restore: ${e.message}`);
    }
}

function closeMemoryModal() {
    hideModal('memory-file-modal');
    window.currentMemoryFile = null;
}

window.viewMemoryFile = viewMemoryFile;
window.editMemoryFile = editMemoryFile;
window.cancelEditMemoryFile = cancelEditMemoryFile;
window.saveMemoryFile = saveMemoryFile;
window.closeMemoryModal = closeMemoryModal;
window.renderMemoryFiles = renderMemoryFiles;
window.fetchMemoryFiles = fetchMemoryFiles;
window.acknowledgeUpdate = acknowledgeUpdate;
window.loadVersionHistory = loadVersionHistory;
window.previewVersion = previewVersion;
window.restoreVersion = restoreVersion;
