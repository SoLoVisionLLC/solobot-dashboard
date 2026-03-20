// js/utils.js — Utility functions (time formatting, etc)

// ===================
// UTILITY FUNCTIONS
// ===================

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Smart relative time formatting - shows "just now", "2m", "1h", etc.
function formatSmartTime(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    
    // Less than 30 seconds
    if (diff < 30000) return 'just now';
    
    // Less than 1 minute
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    
    // Less than 1 hour
    if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins}m ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }
    
    // Less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }
    
    // Older - show actual date
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeShort(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return formatDate(timestamp);
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateLastSync() {
    document.getElementById('last-sync').textContent = formatTime(Date.now());
}

function getPriorityClass(p) {
    if (p === 0) return 'badge-error';
    if (p === 1) return 'badge-warning';
    return 'badge-default';
}

function getPriorityBadgeClass(p) {
    if (p === 0) return 'badge-error';
    if (p === 1) return 'badge-warning';
    return 'badge-default';
}

function getLogColor(type) {
    switch(type) {
        case 'command': return 'text-green-400';
        case 'success': return 'text-green-300';
        case 'error': return 'text-red-400';
        case 'warning': return 'text-yellow-400';
        case 'info': return 'text-blue-400';
        case 'thinking': return 'text-purple-400';
        case 'output': return 'text-gray-300';
        default: return 'text-gray-400';
    }
}

function getLogPrefix(type) {
    switch(type) {
        case 'command': return '$ ';
        case 'thinking': return '🧠 ';
        case 'success': return '✓ ';
        case 'error': return '✗ ';
        case 'warning': return '⚠ ';
        default: return '';
    }
}

// Legacy function - keeping for backwards compatibility
function getDocIcon(type) {
    return getDocIconSymbol(type, '');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addActivity(action, type = 'info') {
    state.activity.push({
        time: Date.now(),
        action,
        type
    });
    
    if (state.activity.length > 500) {
        state.activity = state.activity.slice(-500);
    }
}

function updateArchiveBadge() {
    const badgeEl = document.getElementById('archive-badge');
    if (!badgeEl) return;
    
    const count = (state.tasks.archive || []).length;
    badgeEl.textContent = count;
    if (count > 0) {
        badgeEl.classList.remove('hidden');
    } else {
        badgeEl.classList.add('hidden');
    }
}



// ============================================================================
// CENTRALIZED AVATAR RESOLUTION
// All avatar URL generation should go through these functions to avoid
// duplicate logic and potential inconsistencies.
// ============================================================================

const PNG_AGENTS = new Set(['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'family', 'smm', 'nova', 'luma',
    'elon', 'orion', 'atlas', 'sterling', 'forge', 'sentinel', 'knox', 'vector', 'canon',
    'quill', 'chip', 'snip', 'ledger', 'haven', 'solo', 'halo']);
const SVG_AGENTS = new Set(['tax', 'sec']);

/**
 * Resolve an agent ID to their avatar filename (without extension).
 * This is the SINGLE SOURCE OF TRUTH for avatar resolution.
 * @param {string} agentId - The agent ID (e.g., 'main', 'dev', 'orion')
 * @returns {string} The avatar filename (e.g., 'halo', 'dev', 'orion')
 */
function resolveAgentToAvatar(agentId) {
    // Special case: 'main' agent uses 'halo' avatar
    if (agentId === 'main') return 'halo';
    // Special case: 'smm' agent uses 'nova' avatar (legacy mapping)
    if (agentId === 'smm') return 'nova';
    // Return the agentId itself for all other cases
    return agentId;
}

/**
 * Get the full avatar URL for an agent (small version).
 * @param {string} agentId - The agent ID
 * @returns {string} The avatar URL (e.g., '/avatars/halo.png')
 */
function getAvatarUrl(agentId) {
    const avatar = resolveAgentToAvatar(agentId);
    if (PNG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}.png`;
    }
    if (SVG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}.svg`;
    }
    // Fallback for unknown agents
    return '/avatars/solobot.png';
}

/**
 * Get the full-size avatar URL for an agent (hero/full version).
 * @param {string} agentId - The agent ID
 * @returns {string} The full-size avatar URL
 */
function getAvatarUrlFull(agentId) {
    const avatar = resolveAgentToAvatar(agentId);
    if (PNG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}-full.png`;
    }
    if (SVG_AGENTS.has(avatar)) {
        return `/avatars/${avatar}.svg`;
    }
    // Fallback to small avatar if full not available
    return getAvatarUrl(agentId);
}

// ============================================================================
// CENTRALIZED AGENT DATA
// ============================================================================

const AGENT_ID_ALIASES = {
    exec: "elon",
    cto: "orion",
    coo: "atlas",
    cfo: "sterling",
    cmp: "vector",
    devops: "forge",
    ui: "quill",
    swe: "chip",
    youtube: "snip",
    veo: "snip",
    veoflow: "snip",
    sec: "knox",
    net: "sentinel",
    smm: "nova",
    docs: "canon",
    tax: "ledger",
    family: "haven",
    creative: "luma",
    art: "luma",
    halo: "main"
};

const DEFAULT_DEPARTMENTS = {
    main: "Executive",
    elon: "Executive",
    orion: "Technology",
    dev: "Technology",
    forge: "Technology",
    quill: "Technology",
    chip: "Technology",
    sentinel: "Technology",
    knox: "Technology",
    atlas: "Operations",
    canon: "Operations",
    vector: "Marketing & Product",
    nova: "Marketing & Product",
    snip: "Marketing & Product",
    luma: "Marketing & Product",
    sterling: "Finance",
    ledger: "Finance",
    haven: "Family / Household"
};

const ALLOWED_AGENT_IDS = new Set(Object.keys(DEFAULT_DEPARTMENTS));

// ============================================================================
// AGENT ID NORMALIZATION
// ============================================================================

function normalizeAgentId(raw) {
    if (!raw) return 'main';
    const normalized = raw.toLowerCase().trim();
    return AGENT_ID_ALIASES[normalized] || normalized;
}

function getAgentDepartment(agentId) {
    const normalized = normalizeAgentId(agentId);
    return DEFAULT_DEPARTMENTS[normalized] || 'Other';
}

// ============================================================================
// TIME FORMATTING (CENTRALIZED)
// ============================================================================

function timeAgo(timestamp) {
    if (!timestamp) return 'never';
    const now = Date.now();
    const then = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const seconds = Math.floor((now - then) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(then).toLocaleDateString();
}

// ============================================================================
// LOCALSTORAGE UTILITIES
// ============================================================================

function getStorage(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    } catch { return defaultValue; }
}

function setStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch { return false; }
}

function getStorageJSON(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
    } catch { return defaultValue; }
}

function setStorageJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch { return false; }
}

// ============================================================================
// DOM HELPER
// ============================================================================

// Simple ID-based element lookup (like jQuery's $())
function $(id) {
    return typeof id === 'string' ? document.getElementById(id) : id;
}
