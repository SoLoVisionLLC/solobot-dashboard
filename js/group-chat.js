// js/group-chat.js — Group Messaging for SoLoBot Dashboard
// Mirrors the Android app's group messaging architecture:
// - Local group rooms stored in localStorage
// - Relay sessions per agent: agent:<id>:room:<slug>-<suffix>
// - Reply syncing via polling
// - Targeting: @all, @agent, or continue with most recent

const GROUP_CHAT_DEBUG = true;
function gLog(...args) { if (GROUP_CHAT_DEBUG) console.log('[GroupChat]', ...args); }

// =================== CONSTANTS ===================
const LOCAL_ROOM_KEY = 'solobot_group_rooms_v1';
const ROOM_READ_STATE_KEY = 'solobot_room_read_state_v1';
const GROUP_POLL_INTERVAL = 2500; // ms
const MAX_TRANSCRIPT_CONTEXT = 12;
const AWAIT_REPLIES_MAX_ATTEMPTS = 6;
const AWAIT_REPLIES_DELAY_MS = 1000;

// =================== STATE ===================
window.groupChatState = window.groupChatState || {
  rooms: new Map(),        // roomId -> CollaborationRoom
  messages: new Map(),     // roomId -> RoomMessage[]
  sessionKeys: new Map(),  // roomId -> { agentId -> sessionKey }
  memberNames: new Map(),  // roomId -> { agentId -> displayName }
  replyCursors: new Map(), // roomId -> { agentId -> lastMirroredKey }
  selectedRoomId: null,
  isPolling: false,
  pollTimer: null,
  showInternal: false,
};

// =================== DATA MODELS ===================
function createRoomId() {
  return `local-room-${Date.now()}`;
}

function createRelaySessionKey(agentId, roomId, roomTitle) {
  const slug = (roomTitle || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const suffix = roomId.replace('local-room-', '');
  return `agent:${agentId}:room:${slug}-${suffix}`;
}

function buildAgentAliases(agentId, displayName) {
  const aliases = new Set([agentId.toLowerCase()]);
  if (displayName) {
    const parts = displayName.toLowerCase().split(/[\s()]+/).filter(Boolean);
    parts.forEach(p => aliases.add(p));
  }
  return Array.from(aliases);
}

// =================== PERSISTENCE ===================
function messageIdentity(message, index = 0) {
  return message?.id || message?.messageKey || message?.key || message?._remoteKey || `message-${index}`;
}

function messageText(message) {
  return String(message?.text ?? message?.body ?? '').trim();
}

function messageSender(message) {
  return String(message?.from ?? message?.senderName ?? message?.senderId ?? 'Unknown').trim() || 'Unknown';
}

function messageTimestamp(message) {
  return message?.time || message?.timestampMs || message?.timestamp || Date.now();
}

function normalizeGroupMessage(message, index = 0) {
  const id = messageIdentity(message, index);
  const text = messageText(message);
  const senderType = String(message?.senderType || '').trim().toUpperCase()
    || (String(message?.from || '').toLowerCase() === 'solo' ? 'USER' : 'AGENT');
  const fromAgentId = message?.fromAgentId || (senderType === 'AGENT' ? message?.senderId : undefined);
  const from = messageSender(message);
  const time = messageTimestamp(message);

  return {
    ...message,
    id,
    key: message?.key || message?.messageKey || id,
    messageKey: message?.messageKey || message?.key || id,
    text,
    body: message?.body ?? text,
    from,
    senderName: message?.senderName || from,
    senderId: message?.senderId || fromAgentId || (senderType === 'USER' ? 'solo' : from),
    senderRole: message?.senderRole || (senderType === 'USER' ? 'Operator' : senderType === 'SYSTEM' ? 'System' : 'Agent'),
    senderType,
    time,
    timestampMs: message?.timestampMs || time,
    timestampLabel: message?.timestampLabel || 'Now',
    fromAgentId,
    spoken: Boolean(message?.spoken),
    internal: Boolean(message?.internal),
  };
}

function normalizeGroupMessages(messages) {
  const seen = new Set();
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeGroupMessage)
    .filter(message => {
      const text = messageText(message);
      if (typeof isSystemMessage === 'function' && isSystemMessage(text, message.from || message.senderName || message.senderId)) return false;
      if (!message.internal && message.senderType === 'AGENT' && !text) return false;
      const key = messageIdentity(message);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeGroupRoom(room) {
  const memberIds = Array.isArray(room?.memberIds) ? room.memberIds : (Array.isArray(room?.members) ? room.members : []);
  return {
    ...room,
    id: room?.id,
    title: room?.title || 'Untitled room',
    purpose: room?.purpose || '',
    memberIds,
    members: memberIds,
    unreadCount: Number.isFinite(room?.unreadCount) ? room.unreadCount : 0,
    active: room?.active !== false,
    voiceMode: room?.voiceMode || 'Auto',
    lastActivity: room?.lastActivity || 'Now',
    createdAt: Number.isFinite(room?.createdAt) ? room.createdAt : Date.now(),
    isLocal: room?.isLocal !== false,
  };
}

function buildGroupRoomsSnapshot() {
  return {
    rooms: Array.from(groupChatState.rooms.values()).map(normalizeGroupRoom).filter(room => room.id),
    messages: Object.fromEntries(
      Array.from(groupChatState.messages.entries()).map(([roomId, messages]) => [roomId, normalizeGroupMessages(messages)])
    ),
    sessionKeys: Object.fromEntries(groupChatState.sessionKeys),
    memberNames: Object.fromEntries(groupChatState.memberNames),
    replyCursors: Object.fromEntries(groupChatState.replyCursors),
    updatedAt: Date.now(),
    version: 1,
  };
}

function applyGroupRoomsSnapshot(snapshot) {
  groupChatState.rooms = new Map();
  groupChatState.messages = new Map();
  groupChatState.sessionKeys = new Map();
  groupChatState.memberNames = new Map();
  groupChatState.replyCursors = new Map();

  if (Array.isArray(snapshot?.rooms)) {
    snapshot.rooms.map(normalizeGroupRoom).filter(r => r.id).forEach(r => groupChatState.rooms.set(r.id, r));
  }
  if (snapshot?.messages) {
    Object.entries(snapshot.messages).forEach(([k, v]) => groupChatState.messages.set(k, normalizeGroupMessages(v)));
  }
  if (snapshot?.sessionKeys) {
    Object.entries(snapshot.sessionKeys).forEach(([k, v]) => groupChatState.sessionKeys.set(k, v));
  }
  if (snapshot?.memberNames) {
    Object.entries(snapshot.memberNames).forEach(([k, v]) => groupChatState.memberNames.set(k, v));
  }
  if (snapshot?.replyCursors) {
    Object.entries(snapshot.replyCursors).forEach(([k, v]) => groupChatState.replyCursors.set(k, v));
  }
}

async function persistGroupRooms() {
  try {
    const snapshot = buildGroupRoomsSnapshot();
    localStorage.setItem(LOCAL_ROOM_KEY, JSON.stringify(snapshot));
    try {
      await fetch('/api/group-rooms-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
    } catch (networkError) {
      console.warn('[GroupChat] Server sync failed, kept local cache only:', networkError);
    }
    gLog('Persisted group rooms:', groupChatState.rooms.size);
  } catch (e) {
    console.error('[GroupChat] Failed to persist:', e);
  }
}

async function loadGroupRooms() {
  let loaded = false;

  try {
    const response = await fetch('/api/group-rooms-state', { cache: 'no-store' });
    if (response.ok) {
      const snapshot = await response.json();
      if (snapshot && (Array.isArray(snapshot.rooms) || snapshot.messages || snapshot.sessionKeys)) {
        applyGroupRoomsSnapshot(snapshot);
        localStorage.setItem(LOCAL_ROOM_KEY, JSON.stringify(snapshot));
        loaded = true;
      }
    }
  } catch (e) {
    console.warn('[GroupChat] Server load failed, falling back to local cache:', e);
  }

  if (!loaded) {
    try {
      const raw = localStorage.getItem(LOCAL_ROOM_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      if (!snapshot) return;
      applyGroupRoomsSnapshot(snapshot);
      loaded = true;
    } catch (e) {
      console.error('[GroupChat] Failed to load:', e);
      return;
    }
  }

  gLog('Loaded group rooms:', groupChatState.rooms.size);
}

function getRoomReadState(roomId) {
  try {
    const raw = localStorage.getItem(ROOM_READ_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    return state[roomId] || null;
  } catch { return null; }
}

function setRoomReadState(roomId, lastReadKey) {
  try {
    const raw = localStorage.getItem(ROOM_READ_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[roomId] = lastReadKey;
    localStorage.setItem(ROOM_READ_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// =================== ROOM MANAGEMENT ===================
function createGroupRoom(title, purpose, selectedAgentIds) {
  if (!title?.trim()) { showToast('Room name is required', 'warning'); return null; }
  if (!selectedAgentIds?.length) { showToast('Select at least one agent', 'warning'); return null; }

  const roomId = createRoomId();
  const room = {
    id: roomId,
    title: title.trim(),
    purpose: purpose?.trim() || '',
    memberIds: selectedAgentIds,
    createdAt: Date.now(),
    isLocal: true,
  };

  // Build relay session keys and member names
  const sessionMap = {};
  const nameMap = {};
  selectedAgentIds.forEach(agentId => {
    sessionMap[agentId] = createRelaySessionKey(agentId, roomId, room.title);
    nameMap[agentId] = getAgentDisplayName(agentId);
  });

  groupChatState.rooms.set(roomId, room);
  groupChatState.messages.set(roomId, []);
  groupChatState.sessionKeys.set(roomId, sessionMap);
  groupChatState.memberNames.set(roomId, nameMap);
  groupChatState.replyCursors.set(roomId, {});

  // Add initial system message
  const initialMessage = {
    id: `local-room-${roomId}-init`,
    key: 'init',
    text: `Group room "${room.title}" created. Members: ${selectedAgentIds.map(id => nameMap[id]).join(', ')}`,
    from: 'system',
    senderType: 'SYSTEM',
    time: Date.now(),
    internal: true,
  };
  groupChatState.messages.get(roomId).push(initialMessage);

  // Snapshot initial cursor positions (so old messages don't get mirrored)
  snapshotReplyCursors(roomId);

  persistGroupRooms();
  gLog('Created room:', roomId, 'with members:', selectedAgentIds);
  return room;
}

async function snapshotReplyCursors(roomId) {
  const cursors = {};
  const sessionMap = groupChatState.sessionKeys.get(roomId) || {};

  for (const [agentId, sessionKey] of Object.entries(sessionMap)) {
    try {
      const latest = await latestAssistantMessageKey(sessionKey);
      cursors[agentId] = latest;
      gLog('Cursor snapshot for', agentId, ':', latest);
    } catch (e) {
      gLog('Failed to snapshot cursor for', agentId, ':', e.message);
      cursors[agentId] = null;
    }
  }

  groupChatState.replyCursors.set(roomId, cursors);
  persistGroupRooms();
}

async function latestAssistantMessageKey(sessionKey) {
  if (!gateway || !gateway.isConnected()) return null;
  try {
    const history = await gateway.loadHistory(sessionKey);
    const messages = history?.messages || history?.history || [];
    const assistantMsgs = messages.filter(m => {
      const role = String(m?.role || m?.from || '').toLowerCase();
      return role === 'assistant' || role === 'solobot' || role === 'agent';
    });
    if (assistantMsgs.length === 0) return null;
    const latest = assistantMsgs[assistantMsgs.length - 1];
    return latest?.id || latest?.key || latest?.messageId || `msg-${latest?.time || Date.now()}`;
  } catch (e) {
    return null;
  }
}

async function deleteGroupRoom(roomId) {
  const room = groupChatState.rooms.get(roomId);
  if (!room) return false;

  const sessionMap = groupChatState.sessionKeys.get(roomId) || {};
  const errors = [];

  // Delete all relay sessions
  for (const [agentId, sessionKey] of Object.entries(sessionMap)) {
    try {
      await deleteGatewaySession(sessionKey);
      gLog('Deleted relay session:', sessionKey);
    } catch (e) {
      gLog('Failed to delete relay session:', sessionKey, e.message);
      errors.push({ agentId, sessionKey, error: e.message });
    }
  }

  if (errors.length > 0 && Object.keys(sessionMap).length > 0) {
    showToast(`Failed to delete ${errors.length} relay session(s). Room kept for retry.`, 'error');
    return false;
  }

  // Clean up local state
  groupChatState.rooms.delete(roomId);
  groupChatState.messages.delete(roomId);
  groupChatState.sessionKeys.delete(roomId);
  groupChatState.memberNames.delete(roomId);
  groupChatState.replyCursors.delete(roomId);

  if (groupChatState.selectedRoomId === roomId) {
    groupChatState.selectedRoomId = null;
  }

  persistGroupRooms();
  gLog('Deleted room:', roomId);
  return true;
}

async function deleteGatewaySession(sessionKey) {
  if (!gateway || !gateway.isConnected()) {
    throw new Error('Gateway not connected');
  }
  try {
    const result = await gateway.request('sessions.delete', { sessionKey });
    if (result && result.ok) return true;
    throw new Error(result?.error || 'Unknown error');
  } catch (e) {
    // Try fallback method
    try {
      await gateway._request('sessions.delete', { sessionKey });
      return true;
    } catch (e2) {
      throw new Error(e2.message || e.message);
    }
  }
}

// =================== TARGETING ===================
function resolveLocalRoomTargets(roomId, text) {
  const room = groupChatState.rooms.get(roomId);
  if (!room) return [];
  if (room.memberIds.length === 1) return room.memberIds;

  const lowerText = (text || '').toLowerCase();
  const memberNames = groupChatState.memberNames.get(roomId) || {};

  // Check for broadcast phrases
  const broadcastPhrases = ['@all', 'everyone', 'everybody', 'all of you', 'whole team', 'entire team'];
  if (broadcastPhrases.some(p => lowerText.includes(p))) {
    gLog('Broadcast targeting all members');
    return room.memberIds;
  }

  // Check for explicit @mentions or agent aliases
  const mentioned = new Set();
  for (const agentId of room.memberIds) {
    const aliases = buildAgentAliases(agentId, memberNames[agentId]);
    for (const alias of aliases) {
      if (lowerText.includes(`@${alias}`) || lowerText.includes(` ${alias} `) || lowerText.startsWith(`${alias} `)) {
        mentioned.add(agentId);
        break;
      }
    }
  }
  if (mentioned.size > 0) {
    gLog('Explicit targets:', Array.from(mentioned));
    return Array.from(mentioned);
  }

  // Continue with most recent replying agent
  const messages = groupChatState.messages.get(roomId) || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.senderType === 'AGENT' && msg.fromAgentId && room.memberIds.includes(msg.fromAgentId)) {
      gLog('Continuing with most recent agent:', msg.fromAgentId);
      return [msg.fromAgentId];
    }
  }

  // Default: send to all
  gLog('Defaulting to all members');
  return room.memberIds;
}

// =================== PROMPT BUILDING ===================
function buildRecentGroupTranscript(roomId, maxMessages = MAX_TRANSCRIPT_CONTEXT) {
  const messages = groupChatState.messages.get(roomId) || [];
  const memberNames = groupChatState.memberNames.get(roomId) || {};

  // Filter out system/internal messages for context
  const contextMessages = messages.filter(m =>
    !m.internal && m.senderType !== 'SYSTEM' && m.senderType !== 'DELIVERY'
  );

  const recent = contextMessages.slice(-maxMessages);
  return recent.map(m => {
    const sender = m.senderType === 'USER' ? 'SoLo' : (memberNames[m.fromAgentId] || messageSender(m));
    return `${sender}: ${messageText(m)}`;
  }).join('\n');
}

function buildGroupRelayPrompt(roomId, targetAgentId, allTargets, userMessage) {
  const room = groupChatState.rooms.get(roomId);
  const memberNames = groupChatState.memberNames.get(roomId) || {};
  const allMemberNames = room.memberIds.map(id => memberNames[id]).filter(Boolean);
  const targetNames = allTargets.map(id => memberNames[id]).filter(Boolean);
  const currentAgentName = memberNames[targetAgentId] || targetAgentId;

  const transcript = buildRecentGroupTranscript(roomId);

  let prompt = `You are participating in the OpenClaw group room "${room.title}".\n`;
  prompt += `You are ${currentAgentName}.\n`;
  prompt += `Participants: ${allMemberNames.join(', ')}\n`;
  prompt += `This turn is addressed to: ${targetNames.join(', ')}\n`;
  if (room.purpose) {
    prompt += `Shared room purpose: ${room.purpose}\n`;
  }

  if (transcript) {
    prompt += `\nRecent room transcript:\n${transcript}\n`;
  }

  prompt += `\nLatest user message:\n${userMessage}\n`;
  prompt += `\nReply as ${currentAgentName}. Consider the recent room transcript so your response stays aware of what the rest of the team already said.`;

  return prompt;
}

// =================== SENDING ===================
async function sendGroupMessage(roomId, text) {
  if (!text?.trim()) return false;
  if (!gateway || !gateway.isConnected()) {
    showToast('Not connected to Gateway', 'warning');
    return false;
  }

  const room = groupChatState.rooms.get(roomId);
  if (!room) { showToast('Room not found', 'error'); return false; }

  // Add user message to local transcript
  const userMsg = {
    id: `local-room-${roomId}-user-${Date.now()}`,
    key: `user-${Date.now()}`,
    text: text.trim(),
    from: 'SoLo',
    senderType: 'USER',
    time: Date.now(),
    internal: false,
  };
  const messages = groupChatState.messages.get(roomId) || [];
  messages.push(userMsg);

  // Resolve targets
  const targets = resolveLocalRoomTargets(roomId, text);
  const sessionMap = groupChatState.sessionKeys.get(roomId) || {};
  const failedTargets = [];

  // Send to each target
  for (const agentId of targets) {
    const sessionKey = sessionMap[agentId];
    if (!sessionKey) {
      failedTargets.push(agentId);
      continue;
    }

    try {
      const prompt = buildGroupRelayPrompt(roomId, agentId, targets, text.trim());
      const idempotencyKey = `group-${roomId}-${agentId}-${Date.now()}`;

      gLog('Sending to', agentId, 'via', sessionKey);
      await gateway._request('chat.send', {
        sessionKey,
        message: prompt,
        deliver: true,
        thinking: 'medium',
        idempotencyKey,
      });
    } catch (e) {
      gLog('Failed to send to', agentId, ':', e.message);
      failedTargets.push(agentId);
    }
  }

  // Add delivery status message if any failed
  if (failedTargets.length > 0) {
    const memberNames = groupChatState.memberNames.get(roomId) || {};
    const failedNames = failedTargets.map(id => memberNames[id] || id).join(', ');
    messages.push({
      id: `local-room-${roomId}-delivery-${Date.now()}`,
      key: `delivery-${Date.now()}`,
      text: `Failed to relay message to: ${failedNames}`,
      from: 'system',
      senderType: 'DELIVERY',
      time: Date.now(),
      internal: true,
    });
  }

  groupChatState.messages.set(roomId, messages);
  persistGroupRooms();

  // Sync replies (with await for fast responses)
  await syncLocalRoomReplies(roomId, true);

  return true;
}

// =================== REPLY SYNCING ===================
async function syncLocalRoomReplies(roomId, awaitReplies = false) {
  const room = groupChatState.rooms.get(roomId);
  if (!room) return;

  const sessionMap = groupChatState.sessionKeys.get(roomId) || {};
  const cursors = groupChatState.replyCursors.get(roomId) || {};
  const memberNames = groupChatState.memberNames.get(roomId) || {};
  const messages = groupChatState.messages.get(roomId) || [];
  let anyNew = false;

  const syncOnce = async () => {
    for (const [agentId, sessionKey] of Object.entries(sessionMap)) {
      try {
        const history = await gateway.loadHistory(sessionKey);
        const histMessages = history?.messages || history?.history || [];

        // Filter assistant/agent messages
        const assistantMsgs = histMessages.filter(m => {
          const role = String(m?.role || m?.from || '').toLowerCase();
          return role === 'assistant' || role === 'solobot' || role === 'agent';
        });

        if (assistantMsgs.length === 0) continue;

        const prevCursor = cursors[agentId];
        let foundCursor = !prevCursor;
        const newMsgs = [];

        for (const msg of assistantMsgs) {
          const msgKey = msg?.id || msg?.key || msg?.messageId || `msg-${msg?.time || Date.now()}`;

          if (!foundCursor) {
            if (msgKey === prevCursor) {
              foundCursor = true;
            }
            continue;
          }

          if (msgKey === prevCursor) continue;

          // Skip if already mirrored
          const alreadyMirrored = messages.some(m =>
            m._remoteKey === msgKey && m.fromAgentId === agentId
          );
          if (alreadyMirrored) continue;

          newMsgs.push({
            id: `local-room-${roomId}-${msgKey}`,
            key: `local-room-${roomId}-${msgKey}`,
            _remoteKey: msgKey,
            text: extractMessageText(msg),
            from: memberNames[agentId] || agentId,
            fromAgentId: agentId,
            senderType: 'AGENT',
            time: msg?.time || msg?.timestamp || Date.now(),
            internal: false,
            model: msg?.model,
            provider: msg?.provider,
          });
        }

        if (newMsgs.length > 0) {
          messages.push(...newMsgs);
          cursors[agentId] = assistantMsgs[assistantMsgs.length - 1]?.id
            || assistantMsgs[assistantMsgs.length - 1]?.key
            || `msg-${Date.now()}`;
          anyNew = true;
          gLog('Mirrored', newMsgs.length, 'new replies from', agentId);
        }
      } catch (e) {
        gLog('Sync failed for', agentId, ':', e.message);
      }
    }
  };

  if (awaitReplies) {
    for (let i = 0; i < AWAIT_REPLIES_MAX_ATTEMPTS; i++) {
      await syncOnce();
      if (anyNew) break;
      await new Promise(r => setTimeout(r, AWAIT_REPLIES_DELAY_MS));
    }
  } else {
    await syncOnce();
  }

  if (anyNew) {
    groupChatState.messages.set(roomId, messages);
    groupChatState.replyCursors.set(roomId, cursors);
    persistGroupRooms();
    renderGroupChat(roomId);
  }
}

function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(c => c.type === 'text' || c.type === 'output_text')
      .map(c => c.text || c.output_text || '')
      .join('\n');
  }
  if (msg.message) {
    return extractMessageText(msg.message);
  }
  return '';
}

// =================== POLLING ===================
function startGroupPolling() {
  if (groupChatState.pollTimer) return;
  groupChatState.isPolling = true;

  const poll = async () => {
    if (!groupChatState.isPolling || !groupChatState.selectedRoomId) return;
    if (!gateway || !gateway.isConnected()) return;

    await syncLocalRoomReplies(groupChatState.selectedRoomId, false);
  };

  groupChatState.pollTimer = setInterval(poll, GROUP_POLL_INTERVAL);
  gLog('Started group polling');
}

function stopGroupPolling() {
  groupChatState.isPolling = false;
  if (groupChatState.pollTimer) {
    clearInterval(groupChatState.pollTimer);
    groupChatState.pollTimer = null;
  }
  gLog('Stopped group polling');
}

// =================== UI RENDERING ===================
function renderGroupRoomsList() {
  const sidebarContainer = document.getElementById('group-rooms-list');
  const browserContainer = document.getElementById('group-chat-room-browser');
  const rooms = Array.from(groupChatState.rooms.values())
    .sort((a, b) => getRoomLastActivityMs(b.id) - getRoomLastActivityMs(a.id));

  if (sidebarContainer) {
    if (rooms.length === 0) {
      sidebarContainer.innerHTML = `
        <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
          No group rooms yet. Create one to start collaborating.
        </div>
      `;
    } else {
      sidebarContainer.innerHTML = rooms.map(room => {
        const memberNames = groupChatState.memberNames.get(room.id) || {};
        const members = room.memberIds.map(id => memberNames[id] || id).join(', ');
        const isActive = groupChatState.selectedRoomId === room.id;
        const unread = getRoomUnreadCount(room.id);

        return `
          <div class="group-room-item ${isActive ? 'active' : ''}" data-room-id="${room.id}" onclick="selectGroupRoom('${room.id}')">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <span style="font-size: 16px;">👥</span>
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                  <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(room.title)}</span>
                  ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(members)}
                </div>
              </div>
            </div>
            <button class="group-room-delete-btn" onclick="event.stopPropagation(); confirmDeleteGroupRoom('${room.id}')" title="Delete room">
              🗑️
            </button>
          </div>
        `;
      }).join('');
    }
  }

  if (browserContainer) {
    if (rooms.length === 0) {
      browserContainer.innerHTML = `
        <div class="group-chat-room-chip-empty">
          <strong>No rooms yet.</strong><br>
          Create a coordination room to bring agents into one focused thread.
        </div>
      `;
    } else {
      browserContainer.innerHTML = rooms.map(room => {
        const memberNames = groupChatState.memberNames.get(room.id) || {};
        const members = room.memberIds.map(id => memberNames[id] || id).join(', ');
        const isActive = groupChatState.selectedRoomId === room.id;
        const unread = getRoomUnreadCount(room.id);
        return `
          <button class="group-chat-room-chip ${isActive ? 'active' : ''}" onclick="selectGroupRoom('${room.id}')">
            <span class="group-chat-room-icon">👥</span>
            <span class="group-chat-room-chip-copy">
              <span class="group-chat-room-chip-title">${escapeHtml(room.title)}</span>
              <span class="group-chat-room-chip-meta">${escapeHtml(members || 'No members')} · ${formatSmartTime(getRoomLastActivityMs(room.id))}</span>
            </span>
            ${unread > 0 ? `<span class="group-chat-room-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
          </button>
        `;
      }).join('');
    }
  }
}

function getRoomLastActivityMs(roomId) {
  const room = groupChatState.rooms.get(roomId);
  const messages = groupChatState.messages.get(roomId) || [];
  const lastMessage = messages[messages.length - 1];
  return messageTimestamp(lastMessage || {}) || room?.createdAt || Date.now();
}

function getRoomUnreadCount(roomId) {
  const lastRead = getRoomReadState(roomId);
  const messages = groupChatState.messages.get(roomId) || [];
  if (!lastRead) return messages.filter(m => m.senderType === 'AGENT').length;

  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i].key || messages[i].messageKey || messages[i].id) === lastRead) break;
    if (messages[i].senderType === 'AGENT') count++;
  }
  return count;
}

function renderGroupChat(roomId) {
  const container = document.getElementById('group-chat-messages');
  const header = document.getElementById('group-chat-header');
  if (!container || !header) return;

  const room = groupChatState.rooms.get(roomId);
  if (!room) return;

  const memberNames = groupChatState.memberNames.get(roomId) || {};
  const allMessages = groupChatState.messages.get(roomId) || [];
  const visibleMessages = (groupChatState.showInternal
    ? allMessages
    : allMessages.filter(m => !m.internal && m.senderType !== 'SYSTEM'))
    .filter(m => !(typeof isSystemMessage === 'function' && isSystemMessage(messageText(m), m.from || m.senderName || m.senderId)));
  const memberSummary = room.memberIds.map(id => memberNames[id] || id).join(', ');
  const purpose = room.purpose || 'Focused multi-agent coordination room.';

  header.innerHTML = `
    <div class="group-chat-room-header-inner">
      <div class="group-chat-room-heading">
        <div class="group-chat-room-title-row">
          <span class="group-chat-room-icon">👥</span>
          <h1>${escapeHtml(room.title)}</h1>
          <span class="group-chat-status-pill"><span class="group-chat-status-dot"></span>${groupChatState.isPolling ? 'Live sync' : 'Ready'}</span>
        </div>
        <div class="group-chat-room-purpose">${escapeHtml(purpose)}</div>
      </div>
      <div class="group-chat-room-actions">
        <span class="group-chat-member-pill">${room.memberIds.length} member${room.memberIds.length === 1 ? '' : 's'}</span>
        <button id="group-chat-toggle-internal" class="btn btn-ghost ${groupChatState.showInternal ? 'active' : ''}" onclick="toggleGroupInternalMessages()" title="Toggle internal messages">
          ${groupChatState.showInternal ? '🙈 Hide internal' : '👁️ Show internal'}
        </button>
        <button onclick="showPage('chat')" class="btn btn-ghost" title="Back to direct chat">← Direct</button>
      </div>
    </div>
  `;

  if (visibleMessages.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; max-width: 420px; margin: 80px auto; padding: 32px; color: var(--text-muted); border: 1px dashed var(--border-default); border-radius: var(--radius-xl); background: var(--surface-1);">
        <div style="font-size: 36px; margin-bottom: 12px;">💬</div>
        <div style="font-size: 16px; font-weight: 700; color: var(--text-primary);">Start the room conversation</div>
        <div style="font-size: 13px; margin-top: 8px; line-height: 1.5;">
          Mention <strong>@all</strong> to reach everyone, or <strong>@agent</strong> to target one teammate.
        </div>
      </div>
    `;
  } else {
    container.innerHTML = normalizeGroupMessages(visibleMessages).map(msg => createGroupMessageElement(msg, memberNames)).join('');
    container.scrollTop = container.scrollHeight;
  }

  renderGroupContext(room, memberNames, visibleMessages, memberSummary);
}

function renderGroupContext(room, memberNames, visibleMessages, memberSummary) {
  const context = document.getElementById('group-chat-context');
  if (!context || !room) return;

  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const lastActivity = lastMessage ? formatSmartTime(messageTimestamp(lastMessage)) : 'No messages yet';
  const participantRows = room.memberIds.map(agentId => {
    const name = memberNames[agentId] || getAgentLabel(agentId) || agentId;
    const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${agentId}`).trim() || 'var(--brand-primary)';
    return `
      <div class="group-chat-participant">
        <span class="group-chat-participant-avatar" style="color:${color}; border-color: color-mix(in srgb, ${color} 30%, var(--border-default)); background: color-mix(in srgb, ${color} 10%, var(--surface-2));">
          ${escapeHtml(name.charAt(0).toUpperCase())}
        </span>
        <span style="min-width:0;">
          <span class="group-chat-participant-name">${escapeHtml(name)}</span>
          <span class="group-chat-participant-role">${escapeHtml(agentId)}</span>
        </span>
        <span class="group-chat-status-dot" title="Available"></span>
      </div>
    `;
  }).join('');

  const targetingCodes = ['@all', ...room.memberIds.map(id => `@${id}`)].slice(0, 10);

  context.innerHTML = `
    <div class="group-chat-context-card">
      <div class="group-chat-context-title">Room Brief</div>
      <div class="group-chat-context-muted">${escapeHtml(room.purpose || 'No purpose set. Use the first message to define the outcome you want.')}</div>
      <div style="margin-top: 12px;" class="group-chat-context-muted"><strong>Last activity:</strong> ${escapeHtml(lastActivity)}</div>
      <div class="group-chat-context-muted"><strong>Visible messages:</strong> ${visibleMessages.length}</div>
    </div>

    <div class="group-chat-context-card">
      <div class="group-chat-context-title">Participants <span>${room.memberIds.length}</span></div>
      <div class="group-chat-participant-list">${participantRows || '<div class="group-chat-context-muted">No participants yet.</div>'}</div>
    </div>

    <div class="group-chat-context-card">
      <div class="group-chat-context-title">Targeting</div>
      <div class="group-chat-code-list">
        ${targetingCodes.map(code => `<code>${escapeHtml(code)}</code>`).join('')}
      </div>
      <div class="group-chat-context-muted" style="margin-top: 10px;">Use direct mentions to reduce noise. Use @all when the whole room needs context.</div>
    </div>

    <div class="group-chat-context-card">
      <div class="group-chat-context-title">Controls</div>
      <div class="group-chat-context-actions">
        <button id="group-chat-toggle-internal-context" class="btn btn-ghost ${groupChatState.showInternal ? 'active' : ''}" onclick="toggleGroupInternalMessages()">
          ${groupChatState.showInternal ? 'Hide internal messages' : 'Show internal messages'}
        </button>
        <button class="btn btn-ghost" onclick="syncLocalRoomReplies('${room.id}', true)">Sync replies now</button>
        <button class="btn btn-ghost" onclick="confirmDeleteGroupRoom('${room.id}')">Delete room</button>
      </div>
    </div>
  `;
}

function createGroupMessageElement(msg, memberNames) {
  const isUser = msg.senderType === 'USER';
  const isSystem = msg.senderType === 'SYSTEM' || msg.senderType === 'DELIVERY';
  const isAgent = msg.senderType === 'AGENT';

  let avatar = '';
  let senderColor = 'var(--text-primary)';
  let bubbleClass = '';
  let style = '';

  if (isUser) {
    avatar = '<div class="group-chat-avatar user-avatar">U</div>';
    bubbleClass = 'user';
  } else if (isSystem) {
    avatar = '<div class="group-chat-avatar system-avatar">⚙️</div>';
    bubbleClass = 'system';
  } else if (isAgent) {
    const agentId = msg.fromAgentId || 'main';
    const color = getComputedStyle(document.documentElement).getPropertyValue(`--agent-${agentId}`).trim() || '#888';
    senderColor = color;
    style = `--agent-message-color:${color};`;
    avatar = `<div class="group-chat-avatar" style="background: color-mix(in srgb, ${color} 10%, var(--surface-2)); color: ${color}; border-color: color-mix(in srgb, ${color} 32%, var(--border-default));">
      ${escapeHtml((memberNames[agentId] || messageSender(msg) || 'A').charAt(0).toUpperCase())}
    </div>`;
    bubbleClass = 'agent';
  }

  return `
    <div class="group-chat-message ${bubbleClass}" data-msg-id="${msg.id}" style="${style}">
      ${avatar}
      <div class="group-chat-bubble">
        <div class="group-chat-bubble-header">
          <span class="group-chat-sender" style="color: ${senderColor}">${escapeHtml(messageSender(msg))}</span>
          <span class="group-chat-time">${formatSmartTime(messageTimestamp(msg))}</span>
        </div>
        <div class="group-chat-bubble-content">${linkifyText(messageText(msg))}</div>
      </div>
    </div>
  `;
}

// =================== UI ACTIONS ===================
function selectGroupRoom(roomId) {
  groupChatState.selectedRoomId = roomId;

  // Mark as read
  const messages = groupChatState.messages.get(roomId) || [];
  const lastAgentMsg = messages.filter(m => m.senderType === 'AGENT').pop();
  if (lastAgentMsg) {
    setRoomReadState(roomId, lastAgentMsg.key || lastAgentMsg.messageKey || lastAgentMsg.id);
  }

  renderGroupRoomsList();
  renderGroupChat(roomId);
  showPage('group-chat');
  startGroupPolling();
}

function confirmDeleteGroupRoom(roomId) {
  const room = groupChatState.rooms.get(roomId);
  if (!room) return;
  if (confirm(`Delete group room "${room.title}"?\n\nThis will also delete all relay sessions for the members.`)) {
    deleteGroupRoom(roomId).then(success => {
      if (success) {
        showToast(`Room "${room.title}" deleted`, 'success');
        renderGroupRoomsList();
        if (groupChatState.selectedRoomId === roomId) {
          showPage('chat');
          groupChatState.selectedRoomId = null;
        }
      }
    });
  }
}

function openCreateGroupRoomModal() {
  const modal = document.getElementById('create-group-room-modal');
  if (!modal) return;

  // Populate agent list
  const list = document.getElementById('group-room-agent-list');
  if (list) {
    const agents = getForwardableAgents();
    list.innerHTML = agents.map(id => `
      <label class="group-room-agent-option">
        <input type="checkbox" value="${id}" data-agent-id="${id}">
        <span class="group-room-agent-check"></span>
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${getComputedStyle(document.documentElement).getPropertyValue(`--agent-${id}`).trim() || '#888'};"></span>
          ${escapeHtml(getAgentDisplayName(id))}
        </span>
      </label>
    `).join('');
  }

  modal.classList.add('visible');
}

function closeCreateGroupRoomModal() {
  const modal = document.getElementById('create-group-room-modal');
  if (modal) modal.classList.remove('visible');
}

function submitCreateGroupRoom() {
  const titleInput = document.getElementById('group-room-title');
  const purposeInput = document.getElementById('group-room-purpose');
  const title = titleInput?.value?.trim();
  const purpose = purposeInput?.value?.trim();

  const checkboxes = document.querySelectorAll('#group-room-agent-list input[type="checkbox"]:checked');
  const selectedAgentIds = Array.from(checkboxes).map(cb => cb.value);

  const room = createGroupRoom(title, purpose, selectedAgentIds);
  if (room) {
    showToast(`Group room "${room.title}" created`, 'success');
    closeCreateGroupRoomModal();
    renderGroupRoomsList();
    selectGroupRoom(room.id);

    // Clear inputs
    if (titleInput) titleInput.value = '';
    if (purposeInput) purposeInput.value = '';
  }
}

async function sendGroupChatMessage() {
  const input = document.getElementById('group-chat-input');
  const text = input?.value?.trim();
  if (!text) return;

  const roomId = groupChatState.selectedRoomId;
  if (!roomId) return;

  input.value = '';
  input.style.height = 'auto';

  // Optimistic render
  renderGroupChat(roomId);

  const success = await sendGroupMessage(roomId, text);
  if (success) {
    renderGroupChat(roomId);
  }
}

function toggleGroupInternalMessages() {
  groupChatState.showInternal = !groupChatState.showInternal;
  const btn = document.getElementById('group-chat-toggle-internal');
  if (btn) {
    btn.textContent = groupChatState.showInternal ? '🙈 Hide internal' : '👁️ Show internal';
    btn.classList.toggle('active', groupChatState.showInternal);
  }
  if (groupChatState.selectedRoomId) {
    renderGroupChat(groupChatState.selectedRoomId);
  }
}

// =================== INTEGRATION ===================
async function initGroupChat() {
  await loadGroupRooms();
  renderGroupRoomsList();

  // Add group rooms to sidebar
  const sidebarNavAgents = document.querySelector('.sidebar-nav-agents');
  if (sidebarNavAgents && !document.getElementById('sidebar-group-rooms-section')) {
    const section = document.createElement('div');
    section.id = 'sidebar-group-rooms-section';
    section.className = 'sidebar-section';
    section.innerHTML = `
      <div class="sidebar-section-title sidebar-section-title-row">
        <span>Group Rooms</span>
        <button class="sidebar-section-action" onclick="openCreateGroupRoomModal()" title="Create group room">
          ➕
        </button>
      </div>
      <div id="group-rooms-list" style="display: flex; flex-direction: column; gap: 2px;">
        <!-- Populated dynamically -->
      </div>
    `;
    sidebarNavAgents.insertBefore(section, sidebarNavAgents.firstChild);
  }

  // Retry if sidebar section still missing (race with other renderers)
  if (!document.getElementById('sidebar-group-rooms-section')) {
    setTimeout(initGroupChat, 1200);
    return;
  }

  // Add group chat page if not exists
  if (!document.getElementById('page-group-chat')) {
    const chatPage = document.getElementById('page-chat');
    if (chatPage) {
      const groupChatPage = document.createElement('div');
      groupChatPage.id = 'page-group-chat';
      groupChatPage.className = 'page';
      groupChatPage.innerHTML = `
        <div class="group-chat-shell">
          <aside class="group-chat-rooms-panel" aria-label="Group chat rooms">
            <div class="group-chat-panel-header">
              <div>
                <div class="group-chat-eyebrow">Coordination</div>
                <h2>Rooms</h2>
              </div>
              <button class="btn btn-primary group-chat-create-btn" onclick="openCreateGroupRoomModal()" title="Create room">+</button>
            </div>
            <div class="group-chat-panel-copy">Multi-agent rooms for planning, decisions, and handoffs.</div>
            <div id="group-chat-room-browser" class="group-chat-room-browser"></div>
          </aside>

          <main class="group-chat-main-panel" aria-label="Group conversation">
            <div id="group-chat-header" class="group-chat-room-header"></div>
            <div id="group-chat-messages" class="group-chat-messages"></div>
            <div class="group-chat-composer">
              <div class="group-chat-composer-hint">Use <strong>@all</strong> for everyone or <strong>@agent</strong> for one teammate.</div>
              <div class="group-chat-input-row">
                <textarea
                  id="group-chat-input"
                  placeholder="Message the room..."
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck="false"
                  rows="1"
                  onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendGroupChatMessage();}"
                ></textarea>
                <button onclick="sendGroupChatMessage()" class="btn btn-primary">Send</button>
              </div>
            </div>
          </main>

          <aside class="group-chat-context-panel" aria-label="Room context">
            <div id="group-chat-context"></div>
          </aside>
        </div>
      `;
      chatPage.parentNode.insertBefore(groupChatPage, chatPage.nextSibling);
    }
  }

  // Add create room modal if not exists
  if (!document.getElementById('create-group-room-modal')) {
    const modal = document.createElement('div');
    modal.id = 'create-group-room-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 480px; width: 90%;">
        <div class="modal-header">
          <h3>Create Group Room</h3>
          <button class="modal-close" onclick="closeCreateGroupRoomModal()">×</button>
        </div>
        <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: var(--text-secondary);">Room Name</label>
            <input type="text" id="group-room-title" placeholder="e.g., Tech Team, Marketing Standup" style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--surface-1); color: var(--text-primary); font-size: 14px;">
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: var(--text-secondary);">Purpose (optional)</label>
            <input type="text" id="group-room-purpose" placeholder="e.g., Daily sync on engineering tasks" style="width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-default); background: var(--surface-1); color: var(--text-primary); font-size: 14px;">
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: 500; margin-bottom: 6px; color: var(--text-secondary);">Select Members</label>
            <div id="group-room-agent-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
              <!-- Populated dynamically -->
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button onclick="closeCreateGroupRoomModal()" class="btn btn-ghost">Cancel</button>
          <button onclick="submitCreateGroupRoom()" class="btn btn-primary">Create Room</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  gLog('Group chat initialized');
}

// Auto-resize group chat input
document.addEventListener('input', (e) => {
  if (e.target.id === 'group-chat-input') {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  }
});

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { initGroupChat(); }, 500);
});

// Expose globals
window.groupChatState = groupChatState;
window.createGroupRoom = createGroupRoom;
window.deleteGroupRoom = deleteGroupRoom;
window.selectGroupRoom = selectGroupRoom;
window.sendGroupChatMessage = sendGroupChatMessage;
window.openCreateGroupRoomModal = openCreateGroupRoomModal;
window.closeCreateGroupRoomModal = closeCreateGroupRoomModal;
window.submitCreateGroupRoom = submitCreateGroupRoom;
window.confirmDeleteGroupRoom = confirmDeleteGroupRoom;
window.toggleGroupInternalMessages = toggleGroupInternalMessages;
window.renderGroupRoomsList = renderGroupRoomsList;
