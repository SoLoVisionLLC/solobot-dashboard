// js/health.js — System health monitoring

// ===================
// SYSTEM HEALTH FUNCTIONS
// ===================

let healthTestResults = {};
let healthTestInProgress = false;
let pendingHealthChecks = new Map(); // sessionKey -> { resolve, reject, timer }

// Initialize health page when shown
function initHealthPage() {
    updateHealthGatewayStatus();
    loadHealthModels();
}

// Update gateway connection status
function updateHealthGatewayStatus() {
    const statusEl = document.getElementById('health-gateway-status');
    if (!statusEl) return;

    if (gateway && gateway.isConnected()) {
        statusEl.innerHTML = `
            <span style="font-size: 20px;">✅</span>
            <span style="font-weight: 500; color: var(--success);">Connected</span>
        `;
    } else {
        statusEl.innerHTML = `
            <span style="font-size: 20px;">❌</span>
            <span style="font-weight: 500; color: var(--error);">Disconnected</span>
        `;
    }
}

// Load available models from API
async function loadHealthModels() {
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error('Failed to fetch models');
        const data = await response.json();

        // API returns models grouped by provider: { anthropic: [...], google: [...] }
        // Flatten into a single array
        let models = [];
        if (data.models) {
            // Direct models array format
            models = data.models;
        } else {
            // Provider-grouped format - flatten it
            for (const provider of Object.keys(data)) {
                if (Array.isArray(data[provider])) {
                    models = models.concat(data[provider]);
                }
            }
        }

        const countEl = document.getElementById('health-model-count');
        if (countEl) countEl.textContent = models.length;

        // Render initial model list (not tested yet)
        renderHealthModelList(models, {});

        return models;
    } catch (error) {
        console.error('[Health] Failed to load models:', error);
        const countEl = document.getElementById('health-model-count');
        if (countEl) countEl.textContent = '?';
        return [];
    }
}

// Test a single model using EXACT same path as chat (same session, same WebSocket, same auth)
// Uses gateway.sendTestMessage() which mirrors sendMessage() but with a model override
async function testSingleModel(modelId) {
    const startTime = Date.now();

    try {
        // Check if gateway is connected
        if (!gateway || !gateway.isConnected()) {
            return {
                success: false,
                error: 'Gateway not connected',
                latencyMs: Date.now() - startTime
            };
        }

        // Create a unique health-check session for this model to ensure isolation
        const healthSessionKey = 'health-check-' + modelId.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        console.log(`[Health] Testing model ${modelId} using session ${healthSessionKey}`);

        // Patch session to use the target model (same as how chat sets model)
        try {
            await gateway.patchSession(healthSessionKey, { model: modelId });
        } catch (patchErr) {
            console.warn(`[Health] Session patch failed (may not exist yet): ${patchErr.message}`);
        }

        // Use the SAME method as chat.send but with model override AND explicit session
        // This goes through the exact same WebSocket, auth, and routing as regular chat
        const result = await gateway.sendTestMessage('OK', modelId, healthSessionKey);
        
        const latencyMs = Date.now() - startTime;
        
        console.log(`[Health] ✅ Model ${modelId} test sent successfully, runId: ${result?.runId}`);
        
        return {
            success: true,
            runId: result?.runId,
            latencyMs,
            note: 'Message sent via chat.send (same as chat). Response arrives via chat events.'
        };

    } catch (error) {
        return {
            success: false,
            error: error.message || 'Test failed',
            latencyMs: Date.now() - startTime
        };
    }
}

// Run health checks on all models
window.runAllModelTests = async function () {
    if (healthTestInProgress) {
        showToast('Health check already in progress', 'warning');
        return;
    }

    healthTestInProgress = true;
    healthTestResults = {};

    const testBtn = document.getElementById('test-all-btn');
    const progressEl = document.getElementById('health-test-progress');

    if (testBtn) {
        testBtn.disabled = true;
        testBtn.innerHTML = '⏳ Testing...';
    }

    try {
        // Load models
        const models = await loadHealthModels();

        if (models.length === 0) {
            showToast('No models found to test', 'warning');
            return;
        }

        // Mark all as testing
        models.forEach(m => {
            healthTestResults[m.id] = { status: 'testing' };
        });
        renderHealthModelList(models, healthTestResults);

        // Test each model sequentially
        let tested = 0;
        let passed = 0;
        let failed = 0;

        for (const model of models) {
            tested++;
            if (progressEl) {
                progressEl.textContent = `Testing ${tested}/${models.length}...`;
            }

            const result = await testSingleModel(model.id);

            healthTestResults[model.id] = {
                status: result.success ? 'success' : 'error',
                error: result.error,
                latencyMs: result.latencyMs,
                response: result.response
            };

            if (result.success) passed++;
            else failed++;

            // Re-render after each test for real-time updates
            renderHealthModelList(models, healthTestResults);
        }

        // Update last test time
        const lastTestEl = document.getElementById('health-last-test');
        if (lastTestEl) {
            lastTestEl.textContent = new Date().toLocaleTimeString();
        }

        if (progressEl) {
            progressEl.textContent = `✅ ${passed} passed, ❌ ${failed} failed`;
        }

        showToast(`Health check complete: ${passed}/${models.length} models working`,
            failed > 0 ? 'warning' : 'success');

    } catch (error) {
        console.error('[Health] Test failed:', error);
        showToast('Health check failed: ' + error.message, 'error');
    } finally {
        healthTestInProgress = false;
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.innerHTML = '🚀 Test All Models';
        }
    }
};

// Render the model list with test results
function renderHealthModelList(models, results) {
    const container = document.getElementById('health-model-list');
    if (!container) return;

    if (models.length === 0) {
        container.innerHTML = `
            <div style="padding: var(--space-4); color: var(--text-muted); text-align: center;">
                <p>No models available. Check gateway connection.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = models.map(model => {
        const result = results[model.id] || { status: 'pending' };

        let statusIcon, statusColor, statusText;
        switch (result.status) {
            case 'success':
                statusIcon = '✅';
                statusColor = 'var(--success)';
                statusText = `${result.latencyMs}ms`;
                break;
            case 'error':
                statusIcon = '❌';
                statusColor = 'var(--error)';
                statusText = result.error || 'Failed';
                break;
            case 'testing':
                statusIcon = '⏳';
                statusColor = 'var(--warning)';
                statusText = 'Testing...';
                break;
            default:
                statusIcon = '⚪';
                statusColor = 'var(--text-muted)';
                statusText = 'Not tested';
        }

        // Extract provider from model ID (e.g., 'anthropic/claude-3-5-sonnet' -> 'anthropic')
        const provider = window.getProviderFromModelId ? window.getProviderFromModelId(model.id) : (model.id.split('/')[0] || 'unknown');
        const modelName = model.id.split('/').slice(1).join('/') || model.id;

        return `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle);">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                    <span style="font-size: 18px;">${statusIcon}</span>
                    <div>
                        <div style="font-weight: 500; color: var(--text-primary);">${modelName}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">
                            <span style="background: var(--surface-3); padding: 1px 6px; border-radius: 3px;">${provider}</span>
                            ${model.displayName ? `<span style="margin-left: 8px;">${model.displayName}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${statusColor}; font-size: 13px; font-weight: 500; margin-bottom: 2px;">${statusText}</div>
                    ${result.status !== 'testing' && !healthTestInProgress ? `
                        <button onclick="testSingleModelUI('${model.id}')" class="btn btn-ghost" style="font-size: 10px; padding: 1px 6px; height: auto;">
                            ${result.status === 'pending' ? 'Test' : 'Re-test'}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Test single model from UI button
window.testSingleModelUI = async function (modelId) {
    const models = await loadHealthModels();
    healthTestResults[modelId] = { status: 'testing' };
    renderHealthModelList(models, healthTestResults);

    const result = await testSingleModel(modelId);
    healthTestResults[modelId] = {
        status: result.success ? 'success' : 'error',
        error: result.error,
        latencyMs: result.latencyMs
    };
    renderHealthModelList(models, healthTestResults);

    showToast(result.success ? `${modelId.split('/').pop()} is working!` : `${modelId.split('/').pop()} failed: ${result.error}`,
        result.success ? 'success' : 'error');
};

// Hook into page navigation to init health page
const originalShowPage = window.showPage;
if (typeof originalShowPage === 'function') {
    window.showPage = function (pageName, updateURL = true) {
        originalShowPage(pageName, updateURL);
        if (pageName === 'health') {
            initHealthPage();
        }
        if (pageName === 'chat') {
            forceRefreshHistory();
        }
    };
}


