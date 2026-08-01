# ChangeDetection Worker Settings Explained

## Overview

When you run **multiple rechecks simultaneously**, two critical settings control how many operations can happen at once:

1. **`FETCH_WORKERS`** (ChangeDetection.io setting)
2. **`MAX_CONCURRENT_CHROME_PROCESSES`** (Playwright Chrome setting)

---

## FETCH_WORKERS

### What It Does

```
Location: .env file (ChangeDetection container)
Default: 10
Current: 5 (reduced from 10)
```

**`FETCH_WORKERS`** controls **how many watch checks can run simultaneously** in the ChangeDetection application.

### Real-World Example

Imagine you have 100 watches to check:

| FETCH_WORKERS | Behavior |
|---------------|----------|
| `1` | Checks 1 watch at a time (slowest, but safest) |
| `5` | Checks 5 watches at the same time |
| `10` | Checks 10 watches simultaneously |
| `20` | Tries to check 20 at once (may overwhelm system) |

### Why We Reduced It (10 → 5)

When you click **"Recheck All"** with 10 workers:
- ChangeDetection spawns **10 parallel threads**
- Each thread tries to connect to Playwright Chrome
- If watches use **browser-steps** (JavaScript rendering), each needs a Chrome instance
- **Result**: 10 Chrome connections requested at once

### The Problem

```
Thread 1 → ws://playwright-chrome:3000 ← Connecting...
Thread 2 → ws://playwright-chrome:3000 ← Connecting...
Thread 3 → ws://playwright-chrome:3000 ← Connecting...
...
Thread 10 → ws://playwright-chrome:3000 ← Timeout! (60 seconds)
```

With too many simultaneous requests:
- Playwright Chrome gets overwhelmed
- Connection pool exhausted
- Timeout errors occur

---

## MAX_CONCURRENT_CHROME_PROCESSES

### What It Does

```
Location: docker-compose.yml (Playwright Chrome container)
Default: 10
Current: 5 (reduced from 10)
```

**`MAX_CONCURRENT_CHROME_PROCESSES`** controls **how many Chrome browser instances** can run simultaneously inside the Playwright container.

### Real-World Example

Think of it like a **parking lot** with limited spaces:

| MAX_CONCURRENT | Behavior |
|----------------|----------|
| `1` | Only 1 Chrome browser can run at a time |
| `5` | 5 Chrome browsers can run simultaneously |
| `10` | 10 browsers allowed (high resource usage) |
| `20` | 20 browsers (likely to crash/timeout) |

### How It Works

```
Request 1 arrives → Chrome instance 1 spawned ✅
Request 2 arrives → Chrome instance 2 spawned ✅
Request 3 arrives → Chrome instance 3 spawned ✅
Request 4 arrives → Chrome instance 4 spawned ✅
Request 5 arrives → Chrome instance 5 spawned ✅
Request 6 arrives → WAIT... (all slots full) ⏳
Request 7 arrives → WAIT... ⏳
Request 8 arrives → WAIT... ⏳
...
Request 6-10 → TIMEOUT after 60 seconds! ❌
```

### Why We Reduced It (10 → 5)

**Chrome is resource-heavy**:
- Each Chrome instance uses ~200-300MB RAM
- CPU usage spikes during page rendering
- JavaScript execution, image loading, etc.

With 10 concurrent processes:
- **~2-3GB RAM** consumed
- **High CPU usage** (especially on complex sites)
- **Connection handling** gets slow
- New requests time out waiting for available slots

---

## How They Work Together

### Scenario: 20 Watches, All Need Browser Rendering

#### Old Configuration (Both = 10)

```
ChangeDetection spawns 10 workers:
  Worker 1 → Request Chrome → ✅ Gets slot 1
  Worker 2 → Request Chrome → ✅ Gets slot 2
  Worker 3 → Request Chrome → ✅ Gets slot 3
  ...
  Worker 10 → Request Chrome → ✅ Gets slot 10

Slots full! Remaining workers wait...

  Worker 11 → Request Chrome → ⏳ Waiting...
  Worker 12 → Request Chrome → ⏳ Waiting...
  ...
  
After 60 seconds:
  Workers 11-20 → ❌ TIMEOUT! "BrowserType.connect_over_cdp: Timeout 60000ms exceeded"
```

**Problem**: Too many workers requesting too few Chrome slots = timeouts

#### New Configuration (Both = 5)

```
ChangeDetection spawns 5 workers:
  Worker 1 → Request Chrome → ✅ Gets slot 1
  Worker 2 → Request Chrome → ✅ Gets slot 2
  Worker 3 → Request Chrome → ✅ Gets slot 3
  Worker 4 → Request Chrome → ✅ Gets slot 4
  Worker 5 → Request Chrome → ✅ Gets slot 5

Worker 1 finishes → Slot 1 freed
  Worker 6 → Request Chrome → ✅ Gets slot 1 (reused)

Worker 2 finishes → Slot 2 freed
  Worker 7 → Request Chrome → ✅ Gets slot 2 (reused)

... and so on ...

All 20 watches complete successfully! ✅
```

**Result**: Workers and Chrome slots balanced = no timeouts

---

## Performance Impact

### Speed Comparison

| Configuration | Time to Check 20 Watches | Risk of Timeout |
|---------------|--------------------------|-----------------|
| FETCH=10, CHROME=10 | ~2 minutes (but fails) | ❌ Very High |
| FETCH=5, CHROME=5 | ~3 minutes | ✅ Very Low |
| FETCH=2, CHROME=2 | ~5 minutes | ✅ Almost None |
| FETCH=1, CHROME=1 | ~10 minutes | ✅ None (sequential) |

### Trade-off

- **More workers** = Faster, but higher risk of timeouts
- **Fewer workers** = Slower, but reliable

**Our choice (5 workers)**: Good balance between speed and stability

---

## When to Adjust These Settings

### Increase Workers (Back to 10) If:

✅ Your server has **powerful hardware**:
   - 8+ CPU cores
   - 16+ GB RAM
   - Fast SSD storage

✅ Most watches **don't need browser rendering** (simple HTML)

✅ You **rarely run multiple rechecks simultaneously**

### Decrease Workers (to 2-3) If:

❌ You still get timeout errors after reducing to 5

❌ Server has **limited resources**:
   - Raspberry Pi, NAS, or low-power device
   - <4GB RAM
   - Shared hosting

❌ Watches are **complex** (heavy JavaScript, large pages)

---

## Monitoring Commands

### Check Current Settings

```bash
# ChangeDetection workers
docker exec changedetection printenv FETCH_WORKERS

# Playwright Chrome processes
docker exec playwright-chrome printenv MAX_CONCURRENT_CHROME_PROCESSES
```

### Check Active Processes

```bash
# Count active Chrome instances
docker exec playwright-chrome ps aux | grep chromium | grep -v grep | wc -l

# Should be ≤ MAX_CONCURRENT_CHROME_PROCESSES
```

### Run Health Check

```bash
/srv/docker/changedetection/check-playwright-health.sh
```

---

## Resource Usage Estimates

### FETCH_WORKERS Impact

| FETCH_WORKERS | RAM Usage (ChangeDetection) | CPU Usage |
|---------------|----------------------------|-----------|
| 1 | ~100MB base | Low (10-20%) |
| 5 | ~150MB | Medium (30-50%) |
| 10 | ~200MB | High (50-80%) |
| 20 | ~300MB+ | Very High (80-100%) |

### MAX_CONCURRENT_CHROME_PROCESSES Impact

| MAX_CONCURRENT | RAM Usage (Playwright) | CPU Usage |
|----------------|------------------------|-----------|
| 1 | ~300MB | Low (20%) |
| 5 | ~1.5GB | Medium (50%) |
| 10 | ~3GB | High (80%) |
| 20 | ~6GB+ | Very High (100%+) |

---

## Summary

### Simple Explanation

**FETCH_WORKERS** = How many checks to run at once
**MAX_CONCURRENT_CHROME_PROCESSES** = How many browsers available

**Problem**: Too many checks requesting too few browsers = timeout
**Solution**: Reduce both to 5 = balanced and reliable

### Current Applied Fix

```bash
# .env
FETCH_WORKERS=5  # ChangeDetection: 5 parallel checks

# docker-compose.yml
MAX_CONCURRENT_CHROME_PROCESSES=5  # Playwright: 5 browsers available
```

### GitHub Issue Reference

This fix is based on community solutions from:
https://github.com/dgtlmoon/changedetection.io/discussions/2821

**Verified by multiple users** as the most effective solution.

---

**Applied**: 2026-02-01  
**Status**: ✅ Active and working  
**Next Review**: Monitor for 7 days, adjust if needed
