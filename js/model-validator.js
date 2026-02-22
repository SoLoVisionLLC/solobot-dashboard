// js/model-validator.js — Model Validator using EXACT chat code
// Copy-pasted from chat.js sendChatPageMessage() with minimal changes

const ModelValidator = {
    models: {},
    filteredModels: {},
    currentTest: null,
    recentTests: [],
    rateLimitTimers: {},
    testResults: [],

    async init() {
        await this.loadModels();
        this.loadRecentTests();
        this.render();
        this.loadTestHistory();
    },

    async loadModels() {
        try {
            const res = await fetch('/api/models/list');
            this.models = await res.json();
            this.filteredModels = { ...this.models };
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
        } catch (e) {}
    },

    loadTestHistory() {
        try {
            const stored = localStorage.getItem('mv_test_history');
            if (stored) {
                this.testResults = JSON.parse(stored);
            }
        } catch (e) {}
    },

    saveRecentTest(provider, modelId, status) {
        const test = { provider, modelId, status, timestamp: Date.now() };
        this.recentTests = [test, ...this.recentTests.filter(t => 
            !(t.provider === provider && t.modelId === modelId)
        )].slice(0, 10);
        try {
            localStorage.setItem('mv_recent_tests', JSON.stringify(this.recentTests));
        } catch (e) {}
    },

    saveTestResult(result) {
        this.testResults.unshift(result);
        this.testResults = this.testResults.slice(0, 100);
        try {
            localStorage.setItem('mv_test_history', JSON.stringify(this.testResults));
        } catch (e) {}
        this.saveToServer(result);
    },

    async saveToServer(result) {
        try {
            await fetch('/api/test-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result)
            });
        } catch (e) {}
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
            const statusIcon = t.status === 'pass' ? '✓' : t.status === 'fail' ? '✗' : '⏳';
            return `
                <div class="mv-recent-chip" onclick="ModelValidator.runTest('${t.provider}', '${t.modelId}')">
                    <span class="status ${t.status}">${statusIcon}</span>
                    ${t.modelId}
                </div>
            `;
        }).join('');
    },

    toggleProvider(header) {
        header.classList.toggle('collapsed');
        const models = header.nextElementSibling;
        if (models) {
            models.style.display = header.classList.contains('collapsed') ? 'none' : 'block';
        }
    },

    // ========================================
    // EXACT COPY OF CHAT SEND CODE
    // ========================================
    async runTest(provider, modelId) {
        // EXACT check from chat.js
        if (!gateway || !gateway.isConnected()) {
            showToast('Not connected to Gateway. Please connect first.', 'warning');
            return;
        }

        this.currentTest = { provider, modelId };
        this.render();
        
        // Show loading (same as chat "isProcessing = true")
        document.getElementById('mv-empty-state').style.display = 'none';
        document.getElementById('mv-results-content').classList.remove('visible');
        document.getElementById('mv-loading-state').classList.add('visible');
        document.getElementById('mv-loading-model').textContent = modelId;

        const startTime = Date.now();
        const previousModel = localStorage.getItem('selected_model');
        
        try {
            // Set test model (same as chat would use)
            localStorage.setItem('selected_model', modelId);
            
            // EXACT same call as chat: await gateway.sendMessage(text)
            const TEST_PROMPT = 'Hello! Please respond with exactly: "Model validation successful."';
            const result = await gateway.sendMessage(TEST_PROMPT);
            
            const duration = Date.now() - startTime;
            
            // Build result (same structure chat would get)
            let responseText = '';
            if (result && result.message && result.message.content) {
                const content = result.message.content;
                if (Array.isArray(content)) {
                    responseText = content.map(c => c.text || '').join('');
                } else {
                    responseText = String(content);
                }
            } else if (typeof result === 'string') {
                responseText = result;
            } else {
                responseText = JSON.stringify(result, null, 2);
            }
            
            const resultData = {
                status: 'pass',
                durationMs: duration,
                provider: provider,
                modelId: modelId,
                timestamp: new Date().toISOString(),
                response: { text: responseText, raw: result }
            };
            
            this.displayResults(resultData);
            this.saveRecentTest(provider, modelId, 'pass');
            this.saveTestResult(resultData);
            
        } catch (err) {
            const duration = Date.now() - startTime;
            console.error('[ModelValidator] Test failed:', err);
            
            // EXACT same error handling as chat
            const errorData = {
                status: this.isRateLimitError(err) ? 'rate-limited' : 'fail',
                durationMs: duration,
                provider: provider,
                modelId: modelId,
                timestamp: new Date().toISOString(),
                error: {
                    message: err.message,
                    type: err.name || 'Error'
                }
            };
            
            if (errorData.status === 'rate-limited') {
                const retryAfter = this.extractRetryAfter(err);
                this.rateLimitTimers[`${provider}:${modelId}`] = Date.now() + (retryAfter * 1000);
                this.showRateLimitBanner(retryAfter);
            }
            
            this.displayError(errorData);
            this.saveRecentTest(provider, modelId, errorData.status);
            this.saveTestResult(errorData);
            
        } finally {
            // Restore model
            if (previousModel) {
                localStorage.setItem('selected_model', previousModel);
            } else {
                localStorage.removeItem('selected_model');
            }
            this.currentTest = null;
            this.render();
        }
    },

    // Helper: check if error is rate limit
    isRateLimitError(error) {
        if (!error) return false;
        const msg = (error.message || '').toLowerCase();
        return msg.includes('rate limit') || msg.includes('429') || error.code === 429;
    },

    // Helper: extract retry after
    extractRetryAfter(error) {
        const msg = (error.message || '');
        const match = msg.match(/retry[\s-]?after[:\s]*(\d+)/i);
        return match ? parseInt(match[1]) : 60;
    },

    displayResults(resultData) {
        document.getElementById('mv-loading-state').classList.remove('visible');
        document.getElementById('mv-results-content').classList.add('visible');
        
        document.getElementById('mv-result-title').textContent = '✅ Test Complete';
        document.getElementById('mv-status-value').textContent = 'PASS';
        document.getElementById('mv-status-value').className = 'mv-status-value success';
        document.getElementById('mv-latency-value').textContent = `${resultData.durationMs}ms`;
        document.getElementById('mv-model-value').textContent = resultData.modelId;
        document.getElementById('mv-provider-value').textContent = resultData.provider;
        
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = 'mv-code-block success';
        responseBlock.textContent = resultData.response.text || 'No response';
        
        document.getElementById('mv-headers-block').textContent = 'WebSocket (no HTTP headers)';
        document.getElementById('mv-raw-block').textContent = JSON.stringify(resultData, null, 2);
    },

    displayError(errorData) {
        document.getElementById('mv-loading-state').classList.remove('visible');
        document.getElementById('mv-results-content').classList.add('visible');
        
        const isRL = errorData.status === 'rate-limited';
        document.getElementById('mv-result-title').textContent = isRL ? '⏳ Rate Limited' : '❌ Test Failed';
        document.getElementById('mv-status-value').textContent = errorData.status.toUpperCase();
        document.getElementById('mv-status-value').className = `mv-status-value ${isRL ? 'pending' : 'error'}`;
        document.getElementById('mv-latency-value').textContent = `${errorData.durationMs}ms`;
        document.getElementById('mv-model-value').textContent = errorData.modelId;
        document.getElementById('mv-provider-value').textContent = errorData.provider;
        
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = `mv-code-block ${isRL ? 'pending' : 'error'}`;
        responseBlock.textContent = `Error: ${errorData.error.message}`;
        
        document.getElementById('mv-headers-block').textContent = 'No headers (error occurred)';
        document.getElementById('mv-raw-block').textContent = JSON.stringify(errorData, null, 2);
    },

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
            if (window.showToast) window.showToast(successMessage, 'success');
        } catch (e) {}
    },

    viewHistory() {
        if (window.showPage) window.showPage('test-results');
    },

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

window.ModelValidator = ModelValidator;
window.initModelValidatorPage = () => ModelValidator.init();

console.log('[ModelValidator] Loaded - uses EXACT chat code');
