const fs = require('fs');
const https = require('https');
const path = require('path');
const { appendGuardedNotionProperties } = require('./lib/notion-task-guardrails');

// Configuration
const STATE_FILE = '/home/solo/.openclaw/workspace/repos/solobot-dashboard/data/state.json';
const NOTION_DATABASE_ID = '8e85701f-81a6-490f-a859-5c0bc9e52827';
const NOTION_API_KEY = process.env.NOTION_API_KEY;

if (!NOTION_API_KEY) {
    console.error('Error: NOTION_API_KEY environment variable is required.');
    process.exit(1);
}

// Enforcement point: all Task Board page creation goes through
// lib/notion-task-guardrails.js so active Notion tasks always get Assigned Agent
// and a Due Date when an explicit date or SLA-derived due date is available.

// Helper to delay (rate limit protection)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Notion API Client
function createNotionPage(task, status) {
    return new Promise((resolve, reject) => {
        const payload = {
            parent: { database_id: NOTION_DATABASE_ID },
            properties: {
                'Task': {
                    title: [
                        { text: { content: task.title || 'Untitled Task' } }
                    ]
                }
            }
        };

        let guard;
        try {
            guard = appendGuardedNotionProperties(payload.properties, task, status);
        } catch (e) {
            console.error(`[Notion Guardrail] Refusing to create active Task Board item: ${e.message}`);
            resolve(false);
            return;
        }

        if (guard.appliedDefaults.assignedAgent) {
            console.warn(`[Notion Guardrail] Defaulted Assigned Agent to ${guard.notionAgent} for "${task.title || 'Untitled Task'}"`);
        }
        if (guard.appliedDefaults.dueDate) {
            console.warn(`[Notion Guardrail] Applied SLA Due Date ${guard.dueDate} for "${task.title || 'Untitled Task'}"`);
        }

        if (task.description) {
            payload.properties['Notes'] = {
                rich_text: [
                    { text: { content: task.description.substring(0, 2000) } }
                ]
            };
        }

        const data = JSON.stringify(payload);

        const options = {
            hostname: 'api.notion.com',
            path: '/v1/pages',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_API_KEY}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(responseBody));
                } else {
                    // Log error but resolve false to continue
                    console.error(`Error ${res.statusCode}: ${responseBody}`);
                    resolve(false);
                }
            });
        });

        req.on('error', (e) => {
            console.error(e);
            resolve(false);
        });
        req.write(data);
        req.end();
    });
}

async function migrate() {
    console.log('Starting migration...');
    
    if (!fs.existsSync(STATE_FILE)) {
        console.error('State file not found:', STATE_FILE);
        process.exit(1);
    }
    
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const tasks = state.tasks || { todo: [], progress: [], done: [] };
    
    const allTasks = [
        ...(tasks.todo || []).map(t => ({ ...t, _status: 'todo' })),
        ...(tasks.progress || []).map(t => ({ ...t, _status: 'progress' })),
        // Limit 'done' tasks to recent ones if there are too many, or migrate all.
        // For now, let's migrate all but be aware it might take time.
        ...(tasks.done || []).map(t => ({ ...t, _status: 'done' }))
    ];

    console.log(`Found ${allTasks.length} tasks to migrate.`);
    
    let successCount = 0;
    let failCount = 0;

    for (const [i, task] of allTasks.entries()) {
        process.stdout.write(`[${i+1}/${allTasks.length}] ${task.title.substring(0, 30)}... `);
        const success = await createNotionPage(task, task._status);
        if (success) {
            console.log('✅');
            successCount++;
        } else {
            console.log('❌');
            failCount++;
        }
        await delay(350); // Rate limit buffer
    }

    console.log(`\nDone! Success: ${successCount}, Failed: ${failCount}`);
}

migrate();