const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATE_FILE = './data/state.json';
const DEFAULT_STATE_FILE = './data/default-state.json';
const MEMORY_DIR = './memory';  // Mounted from OpenClaw workspace via Coolify
const VERSIONS_DIR = './data/versions';  // Version history storage
const META_FILE = './data/file-meta.json';  // Track bot updates

// Ensure data directories exist
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(VERSIONS_DIR)) fs.mkdirSync(VERSIONS_DIR, { recursive: true });

// Load or initialize file metadata (tracks bot updates)
let fileMeta = {};
try {
  if (fs.existsSync(META_FILE)) {
    fileMeta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  }
} catch (e) {
  console.log('Starting with fresh file metadata');
}

function saveFileMeta() {
  fs.writeFileSync(META_FILE, JSON.stringify(fileMeta, null, 2));
}

// Create a version backup of a file
function createVersion(filename, content) {
  const timestamp = Date.now();
  const safeFilename = filename.replace(/\//g, '__');
  const versionPath = path.join(VERSIONS_DIR, `${safeFilename}.${timestamp}`);
  fs.writeFileSync(versionPath, content, 'utf8');
  
  // Keep only last 20 versions per file
  const prefix = `${safeFilename}.`;
  const versions = fs.readdirSync(VERSIONS_DIR)
    .filter(f => f.startsWith(prefix))
    .sort()
    .reverse();
  
  if (versions.length > 20) {
    versions.slice(20).forEach(v => {
      fs.unlinkSync(path.join(VERSIONS_DIR, v));
    });
  }
  
  return timestamp;
}

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
  
  // List all memory files (with bot-update metadata)
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
          const meta = fileMeta[item] || {};
          files.push({
            name: item,
            path: item,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            type: 'file',
            botUpdated: meta.botUpdated || false,
            botUpdatedAt: meta.botUpdatedAt || null,
            acknowledged: meta.acknowledged || false
          });
        } else if (stat.isDirectory() && item === 'memory') {
          // Also list files in memory/ subdirectory
          const subItems = fs.readdirSync(itemPath);
          for (const subItem of subItems) {
            const subPath = path.join(itemPath, subItem);
            const subStat = fs.statSync(subPath);
            if (subStat.isFile() && subItem.endsWith('.md')) {
              const filePath = `memory/${subItem}`;
              const meta = fileMeta[filePath] || {};
              files.push({
                name: subItem,
                path: filePath,
                size: subStat.size,
                modified: subStat.mtime.toISOString(),
                type: 'file',
                category: 'Daily Logs',
                botUpdated: meta.botUpdated || false,
                botUpdatedAt: meta.botUpdatedAt || null,
                acknowledged: meta.acknowledged || false
              });
            }
          }
        }
      }
      
      return res.end(JSON.stringify({ files, meta: fileMeta }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  // Get file metadata (bot updates)
  if (url.pathname === '/api/memory-meta' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(fileMeta));
  }
  
  // Acknowledge bot update (clear badge)
  if (url.pathname === '/api/memory-meta/acknowledge' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filename } = JSON.parse(body);
        if (fileMeta[filename]) {
          fileMeta[filename].acknowledged = true;
          fileMeta[filename].botUpdated = false;
          saveFileMeta();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Get a specific memory file
  if (url.pathname.startsWith('/api/memory/') && req.method === 'GET') {
    const filename = decodeURIComponent(url.pathname.replace('/api/memory/', ''));
    const filePath = path.resolve(MEMORY_DIR, filename);
    const memoryDirResolved = path.resolve(MEMORY_DIR);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(memoryDirResolved)) {
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
  
  // Update a memory file (with version history)
  if (url.pathname.startsWith('/api/memory/') && req.method === 'PUT') {
    const filename = decodeURIComponent(url.pathname.replace('/api/memory/', ''));
    const filePath = path.resolve(MEMORY_DIR, filename);
    const memoryDirResolved = path.resolve(MEMORY_DIR);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(memoryDirResolved)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { content, updatedBy } = JSON.parse(body);
        
        // Ensure directory exists for nested paths
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        // Create version backup if file exists
        let versionTimestamp = null;
        if (fs.existsSync(filePath)) {
          const oldContent = fs.readFileSync(filePath, 'utf8');
          versionTimestamp = createVersion(filename, oldContent);
        }
        
        // Write new content
        fs.writeFileSync(filePath, content, 'utf8');
        
        // Track if bot made the update
        if (updatedBy === 'bot') {
          fileMeta[filename] = {
            botUpdated: true,
            botUpdatedAt: Date.now(),
            acknowledged: false
          };
          saveFileMeta();
        } else if (updatedBy === 'user') {
          // User edit clears the bot-updated flag
          if (fileMeta[filename]) {
            fileMeta[filename].botUpdated = false;
            fileMeta[filename].acknowledged = true;
            saveFileMeta();
          }
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, saved: filename, versionCreated: versionTimestamp }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // List versions for a file
  if (url.pathname.match(/^\/api\/memory\/(.+)\/versions$/) && req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/memory\/(.+)\/versions$/);
    const filename = decodeURIComponent(match[1]);
    const safeFilename = filename.replace(/\//g, '__');
    
    res.setHeader('Content-Type', 'application/json');
    try {
      const prefix = `${safeFilename}.`;
      const versions = fs.readdirSync(VERSIONS_DIR)
        .filter(f => f.startsWith(prefix))
        .map(f => {
          const timestamp = parseInt(f.replace(prefix, ''));
          const versionPath = path.join(VERSIONS_DIR, f);
          const stat = fs.statSync(versionPath);
          return {
            timestamp,
            date: new Date(timestamp).toISOString(),
            size: stat.size,
            filename: f
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp);
      
      return res.end(JSON.stringify({ versions }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  // Get a specific version content
  if (url.pathname.match(/^\/api\/memory\/(.+)\/versions\/(\d+)$/) && req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/memory\/(.+)\/versions\/(\d+)$/);
    const filename = decodeURIComponent(match[1]);
    const timestamp = match[2];
    const safeFilename = filename.replace(/\//g, '__');
    const versionPath = path.join(VERSIONS_DIR, `${safeFilename}.${timestamp}`);
    
    res.setHeader('Content-Type', 'application/json');
    try {
      if (!fs.existsSync(versionPath)) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Version not found' }));
      }
      
      const content = fs.readFileSync(versionPath, 'utf8');
      return res.end(JSON.stringify({ 
        content, 
        timestamp: parseInt(timestamp),
        date: new Date(parseInt(timestamp)).toISOString()
      }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  
  // Restore a version
  if (url.pathname.match(/^\/api\/memory\/(.+)\/restore$/) && req.method === 'POST') {
    const match = url.pathname.match(/^\/api\/memory\/(.+)\/restore$/);
    const filename = decodeURIComponent(match[1]);
    const filePath = path.resolve(MEMORY_DIR, filename);
    const memoryDirResolved = path.resolve(MEMORY_DIR);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(memoryDirResolved)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { timestamp } = JSON.parse(body);
        const safeFilename = filename.replace(/\//g, '__');
        const versionPath = path.join(VERSIONS_DIR, `${safeFilename}.${timestamp}`);
        
        if (!fs.existsSync(versionPath)) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Version not found' }));
        }
        
        // Create backup of current before restoring
        if (fs.existsSync(filePath)) {
          const currentContent = fs.readFileSync(filePath, 'utf8');
          createVersion(filename, currentContent);
        }
        
        // Restore the version
        const versionContent = fs.readFileSync(versionPath, 'utf8');
        fs.writeFileSync(filePath, versionContent, 'utf8');
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, restored: timestamp }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Serve static files first (JS, CSS, images, etc.)
  let filePath = '.' + url.pathname;
  const ext = path.extname(filePath);
  
  if (ext && fs.existsSync(filePath)) {
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    return res.end(fs.readFileSync(filePath));
  }
  
  // SPA fallback: return index.html for all other routes
  // This allows client-side routing to handle /chat, /memory, /system, etc.
  res.setHeader('Content-Type', 'text/html');
  return res.end(fs.readFileSync('./index.html'));
});

server.listen(PORT, () => {
  console.log(`SoLoBot Dashboard running on port ${PORT}`);
});
