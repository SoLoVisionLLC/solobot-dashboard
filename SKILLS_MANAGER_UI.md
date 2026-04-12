# Skills Manager UI — SoLoBotDashboard

**Commit:** `7fad12e` (Feb 10, 2026)  
**Files Changed:** `js/skills-mgr.js`, `pages/skills.html`  
**Author:** SoLoBot

---

## Overview

The Skills Manager is a real-time dashboard page (`/skills` or `pages/skills.html`) that provides a full CRUD interface for managing SoLoBot agent skills. It includes live search, filtering by status/source/agent, one-click install/reinstall/uninstall, a rich install modal with logs/debug output, and an interactive file tree viewer for skill contents.

---

## Architecture

### Files

| File | Role |
|------|------|
| `js/skills-mgr.js` | Main skills manager logic — state, filtering, rendering, RPC calls |
| `pages/skills.html` | Skills Manager page shell |
| `dashboard.js` | Shared RPC client used by all dashboard pages |

### State

```javascript
const skillsUi = {
    search: '',         // live search string (lowercased)
    onlyIssues: false,  // toggle: show only skills with issues
    status: '',         // filter: 'enabled' | 'disabled' | ''
    source: '',         // filter: 'bundled' | 'installed' | 'clawhub' | ''
    agent: ''           // filter: agent id or ''
};
```

### Caching

```javascript
const SKILLS_CACHE_KEY = 'skillsStatusCache.v1'
// Cached in localStorage per browser session.
// Auto-refreshes every 60 seconds (loadSkills with useCache: false).
// On page init, loads with useCache: true for instant render.
```

---

## Features

### 1. Live Search

Searches across: skill name, id, path, directory, description, category.

```javascript
// In renderSkills():
const match = skill.name?.toLowerCase().includes(search) ||
              skill.id?.toLowerCase().includes(search) ||
              skill.path?.toLowerCase().includes(search) ||
              // ...etc
```

### 2. Filtering

Four independent filters:

| Filter | Options | UI Control |
|--------|---------|-----------|
| `status` | `enabled`, `disabled`, `all` | Toggle buttons |
| `source` | `bundled`, `installed`, `clawhub`, `all` | Dropdown |
| `agent` | agent ID or `all` | Dropdown |
| `onlyIssues` | boolean | Checkbox toggle |

Active filters displayed as removable chips via `updateActiveFilters()`.

### 3. Skill Health — Issues Detected

```javascript
function skillHasIssues(skill) {
    // Returns true if skill has problems:
    // - Missing required bins (no install log and no bins present)
    // - OS mismatch (marked for different OS)
    // - Has blocker/explicit disable flag
}
```

Displayed as red/orange warning badges per issue type.

### 4. Install / Reinstall / Uninstall

```javascript
function renderInstallButtons(skill) {
    // States:
    // - "Install" — skill not installed, bins missing
    // - "Reinstall" — skill has bins AND install log present (known-good install)
    // - "Install" (with ⚠️ badge) — bins present but install log missing (unknown origin)
    // - "Uninstall" — installed skill with known origin
    // - "Enable" / "Disable" — for bundled skills
}
```

### 5. Install Modal with Logs & Debug

The install modal (`showInstallModal`) shows:

- **Title + subtitle** — skill name and action
- **Body** — rich content area for logs or file tree
- **Actions** — Install, Reinstall, Close, and other context-specific buttons

Logs rendered as `<pre>` blocks with monospace styling. Supports ANSI-color strip for clean text display.

### 6. Skill Files Tree Viewer

`renderSkillFilesTree(files)` — renders a recursive file tree from a flat file list.

```javascript
// File tree node types:
{ type: 'folder', name: '...', children: [...] }
{ type: 'file', name: '...', path: '...' }
```

`renderSkillTreeNode(node, prefix)` — recursively renders with proper indentation and expand/collapse (via `<details>`).

File icons via `getFileIcon()`:
- `SKILL.md` → 📋
- `.js` → 📜
- `.json` → ⚙️
- `.md` → 📝
- Others → 📄

### 7. Agent Assignment Detection

`getSkillAssignedAgent(skill)` — infers which agent owns a skill by checking:

1. Explicit `assignedAgent` field
2. Skill `name`, `id`, `skillKey`, `path`, `directory` for known agent prefixes:
   - `halo`, `nova`, `luma`, `vector`, `canon`, `snip`, `haven`, `dev`, `sterling`

Returns lowercase agent name string.

### 8. Skill Ready State

```javascript
function skillIsReady(skill) {
    return (
        skill.status === 'enabled' &&
        !skillHasIssues(skill) &&
        skill.binsReady === true
    );
}
```

Displayed as a green READY badge vs. red/orange issue indicators.

---

## RPC Interface

Skills Manager uses these RPC calls via `dashboard.js`:

| RPC Method | Description |
|------------|-------------|
| `skills.list` | List all skills with full metadata |
| `skills.install` | Install a skill (download, extract, link) |
| `skills.reinstall` | Reinstall a skill |
| `skills.uninstall` | Uninstall a skill |
| `skills.enable` | Enable a bundled skill |
| `skills.disable` | Disable a bundled skill |
| `skills.update` | Update skill metadata (enable/disable) |
| `skills.files` | Get file tree for a skill |
| `skills.logs` | Get install logs for a skill |

All RPC responses go through the install modal log display.

---

## UI Components (pages/skills.html)

- `#skills-search` — search input
- `#skills-only-issues` — issues toggle checkbox
- `#skills-status-filter` — status filter buttons (All / Enabled / Disabled)
- `#skills-source-filter` — source dropdown
- `#skills-agent-filter` — agent dropdown
- `#skills-list` — main rendered skill list container
- `#active-filters` — chip bar for active filters
- `#install-modal` — full-screen install modal

---

## RPC-First Status Flow (Key Implementation Note)

Unlike a traditional REST status check, the Skills Manager uses an RPC call to `skills.list` to get skill state. The `binsReady` field is populated by the backend based on actual filesystem checks (`bins` directory presence + executable permissions), not by relying on local `package.json` or npm metadata.

Install log (`~/.hermes/skills/<skill>/.install.*.log`) is used to determine whether a skill was installed by the agent (known-good) vs. manually present (unknown origin).

---

## Backfill Status

✅ **Implementation:** Complete (commit `7fad12e`)  
✅ **Documentation:** This file — created 2026-04-04

---

## Key Implementation Quirks

1. **Cache-first loading**: Skills render from localStorage cache first (instant), then refresh from RPC in background.
2. **Install log detection**: Skills with bins but no install log are treated as "unknown origin" and shown with an ⚠️ badge — they get "Install" not "Reinstall".
3. **Agent inference is heuristic**: Uses string matching on path/name fields, not a hard owner field.
4. **No block/exclude per-skill in UI**: Skills can be hidden from the UI via localStorage (`hiddenSkills` array) but this is a local browser preference, not a global setting.
5. **OS mismatch detection**: If a skill's `os` field doesn't match the current OS, it's flagged as an issue.

---

## Next Steps for Dev

1. Consider adding a `skill.owner` field to the skills schema instead of heuristic agent inference
2. Add support for editing skill metadata (description, category) directly in the UI
3. Consider adding a "skill health score" aggregate in the dashboard widget
4. Add install log tailing (live stdout) to the install modal for long-running installs
