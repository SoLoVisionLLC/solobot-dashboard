const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATE_FILE = './data/state.json';

// Ensure data directory exists
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// Load or initialize state
let state = {};
try {
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
} catch (e) {
  console.log('Starting with fresh state');
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  
  // API Routes
  if (url.pathname === '/api/state') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(state));
  }
  
  if (url.pathname === '/api/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        state = { ...state, ...update, lastSync: Date.now() };
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Append chat messages (doesn't replace existing)
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { messages } = JSON.parse(body);
        if (!state.chat) state.chat = { messages: [] };
        if (Array.isArray(messages)) {
          // Append new messages, avoid duplicates by id
          const existingIds = new Set(state.chat.messages.map(m => m.id));
          const newMsgs = messages.filter(m => !existingIds.has(m.id));
          state.chat.messages.push(...newMsgs);
          // Keep last 200 messages
          if (state.chat.messages.length > 200) {
            state.chat.messages = state.chat.messages.slice(-200);
          }
        }
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, added: messages?.length || 0 }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Append activity logs
  if (url.pathname === '/api/activity' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { logs } = JSON.parse(body);
        if (!state.activity) state.activity = { logs: [] };
        if (Array.isArray(logs)) {
          state.activity.logs.unshift(...logs);
          // Keep last 100 activity logs
          if (state.activity.logs.length > 100) {
            state.activity.logs = state.activity.logs.slice(0, 100);
          }
        }
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(fs.readFileSync('./index.html'));
  }
  
  // Serve static files
  let filePath = '.' + url.pathname;
  const ext = path.extname(filePath);
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    return res.end(fs.readFileSync(filePath));
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`SoLoBot Dashboard running on port ${PORT}`);
});
