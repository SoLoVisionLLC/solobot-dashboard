#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROLE_TO_NAME = {
  exec: 'elon',
  cto: 'orion',
  coo: 'atlas',
  cfo: 'sterling',
  cmp: 'vector',
  devops: 'forge',
  ui: 'quill',
  swe: 'chip',
  youtube: 'snip',
  veo: 'snip',
  veoflow: 'snip',
  sec: 'knox',
  net: 'sentinel',
  smm: 'nova',
  docs: 'canon',
  tax: 'ledger',
  family: 'haven',
  creative: 'luma',
  art: 'luma',
  halo: 'main'
};

const LEGACY_IDS = Object.keys(ROLE_TO_NAME);
const LEGACY_KEY_REGEX = new RegExp(`agent:(${LEGACY_IDS.join('|')}):`, 'g');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const homeArg = args.find((a) => a.startsWith('--home='));
const openclawHome = homeArg ? homeArg.split('=').slice(1).join('=') : path.join(os.homedir(), '.openclaw');
const agentsRoot = path.join(openclawHome, 'agents');

function canonicalizeSessionKey(key) {
  if (typeof key !== 'string') return key;
  const match = key.match(/^agent:([^:]+):(.+)$/);
  if (!match) return key;
  const agentId = String(match[1] || '').toLowerCase();
  const suffix = match[2];
  const canonical = ROLE_TO_NAME[agentId] || agentId;
  if (canonical === agentId) return key;
  return `agent:${canonical}:${suffix}`;
}

function transformString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(LEGACY_KEY_REGEX, (_, id) => `agent:${ROLE_TO_NAME[id] || id}:`);
}

function deepTransform(value) {
  if (typeof value === 'string') return transformString(value);
  if (Array.isArray(value)) return value.map((v) => deepTransform(v));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = deepTransform(v);
  }
  return out;
}

function valueToTs(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function mergeEntries(a, b) {
  const aTs = valueToTs(a?.updatedAt);
  const bTs = valueToTs(b?.updatedAt);
  const newest = bTs >= aTs ? b : a;
  const oldest = newest === b ? a : b;
  return { ...oldest, ...newest };
}

function uniqueLegacyKey(baseObj, canonicalAgentId, oldAgentId, suffix, sessionId) {
  const seed = String(sessionId || '').slice(0, 8) || 'nosid';
  let key = `agent:${canonicalAgentId}:legacy-${oldAgentId}-${seed}-${suffix.replace(/[:\s]+/g, '-')}`;
  let i = 1;
  while (Object.prototype.hasOwnProperty.call(baseObj, key)) {
    i += 1;
    key = `agent:${canonicalAgentId}:legacy-${oldAgentId}-${seed}-${i}-${suffix.replace(/[:\s]+/g, '-')}`;
  }
  return key;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  if (!fs.existsSync(agentsRoot)) {
    console.error(`[migrate] Agents folder not found: ${agentsRoot}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(agentsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  const files = entries
    .map((d) => path.join(agentsRoot, d.name, 'sessions', 'sessions.json'))
    .filter((p) => fs.existsSync(p));

  if (!files.length) {
    console.log('[migrate] No sessions.json files found.');
    return;
  }

  let totalFilesChanged = 0;
  let totalKeysChanged = 0;
  let totalCollisions = 0;

  console.log(`[migrate] Scanning ${files.length} session files under ${agentsRoot}`);

  for (const filePath of files) {
    const raw = loadJson(filePath);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const output = {};
    let changed = false;
    let keyChanges = 0;
    let collisions = 0;

    for (const [oldKey, oldVal] of Object.entries(raw)) {
      const canonicalKey = canonicalizeSessionKey(oldKey);
      const transformedVal = deepTransform(oldVal);
      const oldAgent = String(oldKey.split(':')[1] || '').toLowerCase();
      const canonicalAgent = String(canonicalKey.split(':')[1] || '').toLowerCase();
      const suffix = oldKey.includes(':') ? oldKey.split(':').slice(2).join(':') : oldKey;

      let targetKey = canonicalKey;

      if (targetKey !== oldKey) {
        changed = true;
        keyChanges += 1;
      }

      if (Object.prototype.hasOwnProperty.call(output, targetKey)) {
        const existing = output[targetKey];
        if (existing?.sessionId && transformedVal?.sessionId && existing.sessionId !== transformedVal.sessionId) {
          collisions += 1;
          totalCollisions += 1;
          targetKey = uniqueLegacyKey(output, canonicalAgent, oldAgent, suffix, transformedVal.sessionId);
          changed = true;
        } else {
          output[targetKey] = mergeEntries(existing, transformedVal);
          continue;
        }
      }

      output[targetKey] = transformedVal;
    }

    const rawPretty = JSON.stringify(raw, null, 2);
    const outPretty = JSON.stringify(output, null, 2);
    if (!changed && rawPretty === outPretty) continue;

    totalFilesChanged += 1;
    totalKeysChanged += keyChanges;

    if (apply) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}.bak-name-migration-${timestamp}`;
      fs.copyFileSync(filePath, backupPath);
      fs.writeFileSync(filePath, `${outPretty}\n`);
      console.log(`[migrate] Updated ${filePath} (keys changed: ${keyChanges}, collisions: ${collisions})`);
      console.log(`[migrate] Backup: ${backupPath}`);
    } else {
      console.log(`[migrate] Would update ${filePath} (keys changed: ${keyChanges}, collisions: ${collisions})`);
    }
  }

  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[migrate] ${mode} complete`);
  console.log(`[migrate] Files changed: ${totalFilesChanged}`);
  console.log(`[migrate] Keys migrated: ${totalKeysChanged}`);
  console.log(`[migrate] Key collisions handled: ${totalCollisions}`);
}

main();
