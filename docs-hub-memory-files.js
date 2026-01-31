// docs-hub-memory-files.js - Add memory files to Docs Hub

// Local escapeHtml function (in case dashboard.js hasn't loaded yet)
function escapeHtmlLocal(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Memory files data structure
const memoryFiles = [
    {
        id: 'soul',
        name: 'SOUL.md - Bot Identity',
        type: 'md',
        description: 'Who SoLoBot is, core beliefs, personality, and operational guidelines',
        category: 'Core Identity'
    },
    {
        id: 'user',
        name: 'USER.md - About SoLo',
        type: 'md', 
        description: 'Information about Jeremy Smith (SoLo) - your human, work style, goals',
        category: 'Core Identity'
    },
    {
        id: 'agents',
        name: 'AGENTS.md - Workspace Guide',
        type: 'md',
        description: 'Workspace guidelines, memory management rules, and operational procedures',
        category: 'Core Identity'
    },
    {
        id: 'memory',
        name: 'MEMORY.md - Long-term Memory',
        type: 'md',
        description: 'Curated memories, decisions, lessons learned, and important context',
        category: 'Core Identity'
    },
    {
        id: 'tools',
        name: 'TOOLS.md - Tool Configs',
        type: 'md',
        description: 'Local notes about tools, configurations, credentials, and technical setup',
        category: 'Core Identity'
    },
    {
        id: 'heartbeat',
        name: 'HEARTBEAT.md - Proactive Checks',
        type: 'md',
        description: 'Proactive check schedule, task management flow, and maintenance procedures',
        category: 'Core Identity'
    },
    {
        id: 'log-2026-01-29',
        name: 'January 29, 2026 - Day 1',
        type: 'md',
        description: 'Initial setup, tax document organization, Google Drive structure creation',
        category: 'Daily Logs'
    },
    {
        id: 'log-2026-01-30',
        name: 'January 30, 2026 - Day 2',
        type: 'md',
        description: 'Dashboard development, OAuth setup, heartbeat implementation',
        category: 'Daily Logs'
    },
    {
        id: 'log-2026-01-31',
        name: 'January 31, 2026 - Day 3',
        type: 'md',
        description: 'Deployment to VPS, Coolify setup, task board sync fixes, backup systems',
        category: 'Daily Logs'
    },
    {
        id: 'running-context',
        name: 'RUNNING-CONTEXT.md',
        type: 'md',
        description: 'Current work context, active tasks, and ongoing project status',
        category: 'Daily Logs'
    }
];

// Function to render memory files in Docs Hub
function renderMemoryFiles(filter = '') {
    const container = document.getElementById('docs-grid');
    
    // Filter memory files
    const filtered = memoryFiles.filter(file =>
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
    
    // Render grouped files
    let html = '';
    const escape = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlLocal;
    
    Object.keys(grouped).forEach(category => {
        html += `<div class="docs-category">`;
        html += `<h3 class="category-title">${escape(category)}</h3>`;
        html += `<div class="docs-category-grid">`;
        
        grouped[category].forEach(file => {
            html += `
                <div class="doc-card memory-file" onclick="viewMemoryFile('${file.id}')">
                    <div style="display: flex; align-items: center; gap: var(--space-3);">
                        <div class="doc-icon icon-md">📄</div>
                        <div style="min-width: 0; flex: 1;">
                            <div class="doc-title">${escape(file.name)}</div>
                            <div class="doc-description">${escape(file.description)}</div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += `</div></div>`;
    });
    
    // If no results, show message
    if (filtered.length === 0) {
        html = '<p class="empty-state">No memory files found</p>';
    }
    
    container.innerHTML = html;
}

// Function to view a memory file (placeholder for now)
function viewMemoryFile(fileId) {
    const file = memoryFiles.find(f => f.id === fileId);
    if (file) {
        // For now, show an alert. In full implementation, this would open an editor
        alert(`Opening: ${file.name}\n\nIn the full implementation, this would:\n1. Load the actual file content from Google Drive\n2. Display it in an editor\n3. Allow you to view and edit the content\n4. Save changes back to Drive`);
    }
}

// Function to load memory file content from Google Drive
async function loadMemoryFileContent(fileId) {
    // This would integrate with Google Drive API to fetch actual file content
    // For now, return placeholder
    return `# ${fileId}\n\nContent would be loaded from Google Drive...`;
}

// Add CSS for memory files
const memoryFileStyles = `
<style>
.docs-category {
    margin-bottom: var(--space-6);
}

.category-title {
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
}

.docs-category-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--space-4);
}

.memory-file {
    cursor: pointer;
    transition: all var(--transition-normal);
}

.memory-file:hover {
    background: var(--surface-2);
    border-color: var(--brand-red);
    transform: translateY(-1px);
}

.doc-description {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.4;
    margin-top: var(--space-1);
}

.empty-state {
    text-align: center;
    color: var(--text-muted);
    padding: var(--space-10);
}
</style>
`;

// Export functions for use in dashboard
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        memoryFiles,
        renderMemoryFiles,
        viewMemoryFile,
        loadMemoryFileContent
    };
}