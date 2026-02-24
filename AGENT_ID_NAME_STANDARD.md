# Agent ID Standard (Name-Based)

## Standard
- Session keys must use **agent names**, not role IDs.
- Example: `agent:orion:main` (correct), `agent:cto:main` (legacy).

## Legacy -> Canonical Map
- `exec -> elon`
- `cto -> orion`
- `coo -> atlas`
- `cfo -> sterling`
- `cmp -> vector`
- `devops -> forge`
- `ui -> quill`
- `swe -> chip`
- `youtube -> snip`
- `sec -> knox`
- `net -> sentinel`
- `smm -> nova`
- `family -> haven`
- `tax -> ledger`
- `docs -> canon`
- `creative/art -> luma`

## Migration Script
- Script: `scripts/migrate-openclaw-session-ids-to-names.mjs`
- Dry run:
```bash
node scripts/migrate-openclaw-session-ids-to-names.mjs --home=/home/solo/.openclaw
```
- Apply:
```bash
node scripts/migrate-openclaw-session-ids-to-names.mjs --home=/home/solo/.openclaw --apply
```

## Verify
- Check session keys in OpenClaw session files:
```bash
for f in /home/solo/.openclaw/agents/*/sessions/sessions.json; do
  jq -r 'keys[]' "$f"
done | rg '^agent:(exec|cto|coo|cfo|cmp|devops|ui|swe|youtube|sec|net|smm|family|tax|docs|creative):'
```
- Expected: no output.

## Runtime Notes
- Frontend routing now canonicalizes legacy role IDs to name IDs.
- `gateway-client`, `sessions`, `state`, and sidebar normalization all resolve to name IDs.
- Quick actions / command palette / validator test session use name IDs.
