const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const STATE_FILE = './data/state.json';
const DEFAULT_STATE_FILE = './data/default-state.json';
const MEMORY_DIR = './memory';  // Mounted from OpenClaw workspace via Coolify
const VERSIONS_DIR = './data/versions';  // Version history storage
const META_FILE = './data/file-meta.json';  // Track bot updates

// Google Drive backup config (for auto-restore on startup)
// Set these in Coolify environment variables for auto-restore to work
const GDRIVE_BACKUP_FILE_ID = process.env.GDRIVE_BACKUP_FILE_ID;  // The backup file ID in Drive
const GDRIVE_CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const GDRIVE_CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const GDRIVE_REFRESH_TOKEN = process.env.GDRIVE_REFRESH_TOKEN;
const AUTO_RESTORE_ENABLED = GDRIVE_BACKUP_FILE_ID && GDRIVE_CLIENT_ID && GDRIVE_CLIENT_SECRET && GDRIVE_REFRESH_TOKEN;

// Ensure data directories exist
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
if (!fs.existsSync(VERSIONS_DIR)) fs.mkdirSync(VERSIONS_DIR, { recursive: true });

// ============================================
// Google Drive Auto-Restore on Startup
// ============================================

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getGoogleAccessToken() {
  const postData = new URLSearchParams({
    client_id: GDRIVE_CLIENT_ID,
    client_secret: GDRIVE_CLIENT_SECRET,
    refresh_token: GDRIVE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  }).toString();

  const result = await httpsRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, postData);

  if (result.status === 200 && result.data.access_token) {
    return result.data.access_token;
  }
  throw new Error('Failed to get Google access token');
}

async function fetchBackupFromDrive(accessToken) {
  const result = await httpsRequest({
    hostname: 'www.googleapis.com',
    path: `/drive/v3/files/${GDRIVE_BACKUP_FILE_ID}?alt=media`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });

  if (result.status === 200 && typeof result.data === 'object') {
    return result.data;
  }
  throw new Error(`Failed to fetch backup: ${result.status}`);
}

function countTasks(stateObj) {
  if (!stateObj || !stateObj.tasks) return 0;
  const t = stateObj.tasks;
  return (t.todo?.length || 0) + (t.progress?.length || 0) + (t.done?.length || 0);
}

async function checkAndRestoreFromBackup(localState) {
  if (!AUTO_RESTORE_ENABLED) {
    console.log('[Auto-Restore] Disabled (missing env vars: GDRIVE_BACKUP_FILE_ID, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN)');
    return localState;
  }
  
  console.log('[Auto-Restore] Checking if backup restore is needed...');
  
  const localTaskCount = countTasks(localState);
  const localLastSync = localState?.lastSync || 0;
  
  console.log(`[Auto-Restore] Local state: ${localTaskCount} tasks, lastSync: ${localLastSync ? new Date(localLastSync).toISOString() : 'never'}`);
  
  // If local state has tasks and recent sync, skip restore
  if (localTaskCount > 0 && localLastSync > Date.now() - 24 * 60 * 60 * 1000) {
    console.log('[Auto-Restore] Local state looks good, skipping restore');
    return localState;
  }
  
  try {
    console.log('[Auto-Restore] Local state empty/stale, fetching backup from Google Drive...');
    const accessToken = await getGoogleAccessToken();
    const backupState = await fetchBackupFromDrive(accessToken);
    
    const backupTaskCount = countTasks(backupState);
    const backupLastSync = backupState?.lastSync || 0;
    
    console.log(`[Auto-Restore] Backup state: ${backupTaskCount} tasks, lastSync: ${backupLastSync ? new Date(backupLastSync).toISOString() : 'never'}`);
    
    // Use backup if it has more tasks or is more recent
    if (backupTaskCount > localTaskCount || backupLastSync > localLastSync) {
      console.log('[Auto-Restore] ✓ Restoring from Google Drive backup!');
      return backupState;
    } else {
      console.log('[Auto-Restore] Backup not better than local, keeping local');
      return localState;
    }
  } catch (err) {
    console.log(`[Auto-Restore] Could not restore from backup: ${err.message}`);
    return localState;
  }
}

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

// ============================================
// File Watcher - Detect External Changes
// ============================================

// Track file modification times to detect external changes
let fileModTimes = {};
const MOD_TIMES_FILE = './data/file-mod-times.json';

try {
  if (fs.existsSync(MOD_TIMES_FILE)) {
    fileModTimes = JSON.parse(fs.readFileSync(MOD_TIMES_FILE, 'utf8'));
  }
} catch (e) {
  console.log('Starting with fresh mod times tracking');
}

function saveModTimes() {
  fs.writeFileSync(MOD_TIMES_FILE, JSON.stringify(fileModTimes, null, 2));
}

// Check for external file changes and create versions/badges
function checkForExternalChanges() {
  if (!fs.existsSync(MEMORY_DIR)) return;
  
  const checkFile = (filepath, relativePath) => {
    try {
      const stat = fs.statSync(filepath);
      const mtime = stat.mtime.getTime();
      const lastKnown = fileModTimes[relativePath];
      
      if (lastKnown && mtime > lastKnown) {
        // File was modified externally!
        console.log(`External change detected: ${relativePath}`);
        
        // Mark as bot-updated
        if (!fileMeta[relativePath]) {
          fileMeta[relativePath] = {};
        }
        fileMeta[relativePath].botUpdated = true;
        fileMeta[relativePath].botUpdatedAt = Date.now();
        fileMeta[relativePath].acknowledged = false;
        saveFileMeta();
      }
      
      // Update tracked mod time
      fileModTimes[relativePath] = mtime;
    } catch (e) {
      // File might have been deleted
    }
  };
  
  // Check root memory files
  try {
    const items = fs.readdirSync(MEMORY_DIR);
    for (const item of items) {
      const itemPath = path.join(MEMORY_DIR, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isFile() && item.endsWith('.md')) {
        checkFile(itemPath, item);
      } else if (stat.isDirectory() && item === 'memory') {
        // Check memory/ subdirectory
        const subItems = fs.readdirSync(itemPath);
        for (const subItem of subItems) {
          if (subItem.endsWith('.md')) {
            checkFile(path.join(itemPath, subItem), `memory/${subItem}`);
          }
        }
      }
    }
  } catch (e) {
    console.log('Error checking for external changes:', e.message);
  }
  
  saveModTimes();
}

// Check for external changes every 30 seconds
setInterval(checkForExternalChanges, 30000);
// Also check on startup after a short delay
setTimeout(checkForExternalChanges, 5000);

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

// Load or initialize state (will be populated by async init)
let state = {};

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[Server] State saved to ${STATE_FILE}`);
  } catch (e) {
    console.error('[Server] Failed to save state:', e.message);
    throw e; // Re-throw to make error visible
  }
}

// Async state initialization with auto-restore
async function initializeState() {
  let localState = {};
  
  try {
    if (fs.existsSync(STATE_FILE)) {
      localState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log('Loaded existing state from persistent storage');
    } else if (fs.existsSync(DEFAULT_STATE_FILE)) {
      localState = JSON.parse(fs.readFileSync(DEFAULT_STATE_FILE, 'utf8'));
      console.log('Initialized state from default template');
    } else {
      console.log('Starting with fresh state');
    }
  } catch (e) {
    console.log('Error loading state, starting fresh:', e.message);
  }
  
  // Check if we should restore from Google Drive backup
  state = await checkAndRestoreFromBackup(localState);
  
  // Save the (possibly restored) state
  saveState();
  console.log(`State initialized with ${countTasks(state)} tasks`);
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
  
  // List versions for a file (MUST be before generic GET)
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
  
  // Get a specific version content (MUST be before generic GET)
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
      const meta = fileMeta[filename] || {};
      
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        name: filename,
        content: content,
        modified: stat.mtime.toISOString(),
        size: stat.size,
        botUpdated: meta.botUpdated || false,
        botUpdatedAt: meta.botUpdatedAt || null,
        acknowledged: meta.acknowledged || false
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
  
  // Change AI Model endpoint
  if (url.pathname === '/api/models/set' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { modelId } = JSON.parse(body);
        
        if (!modelId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'modelId is required' }));
          return;
        }
        
        console.log(`[Server] Attempting to change model to: ${modelId}`);
        
        // Execute the moltbot command to change model
        const exec = require('child_process').execSync;
        const result = exec(`moltbot models set "${modelId}" 2>&1`, { encoding: 'utf8' });
        
        console.log(`[Server] Model change result: ${result}`);
        
        // Check if command succeeded by looking for error indicators
        const hasError = result.includes('error') || result.includes('Error') || result.includes('Failed');
        
        if (hasError) {
          console.error(`[Server] Model change failed: ${result}`);
          res.writeHead(500);
          res.end(JSON.stringify({ 
            error: 'Model change command failed', 
            details: result.trim() 
          }));
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ 
            ok: true, 
            message: result,
            modelId: modelId 
          }));
        }
        
      } catch (e) {
        console.error('[Server] Failed to change model:', e.message);
        console.error('[Server] Error stack:', e.stack);
        res.writeHead(500);
        res.end(JSON.stringify({ 
          error: 'Failed to execute model change command', 
          details: e.message 
        }));
      }
    });
    return;
  }
  
  // Get current model endpoint
  if (url.pathname === '/api/models/current' && req.method === 'GET') {
    try {
      const exec = require('child_process').execSync;
      const result = exec('moltbot models list 2>/dev/null | grep "default\|configured" | head -1', { encoding: 'utf8' });
      
      if (result) {
        const parts = result.trim().split(/\s+/);
        const modelId = parts[0];
        const tags = parts[parts.length - 1] || '';
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          modelId: modelId,
          provider: modelId.split('/')[0],
          name: modelId.split('/').pop(),
          isDefault: tags.includes('default'),
          isConfigured: tags.includes('configured')
        }));
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'No models found',
          message: 'Could not determine current model'
        }));
      }
    } catch (e) {
      console.error('[Server] Failed to get current model:', e.message);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Failed to get current model',
        details: e.message
      }));
    }
    return;
  }
  
  // Manual state backup endpoint
  if (url.pathname === '/api/state/backup' && req.method === 'POST') {
    try {
      const backupFile = `./data/state-backup-${Date.now()}.json`;
      fs.writeFileSync(backupFile, JSON.stringify(state, null, 2));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ 
        ok: true, 
        backupFile: path.basename(backupFile),
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  
  // Manual state restore endpoint
  if (url.pathname === '/api/state/restore' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const backup = JSON.parse(body);
        state = { ...state, ...backup, lastSync: Date.now() };
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

// Start server after async initialization
async function startServer() {
  await initializeState();
  
  server.listen(PORT, () => {
    console.log(`SoLoBot Dashboard running on port ${PORT}`);
    console.log(`Auto-restore from Google Drive: enabled`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
