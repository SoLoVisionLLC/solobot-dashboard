// js/phase8-quick-actions.js — Phase 8: Quick Actions
// Inline task creation, quick notes, agent switch, Pomodoro timer

(function() {
    'use strict';

    // ===================
    // QUICK ACTIONS MANAGER
    // ===================
    
    const QuickActions = {
        init() {
            this.setupInlineTaskCreation();
            this.setupQuickNoteInput();
            this.setupAgentSwitcher();
            this.setupPomodoroWidget();
        },
        
        // ===================
        // 1. INLINE TASK CREATION IN KANBAN
        // ===================
        
        setupInlineTaskCreation() {
            // Add inline input to each kanban column
            const columns = ['todo', 'progress', 'done'];
            
            columns.forEach(column => {
                const container = document.getElementById(`${column}-tasks`);
                if (!container) return;
                
                // Check if already has inline input
                if (container.querySelector('.inline-task-input')) return;
                
                const inlineInput = document.createElement('div');
                inlineInput.className = 'inline-task-input';
                inlineInput.innerHTML = `
                    <input type="text" 
                           placeholder="+ Add a task..." 
                           data-column="${column}"
                           class="inline-task-field">
                    <div class="inline-task-actions">
                        <button class="inline-task-btn inline-task-add" title="Add task">✓</button>
                        <button class="inline-task-btn inline-task-cancel" title="Cancel">✕</button>
                    </div>
                `;
                
                container.appendChild(inlineInput);
                
                // Setup handlers
                const input = inlineInput.querySelector('.inline-task-field');
                const addBtn = inlineInput.querySelector('.inline-task-add');
                const cancelBtn = inlineInput.querySelector('.inline-task-cancel');
                
                input.addEventListener('focus', () => {
                    inlineInput.classList.add('active');
                });
                
                input.addEventListener('blur', (e) => {
                    // Delay to allow button clicks
                    setTimeout(() => {
                        if (!input.value.trim()) {
                            inlineInput.classList.remove('active');
                        }
                    }, 200);
                });
                
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.createInlineTask(column, input.value);
                        input.value = '';
                        inlineInput.classList.remove('active');
                    }
                    if (e.key === 'Escape') {
                        input.value = '';
                        inlineInput.classList.remove('active');
                        input.blur();
                    }
                });
                
                addBtn.addEventListener('click', () => {
                    if (input.value.trim()) {
                        this.createInlineTask(column, input.value);
                        input.value = '';
                        inlineInput.classList.remove('active');
                    }
                });
                
                cancelBtn.addEventListener('click', () => {
                    input.value = '';
                    inlineInput.classList.remove('active');
                    input.blur();
                });
            });
        },
        
        createInlineTask(column, title) {
            if (!title.trim()) return;
            
            const task = {
                id: 't' + Date.now(),
                title: title.trim(),
                priority: 1,
                created: Date.now(),
                agent: 'main'
            };
            
            if (!window.state.tasks[column]) {
                window.state.tasks[column] = [];
            }
            
            window.state.tasks[column].unshift(task);
            
            if (typeof addActivity === 'function') {
                addActivity(`Task added: ${task.title}`, 'info');
            }
            
            if (typeof saveState === 'function') {
                saveState('Added task via inline creation');
            }
            
            if (typeof renderTasks === 'function') {
                renderTasks();
            }
            
            showToast('Task added!', 'success');
        },
        
        // ===================
        // 2. QUICK NOTE INPUT WITHOUT MODAL
        // ===================
        
        setupQuickNoteInput() {
            // Enhance the existing notes widget
            const notesWidget = document.querySelector('.bento-notes');
            if (!notesWidget) return;
            
            const content = notesWidget.querySelector('.bento-widget-content');
            if (!content) return;
            
            // Check if already enhanced
            if (content.querySelector('.quick-note-expanded')) return;
            
            const noteInput = content.querySelector('#note-input');
            if (noteInput) {
                // Add expanded input area
                const expandedArea = document.createElement('div');
                expandedArea.className = 'quick-note-expanded';
                expandedArea.style.display = 'none';
                expandedArea.innerHTML = `
                    <textarea class="quick-note-textarea" 
                              placeholder="Write a longer note..."
                              rows="3"></textarea>
                    <div class="quick-note-actions">
                        <span class="quick-note-hint">Shift+Enter for new line</span>
                        <button class="quick-note-save">Save Note</button>
                    </div>
                `;
                
                noteInput.parentNode.after(expandedArea);
                
                // Focus handler to expand
                noteInput.addEventListener('focus', () => {
                    expandedArea.style.display = 'block';
                    const textarea = expandedArea.querySelector('.quick-note-textarea');
                    textarea.value = noteInput.value;
                    textarea.focus();
                    noteInput.style.display = 'none';
                });
                
                // Textarea handlers
                const textarea = expandedArea.querySelector('.quick-note-textarea');
                const saveBtn = expandedArea.querySelector('.quick-note-save');
                
                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.saveQuickNote(textarea.value);
                        this.collapseNoteInput(noteInput, expandedArea, textarea);
                    }
                    if (e.key === 'Escape') {
                        this.collapseNoteInput(noteInput, expandedArea, textarea);
                    }
                });
                
                saveBtn.addEventListener('click', () => {
                    this.saveQuickNote(textarea.value);
                    this.collapseNoteInput(noteInput, expandedArea, textarea);
                });
                
                // Collapse on outside click
                document.addEventListener('click', (e) => {
                    if (!expandedArea.contains(e.target) && e.target !== noteInput) {
                        if (!textarea.value.trim()) {
                            this.collapseNoteInput(noteInput, expandedArea, textarea);
                        }
                    }
                });
            }
        },
        
        collapseNoteInput(input, expandedArea, textarea) {
            expandedArea.style.display = 'none';
            input.style.display = 'block';
            textarea.value = '';
            input.value = '';
        },
        
        saveQuickNote(text) {
            if (!text.trim()) return;
            
            const note = {
                id: 'n' + Date.now(),
                text: text.trim(),
                time: Date.now(),
                seen: false
            };
            
            if (!window.state.notes) window.state.notes = [];
            window.state.notes.unshift(note);
            
            if (typeof addActivity === 'function') {
                addActivity('Note added', 'info');
            }
            
            if (typeof saveState === 'function') {
                saveState('Added note via quick input');
            }
            
            if (typeof renderNotes === 'function') {
                renderNotes();
            }
            
            showToast('Note saved!', 'success');
        },
        
        // ===================
        // 3. ONE-CLICK AGENT SWITCH
        // ===================
        
        setupAgentSwitcher() {
            // Add to header or sidebar
            const header = document.querySelector('.header-actions');
            if (!header) return;
            
            // Check if already exists
            if (header.querySelector('.quick-agent-switcher')) return;
            
            const switcher = document.createElement('div');
            switcher.className = 'quick-agent-switcher';
            switcher.innerHTML = `
                <button class="quick-agent-btn active" data-agent="main" title="Main Agent">
                    <span class="agent-dot" style="background: #ef4444;"></span>
                    <span>Main</span>
                </button>
                <button class="quick-agent-btn" data-agent="dev" title="DEV Agent">
                    <span class="agent-dot" style="background: #3b82f6;"></span>
                    <span>DEV</span>
                </button>
                <button class="quick-agent-btn" data-agent="coo" title="COO Agent">
                    <span class="agent-dot" style="background: #22c55e;"></span>
                    <span>COO</span>
                </button>
            `;
            
            header.insertBefore(switcher, header.firstChild);
            
            // Click handlers
            switcher.querySelectorAll('.quick-agent-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const agent = btn.dataset.agent;
                    this.switchToAgent(agent);
                    
                    // Update active state
                    switcher.querySelectorAll('.quick-agent-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.agent === agent);
                    });
                });
            });
            
            // Update active state based on current session
            this.updateAgentSwitcherState();
        },
        
        updateAgentSwitcherState() {
            const rawSessionKey = window.GATEWAY_CONFIG?.sessionKey || localStorage.getItem('gateway_session') || 'agent:main:main';
            const sessionKey = (rawSessionKey === 'main') ? 'agent:main:main' : rawSessionKey;
            let currentAgent = 'main';
            
            if (sessionKey.includes('dev')) currentAgent = 'dev';
            else if (sessionKey.includes('coo')) currentAgent = 'coo';
            
            document.querySelectorAll('.quick-agent-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.agent === currentAgent);
            });
        },
        
        switchToAgent(agent) {
            if (typeof switchToSession === 'function') {
                const sessionKey = `agent:${agent}:main`;
                switchToSession(sessionKey);
                showToast(`Switched to ${agent.toUpperCase()}`, 'success');
            } else {
                // Fallback: just show toast
                showToast(`Agent switch: ${agent.toUpperCase()}`, 'info');
            }
        },
        
        // ===================
        // 4. BUILT-IN POMODORO TIMER
        // ===================
        
        setupPomodoroWidget() {
            // Check if already exists as a widget
            if (document.querySelector('.bento-pomodoro')) return;
            
            // Find or create Pomodoro widget
            const widget = document.createElement('div');
            widget.className = 'bento-widget bento-pomodoro';
            widget.innerHTML = `
                <div class="bento-widget-header">
                    <div class="bento-widget-title">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Focus Timer
                    </div>
                </div>
                <div class="bento-widget-content">
                    <div class="pomodoro-container">
                        <div class="pomodoro-timer">
                            <svg class="pomodoro-ring" viewBox="0 0 100 100">
                                <circle class="pomodoro-ring-bg" cx="50" cy="50" r="45"/>
                                <circle class="pomodoro-ring-progress" cx="50" cy="50" r="45"/>
                            </svg>
                            <div class="pomodoro-time" id="pomodoro-display">25:00</div>
                            <div class="pomodoro-label" id="pomodoro-label">Focus</div>
                        </div>
                        <div class="pomodoro-controls">
                            <button id="pomodoro-toggle" class="pomodoro-btn primary">
                                <span id="pomodoro-play-icon">▶</span>
                                <span id="pomodoro-pause-icon" style="display:none;">⏸</span>
                            </button>
                            <button id="pomodoro-reset" class="pomodoro-btn" title="Reset">↺</button>
                            <button id="pomodoro-skip" class="pomodoro-btn" title="Skip">⏭</button>
                        </div>
                        <div class="pomodoro-stats">
                            <span id="pomodoro-sessions">0 sessions today</span>
                        </div>
                        <div class="pomodoro-presets">
                            <button data-min="25" class="preset-btn active">25m</button>
                            <button data-min="15" class="preset-btn">15m</button>
                            <button data-min="5" class="preset-btn">5m</button>
                        </div>
                    </div>
                </div>
            `;
            
            // Insert before quick stats or at end of grid
            const quickStats = document.querySelector('.bento-quick-stats');
            if (quickStats && quickStats.parentNode) {
                quickStats.parentNode.insertBefore(widget, quickStats);
            } else {
                const grid = document.querySelector('.bento-grid');
                if (grid) grid.appendChild(widget);
            }
            
            // Initialize Pomodoro logic
            this.initPomodoroLogic();
        },
        
        initPomodoroLogic() {
            // Pomodoro state
            const state = {
                timeLeft: 25 * 60,
                totalTime: 25 * 60,
                running: false,
                isBreak: false,
                sessions: parseInt(localStorage.getItem('pomodoroSessions') || '0'),
                lastDate: localStorage.getItem('pomodoroDate') || new Date().toDateString()
            };
            
            // Reset if new day
            if (state.lastDate !== new Date().toDateString()) {
                state.sessions = 0;
                localStorage.setItem('pomodoroSessions', '0');
                localStorage.setItem('pomodoroDate', new Date().toDateString());
            }
            
            let interval = null;
            
            const display = document.getElementById('pomodoro-display');
            const label = document.getElementById('pomodoro-label');
            const playIcon = document.getElementById('pomodoro-play-icon');
            const pauseIcon = document.getElementById('pomodoro-pause-icon');
            const ring = document.querySelector('.pomodoro-ring-progress');
            const sessionsEl = document.getElementById('pomodoro-sessions');
            
            const updateDisplay = () => {
                const mins = Math.floor(state.timeLeft / 60);
                const secs = state.timeLeft % 60;
                display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                
                // Update ring
                const progress = (state.totalTime - state.timeLeft) / state.totalTime;
                const circumference = 2 * Math.PI * 45;
                const offset = circumference - (progress * circumference);
                ring.style.strokeDashoffset = offset;
                
                // Update sessions text
                sessionsEl.textContent = `${state.sessions} session${state.sessions !== 1 ? 's' : ''} today`;
                
                // Update label
                label.textContent = state.isBreak ? 'Break' : 'Focus';
                label.className = state.isBreak ? 'pomodoro-label break' : 'pomodoro-label';
            };
            
            const toggle = () => {
                if (state.running) {
                    clearInterval(interval);
                    state.running = false;
                    playIcon.style.display = 'block';
                    pauseIcon.style.display = 'none';
                } else {
                    state.running = true;
                    playIcon.style.display = 'none';
                    pauseIcon.style.display = 'block';
                    
                    interval = setInterval(() => {
                        state.timeLeft--;
                        updateDisplay();
                        
                        if (state.timeLeft <= 0) {
                            complete();
                        }
                    }, 1000);
                }
            };
            
            const complete = () => {
                clearInterval(interval);
                state.running = false;
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
                
                if (!state.isBreak) {
                    // Completed focus session
                    state.sessions++;
                    localStorage.setItem('pomodoroSessions', state.sessions.toString());
                    showToast(`🎉 Focus session complete! (${state.sessions} today)`, 'success');
                    
                    // Start break
                    state.isBreak = true;
                    state.totalTime = 5 * 60;
                    state.timeLeft = state.totalTime;
                } else {
                    // Completed break
                    showToast('☕ Break over! Ready to focus?', 'info');
                    state.isBreak = false;
                    state.totalTime = 25 * 60;
                    state.timeLeft = state.totalTime;
                }
                
                updateDisplay();
            };
            
            const reset = () => {
                clearInterval(interval);
                state.running = false;
                state.isBreak = false;
                state.totalTime = 25 * 60;
                state.timeLeft = state.totalTime;
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
                updateDisplay();
            };
            
            const skip = () => {
                clearInterval(interval);
                state.running = false;
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
                
                if (state.isBreak) {
                    state.isBreak = false;
                    state.totalTime = 25 * 60;
                } else {
                    state.isBreak = true;
                    state.totalTime = 5 * 60;
                }
                state.timeLeft = state.totalTime;
                updateDisplay();
            };
            
            // Event listeners
            document.getElementById('pomodoro-toggle')?.addEventListener('click', toggle);
            document.getElementById('pomodoro-reset')?.addEventListener('click', reset);
            document.getElementById('pomodoro-skip')?.addEventListener('click', skip);
            
            // Preset buttons
            document.querySelectorAll('.pomodoro-presets .preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (state.running) return;
                    
                    document.querySelectorAll('.pomodoro-presets .preset-btn').forEach(b => {
                        b.classList.remove('active');
                    });
                    btn.classList.add('active');
                    
                    const mins = parseInt(btn.dataset.min);
                    state.totalTime = mins * 60;
                    state.timeLeft = state.totalTime;
                    state.isBreak = mins < 15;
                    updateDisplay();
                });
            });
            
            // Initial display
            updateDisplay();
            
            // Keyboard shortcut (Ctrl/Cmd + Shift + T)
            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
                    e.preventDefault();
                    toggle();
                }
            });
        }
    };
    
    // ===================
    // EXPOSE GLOBALLY
    // ===================
    
    window.QuickActions = QuickActions;
    
    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => QuickActions.init(), 500);
        console.log('[Phase 8] Quick Actions initialized');
    });

})();