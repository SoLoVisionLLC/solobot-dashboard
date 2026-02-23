# SoLoBot Dashboard — Frontend Architecture Reference

> **Purpose:** Complete reference for any agent or developer making UI changes.
> Read this before touching ANY frontend file. Violations of the layout rules documented
> here cause hours of debugging (e.g. the `position:fixed` / `transform` story below).
> **Rule:** Any PR/change that touches frontend behavior or structure must update this file in the same commit.

---

## Table of Contents

1. [How Pages Are Assembled](#1-how-pages-are-assembled)
2. [CSS Layer Map](#2-css-layer-map)
3. [Layout Rules & Critical Gotchas](#3-layout-rules--critical-gotchas)
4. [JavaScript Load Order & Globals](#4-javascript-load-order--globals)
5. [Core JS Files](#5-core-js-files)
6. [Phase Enhancement Modules (phase1–phase16)](#6-phase-enhancement-modules-phase1phase16)
7. [Page-Specific JS Files](#7-page-specific-js-files)
8. [Partials (HTML)](#8-partials-html)
9. [Pages (HTML)](#9-pages-html)
10. [Cross-File Dependency Map](#10-cross-file-dependency-map)
11. [Known Gotchas & Rules](#11-known-gotchas--rules)

---

## 1. How Pages Are Assembled

The server (`server.js`) assembles every page **server-side** by concatenating HTML partials in this order:

```
partials/head.html          ← <head> + all CSS links
partials/body-open.html     ← <body> + app shell open tags
partials/sidebar.html       ← Left nav sidebar
partials/header.html        ← Top fixed header bar
pages/<pagename>.html       ← Page-specific content (injected into #page-<name>)
partials/modals-*.html      ← All modal dialogs
partials/footer.html        ← Closing tags
partials/scripts.html       ← All <script> tags + inline bootstrap JS
```

**Deep-link routing:** When the URL is `/agents/quill`, the server detects the agent ID,
serves the `agents` page, and injects a `<meta name="x-agent-deep-link" content="quill">`
tag between the charset and base tags. The client reads this on load to auto-drill.

**`<base href="/">`** in `head.html` ensures all relative asset paths (`js/`, `css/`) resolve
from the domain root regardless of page URL depth (e.g. `/agents/quill`, `/cron/daily`).
**NEVER remove this tag** — doing so breaks all JS/CSS on sub-path pages.

---

## 2. CSS Layer Map

CSS files are loaded in this order (defined in `partials/head.html`):

| File | Purpose | Key Selectors |
|---|---|---|
| `css/themes.css` | CSS custom properties (color tokens, spacing, radii) | `:root`, `[data-theme="midnight"]`, `[data-theme="snow"]` |
| `css/layout.css` | Base reset, body, `.header`, `.main`, grid utilities, button/badge components | `.header`, `.main`, `.btn`, `.badge`, `.input` |
| `css/components.css` | Shared UI components: cards, tabs, forms, toggles | `.tab-nav`, `.toggle`, `.form-group` |
| `css/modals.css` | Modal overlays, `.app-content`, `.sidebar`, `.page`, `.memory-page` | `.modal-overlay`, `.app-content`, `.page`, `.memory-page` |
| `css/chat.css` | Chat bubbles, page padding for memory & products | `.chat-*`, `#page-memory`, `#page-products` |
| `css/pages.css` | Per-page styles for system, cron, security, products, analytics | `#page-system`, `#page-cron`, etc. |
| `css/docs.css` | Agents page & org-chart specific styles including fixed toolbar | `.agents-toolbar`, `#page-agents`, `.org-*`, `.agent-dash-*` |
| `css/glassmorphism.css` | Frosted-glass effects for widgets/cards | `.glass`, `.glass-card`, `.sparkline-*` |
| `css/notion-kanban.css` | Kanban board view for tasks | `.kanban-*`, `.notion-*` |
| `css/phase4-context.css` | Context-aware layout time-of-day classes | `.time-morning`, `.time-evening` |
| `css/phase5-cmdpalette.css` | Command palette overlay | `.cmd-palette*` |
| `css/phase6-ai-insights.css` | AI Insights widget | `.ai-insight-*` |
| `css/phase7-activity-viz.css` | Activity timeline & heatmap | `.activity-timeline`, `.heatmap-*` |
| `css/phase8-quick-actions.css` | Quick actions floating panel | `.quick-actions-*` |
| `css/phases-9-13.css` | Voice, terminal, taskboard, analytics, agent panel phases | `.voice-*`, `.terminal-*`, etc. |
| `css/phase16-business.css` | Invoice/time-tracker widgets | `.invoice-*`, `.time-tracker-*` |

### Dynamically Injected CSS (via JavaScript)

> **⚠️ CRITICAL:** Several JS files inject `<style>` tags into `<head>` at runtime.
> These override static CSS. Always check these before debugging layout issues.

| JS File | Injected Style ID | What It Does |
|---|---|---|
| `js/phase14-polish.js` | `#page-transition-styles` | Adds `transform: translateY` + `will-change` to ALL `.page` elements for slide animations. **`#page-agents` is explicitly excluded** (see §11). |
| `js/phase14-polish.js` | `#skeleton-styles` | Skeleton loading shimmer animations |
| `js/phase14-polish.js` | `#mobile-responsive-styles` | Mobile breakpoint overrides, mobile sidebar nav |
| `js/phase1-visuals.js` | `#phase1-styles` | Glassmorphism, sparklines, progress rings |
| `js/phase2-motion.js` | `#phase2-motion-styles` | Widget entrance animations, hover lift effects |

---

## 3. Layout Rules & Critical Gotchas

### The Fixed Header

```
.header {
  position: fixed;
  top: 0;
  left: 64px;        /* collapsed sidebar width */
  right: 0;
  height: 60px;
  z-index: 100;
}
/* When sidebar expanded: */
.sidebar.pinned ~ .app-content .header,
.sidebar:hover ~ .app-content .header { left: 240px; }
```

### App Content Shell

```
.app-content {
  margin-left: 64px;
  overflow-x: hidden;   /* ← THIS breaks position:sticky on children! */
  min-height: 100vh;
}
/* When sidebar expanded: */
.sidebar.pinned ~ .app-content { margin-left: 240px; }
```

### The Agents Toolbar (position:fixed)

The `.agents-toolbar` in `pages/agents.html` is `position: fixed` because
`overflow-x: hidden` on `.app-content` breaks `position: sticky`.

```
.agents-toolbar {
  position: fixed;
  top: 60px;      /* directly below .header */
  left: 64px;     /* collapsed sidebar width */
  right: 0;
  z-index: 99;    /* one below .header's 100 */
  height: 48px;
}
/* When sidebar expanded: */
.sidebar.pinned ~ .app-content .agents-toolbar,
.sidebar:hover ~ .app-content .agents-toolbar { left: 240px; }

#page-agents {
  padding: 108px 24px 24px 24px;  /* 60px header + 48px toolbar + 24px gutters */
}
```

**Why `#page-agents` must NEVER have `transform` applied:**
`phase14-polish.js` injects `transform: translateY(8px)` on all `.page` elements for
page-switch animations. **Any `transform` value (including `translateY(0)`) creates a CSS
containing block**, which makes `position: fixed` descendants position relative to the
`.page` element instead of the viewport — causing the toolbar to scroll away.
This is why `#page-agents` has `transform: none !important; will-change: opacity !important`
injected by `phase14-polish.js`.

### Page Content Area

```
.page { display: none; flex: 1; }
.page.active { display: block; }

.memory-page {
  position: relative;
  isolation: isolate;   /* ← Creates stacking context, breaks fixed inside it */
  z-index: 2;
}
```

> **NEVER put `position:fixed` elements inside `.memory-page`** — `isolation: isolate`
> creates a stacking context that traps fixed positioning.

### Spacing Tokens

| Token | Value | Used For |
|---|---|---|
| `--space-4` | 16px | Tight padding |
| `--space-5` | 20px | Medium gaps |
| `--space-6` | 24px | Standard page gutters |

---

## 4. JavaScript Load Order & Globals

Scripts are loaded in `partials/scripts.html` in this order:

```
1.  perf-guard.js          ← Must be FIRST (wraps setInterval calls)
2.  gateway-client.js      ← WebSocket client class
3.  docs-hub-memory-files.js
4.  state.js               ← window.state, GATEWAY_CONFIG
5.  utils.js               ← formatTime(), escapeHtml(), addActivity()
6.  ui.js                  ← showToast(), showConfirm(), overrides alert/confirm
7.  ui-handlers.js         ← Modal/drag-drop handlers
8.  focus-timer.js
9.  quick-stats.js
10. keyboard.js
11. models.js              ← Provider/model management
12. sidebar-agents.js      ← Sidebar agent list
13. sessions.js            ← Session switching, agent ID tracking
14. notifications.js       ← Gateway connect, cross-session notifications
15. chat.js                ← Message rendering, voice input
16. model-validator.js
17. system.js
18. tasks.js
19. agents.js
20. channels.js
21. cron.js
22. costs.js
23. analytics.js
24. memory-browser.js
25. panzoom.min.js         ← Third-party pan/zoom library
26. memory-cards.js        ← Agents org-chart, drilled view
27. security.js
28. skills-mgr.js
29. subagent-monitor.js
30. heatmap.js
31. phase1-visuals.js  ... phase16-business.js  ← Enhancement layers
32. dashboard.js           ← DOMContentLoaded bootstrapper
```

### Critical Globals on `window`

| Global | Set By | Type | Purpose |
|---|---|---|---|
| `window.state` | `state.js` | Object | All app state: tasks, chat, settings, activity log |
| `window.gateway` | `notifications.js` | `GatewayClient` | Active WebSocket connection |
| `window.availableSessions` | `sessions.js` | Array | All gateway sessions |
| `window.currentSessionName` | `sessions.js` | String | Active session key |
| `window.currentAgentId` | `sessions.js` | String | Active agent ID (e.g. `"ui"`) |
| `window.resolveAgentId` | `sessions.js` | Function | Maps legacy agent aliases (e.g. `quill`) to current config IDs (e.g. `ui`) |
| `window.currentProvider` | `models.js` | String | Active AI provider |
| `window.currentModel` | `models.js` | String | Active model ID |
| `window._memoryCards


| `window.fetchSessions` | `sessions.js` | Function | Refresh session list from gateway |
| `window.switchToSession` | `sessions.js` | Function | Switch active session |
| `window.updateSidebarAgentsFromSessions` | `sidebar-agents.js` | Function | Refresh sidebar agent list |
| `window.AGENT_COLORS` | `state.js` | Proxy | Auto-generates consistent colors per agent ID |
| `window._lastManualModelChange` | `state.js` | Number/null | Timestamp of last user-triggered model change |
| `window._activePage` | `perf-guard.js` | Function | Returns current page name |
| `window.SkeletonLoader` | `phase14-polish.js` | Object | Show/hide skeleton loading states |
| `window.EmptyStates` | `phase14-polish.js` | Object | Render empty-state illustrations |

---

## 5. Core JS Files

### `gateway-client.js` (857 lines)

WebSocket client that bridges the dashboard to the OpenClaw Gateway.

**Class:** `GatewayClient`

**Key methods:**
- `connect(host, port, token)` — Opens WebSocket, authenticates with Ed25519 device identity
- `request(method, params)` / `_request()` — JSON-RPC over WebSocket
- `sendMessage(text)` — Send chat message to current session
- `sendMessageWithImages(text, imageDataUrls)` — Multimodal message
- `setSessionKey(key)` — Switch session (called by `sessions.js`)
- `loadHistory()` — Request chat history for current session
- `subscribeToAllSessions(keys)` — Subscribe to cross-session notifications
- `restartGateway(reason)` — RPC call to restart the gateway process
- `injectChat(sessionKey, message)` — Inject message without running agent

**Device Identity:** Generates/loads a persistent Ed25519 keypair in `localStorage` (key: `openclaw-device-identity`). The public key is sent in the gateway `connect` handshake to grant operator-level scopes.

**Events emitted to the parent page:** The client fires events on `window` that `notifications.js` and `chat.js` listen to (via the `onChatEvent`, `onAgentEvent` callbacks set in the constructor options).

**Connected to:**
- `notifications.js` — Instantiates `GatewayClient` as `window.gateway`
- `sessions.js` — Calls `gateway.setSessionKey()` on session switch
- `models.js` — Calls `gateway.request('config.get')` and `gateway.request('config.set')`
- `chat.js` — Calls `gateway.sendMessage()`, receives `_handleChatEvent` callbacks

---

### `state.js` (453 lines)

Global state store and persistence layer.

**`window.state`** object shape:
```js
{
  tasks: { todo: [], doing: [], done: [], archive: [] },
  chat: { messages: [] },
  settings: { theme, defaultAgent, ... },
  activity: [],       // Recent activity log entries
  activityLog: [],    // Timestamped events with tokens/cost data
  notes: [],
  system: {}
}
```

**Key functions:**
- `loadState()` — Loads from `localStorage` on page load
- `saveState(description)` — Saves to `localStorage` + debounced `syncToServer()`
- `syncToServer()` — POSTs state to `/api/sync`
- `persistChatMessages()` — Saves chat to `localStorage` + POSTs to `/api/chat/save`
- `loadChatFromServer()` — Fallback when `localStorage` is empty
- `cacheSessionMessages(key, msgs)` — In-memory cache to avoid re-fetching on agent switch
- `saveGatewaySettings(host, port, token, sessionKey)` — Persists gateway config

**`GATEWAY_CONFIG`** constant (built from `localStorage`):
```js
{ host, port, token, sessionKey, maxMessages: 500 }
```

**Connected to:** Nearly everything reads/writes `window.state` directly.

---

### `utils.js` (148 lines)

Pure utility functions, no side effects.

| Function | Purpose |
|---|---|
| `formatTime(ts)` | `HH:MM AM/PM` |
| `formatSmartTime(ts)` | `"just now"`, `"2m ago"`, `"1h ago"`, `"Mon 12"` |
| `formatRelativeTime(ts)` | `"Just now"`, `"5m ago"`, `"3h ago"` |
| `formatDate(ts)` | `"Feb 22"` |
| `escapeHtml(text)` | XSS-safe HTML escaping |
| `addActivity(action, type)` | Appends to `state.activity` (capped at 500) |
| `getPriorityClass(p)` | Badge CSS class for task priority 0/1/2 |
| `getLogColor(type)` | Color class for terminal log types |
| `updateArchiveBadge()` | Updates the badge count on Archive button |

---

### `ui.js` (164 lines)

Custom alert/confirm dialogs that replace native browser ones.

**`window.alert`** is overridden → calls `showToast(message, 'info', 5000)`
**`window.confirm`** is overridden → blocks synchronous action, shows `showToast()` warning.
All code should use `showConfirm()` (async) instead of `confirm()`.

**Key functions:**
- `showToast(message, type, duration)` — Creates toast in `#toast-container`
  - Types: `'info'`, `'success'`, `'error'`, `'warning'`
- `showConfirm(title, message, okText, cancelText, isDanger)` → `Promise<boolean>`
- `closeConfirmModal(result)` — Called by OK/Cancel buttons in `#confirm-modal`
- `clearChatHistory(skipConfirm, clearCache)` — Clears `state.chat.messages`

---

### `ui-handlers.js` (585 lines)

Event handlers for modals, task CRUD, drag-and-drop, activity sync.

**Modal helpers:**
- `showModal(id)` — adds `visible` class to `#<id>`
- `hideModal(id)` — removes `visible` class
- `openSettingsModal()` — populates all settings fields before showing
- `openActionModal(taskId, column)` — context menu for tasks

**Task CRUD:**
- `openAddTask(column)` / `submitTask()` → `saveState()`
- `quickMoveTask(id, from, to, event)` / `bulkMoveTo(targetColumn)`
- `modalDeleteTask()` / `confirmDeleteTask()`
- `toggleTaskSelection(id, event)` — multi-select with Shift support

**Drag-and-drop:**
- `handleDragStart/End/Over/Enter/Leave/Drop` — native HTML5 drag API
- `draggedTaskId` and `draggedFromColumn` are module-level variables

**Activity sync:**
- `syncActivitiesFromFile()` — polls `/api/activity` every 30s for transcript events
- `addTerminalLog(text, type, timestamp)` — appends to terminal widget

---

### `sessions.js` (1061 lines)

Session management and agent switching. **Most complex module.**

**`AGENT_PERSONAS`** map: Maps agent IDs to `{ name, role }` pairs:
```js
{ main: {name:'Halo', role:'PA'}, exec: {name:'Elon', role:'CoS'}, ui: {name:'Quill', role:'UI'}, ... }
```

**`LEGACY_AGENT_MAP`**: Maps old alias IDs (like `quill`) to backend config IDs (like `ui`) to maintain visual backward compatibility for old chat histories. Exposed globally via `window.resolveAgentId(id)`.

**Session key format:** `agent:<agentId>:<sessionName>`  
Example: `agent:main:main`, `agent:dev:feature-branch`, `agent:main:subagent:abc123`

**Key functions:**
- `fetchSessions()` — GETs `/api/sessions`, populates `window.availableSessions`, calls `updateSidebarAgentsFromSessions()`
- `switchToSession(sessionKey)` — Queue-based session switch (handles rapid clicks)
- `executeSessionSwitch(key)` — Core switch: updates `GATEWAY_CONFIG.sessionKey`, calls `gateway.setSessionKey()`, loads history, re-renders chat
- `filterSessionsForAgent(sessions, agentId)` — Returns sessions belonging to one agent (including subagents by label prefix)
- `goToSession(key)` — Navigate to session, switch to Chat page, switch session
- `loadSessionHistory(key)` — Loads history from gateway or `/api/chat/history`
- `populateSessionDropdown()` — Renders `#chat-page-session-menu` dropdown
- `handleSubagentSessionAgent()` — For `agent:main:subagent:*` sessions, determines correct agent from session label

**`window.currentAgentId`** is set here (after passing through `window.resolveAgentId`) and read by `notifications.js`, `memory-cards.js`, and `sidebar-agents.js`.

**Connected to:**
- `notifications.js` — Calls `gateway.subscribeToAllSessions()` after fetch
- `sidebar-agents.js` — `updateSidebarAgentsFromSessions()` called after each fetch
- `chat.js` — `renderChatPage()` / `renderChat()` called after switch
- `models.js` — `applySessionModelOverride()` called after switch

---

### `models.js` (988 lines)

AI provider/model configuration and UI sync.

**Model hierarchy (source of truth → UI):**
1. Gateway live config (via `fetchModelsFromGateway()`)
2. Server API `/api/models/current`
3. Per-agent override in `openclaw.json` (via `applySessionModelOverride()`)
4. User manual selection (`changeSessionModel()`)

**Key functions:**
- `populateProviderDropdown()` — Fetches providers from `/api/models/providers`, populates `#provider-select`
- `changeSessionModel()` — Header dropdown: POSTs to `/api/models/set` for current session + agent default
- `changeGlobalModel()` — Settings: PATCHes `openclaw.json` via `/api/models/set-global`, restarts gateway
- `loadAgentModel(agentId)` — Fetches per-agent model from `/api/models/agent/<id>`
- `syncModelDisplay(model, provider)` — Updates all header/settings dropdowns to reflect actual running model
- `applySessionModelOverride(sessionKey)` — Reads config for session's agent and locks the model display
- `refreshModels()` — Forces cache invalidation via `/api/models/refresh`

**UI elements controlled:**
- `#provider-select` / `#setting-provider` — Provider dropdowns
- `#model-select` / `#setting-model` — Model dropdowns
- `#current-provider-display` / `#current-model-display` — Header display spans

---

### `chat.js` (1921 lines)

The largest file. Handles chat message rendering, voice input, image attachments, and the full-page chat view.

**Message rendering:**
- `renderChat()` — Renders sidebar chat widget (recent messages, streaming indicator)
- `renderChatPage()` — Renders full `/chat` page with all messages
- `linkifyText(text)` — Markdown link conversion + URL auto-linking + `<br>` for newlines
- `formatModelDisplay(model, provider)` — Model label in chat bubbles
- `getBestModel(msg)` — Picks best model label with fallback chain

**Voice input (Web Speech API):**
- `initVoiceInput()` — Sets up `SpeechRecognition` with continuous mode + auto-restart
- `toggleVoiceInput()` — Start/stop listening (routes to correct input: sidebar or chat page)
- `toggleVoiceAutoSend()` — Toggle auto-send after speech ends
- `initPushToTalk()` — Alt+Space hotkey toggle

**Image handling:**
- `handleImageSelect(event)` — File input handler, populates `pendingImages[]`
- `handlePaste(event)` — Clipboard paste handler for images
- Multi-image UI: renders preview tiles with remove buttons

**Chat page events:**
- `attachChatInputHandlers()` — Sets up Enter-to-send, Shift+Enter for newline
- `adjustChatInputHeight(input)` — Auto-grow textarea
- `handleChatInputKeydown(event)` — Routes Enter/Shift+Enter, up-arrow for edit

---

### `notifications.js` (959 lines)

Gateway connection owner and cross-session notification hub.

**Gateway connection:**  
`connectToGateway()` creates `window.gateway = new GatewayClient(...)` and connects.
This is the **single gateway connection** shared by the entire app.

**Cross-session notifications:**
- `subscribeToAllSessions()` — Subscribes gateway to all known session keys
- `handleCrossSessionNotification(msg)` — Filters non-active session messages, shows in-app toast + browser notification
- `showNotificationToast(title, body, sessionKey)` — Rich toast with agent avatar, click to navigate
- `updateUnreadBadges()` — Updates the bell icon badge count per session in sidebar
- `sendReadAck(sessionKey)` — Sends `[[read_ack]]` marker to clear unread

**History loading:**
- `loadHistoryMessages(messages)` — Processes history array from gateway, filters system noise, merges into `state.chat.messages`
- `mergeHistoryMessages(messages)` — Smart merge: deduplicates by content fingerprint, preserves order
- `startHistoryPolling()` / `stopHistoryPolling()` — Tab visibility-aware polling (min 8s between loads)

**Connection status UI:**  
`updateConnectionUI(status, message)` — Updates the header connection dot and status text.

---

### `memory-cards.js` (1173 lines)

Agents page: org-chart, drilled agent view, per-agent model config, toolbar management.

**Wrapped in IIFE (immediately invoked function expression)** — exposes API via `window._memoryCards`.

**`ORG_TREE`** — Static org structure:
```js
{ 'main': { name:'Halo', role:'PA', emoji:'🤖', reports:['exec','cto',...] }, ... }
```

**`ORG_ORDER`** — Display ordering array.

**Views:**
- `renderOrgTree(filter)` — Renders hierarchical org chart with SVG connector lines, pan/zoom
- `renderDrilledView(container)` — Agent dashboard: status stats, model config card, recent sessions, memory files, system prompt
- `renderAgentCardsView(filter)` — Routes to org-tree or list view based on layout setting

**Toolbar management:**
- `updateToolbarForAgent(agent, statusLabel, statusClass)` — Swaps `.agents-toolbar` content to show agent nav + Chat/Memory/Ping buttons
- `updateToolbarDefault()` — Restores toolbar to search + sync + layout toggles
- `drillInto(agentId)` — Calls `updateToolbarForAgent()`, renders drilled view, pushes history URL
- `backToGrid()` — Calls `updateToolbarDefault()`, renders org tree, pops history URL

**Pan/zoom:**
- Uses `panzoom.min.js` (third-party lib, `window.Panzoom`)
- `initPanZoom()` — Sets up Panzoom on `#org-tree-canvas`
- `zoomIn()` / `zoomOut()` / `resetView()` / `fitToContent()`
- SVG connector lines are synced to panzoom transform

**Per-agent model config:**
- `loadAgentModelConfig(agentId)` — Fetches from `/api/models/agent/<id>`, renders model select + fallback list
- `saveAgentModel(agentId)` — POSTs to `/api/models/set`
- `pingAgent(agentId)` — Sends test message via gateway, shows latency

**`window._memoryCards` API** (called by inline onclick handlers):
```
.backToGrid(), .drillInto(id), .switchToAgentChat(id),
.openAgentMemory(id), .pingAgent(id), .setLayout(name),
.getLayout(), .renderAgentCardsView(filter),
.zoomIn(), .zoomOut(), .resetView(), .fitToContent()
```

---

### `sidebar-agents.js` (grouped departments + DnD)

Dynamic sidebar AGENTS section — department grouping, collapsible sections, drag/drop reordering, hide/show, activity indicators.

**localStorage keys:**
- `sidebar_agents_order_v1` — Legacy flat order (kept for backward compatibility)
- `sidebar_agents_hidden_v1` — Set of hidden agent IDs
- `sidebar_agents_prefs_v1` — Object: `{ hideInactive: bool, inactivityMs: number }`
- `sidebar_agents_dept_overrides_v1` — Per-agent department override (for cross-group drag/drop)
- `sidebar_agents_group_collapsed_v1` — Collapsed group names
- `sidebar_agents_order_by_dept_v1` — Per-department ordering arrays

**Department model (canonical):**
- Executive
- Technology
- Operations
- Marketing & Product
- Finance
- Family / Household

**Normalization and safety guard:**
- Agent IDs are normalized through an alias map (`quill→ui`, `orion→cto`, `forge→devops`, etc.) before rendering.
- Sidebar rendering uses an allowlist of known canonical IDs to prevent accidental display of malformed workspace IDs/template text.
- Emoji fallback text is sanitized (`sanitizeAgentEmoji`) so placeholder phrases from uninitialized `IDENTITY.md` files never render in the sidebar.

**Key functions:**
- `loadSidebarAgents()` — Fetches `/api/agents`, normalizes/filters/dedupes, renders grouped sidebar sections
- `applySidebarAgentsOrder()` — Reorders DOM elements within each department
- `applySidebarAgentsHidden()` — Shows/hides items based on hidden set
- `updateSidebarAgentsFromSessions(sessions)` — Called by `sessions.js` after session fetch; updates activity dots
- `setupSidebarAgentsDragAndDrop()` — Native HTML5 drag-and-drop within/across groups
- `openSidebarAgentsModal()` / `renderSidebarAgentsModal()` — "Manage Agents" modal

**Avatar resolution:** Checks `/avatars/<agentId>.png`, then `.svg`, falls back to emoji.

---

### `perf-guard.js` (runtime guard)

Wraps `setInterval` callbacks to skip execution when the relevant page is hidden or inactive. **Must load first.**

- Hooks `window.showPage` to track `currentPage`
- `guardFn(origFn, pages[])` — Returns function that no-ops when page/tab isn't relevant
- `patchWhenReady(fnName, pages)` — Patches global functions when they become available (polls for up to 8s)
- `window._activePage()` — Returns current page name string

---

## 6. Phase Enhancement Modules (phase1–phase16)

These are **optional enhancement layers** that run after core functionality is established.
Each is self-contained (IIFE), reads the DOM, and adds behavior on top.

| File | Purpose | Key Globals/Events |
|---|---|---|
| `phase1-visuals.js` | Glassmorphism cards, sparklines, progress rings, widget hover glow | Injects `#phase1-styles`; calls `renderSparklines()` |
| `phase2-motion.js` | Widget entrance animations (intersection observer), hover lift, drag-to-rearrange | Injects `#phase2-motion-styles`; CSS classes `.widget-animated` |
| `phase3-widgets.js` | Resizable/minimizable widgets, layout drag-and-drop, focus mode | `window.WidgetSystem.toggle(id)`, saves layout to `localStorage` |
| `phase4-context.js` | Time-of-day context (morning/afternoon/evening classes on body), agent-aware widget expansion | Sets `document.body.classList` time classes |
| `phase5-cmdpalette.js` | `Cmd+K` command palette with search, agent actions, nav commands | `window.CommandPalette.open()`, listens for `keydown` |
| `phase6-ai-insights.js` | AI Insights widget: weekly summary, idle alerts, pattern detection | Reads `state.activity`, renders in `.ai-insights-widget` |
| `phase7-activity-viz.js` | Live timeline widget, hourly heatmap, message sparkline, agent presence dots | Reads `availableSessions`, renders timeline |
| `phase8-quick-actions.js` | Floating quick-action panel: instant task, note, agent switch, Pomodoro | `window.QuickActions.open()`, hotkey `Q` |
| `phase9-voice.js` | Voice command processing (wraps `chat.js` voice), audio alerts, voice memo | Extends voice with command parsing |
| `phase10-taskboard.js` | Task board: swimlane view, due date indicators, task dependencies | Adds `.due-*` classes, dependency lines |
| `phase11-agents.js` | Agent status panel: traffic lights, resource usage display | Reads `/api/agents`, renders status grid |
| `phase12-analytics.js` | Analytics widget: token usage chart, cost donut, performance comparison | Uses Canvas API (Chart.js-style, custom) |
| `phase13-terminal.js` | Terminal: syntax highlighting, searchable history, log-level filter, auto-scroll | Extends `addTerminalLog()` behavior |
| **`phase14-polish.js`** | **Page transitions (slide+fade), skeleton loaders, mobile responsive** | Injects `#page-transition-styles` — **CRITICAL: excludes `#page-agents` from transform** |
| `phase15-keyboard.js` | Global keyboard shortcut overlay (`?` to show), arrow key widget nav | `window.KeyboardShortcuts.show()` |
| `phase16-business.js` | Invoice tracker, client time tracker widgets | `window.BusinessFeatures.*` |

> **⚠️ `phase14-polish.js` CRITICAL NOTE:**
> The `addTransitionStyles()` method injects `transform: translateY(8px)` on ALL `.page`
> elements. This BREAKS `position:fixed` on descendants because transform creates a CSS
> containing block. `#page-agents` is explicitly overridden with
> `transform: none !important; will-change: opacity !important` inside the same injected
> stylesheet. If you add more pages with fixed-position toolbars, add them here too.

---

## 7. Page-Specific JS Files

These run logic for individual pages. Most read `window.state` and call `saveState()`.

| File | Page | Key Functions |
|---|---|---|
| `js/agents.js` | /agents | Agent CRUD via `/api/agents`, exposes `window.switchToAgentChat(id)` |
| `js/analytics.js` | /products analytics | Cost/token chart rendering |
| `js/channels.js` | /system channels | Slack/webhook channel config |
| `js/cron.js` | /cron | Cron job CRUD, runs `/api/cron/*` |
| `js/costs.js` | /products | Cost breakdown from gateway usage data |
| `js/health.js` | /system | Server/gateway health polling, displays uptime |
| `js/heatmap.js` | /dashboard | Daily heatmap rendering on SYSTEM widget |
| `js/keyboard.js` | global | Hotkeys: `Cmd+K` (palette), `Esc` (close modal), etc. |
| `js/memory.js` | /agents | Memory file read/write operations |
| `js/memory-browser.js` | /agents | Drilled-in memory file tree browser |
| `js/model-validator.js` | /model-validator | Tests model configs, runs validation suite |
| `js/quick-stats.js` | /dashboard | Quick stats widget: session count, message count, cost today |
| `js/security.js` | /security | Token management, device identity settings |
| `js/skills-mgr.js` | /skills | Agent skills CRUD, skill enable/disable |
| `js/subagent-monitor.js` | /agents | Live subagent process monitor |
| `js/system.js` | /system | System config, server restart, log viewer |
| `js/tasks.js` | /dashboard | Task board rendering, Kanban drag-drop |
| `js/focus-timer.js` | global | Pomodoro-style focus session timer (header widget) |
| `docs-hub-memory-files.js` | /agents | File tree rendering for memory browser |
| `dashboard.js` | all | `DOMContentLoaded` bootstrapper: calls `loadState()`, `connectToGateway()`, `fetchSessions()`, sets up polling |

---

## 8. Partials (HTML)

Files in `partials/` are assembled server-side by `server.js`.

| File | Purpose | Critical Elements |
|---|---|---|
| `head.html` | `<head>` with all CSS links | `<base href="/">` (REQUIRED), `<meta x-agent-deep-link>` (injected by server for deep links) |
| `body-open.html` | Opens `<body>`, app shell structure | `<div class="app-layout">`, `<div class="app-content">` |
| `sidebar.html` | Left nav: logo, nav items, agents list, settings | `[data-agent-id]` items, `#sidebar-agents-list`, `.sidebar-item[data-page]` |
| `header.html` | Top header bar | `#current-provider-display`, `#current-model-display`, `#model-select`, `#provider-select`, connection dot, bell icon |
| `footer.html` | Closes all open divs + `<body>` + `<html>` | — |
| `scripts.html` | All `<script>` tags in load order + `showPage()` + `DOMContentLoaded` bootstrap | `window.showPage`, `renderMemoryFilesForPage()`, initial page routing |
| `modals-tasks.html` | Add task, action menu, edit title, delete confirm modals | `#add-task-modal`, `#task-action-modal` |
| `modals-settings-main.html` | Main settings modal: gateway config, model, theme | `#settings-modal`, `#gateway-host/port/token` |
| `modals-settings-themes.html` | Theme picker, appearance sub-settings | `#theme-modal` |
| `modals-memory.html` | Memory file viewer modal | `#memory-modal` |
| `modals-misc.html` | Archive, confirm dialog, sidebar agents modal | `#archive-modal`, `#confirm-modal`, `#sidebar-agents-modal` |

### `partials/scripts.html` — Critical Functions

**`showPage(pageName, updateURL)`** — Global page switcher. Hides all `.page` divs, shows
`#page-<name>`, calls `renderMemoryFilesForPage()` for agents/memory pages, updates URL.
Hijacked by `phase14-polish.js` to add page transition animations.

**`renderMemoryFilesForPage()`** — Called when switching to `agents` or `memory` page.
- Checks `window._memoryCards.getLayout()` — if NOT `'classic'`, delegates to `_memoryCards` and **returns early** (prevents the legacy classic file-view from rendering on top)
- Only falls through to classic render if layout is `'classic'`

---

## 9. Pages (HTML)

Files in `pages/` define the content for each app section (injected into `<main>` by the server).

| File | Route | Content |
|---|---|---|
| `pages/agents.html` | `/agents`, `/agents/:id` | `.agents-toolbar` (fixed, outside `.memory-page`), `.memory-page` wrapper, `#memory-cards-view` (org-chart), `#memory-files-grid` (classic) |
| `pages/chat.html` | `/chat` | Full chat page: `#chat-page-messages`, session switcher, chat input |
| `pages/dashboard.html` | `/` | Bento widget grid: task board, activity, quick-stats, notes, terminal, agents panel |
| `pages/system.html` | `/system` | Health monitors, system config, log viewer, gateway controls |
| `pages/cron.html` | `/cron` | Cron job editor |
| `pages/business.html` | `/business` | invoice tracker, time tracker |
| `pages/security.html` | `/security` | Token/API key management, device identity |
| `pages/skills.html` | `/skills` | Agent skills manager |
| `pages/products.html` | `/products` | Cost analytics, product feature tracker |
| `pages/memory.html` | `/memory` | Classic memory file browser (non-agents) |
| `pages/model-validator.html` | `/model-validator` | Model validation test suite |

### `pages/agents.html` — Structure

```html
<div id="page-agents" class="page active">
  <!-- TOOLBAR: direct child of #page-agents (NOT inside .memory-page) -->
  <!-- position:fixed works here because #page-agents has no transform -->
  <div class="agents-toolbar">
    <!-- Default: search + sync + layout toggles -->
    <!-- When drilled: back button + agent info + Chat/Memory/Ping + search -->
    <!-- Content swapped dynamically by memory-cards.js updateToolbarForAgent/Default -->
  </div>

  <!-- CONTENT: scrollable body below the fixed toolbar -->
  <div class="memory-page">
    <!-- isolation:isolate here — do NOT put position:fixed inside .memory-page -->
    <div id="memory-cards-view">...</div>  <!-- org tree or agent dashboard -->
    <div id="memory-files-grid">...</div>  <!-- classic file list -->
  </div>
</div>
```

---

## 10. Cross-File Dependency Map

```
                    ┌─────────────────────────────┐
                    │        gateway-client.js     │
                    │    (WebSocket connection)     │
                    └──────────┬──────────────────┘
                               │ window.gateway
              ┌────────────────┼───────────────────────┐
              ▼                ▼                        ▼
       sessions.js      notifications.js           chat.js
    (session switch)   (cross-session notifs)  (message render)
         │  │               │                       │
         │  └──window.availableSessions             │
         │                  │                       │
         ▼                  ▼                       ▼
  sidebar-agents.js    state.chat.messages     renderChatPage()
  (sidebar UI)         (via loadHistoryMsgs)
         │
         └─── models.js ─── applySessionModelOverride()
                │
                └─── memory-cards.js ─── loadAgentModelConfig()

state.js ←──── nearly everything reads/writes window.state
utils.js ←──── nearly everything uses formatTime(), escapeHtml()
ui.js ─────── showToast() called by everyone
ui-handlers.js showModal()/hideModal() called by everyone
perf-guard.js ─ wraps all setInterval() calls at startup
phase14-polish.js ─ MODIFIES .page CSS at runtime → affects ALL pages
```

---

## 11. Known Gotchas & Rules

### 1. Never use `position:sticky` inside `.app-content`
`.app-content` has `overflow-x: hidden` → creates scroll container → breaks sticky.
**Always use `position:fixed` with explicit `top`/`left`/`right` values.**

### 2. Never put `position:fixed` inside `.memory-page`
`.memory-page` has `isolation: isolate` → creates stacking context → traps fixed positioning.
The `.agents-toolbar` lives **outside** `.memory-page` for this exact reason.

### 3. Never add `transform` to `#page-agents` (or any page with fixed children)
Any `transform` value (including `transform: translateY(0)`) creates a CSS containing block
that makes `position:fixed` descendants position relative to the element instead of the viewport.
`phase14-polish.js` explicitly sets `transform: none !important` on `#page-agents`.
If you add new pages with fixed toolbars, do the same.

### 4. `phase14-polish.js` injects runtime CSS — grep JS files, not just CSS
The `will-change: opacity, transform` bug that broke the agents toolbar was only in JS.
When debugging CSS issues, always run:
```bash
grep -rn "will-change\|transform\|isolation\|contain" js/*.js partials/*.html
```

### 5. `<base href="/">` must always be in `head.html`
Without it, pages at sub-paths (`/agents/quill`) load relative JS/CSS from wrong paths,
causing `Unexpected token '<'` errors as HTML is served instead of JS.

### 6. `renderMemoryFilesForPage()` must return early for non-classic layouts
If `_memoryCards.getLayout() !== 'classic'`, the function must `return` after calling
`_memoryCards.applyLayout()`. Otherwise the classic file grid renders over the org chart.

### 7. Agent session key format is `agent:<agentId>:<sessionName>`
Don't strip partial prefixes. Use `normalizeSessionKey()` in `state.js` / `gateway-client.js`.

### 8. `window.showPage` gets hijacked by `phase14-polish.js`
If you call `showPage()` and animations behave unexpectedly, check that
`phase14-polish.js` loaded and that `hijackNavigation()` found the original `showPage`.

### 9. The toolbar content is dynamic — not static HTML
`.agents-toolbar` content is replaced entirely by `updateToolbarForAgent()` or `updateToolbarDefault()`
in `memory-cards.js`. Don't rely on static HTML in `pages/agents.html` for toolbar content.

### 10. `state.js` runs immediately on load
`loadState()` and `loadPersistedMessages()` run at script parse time (not in DOMContentLoaded).
Side effects from these fire before any DOM is available.
