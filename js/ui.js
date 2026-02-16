// js/ui.js — Confirm dialogs, toasts, alert/confirm overrides


// ===================
// CUSTOM CONFIRM & TOAST (no browser alerts!)
// ===================

let confirmResolver = null;

// Custom confirm dialog - returns Promise<boolean>
function showConfirm(message, title = 'Confirm', okText = 'OK') {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-modal-title').textContent = title;
        document.getElementById('confirm-modal-message').innerHTML = message;
        document.getElementById('confirm-modal-ok').textContent = okText;
        showModal('confirm-modal');
    });
}

function closeConfirmModal(result) {
    hideModal('confirm-modal');
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

// Toast notification - replaces alert()
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease;
        max-width: 350px;
        word-wrap: break-word;
    `;
    
    // Set color based on type
    switch(type) {
        case 'success': toast.style.background = 'var(--success)'; break;
        case 'error': toast.style.background = 'var(--error)'; break;
        case 'warning': toast.style.background = '#f59e0b'; break;
        default: toast.style.background = 'var(--accent)'; break;
    }
    
    toast.textContent = message;
    container.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Make functions globally available
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;
window.showToast = showToast;

// === OVERRIDE NATIVE alert/confirm ===
// Intercept ALL browser dialogs and use our custom UI instead
window.alert = function(message) {
    showToast(message, 'info', 5000);
};

// Store original confirm for emergency use
const _originalConfirm = window.confirm;

window.confirm = function(message) {
    // Show our custom confirm modal
    // Since confirm() is synchronous, we show the modal but return false
    // to block the action. Code should be refactored to use showConfirm().
    console.warn('[Dashboard] Native confirm() intercepted. Use showConfirm() for proper async handling.');
    
    // Show toast explaining what happened
    showToast('Action blocked - please try again', 'warning');
    
    // Show the confirm modal (user can see the message)
    showConfirm(message, 'Confirm');
    
    // Return false to block the synchronous action
    return false;
};

// Classify messages as system/heartbeat noise vs real chat

// ===================
// THEMED CONFIRM MODAL (replaces browser confirm)
// ===================

let confirmModalCallback = null;

function showConfirm(title, message, okText = 'OK', cancelText = 'Cancel', isDanger = false) {
    return new Promise((resolve) => {
        const titleEl = document.getElementById('confirm-modal-title');
        const messageEl = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        
        if (titleEl) titleEl.textContent = title;
        if (messageEl) messageEl.textContent = message;
        if (okBtn) {
            okBtn.textContent = okText;
            okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
        }
        if (cancelBtn) cancelBtn.textContent = cancelText;
        
        confirmModalCallback = resolve;
        showModal('confirm-modal');
    });
}

function closeConfirmModal(result) {
    hideModal('confirm-modal');
    if (confirmModalCallback) {
        confirmModalCallback(result);
        confirmModalCallback = null;
    }
}

// Make globally available
window.showConfirm = showConfirm;
window.closeConfirmModal = closeConfirmModal;

async function clearChatHistory(skipConfirm = false, clearCache = false) {
    if (!skipConfirm) {
        const confirmed = await showConfirm(
            'Clear Chat History',
            'Clear all chat messages? They may reload from Gateway on next sync.',
            'Clear',
            'Cancel',
            true
        );
        if (!confirmed) return;
    }

    state.chat.messages = [];
    chatPageNewMessageCount = 0;
    chatPageUserScrolled = false;

    // Clear localStorage cache when switching sessions to prevent stale data
    if (clearCache) {
        localStorage.removeItem(chatStorageKey());
    }

    // Reset incremental render state
    const chatContainer = document.getElementById('chat-page-messages');
    if (chatContainer) { chatContainer._renderedCount = 0; chatContainer._sessionKey = null; }

    renderChat();
    renderChatPage();
}


