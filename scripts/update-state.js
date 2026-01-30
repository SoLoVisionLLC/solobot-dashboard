#!/usr/bin/env node
/**
 * SoLoVision Dashboard State Manager
 * 
 * CLI tool for SoLoBot to update dashboard state
 * 
 * Usage:
 *   node update-state.js status working "Building feature X"
 *   node update-state.js task add "New task title" 1
 *   node update-state.js task move t1 done
 *   node update-state.js note add "Note text here"
 *   node update-state.js note seen n1
 *   node update-state.js activity "Did something important" success
 *   node update-state.js heartbeat
 *   node update-state.js subagent "Researching topic X"
 *   node update-state.js subagent clear
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
        console.error('Error loading state:', e.message);
        process.exit(1);
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('State updated successfully');
}

function generateId(prefix) {
    return prefix + Date.now();
}

const commands = {
    status: (args, state) => {
        const [newStatus, taskName] = args;
        state.status = newStatus || 'idle';
        state.currentTask = taskName || null;
        if (newStatus === 'working' || newStatus === 'thinking') {
            state.activity.push({
                time: Date.now(),
                action: `Status: ${newStatus}${taskName ? ` - ${taskName}` : ''}`,
                type: 'info'
            });
        }
        return state;
    },

    task: (args, state) => {
        const [action, ...rest] = args;
        
        if (action === 'add') {
            const [title, priority = '1'] = rest;
            const task = {
                id: generateId('t'),
                title,
                priority: parseInt(priority),
                created: Date.now()
            };
            state.tasks.todo.push(task);
            state.activity.push({
                time: Date.now(),
                action: `Task added: ${title}`,
                type: 'info'
            });
        } else if (action === 'move') {
            const [taskId, toColumn] = rest;
            let task = null;
            let fromColumn = null;
            
            for (const col of ['todo', 'progress', 'done']) {
                const idx = state.tasks[col].findIndex(t => t.id === taskId);
                if (idx !== -1) {
                    task = state.tasks[col].splice(idx, 1)[0];
                    fromColumn = col;
                    break;
                }
            }
            
            if (task) {
                if (toColumn === 'progress') task.started = Date.now();
                if (toColumn === 'done') task.completed = Date.now();
                state.tasks[toColumn].push(task);
                state.activity.push({
                    time: Date.now(),
                    action: `Task moved: "${task.title}" → ${toColumn}`,
                    type: 'success'
                });
            } else {
                console.error('Task not found:', taskId);
            }
        } else if (action === 'pickup') {
            // Pick up the highest priority task from todo
            if (state.tasks.todo.length > 0) {
                state.tasks.todo.sort((a, b) => a.priority - b.priority);
                const task = state.tasks.todo.shift();
                task.started = Date.now();
                state.tasks.progress.push(task);
                state.status = 'working';
                state.currentTask = task.title;
                state.activity.push({
                    time: Date.now(),
                    action: `Picked up task: "${task.title}"`,
                    type: 'info'
                });
            } else {
                console.log('No tasks in todo');
            }
        } else if (action === 'complete') {
            const [taskId] = rest;
            const idx = state.tasks.progress.findIndex(t => t.id === taskId);
            if (idx !== -1) {
                const task = state.tasks.progress.splice(idx, 1)[0];
                task.completed = Date.now();
                state.tasks.done.push(task);
                state.status = 'idle';
                state.currentTask = null;
                state.activity.push({
                    time: Date.now(),
                    action: `Completed: "${task.title}"`,
                    type: 'success'
                });
            }
        }
        return state;
    },

    note: (args, state) => {
        const [action, ...rest] = args;
        
        if (action === 'add') {
            const text = rest.join(' ');
            state.notes.unshift({
                id: generateId('n'),
                text,
                created: Date.now(),
                seen: false
            });
        } else if (action === 'seen') {
            const [noteId] = rest;
            const note = state.notes.find(n => n.id === noteId);
            if (note) {
                note.seen = true;
                note.seenAt = Date.now();
                state.activity.push({
                    time: Date.now(),
                    action: `Processed note: "${note.text.substring(0, 30)}..."`,
                    type: 'info'
                });
            }
        } else if (action === 'process-all') {
            const unseen = state.notes.filter(n => !n.seen);
            unseen.forEach(note => {
                note.seen = true;
                note.seenAt = Date.now();
            });
            if (unseen.length > 0) {
                state.activity.push({
                    time: Date.now(),
                    action: `Processed ${unseen.length} note(s)`,
                    type: 'info'
                });
            }
            console.log(`Processed ${unseen.length} notes`);
            return { state, notes: unseen };
        }
        return state;
    },

    activity: (args, state) => {
        const [action, type = 'info'] = args;
        state.activity.push({
            time: Date.now(),
            action,
            type
        });
        // Keep only last 100 entries
        if (state.activity.length > 100) {
            state.activity = state.activity.slice(-100);
        }
        return state;
    },

    heartbeat: (args, state) => {
        state.lastHeartbeat = Date.now();
        state.activity.push({
            time: Date.now(),
            action: 'Heartbeat: Dashboard sync',
            type: 'info'
        });
        return state;
    },

    subagent: (args, state) => {
        const [task] = args;
        if (task === 'clear') {
            state.subagent = null;
        } else {
            state.subagent = task;
            state.activity.push({
                time: Date.now(),
                action: `Sub-agent spawned: ${task}`,
                type: 'info'
            });
        }
        return state;
    },

    doc: (args, state) => {
        const [action, ...rest] = args;
        if (action === 'add') {
            const [name, type, url] = rest;
            state.docs.unshift({
                id: generateId('d'),
                name,
                type: type || 'doc',
                url,
                updated: Date.now()
            });
            state.activity.push({
                time: Date.now(),
                action: `Document added: ${name}`,
                type: 'info'
            });
        }
        return state;
    },

    product: (args, state) => {
        const [product, status] = args;
        const key = product.toLowerCase().replace('solo', 'solo');
        if (state.products[key]) {
            state.products[key].status = status;
            state.products[key].lastUpdate = new Date().toISOString().split('T')[0];
        }
        return state;
    },

    get: (args, state) => {
        const [what] = args;
        if (what === 'notes') {
            const unseen = state.notes.filter(n => !n.seen);
            console.log(JSON.stringify(unseen, null, 2));
            return null; // Don't save
        } else if (what === 'tasks') {
            console.log(JSON.stringify(state.tasks.todo, null, 2));
            return null;
        } else if (what === 'status') {
            console.log(JSON.stringify({
                status: state.status,
                currentTask: state.currentTask,
                subagent: state.subagent,
                lastHeartbeat: state.lastHeartbeat
            }, null, 2));
            return null;
        }
        return null;
    }
};

// Main
const [,, command, ...args] = process.argv;

if (!command || !commands[command]) {
    console.log('Available commands: status, task, note, activity, heartbeat, subagent, doc, product, get');
    process.exit(1);
}

const state = loadState();
const result = commands[command](args, state);

if (result && result !== null) {
    saveState(typeof result.state !== 'undefined' ? result.state : result);
}
