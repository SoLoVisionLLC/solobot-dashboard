// Gateway WebSocket Client v3
// Connects to OpenClaw Gateway for shared session chat

const GATEWAY_PROTOCOL_VERSION = 3;

class GatewayClient {
    constructor(options = {}) {
        this.socket = null;
        this.connected = false;
        this.sessionKey = options.sessionKey || 'main';
        this.pending = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.desiredConnection = null;

        // Callbacks
        this.onConnected = options.onConnected || (() => {});
        this.onDisconnected = options.onDisconnected || (() => {});
        this.onChatEvent = options.onChatEvent || (() => {});
        this.onToolEvent = options.onToolEvent || (() => {});
        this.onError = options.onError || (() => {});
    }

    connect(host, port, token, password = null) {
        this.desiredConnection = { host, port, token, password };
        this._doConnect();
    }

    _doConnect() {
        if (!this.desiredConnection) return;

        const { host, port, token, password } = this.desiredConnection;
        const cleanHost = host.replace(/^(wss?|https?):\/\//, '');
        const pageIsSecure = window.location.protocol === 'https:';
        const protocol = pageIsSecure || port === 443 || host.includes('wss') || host.includes('https') ? 'wss' : 'ws';
        const url = `${protocol}://${cleanHost}:${port}`;

        console.log(`[Gateway] Connecting to ${url}`);

        try {
            this.socket = new WebSocket(url);
            this._setupListeners(token, password);
        } catch (err) {
            console.error('[Gateway] Connection failed:', err);
            this.onError(`Connection failed: ${err.message}`);
            this._scheduleReconnect();
        }
    }

    _setupListeners(token, password) {
        this.socket.onopen = () => {
            this._sendConnect(token, password);
        };

        this.socket.onmessage = (event) => {
            this._handleMessage(event.data);
        };

        this.socket.onerror = (err) => {
            console.error('[Gateway] WebSocket error');
            this.onError('WebSocket error');
        };

        this.socket.onclose = (event) => {
            console.log(`[Gateway] Disconnected: ${event.code}`);
            this.connected = false;
            this.onDisconnected(event.reason || 'Connection closed');

            if (this.desiredConnection) {
                this._scheduleReconnect();
            }
        };
    }

    _sendConnect(token, password) {
        const clientInfo = {
            id: 'gateway-client',
            displayName: 'SoLoBot Dashboard',
            version: '3.1.0',
            platform: 'web',
            mode: 'ui'
        };

        const params = {
            minProtocol: GATEWAY_PROTOCOL_VERSION,
            maxProtocol: GATEWAY_PROTOCOL_VERSION,
            client: clientInfo,
            role: 'operator',
            scopes: ['operator.read', 'operator.write', 'operator.admin'],
            caps: ['chat.subscribe']
        };

        if (token) {
            params.auth = { token };
        } else if (password) {
            params.auth = { password };
        }

        this._request('connect', params).then(result => {
            this.connected = true;
            this.reconnectAttempts = 0;

            const serverName = result?.server?.host || 'moltbot';
            console.log(`[Gateway] Connected to ${serverName}, session: ${this.sessionKey}`);
            
            // Check if provider/model info is available
            if (result?.provider || result?.model) {
                console.log(`[Gateway] Server provider: ${result.provider || 'unknown'}, model: ${result.model || 'unknown'}`);
                // Store in localStorage so dashboard can display it
                if (result.provider) localStorage.setItem('server_provider', result.provider);
                if (result.model) localStorage.setItem('server_model', result.model);
            }

            this.onConnected(serverName, this.sessionKey);
            this._subscribeToSession(this.sessionKey);

        }).catch(err => {
            console.error('[Gateway] Auth failed:', err.message);
            this.onError(`Auth failed: ${err.message}`);
            this.socket?.close();
        });
    }

    _subscribeToSession(sessionKey) {
        this._request('node.event', {
            event: 'chat.subscribe',
            payload: { sessionKey }
        }).catch(() => {
            // Subscription may fail but chat events still work
        });
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
            this._handleChatEvent(payload);
        } else if (event === 'agent') {
            this._handleAgentEvent(payload);
        }
    }

    _handleAgentEvent(payload) {
        if (!payload) return;
        
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

        // Filter by session key (case-insensitive - gateway returns lowercase)
        const eventSessionKey = payload.sessionKey || 'main';
        if (eventSessionKey.toLowerCase() !== this.sessionKey.toLowerCase()) {
            return;
        }

        const state = payload.state;
        const message = payload.message;

        // Extract text content and role
        let contentText = '';
        let role = message?.role || 'assistant';

        if (message?.content) {
            for (const part of message.content) {
                if (part.type === 'text') {
                    contentText += part.text || '';
                }
            }
        }

        this.onChatEvent({
            state,
            content: contentText,
            role,
            sessionKey: eventSessionKey,
            errorMessage: payload.errorMessage
        });
    }

    sendMessage(text) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        const params = {
            message: text,
            sessionKey: this.sessionKey,
            idempotencyKey: crypto.randomUUID()
        };

        // Log model and session info
        const model = localStorage.getItem('selected_model') || 'anthropic/claude-3-opus';
        console.log(`[Gateway] Sending message to session "${this.sessionKey}" with ${model}`);

        return this._request('chat.send', params);
    }

    sendMessageWithImage(text, imageDataUrl) {
        return this.sendMessageWithImages(text, [imageDataUrl]);
    }

    sendMessageWithImages(text, imageDataUrls) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        // Build attachments array from all images
        const attachments = [];
        for (const imageDataUrl of imageDataUrls) {
            const matches = imageDataUrl.match(/^data:(.+);base64,(.+)$/);
            if (!matches) {
                console.warn('[Gateway] Skipping invalid image data URL');
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
            sessionKey: this.sessionKey,
            idempotencyKey: crypto.randomUUID(),
            attachments: attachments
        };

        console.log('[Gateway] Sending', attachments.length, 'image(s), total size:', 
            Math.round(attachments.reduce((sum, a) => sum + a.content.length, 0) / 1024), 'KB');

        // Log model info if available
        const model = localStorage.getItem('selected_model') || 'anthropic/claude-3-opus';
        console.log(`[Gateway] Sending with ${model}`);

        return this._request('chat.send', params);
    }

    loadHistory() {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        console.log(`[Gateway] Loading history for session: ${this.sessionKey}`);
        return this._request('chat.history', {
            sessionKey: this.sessionKey,
            limit: 50
        }).then(result => {
            console.log(`[Gateway] History returned ${result?.messages?.length || 0} messages`);
            return result;
        }).catch(() => ({ messages: [] }));
    }

    setSessionKey(key) {
        console.log(`[Gateway] Switching session from "${this.sessionKey}" to "${key}"`);
        this.sessionKey = key;
        if (this.connected) {
            this._subscribeToSession(key);
        }
    }

    listSessions(opts = {}) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        console.log('[Gateway] Listing sessions...');
        return this._request('sessions.list', {
            includeDerivedTitles: true,
            ...opts
        }).then(result => {
            console.log(`[Gateway] Sessions list returned ${result?.sessions?.length || 0} sessions`);
            return result;
        });
    }

    disconnect() {
        this.desiredConnection = null;
        this.connected = false;
        if (this.socket) {
            this.socket.close(1000, 'User disconnect');
            this.socket = null;
        }
    }

    // Patch gateway config and trigger restart (e.g., for model change)
    async patchConfig(configPatch) {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        console.log('[Gateway] Patching config...', configPatch);

        // First get current config to get the baseHash
        let baseHash;
        try {
            const current = await this._request('config.get', {});
            baseHash = current?.hash;
            console.log('[Gateway] Current config hash:', baseHash);
        } catch (err) {
            console.warn('[Gateway] Could not get current config hash:', err.message);
        }

        // Apply the patch - this will merge with existing config and restart
        const params = {
            raw: typeof configPatch === 'string' ? configPatch : JSON.stringify(configPatch),
            baseHash: baseHash,
            restartDelayMs: 1000  // Give time for response before restart
        };

        return this._request('config.patch', params).then(result => {
            console.log('[Gateway] Config patch applied, gateway will restart');
            return result;
        });
    }

    // Request gateway restart directly
    async restartGateway(reason = 'dashboard request') {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        console.log('[Gateway] Requesting restart...');

        // Try the restart RPC call
        return this._request('gateway.restart', { reason, delayMs: 500 }).catch(err => {
            // If gateway.restart doesn't exist, try via config.patch with empty patch
            // which still triggers a restart
            console.log('[Gateway] gateway.restart not available, trying config refresh...');
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
        console.log(`[Gateway] Reconnecting in ${Math.round(delay)}ms`);

        setTimeout(() => this._doConnect(), delay);
    }

    isConnected() {
        return this.connected;
    }
}

window.GatewayClient = GatewayClient;
