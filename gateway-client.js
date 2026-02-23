const GATEWAY_DEBUG = true;
const GATEWAY_DEBUG_EVENTS = true;
function gwLog(...args) { if (GATEWAY_DEBUG) console.log(...args); }
function gwEventLog(...args) { if (GATEWAY_DEBUG_EVENTS) console.log(...args); }
function gwWarn(...args) { if (GATEWAY_DEBUG) console.warn(...args); }
// Gateway WebSocket Client v3
// Connects to OpenClaw Gateway for shared session chat

const GATEWAY_PROTOCOL_VERSION = 3;

// ── Device Identity (Ed25519) ─────────────────────────────────────
// Generates/loads a persistent Ed25519 keypair in localStorage so the
// gateway grants operator scopes (required since OpenClaw v2026.2.15).

const DEVICE_IDENTITY_KEY = 'openclaw-device-identity';

function normalizeSessionKey(key) {
    if (!key || key === 'main') return 'agent:main:main';
    return key;
}

function normalizeGatewayModelId(modelId) {
    if (!modelId || typeof modelId !== 'string') return modelId;
    if (modelId === 'global/default' || modelId.includes('/')) return modelId;

    const knownPrefixes = {
        claude: 'anthropic',
        gpt: 'openai-codex',
        o1: 'openai',
        o3: 'openai',
        gemini: 'google',
        kimi: 'moonshot'
    };

    for (const [prefix, provider] of Object.entries(knownPrefixes)) {
        if (modelId.startsWith(prefix)) return `${provider}/${modelId}`;
    }
    return modelId;
}

function _collectTextFromPart(part) {
    if (!part || typeof part !== 'object') return '';
    const partType = String(part.type || '').toLowerCase();

    if (typeof part.text === 'string') return part.text;
    if (typeof part.output_text === 'string') return part.output_text;
    if (typeof part.input_text === 'string') return part.input_text;
    if (typeof part.content === 'string' && !partType.includes('image')) return part.content;

    return '';
}

function _extractMessageContent(message, payload = null) {
    const textCandidates = [];
    const imageCandidates = [];

    const pushTextCandidate = (value) => {
        if (typeof value !== 'string') return;
        const normalized = value.replace(/\r\n/g, '\n');
        if (!normalized.trim()) return;
        textCandidates.push(normalized);
    };

    const pushImageCandidate = (urlOrData) => {
        if (typeof urlOrData !== 'string' || !urlOrData) return;
        imageCandidates.push(urlOrData);
    };

    const handlePart = (part) => {
        if (!part || typeof part !== 'object') return;
        const partType = String(part.type || '').toLowerCase();

        const partText = _collectTextFromPart(part);
        if (partText) pushTextCandidate(partText);

        if (partType === 'image' || partType === 'input_image') {
            const imageData = part.data || part.content || part.source?.data;
            if (imageData) {
                const mimeType = part.mimeType || part.media_type || part.source?.media_type || 'image/jpeg';
                pushImageCandidate(`data:${mimeType};base64,${imageData}`);
            }
        } else if (partType === 'image_url') {
            pushImageCandidate(part.url || part.image_url?.url || part.source?.url || '');
        }
    };

    if (Array.isArray(message?.content)) {
        for (const part of message.content) handlePart(part);
        const contentPartsText = message.content.map(_collectTextFromPart).filter(Boolean).join('');
        pushTextCandidate(contentPartsText);
    } else if (typeof message?.content === 'string') {
        pushTextCandidate(message.content);
    }

    if (Array.isArray(message?.output)) {
        for (const output of message.output) {
            if (!output || typeof output !== 'object') continue;
            pushTextCandidate(output.text);
            if (Array.isArray(output.content)) {
                for (const part of output.content) handlePart(part);
                const outputPartsText = output.content.map(_collectTextFromPart).filter(Boolean).join('');
                pushTextCandidate(outputPartsText);
            }
        }
    }

    pushTextCandidate(message?.text);
    pushTextCandidate(message?.output_text);
    pushTextCandidate(message?.delta);
    pushTextCandidate(payload?.content);
    pushTextCandidate(payload?.text);
    pushTextCandidate(payload?.delta);

    let bestText = '';
    for (const candidate of textCandidates) {
        if (candidate.length > bestText.length) bestText = candidate;
    }

    const uniqueImages = [...new Set(imageCandidates.filter(Boolean))];
    return { text: bestText, images: uniqueImages };
}

function _normalizeGatewayTextForSignature(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function _buildGatewayImageSignature(imageDataUrls) {
    if (!Array.isArray(imageDataUrls)) return '';
    return imageDataUrls.map((imageDataUrl) => {
        if (typeof imageDataUrl !== 'string') return '0:';
        return `${imageDataUrl.length}:${imageDataUrl.slice(-16)}`;
    }).join('|');
}

function _base64UrlEncode(buf) {
    // buf: Uint8Array → base64url string (no padding)
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function _base64UrlDecode(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function _sha256Hex(data) {
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Ed25519 raw public key is the last 32 bytes of the SPKI export
// SPKI prefix for Ed25519 is 12 bytes: 302a300506032b6570032100
const ED25519_SPKI_PREFIX_LEN = 12;

async function _deriveDeviceId(publicKey) {
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    const spkiBytes = new Uint8Array(spki);
    // Raw public key = SPKI minus the 12-byte prefix
    const raw = spkiBytes.subarray(ED25519_SPKI_PREFIX_LEN);
    return _sha256Hex(raw);
}

async function _exportPublicKeyRawBase64Url(publicKey) {
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    const raw = new Uint8Array(spki).subarray(ED25519_SPKI_PREFIX_LEN);
    return _base64UrlEncode(raw);
}

async function loadOrCreateDeviceIdentity() {
    try {
        const stored = localStorage.getItem(DEVICE_IDENTITY_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed?.version === 1 && parsed.publicKeyJwk && parsed.privateKeyJwk && parsed.deviceId) {
                // Re-import keys from JWK
                const publicKey = await crypto.subtle.importKey(
                    'jwk', parsed.publicKeyJwk,
                    { name: 'Ed25519' }, true, ['verify']
                );
                const privateKey = await crypto.subtle.importKey(
                    'jwk', parsed.privateKeyJwk,
                    { name: 'Ed25519' }, true, ['sign']
                );
                gwLog('[Gateway] Device identity loaded from localStorage');
                return { deviceId: parsed.deviceId, publicKey, privateKey };
            }
        }
    } catch (e) {
        gwWarn('[Gateway] Failed to load device identity, regenerating:', e);
    }

    // Generate new Ed25519 keypair
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const deviceId = await _deriveDeviceId(keyPair.publicKey);
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify({
        version: 1,
        deviceId,
        publicKeyJwk,
        privateKeyJwk,
        createdAtMs: Date.now()
    }));

    gwLog('[Gateway] Device identity generated and stored');
    return { deviceId, publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

function _buildDeviceAuthPayload(params) {
    const scopes = params.scopes.join(',');
    const token = params.token || '';
    const parts = [
        'v2',
        params.deviceId,
        params.clientId,
        params.clientMode,
        params.role,
        scopes,
        String(params.signedAtMs),
        token,
        params.nonce || ''
    ];
    return parts.join('|');
}

async function _signPayload(privateKey, payload) {
    const encoded = new TextEncoder().encode(payload);
    const sig = await crypto.subtle.sign('Ed25519', privateKey, encoded);
    return _base64UrlEncode(new Uint8Array(sig));
}

class GatewayClient {
    constructor(options = {}) {
        this.socket = null;
        this.connected = false;
        this.sessionKey = normalizeSessionKey(options.sessionKey || 'agent:main:main');
        this.pending = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.desiredConnection = null;
        this._reconnectTimer = null;
        this._isConnecting = false;
        this._nodeEventUnsupported = false;
        this._identityRecoveryAttempted = false;
        this._inFlightSend = null;

        // Callbacks
        this.onConnected = options.onConnected || (() => { });
        this.onDisconnected = options.onDisconnected || (() => { });
        this.onChatEvent = options.onChatEvent || (() => { });
        this.onToolEvent = options.onToolEvent || (() => { });
        this.onError = options.onError || (() => { });
        this.onCrossSessionMessage = options.onCrossSessionMessage || (() => { });

        // Track all subscribed sessions for cross-session notifications
        this._subscribedSessions = new Set();
    }

    connect(host, port, token, password = null) {
        // Close existing socket if already connecting/connected
        if (this.socket) {
            try {
                this.desiredConnection = null; // prevent reconnect from onclose
                this.socket.close();
            } catch { }
            this.socket = null;
            this.connected = false;
        }
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this.desiredConnection = { host, port, token, password };
        this._doConnect();
    }

    _doConnect() {
        if (!this.desiredConnection) return;
        if (this._isConnecting) return;

        this._isConnecting = true;

        const { host, port, token, password } = this.desiredConnection;
        const cleanHost = host.replace(/^(wss?|https?):\/\//, '');
        const pageIsSecure = window.location.protocol === 'https:';
        const protocol = pageIsSecure || port === 443 || host.includes('wss') || host.includes('https') ? 'wss' : 'ws';
        const url = `${protocol}://${cleanHost}:${port}`;

        gwLog(`[Gateway] Connecting to ${url}`);

        try {
            this.socket = new WebSocket(url);
            this._setupListeners(token, password);
        } catch (err) {
            this._isConnecting = false;
            console.error('[Gateway] Connection failed:', err);
            this.onError(`Connection failed: ${err.message}`);
            this._scheduleReconnect();
        }
    }

    _setupListeners(token, password) {
        this._challengeNonce = null;
        this._connectSent = false;

        this.socket.onopen = () => {
            this._isConnecting = false;
            // Don't send connect yet — wait for connect.challenge event with nonce
            gwLog('[Gateway] Socket open, waiting for connect.challenge...');
        };

        this.socket.onmessage = (event) => {
            // Intercept connect.challenge before normal message handling
            if (!this._connectSent) {
                try {
                    const frame = JSON.parse(event.data);
                    if (frame.type === 'event' && frame.event === 'connect.challenge') {
                        this._challengeNonce = frame.payload?.nonce || null;
                        gwLog(`[Gateway] Received challenge nonce: ${this._challengeNonce ? 'yes' : 'none'}`);
                        this._sendConnect(token, password);
                        this._connectSent = true;
                        return;
                    }
                } catch { }
            }
            this._handleMessage(event.data);
        };

        this.socket.onerror = (err) => {
            this._isConnecting = false;
            console.error('[Gateway] WebSocket error');
            this.onError('WebSocket error');
        };

        this.socket.onclose = (event) => {
            this._isConnecting = false;
            gwLog(`[Gateway] Disconnected: ${event.code}`);
            this.connected = false;
            this.onDisconnected(event.reason || 'Connection closed');

            if (this.desiredConnection) {
                this._scheduleReconnect();
            }
        };
    }

    async _sendConnect(token, password) {
        const clientId = 'gateway-client';
        const clientMode = 'ui';
        const role = 'operator';
        const scopes = ['operator.read', 'operator.write', 'operator.admin'];

        const clientInfo = {
            id: clientId,
            displayName: 'SoLoBot Dashboard',
            version: '3.1.0',
            platform: 'web',
            mode: clientMode
        };

        const params = {
            minProtocol: GATEWAY_PROTOCOL_VERSION,
            maxProtocol: GATEWAY_PROTOCOL_VERSION,
            client: clientInfo,
            role,
            scopes,
            caps: ['chat.subscribe']
        };

        if (token) {
            params.auth = { token };
        } else if (password) {
            params.auth = { password };
        }

        // Build device identity for operator scope grants
        try {
            const identity = await loadOrCreateDeviceIdentity();
            const signedAt = Date.now();
            const publicKeyBase64Url = await _exportPublicKeyRawBase64Url(identity.publicKey);

            const payload = _buildDeviceAuthPayload({
                deviceId: identity.deviceId,
                clientId,
                clientMode,
                role,
                scopes,
                signedAtMs: signedAt,
                token: token || null,
                nonce: this._challengeNonce || ''
            });

            const signature = await _signPayload(identity.privateKey, payload);

            params.device = {
                id: identity.deviceId,
                publicKey: publicKeyBase64Url,
                signature,
                signedAt,
                nonce: this._challengeNonce || undefined
            };

            gwLog(`[Gateway] Device identity attached: ${identity.deviceId.substring(0, 12)}...`);
        } catch (err) {
            gwWarn('[Gateway] Device identity failed (scopes may be limited):', err.message);
            // Continue without device identity — will have no scopes on v2026.2.15+
        }

        this._request('connect', params).then(result => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this._identityRecoveryAttempted = false;

            const serverName = result?.server?.host || 'moltbot';
            gwLog(`[Gateway] Connected to ${serverName}, session: ${this.sessionKey}`);

            // Log granted scopes/auth info
            if (result?.auth?.scopes) {
                gwLog(`[Gateway] Granted scopes: ${result.auth.scopes.join(', ')}`);
            }

            // Check if provider/model info is available
            if (result?.provider || result?.model) {
                gwLog(`[Gateway] Server provider: ${result.provider || 'unknown'}, model: ${result.model || 'unknown'}`);
                // Store in localStorage so dashboard can display it
                if (result.provider) localStorage.setItem('server_provider', result.provider);
                if (result.model) localStorage.setItem('server_model', result.model);
            }

            this.onConnected(serverName, this.sessionKey);
            this._subscribeToSession(this.sessionKey);

        }).catch(err => {
            const errMsg = String(err?.message || 'Auth failed');
            console.error('[Gateway] Auth failed:', errMsg);

            // Recover once from stale identity/token state observed as "User not found"
            if (!this._identityRecoveryAttempted && /user not found/i.test(errMsg)) {
                this._identityRecoveryAttempted = true;
                try { localStorage.removeItem(DEVICE_IDENTITY_KEY); } catch { }
                this.onError('Auth user missing; regenerating device identity and reconnecting...');
                this.socket?.close();
                this._scheduleReconnect();
                return;
            }

            this.onError(`Auth failed: ${errMsg}`);
            this.socket?.close();
        });
    }

    _subscribeToSession(sessionKey) {
        const normalizedKey = normalizeSessionKey(sessionKey);
        this._subscribedSessions.add(normalizedKey.toLowerCase());

        // Disabled for operator-role UI clients on current gateway policy.
        // Prevents repeated unauthorized warnings and reconnect noise.
    }

    subscribeToAllSessions(sessionKeys) {
        for (const key of sessionKeys) {
            if (!this._subscribedSessions.has(key.toLowerCase())) {
                this._subscribeToSession(key);
            }
        }
    }

    // Public API for making requests (restores compatibility with older dashboard scripts)
    async request(method, params, timeoutMs = 15000) {
        return this._request(method, params, timeoutMs);
    }

    async _request(method, params, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();

            const frame = {
                type: 'req',
                id,
                method,
                params
            };

            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Request timeout'));
            }, timeoutMs);

            this.pending.set(id, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    reject(err);
                }
            });

            this.socket.send(JSON.stringify(frame));
        });
    }

    _handleMessage(data) {
        try {
            const frame = JSON.parse(data);

            if (frame.type === 'res') {
                this._handleResponse(frame);
            } else if (frame.type === 'event') {
                this._handleEvent(frame);
            }
        } catch (err) {
            console.error('[Gateway] Parse error:', err);
        }
    }

    _handleResponse(frame) {
        const waiter = this.pending.get(frame.id);
        if (!waiter) return;

        this.pending.delete(frame.id);

        if (frame.ok) {
            waiter.resolve(frame.payload);
        } else {
            const errMsg = frame.error?.message || 'Request failed';
            waiter.reject(new Error(errMsg));
        }
    }

    _handleEvent(frame) {
        const event = frame.event;
        const payload = frame.payload || (frame.payloadJSON ? JSON.parse(frame.payloadJSON) : null);

        if (event === 'chat') {
            // Only log non-delta chat events (deltas are too noisy — hundreds per response)
            if (payload?.state !== 'delta') {
                gwLog(`[Gateway] 📨 Chat event: session=${payload?.sessionKey}, state=${payload?.state}, role=${payload?.message?.role}`);
            }
            this._handleChatEvent(payload);
        } else if (event === 'agent') {
            this._handleAgentEvent(payload);
        } else {
            // Suppress noisy events (tick, health, cron, heartbeat)
            if (!['tick', 'health', 'cron', 'heartbeat'].includes(event)) {
                gwLog(`[Gateway] Event: ${event}`);
            }
        }
    }

    _handleAgentEvent(payload) {
        if (!payload) return;

        // Catch lifecycle events (e.g. for model fallbacks)
        if (payload.stream === 'lifecycle') {
            const data = payload.data;
            if (data?.phase === 'fallback') {
                console.warn(`[Gateway] ⚠️ Model fallback triggered for session ${payload.sessionKey}`);
                console.warn(`[Gateway]    Original model: ${data.selectedProvider}/${data.selectedModel}`);
                console.warn(`[Gateway]    Fallback chosen: ${data.activeProvider}/${data.activeModel}`);
                console.warn(`[Gateway]    Reason: ${data.reasonSummary}`);

                if (Array.isArray(data.attempts) && data.attempts.length > 0) {
                    console.warn(`[Gateway] 🔄 Fallback Attempt History:`);
                    data.attempts.forEach((attempt, idx) => {
                        const status = attempt.success ? "✅ Success" : "❌ Failed";
                        console.warn(`             ${idx + 1}. [${status}] ${attempt.provider}/${attempt.model}`);
                        if (attempt.error) {
                            console.warn(`                ↳ Error: ${attempt.error}`);
                        }
                    });
                }
            }
            return;
        }

        // Only handle tool events
        if (payload.stream !== 'tool') return;

        const phase = payload.data?.phase;
        const toolName = payload.data?.name;
        const args = payload.data?.args;

        if (phase === 'start' && toolName) {
            // Format the tool call for display
            let summary = `🔧 ${toolName}`;
            if (args) {
                if (toolName === 'exec' && args.command) {
                    const cmd = args.command.length > 60 ? args.command.substring(0, 57) + '...' : args.command;
                    summary = `🔧 ${cmd}`;
                } else if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') {
                    const path = args.path || args.file_path || '';
                    const filename = path.split('/').pop();
                    const icon = toolName === 'Edit' ? '✏️' : toolName === 'Write' ? '📝' : '📖';
                    summary = `${icon} ${toolName}: ${filename}`;
                } else if (toolName === 'web_search') {
                    summary = `🔍 Search: ${(args.query || '').substring(0, 40)}`;
                } else if (toolName === 'web_fetch') {
                    summary = `🌐 Fetch: ${(args.url || '').substring(0, 40)}`;
                }
            }

            // Emit as tool event callback
            if (this.onToolEvent) {
                this.onToolEvent({
                    phase: 'start',
                    name: toolName,
                    summary,
                    timestamp: payload.ts || Date.now()
                });
            }
        }
    }

    _handleChatEvent(payload) {
        if (!payload) return;

        // Route by session key (case-insensitive)
        const eventSessionKey = payload.sessionKey || 'main';
        const currentKey = this.sessionKey.toLowerCase();
        const eventKey = eventSessionKey.toLowerCase();

        if (eventKey !== currentKey) {
            // Cross-session message — route to notification callback
            const state = payload.state;
            const message = payload.message;
            const role = message?.role || '';

            // Only log cross-session notifications, not every delta/tick (too noisy)

            if (state === 'final' && role === 'assistant') {
                const { text: contentText, images } = _extractMessageContent(message, payload);
                if (contentText.trim() || images.length > 0) {
                    // Skip read-ack sync messages
                    if (contentText.startsWith('[[read_ack]]')) {
                        return;
                    }
                    gwLog(`[Gateway] 🔔 Cross-session notification: ${eventSessionKey} (${contentText.length} chars, ${images.length} images)`);
                    this.onCrossSessionMessage({
                        sessionKey: eventSessionKey,
                        content: contentText,
                        images: images,
                        model: message?.model,
                        provider: message?.provider
                    });
                }
            }
            return;
        }

        const state = payload.state;
        const message = payload.message;

        // Extract text content, images, and role
        const { text: contentText, images } = _extractMessageContent(message, payload);
        let role = message?.role || payload.role || 'assistant';

        let errorMsg = message?.errorMessage || payload.errorMessage || payload?.error?.message;

        // OpenClaw's embedded agent SDK strips underlying error info in favor of a standard Rate Limit response
        // Re-inject the model so the dashboard user knows which fallback triggered it
        if (errorMsg === "⚠️ API rate limit reached. Please try again later.") {
            const problemModel = message?.model || payload.model || 'unknown';
            errorMsg = `⚠️ Rate limit reached (Model: ${problemModel}). Please try again.`;
        }

        // Log chat events with model info for debugging
        if (state === 'delta') {
            // Only log first delta to avoid spam
            if (!this._loggedDelta) {
                gwLog(`[Gateway] ⬇️ Receiving response (model: ${message?.model || 'unknown'}, provider: ${message?.provider || 'unknown'})`);
                this._loggedDelta = true;
            }
        } else if (state === 'final') {
            this._loggedDelta = false;
            const contentLen = contentText.length;
            const stopReason = message?.stopReason;

            if (errorMsg) {
                console.error(`[Gateway] ❌ AI RESPONSE ERROR: ${errorMsg}`);
                console.error(`[Gateway]    Provider: ${message?.provider || 'unknown'}, Model: ${message?.model || 'unknown'}`);
                console.error(`[Gateway]    Stop reason: ${stopReason || 'none'}`);
            } else if (contentLen === 0 && role === 'assistant') {
                gwWarn(`[Gateway] ⚠️ Empty response from AI (stopReason: ${stopReason}, provider: ${message?.provider})`);
            } else {
                gwLog(`[Gateway] ✅ Response complete: ${contentLen} chars (stopReason: ${stopReason || 'end_turn'})`);
            }
        } else if (state === 'error') {
            this._loggedDelta = false;
            console.error(`[Gateway] ❌ Chat error state: ${errorMsg || 'Unknown error'}`);
        }

        // Check if this is a health check response - resolve the promise
        if (window._healthCheckResolvers && eventSessionKey) {
            const healthResolver = window._healthCheckResolvers[eventSessionKey];
            if (healthResolver) {
                if (state === 'complete') {
                    healthResolver.resolve({ content: contentText, state });
                } else if (state === 'error') {
                    healthResolver.reject(new Error(errorMsg || 'Chat error'));
                }
            }
        }

        this.onChatEvent({
            state,
            content: contentText,
            images: images,
            role,
            sessionKey: eventSessionKey,
            errorMessage: errorMsg ? `${errorMsg} (Model: ${message?.model || payload.model || 'unknown'})` : null,
            // Pass through model info for dashboard to use
            model: message?.model || payload.model,
            provider: message?.provider || payload.provider,
            stopReason: message?.stopReason,
            runId: message?.runId || payload.runId
        });
    }

    async sendMessage(text) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        const normalizedSessionKey = normalizeSessionKey(this.sessionKey);
        const sendKey = `text|${normalizedSessionKey}|${_normalizeGatewayTextForSignature(text)}`;
        if (this._inFlightSend?.key === sendKey) {
            gwWarn('[Gateway] Suppressed duplicate in-flight text send');
            return this._inFlightSend.promise;
        }

        const params = {
            message: text,
            sessionKey: normalizedSessionKey,
            idempotencyKey: crypto.randomUUID()
        };

        // Log model and session info
        const model = localStorage.getItem('selected_model') || '(not set)';
        gwLog(`[Gateway] ⬆️ Sending message to session "${this.sessionKey}"`);
        gwLog(`[Gateway]    Model: ${model}`);
        gwLog(`[Gateway]    Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        const requestPromise = this._request('chat.send', params).then(result => {
            gwLog(`[Gateway] ✅ Message sent, runId: ${result?.runId || 'none'}`);
            return result;
        }).catch(err => {
            const msg = String(err?.message || '');
            if (!this._identityRecoveryAttempted && /user not found/i.test(msg)) {
                this._identityRecoveryAttempted = true;
                try { localStorage.removeItem(DEVICE_IDENTITY_KEY); } catch { }
                this.connected = false;
                this.socket?.close();
                this._scheduleReconnect();
                throw new Error('User identity missing; reconnecting and regenerating identity. Please retry.');
            }
            console.error(`[Gateway] ❌ Failed to send message: ${msg}`);
            throw err;
        }).finally(() => {
            if (this._inFlightSend?.key === sendKey) this._inFlightSend = null;
        });

        this._inFlightSend = { key: sendKey, promise: requestPromise };
        return requestPromise;
    }

    sendMessageWithImage(text, imageDataUrl) {
        return this.sendMessageWithImages(text, [imageDataUrl]);
    }

    async sendMessageWithImages(text, imageDataUrls) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        const normalizedSessionKey = normalizeSessionKey(this.sessionKey);
        const sendKey = `images|${normalizedSessionKey}|${_normalizeGatewayTextForSignature(text)}|${_buildGatewayImageSignature(imageDataUrls)}`;
        if (this._inFlightSend?.key === sendKey) {
            gwWarn('[Gateway] Suppressed duplicate in-flight image send');
            return this._inFlightSend.promise;
        }

        // Build attachments array from all images
        const attachments = [];
        for (const imageDataUrl of imageDataUrls) {
            gwLog('[Gateway] Image data type:', typeof imageDataUrl, 'length:', imageDataUrl?.length, 'prefix:', String(imageDataUrl).substring(0, 40));
            const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
            if (!matches) {
                gwWarn('[Gateway] Skipping invalid image data URL');
                continue;
            }
            const mimeType = matches[1];
            const base64Data = matches[2];
            attachments.push({
                type: 'image',
                mimeType: mimeType,
                content: base64Data
            });
        }

        if (attachments.length === 0) {
            return Promise.reject(new Error('No valid images to send'));
        }

        const params = {
            message: text || 'Attached image',
            sessionKey: normalizedSessionKey,
            idempotencyKey: crypto.randomUUID(),
            attachments: attachments
        };

        gwLog('[Gateway] Sending', attachments.length, 'image(s), total size:',
            Math.round(attachments.reduce((sum, a) => sum + a.content.length, 0) / 1024), 'KB');

        // Log model info if available
        const model = localStorage.getItem('selected_model') || '(not set)';
        gwLog(`[Gateway] Sending with ${model}`);

        const requestPromise = this._request('chat.send', params).catch(err => {
            const msg = String(err?.message || '');
            if (!this._identityRecoveryAttempted && /user not found/i.test(msg)) {
                this._identityRecoveryAttempted = true;
                try { localStorage.removeItem(DEVICE_IDENTITY_KEY); } catch { }
                this.connected = false;
                this.socket?.close();
                this._scheduleReconnect();
                throw new Error('User identity missing; reconnecting and regenerating identity. Please retry image send.');
            }
            throw err;
        }).finally(() => {
            if (this._inFlightSend?.key === sendKey) this._inFlightSend = null;
        });

        this._inFlightSend = { key: sendKey, promise: requestPromise };
        return requestPromise;
    }

    /**
     * Send a test message with a specific model - uses EXACT same path as sendMessage.
     * This is for model validation to ensure tests go through the same gateway path as chat.
     */
    async sendTestMessage(text, modelId, explicitSessionKey = null) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        const targetSession = explicitSessionKey || this.sessionKey;
        const normalizedSessionKey = normalizeSessionKey(targetSession);

        const params = {
            message: text,
            sessionKey: normalizedSessionKey,
            idempotencyKey: crypto.randomUUID()
        };

        gwLog(`[Gateway] 🧪 TEST message to session "${normalizedSessionKey}" with model "${modelId}"`);
        gwLog(`[Gateway]    Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

        try {
            const result = await this._request('chat.send', params);
            gwLog(`[Gateway] ✅ Test message sent, runId: ${result?.runId || 'none'}`);
            return result;
        } catch (err) {
            const msg = String(err?.message || '');
            console.error(`[Gateway] ❌ Failed to send test message: ${msg}`);
            throw err;
        }
    }

    loadHistory() {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        return this._request('chat.history', {
            sessionKey: this.sessionKey,
            limit: 200
        }).catch(() => ({ messages: [] }));
    }

    setSessionKey(key) {
        const normalized = normalizeSessionKey(key);
        gwLog(`[Gateway] Switching session from "${this.sessionKey}" to "${normalized}"`);
        this.sessionKey = normalized;
        if (this.connected) {
            this._subscribeToSession(normalized);
        }
    }

    listSessions(opts = {}) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        gwLog('[Gateway] Listing sessions...');
        return this._request('sessions.list', {
            includeDerivedTitles: true,
            ...opts
        }).then(result => {
            gwLog(`[Gateway] Sessions list returned ${result?.sessions?.length || 0} sessions`);
            return result;
        });
    }

    patchSession(sessionKey, patch) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        const normalizedPatch = { ...patch };
        if (typeof normalizedPatch.model === 'string') {
            const normalized = normalizeGatewayModelId(normalizedPatch.model);
            if (normalized !== normalizedPatch.model) {
                gwLog(`[Gateway] Normalized model "${normalizedPatch.model}" -> "${normalized}"`);
                normalizedPatch.model = normalized;
            }
        }

        gwLog(`[Gateway] Patching session "${sessionKey}":`, normalizedPatch);
        return this._request('sessions.patch', {
            key: sessionKey,
            ...normalizedPatch
        }).then(result => {
            gwLog(`[Gateway] Session patched:`, result);
            return result;
        });
    }

    disconnect() {
        this.desiredConnection = null;
        this.connected = false;
        this._isConnecting = false;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.socket) {
            this.socket.close(1000, 'User disconnect');
            this.socket = null;
        }
    }

    // Get current config from gateway (source of truth for models)
    async getConfig() {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }
        return this._request('config.get', {});
    }

    // Patch gateway config and trigger restart (e.g., for model change)
    async patchConfig(configPatch) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        gwLog('[Gateway] Patching config...', configPatch);

        // First get current config to get the baseHash
        let baseHash;
        try {
            const current = await this._request('config.get', {});
            baseHash = current?.hash;
            gwLog('[Gateway] Current config hash:', baseHash);
        } catch (err) {
            gwWarn('[Gateway] Could not get current config hash:', err.message);
        }

        // Apply the patch - this will merge with existing config and restart
        const params = {
            raw: typeof configPatch === 'string' ? configPatch : JSON.stringify(configPatch),
            baseHash: baseHash,
            restartDelayMs: 1000  // Give time for response before restart
        };

        return this._request('config.patch', params).then(result => {
            gwLog('[Gateway] Config patch applied, gateway will restart');
            return result;
        });
    }

    // Request gateway restart directly
    async restartGateway(reason = 'dashboard request') {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        gwLog('[Gateway] Requesting restart...');

        // Try the restart RPC call
        return this._request('gateway.restart', { reason, delayMs: 500 }).catch(err => {
            // If gateway.restart doesn't exist, try via config.patch with empty patch
            // which still triggers a restart
            gwLog('[Gateway] gateway.restart not available, trying config refresh...');
            return this._request('config.patch', { raw: '{}', restartDelayMs: 500 });
        });
    }

    _scheduleReconnect() {
        if (!this.desiredConnection) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.onError('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(8000, 350 * Math.pow(1.7, this.reconnectAttempts));
        gwLog(`[Gateway] Reconnecting in ${Math.round(delay)}ms`);

        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._doConnect();
        }, delay);
    }

    isConnected() {
        return this.connected;
    }

    // Inject a message into the transcript without running the agent
    injectChat(sessionKey, message, label = null) {
        const params = { sessionKey, message };
        if (label) params.label = label;
        return this._request('chat.inject', params);
    }
}

window.GatewayClient = GatewayClient;
