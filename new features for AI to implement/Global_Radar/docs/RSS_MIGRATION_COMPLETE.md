# RSS Migration Complete — SehaRadar v1.0

**Date**: 2026-02-17  
**Status**: ✅ COMPLETE  
**Impact**: All RSS feeds now unified through ChangeDetection.io

---

## Summary

Successfully migrated all RSS feeds from direct parsing (`tools/rss_parser.py`) to **ChangeDetection.io monitoring** for a unified data pipeline.

## What Changed?

### Before Migration
```
+-- Direct RSS Parsing (tools/rss_parser.py)
    +-- WHO RSS Feed (https://www.who.int/rss-feeds/news-english.xml)
    +-- CDC RSS Feed (https://tools.cdc.gov/podcasts/feed.asp?feedid=183)
    
+-- ChangeDetection.io Monitoring
    +-- WHO Disease Outbreak News (HTML page)
    +-- CDC Outbreaks (HTML page)
    +-- ... 35 other HTML sources
```

### After Migration
```
+-- ChangeDetection.io Monitoring (UNIFIED)
    +-- RSS Feeds (7 sources via rss.app)
    |   +-- Reuters Health + Pharma
    |   +-- Reuters Health
    |   +-- CNN Health
    |   +-- Healio Medical News
    |   +-- Google News - Mpox
    |   +-- Google News - Cholera
    |   +-- WHO News
    |
    +-- HTML Pages (37 sources)
        +-- WHO Disease Outbreak News
        +-- CDC Outbreaks
        +-- ... 35 other sources
```

**Total: 44 ChangeDetection sources** (up from 37)

---

## RSS Feeds Migrated

| Feed | Old Method | New Method | Watch UUID | Status |
|------|-----------|------------|------------|--------|
| **Reuters Health + Pharma** | N/A (new) | ChangeDetection | `98e706cb-e8f2-45...` | ✅ Active |
| **Reuters Health** | N/A (new) | ChangeDetection | `ad715415-ca05-46...` | ✅ Active |
| **CNN Health** | N/A (new) | ChangeDetection | `d35ce994-4cab-4e...` | ✅ Active |
| **Healio Medical News** | N/A (new) | ChangeDetection | `b8ce8ccf-14f1-43...` | ✅ Active |
| **Google News - Mpox** | N/A (new) | ChangeDetection | `b4dd60a3-a480-4e...` | ✅ Active |
| **Google News - Cholera** | N/A (new) | ChangeDetection | `ab645e83-08f4-4a...` | ✅ Active |
| **WHO News** | Direct RSS | ChangeDetection | `25995173-ef67-49...` | ✅ Active |
| **CDC RSS** | Direct RSS | ❌ Deprecated | - | Removed |

---

## Changes Made

### 1. Configuration (`config/sources.json`)

**Version**: `2.1` → `2.2`

**Changes**:
- Removed legacy `"type": "rss"` entries (WHO_RSS, CDC_RSS)
- Added 7 new `"type": "changedetection"` entries for RSS feeds
- All RSS feeds now have `"rss-feed"` tag for identification
- Updated metadata: `total_sources: 41 → 46`, `changedetection: 37 → 44`, `rss: 2 → 0`

**Example Entry**:
```json
{
  "id": "WHO_NEWS_RSS",
  "name": "WHO News (RSS via ChangeDetection)",
  "type": "changedetection",
  "watch_uuid": "25995173-ef67-4939-84f9-697fc8502e16",
  "url": "https://rss.app/feeds/v1.1/685HhozUdKFT2jXq.json",
  "parser": "generic",
  "check_interval": { "hours": 3 },
  "enabled": true,
  "tags": ["health-surveillance", "primary", "rss-feed"]
}
```

### 2. Code Deprecation

**Deprecated (not removed)**:
- `tools/rss_parser.py` — Marked with deprecation warnings
- `fetch_rss_feeds()` — Logs warning, still functional
- `fetch_all_rss_sources()` — Logs warning, still functional
- `fetch_from_rss()` in `fetcher_agent.py` — Marked deprecated

**Removal Timeline**:
- v1.0: Deprecated with warnings
- v1.1: Will log louder warnings
- v2.0: Complete removal

### 3. Documentation

**New Files**:
- `docs/RSS_DEPRECATION.md` — Deprecation notice and migration guide
- `docs/RSS_MIGRATION_COMPLETE.md` — This file

---

## Verification

### Source Registry
```bash
$ python -c "from health_agents.shared.source_registry import source_registry; \\
  stats = source_registry.get_statistics(); \\
  print(f'Total: {stats[\"total_sources\"]}, Types: {stats[\"by_type\"]}')"

Total: 46, Types: {'changedetection': 44, 'rss': 0, 'google_search': 1}
```

### ChangeDetection API
```bash
$ curl -H "x-api-key: $CHANGEDETECTION_API_KEY" \\
  https://changedetection.fayaa92.sa/api/v1/watch | jq 'length'

42
```

*Note: 42 watches in ChangeDetection (44 configured - 2 disabled)*

### Unified Scan
```bash
$ curl -X POST http://localhost:8080/api/scan-unified
{"status": "accepted", "message": "Unified scan (ChangeDetection.io) triggered"}
```

**Scan Output**:
```
📡 Found 42 watches in ChangeDetection.io
📥 Processing: WHO (4125358c...) [Parser: who_outbreak]
📥 Processing: CDC (097d6524...) [Parser: cdc_outbreak]
... (40 more sources)
✅ UNIFIED SCAN COMPLETE
```

---

## Benefits

### ✅ Single Source of Truth
- **Before**: 2 separate systems (RSS parser + ChangeDetection)
- **After**: 1 unified system (ChangeDetection only)

### ✅ Better Change Detection
- **Before**: RSS polls every N hours, no diff tracking
- **After**: ChangeDetection tracks changes with snapshots and diff history

### ✅ Webhook Support
- **Before**: RSS requires scheduled polling
- **After**: Immediate webhook notifications on content changes

### ✅ Consistent Processing
- **Before**: RSS → custom parsing, ChangeDetection → unified workflow
- **After**: All sources → unified workflow (fetch → parse → analyze → store)

### ✅ Easier Monitoring
- **Before**: Monitor 2 systems separately
- **After**: Monitor 1 system (ChangeDetection dashboard)

---

## For Developers

### Adding New RSS Feeds

**Old Way (DEPRECATED)**:
```python
# tools/rss_parser.py
DEFAULT_FEEDS = {
    "NEW_RSS": {
        "url": "https://example.com/feed.xml",
        "category": "health_news"
    }
}
```

**New Way (RECOMMENDED)**:
1. Add to ChangeDetection.io (via UI or API):
   ```bash
   curl -X POST https://changedetection.fayaa92.sa/api/v1/watch \
     -H "x-api-key: $KEY" \
     -d '{
       "url": "https://example.com/feed.xml",
       "title": "Example RSS Feed",
       "tag": "rss-feed"
     }'
   ```

2. Add to `config/sources.json`:
   ```json
   {
     "id": "EXAMPLE_RSS",
     "name": "Example RSS Feed",
     "type": "changedetection",
     "watch_uuid": "<uuid-from-step-1>",
     "parser": "generic",
     "tags": ["rss-feed"]
   }
   ```

3. Restart service or reload config

---

## Testing

### Test Unified Scan
```bash
curl -X POST http://localhost:8080/api/scan-unified
```

### Check Logs
```bash
docker logs seha-radar -f | grep -E "(RSS|Processing:)"
```

### Verify RSS Feeds Processed
```bash
docker logs seha-radar | grep "📥 Processing:" | grep -i "rss\|reuters\|cnn\|healio"
```

---

## Rollback Plan

If issues arise, you can temporarily re-enable legacy RSS:

1. Revert `config/sources.json` to v2.1
2. Re-enable RSS endpoints in `server.py`
3. Set `RSS_SCAN_ENABLED=true` in `.env`

**Note**: Not recommended. ChangeDetection is now the standard.

---

## Next Steps

1. **Monitor Performance**: Track unified scan performance over 7 days
2. **Remove Legacy Code**: Plan removal of `rss_parser.py` in v2.0
3. **Expand Coverage**: Add more RSS feeds to ChangeDetection as needed

---

## Questions?

- See `docs/RSS_DEPRECATION.md` for migration details
- See `unified_scan_workflow.py` for implementation
- Check ChangeDetection.io dashboard for feed status

---

**Migration completed by**: OpenCode Assistant  
**Date**: 2026-02-17  
**Version**: SehaRadar v1.0 (sources.json v2.2)
