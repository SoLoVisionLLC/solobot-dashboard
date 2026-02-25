#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || '/home/solo', '.openclaw');
const TZ = process.env.TZ_OVERRIDE || 'America/Detroit';

const AGENT_ALIAS = {
  main: 'main', halo: 'main',
  exec: 'elon', elon: 'elon',
  cto: 'orion', orion: 'orion',
  coo: 'atlas', atlas: 'atlas',
  cfo: 'sterling', sterling: 'sterling',
  cmp: 'vector', vector: 'vector',
  dev: 'dev', devops: 'forge', forge: 'forge',
  sec: 'knox', knox: 'knox',
  net: 'sentinel', sentinel: 'sentinel',
  docs: 'canon', canon: 'canon',
  art: 'luma', creative: 'luma', luma: 'luma',
  tax: 'ledger', ledger: 'ledger',
  ui: 'quill', quill: 'quill',
  swe: 'chip', chip: 'chip',
  smm: 'nova', nova: 'nova',
  youtube: 'snip', veo: 'snip', veoflow: 'snip', snip: 'snip',
  family: 'haven', haven: 'haven'
};

const canonical = (v) => AGENT_ALIAS[String(v || '').toLowerCase().trim()] || String(v || '').toLowerCase().trim();

function dayKey(ts, tz = TZ) {
  const d = new Date(ts || 0);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}

function normalizeRole(msg) {
  const role = String(msg?.role || '').toLowerCase();
  const from = String(msg?.from || '').toLowerCase();
  if (role) return role;
  if (from === 'assistant' || from === 'bot') return 'assistant';
  if (from === 'user' || from === 'human') return 'user';
  return 'unknown';
}

function normalizeTime(msg) {
  const candidates = [msg?.time, msg?.timestamp, msg?.createdAt, msg?.created_at];
  for (const c of candidates) {
    const t = new Date(c || 0).getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

function textOf(msg) {
  if (typeof msg?.text === 'string') return msg.text;
  if (typeof msg?.content === 'string') return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.map(p => (p && p.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
  }
  return '';
}

function isNoise(msg) {
  const role = normalizeRole(msg);
  const text = textOf(msg).trim().toLowerCase();
  if (!text) return true;
  if (role === 'system') return true;
  if (role !== 'assistant' && role !== 'user') return true;
  if (['heartbeat_ok', 'announce_skip', 'no_reply', '[read-sync]', '[[read_ack]]'].includes(text)) return true;
  if (/(keepalive|heartbeat check|agent-to-agent announce step|continue where you left off|retry heartbeat|wake request)/i.test(text)) return true;
  if (/^\[inter-session message\]/i.test(textOf(msg).trim())) return true;
  return false;
}

function loadSessions() {
  const sessions = [];
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  if (!fs.existsSync(agentsDir)) return sessions;
  for (const agent of fs.readdirSync(agentsDir)) {
    const p = path.join(agentsDir, agent, 'sessions', 'sessions.json');
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [key, entry] of Object.entries(data || {})) {
        sessions.push({ key, sessionId: entry?.sessionId, agent });
      }
    } catch {}
  }
  return sessions;
}

function gatherRawToday(agentId) {
  const target = canonical(agentId);
  const today = dayKey(Date.now());
  const seen = new Set();
  let count = 0;

  const sessions = loadSessions().filter(s => canonical((s.key.match(/^agent:([^:]+):/i) || [])[1]) === target);
  for (const s of sessions) {
    if (!s.sessionId) continue;
    const p = path.join(OPENCLAW_HOME, 'agents', s.agent, 'sessions', `${s.sessionId}.jsonl`);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type !== 'message' || !obj?.message) continue;
      const msg = obj.message;
      if (isNoise(msg)) continue;
      const ts = normalizeTime(msg);
      if (dayKey(ts) !== today) continue;
      const key = msg.id || `${s.key}|${ts}|${normalizeRole(msg)}|${textOf(msg).slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
  }

  return count;
}

async function main() {
  const agentId = process.argv[2] || 'orion';
  const endpoint = process.env.METRICS_URL || `http://localhost:3000/api/agents/${encodeURIComponent(agentId)}/metrics?range=today`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Endpoint failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  const rawCount = gatherRawToday(agentId);

  const pass = Number(data.msgsToday || 0) === rawCount;
  console.log(JSON.stringify({
    agentId,
    endpoint,
    endpointMsgsToday: data.msgsToday,
    rawMsgsToday: rawCount,
    pass,
    metrics: data
  }, null, 2));

  if (!pass) process.exit(2);
}

main().catch((e) => {
  console.error('[verify-agent-metrics] FAILED:', e.message);
  process.exit(1);
});
