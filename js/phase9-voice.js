// js/phase9-voice.js — Phase 9: Voice Integration
// Voice commands, audio notifications, and voice memos with transcription

(function() {
    'use strict';

    // ==========================================
    // Voice Recognition & Commands
    // ==========================================
    
    let recognition = null;
    let isListening = false;
    let voiceCommandQueue = [];
    
    // Available voice commands
    const VOICE_COMMANDS = {
        'create task': { action: 'createTask', description: 'Create a new task' },
        'new task': { action: 'createTask', description: 'Create a new task' },
        'add task': { action: 'createTask', description: 'Create a new task' },
        'show dashboard': { action: 'navigate', target: 'dashboard', description: 'Navigate to dashboard' },
        'show tasks': { action: 'navigate', target: 'dashboard', description: 'Navigate to tasks' },
        'show chat': { action: 'navigate', target: 'chat', description: 'Navigate to chat' },
        'show memory': { action: 'navigate', target: 'memory', description: 'Navigate to memory' },
        'switch to dev': { action: 'switchAgent', target: 'dev', description: 'Switch to DEV agent' },
        'switch to exec': { action: 'switchAgent', target: 'elon', description: 'Switch to Elon agent' },
        'switch to elon': { action: 'switchAgent', target: 'elon', description: 'Switch to Elon agent' },
        'switch to main': { action: 'switchAgent', target: 'main', description: 'Switch to MAIN agent' },
        'mark done': { action: 'markDone', description: 'Mark current/last task as done' },
        'clear terminal': { action: 'clearTerminal', description: 'Clear terminal output' },
        'start focus': { action: 'startFocus', description: 'Start focus timer' },
        'stop focus': { action: 'stopFocus', description: 'Stop focus timer' },
        'show help': { action: 'showHelp', description: 'Show voice commands help' }
    };

    function initVoiceRecognition() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn('[Voice] Speech recognition not supported in this browser');
            return false;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            updateVoiceIndicator(true);
            addActivity('🎤 Voice recognition started', 'info');
        };

        recognition.onend = () => {
            isListening = false;
            updateVoiceIndicator(false);
            // Auto-restart if not manually stopped
            if (voiceSettings.autoRestart) {
                setTimeout(() => {
                    if (voiceSettings.enabled && !isListening) {
                        startVoiceRecognition();
                    }
                }, 500);
            }
        };

        recognition.onresult = (event) => {
            handleVoiceResult(event);
        };

        recognition.onerror = (event) => {
            console.warn('[Voice] Recognition error:', event.error);
            if (event.error === 'not-allowed') {
                addActivity('🎤 Voice permission denied', 'error');
                voiceSettings.enabled = false;
            }
        };

        return true;
    }

    function handleVoiceResult(event) {
        const results = event.results;
        const lastResult = results[results.length - 1];
        
        if (lastResult.isFinal) {
            const transcript = lastResult[0].transcript.toLowerCase().trim();
            console.log('[Voice] Heard:', transcript);
            processVoiceCommand(transcript);
        }
    }

    function processVoiceCommand(transcript) {
        // Check for wake word
        if (!transcript.includes(voiceSettings.wakeWord.toLowerCase())) {
            return;
        }

        // Remove wake word and process command
        const commandText = transcript.replace(voiceSettings.wakeWord.toLowerCase(), '').trim();
        
        // Match command
        for (const [phrase, command] of Object.entries(VOICE_COMMANDS)) {
            if (commandText.includes(phrase)) {
                executeCommand(command, commandText);
                return;
            }
        }

        // If no command matched but it's a task creation attempt
        if (commandText.length > 5) {
            // Treat as task creation if it doesn't match other commands
            createTaskFromVoice(commandText);
        }
    }

    function executeCommand(command, fullText) {
        console.log('[Voice] Executing command:', command.action);
        
        switch (command.action) {
            case 'createTask':
                const taskTitle = fullText.replace(/^(create|new|add)\s+task/, '').trim();
                if (taskTitle) createTaskFromVoice(taskTitle);
                break;
            case 'navigate':
                if (typeof showPage === 'function') showPage(command.target);
                addActivity(`🎤 Navigated to ${command.target}`, 'success');
                playAudioCue('success');
                break;
            case 'switchAgent':
                if (typeof setActiveSidebarAgent === 'function') {
                    setActiveSidebarAgent(command.target);
                }
                addActivity(`🎤 Switched to ${command.target.toUpperCase()} agent`, 'success');
                playAudioCue('success');
                break;
            case 'markDone':
                markLastTaskDone();
                break;
            case 'clearTerminal':
                if (typeof clearConsole === 'function') clearConsole();
                addActivity('🎤 Terminal cleared', 'success');
                break;
            case 'startFocus':
                if (typeof startFocusTimer === 'function') startFocusTimer();
                break;
            case 'stopFocus':
                if (typeof stopFocusTimer === 'function') stopFocusTimer();
                break;
            case 'showHelp':
                showVoiceHelp();
                break;
        }
    }

    function createTaskFromVoice(title) {
        const task = {
            id: 't' + Date.now(),
            title: title.charAt(0).toUpperCase() + title.slice(1),
            priority: 1,
            created: Date.now(),
            description: 'Created via voice command',
            agent: currentAgentId || 'main'
        };

        if (!state.tasks.todo) state.tasks.todo = [];
        state.tasks.todo.unshift(task);
        saveState('Task created via voice');
        renderTasks();
        
        addActivity(`🎤 Created task: ${task.title.substring(0, 30)}...`, 'success');
        playAudioCue('success');
        showToast('Task created from voice!', 'success');
    }

    function markLastTaskDone() {
        const inProgress = state.tasks.progress || [];
        if (inProgress.length > 0) {
            const task = inProgress[0];
            quickMoveTask(task.id, 'progress', 'done');
            addActivity(`🎤 Marked task as done: ${task.title.substring(0, 30)}...`, 'success');
        } else {
            showToast('No tasks in progress', 'warning');
        }
    }

    function startVoiceRecognition() {
        if (!recognition) {
            if (!initVoiceRecognition()) {
                showToast('Voice recognition not supported', 'error');
                return;
            }
        }
        
        try {
            recognition.start();
        } catch (e) {
            console.warn('[Voice] Start failed:', e);
        }
    }

    function stopVoiceRecognition() {
        if (recognition) {
            recognition.stop();
        }
    }

    function toggleVoiceRecognition() {
        if (isListening) {
            stopVoiceRecognition();
        } else {
            startVoiceRecognition();
        }
    }

    // ==========================================
    // Audio Notifications
    // ==========================================

    const AUDIO_CUES = {
        success: { frequency: 523.25, duration: 150, type: 'sine' }, // C5
        error: { frequency: 261.63, duration: 300, type: 'sawtooth' }, // C4
        warning: { frequency: 392, duration: 200, type: 'triangle' }, // G4
        info: { frequency: 440, duration: 100, type: 'sine' }, // A4
        complete: { frequencies: [523.25, 659.25, 783.99], duration: 200, type: 'sine' }, // C-E-G arpeggio
        notification: { frequency: 880, duration: 80, type: 'sine' } // A5
    };

    let audioContext = null;

    function initAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioContext;
    }

    function playAudioCue(type) {
        if (!voiceSettings.audioEnabled) return;
        
        const cue = AUDIO_CUES[type];
        if (!cue) return;

        try {
            const ctx = initAudioContext();
            const now = ctx.currentTime;

            if (cue.frequencies) {
                // Play arpeggio
                cue.frequencies.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = cue.type;
                    osc.frequency.setValueAtTime(freq, now + i * 0.05);
                    gain.gain.setValueAtTime(0.1, now + i * 0.05);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.05 + cue.duration / 1000);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + i * 0.05);
                    osc.stop(now + i * 0.05 + cue.duration / 1000);
                });
            } else {
                // Play single tone
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = cue.type;
                osc.frequency.setValueAtTime(cue.frequency, now);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + cue.duration / 1000);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + cue.duration / 1000);
            }
        } catch (e) {
            console.warn('[Audio] Play failed:', e);
        }
    }

    // ==========================================
    // Voice Memos with Transcription
    // ==========================================

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingStartTime = null;
    let voiceMemos = [];

    function initVoiceMemoRecorder() {
        // Load saved memos
        const saved = localStorage.getItem('solobot-voice-memos');
        if (saved) {
            voiceMemos = JSON.parse(saved);
        }
    }

    async function startVoiceMemoRecording() {
        if (isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                saveVoiceMemo();
            };

            mediaRecorder.start();
            isRecording = true;
            recordingStartTime = Date.now();
            updateRecordingIndicator(true);
            playAudioCue('info');
            
            addActivity('🎙️ Voice memo recording started', 'info');
        } catch (e) {
            console.warn('[VoiceMemo] Recording failed:', e);
            showToast('Microphone access denied', 'error');
        }
    }

    function stopVoiceMemoRecording() {
        if (!isRecording || !mediaRecorder) return;

        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        updateRecordingIndicator(false);
    }

    function saveVoiceMemo() {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
        
        const memo = {
            id: 'memo-' + Date.now(),
            timestamp: Date.now(),
            duration: duration,
            audioUrl: URL.createObjectURL(audioBlob),
            transcription: null,
            status: 'recorded' // recorded, transcribing, done
        };

        voiceMemos.unshift(memo);
        saveVoiceMemos();
        
        // Start transcription
        transcribeVoiceMemo(memo);
        
        addActivity(`🎙️ Voice memo saved (${duration}s)`, 'success');
        playAudioCue('success');
        renderVoiceMemos();
    }

    async function transcribeVoiceMemo(memo) {
        memo.status = 'transcribing';
        renderVoiceMemos();

        // Check if browser supports speech recognition for transcription
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            memo.transcription = 'Transcription not supported in this browser';
            memo.status = 'done';
            saveVoiceMemos();
            renderVoiceMemos();
            return;
        }

        // For now, provide a placeholder - in production this would use a speech-to-text API
        setTimeout(() => {
            memo.transcription = '[Transcription pending - playback available]';
            memo.status = 'done';
            saveVoiceMemos();
            renderVoiceMemos();
        }, 1000);
    }

    function saveVoiceMemos() {
        localStorage.setItem('solobot-voice-memos', JSON.stringify(voiceMemos.slice(0, 50)));
    }

    function deleteVoiceMemo(id) {
        const memo = voiceMemos.find(m => m.id === id);
        if (memo && memo.audioUrl) {
            URL.revokeObjectURL(memo.audioUrl);
        }
        voiceMemos = voiceMemos.filter(m => m.id !== id);
        saveVoiceMemos();
        renderVoiceMemos();
    }

    // ==========================================
    // UI Integration
    // ==========================================

    let voiceSettings = {
        enabled: false,
        audioEnabled: true,
        autoRestart: true,
        wakeWord: 'solo'
    };

    function loadVoiceSettings() {
        const saved = localStorage.getItem('solobot-voice-settings');
        if (saved) {
            voiceSettings = { ...voiceSettings, ...JSON.parse(saved) };
        }
    }

    function saveVoiceSettings() {
        localStorage.setItem('solobot-voice-settings', JSON.stringify(voiceSettings));
    }

    function updateVoiceIndicator(active) {
        const indicator = document.getElementById('voice-indicator');
        if (indicator) {
            indicator.classList.toggle('active', active);
            indicator.title = active ? 'Voice: Listening...' : 'Voice: Idle';
        }
    }

    function updateRecordingIndicator(recording) {
        const indicator = document.getElementById('voice-recording-indicator');
        if (indicator) {
            indicator.classList.toggle('recording', recording);
        }
    }

    function showVoiceHelp() {
        const commands = Object.entries(VOICE_COMMANDS)
            .map(([phrase, cmd]) => `"${phrase}" - ${cmd.description}`)
            .join('\n');
        
        alert(`🎤 Voice Commands (say "${voiceSettings.wakeWord}" first):\n\n${commands}`);
    }

    function renderVoiceMemos() {
        const container = document.getElementById('voice-memos-list');
        if (!container) return;

        if (voiceMemos.length === 0) {
            container.innerHTML = '<div class="empty-state">No voice memos yet</div>';
            return;
        }

        container.innerHTML = voiceMemos.map(memo => `
            <div class="voice-memo-item" data-id="${memo.id}">
                <div class="voice-memo-header">
                    <span class="voice-memo-time">${formatTime(memo.timestamp)}</span>
                    <span class="voice-memo-duration">${formatDuration(memo.duration)}</span>
                </div>
                <div class="voice-memo-controls">
                    <button onclick="playVoiceMemo('${memo.id}')" class="btn btn-ghost" title="Play">
                        ▶️
                    </button>
                    <button onclick="createTaskFromMemo('${memo.id}')" class="btn btn-ghost" title="Create Task">
                        📝
                    </button>
                    <button onclick="deleteVoiceMemo('${memo.id}')" class="btn btn-ghost" style="color: var(--error);" title="Delete">
                        🗑️
                    </button>
                </div>
                ${memo.transcription ? `
                    <div class="voice-memo-transcription">
                        ${memo.status === 'transcribing' ? '<span class="transcribing-indicator">🔄 Transcribing...</span>' : escapeHtml(memo.transcription)}
                    </div>
                ` : ''}
                <audio id="audio-${memo.id}" src="${memo.audioUrl}" preload="none"></audio>
            </div>
        `).join('');
    }

    function formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Global functions for voice memos
    window.playVoiceMemo = function(id) {
        const audio = document.getElementById(`audio-${id}`);
        if (audio) {
            if (audio.paused) {
                audio.play();
            } else {
                audio.pause();
            }
        }
    };

    window.createTaskFromMemo = function(id) {
        const memo = voiceMemos.find(m => m.id === id);
        if (memo) {
            createTaskFromVoice(memo.transcription || 'Voice memo task');
        }
    };

    window.deleteVoiceMemo = deleteVoiceMemo;
    window.toggleVoiceRecognition = toggleVoiceRecognition;
    window.startVoiceMemoRecording = startVoiceMemoRecording;
    window.stopVoiceMemoRecording = stopVoiceMemoRecording;
    window.showVoiceHelp = showVoiceHelp;
    window.playAudioCue = playAudioCue;

    // ==========================================
    // Notification Integration
    // ==========================================

    function setupNotificationSounds() {
        // Hook into addActivity to play sounds
        const originalAddActivity = window.addActivity;
        window.addActivity = function(action, type = 'info') {
            // Play appropriate sound
            if (type === 'success') playAudioCue('success');
            else if (type === 'error') playAudioCue('error');
            else if (type === 'warning') playAudioCue('warning');
            
            return originalAddActivity(action, type);
        };
    }

    // ==========================================
    // Initialization
    // ==========================================

    function init() {
        loadVoiceSettings();
        initVoiceMemoRecorder();
        setupNotificationSounds();
        
        // Add voice indicator to header if not exists
        const header = document.querySelector('.header-actions');
        if (header && !document.getElementById('voice-indicator')) {
            const voiceBtn = document.createElement('button');
            voiceBtn.id = 'voice-indicator';
            voiceBtn.className = 'btn btn-ghost voice-indicator';
            voiceBtn.innerHTML = '🎤';
            voiceBtn.title = 'Voice commands disabled - click to enable';
            voiceBtn.onclick = () => {
                voiceSettings.enabled = !voiceSettings.enabled;
                saveVoiceSettings();
                if (voiceSettings.enabled) {
                    startVoiceRecognition();
                    voiceBtn.classList.add('enabled');
                } else {
                    stopVoiceRecognition();
                    voiceBtn.classList.remove('enabled');
                }
            };
            header.insertBefore(voiceBtn, header.firstChild);
        }

        // Initialize recognition if enabled
        if (voiceSettings.enabled) {
            initVoiceRecognition();
            startVoiceRecognition();
        }

        console.log('[Phase9] Voice Integration initialized');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
