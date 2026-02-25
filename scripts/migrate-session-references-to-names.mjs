#!/usr/bin/env node
import fs from 'fs';

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
const SESSION_REF_REGEX = new RegExp(`agent:(${LEGACY_IDS.join('|')}):`, 'g');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const files = args.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('Usage: node scripts/migrate-session-references-to-names.mjs [--apply] <file1.json> <file2.json> ...');
  process.exit(1);
}

function transformString(value) {
    if (typeof value !== 'string') return value;
    return value.replace(SESSION_REF_REGEX, (_, id) => `agent:${ROLE_TO_NAME[id] || id}:`);
}

function canonicalizeSessionKey(key) {
  if (typeof key !== 'string') return key;
  const match = key.match(/^agent:([^:]+):(.+)$/);
  if (!match) return key;
  const agentId = String(match[1] || '').toLowerCase();
  const canonical = ROLE_TO_NAME[agentId] || agentId;
  if (canonical === agentId) return key;
  return `agent:${canonical}:${match[2]}`;
}

function deepTransform(value) {
  if (typeof value === 'string') return transformString(value);
  if (Array.isArray(value)) return value.map((v) => deepTransform(v));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = canonicalizeSessionKey(k);
    const nextValue = deepTransform(v);
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      const existing = out[key];
      if (Array.isArray(existing) && Array.isArray(nextValue)) {
        out[key] = [...existing, ...nextValue];
      } else if (existing && typeof existing === 'object' && nextValue && typeof nextValue === 'object') {
        out[key] = { ...existing, ...nextValue };
      } else {
        out[key] = nextValue;
      }
    } else {
      out[key] = nextValue;
    }
  }
  return out;
}

for (const filePath of files) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[migrate-ref] Skip missing file: ${filePath}`);
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const transformed = deepTransform(parsed);

  const before = JSON.stringify(parsed);
  const after = JSON.stringify(transformed);
  if (before === after) {
    console.log(`[migrate-ref] No change: ${filePath}`);
    continue;
  }

  if (!apply) {
    console.log(`[migrate-ref] Would update: ${filePath}`);
    continue;
  }

  const backupPath = `${filePath}.bak-name-ref-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, `${JSON.stringify(transformed, null, 2)}\n`);
  console.log(`[migrate-ref] Updated: ${filePath}`);
  console.log(`[migrate-ref] Backup:  ${backupPath}`);
}
