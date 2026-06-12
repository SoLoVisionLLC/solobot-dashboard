# Notion Task Board Guardrails

Enforcement point: `lib/notion-task-guardrails.js` is the shared validation/defaulting layer for Hermes/Dashboard <-> Notion Task Board flows.

Why this exists:
- Notion does not reliably enforce select properties like `Assigned Agent` as required at the database schema level.
- Active Task Board items must not be created or synced without an owner.
- Due dates should be included whenever the source task provides a clear date, or when the dashboard can apply the policy SLA from priority.

Active states:
- `todo`
- `progress`
- `done`

Guardrail behavior:
1. Task creation/migration into Notion uses `appendGuardedNotionProperties()`.
   - Always writes `Status`, `Priority`, and `Assigned Agent` for active tasks.
   - Defaults missing `Assigned Agent` to `Dev` for active local/dashboard tasks.
   - Writes `Due Date` from an explicit task date when present.
   - If no explicit due date exists, applies SLA due dates by priority:
     - P0: +1 day
     - P1: +3 days
     - P2: +7 days
     - P3: +14 days
2. Server status sync back to Notion uses the same helper before PATCHing a page.
   - This prevents an active Notion update from dropping ownership metadata.
3. Notion-to-dashboard sync validates active Notion pages with `validateNotionPageForActiveSync()`.
   - Active Notion pages missing `Assigned Agent` are skipped and logged rather than silently defaulted into dashboard state.

Current integration points:
- `migrate-tasks-to-notion.js` for dashboard/local task migration into Notion.
- `scripts/notion-sync.js` for Notion-to-dashboard sync.
- `server.js` for live Notion fetches and status updates from `/api/sync`.

Verification:
- Run `node scripts/test-notion-task-guardrails.js`.
