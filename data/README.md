# Data directory policy

This directory may contain runtime state when the dashboard is running, but runtime snapshots are not source artifacts.

Tracked files:
- `default-state.json` — non-secret bootstrap template.
- `dashboard-tasks.js` — static dashboard seed data.

Do not commit generated files such as:
- `state.json`
- `state.latest.json`
- `state*.json` backups/restores
- `file-meta.json`
- `file-mod-times.json`
- `test-results.json`
- `backups/`
- `versions/`

Production deployments should store generated state on a private persistent volume or another private backend. If a runtime snapshot ever contains tokens, chat transcripts, session keys, or operational metadata, rotate any live credentials and keep the snapshot out of the public repository.
