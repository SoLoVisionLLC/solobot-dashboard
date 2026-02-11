// js/models.js — isSystemMessage, provider/model management

function isSystemMessage(text, from) {
    // DEBUG MODE: Show everything in chat
    if (DISABLE_SYSTEM_FILTER) {
        return false; // Everything goes to chat
    }

    if (!text) return false;

    const trimmed = text.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    // Only mark as system if from='system' explicitly
    if (from === 'system') return true;

    // === TOOL OUTPUT FILTERING ===
    // Filter out obvious tool results that shouldn't appear in chat
    
    // JSON outputs (API responses, fetch results)
    if (trimmed.startsWith('{') && trimmed.includes('"')) return true;
    
    // Command outputs
    if (trimmed.startsWith('Successfully replaced text in')) return true;
    if (trimmed.startsWith('Successfully wrote')) return true;
    if (trimmed === '(no output)') return true;
    if (trimmed.startsWith('[main ') && trimmed.includes('file changed')) return true;
    if (trimmed.startsWith('To https://github.com')) return true;
    
    // Git/file operation outputs  
    if (/^\[main [a-f0-9]+\]/.test(trimmed)) return true;
    if (trimmed.startsWith('Exported ') && trimmed.includes(' activities')) return true;
    if (trimmed.startsWith('Posted ') && trimmed.includes(' activities')) return true;
    
    // Token/key outputs (security - never show these)
    if (/^ghp_[A-Za-z0-9]+$/.test(trimmed)) return true;
    if (/^sk_[A-Za-z0-9]+$/.test(trimmed)) return true;
    
    // File content dumps (markdown files being read)
    if (trimmed.startsWith('# ') && trimmed.length > 500) return true;
    
    // Grep/search output (line numbers with code)
    if (/^\d+:\s*(if|const|let|var|function|class|return|import|export)\s/.test(trimmed)) return true;
    if (/^\d+[-:].*\.(js|ts|py|md|json|html|css)/.test(trimmed)) return true;
    
    // Multiple line number prefixes (grep output)
    const lineNumberPattern = /^\d+:/;
    const lines = trimmed.split('\n');
    if (lines.length > 2 && lines.filter(l => lineNumberPattern.test(l.trim())).length > lines.length / 2) return true;
    
    // Code blocks with state/config references
    if (trimmed.includes('state.chat.messages') || trimmed.includes('GATEWAY_CONFIG')) return true;
    if (trimmed.includes('maxMessages:') && /\d+:/.test(trimmed)) return true;
    
    // === HEARTBEAT FILTERING ===
    
    // Exact heartbeat matches
    if (trimmed === 'HEARTBEAT_OK') return true;
    
    // === INTERNAL CONTROL MESSAGES ===
    // OpenClaw internal signals that should never appear in chat
    if (trimmed === 'NO_REPLY') return true;
    // Some surfaces truncate/simplify NO_REPLY to "NO"; treat as internal noise as well
    if (trimmed === 'NO') return true;
    if (trimmed === 'REPLY_SKIP') return true;
    if (trimmed === 'ANNOUNCE_SKIP') return true;
    if (trimmed.startsWith('Agent-to-agent announce')) return true;
    
    // System timestamped messages
    if (trimmed.startsWith('System: [')) return true;
    if (trimmed.startsWith('System:')) return true;
    if (/^System:\s*\[/i.test(trimmed)) return true;
    
    // HEARTBEAT messages (cron/scheduled)
    if (trimmed.includes('] HEARTBEAT:')) return true;
    if (trimmed.includes('] Cron:')) return true;
    if (trimmed.includes('] EMAIL CHECK:')) return true;

    // Heartbeat prompts
    if (trimmed.startsWith('Read HEARTBEAT.md if it exists')) return true;

    // Short heartbeat patterns
    if (from === 'solobot' && trimmed.length < 200) {
        const exactStartPatterns = [
            'following heartbeat routine',
            'following the heartbeat routine',
            'checking current status via heartbeat',
        ];

        for (const pattern of exactStartPatterns) {
            if (lowerTrimmed.startsWith(pattern)) {
                return true;
            }
        }
    }

    // Don't filter anything else
    return false;
}

// Provider and Model selection functions (currently just for display)
window.changeProvider = function() {
    console.warn('[Dashboard] Provider selection not implemented - providers are configured at OpenClaw gateway level');
    showToast('Providers must be configured at the OpenClaw gateway level', 'warning');
};

window.updateProviderDisplay = function() {
    const providerSelect = document.getElementById('provider-select');
    if (!providerSelect) return;
    
    const selectedProvider = providerSelect.value;
    
    // Update display (with null check)
    const providerNameEl = document.getElementById('provider-name');
    if (providerNameEl) providerNameEl.textContent = selectedProvider;
    
    // Update model dropdown for this provider
    updateModelDropdown(selectedProvider);
};

// Populate provider dropdown dynamically from API
async function populateProviderDropdown() {
    const selects = [
        document.getElementById('provider-select'),
        document.getElementById('setting-provider')
    ].filter(Boolean);
    
    if (selects.length === 0) {
        console.warn('[Dashboard] No provider-select elements found');
        return [];
    }
    
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) throw new Error(`API returned ${response.status}`);

        const allModels = await response.json();
        const providers = Object.keys(allModels);
        
        for (const select of selects) {
            select.innerHTML = '';
            providers.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider;
                option.textContent = provider.split('-').map(w => 
                    w.charAt(0).toUpperCase() + w.slice(1)
                ).join(' ');
                if (provider === currentProvider) option.selected = true;
                select.appendChild(option);
            });
        }

        return providers;
    } catch (e) {
        console.error('[Dashboard] Failed to fetch providers:', e);
        return [];
    }
}

// Handler for settings page provider dropdown change
window.onSettingsProviderChange = async function() {
    const providerSelect = document.getElementById('setting-provider');
    const modelSelect = document.getElementById('setting-model');
    if (!providerSelect || !modelSelect) return;
    
    const provider = providerSelect.value;
    const models = await getModelsForProvider(provider);
    
    modelSelect.innerHTML = '';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.name;
        if (model.selected) option.selected = true;
        modelSelect.appendChild(option);
    });
};

// Refresh models from CLI (force cache invalidation)
window.refreshModels = async function() {
    showToast('Refreshing models from CLI...', 'info');
    
    try {
        const response = await fetch('/api/models/refresh', { method: 'POST' });
        const result = await response.json();
        
        if (result.ok) {
            showToast(`${result.message}`, 'success');
            // Refresh the provider dropdown with new models
            await populateProviderDropdown();
            // Update model dropdown for current provider (use currentProvider variable as fallback)
            const providerSelect = document.getElementById('provider-select');
            const provider = providerSelect?.value || currentProvider || 'openrouter';
            await updateModelDropdown(provider);
        } else {
            showToast(result.message || 'Failed to refresh models', 'warning');
        }
    } catch (e) {
        console.error('[Dashboard] Failed to refresh models:', e);
        showToast('Failed to refresh models: ' + e.message, 'error');
    }
}

/**
 * Header dropdown: change model for the CURRENT SESSION only.
 * Uses sessions.patch to set a per-session model override.
 */
/**
 * Header dropdown: change model for the CURRENT SESSION and Agent Default.
 * - Updates the current session immediately.
 * - Updates the agent's default configuration (via /api/models/set).
 * - "Global Default" reverts session to valid system default.
 */
window.changeSessionModel = async function() {
    const modelSelect = document.getElementById('model-select');
    const selectedModel = modelSelect?.value;
    
    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }
    
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to gateway', 'warning');
        return;
    }
    
    // Track manual change to prevent UI reversion
    window._lastManualModelChange = Date.now();
    
    try {
        const sessionKey = GATEWAY_CONFIG.sessionKey || 'main';
        console.log(`[Dashboard] Changing model to: ${selectedModel} (session: ${sessionKey})`);

        if (selectedModel === 'global/default') {
            // Revert session to use global default (remove override)
            await gateway.patchSession(sessionKey, { model: null });
            
            // Fetch current global default to update UI
            const response = await fetch('/api/models/current');
            const globalModel = await response.json();
            
            if (globalModel?.modelId) {
                currentModel = globalModel.modelId;
                const provider = globalModel.provider || currentModel.split('/')[0];
                currentProvider = provider;
                
                // Update UI to show the resolved global model
                syncModelDisplay(currentModel, currentProvider);
                showToast('Reverted to Global Default', 'success');
            }
        } else {
            // 1. Update Current Session (Immediate)
            await gateway.patchSession(sessionKey, { model: selectedModel });
            
            // 2. Update Agent/Global Default (Persist)
            // This ensures new sessions or page reloads use this model
            fetch('/api/models/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelId: selectedModel })
            }).catch(e => console.error('Failed to update global default:', e));
            
            // Update local state
            currentModel = selectedModel;
            const provider = selectedModel.split('/')[0];
            currentProvider = provider;
            localStorage.setItem('selected_model', selectedModel);
            localStorage.setItem('selected_provider', provider);
            
            // Update settings display
            const currentModelDisplay = document.getElementById('current-model-display');
            if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;
            const currentProviderDisplay = document.getElementById('current-provider-display');
            if (currentProviderDisplay) currentProviderDisplay.textContent = provider;
            
            // Ensure provider dropdown matches
            const providerSelectEl = document.getElementById('provider-select');
            if (providerSelectEl) {
                const providerOptions = Array.from(providerSelectEl.options);
                if (!providerOptions.find(o => o.value === provider)) {
                    const opt = document.createElement('option');
                    opt.value = provider;
                    opt.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    providerSelectEl.appendChild(opt);
                }
                providerSelectEl.value = provider;
            }
            
            showToast(`Model set to ${selectedModel.split('/').pop()}`, 'success');
        }
    } catch (error) {
        console.error('[Dashboard] Failed to change model:', error);
        showToast(`Failed: ${error.message}`, 'error');
    }
};

/**
 * Settings: change the GLOBAL DEFAULT model for all agents.
 * Patches openclaw.json via the server API and triggers gateway restart.
 */
window.changeGlobalModel = async function() {
    const modelSelect = document.getElementById('setting-model');
    const providerSelect = document.getElementById('setting-provider');
    const selectedModel = modelSelect?.value;
    const selectedProvider = providerSelect?.value;
    
    if (!selectedModel) {
        showToast('Please select a model', 'warning');
        return;
    }
    
    if (selectedModel.includes('ERROR')) {
        showToast('Cannot change model - configuration error', 'error');
        return;
    }
    
    try {
        console.log(`[Dashboard] Changing global default model to: ${selectedModel}`);
        
        const response = await fetch('/api/models/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: selectedModel })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentModel = selectedModel;
            const provider = selectedModel.split('/')[0];
            currentProvider = provider;
            localStorage.setItem('selected_provider', provider);
            localStorage.setItem('selected_model', selectedModel);
            
            // Update all displays
            const currentModelDisplay = document.getElementById('current-model-display');
            const currentProviderDisplay = document.getElementById('current-provider-display');
            if (currentModelDisplay) currentModelDisplay.textContent = selectedModel;
            if (currentProviderDisplay) currentProviderDisplay.textContent = provider;
            
            // Sync header dropdown
            selectModelInDropdowns(selectedModel);
            
            showToast(`Global default → ${selectedModel.split('/').pop()}. Gateway restarting...`, 'success');
        } else {
            showToast(`Failed: ${result.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('[Dashboard] Error changing global model:', error);
        showToast(`Failed: ${error.message}`, 'error');
    }
};

// Legacy alias — keep for any old references
window.changeModel = window.changeSessionModel;

async function updateModelDropdown(provider) {
    const models = await getModelsForProvider(provider);
    
    // Populate both dropdowns independently
    const selects = [
        document.getElementById('model-select'),
        document.getElementById('setting-model')
    ].filter(Boolean);
    
    for (const select of selects) {
        select.innerHTML = '';
        
        // Add "Global Default" option first
        const globalOption = document.createElement('option');
        globalOption.value = 'global/default';
        globalOption.textContent = 'Global Default 🌐';
        globalOption.style.fontWeight = 'bold';
        select.appendChild(globalOption);
        
        // Add separator
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '──────────';
        select.appendChild(separator);
        
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.name;
            if (model.selected) option.selected = true;
            select.appendChild(option);
        });
        
        // If current model matches global default, select it? 
        // Logic handled by selectModelInDropdowns or syncModelDisplay
    }
}

async function getModelsForProvider(provider) {
    // Prefer gateway-sourced models (fetched via WebSocket — most reliable)
    if (window._gatewayModels && window._gatewayModels[provider]) {
        const providerModels = window._gatewayModels[provider];
        return providerModels.map(m => ({
            value: m.id,
            name: m.name,
            selected: (m.id === currentModel)
        }));
    }
    
    // Fallback: fetch from server API
    try {
        const response = await fetch('/api/models/list');
        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const allModels = await response.json();

        // Get models for the requested provider
        const providerModels = allModels[provider] || [];

        // Transform to expected format and mark current as selected
        const models = providerModels.map(m => ({
            value: m.id,
            name: m.name,
            selected: (m.id === currentModel)
        }));

        return models;
    } catch (e) {
        console.error('[Dashboard] Failed to get models from API:', e);
        return [];
    }
}

function getConfiguredModels() {
    // Fallback to configured models if command fails
    try {
        const exec = require('child_process').execSync;
        const result = exec('moltbot models list 2>/dev/null | tail -n +4', { encoding: 'utf8' });
        
        const models = [];
        const lines = result.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const modelId = parts[0];
                const tags = parts[parts.length - 1] || '';
                
                models.push({
                    value: modelId,
                    name: modelId.split('/').pop() || modelId,
                    selected: tags.includes('default') || tags.includes('configured')
                });
            }
        }
        
        return models;
    } catch (e) {
        return [];
    }
}

// Current model state
let currentProvider = 'anthropic';
let currentModel = 'anthropic/claude-opus-4-5';

/**
 * Sync the model dropdown and display elements with the actual model in use.
 * Called when we get model info from gateway connect or chat responses.
 * This is the source of truth — gateway tells us what model is actually running.
 */
function syncModelDisplay(model, provider) {
    if (!model) return;
    
    // Ignore updates if manual change happened recently (prevent reversion flicker)
    if (window._lastManualModelChange && (Date.now() - window._lastManualModelChange < 3000)) {
        return;
    }
    
    if (model === currentModel && provider === currentProvider) return;
    
    console.log(`[Dashboard] Model sync: ${currentModel} → ${model} (provider: ${provider || currentProvider})`);
    currentModel = model;
    
    // Extract provider from model ID if not provided
    if (!provider && model.includes('/')) {
        provider = model.split('/')[0];
    }
    if (provider) currentProvider = provider;
    
    // Update localStorage
    localStorage.setItem('selected_model', model);
    if (provider) localStorage.setItem('selected_provider', provider);
    
    // Update settings modal displays
    const currentModelDisplay = document.getElementById('current-model-display');
    if (currentModelDisplay) currentModelDisplay.textContent = model;
    
    // Update provider display & dropdown
    if (provider) {
        const currentProviderDisplay = document.getElementById('current-provider-display');
        if (currentProviderDisplay) currentProviderDisplay.textContent = provider;
        
        const providerSelectEl = document.getElementById('provider-select');
        if (providerSelectEl) {
            // Make sure provider option exists
            const providerOptions = Array.from(providerSelectEl.options);
            if (!providerOptions.find(o => o.value === provider)) {
                const opt = document.createElement('option');
                opt.value = provider;
                opt.textContent = provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                providerSelectEl.appendChild(opt);
            }
            providerSelectEl.value = provider;
        }
        
        // Refresh model dropdown for this provider, then select the right model
        updateModelDropdown(provider).then(() => {
            selectModelInDropdowns(model);
        });
    } else {
        selectModelInDropdowns(model);
    }
}

// Apply per-session model override from availableSessions (if present)
async function applySessionModelOverride(sessionKey) {
    if (!sessionKey) return;
    
    let sessionModel = null;
    
    // 1. Check local availableSessions cache (model = last used model from sessions.list)
    const session = availableSessions.find(s => s.key === sessionKey);
    const cachedModel = session?.model && session.model !== 'unknown' ? session.model : null;
    if (cachedModel) {
        sessionModel = cachedModel;
    }
    
    // 2. If not cached, refresh sessions list from gateway
    if (!sessionModel) {
        try {
            const result = await gateway?.listSessions?.({});
            if (result?.sessions?.length) {
                availableSessions = result.sessions.map(s => ({
                    key: s.key,
                    name: getFriendlySessionName(s.key),
                    displayName: getFriendlySessionName(s.key),
                    updatedAt: s.updatedAt,
                    totalTokens: s.totalTokens || (s.inputTokens || 0) + (s.outputTokens || 0),
                    model: s.model || 'unknown',
                    sessionId: s.sessionId
                }));
                const updated = availableSessions.find(s => s.key === sessionKey);
                const updatedModel = updated?.model && updated.model !== 'unknown' ? updated.model : null;
                if (updatedModel) sessionModel = updatedModel;
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to refresh sessions for model override:', e.message);
        }
    }
    
    // 3. Fallback: use global default from openclaw.json via config.get
    if (!sessionModel) {
        try {
            if (gateway && gateway.isConnected()) {
                const config = await gateway.getConfig();
                let configData = config;
                if (typeof config === 'string') configData = JSON.parse(config);
                if (configData?.raw) configData = JSON.parse(configData.raw);
                const primary = configData?.agents?.defaults?.model?.primary;
                if (primary) {
                    sessionModel = primary;
                    console.log(`[Dashboard] Session ${sessionKey} using global default: ${sessionModel}`);
                }
            }
        } catch (e) {
            console.warn('[Dashboard] Failed to fetch global default model:', e.message);
        }
    }
    
    if (sessionModel) {
        const provider = sessionModel.includes('/') ? sessionModel.split('/')[0] : currentProvider;
        syncModelDisplay(sessionModel, provider);
    } else {
        console.warn(`[Dashboard] No model found for session ${sessionKey}, keeping current display`);
    }
}

/**
 * Fetch model configuration directly from the gateway via WebSocket RPC.
 * This is the most reliable source — it reads the live openclaw.json from the running gateway.
 */
async function fetchModelsFromGateway() {
    if (!gateway || !gateway.isConnected()) return;
    
    try {
        const config = await gateway.getConfig();
        
        // Parse the config to find model info
        let configData = config;
        if (typeof config === 'string') {
            configData = JSON.parse(config);
        }
        // config.get might return { raw: "...", hash: "..." }
        if (configData?.raw) {
            configData = JSON.parse(configData.raw);
        }
        
        const modelConfig = configData?.agents?.defaults?.model;
        if (!modelConfig) {
            console.warn('[Dashboard] No model config in gateway response');
            return;
        }
        
        const primary = modelConfig.primary;
        const fallbacks = modelConfig.fallbacks || [];
        const picker = modelConfig.picker || [];
        
        // Combine all model IDs
        const allModelIds = [...new Set([
            ...(primary ? [primary] : []),
            ...picker,
            ...fallbacks
        ])];
        
        if (allModelIds.length === 0) return;
        
        console.log(`[Dashboard] Got ${allModelIds.length} models from gateway config`);
        
        // Group by provider
        const modelsByProvider = {};
        for (const modelId of allModelIds) {
            const slashIdx = modelId.indexOf('/');
            if (slashIdx === -1) continue;
            
            const provider = modelId.substring(0, slashIdx);
            const modelName = modelId.substring(slashIdx + 1);
            
            if (!modelsByProvider[provider]) modelsByProvider[provider] = [];
            
            // Create a clean display name
            const isPrimary = modelId === primary;
            const displayName = modelName + (isPrimary ? ' ⭐' : '');
            
            if (!modelsByProvider[provider].some(m => m.id === modelId)) {
                modelsByProvider[provider].push({
                    id: modelId,
                    name: displayName,
                    tier: isPrimary ? 'default' : 'fallback'
                });
            }
        }
        
        // Update the provider dropdown
        const providerSelect = document.getElementById('provider-select');
        if (providerSelect) {
            const providers = Object.keys(modelsByProvider);
            providerSelect.innerHTML = '';
            providers.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                providerSelect.appendChild(opt);
            });
        }
        
        // Store for getModelsForProvider to use
        window._gatewayModels = modelsByProvider;
        
        // Sync current model — prefer session-specific model over global primary
        const sessionModel = availableSessions?.find(s => s.key === currentSessionName)?.model;
        if (sessionModel && sessionModel !== 'unknown') {
            syncModelDisplay(sessionModel, sessionModel.split('/')[0]);
        } else if (primary) {
            syncModelDisplay(primary, primary.split('/')[0]);
        }
        
    } catch (e) {
        console.warn('[Dashboard] Failed to fetch models from gateway:', e.message);
    }
}

/**
 * Select a model in both header and settings dropdowns.
 * Adds the option dynamically if it's not already listed.
 */
function selectModelInDropdowns(model) {
    const shortName = model.split('/').pop() || model;
    
    const modelSelect = document.getElementById('model-select');
    const settingModel = document.getElementById('setting-model');
    
    [modelSelect, settingModel].forEach(select => {
        if (!select) return;
        const options = Array.from(select.options);
        const match = options.find(o => o.value === model);
        if (match) {
            select.value = model;
        } else {
            // Model not in dropdown — add it
            const option = document.createElement('option');
            option.value = model;
            option.textContent = shortName;
            option.selected = true;
            select.appendChild(option);
        }
    });
}

// Initialize provider/model display on page load
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // First populate the provider dropdown dynamically
        await populateProviderDropdown();
        
        // Always fetch current model from server API (reads openclaw.json — source of truth)
        // Don't trust localStorage as it can get stale across sessions/deploys
        let modelId = null;
        let provider = null;
        
        try {
            const response = await fetch('/api/models/current');
            const modelInfo = await response.json();
            modelId = modelInfo?.modelId;
            provider = modelInfo?.provider;
            console.log(`[Dashboard] Model from API: ${modelId} (provider: ${provider})`);
        } catch (e) {
            console.warn('[Dashboard] Failed to fetch current model from API:', e.message);
            // Fall back to localStorage only if API fails
            modelId = localStorage.getItem('selected_model');
            provider = localStorage.getItem('selected_provider');
        }
        
        // Final fallback
        if (!modelId) modelId = 'anthropic/claude-opus-4-5';
        if (!provider) provider = modelId.split('/')[0];
        
        currentProvider = provider;
        currentModel = modelId;

        console.log(`[Dashboard] Init model: ${currentModel} (provider: ${currentProvider})`);
        
        // Update displays
        const currentProviderDisplay = document.getElementById('current-provider-display');
        const currentModelDisplay = document.getElementById('current-model-display');
        const providerSelectEl = document.getElementById('provider-select');
        
        if (currentProviderDisplay) currentProviderDisplay.textContent = currentProvider;
        if (currentModelDisplay) currentModelDisplay.textContent = currentModel;
        if (providerSelectEl) providerSelectEl.value = currentProvider;
        
        // Also sync settings provider dropdown
        const settingProviderEl = document.getElementById('setting-provider');
        if (settingProviderEl) settingProviderEl.value = currentProvider;
        
        // Populate model dropdown for current provider and select current model
        await updateModelDropdown(currentProvider);
        selectModelInDropdowns(currentModel);
        
    } catch (error) {
        console.error('[Dashboard] Failed to initialize model display:', error);
    }
});

// Default settings
const defaultSettings = {
    pickupFreq: 'disabled',
    priorityOrder: 'priority',
    refreshInterval: '10000',
    defaultPriority: '1',
    compactMode: false,
    showLive: true,
    showActivity: true,
    showNotes: true,
    showProducts: true,
    showDocs: true
};


