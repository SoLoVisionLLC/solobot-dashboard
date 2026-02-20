const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

process.env.TZ = process.env.TZ || 'America/New_York';

// ============================================
// Dynamic Model Fetching from OpenClaw Config
// ============================================

// Path to OpenClaw data directory
// Set OPENCLAW_HOME env var to override (defaults to ~/.openclaw, then /app/openclaw for Docker)
const OPENCLAW_HOME = process.env.OPENCLAW_HOME
  || (fs.existsSync(path.join(os.homedir(), '.openclaw', 'openclaw.json')) ? path.join(os.homedir(), '.openclaw') : null)
  || (fs.existsSync('/app/openclaw/openclaw.json') ? '/app/openclaw' : null)
  || path.join(os.homedir(), '.openclaw');

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG || path.join(OPENCLAW_HOME, 'openclaw.json');
// Fallback paths (legacy mount or direct access)
const OPENCLAW_CONFIG_FALLBACK = '/app/openclaw/openclaw.json';
const OPENCLAW_CONFIG_FALLBACK2 = '/home/node/.openclaw/openclaw.json';

// Cache for models list (short TTL since config is live-mounted from host)
let cachedModels = null;
let modelsLastFetched = 0;
const MODELS_CACHE_TTL = 30 * 1000; // 30 seconds — config file is live-mounted

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
    const configPaths = [OPENCLAW_CONFIG_PATH, OPENCLAW_CONFIG_FALLBACK, OPENCLAW_CONFIG_FALLBACK2];
    
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

    // Fallback: use gateway-synced models cache (pushed by frontend via /api/models/sync)
    if (global._gatewayModelsCache && Object.keys(global._gatewayModelsCache).length > 0) {
      cachedModels = global._gatewayModelsCache;
      modelsLastFetched = Date.now();
      console.log(`[Models] Using gateway-synced models cache (${Object.values(cachedModels).flat().length} models)`);
      return resolve(cachedModels);
    }

    console.warn('[Models] No OpenClaw config found (file or gateway cache), using fallback');
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
  
  // Also include configured models list (agents.defaults.models keys)
  const configuredModels = Object.keys(config?.agents?.defaults?.models || {});

  // Combine all configured models
  const allModelIds = [...new Set([
    ...(primaryModel ? [primaryModel] : []),
    ...pickerModels,
    ...fallbackModels,
    ...configuredModels
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
// OpenClaw data — uses OPENCLAW_HOME (auto-detected or env var)
// Falls back to ./memory for local dev without OpenClaw
const OPENCLAW_DATA = OPENCLAW_HOME;
const MEMORY_DIR = fs.existsSync(path.join(OPENCLAW_DATA, 'workspace')) 
    ? path.join(OPENCLAW_DATA, 'workspace') 
    : './memory';
const VERSIONS_DIR = './data/versions';  // Version history storage
const META_FILE = './data/file-meta.json';  // Track bot updates
const BACKUP_DIR = path.join(path.dirname(STATE_FILE), 'backups');
const BACKUP_PREFIX = 'state-backup-';
const BACKUP_RETENTION = 10;
const LATEST_STATE_FILE = path.join(path.dirname(STATE_FILE), 'state.latest.json');

// ============================================
// Sessions: Read directly from OpenClaw
// ============================================
const SESSIONS_PATHS = [
  path.join(OPENCLAW_DATA, 'agents/main/sessions/sessions.json'),
  '/app/sessions/sessions.json',  // legacy mount fallback
  '/home/node/.openclaw/agents/main/sessions/sessions.json'
];

function loadSessionsFromOpenClaw() {
  try {
    // Load sessions from ALL agents, not just main
    let sessionsData = {};
    
    // First try to load from all agent directories
    const agentsDir = path.join(OPENCLAW_DATA, 'agents');
    if (fs.existsSync(agentsDir)) {
      const agents = fs.readdirSync(agentsDir).filter(a => {
        const sessFile = path.join(agentsDir, a, 'sessions', 'sessions.json');
        return fs.existsSync(sessFile);
      });
      for (const agent of agents) {
        try {
          const sessFile = path.join(agentsDir, agent, 'sessions', 'sessions.json');
          const agentSessions = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
          // Tag each session with its agent for transcript lookup
          for (const key of Object.keys(agentSessions)) {
            agentSessions[key]._agent = agent;
          }
          Object.assign(sessionsData, agentSessions);
        } catch (e) { /* skip broken files */ }
      }
    }
    
    // Fallback to legacy paths if no agents found
    if (Object.keys(sessionsData).length === 0) {
      for (const p of SESSIONS_PATHS) {
        if (fs.existsSync(p)) {
          sessionsData = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        }
      }
    }
    if (!sessionsData) return [];

    const sessions = [];
    for (const key of Object.keys(sessionsData)) {
      const data = sessionsData[key] || {};
      const parts = key.split(':');
      const shortName = parts.length ? parts[parts.length - 1] : key;
      let displayName = data.displayName;
      if (!displayName && data.origin) displayName = data.origin.label;
      if (!displayName) displayName = shortName;

      sessions.push({
        key,
        name: shortName,
        displayName,
        kind: data.chatType || 'unknown',
        channel: (data.deliveryContext && data.deliveryContext.channel) || 'unknown',
        model: data.model || 'unknown',
        updatedAt: data.updatedAt,
        sessionId: data.sessionId,
        totalTokens: data.totalTokens || 0,
        _agent: data._agent || 'main'
      });
    }

    return sessions;
  } catch (e) {
    console.warn('[Sessions] Failed to load sessions:', e.message);
    return [];
  }
}

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
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function formatBackupTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function pruneStateBackups() {
  try {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
      .sort();
    while (backups.length > BACKUP_RETENTION) {
      const toRemove = backups.shift();
      fs.unlinkSync(path.join(BACKUP_DIR, toRemove));
    }
  } catch (err) {
    console.error('[Backup] Failed to prune backups:', err.message);
  }
}

function createStateBackup(serializedState) {
  try {
    ensureBackupDir();
    const fileName = `${BACKUP_PREFIX}${formatBackupTimestamp(new Date())}.json`;
    const targetPath = path.join(BACKUP_DIR, fileName);
    fs.writeFileSync(targetPath, serializedState);
    fs.writeFileSync(LATEST_STATE_FILE, serializedState);
    pruneStateBackups();
    console.log(`[Backup] Saved state snapshot to ${fileName}`);
    return targetPath;
  } catch (err) {
    console.error('[Backup] Failed to snapshot state:', err.message);
  }
}

// ============================================
// Google Drive Instant Backup (Debounced)
// ============================================
const DRIVE_BACKUP_DEBOUNCE_MS = 5000;
let driveBackupTimer = null;
let driveBackupInFlight = false;
let lastDriveBackupHash = '';
let pendingDriveBackup = null;

function hashState(serializedState) {
  return crypto.createHash('sha256').update(serializedState).digest('hex');
}

function queueDriveBackup(serializedState) {
  if (!AUTO_RESTORE_ENABLED) return;
  pendingDriveBackup = serializedState;
  if (driveBackupTimer) clearTimeout(driveBackupTimer);
  driveBackupTimer = setTimeout(() => {
    const toBackup = pendingDriveBackup;
    pendingDriveBackup = null;
    performDriveBackup(toBackup).catch(err => {
      console.warn('[Backup] Drive backup failed:', err.message);
    });
  }, DRIVE_BACKUP_DEBOUNCE_MS);
}

async function performDriveBackup(serializedState) {
  if (!serializedState || driveBackupInFlight) return;
  const currentHash = hashState(serializedState);
  if (currentHash === lastDriveBackupHash) return;
  driveBackupInFlight = true;
  try {
    const accessToken = await getGoogleAccessToken();
    const result = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/upload/drive/v3/files/${GDRIVE_BACKUP_FILE_ID}?uploadType=media`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }, serializedState);

    if (result.status >= 200 && result.status < 300) {
      lastDriveBackupHash = currentHash;
      console.log('[Backup] Updated Google Drive backup file');
    } else {
      throw new Error(`Drive backup failed: ${result.status}`);
    }
  } finally {
    driveBackupInFlight = false;
  }
}

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
  return (t.todo?.length || 0) + (t.progress?.length || 0) + (t.done?.length || 0) + (t.archive?.length || 0);
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
  
  const localNotesCount = (localState?.notes?.length || 0);
  const localChatCount = (localState?.chat?.messages?.length || 0);
  const localLooksEmpty = localTaskCount === 0 && localNotesCount === 0 && localChatCount === 0;
  const localLooksFresh = localLastSync > Date.now() - 24 * 60 * 60 * 1000;
  const localFileExists = fs.existsSync(STATE_FILE);

  // Never restore if local state file physically exists with any content
  // This prevents stale Google Drive backups from overwriting curated local state
  if (localFileExists && localTaskCount > 0) {
    console.log(`[Auto-Restore] Local state file exists with ${localTaskCount} tasks, skipping restore`);
    return localState;
  }

  // Only restore if local is truly empty or missing
  if (!localLooksEmpty || localLooksFresh) {
    console.log('[Auto-Restore] Local state looks good, skipping restore');
    return localState;
  }
  
  try {
    console.log('[Auto-Restore] Local state empty, fetching backup from Google Drive...');
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
    const serialized = JSON.stringify(state, null, 2);
    fs.writeFileSync(STATE_FILE, serialized);
    console.log(`[Server] State saved to ${STATE_FILE}`);
    createStateBackup(serialized);
    queueDriveBackup(serialized);
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

// ============================================
// Page Assembly from Partials
// ============================================
function readPartial(name) {
  try {
    return fs.readFileSync(`./partials/${name}.html`, 'utf8');
  } catch (e) {
    console.error(`Missing partial: ${name}.html`);
    return `<!-- missing partial: ${name} -->`;
  }
}

function readPage(name) {
  try {
    return fs.readFileSync(`./pages/${name}.html`, 'utf8');
  } catch (e) {
    console.error(`Missing page: ${name}.html`);
    return `<!-- missing page: ${name} -->`;
  }
}

const PAGE_NAMES = ['dashboard', 'memory', 'chat', 'system', 'products', 'business', 'cron', 'security', 'skills'];

function assemblePage(activePage) {
  // Build all pages, marking the active one
  const pageHtml = PAGE_NAMES.map(name => {
    let content = readPage(name);
    // Ensure the active page has class="page active"
    if (name === activePage) {
      content = content.replace('class="page"', 'class="page active"');
    } else {
      content = content.replace('class="page active"', 'class="page"');
    }
    return content;
  }).join('\n');

  return [
    readPartial('head'),
    readPartial('body-open'),
    readPartial('sidebar'),
    readPartial('header'),
    pageHtml,
    readPartial('footer'),
    readPartial('modals-tasks'),
    readPartial('modals-memory'),
    readPartial('modals-settings-main'),
    readPartial('modals-settings-themes'),
    readPartial('modals-misc'),
    readPartial('scripts'),
  ].join('\n');
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
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
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify(state));
  }
  
  if (url.pathname === '/api/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        const protections = { tasks: false, notes: false, activity: false };
        
        // ============================================================
        // BULLETPROOF DATA PROTECTION
        // Tasks, notes, and activity are NEVER overwritten with less data.
        // The server always keeps the version with MORE content.
        // ============================================================
        
        const serverTaskCount = countTasks(state);
        const clientTaskCount = countTasks(update);
        const serverActivityCount = Array.isArray(state.activity) ? state.activity.length : 0;
        const clientActivityCount = Array.isArray(update.activity) ? update.activity.length : 0;
        const serverNoteCount = state.notes?.length || 0;
        const clientNoteCount = update.notes?.length || 0;
        
        // PROTECT TASKS with versioning — reject stale task syncs
        if (update.tasks !== undefined) {
          const serverVersion = state._taskVersion || 0;
          const clientVersion = update._taskVersion || 0;
          
          // If server has a higher OR EQUAL task version, client is stale — reject task update
          // Server is source of truth. Only accept tasks from clients with a STRICTLY higher version.
          if (serverVersion >= clientVersion && serverTaskCount > 0) {
            console.log(`[Sync] REJECTING tasks - server v${serverVersion} >= client v${clientVersion} (server has ${serverTaskCount}, client has ${clientTaskCount})`);
            protections.tasks = true;
            protections.serverTasks = state.tasks;
            protections.taskVersion = serverVersion;
            delete update.tasks;
            // Also strip _taskVersion so client doesn't overwrite it
            delete update._taskVersion;
          }
          // PROTECT ARCHIVE: preserve server archive from stale clients
          if (update.tasks && !protections.tasks) {
            const serverArchive = state.tasks?.archive?.length || 0;
            const clientArchive = update.tasks?.archive?.length || 0;
            if (serverArchive > 0 && clientArchive < serverArchive) {
              console.log(`[Sync] PROTECTING archive - server has ${serverArchive}, client has ${clientArchive}. Merging.`);
              update.tasks.archive = state.tasks.archive;
              if (update.tasks.done && state.tasks?.done) {
                const archivedIds = new Set((state.tasks.archive || []).map(t => t.id));
                update.tasks.done = update.tasks.done.filter(t => !archivedIds.has(t.id));
              }
            }
            // Bump version when tasks change via sync
            state._taskVersion = (state._taskVersion || 0) + 1;
          }
        }
        
        // PROTECT ACTIVITY: never allow fewer entries to replace more entries
        if (update.activity !== undefined) {
          if (serverActivityCount > 0 && clientActivityCount < serverActivityCount) {
            console.log(`[Sync] PROTECTING activity - server has ${serverActivityCount}, client has ${clientActivityCount}`);
            delete update.activity;
            protections.activity = true;
          }
        }
        
        // PROTECT NOTES: never allow fewer notes to replace more notes
        if (update.notes !== undefined) {
          if (serverNoteCount > 0 && clientNoteCount < serverNoteCount) {
            console.log(`[Sync] PROTECTING notes - server has ${serverNoteCount}, client has ${clientNoteCount}`);
            delete update.notes;
            protections.notes = true;
          }
        }
        
        state = { ...state, ...update, lastSync: Date.now() };
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, protected: protections }));
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
  
  // Archive all done tasks (atomic, server-side — can't be raced by frontend sync)
  if (url.pathname === '/api/tasks/archive-done' && req.method === 'POST') {
    if (!state.tasks) state.tasks = {};
    const doneCount = (state.tasks.done || []).length;
    if (doneCount === 0) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: true, archived: 0, message: 'No done tasks to archive' }));
    }
    if (!state.tasks.archive) state.tasks.archive = [];
    state.tasks.archive.push(...state.tasks.done);
    state.tasks.done = [];
    state._taskVersion = (state._taskVersion || 0) + 1;
    saveState();
    console.log(`[Server] Archived ${doneCount} done tasks (total archive: ${state.tasks.archive.length})`);
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: true, archived: doneCount, totalArchive: state.tasks.archive.length }));
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
  // NOTION TASKS API
  // ===================
  
  const NOTION_API_CACHE_TTL = 60000; // 60 seconds
  let notionCache = { tasks: [], timestamp: 0 };
  
  async function fetchNotionTasks() {
    const now = Date.now();
    if (notionCache.tasks.length > 0 && (now - notionCache.timestamp) < NOTION_API_CACHE_TTL) {
      return { ...notionCache, cached: true };
    }
    
    const NOTION_API_KEY_PATH = process.env.NOTION_API_KEY_PATH || path.join(os.homedir(), '.config', 'notion', 'api_key');
    const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '426bc82e-256d-4bfc-9e23-2254cd16f87f';
    
    let apiKey;
    try {
      apiKey = fs.readFileSync(NOTION_API_KEY_PATH, 'utf8').trim();
    } catch (err) {
      console.error('[Notion] Failed to read API key:', err.message);
      return { error: 'Notion API key not configured', cached: false };
    }
    
    try {
      const response = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.notion.com',
          path: `/v1/data_sources/${NOTION_DATABASE_ID}/query`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': '2025-09-03',
            'Content-Type': 'application/json'
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Failed to parse Notion response: ${e.message}`));
            }
          });
        });
        req.on('error', reject);
        req.write(JSON.stringify({})); // Empty request body for default query
        req.end();
      });
      
      if (response.error) {
        throw new Error(response.error.message || 'Notion API error');
      }
      
      if (!response.results) {
        console.error('[Notion] Unexpected response structure:', JSON.stringify(response).slice(0, 500));
        throw new Error('Notion API returned unexpected response (no results array)');
      }
      
      const tasks = response.results.map(page => {
        const props = page.properties;
        return {
          id: page.id,
          title: getNotionProperty(props.Task || props.Name || props.Title || props.title, 'title'),
          description: getNotionProperty(props.Notes || props.Description || props.description, 'rich_text'),
          status: getNotionProperty(props.Status || props.status, 'select'),
          priority: mapNotionPriority(props.Priority || props.priority),
          owner: getNotionProperty(props['Assigned Agent'] || props.Assigned || props.owner, 'select'),
          dueDate: getNotionDate(props['Due Date'] || props.Due || props.DueDate || props.date),
          url: page.url
        };
      });
      
      notionCache = { tasks, timestamp: now };
      return { tasks, timestamp: now.toISOString(), cached: false };
    } catch (err) {
      console.error('[Notion] Fetch error:', err.message);
      // Return cached data on error if available
      if (notionCache.tasks.length > 0) {
        return { ...notionCache, cached: true, error: err.message };
      }
      return { error: err.message, cached: false };
    }
  }
  
  function getNotionProperty(prop, type) {
    if (!prop) return '';
    switch (type) {
      case 'title':
        return prop.title?.[0]?.plain_text || '';
      case 'rich_text':
        return prop.rich_text?.[0]?.plain_text || '';
      case 'select':
        return prop.select?.name || '';
      case 'multi_select':
        return prop.multi_select?.map(o => o.name) || [];
      default:
        return '';
    }
  }
  
  function getNotionDate(dateProp) {
    if (!dateProp?.date?.start) return null;
    return dateProp.date.start;
  }
  
  function mapNotionPriority(priorityProp) {
    const value = getNotionProperty(priorityProp, 'select').toLowerCase();
    if (value.includes('critical') || value === 'p0' || value === '0') return 0;
    if (value.includes('high') || value === 'p1' || value === '1') return 1;
    if (value.includes('low') || value === 'p3' || value === '3') return 3;
    return 2; // Default to normal
  }
  
  if (url.pathname === '/api/notion/tasks' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    fetchNotionTasks().then(result => {
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
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
  
  // Sub-agent workspaces API
  // Reads openclaw.json to discover agents and their workspace paths dynamically
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const agents = [];
      
      // Scan agents directory directly (config.agents.list was removed in recent OpenClaw versions)
      const agentsBaseDir = path.join(OPENCLAW_HOME, 'agents');
      let agentIds = [];
      if (fs.existsSync(agentsBaseDir)) {
        agentIds = fs.readdirSync(agentsBaseDir).filter(d => {
          try { return fs.statSync(path.join(agentsBaseDir, d)).isDirectory(); }
          catch { return false; }
        });
      }
      
      for (const agentId of agentIds) {
        // Each agent's workspace can be at:
        // 1. agents/{id}/workspace (standard)
        // 2. OPENCLAW_HOME/workspace-{id} (dedicated workspace)
        // 3. OPENCLAW_HOME/workspace (main agent)
        let agentDir;
        if (agentId === 'main') {
          agentDir = path.join(OPENCLAW_HOME, 'workspace');
        } else {
          agentDir = path.join(agentsBaseDir, agentId, 'workspace');
          if (!fs.existsSync(agentDir)) {
            agentDir = path.join(OPENCLAW_HOME, `workspace-${agentId}`);
          }
        }
        if (!fs.existsSync(agentDir)) continue;
        
        const mdFiles = [];
        
        try {
          // List .md files in agent workspace root
          const agentFiles = fs.readdirSync(agentDir);
          for (const f of agentFiles) {
            if (!f.endsWith('.md')) continue;
            try {
              const fstat = fs.statSync(path.join(agentDir, f));
              if (fstat.isFile()) {
                mdFiles.push({ name: f, size: fstat.size, modified: fstat.mtime.toISOString() });
              }
            } catch (e) { /* skip */ }
          }
          // Also check memory/ subdirectory
          const memDir = path.join(agentDir, 'memory');
          if (fs.existsSync(memDir) && fs.statSync(memDir).isDirectory()) {
            const memFiles = fs.readdirSync(memDir);
            for (const f of memFiles) {
              if (!f.endsWith('.md')) continue;
              try {
                const fstat = fs.statSync(path.join(memDir, f));
                if (fstat.isFile()) {
                  mdFiles.push({ name: `memory/${f}`, size: fstat.size, modified: fstat.mtime.toISOString() });
                }
              } catch (e) { /* skip */ }
            }
          }
        } catch (e) { /* skip unreadable dirs */ }
        
        // Parse identity from IDENTITY.md if it exists
        let name = agentId;
        let emoji = '';
        try {
          const identityPath = path.join(agentDir, 'IDENTITY.md');
          if (fs.existsSync(identityPath)) {
            const identityContent = fs.readFileSync(identityPath, 'utf8');
            const nameMatch = identityContent.match(/\*\*Name:\*\*\s*(.+)/);
            const emojiMatch = identityContent.match(/\*\*Emoji:\*\*\s*(.+)/);
            if (nameMatch) name = nameMatch[1].trim();
            if (emojiMatch) emoji = emojiMatch[1].trim();
          }
        } catch (e) { /* skip */ }
        
        agents.push({
          id: agentId,
          name,
          emoji,
          isDefault: agentId === 'main',
          workspace: agentDir,
          files: mdFiles
        });
      }
      
      // Sort: default agent first, then alphabetically
      agents.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return a.id.localeCompare(b.id);
      });
      
      return res.end(JSON.stringify({ agents }));
    } catch (e) {
      return res.end(JSON.stringify({ agents: [], error: e.message }));
    }
  }
  
  // Read sub-agent file
  if (url.pathname.match(/^\/api\/agents\/([^/]+)\/files\/(.+)$/) && req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/agents\/([^/]+)\/files\/(.+)$/);
    const agentId = decodeURIComponent(match[1]);
    const filename = decodeURIComponent(match[2]);
    
    // Resolve workspace path from agents directory
    const agentWorkspace = agentId === 'main'
      ? path.join(OPENCLAW_HOME, 'workspace')
      : path.join(OPENCLAW_HOME, 'agents', agentId, 'workspace');
    const filePath = path.resolve(agentWorkspace, filename);
    
    // Security: ensure path is within workspace
    const resolvedWorkspace = path.resolve(agentWorkspace);
    if (!filePath.startsWith(resolvedWorkspace)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }
    
    res.setHeader('Content-Type', 'application/json');
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return res.end(JSON.stringify({ name: filename, content }));
    } catch (e) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'File not found' }));
    }
  }

  // ========== Skills Files API ==========
  // Skills directories (in priority order)
  const SKILLS_DIRS = [
    path.join(OPENCLAW_DATA, 'workspace/skills'),     // workspace skills
    path.join(OPENCLAW_DATA, 'skills'),               // user skills
    '/app/skills'                                      // bundled skills
  ];

  // Find skill path by name
  function findSkillPath(skillName) {
    for (const dir of SKILLS_DIRS) {
      const skillPath = path.join(dir, skillName);
      if (fs.existsSync(skillPath) && fs.existsSync(path.join(skillPath, 'SKILL.md'))) {
        return skillPath;
      }
    }
    return null;
  }

  // List files in a skill directory recursively
  function listSkillFiles(skillPath, basePath = '') {
    const files = [];
    const items = fs.readdirSync(skillPath);
    for (const item of items) {
      const itemPath = path.join(skillPath, item);
      const relPath = basePath ? `${basePath}/${item}` : item;
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        files.push(...listSkillFiles(itemPath, relPath));
      } else {
        files.push({
          name: item,
          path: path.join(skillPath, relPath),
          relativePath: relPath,
          size: stat.size,
          mtime: stat.mtime.toISOString()
        });
      }
    }
    return files;
  }

  // GET /api/skills/:name/files - list files in a skill
  if (url.pathname.match(/^\/api\/skills\/([^/]+)\/files$/) && req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/skills\/([^/]+)\/files$/);
    const skillName = decodeURIComponent(match[1]);
    const skillPath = findSkillPath(skillName);

    res.setHeader('Content-Type', 'application/json');
    if (!skillPath) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Skill not found' }));
    }

    try {
      const files = listSkillFiles(skillPath);
      return res.end(JSON.stringify({ path: skillPath, files }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // GET /api/skills/:name/files/:path - read a skill file
  if (url.pathname.match(/^\/api\/skills\/([^/]+)\/files\/(.+)$/) && req.method === 'GET') {
    const match = url.pathname.match(/^\/api\/skills\/([^/]+)\/files\/(.+)$/);
    const skillName = decodeURIComponent(match[1]);
    const filePath = decodeURIComponent(match[2]);
    const skillPath = findSkillPath(skillName);

    res.setHeader('Content-Type', 'application/json');
    if (!skillPath) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Skill not found' }));
    }

    const fullPath = path.resolve(skillPath, filePath);
    // Security: ensure path is within skill directory
    if (!fullPath.startsWith(skillPath)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      return res.end(JSON.stringify({ path: fullPath, content }));
    } catch (e) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'File not found' }));
    }
  }

  // PUT /api/skills/:name/files/:path - write a skill file
  if (url.pathname.match(/^\/api\/skills\/([^/]+)\/files\/(.+)$/) && req.method === 'PUT') {
    const match = url.pathname.match(/^\/api\/skills\/([^/]+)\/files\/(.+)$/);
    const skillName = decodeURIComponent(match[1]);
    const filePath = decodeURIComponent(match[2]);
    const skillPath = findSkillPath(skillName);

    res.setHeader('Content-Type', 'application/json');
    if (!skillPath) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Skill not found' }));
    }

    // Only allow writing to workspace/skills (not bundled)
    const workspaceSkillsDir = path.join(OPENCLAW_DATA, 'workspace/skills');
    if (!skillPath.startsWith(workspaceSkillsDir)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Cannot edit bundled skills. Copy to workspace/skills first.' }));
    }

    const fullPath = path.resolve(skillPath, filePath);
    // Security: ensure path is within skill directory
    if (!fullPath.startsWith(skillPath)) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Access denied' }));
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        // Ensure parent directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        return res.end(JSON.stringify({ ok: true, path: fullPath }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /api/skills/:name - uninstall a user-installed skill (removes directory)
  if (url.pathname.match(/^\/api\/skills\/([^/]+)$/) && req.method === 'DELETE') {
    const match = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
    const skillName = decodeURIComponent(match[1]);
    const skillPath = findSkillPath(skillName);

    res.setHeader('Content-Type', 'application/json');
    if (!skillPath) {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Skill not found' }));
    }

    // Only allow deleting from user skills directories, not bundled
    const userSkillsDirs = [
      path.join(OPENCLAW_DATA, 'workspace/skills'),
      path.join(OPENCLAW_DATA, 'skills')
    ];
    const isUserSkill = userSkillsDirs.some(d => skillPath.startsWith(d));
    if (!isUserSkill) {
      res.writeHead(403);
      return res.end(JSON.stringify({ error: 'Cannot uninstall bundled skills. Use Hide instead.' }));
    }

    try {
      fs.rmSync(skillPath, { recursive: true, force: true });
      return res.end(JSON.stringify({ ok: true, removed: skillPath }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  // ========== End Skills Files API ==========
  
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
  // Special-case: recent-activity.json lives under workspace/memory/ but the dashboard fetches it from /api/memory/recent-activity.json
  if (url.pathname === '/api/memory/recent-activity.json' && req.method === 'GET') {
    const primaryPath = path.resolve(MEMORY_DIR, 'recent-activity.json');
    const legacyPath = path.resolve(MEMORY_DIR, 'memory', 'recent-activity.json');

    let filePath = fs.existsSync(primaryPath) ? primaryPath : (fs.existsSync(legacyPath) ? legacyPath : null);

    res.setHeader('Content-Type', 'application/json');

    // If it doesn't exist yet, return an empty payload (avoid noisy 404 spam in console)
    if (!filePath) {
      return res.end(JSON.stringify({
        name: 'recent-activity.json',
        content: JSON.stringify({ updatedMs: 0, activities: [] }),
        modified: new Date(0).toISOString(),
        size: 0,
        botUpdated: false,
        botUpdatedAt: null,
        acknowledged: true
      }));
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      return res.end(JSON.stringify({
        name: 'recent-activity.json',
        content,
        modified: stat.mtime.toISOString(),
        size: stat.size,
        botUpdated: false,
        botUpdatedAt: null,
        acknowledged: true
      }));
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

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
        
        // Update mod time tracker so external change detector doesn't re-flag this write
        try {
          const newStat = fs.statSync(filePath);
          fileModTimes[filename] = newStat.mtime.getTime();
          saveModTimes();
        } catch (e) { /* best effort */ }
        
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
  
  // Get available models list (for dropdowns)
  if (url.pathname === '/api/models/list' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    let responseSent = false;
    
    // Primary: fetch from mounted OpenClaw config file (works across containers)
    fetchModelsFromConfig().then(configModels => {
      if (responseSent) return;
      if (configModels && Object.keys(configModels).length > 0) {
        responseSent = true;
        res.end(JSON.stringify(configModels));
        return;
      }
      
      // Fallback 1: try CLI (only works if solobot is installed locally)
      return fetchModelsFromCLI();
    }).then(cliModels => {
      if (responseSent) return;
      if (cliModels && Object.keys(cliModels).length > 0) {
        responseSent = true;
        res.end(JSON.stringify(cliModels));
        return;
      }
      
      // Fallback 2: check state file for cached models
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.availableModels) {
          responseSent = true;
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
      
      responseSent = true;
      res.end(JSON.stringify(models));
    }).catch(err => {
      if (responseSent) return;
      console.error('[Models] Error fetching models:', err);
      // Return minimal fallback on error
      responseSent = true;
      res.end(JSON.stringify({
        'openrouter': [{ id: 'openrouter/auto', name: 'Auto', tier: 'auto' }]
      }));
    });
    return;
  }
  
  // Sync models from gateway (called by frontend after WebSocket config fetch)
  // This allows the server to serve models even without a config file volume mount.
  if (url.pathname === '/api/models/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const models = JSON.parse(body);
        if (models && typeof models === 'object' && Object.keys(models).length > 0) {
          global._gatewayModelsCache = models;
          cachedModels = models;
          modelsLastFetched = Date.now();
          console.log(`[Models] Synced ${Object.values(models).flat().length} models from gateway WebSocket`);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid models data' }));
        }
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: e.message }));
      }
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
  
  // Test model endpoint - sends a test prompt to verify model is working
  if (url.pathname === '/api/models/test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const startTime = Date.now();
      try {
        const { model, prompt } = JSON.parse(body);
        if (!model) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'model is required' }));
          return;
        }

        console.log(`[Health] Testing model: ${model}`);
        
        // Use external gateway URL (containers aren't on same network)
        const gatewayUrl = process.env.GATEWAY_URL || 'https://solobot.sololink.cloud';
        const testPrompt = prompt || 'Say OK';
        
        const gatewayRes = await fetch(`${gatewayUrl}/api/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'chat.send',
            params: {
              sessionId: 'health-test-' + Date.now(),
              message: testPrompt,
              model: model
            }
          }),
          signal: AbortSignal.timeout(30000)
        });
        
        const latencyMs = Date.now() - startTime;
        
        if (!gatewayRes.ok) {
          const errText = await gatewayRes.text().catch(() => 'Unknown');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: `Gateway ${gatewayRes.status}`, latencyMs }));
          return;
        }
        
        const data = await gatewayRes.json();
        
        if (data.error) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: data.error.message || data.error, latencyMs }));
          return;
        }
        
        console.log(`[Health] Model ${model} OK in ${latencyMs}ms`);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, latencyMs, model }));

      } catch (e) {
        const latencyMs = Date.now() - startTime;
        console.error('[Health] Model test error:', e.message);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: e.message || 'Connection failed', latencyMs }));
      }
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

        // Update OpenClaw config file directly — try all known paths
        const openclawConfigPath = [OPENCLAW_CONFIG_PATH, OPENCLAW_CONFIG_FALLBACK, OPENCLAW_CONFIG_FALLBACK2].find(p => fs.existsSync(p));
        let configUpdated = false;

        try {
          if (openclawConfigPath) {
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
            console.warn('[Server] OpenClaw config not found at any known path');
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

  // Set per-agent model override
  if (url.pathname === '/api/models/set-agent' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { agentId, modelId } = JSON.parse(body);
        if (!agentId || !modelId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'agentId and modelId are required' }));
          return;
        }

        // Try to update config file if available
        const configPath = [OPENCLAW_CONFIG_PATH, OPENCLAW_CONFIG_FALLBACK, OPENCLAW_CONFIG_FALLBACK2]
          .find(p => fs.existsSync(p));

        if (configPath) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

          if (config.agents?.list) {
            const agent = config.agents.list.find(a => a.id === agentId);
            if (agent) {
              if (modelId === 'global/default') {
                delete agent.model;
                console.log(`[Server] Cleared model override for agent ${agentId}`);
              } else {
                agent.model = modelId;
                console.log(`[Server] Set model for agent ${agentId}: ${modelId}`);
              }
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            }
          }
        } else {
          // No config file available (Docker without volume mount)
          // The frontend handles this via gateway WebSocket (sessions.patch)
          console.log(`[Server] No config file available — model change for ${agentId} handled by gateway WebSocket`);
        }

        // Clear model cache so next fetch picks up changes
        cachedModels = null;

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, agentId, modelId, message: 'Agent model updated.' }));
      } catch (e) {
        console.error('[Server] Failed to set agent model:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Get current model endpoint
  if (url.pathname === '/api/models/current' && req.method === 'GET') {
    // Get current model — OpenClaw config is the source of truth
    // Check for per-agent model override first
    const urlParams = new URLSearchParams(url.search);
    const requestedAgentId = urlParams.get('agentId');
    
    try {
      let modelInfo = null;
      
      // 0. Check for per-agent model override (if agentId provided)
      if (requestedAgentId) {
        const configPaths = [
          OPENCLAW_CONFIG_PATH,
          OPENCLAW_CONFIG_FALLBACK,
        ];
        for (const configPath of configPaths) {
          try {
            if (fs.existsSync(configPath)) {
              const oc = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              // Check agent-specific model override
              const agentModel = oc?.agents?.[requestedAgentId]?.model;
              if (agentModel && agentModel !== 'global/default') {
                modelInfo = {
                  modelId: agentModel,
                  provider: agentModel.split('/')[0],
                  name: agentModel.split('/').pop(),
                  agentId: requestedAgentId,
                  isOverride: true
                };
                console.log(`[Models] Per-agent model for ${requestedAgentId}: ${agentModel}`);
                break;
              }
            }
          } catch (e) { /* try next path */ }
        }
      }
      
      // 1. Primary: read from OpenClaw config (the actual source of truth)
      if (!modelInfo) {
        const configPaths = [
          OPENCLAW_CONFIG_PATH,       // ./openclaw/openclaw.json (Coolify volume mount)
          OPENCLAW_CONFIG_FALLBACK,   // /home/node/.openclaw/openclaw.json (local)
        ];
        for (const configPath of configPaths) {
          try {
            if (fs.existsSync(configPath)) {
              const oc = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              const primary = oc?.agents?.defaults?.model?.primary;
              if (primary) {
                modelInfo = {
                  modelId: primary,
                  provider: primary.split('/')[0],
                  name: primary.split('/').pop()
                };
                console.log(`[Models] Current model from config: ${primary} (${configPath})`);
                break;
              }
            }
          } catch (e) { /* try next path */ }
        }
      }
      
      // 2. Fallback: check gateway-synced models cache for the primary (starred) model
      if (!modelInfo && global._gatewayModelsCache) {
        for (const [provider, models] of Object.entries(global._gatewayModelsCache)) {
          const primary = models.find(m => m.tier === 'default' || m.name?.includes('⭐'));
          if (primary) {
            modelInfo = {
              modelId: primary.id,
              provider: primary.id.split('/')[0],
              name: primary.id.split('/').pop()
            };
            break;
          }
        }
      }
      
      // 3. Fallback: check state.json
      if (!modelInfo) {
        try {
          const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
          if (state.currentModel?.modelId) {
            modelInfo = state.currentModel;
          }
        } catch (e) { /* continue */ }
      }
      
      // 4. Hardcoded fallback
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
        modelInfo.provider = modelInfo.modelId.split('/')[0];
        modelInfo.name = modelInfo.modelId.split('/').pop();
      }
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(modelInfo));
    } catch (e) {
      console.error('[Server] Failed to get current model:', e.message);
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
  
  // Clear device identity endpoint
  if (url.pathname === '/api/clear-device-identity' && req.method === 'POST') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ 
      ok: true, 
      message: 'Device identity cleared. Please refresh the page to regenerate.' 
    }));
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
  
  // Session delete endpoint
  if (url.pathname === '/api/session/delete' && req.method === 'POST') {
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
        console.log(`[Server] Session delete requested: ${sessionKey}`);
        // Store delete request in state for agent to apply
        state.sessionDeleteRequest = { sessionKey, requestedAt: Date.now() };
        saveState();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, message: 'Delete requested. SoLoBot will apply it.' }));
      } catch (e) {
        console.error('[Server] Failed to request session delete:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Failed to request session delete', details: e.message }));
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
    const sessions = loadSessionsFromOpenClaw();
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
      const sessions = loadSessionsFromOpenClaw();
      console.log(`[Server] Available sessions: ${sessions.map(s => s.key).join(', ')}`);
      
      const sessionInfo = sessions.find(s => s.key === sessionKey);
      
      if (!sessionInfo?.sessionId) {
        console.log(`[Server] Session not found: ${sessionKey}`);
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Session not found', sessionKey }));
        return;
      }
      
      // Read transcript file from the correct agent's sessions folder
      const agent = sessionInfo._agent || 'main';
      const transcriptCandidates = [
        path.join(OPENCLAW_DATA, 'agents', agent, 'sessions', `${sessionInfo.sessionId}.jsonl`),
        path.join('/app/sessions', `${sessionInfo.sessionId}.jsonl`),  // legacy fallback
      ];
      const transcriptPath = transcriptCandidates.find(p => fs.existsSync(p));
      console.log(`[Server] Looking for transcript for agent=${agent}, tried: ${transcriptCandidates.join(', ')}, found: ${transcriptPath || 'none'}`);
      
      if (!transcriptPath) {
        console.log(`[Server] Transcript not found for session ${sessionInfo.sessionId}`);
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Transcript not found', tried: transcriptCandidates }));
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
    const content = fs.readFileSync(filePath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    
    // Dynamic assets (HTML, JS, CSS) — always revalidate so updates appear instantly
    if (['.html', '.js', '.css'].includes(ext)) {
      const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      res.setHeader('ETag', `"${hash}"`);
      
      // If browser sends matching ETag, return 304 Not Modified
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === `"${hash}"`) {
        res.writeHead(304);
        return res.end();
      }
    } else {
      // Static assets (images, fonts) — cache for 1 hour
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    
    return res.end(content);
  }
  
  // Page routing: assemble pages from partials
  const pageRoutes = {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/memory': 'memory',
    '/chat': 'chat',
    '/system': 'system',
    '/products': 'products',
    '/business': 'business',
    '/cron': 'cron',
    '/security': 'security',
    '/skills': 'skills',
  };

  const pageName = pageRoutes[url.pathname];
  if (!pageName && !url.pathname.startsWith('/api/')) {
    // Unknown non-API route — default to dashboard
  }

  const resolvedPage = pageName || 'dashboard';
  const pageContent = assemblePage(resolvedPage);
  const pageHash = crypto.createHash('md5').update(pageContent).digest('hex').slice(0, 12);
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('ETag', `"${pageHash}"`);
  
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch === `"${pageHash}"`) {
    res.writeHead(304);
    return res.end();
  }
  return res.end(pageContent);
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
