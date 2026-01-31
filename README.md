# SoLoVision Command Center Dashboard

A real-time dashboard for monitoring and interacting with SoLoBot.

## Quick Start

1. Open `index.html` in a browser
2. Dashboard uses localStorage for persistence (client-side)
3. For AI integration, deploy to VPS and use `scripts/update-state.js`

## File Structure

```
dashboard/
├── index.html          # Main dashboard UI
├── dashboard.js        # Client-side JavaScript
├── data/
│   └── state.json      # Shared state file (AI reads/writes)
├── scripts/
│   └── update-state.js # CLI tool for SoLoBot to update state
└── TASKS.md            # Build progress tracker
```

## AI Integration

SoLoBot uses the CLI script to update dashboard state:

```bash
# Update status
node scripts/update-state.js status working "Building feature X"
node scripts/update-state.js status idle

# Manage tasks
node scripts/update-state.js task add "New task" 0    # P0 priority
node scripts/update-state.js task move t123 done
node scripts/update-state.js task pickup              # Auto-pick highest priority
node scripts/update-state.js task complete t123

# Notes
node scripts/update-state.js note add "Remember this"
node scripts/update-state.js note seen n123
node scripts/update-state.js note process-all

# Activity log
node scripts/update-state.js activity "Did something" success

# Sub-agents
node scripts/update-state.js subagent "Researching topic"
node scripts/update-state.js subagent clear

# Heartbeat (log sync)
node scripts/update-state.js heartbeat

# Query state
node scripts/update-state.js get notes    # Get unseen notes
node scripts/update-state.js get tasks    # Get todo tasks
node scripts/update-state.js get status   # Get current status
```

## Dashboard API (Browser)

The dashboard exposes `window.dashboardAPI` for testing:

```javascript
// Set status
dashboardAPI.setStatus('working', 'Building something');
dashboardAPI.setStatus('idle');

// Sub-agent
dashboardAPI.setSubagent('Researching...');

// Add activity
dashboardAPI.addActivity('Did something', 'success');

// Mark note as seen
dashboardAPI.markNoteSeen('n123');
```

## Heartbeat Workflow

Every 30 minutes, SoLoBot should:

1. Run `node scripts/update-state.js heartbeat`
2. Check for new tasks: `node scripts/update-state.js get tasks`
3. Check for notes: `node scripts/update-state.js get notes`
4. Process notes: `node scripts/update-state.js note process-all`
5. Pick up tasks if available: `node scripts/update-state.js task pickup`

## Deployment

### Option 1: Coolify (Recommended)

Deploy to Coolify with Docker:

1. **In Coolify UI:**
   - Create New Resource → Docker Image
   - Connect your Git repository
   - Set Build Pack: `Dockerfile`
   - Expose Port: `80`
   - Add domain (e.g., `dashboard.sololink.cloud`)
   - Enable HTTPS

2. **Click Deploy** - Coolify will build and deploy automatically

3. **Verify:** Visit your domain or run health check:
   ```bash
   curl https://dashboard.sololink.cloud/health
   ```

See [COOLIFY-CHEATSHEET.md](./COOLIFY-CHEATSHEET.md) for detailed commands.

### Option 2: Docker Manually

```bash
# Build the image
docker build -t solobot-dashboard .

# Run locally
docker run -d -p 8080:80 --name dashboard solobot-dashboard

# Test
curl http://localhost:8080/health
```

### Option 3: Simple HTTP Server (Development)

```bash
# Copy files to VPS
scp -r dashboard/ ubuntu@51.81.202.92:~/

# Start simple HTTP server
ssh ubuntu@51.81.202.92 "cd ~/dashboard && python3 -m http.server 8080"
```

Then access at `http://51.81.202.92:8080`

## Features

- **Status Panel**: Real-time AI status (working/idle/offline)
- **Sub-agent Indicator**: Shows when sub-agents are active
- **Model Display**: Current AI model in use
- **Kanban Board**: To-Do / In Progress / Done with priority colors
- **Activity Log**: Timestamped action history
- **Notes Panel**: Leave notes for SoLoBot with seen indicators
- **Product Status**: Health cards for all 4 SoLoVision products
- **Docs Hub**: Searchable document library

## Version

- **v1.0.0** - Initial MVP (2026-01-30)
