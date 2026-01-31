# SoLoBot Dashboard Coolify Command Cheatsheet

## Quick Reference

All commands are run from your Coolify server SSH session.

### Container Management

```bash
# View container logs
sudo docker logs --tail 100 $(sudo docker ps -q --filter name=solobot-dashboard)

# Follow logs in real-time
sudo docker logs -f $(sudo docker ps -q --filter name=solobot-dashboard)

# Restart container
sudo docker restart $(sudo docker ps -q --filter name=solobot-dashboard)

# Get container shell
sudo docker exec -it $(sudo docker ps -q --filter name=solobot-dashboard) /bin/sh
```

### Check Dashboard State

```bash
# View state.json
sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) cat /app/data/state.json

# Test API endpoint
curl http://localhost:3000/api/state
```

### Health Check

```bash
# Test locally
curl http://localhost:3000/

# Test from outside (replace with your domain)
curl https://dashboard.sololink.cloud/
```

## Coolify Deployment Setup

### 1. In Coolify UI

1. **Create New Resource** → **Docker Image**
2. **General Settings:**
   - Name: `solobot-dashboard`
   - Git Repository: `https://github.com/solovision24/solobot-dashboard`
   - Branch: `main`
   - Build Pack: `Dockerfile`

3. **Ports:**
   - Expose Port: `3000`

4. **Domains:**
   - Add your domain: `dashboard.sololink.cloud`
   - Enable HTTPS (Let's Encrypt)

5. **No Environment Variables Needed** (optional: set `PORT` if needed)

### 2. Build & Deploy

Click **Deploy** in Coolify UI. It will:
- Clone your repo
- Build the Docker image
- Start the container on port 3000

### 3. Verify Deployment

```bash
# Check if container is running
sudo docker ps | grep solobot-dashboard

# Test API
curl https://dashboard.sololink.cloud/api/state
```

## API Endpoints

The Node.js server provides:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve dashboard UI |
| `/api/state` | GET | Get current state |
| `/api/sync` | POST | Update state |

## Local Testing

```bash
# Build the image
docker build -t solobot-dashboard .

# Run locally
docker run -p 3000:3000 solobot-dashboard

# Test in browser
open http://localhost:3000
```

## File Structure in Container

```
/app/
├── server.js           # Node.js server
├── package.json        # Dependencies
├── index.html          # Dashboard UI
├── dashboard.js        # Frontend logic
└── data/
    └── state.json      # Persistent state
```

## Troubleshooting

### Dashboard not loading
1. Check container logs: `sudo docker logs $(sudo docker ps -q --filter name=solobot-dashboard)`
2. Verify port 3000 is exposed
3. Test API: `curl http://localhost:3000/api/state`

### State not persisting
1. Check data directory exists: `sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) ls -la /app/data/`
2. Verify state.json is writable

### Container keeps restarting
1. Check for Node.js errors in logs
2. Verify server.js exists and is valid
