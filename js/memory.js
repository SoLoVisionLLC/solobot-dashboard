// js/memory.js — Memory file functions

// ===================
// MEMORY FILE FUNCTIONS
// ===================

// Current file being edited
let currentMemoryFile = null;

// View a memory file in the modal
window.viewMemoryFile = async function(filePath) {
    const titleEl = document.getElementById('memory-file-title');
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!titleEl || !contentEl) return;
    
    // Show loading state
    titleEl.textContent = filePath;
    contentEl.value = 'Loading...';
    contentEl.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    
    currentMemoryFile = filePath;
    showModal('memory-file-modal');
    
    try {
        // Fetch file content from API
        const response = await fetch(`/api/memory/${encodeURIComponent(filePath)}`);
        const data = await response.json();
        
        if (data.error) {
            contentEl.value = `Error: ${data.error}`;
            return;
        }
        
        contentEl.value = data.content || '';
        contentEl.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
        
        // Show bot-update badge and acknowledge button if applicable
        if (data.botUpdated && !data.acknowledged) {
            titleEl.innerHTML = `
                ${escapeHtml(data.name)}
                <span class="badge badge-warning" style="margin-left: 8px;">🤖 Updated by SoLoBot</span>
                <button onclick="this.style.color='var(--text-muted)'; this.textContent='✓ Read'; this.disabled=true; window.acknowledgeUpdate && window.acknowledgeUpdate('${escapeHtml(filePath)}')" 
                        class="btn btn-ghost" style="margin-left: 8px; font-size: 12px; color: var(--error);">
                    ✓ Mark as Read
                </button>
            `;
        } else {
            titleEl.textContent = data.name;
        }
        
        // Load version history (function from docs-hub-memory-files.js)
        if (typeof window.loadVersionHistory === 'function') {
            window.loadVersionHistory(filePath);
        }
        
    } catch (error) {
        console.error('Error loading memory file:', error);
        contentEl.value = `Error loading file: ${error.message}`;
    }
};

// Save memory file changes
window.saveMemoryFile = async function() {
    if (!currentMemoryFile) return;
    
    const contentEl = document.getElementById('memory-file-content');
    const saveBtn = document.getElementById('memory-save-btn');
    
    if (!contentEl) return;
    
    const content = contentEl.value;
    
    // Show saving state
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    try {
        const response = await fetch(`/api/memory/${encodeURIComponent(currentMemoryFile)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            // Success feedback
            if (saveBtn) {
                saveBtn.textContent = '✓ Saved!';
                setTimeout(() => {
                    saveBtn.textContent = 'Save';
                    saveBtn.disabled = false;
                }, 1500);
            }
            // Refresh the memory files list
            if (typeof renderMemoryFilesForPage === 'function') {
                renderMemoryFilesForPage('');
            }
        } else {
            throw new Error(data.error || 'Save failed');
        }
        
    } catch (error) {
        console.error('Error saving memory file:', error);
        showToast(`Failed to save: ${error.message}`, 'error');
        if (saveBtn) {
            saveBtn.textContent = 'Save';
            saveBtn.disabled = false;
        }
    }
};

// Close memory modal
window.closeMemoryModal = function() {
    currentMemoryFile = null;
    hideModal('memory-file-modal');
};


