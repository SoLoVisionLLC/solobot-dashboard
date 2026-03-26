// js/universal-search.js — Advanced universal search across all sessions and chat history
// Uses MiniSearch (loaded from CDN) for full-text search with TF-IDF ranking, fuzzy matching, and field boosting

(function() {
    'use strict';

    // ---------------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------------
    let searchIndex = null;
    let indexDocs = {};        // id → doc map for quick lookup
    let allSessions = [];      // session metadata from fetchSessions()
    let isIndexBuilt = false;
    let isBuildingIndex = false;
    let lastQuery = '';
    let searchHistory = JSON.parse(localStorage.getItem('universal_search_history') || '[]');

    const MAX_HISTORY = 20;
    const MAX_RESULTS = 100;

    // ---------------------------------------------------------------------------
    // MiniSearch options — tuned for chat search
    // ---------------------------------------------------------------------------
    var MINISEARCH_OPTIONS = {
        fields: ['text', 'agentName', 'sessionName', 'agentId'],
        weights: { text: 3, agentName: 1, sessionName: 1, agentId: 1 },
        storeFields: ['text', 'agentName', 'sessionName', 'agentId', 'sessionKey', 'timestamp', 'from', 'id', 'role'],
        searchOptions: {
            boost: { text: 3 },
            fuzzy: 0.2,
            prefix: true
        }
    };

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    window._universalSearch = {
        open: open,
        close: close,
        search: performSearch,
        isReady: function() { return isIndexBuilt; },
        rebuildIndex: rebuildIndex,
        getHistory: function() { return searchHistory; },
        navigateTo: navigateTo,
        searchFromHistory: searchFromHistory,
        toggleSession: toggleSession
    };

    // ---------------------------------------------------------------------------
    // Bootstrap: load MiniSearch from CDN if not already loaded
    // ---------------------------------------------------------------------------
    function loadMiniSearch() {
        return new Promise(function(resolve, reject) {
            if (window.MiniSearch) { resolve(); return; }
            var script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/minisearch/7.1.2/minisearch.umd.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = function() { reject(new Error('Failed to load MiniSearch')); };
            document.head.appendChild(script);
        });
    }

    // ---------------------------------------------------------------------------
    // Fetch all sessions
    // ---------------------------------------------------------------------------
    async function fetchAllSessions() {
        try {
            if (typeof fetchSessions === 'function') {
                allSessions = await fetchSessions();
            } else {
                var response = await fetch('/api/sessions');
                if (!response.ok) throw new Error('Failed to fetch sessions: ' + response.status);
                var raw = await response.json();
                allSessions = Array.isArray(raw) ? raw : (raw.sessions || raw.data || []);
            }
        } catch (e) {
            console.warn('[UniversalSearch] Could not fetch sessions:', e.message);
            allSessions = [];
        }
    }

    // ---------------------------------------------------------------------------
    // Fetch ALL messages from /api/state (includes chat.sessions map)
    // ---------------------------------------------------------------------------
    async function fetchAllMessages() {
        try {
            var response = await fetch('/api/state', { cache: 'no-store' });
            if (!response.ok) throw new Error('Failed to fetch state: ' + response.status);
            var state = await response.json();
            var sessionsMap = state && state.chat && state.chat.sessions ? state.chat.sessions : {};
            var messages = [];

            for (var sessionKey in sessionsMap) {
                if (!sessionsMap.hasOwnProperty(sessionKey)) continue;
                var sessionMessages = sessionsMap[sessionKey];
                if (!Array.isArray(sessionMessages)) continue;

                var sessionMeta = null;
                for (var i = 0; i < allSessions.length; i++) {
                    if (allSessions[i].key === sessionKey) { sessionMeta = allSessions[i]; break; }
                }
                var agentId = extractAgentId(sessionKey);

                for (var j = 0; j < sessionMessages.length; j++) {
                    var msg = sessionMessages[j];
                    if (!msg || typeof msg !== 'object') continue;
                    var text = extractMessageText(msg);
                    if (!text || !text.trim()) continue;

                    messages.push({
                        id: msg.id || (sessionKey + '-' + j),
                        text: text,
                        agentId: agentId,
                        agentName: getAgentDisplayName(agentId),
                        sessionKey: sessionKey,
                        sessionName: (sessionMeta ? (sessionMeta.name || sessionMeta.label || sessionKey) : sessionKey),
                        timestamp: msg.timestamp || msg.time || msg.createdAt || 0,
                        from: msg.from || msg.role || 'unknown',
                        role: msg.role || 'user',
                        images: (msg.images && msg.images.length > 0) || msg.image ? '[image]' : ''
                    });
                }
            }
            return messages;
        } catch (e) {
            console.warn('[UniversalSearch] Could not fetch all messages:', e.message);
            return [];
        }
    }

    // ---------------------------------------------------------------------------
    // Build or rebuild the search index
    // ---------------------------------------------------------------------------
    async function rebuildIndex() {
        if (isBuildingIndex) return;
        isBuildingIndex = true;
        isIndexBuilt = false;

        try {
            await loadMiniSearch();
            await fetchAllSessions();
            var messages = await fetchAllMessages();

            indexDocs = {};
            searchIndex = new MiniSearch(MINISEARCH_OPTIONS);

            for (var i = 0; i < messages.length; i++) {
                var msg = messages[i];
                var id = String(i);
                indexDocs[id] = msg;
                searchIndex.add(Object.assign({}, msg, { id: id }));
            }

            isIndexBuilt = true;
            console.log('[UniversalSearch] Index built: ' + messages.length + ' messages across ' + allSessions.length + ' sessions');
        } catch (e) {
            console.error('[UniversalSearch] Index build failed:', e);
        } finally {
            isBuildingIndex = false;
        }
    }

    // ---------------------------------------------------------------------------
    // Perform search
    // ---------------------------------------------------------------------------
    function performSearch(query, options) {
        options = options || {};
        if (!query || !query.trim()) {
            lastQuery = '';
            return [];
        }
        query = query.trim();
        lastQuery = query;

        if (!isIndexBuilt || !searchIndex) return [];

        var agentFilter = options.agentFilter || 'all';
        var dateFrom = options.dateFrom || '';
        var dateTo = options.dateTo || '';
        var limit = options.limit || MAX_RESULTS;

        try {
            var results = searchIndex.search(query, MINISEARCH_OPTIONS.searchOptions);

            // Post-filter by agent
            if (agentFilter !== 'all') {
                results = results.filter(function(r) {
                    var doc = indexDocs[r.id];
                    return doc && doc.agentId === agentFilter;
                });
            }

            // Post-filter by date range
            if (dateFrom) {
                var fromMs = new Date(dateFrom).getTime();
                results = results.filter(function(r) {
                    var doc = indexDocs[r.id];
                    return doc && (doc.timestamp || 0) >= fromMs;
                });
            }
            if (dateTo) {
                var toMs = new Date(dateTo).getTime() + 86400000;
                results = results.filter(function(r) {
                    var doc = indexDocs[r.id];
                    return doc && (doc.timestamp || 0) <= toMs;
                });
            }

            results = results.slice(0, limit);

            return results.map(function(r) {
                var doc = indexDocs[r.id] || {};
                return {
                    text: doc.text || '',
                    agentId: doc.agentId || '',
                    agentName: doc.agentName || '',
                    sessionKey: doc.sessionKey || '',
                    sessionName: doc.sessionName || '',
                    timestamp: doc.timestamp || 0,
                    from: doc.from || '',
                    role: doc.role || '',
                    images: doc.images || '',
                    _score: r.score,
                    _match: r.match
                };
            });
        } catch (e) {
            console.error('[UniversalSearch] Search error:', e);
            return [];
        }
    }

    // ---------------------------------------------------------------------------
    // Open search modal
    // ---------------------------------------------------------------------------
    function open() {
        renderModal();
        document.body.classList.add('universal-search-open');

        if (!isIndexBuilt && !isBuildingIndex) {
            rebuildIndex();
        }

        var inputEl = document.getElementById('universal-search-input');
        if (inputEl) {
            setTimeout(function() { inputEl.focus(); }, 50);
        }
    }

    function close() {
        var modal = document.getElementById('universal-search-modal');
        if (modal) modal.remove();
        var backdrop = document.getElementById('universal-search-backdrop');
        if (backdrop) backdrop.remove();
        document.body.classList.remove('universal-search-open');
        document.body.style.overflow = '';
    }

    // ---------------------------------------------------------------------------
    // Render modal HTML
    // ---------------------------------------------------------------------------
    function renderModal() {
        var existing = document.getElementById('universal-search-modal');
        if (existing) existing.remove();

        var uniqueAgents = getUniqueAgents();
        var agentOptionsHtml = uniqueAgents.map(function(a) {
            return '<option value="' + escapeHtmlAttr(a.id) + '">' + escapeHtml(a.name) + '</option>';
        }).join('');

        var historyHtml = '';
        if (searchHistory.length > 0) {
            var historyItems = searchHistory.slice(0, 5).map(function(q) {
                return '<button class="universal-search-history-item" data-query="' + escapeHtmlAttr(q) + '">' + escapeHtml(q) + '</button>';
            }).join('');
            historyHtml = '<div class="universal-search-history"><div class="universal-search-history-title">Recent searches</div><div class="universal-search-history-items">' + historyItems + '</div></div>';
        }

        var modal = document.createElement('div');
        modal.id = 'universal-search-modal';
        modal.innerHTML =
            '<div id="universal-search-backdrop"></div>' +
            '<div class="universal-search-container" role="dialog" aria-label="Universal Search">' +
                '<div class="universal-search-header">' +
                    '<div class="universal-search-title">' +
                        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                        'Universal Search' +
                    '</div>' +
                    '<div class="universal-search-shortcut"><kbd>Esc</kbd> to close &nbsp;·&nbsp; <kbd>Ctrl+K</kbd> to open</div>' +
                '</div>' +
                '<div class="universal-search-controls">' +
                    '<div class="universal-search-filters">' +
                        '<select id="universal-search-agent" class="input" title="Filter by agent"><option value="all">All Agents</option>' + agentOptionsHtml + '</select>' +
                        '<input type="date" id="universal-search-from" class="input" title="From date" />' +
                        '<input type="date" id="universal-search-to" class="input" title="To date" />' +
                        '<button id="universal-search-clear-filters" class="btn" style="font-size:11px;padding:4px 8px;">Clear filters</button>' +
                    '</div>' +
                '</div>' +
                '<div class="universal-search-input-wrap">' +
                    '<input id="universal-search-input" type="text" class="input universal-search-input" placeholder="Search all chats, all sessions... (fuzzy + prefix enabled)" autocomplete="off" spellcheck="false" />' +
                    '<div class="universal-search-count" id="universal-search-count"></div>' +
                '</div>' +
                '<div class="universal-search-body" id="universal-search-body">' + renderEmptyState() + '</div>' +
                historyHtml +
            '</div>';

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        var backdrop = document.getElementById('universal-search-backdrop');
        if (backdrop) {
            backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9998;backdrop-filter:blur(2px);';
            backdrop.addEventListener('click', close);
        }

        wireModalEvents();
    }

    function renderEmptyState() {
        if (!isIndexBuilt) {
            return '<div class="universal-search-empty">' +
                '<div class="universal-search-spinner"></div>' +
                '<p>Building search index...</p>' +
                '<p style="font-size:11px;color:var(--text-muted)">Indexing all sessions and messages</p>' +
            '</div>';
        }
        return '<div class="universal-search-empty">' +
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
            '<p>Search across all chats, sessions, and agents</p>' +
            '<p style="font-size:11px;color:var(--text-muted)">Supports fuzzy matching and prefix search</p>' +
        '</div>';
    }

    // ---------------------------------------------------------------------------
    // Wire modal events
    // ---------------------------------------------------------------------------
    function wireModalEvents() {
        var input = document.getElementById('universal-search-input');
        var agentSelect = document.getElementById('universal-search-agent');
        var dateFrom = document.getElementById('universal-search-from');
        var dateTo = document.getElementById('universal-search-to');
        var clearFilters = document.getElementById('universal-search-clear-filters');
        var body = document.getElementById('universal-search-body');

        var debounceTimer = null;

        function doSearch() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function() {
                var query = input && input.value ? input.value.trim() : '';
                var agent = agentSelect ? agentSelect.value : 'all';
                var from = dateFrom ? dateFrom.value : '';
                var to = dateTo ? dateTo.value : '';

                if (!query) {
                    body.innerHTML = renderEmptyState();
                    var countEl = document.getElementById('universal-search-count');
                    if (countEl) countEl.textContent = '';
                    return;
                }

                var results = performSearch(query, { agentFilter: agent, dateFrom: from, dateTo: to });
                body.innerHTML = renderResults(results, query);

                var countEl = document.getElementById('universal-search-count');
                if (countEl) countEl.textContent = results.length + ' result' + (results.length !== 1 ? 's' : '');
            }, 120);
        }

        if (input) input.addEventListener('input', doSearch);
        if (agentSelect) agentSelect.addEventListener('change', doSearch);
        if (dateFrom) dateFrom.addEventListener('change', doSearch);
        if (dateTo) dateTo.addEventListener('change', doSearch);

        if (clearFilters) {
            clearFilters.addEventListener('click', function() {
                if (agentSelect) agentSelect.value = 'all';
                if (dateFrom) dateFrom.value = '';
                if (dateTo) dateTo.value = '';
                doSearch();
            });
        }

        // Recent history items
        var historyItems = document.querySelectorAll('.universal-search-history-item');
        for (var k = 0; k < historyItems.length; k++) {
            historyItems[k].addEventListener('click', function(e) {
                var query = e.target.getAttribute('data-query') || e.target.textContent;
                if (input) input.value = query;
                doSearch();
                if (input) input.focus();
            });
        }

        // Keyboard handlers on modal
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', onKey);
            }
        });
    }

    // ---------------------------------------------------------------------------
    // Render search results grouped by session
    // ---------------------------------------------------------------------------
    function renderResults(results, query) {
        if (results.length === 0) {
            return '<div class="universal-search-empty">' +
                '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                '<p>No results for "<strong>' + escapeHtml(query) + '</strong>"</p>' +
                '<p style="font-size:11px;color:var(--text-muted)">Try different keywords or remove filters</p>' +
            '</div>';
        }

        // Group by session
        var bySession = {};
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var sk = r.sessionKey || 'unknown';
            if (!bySession[sk]) bySession[sk] = [];
            bySession[sk].push(r);
        }

        // Sort sessions by most recent message
        var sortedSessions = [];
        for (var sessKey in bySession) {
            if (!bySession.hasOwnProperty(sessKey)) continue;
            var msgs = bySession[sessKey];
            var maxTs = Math.max.apply(null, msgs.map(function(m) { return m.timestamp || 0; }));
            sortedSessions.push({ key: sessKey, msgs: msgs, maxTs: maxTs });
        }
        sortedSessions.sort(function(a, b) { return b.maxTs - a.maxTs; });

        var html = '<div class="universal-search-results">';
        for (var si = 0; si < sortedSessions.length; si++) {
            var sess = sortedSessions[si];
            var sessionMeta = null;
            for (var ai = 0; ai < allSessions.length; ai++) {
                if (allSessions[ai].key === sess.key) { sessionMeta = allSessions[ai]; break; }
            }
            var sessAgentId = extractAgentId(sess.key);
            var sessAgentName = getAgentDisplayName(sessAgentId);
            var sessLabel = sessionMeta ? (sessionMeta.name || sessionMeta.label || sess.key) : sess.key;
            var safeSessKey = CSS.escape(sess.key);

            html += '<div class="universal-search-session-group">';
            html += '<div class="universal-search-session-header" data-session="' + safeSessKey + '">';
            html += '<span class="universal-search-session-caret" id="caret-' + safeSessKey + '">▾</span> ';
            html += '<span class="universal-search-session-name">' + escapeHtml(sessLabel) + '</span> ';
            html += '<span class="universal-search-session-agent">' + escapeHtml(sessAgentName) + '</span> ';
            html += '<span class="universal-search-session-count">' + sess.msgs.length + ' match' + (sess.msgs.length !== 1 ? 'es' : '') + '</span>';
            html += '</div>';
            html += '<div class="universal-search-session-messages" id="session-msgs-' + safeSessKey + '">';
            for (var mi = 0; mi < sess.msgs.length; mi++) {
                html += renderResultItem(sess.msgs[mi], query, mi === 0);
            }
            html += '</div></div>';
        }
        html += '</div>';
        return html;
    }

    function renderResultItem(msg, query, isFirst) {
        var highlighted = highlightMatches(msg.text || '', query);
        var time = msg.timestamp ? formatTimestamp(msg.timestamp) : '';
        var isUser = msg.from === 'user' || msg.role === 'user';
        var roleIcon = isUser ? '👤' : getAgentEmoji(msg.agentId);
        var score = msg._score ? msg._score.toFixed(2) : '';
        var safeSessKey = CSS.escape(msg.sessionKey);

        var html = '<div class="universal-search-result-item' + (isFirst ? ' is-first' : '') + '" ';
        html += 'data-session="' + safeSessKey + '" data-timestamp="' + (msg.timestamp || 0) + '">';
        html += '<div class="universal-search-result-meta">';
        html += '<span class="universal-search-result-icon">' + roleIcon + '</span>';
        html += '<span class="universal-search-result-from">' + escapeHtml(msg.from || msg.agentName || 'Unknown') + '</span>';
        html += '<span class="universal-search-result-time">' + time + '</span>';
        if (score) html += '<span class="universal-search-result-score" title="Relevance score">' + score + '</span>';
        if (msg.images) html += '<span class="universal-search-result-images">📎</span>';
        html += '</div>';
        html += '<div class="universal-search-result-text">' + highlighted + '</div>';
        html += '</div>';
        return html;
    }

    // ---------------------------------------------------------------------------
    // Highlight matching terms in text
    // ---------------------------------------------------------------------------
    function highlightMatches(text, query) {
        if (!text || !query) return escapeHtml(text || '');
        var terms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length > 1; });
        var escaped = escapeHtml(text);
        for (var i = 0; i < terms.length; i++) {
            var term = terms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var regex = new RegExp('(' + term + ')', 'gi');
            escaped = escaped.replace(regex, '<mark>$1</mark>');
        }
        return escaped;
    }

    // ---------------------------------------------------------------------------
    // Navigate to a specific message in its session
    // ---------------------------------------------------------------------------
    function navigateTo(sessionKey, timestamp) {
        timestamp = Number(timestamp) || 0;

        // Save query to history
        if (lastQuery && searchHistory.indexOf(lastQuery) === -1) {
            searchHistory.unshift(lastQuery);
            searchHistory = searchHistory.slice(0, MAX_HISTORY);
            localStorage.setItem('universal_search_history', JSON.stringify(searchHistory));
        }

        close();

        // Switch to the target session
        if (typeof switchToSession === 'function') {
            switchToSession(sessionKey, { scrollToTimestamp: timestamp });
        } else if (typeof window.switchToSession === 'function') {
            window.switchToSession(sessionKey, { scrollToTimestamp: timestamp });
        } else {
            window.location.hash = 'chat/' + encodeURIComponent(sessionKey);
        }
    }

    function searchFromHistory(query) {
        var input = document.getElementById('universal-search-input');
        if (input) {
            input.value = query;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
        }
    }

    // Toggle session group expand/collapse
    function toggleSession(sessionKey) {
        var el = document.getElementById('session-msgs-' + CSS.escape(sessionKey));
        var caret = document.getElementById('caret-' + CSS.escape(sessionKey));
        if (!el) return;
        var isHidden = el.style.display === 'none';
        el.style.display = isHidden ? '' : 'none';
        if (caret) caret.textContent = isHidden ? '▾' : '▸';
    }

    // Wire up session header toggle clicks
    document.addEventListener('click', function(e) {
        var header = e.target.closest('.universal-search-session-header');
        if (header) {
            var sk = header.getAttribute('data-session');
            if (sk) toggleSession(sk);
        }
    });

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------
    function getUniqueAgents() {
        var seen = {};
        var docs = Object.values(indexDocs);
        for (var i = 0; i < docs.length; i++) {
            var doc = docs[i];
            if (doc.agentId && !seen[doc.agentId]) {
                seen[doc.agentId] = doc.agentName || doc.agentId;
            }
        }
        var entries = [];
        for (var id in seen) entries.push({ id: id, name: seen[id] });
        entries.sort(function(a, b) { return a.name.localeCompare(b.name); });
        return entries;
    }

    function extractAgentId(sessionKey) {
        if (!sessionKey) return 'main';
        var match = String(sessionKey).match(/^agent:([^:]+):/);
        return match ? match[1] : 'main';
    }

    function extractMessageText(msg) {
        if (!msg) return '';
        var text = msg.text || msg.content || msg.message || '';
        return String(text).replace(/<[^>]*>/g, '').trim();
    }

    function getAgentDisplayName(agentId) {
        if (typeof window.getAgentDisplayName === 'function') return window.getAgentDisplayName(agentId);
        if (typeof getAgentDisplayName === 'function') return getAgentDisplayName(agentId);
        return agentId ? agentId.charAt(0).toUpperCase() + agentId.slice(1) : 'Unknown';
    }

    function getAgentEmoji(agentId) {
        if (typeof window.getAgentEmoji === 'function') return window.getAgentEmoji(agentId);
        return '🤖';
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        var d = new Date(Number(ts));
        if (isNaN(d)) return '';
        var now = new Date();
        var diffDays = Math.floor((now - d) / 86400000);
        if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeHtmlAttr(str) {
        if (!str) return '';
        return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------------------------
    // Global keyboard shortcut: Ctrl/Cmd+K to open
    // ---------------------------------------------------------------------------
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            open();
        }
    });

})();
