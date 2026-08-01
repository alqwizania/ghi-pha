# ChangeDetection Playwright Chrome Timeout Fix

**Date**: 2026-01-31 (Updated: 2026-02-01)  
**Issue**: `BrowserType.connect_over_cdp: Timeout 60000ms exceeded`  
**Status**: ✅ **RESOLVED** (with worker reduction fix applied)

---

## Problem Summary

### Symptoms

ChangeDetection.io watches were failing with this error:

```
ERROR | changedetectionio.async_update_worker:async_update_worker:355 - 
BrowserType.connect_over_cdp: Timeout 60000ms exceeded.
Call log:
  - <ws connecting> ws://playwright-chrome:3000/
  - <ws connected> ws://playwright-chrome:3000/
```

**Affected Watches**:
- WHO (`4125358c-e214-432b-a534-417be9664cca`)
- CDC (`097d6524-4761-45ac-b4a7-ba377745a368`)
- PROMED (`ee064572-cd0c-4e42-b512-43b7f7300684`)
- PLACEHOLDER_1 (`e8e67f93-1741-4ea6-b61a-b514855b6b5c`)

---

## Root Cause

### Playwright Chrome Proxy Issue

The `playwright-chrome` container (sockpuppetbrowser) was **accumulating zombie Chrome processes**:

**Before Fix**:
```bash
$ docker exec playwright-chrome ps aux | grep chromium
19849 chrome    0:00 [chromium]  ← Zombie (defunct)
19979 chrome    1:19 [chromium]  ← Zombie
24782 chrome    0:00 [chromium]  ← Zombie
31266 chrome    0:03 [chromium]  ← Zombie
31481 chrome    6:27 [chromium]  ← Zombie
... (13 zombie processes total)
```

**playwright-chrome logs showed**:
```
WARNING | WebSocket ID: ... - Network error connecting to Chrome at http://localhost:10185/json/version
ERROR   | _request_retry exceeded overall timeout (60s) after 8 attempts
ERROR   | Something bad happened when connecting to Chrome CDP - 'did not receive a valid HTTP response'
```

### Why This Happens

1. **Chrome processes crash or hang** during page rendering
2. **Parent process fails to clean up** child Chrome instances
3. **Zombie processes accumulate** over time (3 days uptime in this case)
4. **New Chrome instances fail** because resources exhausted or ports blocked
5. **ChangeDetection times out** waiting for valid Chrome response

---

## Solution

### Permanent Fix: Reduce Worker Concurrency (APPLIED ✅)

Based on [GitHub Discussion #2821](https://github.com/dgtlmoon/changedetection.io/discussions/2821), the most effective solution is **reducing concurrent workers**:

**Changes Applied**:
1. `FETCH_WORKERS`: 10 → **5** (in `.env`)
2. `MAX_CONCURRENT_CHROME_PROCESSES`: 10 → **5** (in `docker-compose.yml`)

**Why This Works**: Multiple concurrent rechecks can overwhelm the browser container, causing:
- Connection pool exhaustion
- Resource contention
- Chrome process accumulation
- Timeout errors

**Verified Solution**: This fix resolved the issue for multiple users in the GitHub discussion.

### Immediate Fix (If Error Occurs): Restart Playwright Chrome

```bash
docker restart playwright-chrome
```

**Result**:
```
INFO | Connections: Active count 0 of max 10, Total processed: 0.
INFO | Process info: 0 child processes
SUCCESS | Starting Chrome proxy, Listening on ws://0.0.0.0:3000
```

All zombie processes cleared ✅

---

## Verification

### After Restart

```bash
# Check process count
$ docker exec playwright-chrome ps aux | grep chromium | wc -l
1  # Only the main process (healthy)

# Check container health
$ docker ps --filter name=playwright-chrome
STATUS
Up 5 minutes (healthy)

# Check logs
$ docker logs playwright-chrome --tail 20
SUCCESS | Starting Chrome proxy, Listening on ws://0.0.0.0:3000
INFO    | Connections: Active count 0 of max 10, Total processed: 0.
INFO    | Process info: 0 child processes
```

---

## Prevention Strategies

### Option 1: Scheduled Restarts (Recommended)

Add a cron job to restart playwright-chrome weekly:

```bash
# Add to root crontab
0 3 * * 0 docker restart playwright-chrome >> /var/log/playwright-chrome-restart.log 2>&1
```

**Schedule**: Every Sunday at 3:00 AM

### Option 2: Memory Limits

Add resource limits to prevent runaway processes:

**Edit** `/srv/docker/changedetection/docker-compose.yml`:

```yaml
playwright-chrome:
  image: dgtlmoon/sockpuppetbrowser:latest
  container_name: playwright-chrome
  restart: unless-stopped
  
  # Add resource limits
  deploy:
    resources:
      limits:
        cpus: '2.0'
        memory: 2G
      reservations:
        memory: 512M
  
  environment:
    - SCREEN_WIDTH=1920
    - SCREEN_HEIGHT=1080
    - SCREEN_DEPTH=24
    - MAX_CONCURRENT_CHROME_PROCESSES=5  # Reduce from 10 to 5
```

**Then restart**:
```bash
cd /srv/docker/changedetection
docker compose down playwright-chrome
docker compose up -d playwright-chrome
```

### Option 3: Health Check Automation

Playwright already has a health check. Improve restart policy:

```yaml
playwright-chrome:
  restart: unless-stopped
  
  healthcheck:
    test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8080/stats', timeout=5)"]
    interval: 60s       # Check every minute
    timeout: 10s
    retries: 3          # Allow 3 failures
    start_period: 30s
```

If health check fails 3 times, Docker automatically restarts the container.

### Option 4: Monitoring Script

Create a script to detect and restart on zombie accumulation:

**Create** `/home/fayaalink/.local/bin/playwright-zombie-check.sh`:

```bash
#!/bin/bash
# Check for zombie Chrome processes in playwright-chrome container

ZOMBIE_THRESHOLD=5
ZOMBIE_COUNT=$(docker exec playwright-chrome ps aux | grep -c '\[chromium\]')

if [ "$ZOMBIE_COUNT" -gt "$ZOMBIE_THRESHOLD" ]; then
    echo "$(date): $ZOMBIE_COUNT zombie processes detected. Restarting playwright-chrome..."
    docker restart playwright-chrome
    echo "$(date): Restart complete."
fi
```

**Add to crontab**:
```bash
*/30 * * * * /home/fayaalink/.local/bin/playwright-zombie-check.sh >> /var/log/playwright-zombie-check.log 2>&1
```

**Schedule**: Every 30 minutes

---

## Monitoring

### Check Zombie Process Count

```bash
# Count zombie Chrome processes
docker exec playwright-chrome ps aux | grep '\[chromium\]' | wc -l

# Expected: 0 (healthy)
# Warning: >5 (needs restart soon)
# Critical: >10 (restart immediately)
```

### Check Connection Stats

```bash
# HTTP stats endpoint
curl -s http://localhost:8080/stats

# Expected response:
{
  "connections": {
    "active": 0,
    "max": 10,
    "total_processed": 188
  },
  "processes": {
    "child_count": 0
  }
}
```

### Check ChangeDetection Errors

```bash
# Watch for Playwright timeout errors
docker logs changedetection -f | grep "BrowserType.connect_over_cdp"

# No output = healthy ✅
# Continuous errors = playwright-chrome needs restart ❌
```

---

## Troubleshooting

### If Errors Persist After Restart

**Check 1**: Verify network connectivity
```bash
docker network inspect caddy_default | grep -E "changedetection|playwright"
```

**Check 2**: Test direct connection
```bash
docker exec changedetection python3 -c "import urllib.request; urllib.request.urlopen('http://playwright-chrome:3000/')"
```

**Check 3**: Check resource usage
```bash
docker stats playwright-chrome --no-stream
```

**If CPU >80% or Memory >1.5GB**: Consider reducing `MAX_CONCURRENT_CHROME_PROCESSES`

### Nuclear Option: Full Restart

```bash
cd /srv/docker/changedetection
docker compose restart
```

This restarts **both** changedetection and playwright-chrome containers.

---

## Long-Term Solution

### Upstream Issue

This is a **known issue** with `dgtlmoon/sockpuppetbrowser` (Playwright Chrome proxy):
- Chrome processes don't always clean up properly
- Zombie accumulation over days/weeks
- No built-in cleanup mechanism

### Recommended Configuration

**Best practices** for production:

1. ✅ **Scheduled weekly restart** (Sunday 3 AM)
2. ✅ **Reduce concurrent processes** (from 10 to 5)
3. ✅ **Resource limits** (2GB memory max)
4. ✅ **Health check monitoring** (every 60s)
5. ✅ **Zombie process alert** (check every 30 minutes)

**Implement with**:
```bash
# 1. Add cron job
echo "0 3 * * 0 docker restart playwright-chrome" | sudo crontab -

# 2. Update docker-compose.yml (reduce MAX_CONCURRENT from 10 to 5)
# 3. Add resource limits to docker-compose.yml
# 4. Improve health check interval

# Restart with new config
cd /srv/docker/changedetection
docker compose down
docker compose up -d
```

---

## Summary

### What Happened
- playwright-chrome accumulated 13 zombie Chrome processes
- New Chrome instances failed to start
- ChangeDetection watch checks timed out after 60 seconds

### What Was Done
- Restarted playwright-chrome container
- Cleared all zombie processes
- Verified health (0 child processes, healthy status)

### Prevention
- Schedule weekly restart (Sunday 3 AM)
- Reduce concurrent Chrome processes (10 → 5)
- Add resource limits (2GB memory)
- Monitor zombie count (every 30 minutes)

### Current Status
✅ **RESOLVED** - All watches operational

---

**Issue Resolved**: 2026-01-31 13:45 UTC  
**Operator**: MiniDabbirni (Full-Stack)  
**Next Review**: Monitor for 7 days, implement prevention strategies
