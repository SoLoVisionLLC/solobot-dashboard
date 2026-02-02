const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ============================================
// Dynamic Model Fetching from OpenClaw Config
// ============================================

// Path to mounted OpenClaw config (from Coolify volume mount)
// We mount the whole .openclaw directory to avoid Docker EISDIR issues with single files
const OPENCLAW_CONFIG_PATH = './openclaw/openclaw.json';
// Fallback path (direct access if running on same machine)
const OPENCLAW_CONFIG_FALLBACK = '/home/node/.openclaw/openclaw.json';

// Cache for models list (refreshed every 5 minutes)
let cachedModels = null;
let modelsLastFetched = 0;
const MODELS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch models from OpenClaw config file (primary method)
 * Works across containers since the config is volume-mounted
 */
function fetchModelsFromConfig() {
  return new Promise((resolve) => {
    // Check cache first
    if (cachedModels && (Date.now() - modelsLastFetched) < MODELS_CACHE_TTL) {
      return resolve(cachedModels);
    }

    // Try mounted config first, then fallback path
    const configPaths = [OPENCLAW_CONFIG_PATH, OPENCLAW_CONFIG_FALLBACK];
    
    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          const models = parseOpenClawConfig(config);
          
          if (Object.keys(models).length > 0) {
            cachedModels = models;
            modelsLastFetched = Date.now();
            console.log(`[Models] Loaded ${Object.values(models).flat().length} models from ${configPath}`);
            return resolve(models);
          }
        }
      } catch (e) {
        console.warn(`[Models] Failed to read config from ${configPath}:`, e.message);
      }
    }

    console.warn('[Models] No OpenClaw config found, using fallback');
    resolve(null);
  });
}

/**
 * Parse OpenClaw config JSON to extract available models
 * The config structure has: agents.defaults.model.picker (array of model IDs)
 */
function parseOpenClawConfig(config) {
  const models = {};
  
  // Get picker models (the dropdown selection) - this is the main source
  const pickerModels = config?.agents?.defaults?.model?.picker || [];
  
  // Also check primary/fallback models
  const primaryModel = config?.agents?.defaults?.model?.primary;
  const fallbackModels = config?.agents?.defaults?.model?.fallbacks || [];
  
  // Combine all configured models
  const allModelIds = [...new Set([
    ...(primaryModel ? [primaryModel] : []),
    ...pickerModels,
    ...fallbackModels
  ])];
  
  // Parse each model ID
  for (const modelId of allModelIds) {
    if (!modelId || typeof modelId !== 'string') continue;
    
    const slashIndex = modelId.indexOf('/');
    if (slashIndex === -1) continue;
    
    const provider = modelId.substring(0, slashIndex);
    const modelName = modelId.substring(slashIndex + 1);
    
    // Determine tier
    let tier = 'configured';
    if (modelId === primaryModel) tier = 'default';
    else if (fallbackModels.includes(modelId)) tier = 'fallback';
    
    // Format display name
    let displayName = modelName
      .split(/[-\/]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    // Add indicator for primary model
    if (modelId === primaryModel) displayName += ' ⭐';
    
    // Initialize provider array if needed
    if (!models[provider]) {
      models[provider] = [];
    }
    
    // Avoid duplicates
    if (!models[provider].some(m => m.id === modelId)) {
      models[provider].push({
        id: modelId,
        name: displayName,
        tier: tier
      });
    }
  }
  
  return models;
}

/**
 * Legacy: Fetch models from CLI (fallback if config not available)
 */
function fetchModelsFromCLI() {
  return new Promise((resolve) => {
    exec('solobot models list 2>/dev/null || openclaw models list 2>/dev/null', { 
      encoding: 'utf8',
      timeout: 10000 
    }, (error, stdout, stderr) => {
      if (error || !stdout) {
        return resolve(null);
      }
      try {
        resolve(parseModelsOutput(stdout));
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * Parse CLI output (legacy support)
 */
function parseModelsOutput(output) {
  const models = {};
  const lines = output.split('\n').filter(line => line.trim());
  const dataLines = lines.filter(line => !line.startsWith('Model') && line.includes('/'));
  
  for (const line of dataLines) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 1) continue;
    
    let modelId = parts[0].trim().replace(/\.\.\.+$/, '');
    const slashIndex = modelId.indexOf('/');
    if (slashIndex === -1) continue;
    
    const provider = modelId.substring(0, slashIndex);
    const modelName = modelId.substring(slashIndex + 1);
    const tags = parts[parts.length - 1] || '';
    
    let tier = 'standard';
    if (tags.includes('default')) tier = 'default';
    else if (tags.includes('fallback#1') || tags.includes('fallback#2')) tier = 'flagship';
    else if (tags.includes('configured')) tier = 'configured';
    
    let displayName = modelName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (tags.includes('default')) displayName += ' ⭐';
    
    if (!models[provider]) models[provider] = [];
    models[provider].push({ id: modelId, name: displayName, tier });
  }
  
  return models;
}

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
        
        // PROTECT tasks and notes from being wiped by empty client state!
        // Only update tasks/notes if client has actual content, or if server is empty
        const serverHasTasks = countTasks(state) > 0;
        const serverHasNotes = (state.notes?.length || 0) > 0;
        const clientHasTasks = countTasks(update) > 0;
        const clientHasNotes = (update.notes?.length || 0) > 0;
        
        // If server has tasks but client doesn't, preserve server tasks
        if (serverHasTasks && !clientHasTasks) {
          console.log('[Sync] Protecting tasks - server has', countTasks(state), 'tasks, client has 0');
          delete update.tasks;
        }
        
        // If server has notes but client doesn't, preserve server notes
        if (serverHasNotes && !clientHasNotes) {
          console.log('[Sync] Protecting notes - server has', state.notes.length, 'notes, client has 0');
          delete update.notes;
        }
        
        state = { ...state, ...update, lastSync: Date.now() };
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, protected: { tasks: serverHasTasks && !clientHasTasks, notes: serverHasNotes && !clientHasNotes } }));
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
  // Get available models list (for dropdowns)
  if (url.pathname === '/api/models/list' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    
    // Primary: fetch from mounted OpenClaw config file (works across containers)
    fetchModelsFromConfig().then(configModels => {
      if (configModels && Object.keys(configModels).length > 0) {
        res.end(JSON.stringify(configModels));
        return;
      }
      
      // Fallback 1: try CLI (only works if solobot is installed locally)
      return fetchModelsFromCLI();
    }).then(cliModels => {
      if (cliModels && Object.keys(cliModels).length > 0) {
        res.end(JSON.stringify(cliModels));
        return;
      }
      
      // Fallback 2: check state file for cached models
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.availableModels) {
          res.end(JSON.stringify(state.availableModels));
          return;
        }
      } catch (e) { /* use defaults */ }
      
      // Final fallback: hardcoded defaults
      const models = {
        'openai-codex': [
          { id: 'openai-codex/gpt-5.2-codex', name: 'GPT-5.2 Codex ⭐', tier: 'flagship' }
        ],
        anthropic: [
          { id: 'anthropic/claude-opus-4-5', name: 'Claude Opus 4.5', tier: 'flagship' }
        ],
        'google-antigravity': [
          { id: 'google-antigravity/claude-opus-4-5-thinking', name: 'Claude Opus 4.5 Thinking', tier: 'flagship' }
        ],
        moonshot: [
          { id: 'moonshot/kimi-k2-0905-preview', name: 'Kimi K2', tier: 'flagship' }
        ],
        openrouter: [
          { id: 'openrouter/auto', name: 'Auto', tier: 'auto' }
        ]
      };
      
      res.end(JSON.stringify(models));
    }).catch(err => {
      console.error('[Models] Error fetching models:', err);
      // Return minimal fallback on error
      res.end(JSON.stringify({
        'openrouter': [{ id: 'openrouter/auto', name: 'Auto', tier: 'auto' }]
      }));
    });
    return;
  }
  
  // Refresh models cache (force re-fetch from config)
  if (url.pathname === '/api/models/refresh' && req.method === 'POST') {
    // Clear cache to force refresh
    cachedModels = null;
    modelsLastFetched = 0;
    
    // Fetch fresh models from config
    fetchModelsFromConfig().then(async models => {
      // If config didn't work, try CLI
      if (!models || Object.keys(models).length === 0) {
        models = await fetchModelsFromCLI();
      }
      
      res.setHeader('Content-Type', 'application/json');
      if (models && Object.keys(models).length > 0) {
        const count = Object.values(models).flat().length;
        res.end(JSON.stringify({ 
          ok: true, 
          message: `Refreshed ${count} models from config`,
          providers: Object.keys(models),
          count: count
        }));
      } else {
        res.end(JSON.stringify({ 
          ok: false, 
          message: 'Config file not found or empty. Check volume mount for openclaw-config.json'
        }));
      }
    }).catch(err => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  
  // Change model (updates OpenClaw config directly)
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

        console.log(`[Server] Model change requested: ${modelId}`);

        const modelInfo = {
          modelId: modelId,
          provider: modelId.split('/')[0],
          name: modelId.split('/').pop(),
          changedAt: Date.now()
        };

        // Update OpenClaw config file directly
        const openclawConfigPath = '/home/node/.openclaw/openclaw.json';
        let configUpdated = false;

        try {
          if (fs.existsSync(openclawConfigPath)) {
            const ocConfig = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));

            // Update the primary model in config
            if (!ocConfig.agents) ocConfig.agents = {};
            if (!ocConfig.agents.defaults) ocConfig.agents.defaults = {};
            if (!ocConfig.agents.defaults.model) ocConfig.agents.defaults.model = {};

            ocConfig.agents.defaults.model.primary = modelId;

            fs.writeFileSync(openclawConfigPath, JSON.stringify(ocConfig, null, 2));
            console.log(`[Server] Updated OpenClaw config with model: ${modelId}`);
            configUpdated = true;
          } else {
            console.warn('[Server] OpenClaw config not found at:', openclawConfigPath);
          }
        } catch (ocErr) {
          console.error('[Server] Failed to update OpenClaw config:', ocErr.message);
        }

        // Update dashboard state with current model
        const fileState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        fileState.currentModel = modelInfo;
        fileState.requestedModel = modelInfo;
        fileState.lastSync = Date.now();
        fs.writeFileSync(STATE_FILE, JSON.stringify(fileState, null, 2));

        // Update global in-memory state
        state.currentModel = modelInfo;
        state.requestedModel = modelInfo;
        state.lastSync = fileState.lastSync;

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          ok: true,
          message: configUpdated
            ? 'Model changed. Restart gateway to apply.'
            : 'Model saved locally. OpenClaw config not found - may need manual update.',
          modelId: modelId,
          configUpdated: configUpdated
        }));

      } catch (e) {
        console.error('[Server] Failed to change model:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({
          error: 'Failed to change model',
          details: e.message
        }));
      }
    });
    return;
  }

  // Get current model endpoint
  if (url.pathname === '/api/models/current' && req.method === 'GET') {
    // Get current model from state.json (updated by OpenClaw agent)
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      let modelInfo = state.currentModel;
      
      // Fallback: if missing, try reading OpenClaw config primary model
      if (!modelInfo) {
        try {
          const oc = JSON.parse(fs.readFileSync('/home/node/.openclaw/openclaw.json', 'utf8'));
          const primary = oc?.agents?.defaults?.model?.primary;
          if (primary) {
            modelInfo = {
              modelId: primary,
              provider: primary.split('/')[0],
              name: primary.split('/').pop()
            };
          }
        } catch (e) {
          // ignore fallback errors
        }
      }
      
      if (!modelInfo) {
        modelInfo = { 
          modelId: 'anthropic/claude-opus-4-5',
          provider: 'anthropic',
          name: 'claude-opus-4-5'
        };
      }

      // Normalize bad modelId like "anthropic/anthropic/claude-opus-4-5"
      if (modelInfo?.modelId) {
        const parts = modelInfo.modelId.split('/');
        if (parts.length >= 3 && parts[0] === parts[1]) {
          modelInfo.modelId = parts.slice(1).join('/');
        }
        // Ensure provider/name are consistent with modelId
        modelInfo.provider = modelInfo.modelId.split('/')[0];
        modelInfo.name = modelInfo.modelId.split('/').pop();
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(modelInfo));
    } catch (e) {
      console.error('[Server] Failed to get current model from state:', e.message);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        modelId: 'anthropic/claude-opus-4-5',
        provider: 'anthropic',
        name: 'claude-opus-4-5'
      }));
    }
    return;
  }
  
  // Update current model (called by OpenClaw agent)
  if (url.pathname === '/api/models/current' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const modelInfo = JSON.parse(body);
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        state.currentModel = modelInfo;
        state.lastSync = Date.now();
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, model: modelInfo }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Session rename endpoint
  if (url.pathname === '/api/session/rename' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { oldName, newName } = JSON.parse(body);
        if (!oldName || !newName) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'oldName and newName are required' }));
          return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Session name must be alphanumeric with hyphens/underscores only' }));
          return;
        }
        console.log(`[Server] Session rename requested: ${oldName} -> ${newName}`);
        // Store rename request in state for agent to apply
        state.sessionRenameRequest = { oldName, newName, requestedAt: Date.now() };
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, message: 'Rename requested. SoLoBot will apply it.' }));
      } catch (e) {
        console.error('[Server] Failed to request session rename:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to request session rename', details: e.message }));
      }
    });
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
  
  // List sessions endpoint (fetches from OpenClaw)
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    // Return sessions from state, or empty if not cached
    const sessions = state.sessions || [];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ sessions, count: sessions.length }));
    return;
  }

  // Switch session endpoint
  if (url.pathname === '/api/session/switch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sessionKey } = JSON.parse(body);
        if (!sessionKey) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'sessionKey is required' }));
          return;
        }
        console.log(`[Server] Session switch requested: ${sessionKey}`);
        state.sessionSwitchRequest = { sessionKey, requestedAt: Date.now() };
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, message: 'Session switch requested', sessionKey }));
      } catch (e) {
        console.error('[Server] Failed to request session switch:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to request session switch', details: e.message }));
      }
    });
    return;
  }

  // Get session history endpoint
  if (url.pathname.startsWith('/api/session/') && url.pathname.endsWith('/history')) {
    try {
      // Extract session key from URL (everything between /api/session/ and /history)
      const pathMatch = url.pathname.match(/\/api\/session\/(.+)\/history$/);
      const sessionKey = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
      
      console.log(`[Server] History request for session: ${sessionKey}`);
      console.log(`[Server] Available sessions: ${state.sessions?.map(s => s.key).join(', ')}`);
      
      const sessionInfo = state.sessions?.find(s => s.key === sessionKey);
      
      if (!sessionInfo?.sessionId) {
        console.log(`[Server] Session not found: ${sessionKey}`);
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Session not found', sessionKey }));
        return;
      }
      
      // Read transcript file from mounted sessions folder
      const transcriptPath = path.join('/app/sessions', `${sessionInfo.sessionId}.jsonl`);
      console.log(`[Server] Looking for transcript at: ${transcriptPath}`);
      
      if (!fs.existsSync(transcriptPath)) {
        console.log(`[Server] Transcript not found at: ${transcriptPath}`);
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Transcript not found', path: transcriptPath }));
        return;
      }
      
      // Parse JSONL file
      const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(l => l.trim());
      const messages = lines.map(line => {
        try {
          const msg = JSON.parse(line);
          return {
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp || msg.createdAt,
            name: msg.name
          };
        } catch (e) {
          return null;
        }
      }).filter(m => m !== null);
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, sessionKey, messages, count: messages.length }));
    } catch (e) {
      console.error('[Server] Failed to get session history:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to get session history', details: e.message }));
    }
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
