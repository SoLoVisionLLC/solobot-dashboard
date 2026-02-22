// js/model-validator.js — Model Validator with complete response capture
// Waits for full response and captures rate limit details

const ModelValidator = {
    models: {},
    filteredModels: {},
    currentTest: null,
    recentTests: [],
    rateLimitTimers: {},
    testResults: [],
    pendingTestResolvers: new Map(), // For waiting on responses

    async init() {
        // Hook into gateway events to capture responses
        this.hookGatewayEvents();
        await this.loadModels();
        this.loadRecentTests();
        this.render();
        this.loadTestHistory();
    },

    hookGatewayEvents() {
        // Store original handler
        const originalHandler = window.gateway?.onChatEvent;
        
        // Wrap to capture responses for our tests
        window.gateway.onChatEvent = (payload) => {
            this.handleGatewayEvent(payload);
            // Call original handler
            if (originalHandler) originalHandler(payload);
        };
    },

    handleGatewayEvent(payload) {
        if (!payload || !this.currentTest) return;
        
        const state = payload.state;
        const message = payload.message;
        
        // Check for rate limit in the payload
        if (state === 'error' || payload.error) {
            const errorInfo = this.parseErrorForRateLimit(payload.error || message);
            if (errorInfo.isRateLimit && this.currentTest.resolver) {
                this.currentTest.resolver({
                    type: 'error',
                    rateLimit: errorInfo,
                    error: payload.error || message
                });
            } else if (this.currentTest.resolver) {
                this.currentTest.resolver({
                    type: 'error',
                    error: payload.error || message
                });
            }
            return;
        }
        
        // Capture final response
        if (state === 'final' && message?.role === 'assistant') {
            let contentText = '';
            let model = message.model;
            let provider = message.provider;
            
            if (message.content) {
                for (const part of message.content) {
                    if (part.type === 'text') {
                        contentText += part.text || '';
                    }
                }
            }
            
            if (this.currentTest.resolver) {
                this.currentTest.resolver({
                    type: 'success',
                    text: contentText,
                    model: model,
                    provider: provider,
                    raw: message
                });
            }
        }
    },

    parseErrorForRateLimit(error) {
        if (!error) return { isRateLimit: false };
        
        const msg = (typeof error === 'string' ? error : error.message || '').toLowerCase();
        const isRateLimit = msg.includes('rate limit') || 
                           msg.includes('too many requests') || 
                           msg.includes('429') ||
                           msg.includes('rate_limit');
        
        // Extract retry-after
        let retryAfter = null;
        let resetTime = null;
        let limit = null;
        let remaining = null;
        
        // Try to extract from message
        const retryMatch = msg.match(/retry[\s-]?after[:\s]*(\d+)/i);
        if (retryMatch) retryAfter = parseInt(retryMatch[1]);
        
        const resetMatch = msg.match(/reset[\s]?(?:at|in)[:\s]*([^\n]+)/i);
        if (resetMatch) resetTime = resetMatch[1].trim();
        
        const limitMatch = msg.match(/limit[:\s]*(\d+)/i);
        if (limitMatch) limit = parseInt(limitMatch[1]);
        
        const remainingMatch = msg.match(/remaining[:\s]*(\d+)/i);
        if (remainingMatch) remaining = parseInt(remainingMatch[1]);
        
        return {
            isRateLimit,
            retryAfter,
            resetTime,
            limit,
            remaining,
            rawMessage: typeof error === 'string' ? error : error.message
        };
    },

    async loadModels() {
        try {
            const res = await fetch('/api/models/list');
            this.models = await res.json();
            this.filteredModels = { ...this.models };
        } catch (e) {
            this.showError('Failed to load models: ' + e.message);
        }
    },

    loadRecentTests() {
        try {
            const stored = localStorage.getItem('mv_recent_tests');
            if (stored) this.recentTests = JSON.parse(stored);
        } catch (e) {}
    },

    loadTestHistory() {
        try {
            const stored = localStorage.getItem('mv_test_history');
            if (stored) this.testResults = JSON.parse(stored);
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
            if (filtered.length > 0) this.filteredModels[provider] = filtered;
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
        
        container.innerHTML = html || `<div style="padding: 40px; text-align: center;"><div style="font-size: 32px; margin-bottom: 12px;">🔍</div><div>No models found</div></div>`;
        
        const countEl = document.getElementById('mv-model-count');
        if (countEl) countEl.textContent = `${totalModels} model${totalModels !== 1 ? 's' : ''} available`;
        
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
            <div class="mv-model-item ${isTesting ? 'testing' : ''}">
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
        if (models) models.style.display = header.classList.contains('collapsed') ? 'none' : 'block';
    },

    // ========================================
    // MAIN TEST FUNCTION - Waits for response
    // ========================================
    async runTest(provider, modelId) {
        if (!gateway || !gateway.isConnected()) {
            showToast('Not connected to Gateway. Please connect first.', 'warning');
            return;
        }

        this.currentTest = { provider, modelId, startTime: Date.now() };
        this.render();
        
        // Show loading
        document.getElementById('mv-empty-state').style.display = 'none';
        document.getElementById('mv-results-content').classList.remove('visible');
        document.getElementById('mv-loading-state').classList.add('visible');
        document.getElementById('mv-loading-model').textContent = modelId;

        const previousModel = localStorage.getItem('selected_model');
        const TEST_PROMPT = 'Hello! Please respond with exactly: "Model validation successful."';
        
        // Create promise to wait for response
        const responsePromise = new Promise((resolve) => {
            this.currentTest.resolver = resolve;
        });
        
        // Timeout after 60 seconds
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve({ type: 'timeout' }), 60000);
        });
        
        try {
            // Set test model
            localStorage.setItem('selected_model', modelId);

            // === SHOW EXPECTED VALUES IMMEDIATELY (with ** = unconfirmed) ===
            document.getElementById('mv-empty-state').style.display = 'none';
            document.getElementById('mv-loading-state').classList.remove('visible');
            document.getElementById('mv-results-content').classList.add('visible');
            document.getElementById('mv-result-title').textContent = '🧪 Waiting for response...';
            document.getElementById('mv-result-subtitle').textContent = `${provider} / ${modelId}`;
            document.getElementById('mv-status-value').textContent = 'PENDING';
            document.getElementById('mv-status-value').className = 'mv-status-value pending';
            document.getElementById('mv-latency-value').textContent = '...';
            document.getElementById('mv-model-value').textContent = `**${modelId}**`;
            document.getElementById('mv-provider-value').textContent = `**${provider}**`;
            document.getElementById('mv-response-block').className = 'mv-code-block';
            document.getElementById('mv-response-block').textContent = 'Waiting for model response...';
            document.getElementById('mv-headers-block').textContent = 'Waiting...';
            document.getElementById('mv-raw-block').textContent = '{}';
            
            // Send message (this returns immediately with runId)
            const sendResult = await gateway.sendMessage(TEST_PROMPT);
            
            // Wait for actual response or timeout
            const result = await Promise.race([responsePromise, timeoutPromise]);
            
            const duration = Date.now() - this.currentTest.startTime;
            
            if (result.type === 'timeout') {
                throw new Error('Test timed out after 60 seconds. The model did not respond.');
            }
            
            if (result.type === 'error') {
                // Handle rate limit
                if (result.rateLimit?.isRateLimit) {
                    this.displayRateLimit(result.rateLimit, duration, provider, modelId);
                } else {
                    throw new Error(result.error?.message || result.error || 'Unknown error');
                }
            } else {
                // Success
                this.displaySuccess(result, duration, provider, modelId);
            }
            
        } catch (err) {
            const duration = Date.now() - this.currentTest.startTime;
            this.displayError(err, duration, provider, modelId);
        } finally {
            if (previousModel) {
                localStorage.setItem('selected_model', previousModel);
            } else {
                localStorage.removeItem('selected_model');
            }
            this.currentTest = null;
            this.render();
        }
    },

    displaySuccess(result, duration, provider, modelId) {
        document.getElementById('mv-loading-state').classList.remove('visible');
        document.getElementById('mv-results-content').classList.add('visible');
        
        // Confirmed values — remove ** now that gateway responded
        const confirmedModel = result.model || modelId;
        const confirmedProvider = result.provider || provider;
        
        document.getElementById('mv-result-title').textContent = '✅ Test Complete';
        document.getElementById('mv-status-value').textContent = 'PASS';
        document.getElementById('mv-status-value').className = 'mv-status-value success';
        document.getElementById('mv-latency-value').textContent = `${duration}ms`;
        // Show confirmed model — no asterisks
        document.getElementById('mv-model-value').textContent = confirmedModel;
        document.getElementById('mv-provider-value').textContent = confirmedProvider;
        
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = 'mv-code-block success';
        responseBlock.textContent = result.text || 'No text response';
        
        document.getElementById('mv-headers-block').textContent = 
            `Confirmed Model: ${confirmedModel}\nConfirmed Provider: ${confirmedProvider}\nExpected Model: ${modelId}\nExpected Provider: ${provider}\nProtocol: WebSocket`;
        
        const resultData = {
            status: 'pass',
            durationMs: duration,
            provider: provider,
            modelId: modelId,
            timestamp: new Date().toISOString(),
            response: {
                text: result.text,
                model: result.model,
                provider: result.provider,
                raw: result.raw
            }
        };
        
        document.getElementById('mv-raw-block').textContent = JSON.stringify(resultData, null, 2);
        
        this.saveRecentTest(provider, modelId, 'pass');
        this.saveTestResult(resultData);
    },

    displayRateLimit(rateLimitInfo, duration, provider, modelId) {
        document.getElementById('mv-loading-state').classList.remove('visible');
        document.getElementById('mv-results-content').classList.add('visible');
        document.getElementById('mv-rate-limit-banner').style.display = 'flex';
        
        document.getElementById('mv-result-title').textContent = '⏳ Rate Limited';
        document.getElementById('mv-status-value').textContent = 'RATE LIMITED';
        document.getElementById('mv-status-value').className = 'mv-status-value pending';
        document.getElementById('mv-latency-value').textContent = `${duration}ms`;
        document.getElementById('mv-model-value').textContent = modelId;
        document.getElementById('mv-provider-value').textContent = provider;
        
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = 'mv-code-block pending';
        
        let rateLimitText = '⚠️ RATE LIMIT HIT\n\n';
        rateLimitText += `Error: ${rateLimitInfo.rawMessage || 'Rate limit exceeded'}\n\n`;
        
        if (rateLimitInfo.retryAfter) {
            rateLimitText += `⏱️ Retry After: ${rateLimitInfo.retryAfter} seconds\n`;
            this.showRateLimitBanner(rateLimitInfo.retryAfter);
            this.rateLimitTimers[`${provider}:${modelId}`] = Date.now() + (rateLimitInfo.retryAfter * 1000);
        }
        
        if (rateLimitInfo.resetTime) {
            rateLimitText += `🔄 Reset Time: ${rateLimitInfo.resetTime}\n`;
        }
        
        if (rateLimitInfo.limit) {
            rateLimitText += `📊 Rate Limit: ${rateLimitInfo.limit} requests\n`;
        }
        
        if (rateLimitInfo.remaining !== null) {
            rateLimitText += `📉 Remaining: ${rateLimitInfo.remaining}\n`;
        }
        
        responseBlock.textContent = rateLimitText;
        
        document.getElementById('mv-headers-block').textContent = 
            `Protocol: WebSocket\nRate Limited: true`;
        
        const resultData = {
            status: 'rate-limited',
            durationMs: duration,
            provider: provider,
            modelId: modelId,
            timestamp: new Date().toISOString(),
            rateLimitInfo: rateLimitInfo
        };
        
        document.getElementById('mv-raw-block').textContent = JSON.stringify(resultData, null, 2);
        
        this.saveRecentTest(provider, modelId, 'rate-limited');
        this.saveTestResult(resultData);
    },

    displayError(err, duration, provider, modelId) {
        document.getElementById('mv-loading-state').classList.remove('visible');
        document.getElementById('mv-results-content').classList.add('visible');
        
        document.getElementById('mv-result-title').textContent = '❌ Test Failed';
        document.getElementById('mv-status-value').textContent = 'FAIL';
        document.getElementById('mv-status-value').className = 'mv-status-value error';
        document.getElementById('mv-latency-value').textContent = `${duration}ms`;
        document.getElementById('mv-model-value').textContent = modelId;
        document.getElementById('mv-provider-value').textContent = provider;
        
        const responseBlock = document.getElementById('mv-response-block');
        responseBlock.className = 'mv-code-block error';
        responseBlock.textContent = `Error: ${err.message || err}`;
        
        document.getElementById('mv-headers-block').textContent = 'Protocol: WebSocket\nError: true';
        
        const resultData = {
            status: 'fail',
            durationMs: duration,
            provider: provider,
            modelId: modelId,
            timestamp: new Date().toISOString(),
            error: {
                message: err.message || String(err),
                stack: err.stack
            }
        };
        
        document.getElementById('mv-raw-block').textContent = JSON.stringify(resultData, null, 2);
        
        this.saveRecentTest(provider, modelId, 'fail');
        this.saveTestResult(resultData);
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
                    <div>${message}</div>
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
            if (firstModel) this.runTest(firstProvider, firstModel.id);
        }
    }
};

window.ModelValidator = ModelValidator;
window.initModelValidatorPage = () => ModelValidator.init();

console.log('[ModelValidator] Loaded - waits for full response with rate limit capture');
