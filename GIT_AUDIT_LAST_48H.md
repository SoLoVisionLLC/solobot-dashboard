# Git Audit Report - Last 48 Hours

Generated: 2026-02-23 (local repo time)
Branch: `main`
Remote: `origin https://github.com/SoLoVisionLLC/solobot-dashboard.git`
Window analyzed: last 48 hours from now

## Executive Summary

The repo had very high churn in the last 48 hours, including:

- repeated architecture-level changes to dashboard/state/session code
- multiple cache/version bumps (clients can run mixed frontend bundles)
- a feature add then revert sequence for Model Validator
- broad agent ID/persona key rewrites across many JS modules
- major server-side endpoint and routing changes

This explains behavior drift like missing sidebar items, inconsistent session behavior, and intermittent chat/history anomalies.

## By The Numbers

- Commits in window: 40+
- Total file line churn: `197,082` added / `204,747` deleted
- Most frequently touched files:
  - `server.js` (11 commits)
  - `partials/scripts.html` (11 commits)
  - `dashboard.js` (11 commits)
  - `index.html` (6 commits)
  - `gateway-client.js` (4 commits)

## Major Change Timeline (Impact-Focused)

## 2026-02-23

1. `f0a47e2` - **sync agent ID keys across all JS files**
- Scope: 13 JS files changed (agents, chat, memory-cards, analytics, taskboard, context, etc.)
- Impact risk: **High**
- Why it matters: cross-module ID/key mapping changes are exactly the kind of edits that can break session routing, chat history lookup, and per-agent model overrides.

2. `55a8676` - **correct agent persona keys in session management**
- Scope: `js/sessions.js`
- Impact risk: **High**
- Why it matters: this is the central session key/persona map; if keys drift from actual agent IDs, chats load empty or route incorrectly.

3. `088230b` + `cab0e0c` - **model-test isolation and patch-before-send changes**
- Scope: `gateway-client.js`, `js/health.js`
- Impact risk: **Medium-High**
- Why it matters: health/model validation now uses dedicated session behavior; this can interact with normal chat session state and locks if not fully isolated.

## 2026-02-21

4. `cf5a883` - **Model Validator feature added**
- Added files: `pages/model-validator.html`, `pages/test-results.html`, `pages/tester.html`, `TEST_RESULTS_SPEC.md`, `clear-device-identity.js`
- Sidebar touched: `partials/sidebar.html`
- Impact risk: **High**

5. `6454391` + `bd8b2fd` - **Model Validator reverted (twice in merge path)**
- Removed validator pages and related files.
- Graph context shows these came in via merged branch path.
- Impact risk: **High**
- Why it matters: this is the direct reason Model Validator can disappear depending on deployed commit/build.

6. `3d80f0f` + `a915985` - **state-management and backup architecture overhaul**
- Massive churn (10k+ lines, then 170k+ lines due backup/file tracking).
- Impact risk: **Very High**
- Why it matters: this touched how dashboard state, chat persistence, and backups are stored/loaded. Side effects include stale local state, large payloads, and behavior changes after reload.

7. `ea595b7` + `84e6c49` - **gateway client identity and test send-path changes**
- Gateway ID changed to address missing scopes; added `sendTestMessage` path.
- Impact risk: **High**
- Why it matters: affects auth scopes, message path consistency, and model validation behavior.

8. `8341e20`, `b097fa3`, `0370af5`, `f1d4e3f`, `828faaf`, `64d5dd2` - **server/API/routing changes**
- Dynamic page serving, `/api/agents` endpoint behavior, config path handling, request parsing refactor.
- Impact risk: **High**
- Why it matters: can alter which frontend shell you actually get and where agent/session data comes from.

9. Multiple cache-bust/script version commits (`v4.3` -> `v4.4` -> `v4.5` -> `v4.6` -> `v4.7`)
- Impact risk: **High operational risk**
- Why it matters: browser/CDN/session mismatch can make users load different JS generations simultaneously, producing "works for one page/agent but not another" behavior.

10. `1b56821` - **runtime backup files removed from repo history path**
- Huge deletion: `190k+` lines removed.
- Impact risk: **Medium**
- Why it matters: repository got cleaner, but this can coincide with state source changes and confusion about where live state is now expected.

## Major Behavior Risks Introduced

1. **Session/Agent Key Drift Risk**
- Recent commits changed agent keys in many files and session persona mapping separately.
- If any module still has old keys, you get empty history, missing agents, or Not Found behavior.

2. **Frontend Version Split-Brain**
- Heavy cache-bust churn + dynamic serving changes can leave users on mixed JS versions.
- Symptoms: missing pages (e.g., Model Validator), inconsistent sidebar/nav, duplicate/blank messages.

3. **State Source Ambiguity**
- Multiple shifts between localStorage/server/gateway history merge strategy.
- Symptoms: blank or duplicated messages, stale history after switching sessions.

4. **Validator/Test Path Side Effects**
- Health/model test routing changed recently and can interfere with chat locks/session patches if not isolated.

## Why Model Validator Disappeared (Root Cause from History)

- It was explicitly added in `cf5a883`.
- Then explicitly reverted in `6454391` (and additional state revert in `bd8b2fd`) through merge history.
- Current code path/sidebar in your deployed shell no longer includes that feature.

## What Else Likely Changed Without You Noticing

- Agent ID canonical names were rewritten broadly (`f0a47e2`) and may not match older data/session entries.
- Session management map changed (`55a8676`) and can silently remap persona labels.
- Server route handling changed from static to dynamic (`8341e20`), affecting which UI bundle is served.
- Model testing mechanics changed (`088230b`, `cab0e0c`), potentially touching active session behavior.

## Immediate Verification Checklist

Run this after deploy/restart to confirm environment consistency:

```bash
git rev-parse --short HEAD
git status --short
openclaw gateway status
```

In browser devtools/network:
- verify one consistent script version suffix across loaded JS files
- verify sidebar markup includes expected menu items for current commit
- verify session keys in console match actual agent IDs

Functional smoke tests:
1. switch 3 agents and load history each time
2. send one message per agent
3. verify no blank bubbles, no cross-session bleed
4. verify model lock shown in UI matches outbound model in gateway logs

## Notes

- This report is based on commit history in this repo only.
- There are currently local uncommitted changes in:
  - `dashboard.js`
  - `js/chat.js`
  - `js/notifications.js`
  (these were chat blank-message guards added during current debugging session)
