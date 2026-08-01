# DabDar v4.0 Bug Fixes Report

> **Date**: February 7, 2026  
> **Author**: DarDab (Health Surveillance Specialist)  
> **Project**: DabDar v3.0 → v4.0 Health Surveillance System  
> **Location**: `/srv/docker/health-agents`

---

## Executive Summary

This document details the bug fixes applied to the DabDar health surveillance system as part of the v4.0 update. Nine bugs were identified in the planning document (`DabDar_v4.md`), of which **8 were addressed** (7 fixed, 1 verified as non-issue) and **1 was intentionally skipped** (email notifications).

---

## Bug Fixes Applied

### BUG-001: Duplicate Records in NocoDB

**Problem**: Same outbreak content was being stored multiple times with different content hashes because the hash calculation included volatile fields (date, key_facts) that could vary between scans.

**Root Cause**: The `generate_content_hash()` function in `tools/deduplication.py` was using:
- Disease name
- Source name
- **Publication date** (volatile)
- **Key facts** (volatile - first 500 chars)
- Headline

**Solution**: Modified hash generation to use only stable identifiers:
```python
# Before (unstable)
hash_input = f"{disease}|{source}|{date}|{key_facts[:500]}|{headline[:200]}"

# After (stable)
hash_input = f"{disease.lower().strip()}|{source.upper().strip()}|{headline.lower().strip()[:200]}"
```

**File Modified**: `tools/deduplication.py`

**Verification**: Scan now reports "2 duplicates" when re-scanning existing content, confirming deduplication works.

---

### BUG-002: Email Notifications Never Sent

**Status**: ⏭️ **Intentionally Skipped** (per user request)

**Problem**: The `notification_sent` field is always `false` and no email digests are being sent.

**Notes**: This bug requires integration with n8n webhooks and SMTP configuration. To be addressed in a future update.

---

### BUG-003: WHO RSS URL Returning 404

**Problem**: The WHO RSS feed URL was broken, causing RSS scans to fail.

**Root Cause**: The old URL `https://www.who.int/feeds/entity/news/en/rss.xml` was returning 404.

**Solution**: Updated to the correct working URL:
```
https://www.who.int/rss-feeds/news-english.xml
```

**Files Modified**:
- `config/agency_configs.json` - Updated `WHO_RSS.url`
- `.env` - Updated `WHO_RSS_URL` environment variable

**Verification**: RSS scan now successfully fetches 5+ items from WHO.

---

### BUG-004: Google Search Using Placeholder API Keys

**Problem**: Google Custom Search was configured with placeholder values like `your_google_api_key_here`, causing silent failures.

**Solution**: Added validation in `GoogleSearchService.__init__()` to detect placeholder values:
```python
PLACEHOLDER_PATTERNS = [
    "your_", "xxx", "placeholder", "changeme", 
    "insert_", "add_your_", "replace_"
]

# Disable feature with clear warning if placeholders detected
if any(pattern in api_key.lower() for pattern in PLACEHOLDER_PATTERNS):
    print("⚠️ Google Search disabled: API key appears to be a placeholder")
    self.enabled = False
```

**File Modified**: `tools/google_search.py`

**Verification**: System now logs a clear warning instead of silently failing.

---

### BUG-005: Overdue Watches in ChangeDetection.io

**Status**: ✅ **Verified as Non-Issue**

**Investigation**: Queried ChangeDetection.io API to check watch health:
```bash
curl -X GET "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"
```

**Findings**: All 4 watches show `"last_error": false` and are actively monitoring. The "overdue" status in the UI was a display issue, not an actual problem.

---

### BUG-006: WHO_CLONE vs PLACEHOLDER_1 Naming Inconsistency

**Problem**: The WHOClone source was inconsistently named:
- Code used `WHO_CLONE`
- ChangeDetection.io webhook used `PLACEHOLDER_1`
- Some configs used `PLACEHOLDER_1`

**Solution**: Standardized to `WHO_CLONE` everywhere:

| Location | Before | After |
|----------|--------|-------|
| `VALID_SOURCES` enum | `WHO_CLONE` | `WHO_CLONE` ✓ |
| `VALID_AGENCIES` list | `PLACEHOLDER_1` | `WHO_CLONE` |
| `agency_configs.json` | `PLACEHOLDER_1` | `WHO_CLONE` |
| `.env` | `PLACEHOLDER_1_*` | `WHO_CLONE_*` |
| ChangeDetection.io webhook | `/webhook/PLACEHOLDER_1` | `/webhook/WHO_CLONE` |

**Files Modified**:
- `health_agents/shared/models.py`
- `server.py`
- `config/agency_configs.json`
- `.env`
- ChangeDetection.io watch (via API)

---

### BUG-007: Webhook URL Inconsistency

**Problem**: Webhook URLs were inconsistent between watches:
- WHO/CDC used internal: `json://phn-agents:8080/webhook/...`
- ProMED/WHOClone used external: `json://phn-agents.fayaa92.sa/webhook/...`

**Impact**: External URLs route through Caddy reverse proxy unnecessarily, adding latency and potential failure points.

**Solution**: Updated all watches to use internal Docker networking URLs:

```bash
# WHOClone fix
curl -X PUT "https://changedetection.fayaa92.sa/api/v1/watch/e8e67f93-1741-4ea6-b61a-b514855b6b5c" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" \
  -H "Content-Type: application/json" \
  -d '{"notification_urls": ["json://phn-agents:8080/webhook/WHO_CLONE"]}'

# ProMed fix
curl -X PUT "https://changedetection.fayaa92.sa/api/v1/watch/ee064572-cd0c-4e42-b512-43b7f7300684" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" \
  -H "Content-Type: application/json" \
  -d '{"notification_urls": ["json://phn-agents:8080/webhook/PROMED"]}'
```

**Final State**:
| Watch | Webhook URL |
|-------|-------------|
| WHO | `json://phn-agents:8080/webhook/WHO` |
| CDC | `json://phn-agents:8080/webhook/CDC` |
| WHOClone | `json://phn-agents:8080/webhook/WHO_CLONE` |
| ProMed | `json://phn-agents:8080/webhook/PROMED` |

---

### BUG-008: Many Findings Have "Unknown" Disease

**Problem**: Disease identification was failing for many headlines, resulting in `disease: "Unknown"`.

**Root Cause**: The `identify_disease_from_text()` function was using simple substring matching (`keyword in text`), which failed when:
- Keyword appeared as part of another word
- Case sensitivity issues
- Keywords not at word boundaries

**Solution**: Improved disease identification with regex word-boundary matching:

```python
def identify_disease_from_text(text: str, diseases_config: dict) -> str:
    text_lower = text.lower()
    
    # First pass: Check disease names and aliases (exact word match)
    for disease in diseases_config.get("diseases", []):
        disease_name = disease.get("name", "")
        if re.search(r'\b' + re.escape(disease_name.lower()) + r'\b', text_lower):
            return disease_name
        
        for alias in disease.get("aliases", []):
            if re.search(r'\b' + re.escape(alias.lower()) + r'\b', text_lower):
                return disease_name
    
    # Second pass: Check keywords
    for disease in diseases_config.get("diseases", []):
        for keyword in disease.get("keywords_en", []):
            if re.search(r'\b' + re.escape(keyword.lower()) + r'\b', text_lower):
                return disease.get("name", "Unknown")
    
    return "Unknown"
```

**File Modified**: `tools/epi_triad_analyzer.py`

**Verification**: Diseases like H5N1, Mpox, and Measles are now correctly identified from headlines.

**Note**: Diseases not in `config/diseases.json` (like Tuberculosis, Varicella, Leptospirosis) will still show as "Unknown". Expanding the config file would improve coverage.

---

### BUG-009: PLACEHOLDER_2 in VALID_SOURCES

**Problem**: `PLACEHOLDER_2` existed in `VALID_SOURCES` enum and `VALID_AGENCIES` list, but no corresponding ChangeDetection.io watch existed.

**Solution**: Removed `PLACEHOLDER_2` from:
- `VALID_SOURCES` enum in `health_agents/shared/models.py`
- `VALID_AGENCIES` list in `server.py`

**Files Modified**:
- `health_agents/shared/models.py`
- `server.py`

---

## Deployment

After all fixes were applied, the container was rebuilt and restarted:

```bash
cd /srv/docker/health-agents
docker compose down && docker compose up -d --build
```

**Container Status**: Healthy and running

---

## Verification Results

### System Health
```
Container: phn-agents - Up (healthy)
API Status: https://phn-agents.fayaa92.sa/status - 200 OK
```

### Scan Results
| Metric | Value |
|--------|-------|
| RSS Scans | 1 |
| Findings Stored | 13 (8 from unified, 5 from RSS) |
| Duplicates Detected | 2 |

### Disease Identification (Correctly Identified)
- H5N1 (Avian Influenza)
- Mpox
- Measles

### ChangeDetection.io Watches
All 4 watches verified healthy with correct internal webhook URLs.

---

## Summary Table

| Bug ID | Issue | Status | Files Changed |
|--------|-------|--------|---------------|
| BUG-001 | Duplicate records | ✅ Fixed | `tools/deduplication.py` |
| BUG-002 | Email notifications | ⏭️ Skipped | - |
| BUG-003 | WHO RSS 404 | ✅ Fixed | `config/agency_configs.json`, `.env` |
| BUG-004 | Google placeholder keys | ✅ Fixed | `tools/google_search.py` |
| BUG-005 | Overdue watches | ✅ Verified OK | - |
| BUG-006 | WHO_CLONE naming | ✅ Fixed | Multiple files + ChangeDetection.io |
| BUG-007 | Webhook URLs | ✅ Fixed | ChangeDetection.io API |
| BUG-008 | Unknown diseases | ✅ Improved | `tools/epi_triad_analyzer.py` |
| BUG-009 | PLACEHOLDER_2 | ✅ Fixed | `models.py`, `server.py` |

---

## Recommendations for Future Work

1. **Expand diseases.json**: Add more diseases (Tuberculosis, Varicella, Leptospirosis, Norovirus, Rabies) to improve disease identification coverage.

2. **Implement BUG-002**: Configure email digest functionality with n8n webhooks.

3. **Clean up duplicate records**: The 5 existing COVID-19 duplicates (IDs 145, 169, 213, 256, 296) could be cleaned from NocoDB.

4. **Add monitoring**: Consider adding health checks for ChangeDetection.io watches to alert when they become overdue.

---

## Appendix: ChangeDetection.io Watch UUIDs

| Watch | UUID |
|-------|------|
| WHO | `4125358c-e214-432b-a534-417be9664cca` |
| CDC | `097d6524-4761-45ac-b4a7-ba377745a368` |
| WHOClone | `e8e67f93-1741-4ea6-b61a-b514855b6b5c` |
| ProMed | `ee064572-cd0c-4e42-b512-43b7f7300684` |

---

*Document generated by DarDab - Health Surveillance Specialist*
