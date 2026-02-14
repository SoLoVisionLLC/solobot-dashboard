// js/phase13-terminal.js — Phase 13: Terminal Improvements
// Syntax highlighting, searchable history, log level filtering, auto-scroll with override

(function() {
    'use strict';

    // ==========================================
    // Terminal State
    // ==========================================
    
    let terminalHistory = []; // All terminal logs
    let filteredHistory = []; // Filtered view
    let searchQuery = '';
    let logLevelFilter = 'all'; // all, info, warn, error
    let autoScroll = true;
    let userScrolled = false;
    let maxLogEntries = 1000;

    // ==========================================
    // Syntax Highlighting Patterns
    // ==========================================

    const SYNTAX_PATTERNS = {
        // Keywords
        keyword: /\b(const|let|var|function|return|if|else|for|while|async|await|import|export|class|new|try|catch|throw|true|false|null|undefined)\b/g,
        // Strings
        string: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g,
        // Numbers
        number: /\b\d+(?:\.\d+)?\b/g,
        // URLs/Paths
        url: /\b(?:https?:\/\/|\/)[\w\/\.\-:]+\b/g,
        // Timestamps
        timestamp: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
        // UUIDs
        uuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        // IP addresses
        ip: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
        // File paths
        filepath: /\b(?:[\w\-]+\/)+[\w\-]+\.[\w]+\b/g,
        // Error patterns
        error: /\b(error|exception|failed|failure|crash|fatal)\b/gi,
        // Success patterns
        success: /\b(success|succeeded|completed|done|ok)\b/gi,
        // Warning patterns
        warning: /\b(warn|warning|caution|deprecated)\b/gi
    };

    const SYNTAX_COLORS = {
        keyword: '#c678dd',    // Purple
        string: '#98c379',     // Green
        number: '#d19a66',     // Orange
        url: '#61afef',        // Blue
        timestamp: '#56b6c2',  // Cyan
        uuid: '#e5c07b',       // Yellow
        ip: '#61afef',         // Blue
        filepath: '#98c379',   // Green
        error: '#e06c75',      // Red
        success: '#98c379',    // Green
        warning: '#e5c07b'     // Yellow
    };

    // ==========================================
    // Syntax Highlighting
    // ==========================================

    function highlightSyntax(text) {
        if (!text || typeof text !== 'string') return escapeHtml(String(text));

        let highlighted = escapeHtml(text);
        const replacements = [];

        // Find all matches and store them
        for (const [type, pattern] of Object.entries(SYNTAX_PATTERNS)) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                replacements.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[0],
                    type: type,
                    color: SYNTAX_COLORS[type]
                });
            }
            // Reset regex
            pattern.lastIndex = 0;
        }

        // Sort by position (reverse to replace from end to start)
        replacements.sort((a, b) => b.start - a.start);

        // Apply replacements
        for (const r of replacements) {
            const before = highlighted.substring(0, r.start);
            const after = highlighted.substring(r.end);
            const colored = `<span style="color: ${r.color};" class="syntax-${r.type}">${escapeHtml(r.text)}</span>`;
            highlighted = before + colored + after;
        }

        return highlighted;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================
    // Log Level Detection
    // ==========================================

    function detectLogLevel(text) {
        const lower = text.toLowerCase();
        
        if (/\b(error|exception|failed|fatal|crash)\b/.test(lower)) return 'error';
        if (/\b(warn|warning|caution|deprecated)\b/.test(lower)) return 'warn';
        if (/\b(info|log|debug|trace)\b/.test(lower)) return 'info';
        if (/\b(success|completed|done)\b/.test(lower)) return 'success';
        
        return 'info';
    }

    function getLevelClass(level) {
        const classes = {
            error: 'error',
            warn: 'warning',
            info: 'info',
            success: 'success'
        };
        return classes[level] || 'info';
    }

    function getLevelIcon(level) {
        const icons = {
            error: '❌',
            warn: '⚠️',
            info: 'ℹ️',
            success: '✅'
        };
        return icons[level] || '•';
    }

    // ==========================================
    // Terminal History Search
    // ==========================================

    function searchTerminal(query) {
        searchQuery = query.toLowerCase();
        applyFilters();
        renderTerminal();
    }

    function setLogLevelFilter(level) {
        logLevelFilter = level;
        applyFilters();
        renderTerminal();
    }

    function applyFilters() {
        filteredHistory = terminalHistory.filter(entry => {
            // Level filter
            if (logLevelFilter !== 'all' && entry.level !== logLevelFilter) {
                return false;
            }
            
            // Search filter
            if (searchQuery && !entry.text.toLowerCase().includes(searchQuery)) {
                return false;
            }
            
            return true;
        });
    }

    function clearTerminalFilter() {
        searchQuery = '';
        logLevelFilter = 'all';
        document.getElementById('terminal-search').value = '';
        document.getElementById('terminal-level-filter').value = 'all';
        applyFilters();
        renderTerminal();
    }

    // ==========================================
    // Auto-scroll with Manual Override
    // ==========================================

    function setupAutoScroll() {
        const output = document.getElementById('console-output');
        if (!output) return;

        output.addEventListener('scroll', () => {
            const isAtBottom = output.scrollHeight - output.scrollTop <= output.clientHeight + 50;
            userScrolled = !isAtBottom;
            autoScroll = isAtBottom;
            
            updateScrollIndicator();
        });
    }

    function updateScrollIndicator() {
        const indicator = document.getElementById('scroll-indicator');
        if (!indicator) return;
        
        if (userScrolled) {
            indicator.style.display = 'flex';
            indicator.innerHTML = `⬇️ ${filteredHistory.length - getVisibleCount()} more`;
        } else {
            indicator.style.display = 'none';
        }
    }

    function getVisibleCount() {
        const output = document.getElementById('console-output');
        if (!output) return 0;
        
        // Approximate visible entries based on scroll position
        const scrollRatio = output.scrollTop / (output.scrollHeight - output.clientHeight || 1);
        return Math.floor(filteredHistory.length * scrollRatio);
    }

    function scrollToBottom() {
        const output = document.getElementById('console-output');
        if (output) {
            output.scrollTop = output.scrollHeight;
            userScrolled = false;
            autoScroll = true;
            updateScrollIndicator();
        }
    }

    // ==========================================
    // Enhanced Terminal Rendering
    // ==========================================

    function renderTerminal() {
        const container = document.getElementById('console-output');
        if (!container) return;

        if (filteredHistory.length === 0) {
            container.innerHTML = '<div class="terminal-empty">No logs to display</div>';
            return;
        }

        // Only render last N entries for performance
        const entriesToRender = filteredHistory.slice(-100);
        
        const html = entriesToRender.map((entry, index) => {
            const levelClass = getLevelClass(entry.level);
            const icon = getLevelIcon(entry.level);
            const timestamp = new Date(entry.time).toLocaleTimeString();
            const highlighted = highlightSyntax(entry.text);
            
            return `
                <div class="terminal-line ${levelClass}" data-index="${terminalHistory.indexOf(entry)}">
                    <span class="terminal-timestamp">[${timestamp}]</span>
                    <span class="terminal-icon">${icon}</span>
                    <span class="terminal-text">${highlighted}</span>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Auto-scroll if enabled
        if (autoScroll && !userScrolled) {
            container.scrollTop = container.scrollHeight;
        }

        updateScrollIndicator();
    }

    // ==========================================
    // Enhanced Console Functions
    // ==========================================

    function addConsoleEntry(text, type = 'info') {
        const entry = {
            text: String(text),
            type: type,
            level: detectLogLevel(text),
            time: Date.now()
        };

        terminalHistory.push(entry);

        // Keep history limited
        if (terminalHistory.length > maxLogEntries) {
            terminalHistory = terminalHistory.slice(-maxLogEntries);
        }

        // Apply filters
        applyFilters();
        
        // Render
        renderTerminal();

        // If this is an error, show notification
        if (entry.level === 'error') {
            if (typeof playAudioCue === 'function') {
                playAudioCue('error');
            }
        }
    }

    // Override original console functions
    const originalLogToConsole = window.logToConsole;
    window.logToConsole = function(message, type = 'info') {
        addConsoleEntry(message, type);
    };

    // Override renderConsole if it exists
    window.renderConsole = function() {
        renderTerminal();
    };

    // ==========================================
    // Terminal Toolbar
    // ==========================================

    function setupTerminalToolbar() {
        const terminal = document.getElementById('console-section');
        if (!terminal || document.getElementById('terminal-toolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'terminal-toolbar';
        toolbar.className = 'terminal-toolbar';
        toolbar.innerHTML = `
            <div class="terminal-search-box">
                <input type="text" 
                       id="terminal-search" 
                       placeholder="Search logs..." 
                       oninput="searchTerminal(this.value)"
                       class="terminal-search-input">
                <button onclick="clearTerminalFilter()" class="terminal-btn" title="Clear filters">✕</button>
            </div>
            <select id="terminal-level-filter" 
                    onchange="setLogLevelFilter(this.value)"
                    class="terminal-level-select">
                <option value="all">All levels</option>
                <option value="error">Errors</option>
                <option value="warn">Warnings</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
            </select>
            <button onclick="exportTerminalLogs()" class="terminal-btn" title="Export logs">📥</button>
            <button onclick="clearTerminalHistory()" class="terminal-btn" title="Clear history">🗑️</button>
        `;

        // Insert after header
        const header = terminal.querySelector('.terminal-header');
        if (header) {
            header.insertAdjacentElement('afterend', toolbar);
        }

        // Add scroll indicator
        const output = document.getElementById('console-output');
        if (output) {
            const indicator = document.createElement('div');
            indicator.id = 'scroll-indicator';
            indicator.className = 'scroll-indicator';
            indicator.style.display = 'none';
            indicator.onclick = scrollToBottom;
            output.parentNode.appendChild(indicator);
        }
    }

    // ==========================================
    // Export & Clear
    // ==========================================

    function exportTerminalLogs() {
        const logs = terminalHistory.map(e => 
            `[${new Date(e.time).toISOString()}] [${e.level.toUpperCase()}] ${e.text}`
        ).join('\n');

        const blob = new Blob([logs], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `solobot-logs-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        addActivity('📥 Terminal logs exported', 'success');
    }

    function clearTerminalHistory() {
        if (!confirm('Clear all terminal history?')) return;
        
        terminalHistory = [];
        filteredHistory = [];
        renderTerminal();
        addActivity('🗑️ Terminal history cleared', 'info');
    }

    // ==========================================
    // CSS Styles
    // ==========================================

    function injectStyles() {
        if (document.getElementById('phase13-styles')) return;

        const style = document.createElement('style');
        style.id = 'phase13-styles';
        style.textContent = `
            .terminal-toolbar {
                display: flex;
                gap: 8px;
                padding: 8px 12px;
                background: var(--surface-1);
                border-bottom: 1px solid var(--border-default);
                align-items: center;
            }

            .terminal-search-box {
                display: flex;
                gap: 4px;
                flex: 1;
            }

            .terminal-search-input {
                flex: 1;
                padding: 4px 8px;
                font-size: 12px;
                border: 1px solid var(--border-default);
                border-radius: 4px;
                background: var(--surface-base);
                color: var(--text-primary);
            }

            .terminal-search-input:focus {
                outline: none;
                border-color: var(--brand-red);
            }

            .terminal-level-select {
                padding: 4px 8px;
                font-size: 12px;
                border: 1px solid var(--border-default);
                border-radius: 4px;
                background: var(--surface-base);
                color: var(--text-primary);
            }

            .terminal-btn {
                padding: 4px 8px;
                font-size: 12px;
                border: 1px solid var(--border-default);
                border-radius: 4px;
                background: var(--surface-2);
                color: var(--text-primary);
                cursor: pointer;
                transition: all 0.2s;
            }

            .terminal-btn:hover {
                background: var(--surface-3);
            }

            .terminal-line {
                padding: 2px 0;
                font-family: "Fira Code", "Monaco", "Consolas", monospace;
                font-size: 12px;
                line-height: 1.5;
                border-left: 2px solid transparent;
                padding-left: 4px;
            }

            .terminal-line.error {
                border-left-color: #e06c75;
                background: rgba(224, 108, 117, 0.1);
            }

            .terminal-line.warning {
                border-left-color: #e5c07b;
                background: rgba(229, 192, 123, 0.1);
            }

            .terminal-line.success {
                border-left-color: #98c379;
                background: rgba(152, 195, 121, 0.1);
            }

            .terminal-timestamp {
                color: var(--text-muted);
                font-size: 10px;
                margin-right: 8px;
                opacity: 0.7;
            }

            .terminal-icon {
                margin-right: 6px;
                font-size: 10px;
            }

            .terminal-text {
                color: var(--text-primary);
            }

            .scroll-indicator {
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: var(--brand-red);
                color: white;
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 11px;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                animation: pulse 2s infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            .terminal-empty {
                color: var(--text-muted);
                text-align: center;
                padding: 40px;
                font-style: italic;
            }

            /* Syntax highlighting classes */
            .syntax-keyword { font-weight: 600; }
            .syntax-string { font-style: italic; }
            .syntax-number { font-weight: 500; }
            .syntax-url { text-decoration: underline; cursor: pointer; }
            .syntax-error { font-weight: 600; }
            .syntax-success { font-weight: 500; }

            #console-section {
                position: relative;
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // Global Exports
    // ==========================================

    window.searchTerminal = searchTerminal;
    window.setLogLevelFilter = setLogLevelFilter;
    window.clearTerminalFilter = clearTerminalFilter;
    window.exportTerminalLogs = exportTerminalLogs;
    window.clearTerminalHistory = clearTerminalHistory;
    window.scrollToBottom = scrollToBottom;
    window.highlightSyntax = highlightSyntax;
    window.addConsoleEntry = addConsoleEntry;

    // ==========================================
    // Initialization
    // ==========================================

    function init() {
        injectStyles();
        setupTerminalToolbar();
        setupAutoScroll();

        // Migrate existing console logs
        if (state.console && state.console.logs) {
            state.console.logs.forEach(log => {
                terminalHistory.push({
                    text: log.text || log,
                    type: log.type || 'info',
                    level: detectLogLevel(log.text || log),
                    time: log.time || Date.now()
                });
            });
            applyFilters();
            renderTerminal();
        }

        console.log('[Phase13] Terminal Improvements initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
