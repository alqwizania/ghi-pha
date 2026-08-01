# RSS Direct Parsing - DEPRECATED

**Date**: 2026-02-17  
**Status**: DEPRECATED (but not removed for backward compatibility)  
**Migration**: Complete

## Summary

Direct RSS parsing via `tools/rss_parser.py` is **deprecated** as of v1.0.

All RSS feeds are now monitored through **ChangeDetection.io** for a unified data pipeline.

## Why?

1. **Unified Monitoring**: Single source of truth (ChangeDetection.io) for all website/feed monitoring
2. **Better Change Detection**: ChangeDetection tracks changes with snapshots and diff history
3. **Webhook Support**: Immediate notifications on content changes
4. **Consistent Processing**: All sources flow through the same pipeline (fetch → parse → analyze → store)

## Migration Complete

### Before (v0.x - v3.x)
```
WHO RSS Feed → rss_parser.py → Direct parsing → Analysis
CDC RSS Feed → rss_parser.py → Direct parsing → Analysis
```

### After (v1.0+)
```
WHO RSS Feed → ChangeDetection.io → unified_scan_workflow.py → Analysis
CDC RSS Feed → ChangeDetection.io → unified_scan_workflow.py → Analysis
```

## RSS Feeds Migrated to ChangeDetection

| Old ID | New ID | Watch UUID | Status |
|--------|--------|------------|--------|
| `WHO_RSS` | `WHO_NEWS_RSS` | `25995173-ef67-49...` | ✅ Migrated |
| `CDC_RSS` | (deprecated) | - | ❌ Not in ChangeDetection |
| - | `REUTERS_HEALTH` | `ad715415-ca05-46...` | ✅ New |
| - | `CNN_HEALTH_RSS` | `d35ce994-4cab-4e...` | ✅ New |
| - | `HEALIO` | `b8ce8ccf-14f1-43...` | ✅ New |
| - | `GOOGLE_MPOX_RSS` | `b4dd60a3-a480-4e...` | ✅ New |
| - | `GOOGLE_CHOLERA_RSS` | `ab645e83-08f4-4a...` | ✅ New |

## What's Deprecated?

### Files (kept for backward compatibility)
- `tools/rss_parser.py` — Direct RSS parsing class
- RSS-related functions in `tools/__init__.py`

### Functions
- `fetch_rss_feeds()` — Use `unified_scan_workflow` instead
- `fetch_all_rss_sources()` — Use `unified_scan_workflow` instead
- `fetch_from_rss()` in `fetcher_agent.py` — No longer used

### Source Type
- `"type": "rss"` in `sources.json` — Now `"type": "changedetection"` with tag `"rss-feed"`

## Removal Timeline

- **v1.0**: Deprecation notice added, RSS code marked as legacy
- **v1.1**: RSS functions will log deprecation warnings
- **v2.0**: RSS functions removed entirely

## For Developers

If you need to add a new RSS feed:

1. ❌ **Don't** add it to `rss_parser.py`
2. ✅ **Do** add it to ChangeDetection.io:
   ```bash
   # Via ChangeDetection web UI or API
   POST /api/v1/watch
   {
     "url": "https://example.com/feed.xml",
     "title": "Example RSS Feed",
     "tag": "rss-feed",
     "fetch_backend": "html_requests"
   }
   ```
3. ✅ **Do** add it to `config/sources.json`:
   ```json
   {
     "id": "EXAMPLE_RSS",
     "name": "Example RSS Feed",
     "type": "changedetection",
     "watch_uuid": "uuid-from-changedetection",
     "parser": "generic",
     "tags": ["rss-feed"]
   }
   ```

## Testing

```bash
# Old way (deprecated)
curl -X POST http://localhost:8080/api/scan-rss

# New way (recommended)
curl -X POST http://localhost:8080/api/scan-unified
```

## Questions?

Contact the SehaRadar team or see `unified_scan_workflow.py` for the current implementation.
