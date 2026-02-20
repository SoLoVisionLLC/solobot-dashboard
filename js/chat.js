// js/chat.js — Chat event handling, message rendering, voice input, image handling

function linkifyText(text) {
    if (!text) return '';
    const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
    return parts.map((part, i) => {
        if (i % 2 === 1) {
            return part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        let safe = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        safe = safe.replace(/(^|["'>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
        return safe.replace(/\n/g, '<br>');
    }).join('');
}

// ===================
// VOICE INPUT (Web Speech API)
// ===================

let voiceRecognition = null;
let voiceInputState = 'idle';
let voiceAutoSend = localStorage.getItem('voice_auto_send') === 'true';
let lastVoiceTranscript = '';
let accumulatedTranscript = '';

function initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btns = [document.getElementById('voice-input-btn'), document.getElementById('voice-input-btn-chatpage')];
    
    if (!SpeechRecognition) {
        btns.forEach(btn => {
            if (btn) { btn.disabled = true; btn.title = 'Voice input not supported'; btn.innerHTML = '🎤✗'; }
        });
        return;
    }
    
    if (btns.every(b => !b)) return;

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
        setVoiceState('listening');
        const input = document.getElementById(activeVoiceTarget);
        if (input) { input.focus(); input.placeholder = 'Listening...'; if (accumulatedTranscript) input.value = accumulatedTranscript; }
    };
    
    voiceRecognition.onaudiostart = () => { };
    voiceRecognition.onsoundstart = () => { };
    voiceRecognition.onspeechstart = () => {
        const input = document.getElementById(activeVoiceTarget);
        if (input) input.placeholder = 'Hearing you...';
    };

    voiceRecognition.onresult = (event) => {
        chatLog('[Voice] onresult fired, resultIndex:', event.resultIndex, 'results.length:', event.results.length, 'target:', activeVoiceTarget);
        const input = document.getElementById(activeVoiceTarget);
        if (!input) {
            console.error('[Voice] Input not found:', activeVoiceTarget, '- trying fallback');
            // Fallback: try both inputs
            const fallback = document.getElementById('chat-page-input') || document.getElementById('chat-input');
            if (!fallback) {
                console.error('[Voice] No input found at all!');
                return;
            }
            chatLog('[Voice] Using fallback input:', fallback.id);
        }
        const targetInput = input || document.getElementById('chat-page-input') || document.getElementById('chat-input');
        chatLog('[Voice] Updating input element:', targetInput?.id, targetInput?.tagName);

        let interimTranscript = '';
        let finalTranscript = '';

        // Process all results
        for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            const confidence = result[0].confidence;
            chatLog(`[Voice] Result[${i}]: isFinal=${result.isFinal}, confidence=${confidence?.toFixed(2) || 'n/a'}, text="${transcript}"`);
            if (result.isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Append new transcripts to accumulated text
        if (finalTranscript) {
            // Add space before appending if there's already accumulated text
            if (accumulatedTranscript && !accumulatedTranscript.endsWith(' ')) {
                accumulatedTranscript += ' ';
            }
            accumulatedTranscript += finalTranscript;
        }
        
    voiceRecognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript;
            if (result.isFinal) finalTranscript += transcript;
            else interimTranscript += transcript;
        }
        const displayText = accumulatedTranscript + interimTranscript;
        const targetInput = document.getElementById(activeVoiceTarget);
        if (targetInput) {
            targetInput.value = displayText;
            if (interimTranscript) { targetInput.style.fontStyle = 'italic'; targetInput.style.color = 'var(--text-secondary)'; }
            else if (finalTranscript) { targetInput.style.fontStyle = 'normal'; targetInput.style.color = 'var(--text-primary)'; }
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.focus();
            if (targetInput.setSelectionRange) targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length);
        }
        if (finalTranscript) lastVoiceTranscript = finalTranscript;
    };

    voiceRecognition.onerror = (event) => {
        console.error('[Voice] Error:', event.error);
        if (event.error === 'not-allowed') { setVoiceState('idle'); showToast('Microphone access denied.', 'error'); }
        else if (event.error === 'no-speech') { chatLog('[Voice] No speech detected'); }
        else if (event.error === 'audio-capture') { setVoiceState('idle'); showToast('No microphone found.', 'error'); }
        else if (event.error === 'network') { setVoiceState('idle'); showToast('Network error.', 'error'); }
        else if (event.error !== 'aborted') { setVoiceState('idle'); showToast(`Voice error: ${event.error}`, 'error'); }
    };

    voiceRecognition.onend = () => {
        ['chat-input', 'chat-page-input'].forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) { input.style.fontStyle = 'normal'; input.style.color = 'var(--text-primary)'; input.placeholder = inputId === 'chat-input' ? 'Type a message...' : 'Message SoLoBot...'; }
        });
        
        if (voiceAutoSend && accumulatedTranscript.trim()) {
            if (activeVoiceTarget === 'chat-page-input') sendChatPageMessage();
            else sendChatMessage();
            accumulatedTranscript = '';
            const input = document.getElementById(activeVoiceTarget);
            if (input) input.value = '';
        }
        setVoiceState('idle');
        activeVoiceTarget = 'chat-input';
    };

    chatLog('[Voice] Initialized successfully');
}

function toggleVoiceInput() {
    if (!voiceRecognition) {
        showToast('Voice input not available', 'error');
        return;
    }

    if (voiceInputState === 'listening') {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
}

function startVoiceInput() {
    if (!voiceRecognition) return;
    
    try {
        voiceRecognition.start();
        chatLog('[Voice] Starting...');
    } catch (e) {
        console.error('[Voice] Start error:', e);
        // May already be running
        if (e.message.includes('already started')) {
            stopVoiceInput();
        }
    }
}

function stopVoiceInput() {
    if (!voiceRecognition) return;
    
    try {
        voiceRecognition.stop();
        chatLog('[Voice] Stopping...');
    } catch (e) {
        console.error('[Voice] Stop error:', e);
    }
}

function setVoiceState(state, targetInput = 'chat-input') {
    voiceInputState = state;
    
    // Hide live transcript indicator when going idle
    if (state === 'idle') {
        hideLiveTranscriptIndicator();
    }
    
    // Update both buttons to stay in sync
    const btns = [
        { btn: document.getElementById('voice-input-btn'), mic: document.getElementById('voice-icon-mic'), stop: document.getElementById('voice-icon-stop') },
        { btn: document.getElementById('voice-input-btn-chatpage'), mic: document.getElementById('voice-icon-mic-chatpage'), stop: document.getElementById('voice-icon-stop-chatpage') }
    ];
    
    for (const { btn, mic, stop } of btns) {
        if (!btn) continue;
        
        btn.classList.remove('listening', 'processing');
        
        switch (state) {
            case 'listening':
                btn.classList.add('listening');
                btn.title = 'Listening... (click to stop)';
                if (mic) mic.style.display = 'none';
                if (stop) stop.style.display = 'block';
                break;
            case 'processing':
                btn.classList.add('processing');
                btn.title = 'Processing...';
                break;
            default: // idle
                btn.title = 'Voice input (click to speak)';
                if (mic) mic.style.display = 'block';
                if (stop) stop.style.display = 'none';
                break;
        }
    }
}

// Active voice target tracks which input field is receiving voice
let activeVoiceTarget = 'chat-input';

function toggleVoiceInputChatPage() {
    activeVoiceTarget = 'chat-page-input';
    toggleVoiceInput();
}

// Override the original toggleVoiceInput to use the sidebar input
const originalToggleVoiceInput = toggleVoiceInput;
function toggleVoiceInput() {
    // If called directly (not via chat page), target sidebar
    // Only set to chat-input if we're starting a NEW recording
    if (activeVoiceTarget !== 'chat-page-input' && voiceInputState !== 'listening') {
        activeVoiceTarget = 'chat-input';
    }
    
    if (!voiceRecognition) {
        showToast('Voice input not available', 'error');
        return;
    }

    if (voiceInputState === 'listening') {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
    
    // Don't reset target here - it should persist until onend resets it
}

// ===================
// IMAGE HANDLING
// ===================

let pendingImages = [];

function handleImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) processImageFile(file);
    }
}

function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) processImageFile(file);
            return;
        }
    }
}

let chatInputSelection = { start: 0, end: 0 };

function handleChatInputKeydown(event) {
    const input = event.target;
    if (event.key !== 'Enter' || !input) return;
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); sendChatMessage(); return; }
    if (event.shiftKey) {
        event.preventDefault();
        const start = input.selectionStart;
        const value = input.value;
        input.value = `${value.slice(0, start)}\n${value.slice(start)}`;
        input.setSelectionRange(start + 1, start + 1);
        adjustChatInputHeight(input);
        return;
    }
}

function cacheChatInputSelection(input) {
    if (!input) return;
    chatInputSelection.start = input.selectionStart;
    chatInputSelection.end = input.selectionEnd;
}

function restoreChatInputSelection(input) {
    if (!input) return;
    const len = input.value.length;
    input.setSelectionRange(Math.min(chatInputSelection.start ?? len, len), Math.min(chatInputSelection.end ?? len, len));
}

function adjustChatInputHeight(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 36), 160)}px`;
}

function attachChatInputHandlers() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.addEventListener('keydown', handleChatInputKeydown);
    input.addEventListener('blur', () => cacheChatInputSelection(input));
    input.addEventListener('focus', () => { restoreChatInputSelection(input); adjustChatInputHeight(input); });
    input.addEventListener('input', () => adjustChatInputHeight(input));
    adjustChatInputHeight(input);
}

// Compress image to reduce size for WebSocket transmission
async function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Scale down if too large
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to JPEG for better compression (unless PNG transparency needed)
            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
        };
        img.src = dataUrl;
    });
}

function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Compress image if larger than 200KB
        let imageData = e.target.result;
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
        }
        
        pendingImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        });
        renderImagePreviews();
    };
    reader.readAsDataURL(file);
}

function renderImagePreviews() {
    const container = document.getElementById('image-preview-container');
    if (!container) return;
    
    if (pendingImages.length === 0) {
        container.classList.remove('visible');
        container.innerHTML = '';
        return;
    }
    
    container.classList.add('visible');
    container.innerHTML = pendingImages.map((img, idx) => `
        <div class="image-preview-wrapper">
            <img src="${img.data}" alt="Preview ${idx + 1}" />
            <button onclick="removeImagePreview('${img.id}')" class="image-preview-close">✕</button>
        </div>
    `).join('');
}

function removeImagePreview(imgId) {
    pendingImages = pendingImages.filter(img => img.id !== imgId);
    renderImagePreviews();
    if (pendingImages.length === 0) {
        const input = document.getElementById('image-upload');
        if (input) input.value = '';
    }
}

function clearImagePreviews() {
    pendingImages = [];
    renderImagePreviews();
    const input = document.getElementById('image-upload');
    if (input) input.value = '';
}

async function sendChatMessage() {
    // Stop voice recording if active
    if (voiceInputState === 'listening') {
        chatLog('[Voice] Stopping recording before send');
        stopVoiceInput();
    }
    
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;

    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to Gateway. Please connect first.', 'warning');
        return;
    }

    // Get images to send
    const imagesToSend = [...pendingImages];
    const hasImages = imagesToSend.length > 0;
    
    // Add to local display
    if (hasImages) {
        // Show all images in local preview
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        const imageDataArray = imagesToSend.map(img => img.data);
        addLocalChatMessage(displayText, 'user', imageDataArray);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    accumulatedTranscript = ''; // Clear voice accumulated text
    clearImagePreviews();
    adjustChatInputHeight(input);
    chatInputSelection = { start: 0, end: 0 };

    // Show typing indicator immediately
    isProcessing = true;
    renderChat();
    renderChatPage();

    // Send via Gateway WebSocket
    try {
        chatLog(`[Chat] Sending message with model: ${currentModel}`);
        if (hasImages) {
            // Send with image attachments (send all images)
            const imageDataArray = imagesToSend.map(img => img.data);
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send message:', err);
        addLocalChatMessage(`Failed to send: ${err.message}`, 'system');
    }
}

function addLocalChatMessage(text, from, imageOrModel = null, model = null) {
    // DEFENSIVE: Hard session gate - validate incoming messages match current session
    // Check if this message already has a session tag from outside
    const incomingSession = (imageOrModel?._sessionKey || '').toLowerCase();
    const currentSession = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    
    if (incomingSession && currentSession && incomingSession !== currentSession) {
        chatLog(`[Chat] BLOCKED addLocalChatMessage: incoming session=${incomingSession}, current=${currentSession}`);
        return null;
    }
    
    if (!state.chat) state.chat = { messages: [] };
    if (!state.system) state.system = { messages: [] };
    
    // Handle multiple parameter signatures:
    // (text, from)
    // (text, from, image) - single image data URI
    // (text, from, images) - array of image data URIs
    // (text, from, model) - model name string
    // (text, from, image, model)
    let images = [];
    let messageModel = model;
    
    if (imageOrModel) {
        if (Array.isArray(imageOrModel)) {
            // Array of images
            images = imageOrModel.filter(img => img && typeof img === 'string' && img.includes('data:'));
        } else if (typeof imageOrModel === 'string') {
            if (imageOrModel.includes('data:image') || imageOrModel.includes('data:application')) {
                // Single image data URI
                images = [imageOrModel];
            } else if (imageOrModel.includes('/') || imageOrModel.includes('claude') || imageOrModel.includes('gpt') || imageOrModel.includes('MiniMax')) {
                // Model name
                messageModel = imageOrModel;
            }
        }
    }
    
    chatLog(`[Chat] addLocalChatMessage: text="${text?.slice(0, 50)}", from=${from}, images=${images.length}, model=${messageModel}`);

    const message = {
        id: 'm' + Date.now(),
        from,
        text,
        time: Date.now(),
        image: images[0] || null, // Legacy single image field
        images: images, // New array field
        model: messageModel, // Store which AI model generated this response
        _sessionKey: currentSessionName || GATEWAY_CONFIG?.sessionKey || '' // Tag with session to prevent cross-session bleed
    };

    const isSystem = isSystemMessage(text, from);

    // Route to appropriate message array
    if (isSystem) {
        // System message - goes to system tab (local UI noise)
        state.system.messages.push(message);
        if (state.system.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.system.messages = state.system.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }
        persistSystemMessages(); // Persist system messages locally
        renderSystemPage();
    } else {
        // Real chat message - goes to chat tab (synced via Gateway)
        state.chat.messages.push(message);
        if (state.chat.messages.length > GATEWAY_CONFIG.maxMessages) {
            state.chat.messages = state.chat.messages.slice(-GATEWAY_CONFIG.maxMessages);
        }

        // Notify chat page of new message (for indicator when scrolled up)
        if (from !== 'user' && typeof notifyChatPageNewMessage === 'function') {
            notifyChatPageNewMessage();
        }

        // Persist chat to localStorage (workaround for Gateway bug #5735)
        persistChatMessages();
        
        // Also sync chat to VPS for cross-computer access
        syncChatToVPS();
        
        renderChat();
        renderChatPage();
    }

    return message;
}

// Debounced sync of chat messages to VPS (so messages persist across computers)
// Note: reuses chatSyncTimeout declared above
function syncChatToVPS() {
    // Debounce - wait 2 seconds after last message before syncing
    if (chatSyncTimeout) clearTimeout(chatSyncTimeout);
    chatSyncTimeout = setTimeout(async () => {
        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: state.chat.messages.slice(-100) })
            });
        } catch (e) {
            // Chat sync failed - not critical
        }
    }, 2000);
}

// ===================
// CHAT RENDERING (Clean rewrite)
// ===================

function renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) {
        return;
    }
    // Removed verbose log: renderChat called frequently

    const messages = state.chat?.messages || [];
    const isConnected = gateway?.isConnected();

    // Save scroll state BEFORE clearing
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 5;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    // Clear container
    container.innerHTML = '';

    // Show placeholder if no messages
    if (messages.length === 0 && !streamingText) {
        const placeholder = document.createElement('div');
        placeholder.style.cssText = 'color: var(--text-muted); font-size: 13px; text-align: center; padding: var(--space-8) 0;';
        placeholder.textContent = isConnected
            ? '💬 Connected! Send a message to start chatting.'
            : '🔌 Connect to Gateway in Settings to start chatting';
        container.appendChild(placeholder);
        return;
    }

    // Render each message (filtered by session to prevent bleed)
    const activeKey = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    messages.forEach(msg => {
        // Defensive: Skip messages from other sessions
        const msgSession = (msg._sessionKey || '').toLowerCase();
        if (msgSession && activeKey && msgSession !== activeKey) {
            chatLog(`[Chat] RENDER BLOCKED: msg session=${msgSession}, current=${activeKey}`);
            return;
        }
        const msgEl = createChatMessageElement(msg);
        if (msgEl) container.appendChild(msgEl);
    });

    // Render streaming message ONLY if it belongs to the current session
    const streamingActiveKey = (currentSessionName || '').toLowerCase();
    if (streamingText && _streamingSessionKey && _streamingSessionKey.toLowerCase() === streamingActiveKey) {
        const streamingMsg = createChatMessageElement({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }
    
    // Show typing indicator when processing but no streaming text yet
    if (isProcessing && !streamingText) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">Thinking...</span>
        `;
        container.appendChild(typingIndicator);
    }

    // Auto-scroll if was at bottom, otherwise maintain position
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        // Restore position by maintaining same distance from bottom
        container.scrollTop = container.scrollHeight - container.clientHeight - distanceFromBottom;
    }
}

function createChatMessageElement(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;

    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';

    // Create message container
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = 'var(--space-3)';

    // Create message bubble
    const bubble = document.createElement('div');
    bubble.style.padding = 'var(--space-3)';
    bubble.style.borderRadius = 'var(--radius-md)';
    bubble.style.maxWidth = '85%';
    bubble.style.wordWrap = 'break-word';

    if (isUser) {
        // User message - right aligned, brand red tint
        bubble.style.backgroundColor = 'rgba(188, 32, 38, 0.15)';
        bubble.style.border = '1px solid rgba(188, 32, 38, 0.25)';
        bubble.style.marginLeft = 'auto';
        bubble.style.textAlign = 'right';
    } else if (isSystem) {
        // System message - warning tint
        bubble.style.backgroundColor = 'var(--warning-muted)';
        bubble.style.border = '1px solid rgba(234, 179, 8, 0.2)';
    } else {
        // Bot message - left aligned, surface-2
        bubble.style.backgroundColor = msg.isStreaming ? 'var(--surface-2)' : 'var(--surface-2)';
        bubble.style.border = '1px solid var(--border-default)';
        bubble.style.marginRight = 'auto';
        if (msg.isStreaming) bubble.style.opacity = '0.8';
    }

    // Header with name and time
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = 'var(--space-2)';
    header.style.marginBottom = 'var(--space-2)';
    header.style.fontSize = '12px';
    if (isUser) header.style.justifyContent = 'flex-end';

    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '500';
    if (isUser) {
        nameSpan.style.color = 'var(--brand-red)';
        nameSpan.textContent = 'You';
    } else if (isSystem) {
        nameSpan.style.color = 'var(--warning)';
        nameSpan.textContent = 'System';
    } else {
        nameSpan.style.color = 'var(--success)';
        const displayName = getAgentDisplayName(currentAgentId);
        nameSpan.textContent = msg.isStreaming ? `${displayName} (typing...)` : displayName;
    }
    
    // Model badge for bot messages (shows which AI model generated the response)
    if (!isUser && !isSystem && msg.model) {
        const modelBadge = document.createElement('span');
        modelBadge.style.cssText = 'font-size: 10px; padding: 1px 5px; background: var(--surface-3); border-radius: 3px; color: var(--text-muted); margin-left: 4px;';
        // Show short model name (e.g., 'claude-3-5-sonnet' instead of 'anthropic/claude-3-5-sonnet-latest')
        const shortModel = msg.model.split('/').pop().replace(/-latest$/, '');
        modelBadge.textContent = shortModel;
        modelBadge.title = msg.model; // Full model name on hover
        header.appendChild(modelBadge);
    }

    const timeSpan = document.createElement('span');
    timeSpan.style.color = 'var(--text-muted)';
    timeSpan.textContent = formatTime(msg.time);

    header.appendChild(nameSpan);
    header.appendChild(timeSpan);

    // Message content
    const content = document.createElement('div');
    content.style.fontSize = '14px';
    content.style.color = 'var(--text-primary)';
    content.style.lineHeight = '1.5';
    content.style.whiteSpace = 'pre-wrap';
    content.innerHTML = linkifyText(msg.text); // linkifyText escapes HTML first, then adds <a> tags

    // Images if present - show thumbnails
    const images = msg.images || (msg.image ? [msg.image] : []);
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '8px';
        imageContainer.style.marginBottom = 'var(--space-2)';
        
        images.forEach((imgSrc, idx) => {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.style.maxWidth = images.length > 1 ? '100px' : '150px';
            img.style.maxHeight = images.length > 1 ? '80px' : '100px';
            img.style.borderRadius = 'var(--radius-md)';
            img.style.cursor = 'pointer';
            img.style.objectFit = 'cover';
            img.style.border = '1px solid var(--border-default)';
            img.title = `Image ${idx + 1} of ${images.length} - Click to view`;
            img.onclick = () => openImageModal(imgSrc);
            imageContainer.appendChild(img);
        });
        
        bubble.appendChild(imageContainer);
    }

    bubble.appendChild(header);
    bubble.appendChild(content);
    wrapper.appendChild(bubble);

    return wrapper;
}

function openImageModal(src) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:1000;cursor:pointer;padding:40px;';
    modal.onclick = () => modal.remove();

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:20px;right:30px;color:white;font-size:28px;cursor:pointer;opacity:0.7;transition:opacity 0.2s;';
    closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.7';
    modal.appendChild(closeBtn);

    // Image container for shadow effect
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'max-width:85vw;max-height:85vh;box-shadow:0 25px 50px rgba(0,0,0,0.5);border-radius:8px;overflow:hidden;';

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'display:block;max-width:85vw;max-height:85vh;object-fit:contain;';
    img.onclick = (e) => e.stopPropagation(); // Don't close when clicking image

    imgContainer.appendChild(img);
    modal.appendChild(imgContainer);

    // Click hint
    const hint = document.createElement('div');
    hint.textContent = 'Click anywhere to close';
    hint.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.5);font-size:12px;';
    modal.appendChild(hint);

    document.body.appendChild(modal);
}



// ===================
// CHAT PAGE FUNCTIONS
// ===================

// Chat page state
let chatPagePendingImages = [];
let chatPageScrollPosition = null;
let chatPageUserScrolled = false;
let chatPageNewMessageCount = 0;
let chatPageLastRenderKey = null;
let suppressChatRenderUntil = 0;

// Suppress chat re-renders briefly on right-click to preserve text selection
document.addEventListener('contextmenu', (e) => {
    const container = document.getElementById('chat-page-messages');
    if (container && container.contains(e.target)) {
        suppressChatRenderUntil = Date.now() + 1500;
    }
});

// Save scroll position to sessionStorage
function saveChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (container && container.scrollTop > 0) {
        sessionStorage.setItem('chatScrollPosition', container.scrollTop);
        sessionStorage.setItem('chatScrollHeight', container.scrollHeight);
    }
}

// Restore scroll position from sessionStorage
function restoreChatScrollPosition() {
    const container = document.getElementById('chat-page-messages');
    if (!container) return;
    
    const savedPosition = sessionStorage.getItem('chatScrollPosition');
    const savedHeight = sessionStorage.getItem('chatScrollHeight');
    
    if (savedPosition && savedHeight) {
        // Calculate relative position and apply
        const ratio = parseFloat(savedPosition) / parseFloat(savedHeight);
        container.scrollTop = ratio * container.scrollHeight;
    }
}

// Expose scroll functions globally for page navigation
window.saveChatScrollPosition = saveChatScrollPosition;
window.restoreChatScrollPosition = restoreChatScrollPosition;

// Check if user is at the very bottom (strict check for auto-scroll)
function isAtBottom(container) {
    if (!container) return true;
    // Only consider "at bottom" if within 5px - user must be truly at the bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < 5;
}

// Check if user is near the bottom (looser check for indicator hiding)
function isNearBottom(container) {
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// Scroll to bottom
function scrollChatToBottom() {
    const container = document.getElementById('chat-page-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
        chatPageUserScrolled = false;
        chatPageNewMessageCount = 0;
        updateNewMessageIndicator();
    }
}

// Update new message indicator visibility
function updateNewMessageIndicator() {
    const indicator = document.getElementById('chat-page-new-indicator');
    if (!indicator) return;
    
    const container = document.getElementById('chat-page-messages');
    const notAtBottom = container && !isAtBottom(container);
    
    if (notAtBottom && chatPageNewMessageCount > 0) {
        indicator.textContent = `↓ ${chatPageNewMessageCount} new message${chatPageNewMessageCount > 1 ? 's' : ''}`;
        indicator.classList.remove('hidden');
    } else {
        indicator.classList.add('hidden');
        if (!notAtBottom) {
            chatPageNewMessageCount = 0; // Reset count when at bottom
        }
    }
}

// Setup scroll listener for chat page
function setupChatPageScrollListener() {
    const container = document.getElementById('chat-page-messages');
    if (!container || container.dataset.scrollListenerAttached) return;
    
    container.addEventListener('scroll', () => {
        // Update indicator based on scroll position
        updateNewMessageIndicator();
        
        // Show/hide floating scroll button
        updateScrollToBottomButton();
        
        // Save position periodically
        saveChatScrollPosition();
    });
    
    container.dataset.scrollListenerAttached = 'true';
}

function updateScrollToBottomButton() {
    const container = document.getElementById('chat-page-messages');
    const btn = document.getElementById('scroll-to-bottom-btn');
    if (!container || !btn) return;
    
    // Show button if scrolled up more than 200px from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 200) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

function forceRefreshHistory() {
    // Route through guarded function to prevent spam
    _doHistoryRefresh();
}

function renderChatPage() {
    const container = document.getElementById('chat-page-messages');
    if (!container) {
        return;
    }
    // Removed verbose log: renderChatPage called frequently

    // Setup scroll listener
    setupChatPageScrollListener();

    // Update connection status
    const statusDot = document.getElementById('chat-page-status-dot');
    const statusText = document.getElementById('chat-page-status-text');
    const isConnected = gateway?.isConnected();

    if (statusDot) {
        statusDot.className = `status-dot ${isConnected ? 'success' : 'idle'}`;
    }
    if (statusText) {
        statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
    }

    const messages = state.chat?.messages || [];

    // Avoid clearing selection: if user is selecting text in chat, skip re-render
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;
    const selectionInChat = hasSelection && (
        (selection.anchorNode && container.contains(selection.anchorNode)) ||
        (selection.focusNode && container.contains(selection.focusNode))
    );
    if (selectionInChat) {
        return;
    }

    // Suppress render briefly after right-click
    if (Date.now() < suppressChatRenderUntil) {
        return;
    }

    // Skip re-render if nothing changed (prevents text selection from collapsing)
    const lastMsg = messages[messages.length - 1];
    const renderKey = [
        messages.length,
        lastMsg?.id || '',
        lastMsg?.time || '',
        streamingText || '',
        isProcessing ? 1 : 0
    ].join('|');

    if (renderKey === chatPageLastRenderKey) {
        return;
    }
    chatPageLastRenderKey = renderKey;
    
    // Check if at bottom BEFORE clearing (use strict check to avoid unwanted scrolling)
    const wasAtBottom = isAtBottom(container);
    // Save distance from bottom (how far up the user has scrolled)
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    
    // === Incremental rendering — only touch DOM for changes ===

    // Show empty state if no messages
    if (messages.length === 0 && !streamingText) {
        const displayName = getAgentDisplayName(currentAgentId);
        container.innerHTML = `
            <div class="chat-page-empty">
                <div class="chat-page-empty-icon">💬</div>
                <div class="chat-page-empty-text">
                    ${isConnected 
                        ? `Start a conversation with ${displayName}` 
                        : 'Connect to Gateway in <a href="#" onclick="openSettingsModal(); return false;">Settings</a> to start chatting'}
                </div>
            </div>
        `;
        container._renderedCount = 0;
        return;
    }

    // Remove empty state if it was showing
    const emptyState = container.querySelector('.chat-page-empty');
    if (emptyState) { container.innerHTML = ''; container._renderedCount = 0; }

    // How many real messages are already in DOM?
    const renderedCount = container._renderedCount || 0;

    // Full re-render needed if messages were removed/replaced (session switch, etc.)
    const needsFullRender = renderedCount > messages.length || container._sessionKey !== (currentSessionName || GATEWAY_CONFIG?.sessionKey);
    if (needsFullRender) {
        container.innerHTML = '';
        container._renderedCount = 0;
        container._sessionKey = currentSessionName || GATEWAY_CONFIG?.sessionKey;
    }

    const currentRendered = container._renderedCount || 0;

    // Append only new messages (skip already-rendered ones)
    // First, remove any transient elements (streaming msg, typing indicator)
    const transient = container.querySelectorAll('.streaming, .typing-indicator');
    transient.forEach(el => el.remove());

    // Append new messages (filtered by session to prevent bleed)
    const activeKeyCP = (currentSessionName || GATEWAY_CONFIG?.sessionKey || '').toLowerCase();
    if (messages.length > currentRendered) {
        const fragment = document.createDocumentFragment();
        for (let i = currentRendered; i < messages.length; i++) {
            // Defensive: Skip messages from other sessions
            const msg = messages[i];
            const msgSession = (msg._sessionKey || '').toLowerCase();
            if (msgSession && activeKeyCP && msgSession !== activeKeyCP) {
                chatLog(`[Chat] RENDER BLOCKED: msg session=${msgSession}, current=${activeKeyCP}`);
                continue;
            }
            const msgEl = createChatPageMessage(msg);
            if (msgEl) fragment.appendChild(msgEl);
        }
        container.appendChild(fragment);
        container._renderedCount = messages.length;
    }

    // Render streaming message ONLY if it belongs to the current session
    const streamingActiveKeyCP = (currentSessionName || '').toLowerCase();
    if (streamingText && _streamingSessionKey && _streamingSessionKey.toLowerCase() === streamingActiveKeyCP) {
        const streamingMsg = createChatPageMessage({
            id: 'streaming',
            from: 'solobot',
            text: streamingText,
            time: Date.now(),
            isStreaming: true
        });
        if (streamingMsg) container.appendChild(streamingMsg);
    }
    
    // Show typing indicator when processing but no streaming text yet
    if (isProcessing && !streamingText) {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.style.cssText = 'margin: 12px 0 12px 12px;';
        typingIndicator.innerHTML = `
            <div class="dot"></div>
            <div class="dot"></div>
            <div class="dot"></div>
            <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">Thinking...</span>
        `;
        container.appendChild(typingIndicator);
    }
    
    // Smart scroll behavior - only auto-scroll if user was truly at the bottom
    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = container.scrollHeight - container.clientHeight - distanceFromBottom;
    }
}

// Create a chat page message element (different styling from widget)
function createChatPageMessage(msg) {
    if (!msg || typeof msg.text !== 'string') return null;
    if (!msg.text.trim() && !msg.image) return null;
    
    const isUser = msg.from === 'user';
    const isSystem = msg.from === 'system';
    const isBot = !isUser && !isSystem;
    
    // Message wrapper
    const wrapper = document.createElement('div');
    wrapper.className = `chat-page-message ${msg.from}${msg.isStreaming ? ' streaming' : ''}`;
    wrapper.setAttribute('data-msg-id', msg.id || '');
    
    // Avatar (for bot and user messages, not system)
    if (!isSystem) {
        const avatar = document.createElement('div');
        avatar.className = 'chat-page-avatar';
        
        if (isUser) {
            // User avatar - initials circle
            avatar.classList.add('user-avatar');
            avatar.textContent = 'U';
        } else {
            // Bot avatar - agent-specific image and color
            const agentId = currentAgentId || 'main';
            avatar.setAttribute('data-agent', agentId);
            
            // Get avatar path (fallback to main for agents without custom avatars)
            const avatarPath = ['main', 'dev', 'exec', 'coo', 'cfo', 'cmp', 'family', 'smm'].includes(agentId) 
                ? `/avatars/${agentId === 'main' ? 'solobot' : agentId}.png`
                : (agentId === 'tax' || agentId === 'sec') 
                    ? `/avatars/${agentId}.svg`
                    : '/avatars/solobot.png';
            
            const avatarImg = document.createElement('img');
            avatarImg.src = avatarPath;
            avatarImg.alt = getAgentDisplayName(agentId);
            avatarImg.onerror = () => { avatarImg.style.display = 'none'; avatar.textContent = '🤖'; };
            avatar.appendChild(avatarImg);
        }
        
        wrapper.appendChild(avatar);
    }
    
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = 'chat-page-bubble';
    
    // Images if present - show thumbnails
    const images = msg.images || (msg.image ? [msg.image] : []);
    if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.gap = '8px';
        imageContainer.style.marginBottom = '8px';
        
        images.forEach((imgSrc, idx) => {
            const img = document.createElement('img');
            img.src = imgSrc;
            img.className = 'chat-page-bubble-image';
            img.style.maxWidth = images.length > 1 ? '100px' : '200px';
            img.style.maxHeight = images.length > 1 ? '100px' : '150px';
            img.style.objectFit = 'cover';
            img.style.cursor = 'pointer';
            img.title = `Image ${idx + 1} of ${images.length} - Click to view`;
            img.onclick = () => openImageModal(imgSrc);
            imageContainer.appendChild(img);
        });
        
        bubble.appendChild(imageContainer);
    }
    
    // Header with sender and time
    const header = document.createElement('div');
    header.className = 'chat-page-bubble-header';
    
    const sender = document.createElement('span');
    sender.className = 'chat-page-sender';
    if (isUser) {
        sender.textContent = 'You';
    } else if (isSystem) {
        sender.textContent = 'System';
    } else {
        const displayName = getAgentDisplayName(currentAgentId);
        sender.textContent = msg.isStreaming ? `${displayName} is typing...` : displayName;
    }
    
    const time = document.createElement('span');
    time.className = 'chat-page-bubble-time';
    time.textContent = formatSmartTime(msg.time);
    time.title = formatTime(msg.time); // Show exact time on hover
    
    header.appendChild(sender);
    header.appendChild(time);
    bubble.appendChild(header);
    
    // Content
    const content = document.createElement('div');
    content.className = 'chat-page-bubble-content';
    content.innerHTML = linkifyText(msg.text);
    bubble.appendChild(content);
    
    // Action buttons (copy, etc.) - show on hover
    if (!msg.isStreaming) {
        const actions = document.createElement('div');
        actions.className = 'chat-page-bubble-actions';
        
        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'chat-action-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = 'Copy message';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(msg.text);
            copyBtn.innerHTML = '✓';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '📋';
                copyBtn.classList.remove('copied');
            }, 1500);
        };
        actions.appendChild(copyBtn);
        
        bubble.appendChild(actions);
    }
    
    wrapper.appendChild(bubble);
    return wrapper;
}

// Copy text to clipboard with feedback
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success', 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Copied to clipboard!', 'success', 2000);
    });
}

// Notify of new message (for indicator)
function notifyChatPageNewMessage() {
    const container = document.getElementById('chat-page-messages');
    // Show indicator if user is NOT at the bottom
    if (container && !isAtBottom(container)) {
        chatPageNewMessageCount++;
        updateNewMessageIndicator();
    }
}

function handleChatPageImageSelect(event) {
    const files = event.target.files;
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            processChatPageImageFile(file);
        }
    }
}

function handleChatPagePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) processChatPageImageFile(file);
            return;
        }
    }
}

function processChatPageImageFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        // Compress image if larger than 200KB
        let imageData = e.target.result;
        if (imageData.length > 200 * 1024) {
            imageData = await compressImage(imageData);
        }
        
        chatPagePendingImages.push({
            id: 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            data: imageData,
            name: file.name,
            type: 'image/jpeg'
        });
        renderChatPageImagePreviews();
    };
    reader.readAsDataURL(file);
}

function renderChatPageImagePreviews() {
    const container = document.getElementById('chat-page-image-preview');
    if (!container) return;
    
    if (chatPagePendingImages.length === 0) {
        container.classList.add('hidden');
        container.classList.remove('visible');
        container.innerHTML = '';
        return;
    }
    
    container.classList.remove('hidden');
    container.classList.add('visible');
    container.innerHTML = chatPagePendingImages.map((img, idx) => `
        <div class="image-preview-wrapper">
            <img src="${img.data}" alt="Preview ${idx + 1}" />
            <button onclick="removeChatPageImagePreview('${img.id}')" class="image-preview-close">✕</button>
        </div>
    `).join('');
}

function removeChatPageImagePreview(imgId) {
    chatPagePendingImages = chatPagePendingImages.filter(img => img.id !== imgId);
    renderChatPageImagePreviews();
    if (chatPagePendingImages.length === 0) {
        const input = document.getElementById('chat-page-image-upload');
        if (input) input.value = '';
    }
}

function clearChatPageImagePreviews() {
    chatPagePendingImages = [];
    renderChatPageImagePreviews();
    const input = document.getElementById('chat-page-image-upload');
    if (input) input.value = '';
}

function resizeChatPageInput() {
    const input = document.getElementById('chat-page-input');
    if (!input) return;
    input.style.height = 'auto';
    const maxHeight = 150;
    input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
}

function setupChatPageInput() {
    const input = document.getElementById('chat-page-input');
    if (!input) return;

    input.addEventListener('input', resizeChatPageInput);
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.isComposing || e.keyCode === 229) return;
        if (e.shiftKey) return;
        if (!gateway || !gateway.isConnected()) return;
        e.preventDefault();
        sendChatPageMessage();
    });

    resizeChatPageInput();
}

function setActiveSidebarAgent(agentId) {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    agentEls.forEach(el => {
        if (agentId && el.getAttribute('data-agent') === agentId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    // Update currentAgentId and refresh dropdown to show this agent's sessions
    if (agentId) {
        const wasChanged = agentId !== currentAgentId;
        currentAgentId = agentId;
        
        // Update agent name display in chat header
        const agentNameEl = document.getElementById('chat-page-agent-name');
        if (agentNameEl) {
            agentNameEl.textContent = getAgentLabel(agentId);
        }
        
        if (wasChanged) {
            populateSessionDropdown();
        }
    }
}

// Force sync active state (for rapid switches)
function forceSyncActiveAgent(agentId) {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    agentEls.forEach(el => {
        const elAgent = el.getAttribute('data-agent');
        if (agentId && elAgent === agentId) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    currentAgentId = agentId;
    const agentNameEl = document.getElementById('chat-page-agent-name');
    if (agentNameEl) {
        agentNameEl.textContent = getAgentLabel(agentId);
    }
}

// Track last-used session per agent (persisted to localStorage)
function getLastAgentSession(agentId) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        return map[agentId] || null;
    } catch { return null; }
}

function saveLastAgentSession(agentId, sessionKey) {
    try {
        const map = JSON.parse(localStorage.getItem('agent_last_sessions') || '{}');
        map[agentId] = sessionKey;
        localStorage.setItem('agent_last_sessions', JSON.stringify(map));
    } catch {}
}

function setupSidebarAgents() {
    const agentEls = document.querySelectorAll('.sidebar-agent[data-agent]');
    if (!agentEls.length) return;

    const activateAgentFromEl = (el) => {
        const agentId = el.getAttribute('data-agent');
        if (!agentId) return;

        // IMMEDIATE UI feedback - show active state before switch completes
        forceSyncActiveAgent(agentId);

        // Update current agent ID first so dropdown filters correctly
        currentAgentId = agentId;

        // Restore last session for this agent, or default to main
        const sessionKey = getLastAgentSession(agentId) || `agent:${agentId}:main`;
        showPage('chat');

        // Fire-and-forget switch (queue in sessions.js handles ordering)
        switchToSession(sessionKey).catch(() => {});
    };

    agentEls.forEach(el => {
        // If text gets truncated in the UI, give a native tooltip with the full name.
        const label = el.querySelector('.sidebar-item-text');
        if (label && !label.title) label.title = (label.textContent || '').trim();

        // Only add listener once per element
        if (el._agentClickBound) return;
        el._agentClickBound = true;

        // PATCH: Always handle mousedown to prevent selection from blocking agent switch
        // This ensures sidebar clicks work even when chat text is highlighted
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;  // Left click only
            
            // Clear any text selection to prevent interference
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) {
                try { selection.removeAllRanges(); } catch {}
            }
            
            // Always prevent default to avoid any selection-related interference
            e.preventDefault();
            e.stopPropagation();
            
            // Mark as handled so click doesn't double-fire
            el._handledByMousedown = true;
            
            // Execute switch
            activateAgentFromEl(el);
        });

        el.addEventListener('click', (e) => {
            // Skip if mousedown already handled it
            if (el._handledByMousedown) {
                el._handledByMousedown = false;
                return;
            }
            // Handle normal click (no selection case)
            activateAgentFromEl(el);
        });
    });

    const currentSession = GATEWAY_CONFIG?.sessionKey || 'main';
    const match = currentSession.match(/^agent:([^:]+):/);
    if (match) {
        currentAgentId = match[1];
        setActiveSidebarAgent(match[1]);
    }
}

async function sendChatPageMessage() {
    // Stop voice recording if active
    if (voiceInputState === 'listening') {
        chatLog('[Voice] Stopping recording before send');
        stopVoiceInput();
    }
    
    const input = document.getElementById('chat-page-input');
    const text = input.value.trim();
    if (!text && chatPagePendingImages.length === 0) return;
    
    if (!gateway || !gateway.isConnected()) {
        showToast('Not connected to Gateway. Please connect first in Settings.', 'warning');
        return;
    }
    
    const imagesToSend = [...chatPagePendingImages];
    const hasImages = imagesToSend.length > 0;
    
    if (hasImages) {
        const imgCount = imagesToSend.length;
        const displayText = text || (imgCount > 1 ? `📷 ${imgCount} Images` : '📷 Image');
        const imageDataArray = imagesToSend.map(img => img.data);
        addLocalChatMessage(displayText, 'user', imageDataArray);
    } else {
        addLocalChatMessage(text, 'user');
    }
    
    input.value = '';
    accumulatedTranscript = ''; // Clear voice accumulated text
    resizeChatPageInput();
    input.focus();
    clearChatPageImagePreviews();
    
    // Force scroll to bottom when user sends
    chatPageUserScrolled = false;
    
    // Show typing indicator immediately
    isProcessing = true;
    
    // Render both areas
    renderChat();
    renderChatPage();
    
    // Send via Gateway
    try {
        chatLog(`[Chat] Sending message with model: ${currentModel}`);
        if (hasImages) {
            const imageDataArray = imagesToSend.map(img => img.data);
            await gateway.sendMessageWithImages(text || 'Image', imageDataArray);
        } else {
            await gateway.sendMessage(text);
        }
    } catch (err) {
        console.error('Failed to send:', err);
        addLocalChatMessage(`Failed: ${err.message}`, 'system');
        renderChat();
        renderChatPage();
    }
}

// ========================================
// Chat Search Functionality
// ========================================

let chatSearchQuery = '';
let chatSearchResults = [];
let chatSearchCurrentIndex = -1;

function initChatSearch() {
    const searchInput = document.getElementById('chat-search');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        chatSearchQuery = e.target.value.trim().toLowerCase();
        performChatSearch();
    });

    // Keyboard navigation within results
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (chatSearchResults.length > 0) {
                // Navigate to next/previous result
                if (e.shiftKey) {
                    chatSearchCurrentIndex = (chatSearchCurrentIndex - 1 + chatSearchResults.length) % chatSearchResults.length;
                } else {
                    chatSearchCurrentIndex = (chatSearchCurrentIndex + 1) % chatSearchResults.length;
                }
                scrollToChatSearchResult(chatSearchResults[chatSearchCurrentIndex]);
            }
        } else if (e.key === 'Escape') {
            searchInput.blur();
        }
    });
}

function performChatSearch() {
    if (!chatSearchQuery) {
        // Clear any search highlights
        clearChatSearchHighlights();
        chatSearchResults = [];
        chatSearchCurrentIndex = -1;
        return;
    }

    const messages = state.chat?.messages || [];
    chatSearchResults = messages.filter(msg => {
        const text = msg.text?.toLowerCase() || '';
        return text.includes(chatSearchQuery);
    });

    if (chatSearchResults.length > 0) {
        chatSearchCurrentIndex = 0;
        scrollToChatSearchResult(chatSearchResults[0]);
        showToast(`Found ${chatSearchResults.length} match${chatSearchResults.length !== 1 ? 'es' : ''}`, 'info', 2000);
    } else {
        showToast('No matches found', 'warning', 2000);
    }
}

function scrollToChatSearchResult(msg) {
    const container = document.getElementById('chat-page-messages');
    if (!container || !msg) return;

    // Find the message element
    const msgEl = container.querySelector(`[data-msg-id="${msg.id}"]`);
    if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightChatSearchResult(msgEl);
    }
}

function highlightChatSearchResult(element) {
    // Remove previous highlights
    clearChatSearchHighlights();
    // Add highlight class
    element.classList.add('chat-search-highlight');
    // Remove highlight after 3 seconds
    setTimeout(() => {
        element.classList.remove('chat-search-highlight');
    }, 3000);
}

function clearChatSearchHighlights() {
    const container = document.getElementById('chat-page-messages');
    if (container) {
        container.querySelectorAll('.chat-search-highlight').forEach(el => {
            el.classList.remove('chat-search-highlight');
        });
    }
}

// Initialize search on load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initChatSearch, 100); // Small delay to ensure DOM is ready
});




