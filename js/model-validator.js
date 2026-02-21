// js/model-validator.js — Model Validator with EXACT chat pipeline duplicate
// Uses the same gateway.sendMessage() path as the chat to ensure identical results

const ModelValidator = {
    models: {},
    filteredModels: {},
    currentTest: null,
    recentTests: [],
    rateLimitTimers: {},
    testResults: [],
    
    // Test prompt - simple message to validate model response
    TEST_PROMPT: 'Hello! Please respond with exactly: "Model validation successful."',

    async init() {
        console.log('[ModelValidator] Initializing...');
        await this.loadModels();
        this.loadRecentTests();
        this.render();
        this.loadTestHistory();
    },

    async loadModels() {
        try {
            const res = await fetch('/api/tester/models');
            this.models = await res.json();
            this.filteredModels = { ...this.models };
            console.log('[ModelValidator] Loaded', Object.values(this.models).flat().length, 'models');
        } catch (e) {
            console.error('[ModelValidator] Failed to load models:', e);
            this.showError('Failed to load models: ' + e.message);
        }
    },

    loadRecentTests() {
        try {
            const stored = localStorage.getItem('mv_recent_tests');
            if (stored) {
                this.recentTests = JSON.parse(stored);
            }
        } catch (e) {
            console.log('[ModelValidator] No recent tests stored');
        }
    },

    loadTestHistory() {
        try {
            const stored = localStorage.getItem('mv_test_history');
            if (stored) {
                this.testResults = JSON.parse(stored);
                this.renderTestHistory();
            }
        } catch (e) {
            console.log('[ModelValidator] No test history stored');
        }
    },

    saveRecentTest(provider, modelId, status) {
        const test = {
            provider,
            modelId,
            status,
            timestamp: Date.now()
        };
        
        this.recentTests = [test, ...this.recentTests.filter(t => 
            !(t.provider === provider && t.modelId === modelId)
        )].slice(0, 10);
        
        try {
            localStorage.setItem('mv_recent_tests', JSON.stringify(this.recentTests));
        } catch (e) {
            // Ignore storage errors
        }
    },

    saveTestResult(result) {
        this.testResults.unshift(result);
        // Keep only last 100 tests
        this.testResults = this.testResults.slice(0, 100);
        
        try {
            localStorage.setItem('mv_test_history', JSON.stringify(this.testResults));
        } catch (e) {
            console.warn('[ModelValidator] Failed to save test history:', e);
        }
        
        // Also save to server API
        this.saveToServer(result);
    },

    async saveToServer(result) {
        try {
            await fetch('/api/test-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result)
            });
        } catch (e) {
            console.warn('[ModelValidator] Failed to save to server:', e);
        }
    },

    filterModels() {
        const search = document.getElementById('mv-search-input')?.value.toLowerCase() || '';
        
        this.filteredModels = {};
        for (const [provider, models] of Object.entries(this.models)) {
            const filtered = models.filter(m => 
                m.id.toLowerCase().includes(search) || 
                (m.name && m.name.toLowerCase().includes(search))
            );
            if (filtered.length > 0) {
                this.filteredModels[provider] = filtered;
            }
        }
        
        this.render();
    },

    render() {
        const container = document.getElementById('mv-models-list');
        if (!container) return;
        
        let totalModels = 0;
        
        const html = Object.entries(this.filteredModels).map(([provider, models]) => {
            totalModels += models.length;
            return `
                <div class="mv-provider-group">
                    <div class="mv-provider-header" onclick="ModelValidator.toggleProvider(this)">
                        <span class="chevron">▼</span>
                        <span>${provider}</span>
                        <span style="margin-left: auto; color: var(--text-muted); font-size: 11px;">${models.length} models</span>
                    </div>
                    <div class="mv-provider-models">
                        ${models.map(m => this.renderModelItem(provider, m)).join('')}
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = html || `
            <div style="padding: 40px; text-align: center; color: var(--text-muted);">
                <div style="font-size: 32px; margin-bottom: 12px;">🔍</div>
                <div>No models found</div>
            </div>
        `;
        
        const countEl = document.getElementById('mv-model-count');
        if (countEl) {
            countEl.textContent = `${totalModels} model${totalModels !== 1 ? 's' : ''} available`;
        }
        
        this.renderRecentTests();
    },

    renderModelItem(provider, model) {
        const isTesting = this.currentTest && 
            this.currentTest.provider === provider && 
            this.currentTest.modelId === model.id;
        
        // Find last test result for this model
        const lastTest = this.testResults.find(t => t.modelId === model.id);
        const statusBadge = lastTest ? 
            `<span class="mv-status-badge ${lastTest.status}">${lastTest.status}</span>` : '';
        
        return `
            <div class="mv-model-item ${isTesting ? 'testing' : ''}" data-provider="${provider}" data-model="${model.id}">
                <div class="mv-model-info">
                    <div class="mv-model-id">${model.id}</div>
                    <div class="mv-model-name">${model.name || model.id}</div>
                </div>
                <div class="mv-model-status">
                    ${statusBadge}
                    <button class="mv-run-btn" onclick="event.stopPropagation(); ModelValidator.runTest('${provider}', '${model.id}')" ${isTesting ? 'disabled' : ''}>
                        ${isTesting ? 'Testing...' : 'Run Test'}
                    </button>
                </div>
            </div>
        `;
    },

    renderRecentTests() {
        const container = document.getElementById('mv-recent-tests');
        const list = document.getElementById('mv-recent-list');
        
        if (!container || !list) return;
        
        if (this.recentTests.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        list.innerHTML = this.recentTests.map(t => {
            const statusIcon = t.status === 'pass' ? '✓' : 
                              t.status === 'fail' ? '✗' : '⏳';
            const statusClass = t.status;
            return `
                <div class="mv-recent-chip" onclick="ModelValidator.runTest('${t.provider}', '${t.modelId}')">
                    <span class="status ${statusClass}">${statusIcon}</span>
                    ${t.modelId}
                </div>
            `;
        }).join('');
    },

    renderTestHistory() {
        // This would render a history view if needed
    },

    toggleProvider(header) {
        header.classList.toggle('collapsed');
        const models = header.nextElementSibling;
        if (models) {
            models.style.display = header.classList.contains('collapsed') ? 'none' : 'block';
        }
    },

    /**
     * Run a model test using the EXACT same pipeline as chat
     * This is the critical function that ensures identical behavior
     */
    async runTest(provider, modelId) {
        console.log(`[ModelValidator] Starting test for ${provider}/${modelId}`);
        
        // Check rate limit
        const rlKey = `${provider}:${modelId}`;
        if (this.rateLimitTimers[rlKey]) {
            const remaining = Math.ceil((this.rateLimitTimers[rlKey] - Date.now()) / 1000);
            if (remaining > 0) {
                this.showRateLimitBanner(remaining);
                return;
            }
        }

        this.currentTest = { provider, modelId };
        this.render(); // Update UI
        
        // Show loading state
        this.setUIState('loading');
        document.getElementById('mv-loading-model').textContent = `${provider} / ${modelId}`;
        document.getElementById('mv-result-subtitle').textContent = `${provider} / ${modelId}`;

        const startTime = Date.now();
        let resultData = null;
        let errorData = null;
        
        // Save current model to restore later
        const previousModel = localStorage.getItem('selected_model');
        
        try {
            // ===== EXACT SAME PIPELINE AS CHAT =====
            // 1. Set the model we want to test
            localStorage.setItem('selected_model', modelId);
            console.log(`[ModelValidator] Set model to: ${modelId}`);
            
            // 2. Check gateway connection (same as chat)
            if (!window.gateway || !window.gateway.isConnected()) {
                throw new Error('Not connected to Gateway. Please connect first in Settings.');
            }
            
            // 3. Use EXACT same send method as chat
            // chat.js: await gateway.sendMessage(text)
            console.log(`[ModelValidator] Sending test message via gateway.sendMessage...`);
            
            const sendResult = await window.gateway.sendMessage(this.TEST_PROMPT);
            
            const duration = Date.now() - startTime;
            
            console.log(`[ModelValidator] Test completed in ${duration}ms`, sendResult);
            
            // Extract response text (same logic as chat)
            let responseText = '';
            if (sendResult && sendResult.message && sendResult.message.content) {
                const content = sendResult.message.content;
                if (Array.isArray(content)) {
                    responseText = content.map(c => c.text || '').join('');
                } else {
                    responseText = String(content);
                }
            } else if (typeof sendResult === 'string') {
                responseText = sendResult;
            } else {
                responseText = JSON.stringify(sendResult, null, 2);
            }
            
            // Build result data structure
            resultData = {
                status: 'pass',
                statusCode: 200,
                statusText: 'OK',
                durationMs: duration,
                provider: provider,
                modelId: modelId,
                timestamp: new Date().toISOString(),
                request: {
                    message: this.TEST_PROMPT,
                    model: modelId,
                    sessionKey: window.GATEWAY_CONFIG?.sessionKey || 'agent:main:main'
                },
                response: {
                    text: responseText,
                    raw: sendResult
                },
                headers: {
                    'X-Protocol': 'WebSocket',
                    'X-Session': window.gateway?.sessionKey || 'unknown',
                    'X-Model': modelId
                }
            };
            
            // Display success
            this.displayResults(resultData);
            this.saveRecentTest(provider, modelId, 'pass');
            this.saveTestResult(resultData);
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[ModelValidator] Test failed:`, error);
            
            errorData = {
                status: 'fail',
                durationMs: duration,
                provider: provider,
                modelId: modelId,
                timestamp: new Date().toISOString(),
                request: {
                    message: this.TEST_PROMPT,
                    model: modelId,
                    sessionKey: window.GATEWAY_CONFIG?.sessionKey || 'agent:main:main'
                },
                error: {
                    message: error.message,
                    code: error.code || 'UNKNOWN',
                    type: error.name || 'Error',
                    stack: error.stack
                },
                // Extract rate limit info if present
                rateLimitInfo: this.extractRateLimitInfo(error)
            };
            
            // Check if this is a rate limit error
            if (this.isRateLimitError(error)) {
                errorData.status = 'rate-limited';
                const retryAfter = this.extractRetryAfter(error);
                this.rateLimitTimers[rlKey] = Date.now() + (retryAfter * 1000);
                this.showRateLimitBanner(retryAfter);
            }
            
            // Display error
            this.displayError(errorData);
            this.saveRecentTest(provider, modelId, errorData.status);
            this.saveTestResult(errorData);
            
        } finally {
            // ===== RESTORE PREVIOUS MODEL =====
            if (previousModel) {
                localStorage.setItem('selected_model', previousModel);
                console.log(`[ModelValidator] Restored model to: ${previousModel}`);
            } else {
                localStorage.removeItem('selected_model');
            }
            
            this.currentTest = null;
            this.render();
        }
    },

    /**
     * Extract rate limit information from error
     */
    extractRateLimitInfo(error) {
        const info = {
            hit: false,
            retryAfter: null,
            limit: null,
            remaining: null,
            resetTime: null
        };
        
        if (!error) return info;
        
        const message = error.message || '';
        
        // Check for rate limit indicators in message
        if (message.includes('rate limit') || 
            message.includes('too many requests') ||
            message.includes('429')) {
            info.hit = true;
        }
        
        // Try to extract retry-after from message
        const retryMatch = message.match(/retry[\s-]?after[:\s]*(\d+)/i);
        if (retryMatch) {
            info.retryAfter = parseInt(retryMatch[1]);
        }
        
        // Extract from error object if available
        if (error.retryAfter) {
            info.retryAfter = error.retryAfter;
        }
        
        return info;
    },

    /**
     * Check if error is rate limit related
     */
    isRateLimitError(error) {
        if (!error) return false;
        
        const message = (error.message || '').toLowerCase();
        return message.includes('rate limit') || 
               message.includes('too many requests') ||
               message.includes('429') ||
               error.code === 429;
    },

    /**
     * Extract retry-after seconds from error
     */
    extractRetryAfter(error) {
        const info = this.extractRateLimitInfo(error);
        return info.retryAfter || 60; // Default to 60 seconds
    },

    /**
     * Display successful test results
     */
    displayResults(resultData) {
        this.setUIState('results');
        
        // Update title
        document.getElementById('mv-result-title').textContent = '✅ Test Complete';
        
        // Status bar
        document.getElementById('mv-status-value').textContent = 'PASS';
        document.getElementById('mv-status-value').className = 'mv-status-value success';
        document.getElementById('mv-latency-value').textContent = `${resultData.durationMs}ms`;
        document.getElementById('mv-model-value').textContent = resultData.modelId;
        document.getElementById('mv-provider-value').textContent = resultData.provider;
        
        // Response
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = 'mv-code-block success';
        responseBlock.textContent = resultData.response.text || 'No response text';
        
        // Headers
        const headers = resultData.headers || {};
        const headerStr = Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n') || 'No headers available';
        document.getElementById('mv-headers-block').textContent = headerStr;
        
        // Raw JSON
        document.getElementById('mv-raw-block').textContent = JSON.stringify(resultData, null, 2);
    },

    /**
     * Display error test results
     */
    displayError(errorData) {
        this.setUIState('results');
        
        // Update title based on error type
        const isRateLimited = errorData.status === 'rate-limited';
        document.getElementById('mv-result-title').textContent = isRateLimited ? '⏳ Rate Limited' : '❌ Test Failed';
        
        // Status bar
        document.getElementById('mv-status-value').textContent = errorData.status.toUpperCase();
        document.getElementById('mv-status-value').className = `mv-status-value ${isRateLimited ? 'pending' : 'error'}`;
        document.getElementById('mv-latency-value').textContent = `${errorData.durationMs}ms`;
        document.getElementById('mv-model-value').textContent = errorData.modelId;
        document.getElementById('mv-provider-value').textContent = errorData.provider;
        
        // Response (error details)
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = `mv-code-block ${isRateLimited ? 'pending' : 'error'}`;
        
        let errorText = `Error: ${errorData.error.message}\n\n`;
        errorText += `Type: ${errorData.error.type}\n`;
        errorText += `Code: ${errorData.error.code}\n`;
        
        if (isRateLimited && errorData.rateLimitInfo) {
            errorText += `\nRate Limit Info:\n`;
            errorText += `  Retry After: ${errorData.rateLimitInfo.retryAfter || 'unknown'} seconds\n`;
        }
        
        responseBlock.textContent = errorText;
        
        // Headers
        document.getElementById('mv-headers-block').textContent = 'No headers available (error occurred)';
        
        // Raw JSON
        document.getElementById('mv-raw-block').textContent = JSON.stringify(errorData, null, 2);
    },

    /**
     * Set UI state (empty, loading, results)
     */
    setUIState(state) {
        const emptyState = document.getElementById('mv-empty-state');
        const loadingState = document.getElementById('mv-loading-state');
        const resultsContent = document.getElementById('mv-results-content');
        const rateLimitBanner = document.getElementById('mv-rate-limit-banner');
        
        // Hide all first
        if (emptyState) emptyState.style.display = 'none';
        if (loadingState) loadingState.classList.remove('visible');
        if (resultsContent) resultsContent.classList.remove('visible');
        if (rateLimitBanner) rateLimitBanner.style.display = 'none';
        
        // Show requested state
        switch (state) {
            case 'empty':
                if (emptyState) emptyState.style.display = 'flex';
                break;
            case 'loading':
                if (loadingState) loadingState.classList.add('visible');
                break;
            case 'results':
                if (resultsContent) resultsContent.classList.add('visible');
                break;
        }
    },

    /**
     * Show rate limit banner with countdown
     */
    showRateLimitBanner(seconds) {
        const banner = document.getElementById('mv-rate-limit-banner');
        const timer = document.getElementById('mv-rl-timer');
        
        if (!banner || !timer) return;
        
        banner.style.display = 'flex';
        
        const updateTimer = () => {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            
            if (seconds > 0) {
                seconds--;
                setTimeout(updateTimer, 1000);
            } else {
                banner.style.display = 'none';
            }
        };
        
        updateTimer();
    },

    /**
     * Show error message
     */
    showError(message) {
        const container = document.getElementById('mv-models-list');
        if (container) {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <div style="font-size: 32px; margin-bottom: 12px;">❌</div>
                    <div>Error</div>
                    <div style="font-size: 12px; margin-top: 8px; color: var(--text-muted);">${message}</div>
                </div>
            `;
        }
    },

    /**
     * Copy functions
     */
    copyResponse() {
        const text = document.getElementById('mv-response-block')?.textContent || '';
        this.copyToClipboard(text, 'Response copied!');
    },

    copyHeaders() {
        const text = document.getElementById('mv-headers-block')?.textContent || '';
        this.copyToClipboard(text, 'Headers copied!');
    },

    copyJSON() {
        const text = document.getElementById('mv-raw-block')?.textContent || '';
        this.copyToClipboard(text, 'JSON copied!');
    },

    async copyToClipboard(text, successMessage) {
        try {
            await navigator.clipboard.writeText(text);
            if (window.showToast) {
                window.showToast(successMessage, 'success');
            }
        } catch (e) {
            console.error('[ModelValidator] Copy failed:', e);
        }
    },

    /**
     * View test results history
     */
    viewHistory() {
        if (window.showPage) {
            window.showPage('test-results');
        }
    },

    /**
     * Run quick test on first available model
     */
    runQuickTest() {
        const providers = Object.keys(this.models);
        if (providers.length > 0) {
            const firstProvider = providers[0];
            const firstModel = this.models[firstProvider][0];
            if (firstModel) {
                this.runTest(firstProvider, firstModel.id);
            }
        }
    }
};

// Expose to window
window.ModelValidator = ModelValidator;

// Init function for page loader
window.initModelValidatorPage = () => ModelValidator.init();

console.log('[ModelValidator] Module loaded - uses EXACT chat pipeline');
