// js/memory-browser.js — Enhanced Memory Browser

let memoryTree = [];
let memorySearchResults = [];

function initMemoryBrowser() {
    loadMemoryTree();
}

async function loadMemoryTree() {
    const treeContainer = document.getElementById('memory-tree');
    if (!treeContainer) return;

    treeContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Loading...</div>';

    // Try gateway RPC for filesystem listing
    if (gateway && gateway.isConnected()) {
        try {
            const result = await gateway._request('memory.list', { recursive: true });
            memoryTree = result?.files || result || [];
            renderMemoryTree(memoryTree);
            return;
        } catch (e) {
            console.warn('[Memory] Gateway memory.list not available:', e.message);
        }
    }

    // Fallback: use existing memory files from the page
    try {
        const files = typeof fetchMemoryFiles === 'function' ? await fetchMemoryFiles() : [];
        memoryTree = files;
        renderMemoryTree(files);
    } catch (e) {
        treeContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">Could not load memory files</div>';
    }
}

function renderMemoryTree(files) {
    const container = document.getElementById('memory-tree');
    if (!container) return;

    if (!files || files.length === 0) {
        container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">No files found</div>';
        return;
    }

    // Build tree from flat file list
    const tree = {};
    for (const f of files) {
        const filePath = f.path || f.name || '';
        const parts = filePath.split('/').filter(Boolean);
        let node = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                if (!node._files) node._files = [];
                node._files.push({ ...f, fileName: part });
            } else {
                if (!node[part]) node[part] = {};
                node = node[part];
            }
        }
        // If no path separators, add to root
        if (parts.length <= 1) {
            if (!tree._files) tree._files = [];
            if (!tree._files.find(x => x.fileName === (parts[0] || filePath))) {
                tree._files.push({ ...f, fileName: parts[0] || filePath });
            }
        }
    }

    container.innerHTML = renderTreeNode(tree, '');
}

function renderTreeNode(node, prefix) {
    let html = '';

    // Render subdirectories
    const dirs = Object.keys(node).filter(k => k !== '_files').sort();
    for (const dir of dirs) {
        const dirPath = prefix ? `${prefix}/${dir}` : dir;
        const fileCount = countFiles(node[dir]);
        html += `
        <div class="memory-tree-dir" onclick="toggleTreeDir(this)">
            <span class="tree-chevron">▶</span>
            <span style="font-size: 13px;">📁 ${escapeHtml(dir)}</span>
            <span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">(${fileCount})</span>
        </div>
        <div class="memory-tree-children hidden">
            ${renderTreeNode(node[dir], dirPath)}
        </div>`;
    }

    // Render files
    const files = node._files || [];
    for (const f of files.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''))) {
        const fp = f.path || f.name || f.fileName;
        html += `
        <div class="memory-tree-file" onclick="previewMemoryFile('${escapeHtml(fp)}')">
            <span style="font-size: 12px;">📄</span>
            <span style="font-size: 12px;">${escapeHtml(f.fileName || fp)}</span>
        </div>`;
    }

    return html;
}

function countFiles(node) {
    let count = (node._files || []).length;
    for (const k of Object.keys(node).filter(k => k !== '_files')) {
        count += countFiles(node[k]);
    }
    return count;
}

window.toggleTreeDir = function(el) {
    const children = el.nextElementSibling;
    if (!children) return;
    const chevron = el.querySelector('.tree-chevron');
    if (children.classList.contains('hidden')) {
        children.classList.remove('hidden');
        if (chevron) chevron.textContent = '▼';
    } else {
        children.classList.add('hidden');
        if (chevron) chevron.textContent = '▶';
    }
};

window.previewMemoryFile = async function(filePath) {
    const preview = document.getElementById('memory-file-preview');
    if (!preview) {
        // Fallback to existing viewer
        if (typeof viewMemoryFile === 'function') viewMemoryFile(filePath);
        return;
    }

    preview.innerHTML = '<div style="color: var(--text-muted); padding: 12px;">Loading...</div>';

    try {
        let content = '';
        if (gateway && gateway.isConnected()) {
            try {
                const result = await gateway._request('memory.read', { path: filePath });
                content = result?.content || result || '';
            } catch (e) {
                // Fallback to fetch
                const resp = await fetch(`/api/memory/file?path=${encodeURIComponent(filePath)}`);
                content = resp.ok ? await resp.text() : 'Could not load file';
            }
        } else {
            const resp = await fetch(`/api/memory/file?path=${encodeURIComponent(filePath)}`);
            content = resp.ok ? await resp.text() : 'Could not load file';
        }

        preview.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-default);">
                <span style="font-weight: 600; font-size: 13px;">📄 ${escapeHtml(filePath)}</span>
                <div style="display: flex; gap: 4px;">
                    <button onclick="editMemoryFile('${escapeHtml(filePath)}')" class="btn btn-ghost" style="font-size: 11px; padding: 2px 8px;">Edit</button>
                </div>
            </div>
            <pre style="padding: 12px; margin: 0; font-size: 12px; white-space: pre-wrap; word-break: break-word; overflow-y: auto; max-height: 500px; color: var(--text-primary);">${escapeHtml(typeof content === 'string' ? content : JSON.stringify(content, null, 2))}</pre>
        `;
    } catch (e) {
        preview.innerHTML = `<div style="color: var(--error); padding: 12px;">Error: ${e.message}</div>`;
    }
};

window.editMemoryFile = function(filePath) {
    if (typeof viewMemoryFile === 'function') {
        viewMemoryFile(filePath);
    }
};

window.searchMemoryFiles = async function() {
    const query = document.getElementById('memory-browser-search')?.value?.trim();
    if (!query) {
        renderMemoryTree(memoryTree);
        return;
    }

    const q = query.toLowerCase();
    const filtered = memoryTree.filter(f => {
        const name = (f.name || f.path || '').toLowerCase();
        const desc = (f.description || '').toLowerCase();
        return name.includes(q) || desc.includes(q);
    });

    renderMemoryTree(filtered);
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initMemoryBrowser, 1000);
});
