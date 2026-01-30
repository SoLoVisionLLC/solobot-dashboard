#!/usr/bin/env node
/**
 * Notion Sync for SoLoVision Dashboard
 * 
 * Syncs tasks and data between Notion and the dashboard
 * 
 * Setup:
 *   1. Create integration at https://www.notion.so/my-integrations
 *   2. Set NOTION_TOKEN environment variable
 *   3. Share databases with the integration
 * 
 * Usage:
 *   node notion-sync.js databases           # List accessible databases
 *   node notion-sync.js tasks <db_id>       # Fetch tasks from a database
 *   node notion-sync.js sync <db_id>        # Sync tasks to dashboard
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATE_FILE = path.join(__dirname, '..', 'data', 'state.json');
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_VERSION = '2022-06-28';

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
}

function notionAPI(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        if (!NOTION_TOKEN) {
            reject(new Error('NOTION_TOKEN not set. Get one from https://www.notion.so/my-integrations'));
            return;
        }

        const options = {
            hostname: 'api.notion.com',
            path: `/v1${endpoint}`,
            method: method,
            headers: {
                'Authorization': `Bearer ${NOTION_TOKEN}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.object === 'error') {
                        reject(new Error(parsed.message));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        
        req.on('error', reject);
        
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function listDatabases() {
    try {
        const response = await notionAPI('/search', 'POST', {
            filter: { property: 'object', value: 'database' }
        });
        
        if (response.results && response.results.length > 0) {
            console.log('Accessible databases:\n');
            response.results.forEach(db => {
                const title = db.title?.[0]?.plain_text || 'Untitled';
                console.log(`  ${title}`);
                console.log(`  ID: ${db.id}`);
                console.log(`  URL: ${db.url}\n`);
            });
        } else {
            console.log('No databases found. Make sure to share databases with your integration.');
        }
        
        return response.results || [];
    } catch (e) {
        console.error('Error listing databases:', e.message);
        return [];
    }
}

async function fetchTasks(databaseId) {
    try {
        const response = await notionAPI(`/databases/${databaseId}/query`, 'POST', {
            page_size: 100
        });
        
        if (!response.results) {
            console.log('No tasks found');
            return [];
        }
        
        const tasks = response.results.map(page => {
            const props = page.properties;
            
            // Try to extract common task properties
            let title = 'Untitled';
            let status = 'todo';
            let priority = 1;
            
            // Find title (usually "Name" or "Title" property)
            for (const [key, value] of Object.entries(props)) {
                if (value.type === 'title' && value.title?.[0]) {
                    title = value.title[0].plain_text;
                    break;
                }
            }
            
            // Find status
            if (props.Status?.select?.name) {
                const s = props.Status.select.name.toLowerCase();
                if (s.includes('progress') || s.includes('doing')) status = 'progress';
                else if (s.includes('done') || s.includes('complete')) status = 'done';
                else status = 'todo';
            }
            
            // Find priority
            if (props.Priority?.select?.name) {
                const p = props.Priority.select.name.toLowerCase();
                if (p.includes('high') || p.includes('urgent') || p === 'p0') priority = 0;
                else if (p.includes('low') || p === 'p2') priority = 2;
                else priority = 1;
            }
            
            return {
                id: 'notion_' + page.id.replace(/-/g, '').substring(0, 8),
                notionId: page.id,
                title,
                status,
                priority,
                url: page.url,
                created: new Date(page.created_time).getTime()
            };
        });
        
        console.log(`Found ${tasks.length} tasks:\n`);
        tasks.forEach(t => {
            console.log(`  [${t.status}] ${t.title} (P${t.priority})`);
        });
        
        return tasks;
    } catch (e) {
        console.error('Error fetching tasks:', e.message);
        return [];
    }
}

async function syncTasks(databaseId) {
    const state = loadState();
    const notionTasks = await fetchTasks(databaseId);
    
    if (notionTasks.length === 0) {
        console.log('No tasks to sync');
        return;
    }
    
    // Clear existing Notion tasks and add fresh ones
    const clearNotionTasks = (arr) => arr.filter(t => !t.id.startsWith('notion_'));
    
    state.tasks.todo = clearNotionTasks(state.tasks.todo);
    state.tasks.progress = clearNotionTasks(state.tasks.progress);
    state.tasks.done = clearNotionTasks(state.tasks.done);
    
    // Add Notion tasks to appropriate columns
    notionTasks.forEach(task => {
        const taskObj = {
            id: task.id,
            title: task.title,
            priority: task.priority,
            created: task.created,
            notionUrl: task.url
        };
        
        if (task.status === 'done') {
            taskObj.completed = Date.now();
            state.tasks.done.push(taskObj);
        } else if (task.status === 'progress') {
            taskObj.started = Date.now();
            state.tasks.progress.push(taskObj);
        } else {
            state.tasks.todo.push(taskObj);
        }
    });
    
    // Log sync activity
    state.activity.push({
        time: Date.now(),
        action: `Synced ${notionTasks.length} tasks from Notion`,
        type: 'info'
    });
    
    saveState(state);
    console.log(`\nSynced ${notionTasks.length} tasks to dashboard`);
}

// Main
const [,, command, arg] = process.argv;

switch (command) {
    case 'databases':
    case 'list':
        listDatabases();
        break;
    case 'tasks':
        if (!arg) {
            console.log('Usage: node notion-sync.js tasks <database_id>');
        } else {
            fetchTasks(arg);
        }
        break;
    case 'sync':
        if (!arg) {
            console.log('Usage: node notion-sync.js sync <database_id>');
        } else {
            syncTasks(arg);
        }
        break;
    default:
        console.log('Notion Sync for SoLoVision Dashboard\n');
        console.log('Usage:');
        console.log('  node notion-sync.js databases         List accessible databases');
        console.log('  node notion-sync.js tasks <db_id>     Fetch tasks from database');
        console.log('  node notion-sync.js sync <db_id>      Sync tasks to dashboard');
        console.log('\nSet NOTION_TOKEN environment variable first.');
}
