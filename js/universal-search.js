// js/universal-search.js — Advanced universal search across all sessions and chat history
// Built-in search engine: custom inverted index with TF-IDF, fuzzy matching, prefix search
// No external dependencies required.

(function() {
    'use strict';

    // ============================================================
    //  MINI-SEARCH ENGINE (built-in, no external CDN needed)
    // ============================================================
    // A lightweight in-browser full-text search engine with:
    // - Inverted index for fast lookups
    // - TF-IDF scoring for relevance ranking
    // - Fuzzy matching (Levenshtein distance ≤ 2)
    // - Prefix matching for instant feedback
    // - Field boosting (text > agentName > sessionName)

    var MiniSearchEngine = (function() {

        // ─── Levenshtein distance ───────────────────────────────────────────────
        function levenshtein(a, b) {
            if (!a || !a.length) return b ? b.length : 0;
            if (!b || !b.length) return a.length;
            var m = a.length, n = b.length;
            var dp = new Array(m + 1);
            for (var i = 0; i <= m; i++) dp[i] = new Array(n + 1);
            for (var j = 0; j <= n; j++) dp[0][j] = j;
            for (var i2 = 0; i2 <= m; i2++) dp[i2][0] = i2;
            for (var i3 = 1; i3 <= m; i3++) {
                for (var j2 = 1; j2 <= n; j2++) {
                    var cost = a[i3 - 1] === b[j2 - 1] ? 0 : 1;
                    dp[i3][j2] = Math.min(
                        dp[i3 - 1][j2] + 1,      // deletion
                        dp[i3][j2 - 1] + 1,      // insertion
                        dp[i3 - 1][j2 - 1] + cost // substitution
                    );
                }
            }
            return dp[m][n];
        }

        // ─── Tokenizer ───────────────────────────────────────────────────────────
        function tokenize(text) {
            if (!text) return [];
            return String(text)
                .toLowerCase()
                .replace(/[^a-z0-9\s\-_']+/g, ' ')
                .split(/\s+/)
                .filter(function(t) { return t.length > 1; });
        }

        // ─── IDF cache ───────────────────────────────────────────────────────────
        var idfCache = {};

        function computeIDF(index, term, totalDocs) {
            var key = term;
            if (idfCache[key] !== undefined) return idfCache[key];
            var docsWithTerm = 0;
            for (var docId in index) {
                if (index.hasOwnProperty(docId) && index[docId].terms && index[docId].terms[term]) {
                    docsWithTerm++;
                }
            }
            // IDF: log((totalDocs + 1) / (docsWithTerm + 1)) + 1 (smoothed)
            var idf = Math.log((totalDocs + 1) / (docsWithTerm + 1)) + 1;
            idfCache[key] = idf;
            return idf;
        }

        // ─── Main engine ─────────────────────────────────────────────────────────
        function createEngine(options) {
            options = options || {};
            var fields = options.fields || ['text'];
            var weights = options.weights || {};
            var storeFields = options.storeFields || [];
            var fuzzy = options.fuzzy !== undefined ? options.fuzzy : 0.2;
            var prefix = options.prefix !== undefined ? options.prefix : true;

            var index = {};       // term → { docId → { tf, pos[] } }
            var docStore = {};    // docId → stored fields
            var docCount = 0;
            var fieldIndex = {};  // docId → { fieldName → text }

            var self = {};

            self.add = function(doc) {
                var id = doc.id !== undefined ? String(doc.id) : String(docCount);
                var docFields = {};
                var allTokens = [];

                for (var fi = 0; fi < fields.length; fi++) {
                    var fieldName = fields[fi];
                    var text = doc[fieldName] || '';
                    var tokens = tokenize(text);
                    docFields[fieldName] = tokens;
                    allTokens = allTokens.concat(tokens);
                }

                // Store
                var stored = { id: id };
                for (var si = 0; si < storeFields.length; si++) {
                    stored[storeFields[si]] = doc[storeFields[si]];
                }
                docStore[id] = stored;
                fieldIndex[id] = docFields;

                // Index
                var uniqueTokens = [];
                var seen = {};
                for (var ti = 0; ti < allTokens.length; ti++) {
                    var tok = allTokens[ti];
                    if (!seen[tok]) { seen[tok] = true; uniqueTokens.push(tok); }
                }

                for (var ui = 0; ui < uniqueTokens.length; ui++) {
                    var term = uniqueTokens[ui];
                    if (!index[term]) index[term] = {};
                    var tf = 0;
                    for (var fj = 0; fj < fields.length; fj++) {
                        var fn = fields[fj];
                        var fieldTokens = docFields[fn] || [];
                        for (var ft = 0; ft < fieldTokens.length; ft++) {
                            if (fieldTokens[ft] === term) tf++;
                        }
                    }
                    if (!index[term][id]) index[term][id] = { tf: 0 };
                    index[term][id].tf += tf * (weights[fields[fj]] || 1);
                }

                docCount++;
                return self;
            };

            self.search = function(query, searchOptions) {
                searchOptions = searchOptions || {};
                var sFuzzy = searchOptions.fuzzy !== undefined ? searchOptions.fuzzy : fuzzy;
                var sPrefix = searchOptions.prefix !== undefined ? searchOptions.prefix : prefix;
                var boost = searchOptions.boost || {};

                var queryTokens = tokenize(query);
                if (!queryTokens.length) return [];

                var scored = {};
                var matchInfo = {};

                for (var qi = 0; qi < queryTokens.length; qi++) {
                    var qtok = queryTokens[qi];
                    var matchingTerms = [];

                    // Exact match
                    if (index[qtok]) matchingTerms.push(qtok);

                    // Fuzzy match
                    if (sFuzzy > 0) {
                        var maxDist = sFuzzy <= 1 ? Math.ceil(qtok.length * sFuzzy) : Math.ceil(sFuzzy);
                        for (var term in index) {
                            if (!index.hasOwnProperty(term)) continue;
                            if (matchingTerms.indexOf(term) >= 0) continue;
                            var dist = levenshtein(qtok, term);
                            if (dist <= maxDist && dist <= 2) matchingTerms.push(term);
                        }
                    }

                    // Prefix match
                    if (sPrefix) {
                        for (var pterm in index) {
                            if (!index.hasOwnProperty(pterm)) continue;
                            if (matchingTerms.indexOf(pterm) >= 0) continue;
                            if (pterm.indexOf(qtok) === 0) matchingTerms.push(pterm);
                        }
                    }

                    // Score matching docs
                    for (var mi = 0; mi < matchingTerms.length; mi++) {
                        var term = matchingTerms[mi];
                        var idf = computeIDF(index, term, docCount);
                        var termDocs = index[term];

                        for (var docId in termDocs) {
                            if (!termDocs.hasOwnProperty(docId)) continue;
                            var tf = termDocs[docId].tf || 1;
                            var fieldBoost = 1;
                            // Check which field matched
                            var docFields = fieldIndex[docId] || {};
                            for (var fdName in docFields) {
                                if (!docFields.hasOwnProperty(fdName)) continue;
                                var fTokens = docFields[fdName] || [];
                                for (var fti = 0; fti < fTokens.length; fti++) {
                                    if (fTokens[fti] === term) {
                                        fieldBoost = Math.max(fieldBoost, weights[fdName] || 1);
                                        if (boost[fdName]) fieldBoost *= boost[fdName];
                                    }
                                }
                            }
                            var tfNorm = 1 + Math.log(tf + 1);
                            var score = tfNorm * idf * fieldBoost;

                            if (!scored[docId]) { scored[docId] = 0; matchInfo[docId] = {}; }
                            scored[docId] += score;
                            if (!matchInfo[docId][term]) matchInfo[docId][term] = 0;
                            matchInfo[docId][term]++;
                        }
                    }
                }

                var results = [];
                for (var did in scored) {
                    if (!scored.hasOwnProperty(did)) continue;
                    results.push({
                        id: did,
                        score: scored[did],
                        match: matchInfo[did]
                    });
                }

                results.sort(function(a, b) { return b.score - a.score; });
                return results;
            };

            self.getStoredFields = function(id) {
                return docStore[id] || null;
            };

            self.getDocCount = function() { return docCount; };

            self.clear = function() {
                index = {};
                docStore = {};
                fieldIndex = {};
                docCount = 0;
                idfCache = {};
            };

            return self;
        }

        return { create: createEngine };
    })();

    // ============================================================
    //  STATE
    // ============================================================
    var searchEngine = null;
    var indexDocs = {};       // id → doc map
    var allSessions = [];
    var isIndexBuilt = false;
    var isBuildingIndex = false;
    var lastQuery = '';
    var searchHistory = JSON.parse(localStorage.getItem('universal_search_history') || '[]');

    var MAX_HISTORY = 20;
    var MAX_RESULTS = 100;

    // ============================================================
    //  PUBLIC API
    // ============================================================
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

    // ============================================================
    //  FETCH ALL SESSIONS via gateway or HTTP
    // ============================================================
    async function fetchAllSessions() {
        try {
            // Try gateway WebSocket API first (most authoritative)
            if (window.gateway && typeof window.gateway.listSessions === 'function' && window.gateway.connected) {
                try {
                    var result = await window.gateway.listSessions({ includeDerivedTitles: true });
                    if (result && Array.isArray(result.sessions)) {
                        allSessions = result.sessions;
                        console.log('[UniversalSearch] Gateway loaded ' + allSessions.length + ' sessions');
                        return;
                    }
                } catch (gwErr) {
                    console.warn('[UniversalSearch] Gateway listSessions failed:', gwErr.message);
                }
            }
            // Fallback: use dashboard's existing fetchSessions or HTTP
            if (typeof fetchSessions === 'function') {
                allSessions = await fetchSessions();
            } else {
                var resp = await fetch('/api/sessions');
                if (!resp.ok) throw new Error('Failed: ' + resp.status);
                var raw = await resp.json();
                allSessions = Array.isArray(raw) ? raw : (raw.sessions || raw.data || []);
            }
        } catch (e) {
            console.warn('[UniversalSearch] Could not fetch sessions:', e.message);
            allSessions = [];
        }
    }

    // ============================================================
    //  FETCH MESSAGES FOR ONE SESSION (gateway WebSocket preferred)
    // ============================================================
    async function fetchSessionMessages(sessionKey, sessionMeta) {
        var agentId = extractAgentId(sessionKey);
        var sessionName = sessionMeta ? (sessionMeta.name || sessionMeta.label || sessionKey) : sessionKey;
        var messages = [];

        // Try gateway WebSocket chat.history RPC
        if (window.gateway && typeof window.gateway._request === 'function' && window.gateway.connected) {
            try {
                var result = await window.gateway._request('chat.history', {
                    sessionKey: sessionKey,
                    limit: 300
                });
                if (result && Array.isArray(result.messages)) {
                    for (var i = 0; i < result.messages.length; i++) {
                        var msg = result.messages[i];
                        if (!msg || typeof msg !== 'object') continue;
                        var text = extractMessageText(msg);
                        if (!text || !text.trim()) continue;
                        messages.push({
                            id: msg.id || (sessionKey + '-' + i),
                            text: text,
                            agentId: agentId,
                            agentName: getAgentDisplayName(agentId),
                            sessionKey: sessionKey,
                            sessionName: sessionName,
                            timestamp: msg.timestamp || msg.time || msg.createdAt || 0,
                            from: msg.from || msg.role || 'unknown',
                            role: msg.role || 'user',
                            images: (msg.images && msg.images.length > 0) || msg.image ? '[image]' : ''
                        });
                    }
                    return messages;
                }
            } catch (e) {
                // Fall through to HTTP fallback
            }
        }

        // HTTP fallback: /api/state session map
        try {
            var resp = await fetch('/api/state', { cache: 'no-store' });
            if (resp.ok) {
                var state = await resp.json();
                var sessionsMap = (state && state.chat && state.chat.sessions) ? state.chat.sessions : {};
                var sessionMessages = sessionsMap[sessionKey];
                if (Array.isArray(sessionMessages)) {
                    for (var j = 0; j < sessionMessages.length; j++) {
                        var msg2 = sessionMessages[j];
                        if (!msg2 || typeof msg2 !== 'object') continue;
                        var text2 = extractMessageText(msg2);
                        if (!text2 || !text2.trim()) continue;
                        messages.push({
                            id: msg2.id || (sessionKey + '-' + j),
                            text: text2,
                            agentId: agentId,
                            agentName: getAgentDisplayName(agentId),
                            sessionKey: sessionKey,
                            sessionName: sessionName,
                            timestamp: msg2.timestamp || msg2.time || msg2.createdAt || 0,
                            from: msg2.from || msg2.role || 'unknown',
                            role: msg2.role || 'user',
                            images: (msg2.images && msg2.images.length > 0) || msg2.image ? '[image]' : ''
                        });
                    }
                }
            }
        } catch (e2) {
            // silent
        }

        return messages;
    }

    // ============================================================
    //  FETCH ALL MESSAGES ACROSS ALL SESSIONS
    // ============================================================
    async function fetchAllMessages() {
        if (!allSessions || allSessions.length === 0) {
            console.warn('[UniversalSearch] No sessions to fetch messages from');
            return [];
        }

        // Try /api/state first — if it has a rich session map, use it (one request)
        try {
            var resp = await fetch('/api/state', { cache: 'no-store' });
            if (resp.ok) {
                var state = await resp.json();
                var sessionsMap = (state && state.chat && state.chat.sessions) ? state.chat.sessions : {};
                var sessionCount = Object.keys(sessionsMap).length;
                var totalMsgs = 0;
                for (var k in sessionsMap) {
                    if (Array.isArray(sessionsMap[k])) totalMsgs += sessionsMap[k].length;
                }
                // If we have a populated map with messages, use it
                if (sessionCount > 3 && totalMsgs > 10) {
                    console.log('[UniversalSearch] /api/state has ' + sessionCount + ' sessions with ' + totalMsgs + ' messages');
                    var allMessages = [];
                    for (var sk in sessionsMap) {
                        if (!sessionsMap.hasOwnProperty(sk)) continue;
                        if (!Array.isArray(sessionsMap[sk])) continue;
                        var sMeta = null;
                        for (var si = 0; si < allSessions.length; si++) {
                            if (allSessions[si].key === sk) { sMeta = allSessions[si]; break; }
                        }
                        var aId = extractAgentId(sk);
                        for (var mi = 0; mi < sessionsMap[sk].length; mi++) {
                            var m = sessionsMap[sk][mi];
                            if (!m || typeof m !== 'object') continue;
                            var txt = extractMessageText(m);
                            if (!txt || !txt.trim()) continue;
                            allMessages.push({
                                id: m.id || (sk + '-' + mi),
                                text: txt,
                                agentId: aId,
                                agentName: getAgentDisplayName(aId),
                                sessionKey: sk,
                                sessionName: sMeta ? (sMeta.name || sMeta.label || sk) : sk,
                                timestamp: m.timestamp || m.time || m.createdAt || 0,
                                from: m.from || m.role || 'unknown',
                                role: m.role || 'user',
                                images: (m.images && m.images.length > 0) || m.image ? '[image]' : ''
                            });
                        }
                    }
                    console.log('[UniversalSearch] Indexed ' + allMessages.length + ' messages from /api/state session map');
                    return allMessages;
                }
            }
        } catch (e) {
            console.warn('[UniversalSearch] /api/state check failed:', e.message);
        }

        // No rich session map — fetch per-session via gateway in parallel batches
        console.log('[UniversalSearch] Fetching messages per-session via gateway (' + allSessions.length + ' sessions)...');
        var allMessages = [];
        var BATCH = 8;
        for (var b = 0; b < allSessions.length; b += BATCH) {
            var batchSessions = allSessions.slice(b, b + BATCH);
            var batchResults = await Promise.all(
                batchSessions.map(function(s) {
                    return fetchSessionMessages(s.key || s.sessionKey || s.name, s);
                })
            );
            for (var r = 0; r < batchResults.length; r++) {
                allMessages = allMessages.concat(batchResults[r]);
            }
            var progress = Math.min(b + BATCH, allSessions.length);
            console.log('[UniversalSearch] Progress: ' + progress + '/' + allSessions.length + ' sessions, ' + allMessages.length + ' messages indexed');
        }

        console.log('[UniversalSearch] Total: ' + allMessages.length + ' messages from ' + allSessions.length + ' sessions');
        return allMessages;
    }

    // ============================================================
    //  BUILD / REBUILD INDEX
    // ============================================================
    async function rebuildIndex() {
        if (isBuildingIndex) return;
        isBuildingIndex = true;
        isIndexBuilt = false;

        try {
            searchEngine = MiniSearchEngine.create({
                fields: ['text', 'agentName', 'sessionName', 'agentId'],
                weights: { text: 3, agentName: 1, sessionName: 1, agentId: 1 },
                storeFields: ['text', 'agentName', 'sessionName', 'agentId', 'sessionKey', 'timestamp', 'from', 'role', 'images', 'id'],
                fuzzy: 0.25,
                prefix: true
            });

            await fetchAllSessions();
            var messages = await fetchAllMessages();

            indexDocs = {};
            for (var i = 0; i < messages.length; i++) {
                var msg = messages[i];
                var id = String(i);
                indexDocs[id] = msg;
                searchEngine.add(Object.assign({}, msg, { id: id }));
            }

            isIndexBuilt = true;
            console.log('[UniversalSearch] Index built: ' + messages.length + ' messages across ' + allSessions.length + ' sessions');

            // If modal is open, refresh results AND update agent dropdown
            var bodyEl = document.getElementById('universal-search-body');
            if (bodyEl) {
                var inputEl = document.getElementById('universal-search-input');
                if (inputEl && inputEl.value.trim()) {
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    bodyEl.innerHTML = renderEmptyState();
                }
            }
            // Always update the agent dropdown after a fresh build
            updateAgentDropdown();
        } catch (e) {
            console.error('[UniversalSearch] Index build failed:', e);
        } finally {
            isBuildingIndex = false;
        }
    }

    // Update the agent dropdown with fresh options from indexDocs
    function updateAgentDropdown() {
        var select = document.getElementById('universal-search-agent');
        if (!select) return;
        var uniqueAgents = getUniqueAgents();
        var currentVal = select.value;
        var html = '<option value="all">All Agents</option>';
        for (var i = 0; i < uniqueAgents.length; i++) {
            html += '<option value="' + escapeHtmlAttr(uniqueAgents[i].id) + '">' + escapeHtml(uniqueAgents[i].name) + '</option>';
        }
        select.innerHTML = html;
        // Restore previous selection if still valid
        if (currentVal && currentVal !== 'all') {
            var opts = select.querySelectorAll('option');
            for (var j = 0; j < opts.length; j++) {
                if (opts[j].value === currentVal) {
                    select.value = currentVal;
                    break;
                }
            }
        }
    }

    // ============================================================
    //  PERFORM SEARCH
    // ============================================================
    function performSearch(query, options) {
        options = options || {};
        if (!query || !query.trim()) { lastQuery = ''; return []; }
        query = query.trim();
        lastQuery = query;

        if (!isIndexBuilt || !searchEngine) return [];

        var agentFilter = options.agentFilter || 'all';
        var dateFrom = options.dateFrom || '';
        var dateTo = options.dateTo || '';
        var limit = options.limit || MAX_RESULTS;

        try {
            var rawResults = searchEngine.search(query, {
                fuzzy: 0.25,
                prefix: true,
                boost: { text: 3 }
            });

            var results = [];
            for (var i = 0; i < rawResults.length; i++) {
                var raw = rawResults[i];
                var doc = indexDocs[raw.id];
                if (!doc) continue;

                // Agent filter
                if (agentFilter !== 'all' && doc.agentId !== agentFilter) continue;

                // Date from
                if (dateFrom) {
                    var fromMs = new Date(dateFrom).getTime();
                    if ((doc.timestamp || 0) < fromMs) continue;
                }

                // Date to
                if (dateTo) {
                    var toMs = new Date(dateTo).getTime() + 86400000;
                    if ((doc.timestamp || 0) > toMs) continue;
                }

                results.push({
                    text: doc.text || '',
                    agentId: doc.agentId || '',
                    agentName: doc.agentName || '',
                    sessionKey: doc.sessionKey || '',
                    sessionName: doc.sessionName || '',
                    timestamp: doc.timestamp || 0,
                    from: doc.from || '',
                    role: doc.role || '',
                    images: doc.images || '',
                    _score: raw.score,
                    _match: raw.match
                });
            }

            return results.slice(0, limit);
        } catch (e) {
            console.error('[UniversalSearch] Search error:', e);
            return [];
        }
    }

    // ============================================================
    //  OPEN / CLOSE MODAL
    // ============================================================
    function open() {
        // If index is already built, render immediately with correct agents.
        // Otherwise render with empty state, then rebuild + update dropdown.
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

    // ============================================================
    //  RENDER MODAL
    // ============================================================
    function renderModal() {
        var existing = document.getElementById('universal-search-modal');
        if (existing) existing.remove();

        var uniqueAgents = getUniqueAgents();
        var agentOptions = '<option value="all">All Agents</option>';
        for (var ai = 0; ai < uniqueAgents.length; ai++) {
            agentOptions += '<option value="' + escapeHtmlAttr(uniqueAgents[ai].id) + '">' + escapeHtml(uniqueAgents[ai].name) + '</option>';
        }

        var historyHtml = '';
        if (searchHistory.length > 0) {
            var historyItems = '';
            for (var hi = 0; hi < Math.min(searchHistory.length, 5); hi++) {
                historyItems += '<button class="us-history-chip" data-q="' + escapeHtmlAttr(searchHistory[hi]) + '">' + escapeHtml(searchHistory[hi]) + '</button>';
            }
            historyHtml = '<div class="us-section-header"><span class="us-section-label">Recent</span></div><div class="us-history-row">' + historyItems + '</div>';
        }

        var modal = document.createElement('div');
        modal.id = 'universal-search-modal';
        modal.innerHTML =
            '<div class="us-backdrop" id="universal-search-backdrop"></div>' +
            '<div class="us-container" role="dialog" aria-label="Universal Search">' +
                // Search bar
                '<div class="us-search-bar">' +
                    '<div class="us-search-icon">' +
                        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                    '</div>' +
                    '<input id="universal-search-input" class="us-search-input" type="text" placeholder="Search all conversations, all sessions..." autocomplete="off" spellcheck="false" />' +
                    '<div class="us-search-count" id="universal-search-count"></div>' +
                    '<button class="us-close-btn" id="us-close-btn" title="Close (Esc)">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                    '</button>' +
                '</div>' +
                // Filters
                '<div class="us-filters-bar">' +
                    '<div class="us-filter-group">' +
                        '<select id="universal-search-agent" class="us-select">' + agentOptions + '</select>' +
                    '</div>' +
                    '<div class="us-filter-group us-filter-dates">' +
                        '<span class="us-filter-label">From</span>' +
                        '<input type="date" id="universal-search-from" class="us-date-input" />' +
                        '<span class="us-filter-label">To</span>' +
                        '<input type="date" id="universal-search-to" class="us-date-input" />' +
                    '</div>' +
                    '<button id="universal-search-clear-filters" class="us-clear-btn" style="display:none">Clear filters</button>' +
                '</div>' +
                // Results / Empty state
                '<div class="us-body" id="universal-search-body">' + renderEmptyState() + '</div>' +
                // Footer with history
                '<div class="us-footer" id="us-footer">' + historyHtml + '</div>' +
            '</div>';

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        var backdrop = document.getElementById('universal-search-backdrop');
        if (backdrop) {
            backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9998;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
            backdrop.addEventListener('click', close);
        }

        // Wire close button
        var closeBtn = document.getElementById('us-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', close);

        wireModalEvents();
    }

    function renderEmptyState() {
        if (isBuildingIndex || !isIndexBuilt) {
            return '<div class="us-empty-state">' +
                '<div class="us-spinner"></div>' +
                '<p class="us-empty-title">Building search index…</p>' +
                '<p class="us-empty-sub">Indexing all sessions and conversations</p>' +
            '</div>';
        }
        return '<div class="us-empty-state us-empty-searching">' +
            '<div class="us-search-illustration">' +
                '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '</div>' +
            '<p class="us-empty-title">Search across all conversations</p>' +
            '<p class="us-empty-sub">Messages, agents, sessions — all indexed and searchable</p>' +
            '<div class="us-feature-pills">' +
                '<span class="us-feature-pill">✨ Fuzzy matching</span>' +
                '<span class="us-feature-pill">⚡ Prefix search</span>' +
                '<span class="us-feature-pill">📅 Date filtering</span>' +
            '</div>' +
        '</div>';
    }

    // ============================================================
    //  WIRE EVENTS
    // ============================================================
    function wireModalEvents() {
        var input = document.getElementById('universal-search-input');
        var agentSelect = document.getElementById('universal-search-agent');
        var dateFrom = document.getElementById('universal-search-from');
        var dateTo = document.getElementById('universal-search-to');
        var clearBtn = document.getElementById('universal-search-clear-filters');
        var body = document.getElementById('universal-search-body');

        var debounceTimer = null;

        function doSearch() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function() {
                var query = input ? input.value.trim() : '';
                var agent = agentSelect ? agentSelect.value : 'all';
                var from = dateFrom ? dateFrom.value : '';
                var to = dateTo ? dateTo.value : '';

                var hasFilters = agent !== 'all' || from || to;
                if (clearBtn) clearBtn.style.display = hasFilters ? '' : 'none';

                if (!query) {
                    body.innerHTML = renderEmptyState();
                    var countEl = document.getElementById('universal-search-count');
                    if (countEl) countEl.textContent = '';
                    return;
                }

                var results = performSearch(query, { agentFilter: agent, dateFrom: from, dateTo: to });
                body.innerHTML = renderResults(results, query);

                var countEl = document.getElementById('universal-search-count');
                if (countEl) {
                    countEl.textContent = results.length > 0 ? results.length + ' result' + (results.length !== 1 ? 's' : '') : '';
                }
            }, 100);
        }

        if (input) input.addEventListener('input', doSearch);
        if (agentSelect) agentSelect.addEventListener('change', doSearch);
        if (dateFrom) dateFrom.addEventListener('change', doSearch);
        if (dateTo) dateTo.addEventListener('change', doSearch);

        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                if (agentSelect) agentSelect.value = 'all';
                if (dateFrom) dateFrom.value = '';
                if (dateTo) dateTo.value = '';
                doSearch();
            });
        }

        // History chips
        var chips = document.querySelectorAll('.us-history-chip');
        for (var ci = 0; ci < chips.length; ci++) {
            chips[ci].addEventListener('click', function(e) {
                var q = e.target.getAttribute('data-q') || e.target.textContent;
                if (input) { input.value = q; input.focus(); }
                doSearch();
            });
        }

        // Keyboard: Escape to close
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', onKey);
            }
        });
    }

    // ============================================================
    //  RENDER RESULTS
    // ============================================================
    function renderResults(results, query) {
        if (results.length === 0) {
            return '<div class="us-empty-state">' +
                '<div class="us-search-illustration" style="opacity:0.4">' +
                    '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
                '</div>' +
                '<p class="us-empty-title">No results for "<strong>' + escapeHtml(query) + '</strong>"</p>' +
                '<p class="us-empty-sub">Try different keywords, check spelling, or remove filters</p>' +
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
            var maxTs = 0;
            for (var ti = 0; ti < msgs.length; ti++) maxTs = Math.max(maxTs, msgs[ti].timestamp || 0);
            sortedSessions.push({ key: sessKey, msgs: msgs, maxTs: maxTs });
        }
        sortedSessions.sort(function(a, b) { return b.maxTs - a.maxTs; });

        var html = '<div class="us-results-list">';

        for (var si = 0; si < sortedSessions.length; si++) {
            var sess = sortedSessions[si];

            // Find session metadata
            var sessionMeta = null;
            for (var ai = 0; ai < allSessions.length; ai++) {
                if (allSessions[ai].key === sess.key) { sessionMeta = allSessions[ai]; break; }
            }
            var sessAgentId = extractAgentId(sess.key);
            var sessAgentName = getAgentDisplayName(sessAgentId);
            var sessLabel = sessionMeta ? (sessionMeta.name || sessionMeta.label || sess.key) : sess.key;
            var safeSessKey = CSS.escape(sess.key);

            html += '<div class="us-session-group">';

            // Session header row
            html += '<div class="us-session-header" data-session="' + safeSessKey + '">';
            html += '<span class="us-session-caret" id="caret-' + safeSessKey + '">▾</span>';
            html += '<div class="us-session-meta">';
            html += '<span class="us-session-name">' + escapeHtml(sessLabel) + '</span>';
            html += '<span class="us-session-agent-badge">' + escapeHtml(sessAgentName) + '</span>';
            html += '</div>';
            html += '<span class="us-session-count">' + sess.msgs.length + ' match' + (sess.msgs.length !== 1 ? 'es' : '') + '</span>';
            html += '</div>';

            // Messages
            html += '<div class="us-session-messages" id="session-msgs-' + safeSessKey + '">';
            for (var mi = 0; mi < sess.msgs.length; mi++) {
                html += renderResultItem(sess.msgs[mi], query, mi === 0);
            }
            html += '</div></div>';
        }

        html += '</div>';
        return html;
    }

    function renderResultItem(msg, query, isFirst) {
        var text = msg.text || '';
        var highlighted = highlightMatches(text, query);
        var time = msg.timestamp ? formatTimestamp(msg.timestamp) : '';
        var isUser = msg.from === 'user' || msg.role === 'user';
        var roleIcon = isUser ? '👤' : getAgentEmoji(msg.agentId);
        var score = msg._score ? msg._score.toFixed(1) : '';
        var safeSessKey = CSS.escape(msg.sessionKey);

        // Truncate text for preview
        var textPreview = text.length > 180 ? text.substring(0, 180) + '…' : text;

        var html = '<div class="us-result-item' + (isFirst ? ' us-result-first' : '') + '" ';
        html += 'data-session="' + safeSessKey + '" data-ts="' + (msg.timestamp || 0) + '">';

        // Left accent bar
        html += '<div class="us-result-accent"></div>';

        // Content
        html += '<div class="us-result-content">';
        html += '<div class="us-result-meta">';
        html += '<span class="us-result-icon">' + roleIcon + '</span>';
        html += '<span class="us-result-from">' + escapeHtml(msg.from || msg.agentName || 'Unknown') + '</span>';
        if (time) html += '<span class="us-result-time">' + time + '</span>';
        if (msg.images) html += '<span class="us-result-img-badge">📎</span>';
        html += '</div>';
        html += '<div class="us-result-text">' + highlighted + '</div>';
        html += '</div>';

        // Score badge
        if (score) {
            html += '<div class="us-result-score" title="Relevance: ' + score + '">' + score + '</div>';
        }

        // Navigate arrow
        html += '<div class="us-result-arrow">→</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    //  HIGHLIGHT MATCHING TERMS
    // ============================================================
    function highlightMatches(text, query) {
        if (!text || !query) return escapeHtml(text || '');
        var terms = query.toLowerCase().split(/\s+/).filter(function(t) { return t.length > 1; });
        var escaped = escapeHtml(text);
        for (var i = 0; i < terms.length; i++) {
            var term = terms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var regex = new RegExp('(' + term + ')', 'gi');
            escaped = escaped.replace(regex, '<mark class="us-highlight">$1</mark>');
        }
        return escaped;
    }

    // ============================================================
    //  NAVIGATION
    // ============================================================
    function navigateTo(sessionKey, timestamp) {
        timestamp = Number(timestamp) || 0;

        if (lastQuery && searchHistory.indexOf(lastQuery) === -1) {
            searchHistory.unshift(lastQuery);
            searchHistory = searchHistory.slice(0, MAX_HISTORY);
            localStorage.setItem('universal_search_history', JSON.stringify(searchHistory));
        }

        close();

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
        if (input) { input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }
    }

    function toggleSession(sessionKey) {
        var el = document.getElementById('session-msgs-' + CSS.escape(sessionKey));
        var caret = document.getElementById('caret-' + CSS.escape(sessionKey));
        if (!el) return;
        var isHidden = el.style.display === 'none';
        el.style.display = isHidden ? '' : 'none';
        if (caret) caret.textContent = isHidden ? '▾' : '▸';
    }

    // Session header click → toggle
    document.addEventListener('click', function(e) {
        var header = e.target.closest('.us-session-header');
        if (header) {
            var sk = header.getAttribute('data-session');
            if (sk) toggleSession(sk);
        }

        // Result item click → navigate
        var resultItem = e.target.closest('.us-result-item');
        if (resultItem && !e.target.closest('.us-result-arrow')) {
            var sk = resultItem.getAttribute('data-session');
            var ts = Number(resultItem.getAttribute('data-ts')) || 0;
            if (sk) navigateTo(sk, ts);
        }
    });

    // ============================================================
    //    // ============================================================
    //  HELPERS
    // ============================================================

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

    // ============================================================
    //  GLOBAL KEYBOARD SHORTCUT: Ctrl+K / Cmd+K
    // ============================================================
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            open();
        }
    });

    })();
