const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATE_FILE = './data/state.json';
const DEFAULT_STATE_FILE = './data/default-state.json';
const MEMORY_DIR = './openclaw/workspace';  // Mounted from OpenClaw's Docker volume

// Ensure data directory exists
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// Load or initialize state
let state = {};
try {
  if (fs.existsSync(STATE_FILE)) {
    // Use existing state (from persistent volume)
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log('Loaded existing state from persistent storage');
  } else if (fs.existsSync(DEFAULT_STATE_FILE)) {
    // First run with volume - copy default state
    state = JSON.parse(fs.readFileSync(DEFAULT_STATE_FILE, 'utf8'));
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('Initialized state from default template');
  } else {
    console.log('Starting with fresh state');
  }
} catch (e) {
  console.log('Error loading state, starting fresh:', e.message);
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
  
  // ===================
  // MEMORY FILES API (reads from mounted OpenClaw workspace)
  // ===================
  
  // List all memory files
  if (url.pathname === '/api/memory' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        return res.end(JSON.stringify({ files: [], error: 'Memory directory not mounted' }));
      }
      
      const files = [];
      const items = fs.readdirSync(MEMORY_DIR);
      
      for (const item of items) {
        const itemPath = path.join(MEMORY_DIR, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isFile() && item.endsWith('.md')) {
          files.push({
            name: item,
            path: item,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            type: 'file'
          });
        } else if (stat.isDirectory() && item === 'memory') {
          // Also list files in memory/ subdirectory
          const subItems = fs.readdirSync(itemPath);
          for (const subItem of subItems) {
            const subPath = path.join(itemPath, subItem);
            const subStat = fs.statSync(subPath);
            if (subStat.isFile() && subItem.endsWith('.md')) {
              files.push({
                name: subItem,
                path: `memory/${subItem}`,
                size: subStat.size,
                modified: subStat.mtime.toISOString(),
                type: 'file',
                category: 'Daily Logs'
              });
            }
          }
        }
      }
      
      return res.end(JSON.stringify({ files }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  // Get a specific memory file
  if (url.pathname.startsWith('/api/memory/') && req.method === 'GET') {
    const filename = decodeURIComponent(url.pathname.replace('/api/memory/', ''));
    const filePath = path.join(MEMORY_DIR, filename);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(path.resolve(MEMORY_DIR))) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }
    
    try {
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'File not found' }));
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        name: filename,
        content: content,
        modified: stat.mtime.toISOString(),
        size: stat.size
      }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  // Update a memory file
  if (url.pathname.startsWith('/api/memory/') && req.method === 'PUT') {
    const filename = decodeURIComponent(url.pathname.replace('/api/memory/', ''));
    const filePath = path.join(MEMORY_DIR, filename);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(path.resolve(MEMORY_DIR))) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        
        // Ensure directory exists for nested paths
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, content, 'utf8');
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, saved: filename }));
      } catch (e) {
        res.writeHead(500);
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
