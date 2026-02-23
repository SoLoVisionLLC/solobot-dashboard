# OpenClaw Recovery Runbook (SoLoBot)

This runbook covers the recurring failures we have seen and the exact fixes that worked.

## 1) Fast Triage (60 seconds)

Run these first:

```bash
openclaw gateway status
openclaw models list
openclaw doctor
```

What to look for:
- `Config invalid` -> fix config schema first.
- `Gateway not running` or health check failed -> service/startup issue.
- `404 The model \`gpt-5.3-codex\` does not exist` -> auth/profile/cooldown/stale model mapping.
- `No available auth profile for openai-codex` -> profile in cooldown/unavailable.

## 2) Known Failure Signatures and Fixes

### A) `404 The model \`gpt-5.3-codex\` does not exist or you do not have access to it`

Most common causes:
- OAuth auth profile is stale/invalid.
- Cooldown/error stamps make all openai-codex profiles unavailable.
- Session/model lock mismatch after reconnect.

Fix:

```bash
# 1) Restart gateway cleanly
openclaw gateway restart

# 2) Verify models still include openai-codex entries
openclaw models list | rg "openai-codex"

# 3) If still failing: clear openai-codex cooldown/error stamps in auth profiles
# (script path installed during previous fixes)
~/.openclaw/bin/reset-codex-cooldown.sh

# 4) Restart again
openclaw gateway restart
openclaw gateway status
```

Then in dashboard:
- Re-select model for the affected agent.
- Send a short test message (`ping`).

### B) `Provider openai-codex is in cooldown (all profiles unavailable)`

Cause:
- Cooldown stamp applied to all auth profiles after a burst of failures.

Fix:

```bash
~/.openclaw/bin/reset-codex-cooldown.sh
openclaw gateway restart
openclaw gateway status
```

Permanent mitigation already applied on this machine:
- systemd pre-start hook clears stale codex cooldown before gateway boot.
- If it stops working, verify:
  - `~/.config/systemd/user/openclaw-gateway.service.d/override.conf`
  - `~/.openclaw/bin/reset-codex-cooldown.sh`

### C) `Config invalid ... Unrecognized key: agentToAgent`

Cause:
- Unsupported key added to `~/.openclaw/openclaw.json`.

Fix:

```bash
openclaw doctor --fix
openclaw gateway restart
openclaw gateway status
```

If still invalid, open file and remove unknown key manually:

```bash
nano ~/.openclaw/openclaw.json
```

### D) `Config invalid ... agents.list.N: Unrecognized key: metadata`

Cause:
- `metadata` was added under `agents.list[]` but current schema rejects it.

Fix:

```bash
openclaw doctor --fix
openclaw gateway restart
openclaw gateway status
```

If `doctor --fix` reports changes but does not persist, manually remove `metadata` from each `agents.list[]` entry in `~/.openclaw/openclaw.json`.

### E) Agent renamed -> `Not Found` / empty history / chat breaks for specific agents

Cause:
- Agent ID/session key/agent directory mismatch after rename.

Important constraint:
- We keep display names and agent IDs as-is.

Fix strategy:
- Ensure each agent has:
  - matching session key format: `agent:<id>:main`
  - existing directory under `~/.openclaw/agents/<id>/`
  - valid `sessions/sessions.json`
  - consistent model override for that session

Validation commands:

```bash
# list agent directories
ls ~/.openclaw/agents

# inspect one agent session record
cat ~/.openclaw/agents/<id>/sessions/sessions.json
```

If missing, create folder/session file for that exact ID (no ID renaming).

### F) Repeating websocket disconnects (`1006`, `1012`) and temporary 500s

Cause:
- Gateway restarting/crashing due to config parse errors or runtime issues.

Fix:

```bash
openclaw gateway status
journalctl --user -u openclaw-gateway.service -n 200 --no-pager
openclaw doctor --fix
openclaw gateway restart
```

If logs show JSON parse issues from comments in config/state, remove comments (strict JSON only where parser expects JSON).

## 3) Agent-to-Agent Checklist

Use this when one agent works but others fail.

1. Confirm each target agent has a valid session key in dashboard and gateway.
2. Confirm model lock for that specific agent is valid and available.
3. Send a one-line test message to each agent.
4. Watch console for session-specific errors (not just global gateway state).

Quick command checks:

```bash
openclaw models list
openclaw gateway status
```

## 4) Permanent Guardrails

- Keep `~/.openclaw/openclaw.json` schema-clean (no unknown keys).
- Avoid adding `metadata` under `agents.list[]` unless schema supports it.
- Keep one gateway service instance per machine unless intentionally isolated.
- Keep fallback providers healthy (Google/OpenRouter keys valid) so fallback can save sessions.
- Keep the codex cooldown reset pre-start hook enabled.

## 5) Recovery Script Sequence (Copy/Paste)

Use this full sequence during incidents:

```bash
openclaw doctor --fix
~/.openclaw/bin/reset-codex-cooldown.sh
openclaw gateway restart
openclaw gateway status
openclaw models list | rg "openai-codex|gpt-5.3-codex|gpt-5.2|gpt-5.1-codex-mini"
```

Then retest from dashboard with a short message on the failing agent.

## 6) If Problem Persists

Collect and save:

```bash
openclaw gateway status
openclaw doctor
journalctl --user -u openclaw-gateway.service -n 300 --no-pager
```

Also capture browser console lines containing:
- `[Gateway] Chat error state`
- `Fallback Attempt History`
- `model not found`
- `No available auth profile`

This is enough to quickly identify whether the issue is:
- model availability/auth,
- config schema break,
- agent session mapping,
- or gateway runtime stability.
