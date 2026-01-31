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

### Check Dashboard Files

```bash
# List files in nginx html directory
sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) ls -la /usr/share/nginx/html/

# View state.json
sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) cat /usr/share/nginx/html/data/state.json

# Check nginx config
sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) cat /etc/nginx/nginx.conf
```

### Health Check

```bash
# Check health endpoint
curl http://localhost:80/health

# Test from outside (replace with your domain)
curl https://dashboard.sololink.cloud/health
```

### View Nginx Access Logs

```bash
# View access logs
sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) tail -f /var/log/nginx/access.log

# View error logs
sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) tail -f /var/log/nginx/error.log
```

## Coolify Deployment Setup

### 1. In Coolify UI

1. **Create New Resource** → **Docker Image**
2. **General Settings:**
   - Name: `solobot-dashboard`
   - Git Repository: `https://github.com/yourusername/solobot-dashboard` (or your repo URL)
   - Branch: `main`
   - Build Pack: `Dockerfile`

3. **Ports:**
   - Expose Port: `80`
   - Public Port: `80` (or whatever Coolify assigns)

4. **Domains:**
   - Add your domain: `dashboard.sololink.cloud`
   - Enable HTTPS (Let's Encrypt)

5. **No Environment Variables Needed** (it's a static site!)

### 2. Build & Deploy

Click **Deploy** in Coolify UI. It will:
- Clone your repo
- Build the Docker image
- Start the container
- Serve on port 80

### 3. Verify Deployment

```bash
# Check if container is running
sudo docker ps | grep solobot-dashboard

# Test health endpoint
curl http://localhost:80/health

# Test dashboard
curl https://dashboard.sololink.cloud/
```

## VPS Sync API Integration

The dashboard connects to your VPS sync API at:
```
http://51.81.202.92:3456/api/state
http://51.81.202.92:3456/api/sync
```

Make sure:
1. Your VPS sync server is running on port 3456
2. Firewall allows connections from the dashboard container
3. CORS is configured if needed

## Troubleshooting

### Dashboard not loading
1. Check container logs: `sudo docker logs $(sudo docker ps -q --filter name=solobot-dashboard)`
2. Verify nginx is running: `sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) ps aux | grep nginx`
3. Check health endpoint: `curl http://localhost:80/health`

### State not syncing
1. Check if VPS API is reachable from container:
   ```bash
   sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) wget -O- http://51.81.202.92:3456/api/state
   ```
2. Check browser console for CORS errors
3. Verify state.json format is valid

### CSS/JS not loading
1. Check nginx mime types: `sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) cat /etc/nginx/nginx.conf`
2. Clear browser cache
3. Check nginx access logs for 404s

### Changes not reflecting
1. Rebuild in Coolify UI
2. Hard refresh browser (Ctrl+Shift+R)
3. Check if new version deployed: `sudo docker exec $(sudo docker ps -q --filter name=solobot-dashboard) ls -la /usr/share/nginx/html/`

## Local Testing (Before Deploy)

```bash
# Build the image
docker build -t solobot-dashboard .

# Run locally
docker run -p 8080:80 solobot-dashboard

# Test in browser
open http://localhost:8080
```

## File Structure in Container

```
/usr/share/nginx/html/
├── index.html          # Main HTML file
├── dashboard.js        # JavaScript logic
├── data/
│   └── state.json     # State file (fallback)
└── scripts/           # Any additional scripts
```

## Performance Optimization

The nginx config includes:
- Gzip compression for text files
- Browser caching for static assets
- Security headers (X-Frame-Options, etc.)

## Security Notes

- No sensitive data stored in container
- Runs as nginx user (non-root)
- Static files only - no server-side execution
- HTTPS enforced via Coolify/Let's Encrypt
