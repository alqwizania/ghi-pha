# changedetection.io - Website Change Monitoring

**Status**: ✅ Deployed  
**Version**: Latest (ghcr.io/dgtlmoon/changedetection.io:latest)  
**Access**: https://changedetection.fayaa92.sa  
**Documentation**: https://github.com/dgtlmoon/changedetection.io  
**MCP Server**: `/srv/docker/changedetection/MCP_SERVER.md`

## Overview

changedetection.io is a self-hosted website change monitoring tool that tracks updates to web pages and sends alerts when changes are detected. Perfect for monitoring price changes, content updates, restock alerts, and more.

---

## FayaaLink Standard Compliance

This installation follows the **FayaaLink Standard** for Docker services:

✅ **Secrets Management**: All configuration in `.env` file (600 permissions)  
✅ **Network**: Connected to `caddy_default` external network  
✅ **Reverse Proxy**: Routed through Caddy at `changedetection.fayaa92.sa`  
✅ **Data Persistence**: Volume mounted at `/srv/data/changedetection/`  
✅ **Health Checks**: Built-in health monitoring  
✅ **Documentation**: `.env.example` template included

---

## Directory Structure

```
/srv/docker/changedetection/
├── docker-compose.yml    # Service orchestration
├── .env                  # Configuration and secrets (600 permissions)
├── .env.example          # Configuration template
├── .gitignore            # Protects .env from git
└── README.md             # This file

/srv/data/changedetection/
└── (persistent data storage - watch configs, history, etc.)
```

---

## Service Configuration

### Container Details
- **Container Name**: `changedetection`
- **Image**: `ghcr.io/dgtlmoon/changedetection.io:latest`
- **Port**: `5000` (internal only, not exposed)
- **Network**: `caddy_default`
- **Restart Policy**: `unless-stopped`
- **Health Check**: HTTP check every 30s

### Environment Variables
Configuration is stored in `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Internal listening port |
| `LISTEN_HOST` | `0.0.0.0` | Bind address |
| `LOGGER_LEVEL` | `INFO` | Log level (TRACE/DEBUG/INFO/WARNING/ERROR) |
| `BASE_URL` | `https://changedetection.fayaa92.sa` | External URL |
| `USE_X_SETTINGS` | `1` | Enable reverse proxy headers |
| `HIDE_REFERER` | `true` | Privacy: hide referer header |
| `TZ` | `Asia/Riyadh` | Timezone for scheduling |
| `FETCH_WORKERS` | `10` | Concurrent fetch workers |
| `MINIMUM_SECONDS_RECHECK_TIME` | `3` | Minimum check interval |

See `.env.example` for complete list of available configuration options.

---

## Operations

### Start Service
```bash
cd /srv/docker/changedetection
docker compose up -d
```

### Stop Service
```bash
cd /srv/docker/changedetection
docker compose down
```

### Restart Service
```bash
cd /srv/docker/changedetection
docker compose restart
```

### View Logs
```bash
# Live logs
docker logs changedetection -f

# Last 50 lines
docker logs changedetection --tail 50

# Since 1 hour ago
docker logs changedetection --since 1h
```

### Check Status
```bash
# Container status
docker ps --filter name=changedetection

# Health check status
docker inspect changedetection --format '{{.State.Health.Status}}'

# Test HTTP endpoint
curl -I http://172.18.0.12:5000/
```

### Update Service
```bash
cd /srv/docker/changedetection

# Pull latest image
docker compose pull

# Restart with new image
docker compose up -d

# Verify update
docker logs changedetection --tail 20
```

---

## Reverse Proxy Configuration

### Caddy Route
Added to `/srv/docker/caddy/Caddyfile`:

```caddyfile
# changedetection.io - Website change monitoring
@changedetection host changedetection.fayaa92.sa
handle @changedetection {
    reverse_proxy changedetection:5000 {
        header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}
        header_up X-Real-IP {http.request.header.CF-Connecting-IP}
        header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
    }
}
```

### Access URL
- **Public**: https://changedetection.fayaa92.sa
- **Internal**: http://changedetection:5000 (from Docker network)
- **Direct IP**: http://172.18.0.12:5000 (from host)

---

## Data Management

### Backup Strategy

**Data Location**: `/srv/data/changedetection/`

**What to backup**:
- Watch configurations
- Change detection history
- Notification settings
- User preferences

**Backup command**:
```bash
# Full backup (recommended weekly)
tar -czf ~/backups/changedetection-$(date +%Y%m%d).tar.gz \
  -C /srv/data changedetection/

# Automated backup (add to crontab)
0 2 * * 0 tar -czf ~/backups/changedetection-$(date +\%Y\%m\%d).tar.gz -C /srv/data changedetection/
```

**Restore from backup**:
```bash
# Stop service
cd /srv/docker/changedetection
docker compose down

# Restore data
tar -xzf ~/backups/changedetection-20260127.tar.gz -C /srv/data/

# Start service
docker compose up -d
```

---

## Features

### Core Capabilities
- 🔍 Monitor any website for changes
- 📊 Visual diff view (word, line, character)
- 🎯 CSS/XPath/JSONPath selectors
- 🔔 Multiple notification channels
- 📅 Flexible scheduling
- 🌐 JavaScript rendering support (optional)
- 📸 Screenshot comparison
- 💰 Price tracking
- 🔄 API monitoring (JSON/XML)
- 📄 PDF change detection

### Notification Channels
Supports 70+ notification services via Apprise:
- Email (SMTP)
- Discord
- Slack
- Telegram
- Microsoft Teams
- Webhooks
- And many more...

---

## Usage Examples

### 1. Monitor Product Price
1. Add URL of product page
2. Enable "Re-stock & Price detection"
3. Set price thresholds
4. Configure notification

### 2. Track Website Updates
1. Add website URL
2. Use Visual Selector to target specific content
3. Set check frequency
4. Add notification URL

### 3. API Monitoring
1. Add API endpoint URL
2. Use JSONPath or jq filter
3. Set minimum recheck time
4. Configure alert conditions

---

## Troubleshooting

### Service Not Starting
```bash
# Check logs
docker logs changedetection --tail 50

# Verify network
docker network inspect caddy_default | grep changedetection

# Check permissions
ls -la /srv/data/changedetection/
```

### Cannot Access UI
```bash
# Test internal connectivity
curl -I http://changedetection:5000/

# Check Caddy routing
docker logs caddy --tail 30 | grep changedetection

# Verify DNS (from external)
nslookup changedetection.fayaa92.sa
```

### High Memory Usage
```bash
# Check resource usage
docker stats changedetection --no-stream

# Reduce workers in .env
FETCH_WORKERS=5

# Restart service
docker compose restart
```

### Watches Not Running
```bash
# Check worker status in logs
docker logs changedetection | grep "async worker"

# Verify check frequency isn't too high
# Edit watch minimum recheck time in UI
```

---

## Advanced Configuration

### API Access

changedetection.io provides a REST API for programmatic access.

**Base URL**: `https://changedetection.fayaa92.sa/api/v1/`

**Authentication**: All API requests require the `x-api-key` header.

The API key is configured in `.env`:
```bash
SALTED_PASS=replace_with_random_secret
```

**Example API requests**:
```bash
# List all watches
curl -H "x-api-key: $CHANGEDETECTION_API_KEY" \
  https://changedetection.fayaa92.sa/api/v1/watch

# Create a new watch
curl -X POST \
  -H "x-api-key: $CHANGEDETECTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "title": "Example Watch"}' \
  https://changedetection.fayaa92.sa/api/v1/watch

# Get watch details
curl -H "x-api-key: $CHANGEDETECTION_API_KEY" \
  https://changedetection.fayaa92.sa/api/v1/watch/{uuid}

# Update a watch
curl -X PUT \
  -H "x-api-key: $CHANGEDETECTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/updated"}' \
  https://changedetection.fayaa92.sa/api/v1/watch/{uuid}

# Delete a watch
curl -X DELETE \
  -H "x-api-key: $CHANGEDETECTION_API_KEY" \
  https://changedetection.fayaa92.sa/api/v1/watch/{uuid}
```

**API Documentation**: Available at `https://changedetection.fayaa92.sa/docs/api_v1/`

**Security Notes**:
- The `SALTED_PASS` value is the server-side API authentication token
- Clients must include this value in the `x-api-key` header with each request
- Keep this token secure - treat it like a password
- Rotate the token periodically by updating `.env` and restarting the service

### Playwright Browser Integration

changedetection.io includes **Playwright Chrome browser** for monitoring JavaScript-heavy websites and interactive browser automation.

**Architecture**:
```
changedetection (172.18.0.14:5000)
         ↓ ws://playwright-chrome:3000
playwright-chrome (172.18.0.13:3000) [sockpuppetbrowser]
         ↓
    Chromium Browser (Playwright-controlled)
```

**Services**:
- **changedetection**: Main monitoring service
- **playwright-chrome**: Browser service for JavaScript rendering and browser-steps

**Configuration** (already set in `.env`):
```bash
PLAYWRIGHT_DRIVER_URL=ws://playwright-chrome:3000
```

**Using Playwright Browser-Steps**:

1. **Create/Edit a Watch**
2. **Fetcher**: Select "Chrome/Javascript (via Playwright Fetcher)"
3. **Browser Steps**: Add interactive steps:
   - Click elements
   - Fill forms
   - Wait for conditions
   - Take screenshots

**Example Browser Steps**:
```yaml
- Click "button#accept-cookies"
- Fill "input[name='search']" with "test query"
- Click "button[type='submit']"
- Wait for "#results"
- Extract "#results"
```

**Playwright Operations**:

```bash
# Check Playwright status
curl http://localhost:8080/stats

# View Playwright logs
docker logs playwright-chrome --tail 50 -f

# Monitor active browser sessions
curl http://localhost:8080/stats | grep active_connections

# Restart Playwright browser
cd /srv/docker/changedetection
docker compose restart playwright-chrome
```

**Troubleshooting Playwright**:

```bash
# Connection refused error
docker ps --filter name=playwright-chrome  # Verify running
docker network inspect caddy_default       # Check network membership
docker compose up -d playwright-chrome     # Start if needed

# WebSocket timeout
docker logs playwright-chrome | grep "Starting Chrome"  # Wait for ready
docker restart playwright-chrome  # If stuck

# Too many concurrent sessions
# Increase MAX_CONCURRENT_CHROME_PROCESSES in docker-compose.yml
# Or reduce FETCH_WORKERS in .env
```

**Resource Usage**:
- **playwright-chrome**: ~300-500MB RAM base + ~200MB per active session
- Max concurrent sessions: 10 (configurable)
- Screen resolution: 1920x1080x24

**Advantages over Selenium/WebDriver**:
- ✅ Native browser-steps support (click, fill, wait actions)
- ✅ Lighter weight (~270MB vs ~925MB for Selenium)
- ✅ Faster startup (WebSocket vs HTTP Grid)
- ✅ Better integration with changedetection.io (purpose-built)
- ✅ Simpler architecture (single WebSocket endpoint)

**Security**: WebSocket port 3000 is NOT exposed to host (internal Docker network only)

### Proxy Configuration
Add to `.env` for proxy support:
```bash
HTTP_PROXY=socks5h://proxy.example.com:1080
HTTPS_PROXY=socks5h://proxy.example.com:1080
NO_PROXY=localhost,192.168.0.0/24
```

---

## Security Considerations

- ✅ `.env` file has 600 permissions (owner read/write only)
- ✅ Not exposed to internet directly (behind Cloudflare + Caddy)
- ✅ `HIDE_REFERER=true` prevents leaking server hostname
- ✅ File URI access disabled by default
- ✅ API authentication via `SALTED_PASS` token (required for all API requests)
- ✅ Playwright browser isolated on internal Docker network
- ⚠️ UI has no built-in authentication - consider adding via Caddy basic auth

---

## Resources

- **GitHub**: https://github.com/dgtlmoon/changedetection.io
- **Documentation**: https://github.com/dgtlmoon/changedetection.io/wiki
- **Docker Hub**: https://hub.docker.com/r/dgtlmoon/changedetection.io
- **API Docs**: https://changedetection.fayaa92.sa/docs/api_v1/
- **Playwright**: https://playwright.dev/
- **sockpuppetbrowser**: https://github.com/dgtlmoon/sockpuppetbrowser

---

## Related Services

- **n8n**: Automation workflows (integrate with changedetection webhooks)
- **NocoDB**: Database UI (if storing monitoring data)
- **Caddy**: Reverse proxy handling HTTPS and routing

---

## Maintenance

### Regular Tasks
- [ ] Weekly backup of `/srv/data/changedetection/`
- [ ] Monthly review of watched URLs (remove obsolete)
- [ ] Quarterly update to latest image
- [ ] Check disk space usage in `/srv/data/`

### Monitoring
```bash
# Disk usage
du -sh /srv/data/changedetection/

# Watch count and status
curl -s http://changedetection:5000/ | grep -i "watch"

# Container uptime
docker ps --filter name=changedetection --format '{{.Status}}'
```

---

## Changelog

### 2026-01-28 - API & Playwright Documentation
- Added API authentication documentation
- Configured `SALTED_PASS` for API access
- Integrated Playwright browser setup documentation
- Added browser-steps usage examples
- Documented troubleshooting procedures

### 2026-01-27 - Initial Deployment
- Installed changedetection.io v0.52.9
- Configured FayaaLink standard setup
- Added Caddy reverse proxy route
- Enabled USE_X_SETTINGS for proper IP forwarding
- Set timezone to Asia/Riyadh
- Created backup procedures
- Deployed Playwright Chrome browser service

---

**Deployed by**: MiniDabbirni (Infrastructure Operator)  
**Installation Date**: 2026-01-27  
**Last Updated**: 2026-01-28
