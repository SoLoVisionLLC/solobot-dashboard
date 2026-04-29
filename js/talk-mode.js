// js/talk-mode.js — Natural realtime Talk Mode for OpenClaw Gateway
// Uses Gateway talk.realtime.session transports; never exposes provider API keys.

(function () {
    'use strict';

    const TALK_STATES = {
        idle: 'Idle',
        connecting: 'Connecting',
        listening: 'Listening',
        thinking: 'Thinking / Asking OpenClaw',
        speaking: 'Speaking',
        error: 'Error'
    };
    const CONSULT_TOOL = 'openclaw_agent_consult';
    const TALK_DEBUG = false;
    const talkLog = (...args) => { if (TALK_DEBUG) console.log('[Talk]', ...args); };

    let talkState = 'idle';
    let talkError = '';
    let talkProviderLabel = 'Provider unknown';
    let talkSession = null;
    let talkAdapter = null;
    let talkTranscript = [];
    let talkStarting = false;

    function getGateway() {
        try {
            if (typeof gateway !== 'undefined' && gateway) return gateway;
        } catch { }
        return window.gateway || null;
    }

    function getSessionKey() {
        try {
            const key = window.currentSessionName || (typeof currentSessionName !== 'undefined' ? currentSessionName : '') || window.GATEWAY_CONFIG?.sessionKey || (typeof GATEWAY_CONFIG !== 'undefined' ? GATEWAY_CONFIG.sessionKey : '') || 'agent:main:main';
            return typeof normalizeSessionKey === 'function' ? normalizeSessionKey(key) : key;
        } catch {
            return 'agent:main:main';
        }
    }

    function getAudioContextCtor() {
        return window.AudioContext || window.webkitAudioContext;
    }

    function b64FromBytes(bytes) {
        let out = '';
        const chunk = 32768;
        for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
        return btoa(out);
    }

    function bytesFromB64(value) {
        const raw = atob(String(value || ''));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return bytes;
    }

    function floatToPcm16(float32) {
        const out = new Uint8Array(float32.length * 2);
        const view = new DataView(out.buffer);
        for (let i = 0; i < float32.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32[i] || 0));
            view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        return out;
    }

    function pcm16ToFloat(bytes) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = new Float32Array(Math.floor(bytes.byteLength / 2));
        for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
        return out;
    }

    function safeJson(value, fallback = {}) {
        if (!value) return fallback;
        if (typeof value === 'object') return value;
        try { return JSON.parse(String(value)); } catch { return fallback; }
    }

    function showToastSafe(message, type = 'info') {
        if (typeof showToast === 'function') showToast(message, type);
        else console.log(`[Talk] ${message}`);
    }

    function setTalkState(next, message = '') {
        talkState = next;
        talkError = next === 'error' ? String(message || 'Talk failed') : '';
        renderTalkMode();
        if (message && next === 'error') showToastSafe(message, 'error');
    }

    function upsertTranscript(role, text, final = false) {
        const clean = String(text || '').trim();
        if (!clean) return;
        const last = talkTranscript[talkTranscript.length - 1];
        if (last && last.role === role && !last.final) {
            last.text = clean;
            last.final = Boolean(final);
            last.time = Date.now();
        } else {
            talkTranscript.push({ role, text: clean, final: Boolean(final), time: Date.now() });
        }
        talkTranscript = talkTranscript.slice(-20);
        renderTalkMode();
    }

    function getSessionTransport(session) {
        const candidates = [session?.transport, session?.type, session?.kind, session?.provider, session?.protocol, session?.mode].filter(Boolean).map(v => String(v).toLowerCase());
        if (session?.relaySessionId || candidates.some(v => v.includes('relay') || v === 'gateway-relay')) return 'relay';
        if (session?.websocketUrl || candidates.some(v => v.includes('google') || v.includes('websocket') || v.includes('bidi') || v === 'json-pcm-websocket')) return 'google-live';
        if (session?.offerUrl || session?.sdpUrl || session?.url || session?.clientSecret || session?.ephemeralKey || candidates.some(v => v.includes('webrtc') || v.includes('openai') || v === 'webrtc-sdp')) return 'openai-webrtc';
        return 'unknown';
    }

    function describeProvider(session) {
        const transport = getSessionTransport(session);
        const provider = session?.provider || session?.providerName || session?.realtimeProvider || session?.model || transport;
        const timeout = session?.silenceTimeoutMs || session?.config?.silenceTimeoutMs;
        const interrupt = session?.interruptOnSpeech ?? session?.config?.interruptOnSpeech;
        const bits = [String(provider || 'Talk')];
        if (transport !== 'unknown') bits.push(transport);
        if (timeout) bits.push(`${timeout}ms silence`);
        if (interrupt !== undefined) bits.push(interrupt ? 'interrupt on speech' : 'no interrupt');
        return bits.join(' · ');
    }

    function renderTalkMode() {
        const root = document.getElementById('talk-mode-panel');
        const btn = document.getElementById('talk-mode-btn');
        const status = document.getElementById('talk-mode-status');
        const statusText = document.getElementById('talk-mode-status-text');
        const transcriptEl = document.getElementById('talk-mode-transcript');
        const providerEl = document.getElementById('talk-mode-provider');
        if (btn) {
            const active = talkState !== 'idle' && talkState !== 'error';
            btn.classList.toggle('active', active);
            btn.classList.toggle('connecting', talkState === 'connecting');
            btn.classList.toggle('error', talkState === 'error');
            btn.title = active ? 'Stop Talk Mode' : 'Start natural Talk Mode';
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            const label = btn.querySelector('.talk-mode-btn-label');
            if (label) label.textContent = active ? 'Stop Talk' : 'Talk';
        }
        if (root) root.classList.toggle('hidden', talkState === 'idle' && talkTranscript.length === 0);
        if (status) status.className = `talk-mode-dot ${talkState}`;
        if (statusText) statusText.textContent = talkError || TALK_STATES[talkState] || talkState;
        if (providerEl) providerEl.textContent = talkProviderLabel;
        if (transcriptEl) {
            transcriptEl.innerHTML = '';
            if (talkTranscript.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'talk-mode-empty';
                empty.textContent = 'Live voice transcript will appear here.';
                transcriptEl.appendChild(empty);
            } else {
                for (const item of talkTranscript.slice(-8)) {
                    const row = document.createElement('div');
                    row.className = `talk-mode-line ${item.role || 'assistant'} ${item.final ? 'final' : 'interim'}`;
                    const speaker = document.createElement('span');
                    speaker.className = 'talk-mode-speaker';
                    speaker.textContent = item.role === 'user' ? 'You' : 'SoLoBot';
                    const text = document.createElement('span');
                    text.className = 'talk-mode-text';
                    text.textContent = item.text;
                    row.append(speaker, text);
                    transcriptEl.appendChild(row);
                }
                transcriptEl.scrollTop = transcriptEl.scrollHeight;
            }
        }
    }

    async function consultOpenClaw(ctx, callId, args, submit) {
        setTalkState('thinking');
        const parsed = safeJson(args, args || {});
        const question = String(parsed.question || parsed.prompt || parsed.query || '').trim();
        if (!question) {
            submit(callId, { error: `${CONSULT_TOOL} requires a question` });
            setTalkState('listening');
            return;
        }
        const parts = [question];
        const style = parsed.style || parsed.responseStyle || parsed.response_style;
        if (parsed.context) parts.push(`Context:\n${parsed.context}`);
        if (style) parts.push(`Spoken style:\n${style}`);
        try {
            const gw = getGateway();
            const run = await gw.request('chat.send', {
                sessionKey: getSessionKey(),
                message: parts.join('\n\n'),
                idempotencyKey: crypto.randomUUID()
            }, 20000);
            const result = await waitForChatFinal(gw, run?.runId, 120000);
            submit(callId, { result: result || 'OpenClaw finished with no text.' });
        } catch (err) {
            submit(callId, { error: err?.message || String(err) });
        } finally {
            setTalkState('listening');
        }
    }

    function waitForChatFinal(gw, runId, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (!runId) return resolve('OpenClaw accepted the request.');
            const timer = setTimeout(() => cleanup(reject, new Error('OpenClaw tool call timed out')), timeoutMs);
            const off = gw.addEventListener?.((evt) => {
                if (evt.event !== 'chat') return;
                const payload = evt.payload || {};
                const message = payload.message || {};
                if ((message.runId || payload.runId) !== runId) return;
                if (payload.state === 'final') cleanup(resolve, extractText(message, payload) || 'OpenClaw finished with no text.');
                if (payload.state === 'error') cleanup(reject, new Error(message.errorMessage || payload.errorMessage || 'OpenClaw tool call failed'));
            });
            function cleanup(fn, value) {
                clearTimeout(timer);
                try { off?.(); } catch { }
                fn(value);
            }
        });
    }

    function extractText(message, payload) {
        if (typeof _extractMessageContent === 'function') return _extractMessageContent(message, payload).text;
        return [message?.text, message?.content, payload?.text, payload?.content].filter(v => typeof v === 'string').join('\n').trim();
    }

    class RelayAdapter {
        constructor(session) { this.session = session; this.media = null; this.inputContext = null; this.outputContext = null; this.inputSource = null; this.inputProcessor = null; this.unsubscribe = null; this.sources = new Set(); this.playhead = 0; this.closed = true; }
        async start() {
            const AudioCtor = getAudioContextCtor();
            if (!navigator.mediaDevices?.getUserMedia || !AudioCtor) throw new Error('Realtime Talk requires browser microphone and Web Audio support');
            this.closed = false;
            this.unsubscribe = getGateway().addEventListener(evt => evt.event?.startsWith?.('talk.realtime.relay') && this.handleEvent(evt.payload || {}));
            this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.inputContext = new AudioCtor({ sampleRate: this.session.audio?.inputSampleRateHz || 16000 });
            this.outputContext = new AudioCtor({ sampleRate: this.session.audio?.outputSampleRateHz || 24000 });
            this.inputSource = this.inputContext.createMediaStreamSource(this.media);
            this.inputProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
            this.inputProcessor.onaudioprocess = (e) => {
                if (this.closed) return;
                getGateway().request('talk.realtime.relayAudio', {
                    relaySessionId: this.session.relaySessionId,
                    audioBase64: b64FromBytes(floatToPcm16(e.inputBuffer.getChannelData(0))),
                    timestamp: Math.round((this.inputContext.currentTime || 0) * 1000)
                }, 10000).catch(() => { });
            };
            this.inputSource.connect(this.inputProcessor);
            this.inputProcessor.connect(this.inputContext.destination);
            setTalkState('listening');
        }
        stop() {
            this.closed = true;
            try { this.unsubscribe?.(); } catch { }
            this.inputProcessor?.disconnect(); this.inputSource?.disconnect();
            this.media?.getTracks().forEach(t => t.stop());
            this.stopOutput();
            this.inputContext?.close(); this.outputContext?.close();
            getGateway()?.request?.('talk.realtime.relayStop', { relaySessionId: this.session.relaySessionId }, 5000).catch(() => { });
        }
        handleEvent(e) {
            if (e.relaySessionId && e.relaySessionId !== this.session.relaySessionId) return;
            if (e.type === 'ready') setTalkState('listening');
            else if (e.type === 'audio' && e.audioBase64) { setTalkState('speaking'); this.playPcm16(e.audioBase64); }
            else if (e.type === 'clear') this.stopOutput();
            else if (e.type === 'mark') this.ackMarkLater();
            else if (e.type === 'transcript') upsertTranscript(e.role, e.text, e.final !== false);
            else if (e.type === 'toolCall') this.handleToolCall(e);
            else if (e.type === 'error') setTalkState('error', e.message || 'Realtime relay failed');
            else if (e.type === 'close') setTalkState(e.reason === 'error' ? 'error' : 'idle', e.reason === 'error' ? 'Realtime relay closed' : '');
        }
        playPcm16(audioBase64) {
            if (!this.outputContext) return;
            const floats = pcm16ToFloat(bytesFromB64(audioBase64));
            const buffer = this.outputContext.createBuffer(1, floats.length, this.session.audio?.outputSampleRateHz || this.outputContext.sampleRate);
            buffer.getChannelData(0).set(floats);
            const source = this.outputContext.createBufferSource();
            this.sources.add(source);
            source.onended = () => { this.sources.delete(source); if (!this.sources.size && talkState === 'speaking') setTalkState('listening'); };
            source.buffer = buffer;
            source.connect(this.outputContext.destination);
            const startAt = Math.max(this.outputContext.currentTime, this.playhead);
            source.start(startAt);
            this.playhead = startAt + buffer.duration;
        }
        stopOutput() { for (const s of this.sources) { try { s.stop(); } catch { } } this.sources.clear(); this.playhead = this.outputContext?.currentTime || 0; }
        ackMarkLater() { setTimeout(() => getGateway()?.request?.('talk.realtime.relayMark', { relaySessionId: this.session.relaySessionId }, 5000).catch(() => { }), 0); }
        async handleToolCall(e) {
            const name = String(e.name || '').trim(); const callId = String(e.callId || e.id || '').trim();
            if (!callId) return;
            if (name !== CONSULT_TOOL) return this.submitToolResult(callId, { error: `Tool "${name}" not available in browser Talk` });
            await consultOpenClaw({}, callId, e.args || {}, (id, result) => this.submitToolResult(id, result));
        }
        submitToolResult(callId, result) { getGateway()?.request?.('talk.realtime.relayToolResult', { relaySessionId: this.session.relaySessionId, callId, result }, 15000).catch(() => { }); }
    }

    class GoogleLiveAdapter {
        constructor(session) { this.session = session; this.ws = null; this.media = null; this.inputContext = null; this.outputContext = null; this.inputSource = null; this.inputProcessor = null; this.playhead = 0; this.sources = new Set(); this.pendingCalls = new Map(); this.closed = true; }
        async start() {
            const AudioCtor = getAudioContextCtor();
            if (!navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined' || !AudioCtor) throw new Error('Realtime Talk requires browser WebSocket, microphone, and Web Audio support');
            this.closed = false;
            this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.inputContext = new AudioCtor({ sampleRate: this.session.audio?.inputSampleRateHz || 16000 });
            this.outputContext = new AudioCtor({ sampleRate: this.session.audio?.outputSampleRateHz || 24000 });
            this.ws = new WebSocket(this.buildUrl());
            this.ws.onopen = () => { this.send(this.session.initialMessage || { setup: {} }); this.startPump(); };
            this.ws.onmessage = (event) => this.handleMessage(event.data);
            this.ws.onerror = () => !this.closed && setTalkState('error', 'Realtime connection failed');
            this.ws.onclose = () => !this.closed && setTalkState('error', 'Realtime connection closed');
        }
        buildUrl() {
            const url = new URL(this.session.websocketUrl);
            if (url.protocol !== 'wss:') throw new Error('Google Live WebSocket URL must be secure');
            if (url.hostname.toLowerCase() !== 'generativelanguage.googleapis.com') throw new Error('Untrusted Google Live WebSocket host');
            if (!/^\/ws\/google\.ai\.generativelanguage\.v[0-9a-z]+\.GenerativeService\.BidiGenerateContent(?:Constrained)?$/.test(url.pathname)) {
                throw new Error('Untrusted Google Live WebSocket path');
            }
            if (url.username || url.password) throw new Error('Google Live WebSocket URL must not include credentials');
            url.search = '';
            const token = this.session.clientSecret || this.session.token || this.session.accessToken;
            if (token) url.searchParams.set('access_token', token);
            return url.toString();
        }
        startPump() {
            this.inputSource = this.inputContext.createMediaStreamSource(this.media);
            this.inputProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
            this.inputProcessor.onaudioprocess = (e) => {
                if (this.ws?.readyState !== WebSocket.OPEN) return;
                this.send({ realtimeInput: { audio: { data: b64FromBytes(floatToPcm16(e.inputBuffer.getChannelData(0))), mimeType: `audio/pcm;rate=${this.inputContext.sampleRate}` } } });
            };
            this.inputSource.connect(this.inputProcessor);
            this.inputProcessor.connect(this.inputContext.destination);
        }
        send(obj) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }
        handleMessage(raw) {
            const msg = safeJson(raw, null); if (!msg) return;
            if (msg.setupComplete) setTalkState('listening');
            const sc = msg.serverContent || {};
            if (sc.interrupted) this.stopOutput();
            if (sc.inputTranscription?.text) upsertTranscript('user', sc.inputTranscription.text, sc.inputTranscription.finished !== false);
            if (sc.outputTranscription?.text) { setTalkState('speaking'); upsertTranscript('assistant', sc.outputTranscription.text, sc.outputTranscription.finished !== false); }
            for (const part of sc.modelTurn?.parts || []) {
                if (part.inlineData?.data) { setTalkState('speaking'); this.playPcm16(part.inlineData.data); }
                if (!part.thought && typeof part.text === 'string' && part.text.trim()) upsertTranscript('assistant', part.text, !!sc.turnComplete);
            }
            for (const call of msg.toolCall?.functionCalls || []) this.handleToolCall(call);
        }
        playPcm16(audioBase64) {
            if (!this.outputContext) return;
            const floats = pcm16ToFloat(bytesFromB64(audioBase64));
            const buffer = this.outputContext.createBuffer(1, floats.length, this.session.audio?.outputSampleRateHz || this.outputContext.sampleRate);
            buffer.getChannelData(0).set(floats);
            const source = this.outputContext.createBufferSource(); source.buffer = buffer; source.connect(this.outputContext.destination);
            this.sources.add(source);
            const startAt = Math.max(this.outputContext.currentTime, this.playhead); source.start(startAt); this.playhead = startAt + buffer.duration;
            source.onended = () => { this.sources.delete(source); if (!this.sources.size && talkState === 'speaking') setTalkState('listening'); };
        }
        async handleToolCall(call) {
            const name = call.name; const id = call.id || call.callId;
            if (!id || !name) return;
            this.pendingCalls.set(id, { name, args: call.args || {} });
            if (name === CONSULT_TOOL) await consultOpenClaw({}, id, call.args || {}, (callId, result) => this.submitToolResult(callId, result));
        }
        submitToolResult(id, result) {
            const pending = this.pendingCalls.get(id); if (!pending) return;
            this.pendingCalls.delete(id);
            this.send({ toolResponse: { functionResponses: [{ id, name: pending.name, scheduling: 'WHEN_IDLE', response: result && typeof result === 'object' ? result : { output: result } }] } });
        }
        stopOutput() { for (const s of this.sources) { try { s.stop(); } catch { } } this.sources.clear(); this.playhead = this.outputContext?.currentTime || 0; }
        stop() { this.closed = true; this.inputProcessor?.disconnect(); this.inputSource?.disconnect(); this.media?.getTracks().forEach(t => t.stop()); this.stopOutput(); this.inputContext?.close(); this.outputContext?.close(); this.ws?.close(); }
    }

    class OpenAIWebRTCAdapter {
        constructor(session) { this.session = session; this.peer = null; this.channel = null; this.media = null; this.audio = null; this.closed = true; this.toolBuffers = new Map(); this.handledToolCalls = new Set(); }
        async start() {
            if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('Realtime Talk requires browser WebRTC and microphone access');
            this.closed = false;
            this.peer = new RTCPeerConnection();
            this.audio = document.createElement('audio'); this.audio.autoplay = true; this.audio.style.display = 'none'; document.body.appendChild(this.audio);
            this.peer.ontrack = (event) => { if (this.audio) this.audio.srcObject = event.streams[0]; setTalkState('speaking'); };
            this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
            for (const track of this.media.getAudioTracks()) this.peer.addTrack(track, this.media);
            this.channel = this.peer.createDataChannel('oai-events');
            this.channel.onopen = () => setTalkState('listening');
            this.channel.onmessage = (event) => this.handleEvent(safeJson(event.data, {}));
            this.channel.onerror = () => !this.closed && setTalkState('error', 'Realtime data channel failed');
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            const answerSdp = await this.exchangeSdp(offer.sdp || '');
            await this.peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        }
        getClientSecret() { return this.session.clientSecret?.value || this.session.clientSecret || this.session.ephemeralKey || this.session.token || this.session.secret; }
        getSdpUrl() { return this.session.offerUrl || this.session.sdpUrl || this.session.url || this.session.endpoint || 'https://api.openai.com/v1/realtime/calls'; }
        async exchangeSdp(sdp) {
            const url = this.getSdpUrl();
            const model = this.session.model || this.session.modelId;
            const finalUrl = model && !String(url).includes('model=') ? `${url}${String(url).includes('?') ? '&' : '?'}model=${encodeURIComponent(model)}` : url;
            const headers = { ...(this.session.headers || {}), 'Content-Type': 'application/sdp' };
            const clientSecret = this.getClientSecret();
            if (clientSecret) headers.Authorization = `Bearer ${clientSecret}`;
            const res = await fetch(finalUrl, { method: 'POST', headers, body: sdp });
            if (!res.ok) throw new Error(`OpenAI realtime SDP failed: ${res.status}`);
            return res.text();
        }
        send(obj) { if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(obj)); }
        handleEvent(e) {
            const type = e.type || '';
            if (type.includes('speech_started')) { setTalkState('listening'); this.send({ type: 'response.cancel' }); }
            if (type === 'conversation.item.input_audio_transcription.completed') upsertTranscript('user', e.transcript, true);
            if (type === 'response.audio_transcript.delta') { setTalkState('speaking'); upsertTranscript('assistant', e.delta, false); }
            if (type === 'response.audio_transcript.done') upsertTranscript('assistant', e.transcript, true);
            if (type === 'response.function_call_arguments.delta') {
                const key = e.item_id || e.call_id;
                if (!key) return;
                const cur = this.toolBuffers.get(key) || { name: e.name || '', callId: e.call_id || '', arguments: '' };
                cur.arguments += e.delta || '';
                if (e.name) cur.name = e.name;
                if (e.call_id) cur.callId = e.call_id;
                this.toolBuffers.set(key, cur);
            }
            if (type === 'response.function_call_arguments.done') {
                const key = e.item_id || e.call_id;
                const cur = this.toolBuffers.get(key) || {};
                if (key) this.toolBuffers.delete(key);
                this.handleToolCall({ call_id: e.call_id || cur.callId, name: e.name || cur.name, arguments: e.arguments || cur.arguments || '{}' });
            }
            if (type === 'response.output_item.done' && e.item?.type === 'function_call') this.handleToolCall(e.item);
            if (type === 'error') setTalkState('error', e.error?.message || 'Realtime provider error');
        }
        async handleToolCall(call) {
            const name = call.name; const callId = call.call_id || call.callId || call.id;
            if (!callId || name !== CONSULT_TOOL || this.handledToolCalls.has(callId)) return;
            this.handledToolCalls.add(callId);
            await consultOpenClaw({}, callId, call.arguments || call.args || {}, (id, result) => this.submitToolResult(id, result));
        }
        submitToolResult(callId, result) {
            const output = typeof result === 'string' ? result : JSON.stringify(result || {});
            this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
            this.send({ type: 'response.create' });
        }
        stop() { this.closed = true; this.channel?.close(); this.peer?.close(); this.media?.getTracks().forEach(t => t.stop()); this.audio?.remove(); }
    }

    async function loadTalkStatus() {
        const gw = getGateway();
        if (!gw?.isConnected?.()) return;
        try {
            const cfg = await gw.request('config.get', {}, 8000);
            const talk = cfg?.config?.talk || cfg?.talk || {};
            if (talk?.provider) {
                const bits = [talk.provider];
                if (talk.silenceTimeoutMs) bits.push(`${talk.silenceTimeoutMs}ms silence`);
                if (talk.interruptOnSpeech !== undefined) bits.push(talk.interruptOnSpeech ? 'interrupt on speech' : 'no interrupt');
                talkProviderLabel = bits.join(' · ');
                renderTalkMode();
            }
        } catch { }
    }

    async function startTalkMode() {
        if (talkStarting || talkAdapter) return;
        const gw = getGateway();
        if (!gw?.isConnected?.()) { showToastSafe('Connect to Gateway before starting Talk Mode.', 'warning'); return; }
        const dictationListening = (typeof voiceInputState !== 'undefined' && voiceInputState === 'listening');
        if (dictationListening && typeof stopVoiceInput === 'function') stopVoiceInput();
        talkStarting = true;
        talkTranscript = [];
        setTalkState('connecting');
        try {
            talkSession = await gw.request('talk.realtime.session', { sessionKey: getSessionKey() }, 20000);
            talkProviderLabel = describeProvider(talkSession);
            const transport = getSessionTransport(talkSession);
            if (transport === 'relay') talkAdapter = new RelayAdapter(talkSession);
            else if (transport === 'google-live') talkAdapter = new GoogleLiveAdapter(talkSession);
            else if (transport === 'openai-webrtc') talkAdapter = new OpenAIWebRTCAdapter(talkSession);
            else throw new Error('Gateway returned an unsupported Talk transport');
            await talkAdapter.start();
            showToastSafe(`Talk Mode started (${talkProviderLabel})`, 'success');
        } catch (err) {
            console.error('[Talk] Start failed:', err);
            stopTalkMode(false);
            setTalkState('error', err?.message || 'Talk Mode failed to start');
        } finally {
            talkStarting = false;
            renderTalkMode();
        }
    }

    function stopTalkMode(reset = true) {
        try { talkAdapter?.stop?.(); } catch (err) { console.warn('[Talk] stop failed', err); }
        talkAdapter = null;
        talkSession = null;
        talkStarting = false;
        if (reset) setTalkState('idle');
        else renderTalkMode();
    }

    function toggleTalkMode() {
        if (talkAdapter || talkStarting) stopTalkMode(true);
        else startTalkMode();
    }

    function initTalkMode() {
        renderTalkMode();
        loadTalkStatus();
    }

    window.toggleTalkMode = toggleTalkMode;
    window.startTalkMode = startTalkMode;
    window.stopTalkMode = stopTalkMode;
    window.renderTalkMode = renderTalkMode;
    window.loadTalkStatus = loadTalkStatus;

    document.addEventListener('DOMContentLoaded', () => setTimeout(initTalkMode, 150));
})();
