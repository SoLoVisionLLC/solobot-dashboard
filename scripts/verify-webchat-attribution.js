#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/notifications.js', 'utf8');
const sandbox = {
  console,
  window: {
    __notificationsRuntimeMark: null,
    resolveAgentId: (id) => ({ cto: 'orion', ui: 'quill' }[id] || id),
    currentAgentId: 'main',
    _chatPendingSends: new Map(),
    addEventListener() {},
    removeEventListener() {},
  },
  currentSessionName: 'agent:main:webchat-alpha',
  GATEWAY_CONFIG: { sessionKey: 'agent:main:webchat-alpha', maxMessages: 500 },
  getAgentDisplayName: (id) => ({ orion: 'Orion', quill: 'Quill', main: 'Halo' }[id] || id),
  normalizeDashboardSessionKey: (key) => !key || key === 'main' ? 'agent:main:main' : String(key),
  setTimeout() {},
  clearTimeout() {},
  document: { addEventListener() {}, removeEventListener() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
};
sandbox.globalThis = sandbox;

vm.runInNewContext(source, sandbox, { filename: 'js/notifications.js' });
const hooks = sandbox.window._webchatAttributionTestHooks;
if (!hooks) throw new Error('webchat attribution hooks not registered');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sameSession = hooks.resolveInterSessionMeta({
  sessionKey: 'agent:main:webchat-alpha',
  targetSession: 'agent:main:webchat-alpha',
  sourceSession: 'agent:orion:main',
  sourceAgentName: 'Orion',
  conversationKey: 'webchat-convo-alpha',
  userKey: 'visitor-alpha',
}, null, 'agent:main:webchat-alpha');
assert(sameSession, 'expected attribution for matching webchat session');
assert(sameSession._sourceAgent === 'orion', 'expected canonical source agent');
assert(sameSession._targetSession === 'agent:main:webchat-alpha', 'expected target session stamp');
assert(sameSession._conversationKey === 'webchat-convo-alpha', 'expected conversation stamp');
assert(sameSession._userKey === 'visitor-alpha', 'expected user stamp');

const wrongSession = hooks.resolveInterSessionMeta({
  sessionKey: 'agent:main:webchat-beta',
  targetSession: 'agent:main:webchat-beta',
  sourceSession: 'agent:quill:main',
  sourceAgentName: 'Quill',
  conversationKey: 'webchat-convo-beta',
  userKey: 'visitor-beta',
}, null, 'agent:main:webchat-alpha');
assert(wrongSession === null, 'must reject attribution scoped to another webchat session');

const displayOnly = hooks.resolveInterSessionMeta({
  sourceAgentName: 'Orion',
}, null, 'agent:main:webchat-alpha');
assert(displayOnly === null, 'must reject unscoped bare display-name attribution');

console.log('webchat attribution verification passed: same-session accepted, cross-session rejected, unscoped display-name rejected');
