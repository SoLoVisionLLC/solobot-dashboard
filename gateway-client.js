// Gateway WebSocket Client
// Mirrors the SoLoBot Android app approach for shared session chat

const GATEWAY_PROTOCOL_VERSION = 3;

class GatewayClient {
    constructor(options = {}) {
        this.socket = null;
        this.connected = false;
        this.sessionKey = options.sessionKey || 'main';
        this.pending = new Map(); // id -> { resolve, reject }
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.desiredConnection = null;

        // Callbacks
        this.onConnected = options.onConnected || (() => {});
        this.onDisconnected = options.onDisconnected || (() => {});
        this.onChatEvent = options.onChatEvent || (() => {});
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

        // Use wss:// if page is HTTPS, port is 443, or host explicitly includes wss/https
        const pageIsSecure = window.location.protocol === 'https:';
        const protocol = pageIsSecure || port === 443 || host.includes('wss') || host.includes('https') ? 'wss' : 'ws';
        const url = `${protocol}://${cleanHost}:${port}`;

        console.log(`[Gateway] Connecting to ${url}...`);

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
            console.log('[Gateway] WebSocket opened, sending connect...');
            this._sendConnect(token, password);
        };

        this.socket.onmessage = (event) => {
            this._handleMessage(event.data);
        };

        this.socket.onerror = (err) => {
            console.error('[Gateway] WebSocket error:', err);
            this.onError('WebSocket error');
        };

        this.socket.onclose = (event) => {
            console.log(`[Gateway] WebSocket closed: ${event.code} ${event.reason}`);
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
            scopes: ['operator.read', 'operator.write'],
            caps: ['chat.subscribe']
        };

        // Add auth
        if (token) {
            params.auth = { token };
        } else if (password) {
            params.auth = { password };
        }

        this._request('connect', params).then(result => {
            console.log('[Gateway] Connected:', result);
            this.connected = true;
            this.reconnectAttempts = 0;

            // Extract session info
            const serverName = result?.server?.host || 'moltbot';
            const sessionKey = result?.snapshot?.sessionDefaults?.mainSessionKey || this.sessionKey;
            this.sessionKey = sessionKey;

            this.onConnected(serverName, sessionKey);

            // Subscribe to chat events for this session
            this._subscribeToSession(sessionKey);

        }).catch(err => {
            console.error('[Gateway] Connect failed:', err);
            this.onError(`Auth failed: ${err.message}`);
            this.socket?.close();
        });
    }

    _subscribeToSession(sessionKey) {
        // Try to subscribe to chat events for this session
        // The Gateway may send events automatically, but we try subscribing just in case
        this._request('chat.subscribe', { sessionKey }).catch(err => {
            // If subscribe fails, events may still come through automatically
            console.log('[Gateway] chat.subscribe:', err.message, '(events may still work)');
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
            console.error('[Gateway] Failed to parse message:', err);
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
        }
    }

    _handleChatEvent(payload) {
        if (!payload) return;

        // Filter by session key
        const eventSessionKey = payload.sessionKey || 'main';
        if (eventSessionKey !== this.sessionKey && eventSessionKey !== 'main') {
            console.log(`[Gateway] Ignoring chat for session ${eventSessionKey} (current: ${this.sessionKey})`);
            return;
        }

        const state = payload.state;
        const message = payload.message;

        // Extract text content
        let contentText = '';
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
            sessionKey: eventSessionKey,
            errorMessage: payload.errorMessage
        });
    }

    sendMessage(text) {
        if (!this.connected) {
            console.warn('[Gateway] Not connected, cannot send message');
            return Promise.reject(new Error('Not connected'));
        }

        const params = {
            message: text,
            sessionKey: this.sessionKey,
            idempotencyKey: crypto.randomUUID()
        };

        return this._request('chat.send', params).then(result => {
            console.log('[Gateway] chat.send result:', result);
            return result;
        });
    }

    loadHistory() {
        if (!this.connected) {
            return Promise.reject(new Error('Not connected'));
        }

        return this._request('chat.history', {
            sessionKey: this.sessionKey,
            limit: 50
        }).catch(err => {
            console.warn('[Gateway] chat.history failed:', err.message);
            return { messages: [] };
        });
    }

    setSessionKey(key) {
        this.sessionKey = key;
        if (this.connected) {
            this._subscribeToSession(key);
        }
    }

    disconnect() {
        this.desiredConnection = null;
        this.connected = false;
        if (this.socket) {
            this.socket.close(1000, 'User disconnect');
            this.socket = null;
        }
    }

    _scheduleReconnect() {
        if (!this.desiredConnection) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[Gateway] Max reconnect attempts reached');
            this.onError('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(8000, 350 * Math.pow(1.7, this.reconnectAttempts));
        console.log(`[Gateway] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => this._doConnect(), delay);
    }

    isConnected() {
        return this.connected;
    }
}

// Export for use in dashboard.js
window.GatewayClient = GatewayClient;
