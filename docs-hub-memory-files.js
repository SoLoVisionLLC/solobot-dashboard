// docs-hub-memory-files.js - Live memory files from OpenClaw workspace

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

// Render memory files in Docs Hub
async function renderMemoryFiles(filter = '') {
    const container = document.getElementById('docs-grid');
    if (!container) return;
    
    // Show loading state
    container.innerHTML = '<div class="loading-state">Loading memory files...</div>';
    
    // Fetch files from API
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
        if (!groups[category]) {
            groups[category] = [];
        }
        groups[category].push(file);
        return groups;
    }, {});
    
    // Sort categories (Core Identity first, then Guides, Daily Logs, Others)
    const categoryOrder = ['Core Identity', 'Guides & Reference', 'Daily Logs', 'Other Documents'];
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        return categoryOrder.indexOf(a) - categoryOrder.indexOf(b);
    });
    
    // Render grouped files
    const escape = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlLocal;
    let html = '';
    
    sortedCategories.forEach(category => {
        html += `<div class="docs-category">`;
        html += `<h3 class="category-title">${escape(category)}</h3>`;
        html += `<div class="docs-category-grid">`;
        
        // Sort files within category
        const sortedFiles = grouped[category].sort((a, b) => {
            // For daily logs, sort by date descending
            if (category === 'Daily Logs') {
                return b.name.localeCompare(a.name);
            }
            return a.name.localeCompare(b.name);
        });
        
        sortedFiles.forEach(file => {
            const modifiedDate = new Date(file.modified).toLocaleDateString();
            html += `
                <div class="doc-card memory-file" onclick="viewMemoryFile('${escape(file.path)}')">
                    <div style="display: flex; align-items: center; gap: var(--space-3);">
                        <div class="doc-icon icon-md">📄</div>
                        <div style="min-width: 0; flex: 1;">
                            <div class="doc-title">${escape(file.name)}</div>
                            <div class="doc-description">${escape(file.description)}</div>
                            <div class="doc-meta">Modified: ${modifiedDate}</div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `</div></div>`;
    });
    
    // If no results after filter
    if (filtered.length === 0) {
        html = '<p class="empty-state">No memory files match your search</p>';
    }
    
    container.innerHTML = html;
}

// View a memory file - fetch content and show in modal
async function viewMemoryFile(filepath) {
    const titleEl = document.getElementById('memory-file-title');
    const contentEl = document.getElementById('memory-file-content');
    
    if (titleEl) titleEl.textContent = filepath;
    if (contentEl) contentEl.textContent = 'Loading...';
    
    showModal('memory-file-modal');
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}`);
        const data = await response.json();
        
        if (data.error) {
            contentEl.textContent = `Error: ${data.error}`;
            return;
        }
        
        if (titleEl) titleEl.textContent = data.name;
        if (contentEl) contentEl.textContent = data.content;
        
        // Store current file for editing
        window.currentMemoryFile = {
            path: filepath,
            content: data.content
        };
    } catch (e) {
        contentEl.textContent = `Failed to load file: ${e.message}`;
    }
}

// Edit memory file - switch to edit mode
function editMemoryFile() {
    const contentEl = document.getElementById('memory-file-content');
    if (!contentEl || !window.currentMemoryFile) return;
    
    // Convert to textarea for editing
    const content = window.currentMemoryFile.content;
    const textarea = document.createElement('textarea');
    textarea.id = 'memory-file-editor';
    textarea.value = content;
    textarea.style.cssText = `
        width: 100%;
        height: 60vh;
        font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.5;
        padding: 12px;
        border: 1px solid var(--border-default);
        border-radius: 4px;
        background: var(--surface-1);
        color: var(--text-primary);
        resize: vertical;
    `;
    
    contentEl.parentNode.replaceChild(textarea, contentEl);
    
    // Update buttons
    const footer = document.querySelector('#memory-file-modal .modal-footer');
    if (footer) {
        footer.innerHTML = `
            <button onclick="cancelEditMemoryFile()" class="btn btn-secondary">Cancel</button>
            <button onclick="saveMemoryFile()" class="btn btn-primary">💾 Save Changes</button>
        `;
    }
}

// Cancel edit mode
function cancelEditMemoryFile() {
    hideModal('memory-file-modal');
    
    // Restore original content element
    const editor = document.getElementById('memory-file-editor');
    if (editor) {
        const pre = document.createElement('pre');
        pre.id = 'memory-file-content';
        pre.style.cssText = `
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
        `;
        editor.parentNode.replaceChild(pre, editor);
    }
    
    // Restore buttons
    const footer = document.querySelector('#memory-file-modal .modal-footer');
    if (footer) {
        footer.innerHTML = `
            <button onclick="hideModal('memory-file-modal')" class="btn btn-secondary">Close</button>
            <button onclick="editMemoryFile()" class="btn btn-primary">✏️ Edit</button>
        `;
    }
    
    window.currentMemoryFile = null;
}

// Save memory file
async function saveMemoryFile() {
    const editor = document.getElementById('memory-file-editor');
    if (!editor || !window.currentMemoryFile) return;
    
    const newContent = editor.value;
    const filepath = window.currentMemoryFile.path;
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(filepath)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert(`Failed to save: ${data.error}`);
            return;
        }
        
        alert(`✅ Saved ${filepath}`);
        
        // Clear cache to force refresh
        memoryFilesCache = [];
        lastFetchTime = 0;
        
        cancelEditMemoryFile();
        renderMemoryFiles();
    } catch (e) {
        alert(`Failed to save: ${e.message}`);
    }
}

// Make functions globally available
window.viewMemoryFile = viewMemoryFile;
window.editMemoryFile = editMemoryFile;
window.cancelEditMemoryFile = cancelEditMemoryFile;
window.saveMemoryFile = saveMemoryFile;
window.renderMemoryFiles = renderMemoryFiles;
