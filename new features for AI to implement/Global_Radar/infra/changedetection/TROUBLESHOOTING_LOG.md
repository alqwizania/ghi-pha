# ChangeDetection Troubleshooting Log

## Issue #1: WHO Watch Stuck in "Overdue" State (Resolved)

**Date**: 2026-01-31  
**Watch UUID**: `4125358c-e214-432b-a534-417be9664cca`  
**Watch Name**: Who Disease Outbreak News  
**URL**: https://www.who.int/emergencies/disease-outbreak-news

### Symptoms
- Watch continuously showing in `overdue_watches` list
- `check_count: 0` - watch never completed its first check
- `history_n: 0` - no snapshots available
- Watch directory empty: `/datastore/4125358c-e214-432b-a534-417be9664cca/`
- `queue_size: 0` but watch not being processed by workers
- Health agents receiving webhook but failing to fetch snapshots

### Root Cause
Watch was stuck in an **overdue state** from initial creation. The scheduler marked it as overdue, but workers weren't picking it up from the queue. This appears to be a race condition during initial watch setup where:
1. Watch was created and scheduled
2. First check attempt started but never completed
3. Watch remained in "checking" state indefinitely
4. Scheduler marked it overdue but didn't reset it
5. Workers ignored the stuck watch

### Solution
**Restart the ChangeDetection service** to reset the scheduler and worker queues:

```bash
cd /srv/docker/changedetection
docker compose restart changedetection
```

### Results (After Fix)
- ✅ Worker 0 immediately picked up the watch on restart
- ✅ `check_count: 1` - first check completed successfully
- ✅ `history_n: 1` - baseline snapshot created
- ✅ `last_checked: 1769837918` - timestamp recorded
- ✅ `overdue_watches: []` - no longer overdue
- ✅ Snapshot files created:
  - `1769837918.html.br` (compressed HTML)
  - `last-screenshot.png` (409KB screenshot)
  - `history.txt` (change history)
  - `elements.deflate` (tracked elements)
  - `favicon.png` (site favicon)

### Prevention
This appears to be a rare race condition in ChangeDetection.io v0.52.9. If it happens again:

1. **Check for overdue watches**:
   ```bash
   curl -s -H "x-api-key: YOUR_API_KEY" \
     "https://changedetection.fayaa92.sa/api/v1/systeminfo" | jq '.overdue_watches'
   ```

2. **Check watch status**:
   ```bash
   curl -s -H "x-api-key: YOUR_API_KEY" \
     "https://changedetection.fayaa92.sa/api/v1/watch/WATCH_UUID" | \
     jq '{check_count, last_checked, history_n, paused}'
   ```

3. **Restart service if stuck**:
   ```bash
   docker compose restart changedetection
   ```

4. **Verify recovery**:
   - Watch should be processed within 30 seconds of restart
   - Check logs for: `Worker X processing watch UUID ...`
   - Verify `check_count` increments
   - Confirm `overdue_watches` list is empty

### Notes
- **First check does NOT trigger webhook** - ChangeDetection only sends notifications on detected changes, not on baseline creation
- Future changes to the WHO Disease Outbreak News page will trigger webhook to `json://phn-agents:8080/webhook/WHO`
- Watch uses `html_webdriver` (Playwright) fetch backend - resource intensive but handles JavaScript-heavy sites
- Default check interval configured in ChangeDetection settings (currently using `time_between_check_use_default: true`)

### Related Components
- ChangeDetection container: healthy throughout issue
- Playwright-chrome container: healthy throughout issue
- Health agents container: functional, but couldn't process webhooks without snapshots
- Caddy reverse proxy: working correctly

### Operator Notes
When investigating stuck watches:
1. Start with systeminfo API (overdue list, queue size)
2. Check watch-specific data (check_count, history_n)
3. Review logs for worker activity
4. Restart is safe - no data loss, baseline will be recreated
5. Monitor for 1-2 minutes after restart to confirm recovery

---

**Resolved by**: MiniDabbirni (Full-Stack Operator)  
**Resolution time**: ~15 minutes  
**Data loss**: None (no baseline existed to lose)
