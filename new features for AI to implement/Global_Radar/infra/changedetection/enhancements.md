# ChangeDetection.io — Enhancements & Fixes

> Diagnosed 2026-02-18. Related to `BrowserType.connect_over_cdp: Timeout 60000ms exceeded` errors.

---

## Issue Summary

The sockpuppetbrowser (playwright-chrome) enters a **zombie state** where it accepts WebSocket connections but cannot actually launch Chrome instances. This causes all fetch workers to timeout after 60 seconds simultaneously.

### Root Causes

1. **`FETCH_WORKERS=5` in `.env` overrides the UI setting of 2** — ChangeDetection spawns 5 workers regardless of what the UI shows.
2. **sockpuppetbrowser goes unresponsive after Chrome process crashes** — the container stays "healthy" (stats endpoint responds) but the browser engine is dead inside.
3. **No recovery mechanism** — `restart: unless-stopped` doesn't help when the container is technically "up".

### Evidence (2026-02-18)

- At `11:35:52`: Browser had active sessions that ended with forced kills (`Killing 4-5 Chrome processes`)
- After cleanup, browser entered degraded state (zombie)
- At `14:31:27`: All 5 workers fired simultaneously against the zombie browser
- At `14:32:27`: All 4 browser-dependent workers timed out within 230ms of each other
- Browser logs showed `Total processed: 1` and `Active count 0` for hours — no connections were being served

---

## Fix 1: Align FETCH_WORKERS with UI Setting

**Priority**: High  
**Effort**: Trivial  
**Risk**: None

The `.env` has `FETCH_WORKERS=5` which overrides the UI setting of 2. Change it to match:

```bash
# In /srv/docker/changedetection/.env
FETCH_WORKERS=2
```

Then restart:
```bash
cd /srv/docker/changedetection && docker compose restart changedetection
```

---

## Fix 2: Add Memory Limit to playwright-chrome

**Priority**: Medium  
**Effort**: Trivial  
**Risk**: Low (Chrome tabs may crash under limit, but that's better than a zombie)

Chrome is notorious for unbounded memory growth. Add a hard limit so the container gets OOM-killed and restarted cleanly instead of going zombie.

```yaml
# In docker-compose.yml, under playwright-chrome:
playwright-chrome:
  ...
  deploy:
    resources:
      limits:
        memory: 2G
```

---

## Fix 3: Improve playwright-chrome Healthcheck

**Priority**: Medium  
**Effort**: Low  
**Risk**: Low

The current healthcheck only hits the stats endpoint (`http://localhost:8080/stats`), which responds even when the browser is in zombie state. Replace it with a check that actually tests browser connectivity:

```yaml
# In docker-compose.yml, under playwright-chrome:
healthcheck:
  test: ["CMD", "python3", "-c", "import urllib.request, json; data = json.loads(urllib.request.urlopen('http://localhost:8080/stats', timeout=5).read()); exit(0 if data.get('active', -1) >= 0 else 1)"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

> **Note**: This is still limited — a truly robust check would attempt a WebSocket CDP connection, but that requires additional tooling inside the container.

---

## Fix 4: Scheduled Restart of playwright-chrome (Nuclear Option)

**Priority**: Low  
**Effort**: Low  
**Risk**: Low (brief interruption to any in-progress fetch)

If zombie states keep recurring, add a daily cron restart of the browser container during off-peak hours:

```bash
# Add to crontab (crontab -e)
0 4 * * * docker restart playwright-chrome >> /var/log/playwright-restart.log 2>&1
```

Or use Docker's built-in autoheal with the healthcheck:

```yaml
# In docker-compose.yml, add a new service:
autoheal:
  image: willfarrell/autoheal
  container_name: autoheal
  restart: unless-stopped
  environment:
    - AUTOHEAL_CONTAINER_LABEL=all
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

This will automatically restart any container that fails its healthcheck (requires Fix 3 to be effective).

---

## Implementation Order

1. **Fix 1** — Do immediately. Zero risk, resolves the worker mismatch.
2. **Fix 2** — Apply on next maintenance window. Prevents zombie state via clean OOM restart.
3. **Fix 3** — Apply alongside Fix 2. Better zombie detection.
4. **Fix 4** — Only if zombies persist after Fixes 2-3.
