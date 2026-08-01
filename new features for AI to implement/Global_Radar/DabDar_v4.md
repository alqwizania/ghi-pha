# DabDar v4.0 — Scalable Source Architecture Plan

> **Document Version**: 1.0  
> **Created**: 2026-02-07  
> **Author**: DarDab (Health Surveillance Specialist)  
> **Status**: Planning Phase

---

## Executive Summary

DarDab v4.0 is the next evolution of the DabDar health surveillance system, focused on **source scalability**. The current v3.0 architecture has proven operational (222 findings captured) but suffers from configuration fragmentation and hardcoded source definitions that make adding new sources a 7-8 step process across 5+ files.

**Goal**: Reduce "add new source" workflow from 7-8 steps to 1-2 steps.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Production Infrastructure](#production-infrastructure)
3. [Source Inventory](#source-inventory)
4. [Bugs & Issues](#bugs--issues)
5. [Phase 1: Configuration Consolidation](#phase-1-configuration-consolidation)
6. [Phase 2: Plugin-Based Parsers](#phase-2-plugin-based-parsers)
7. [Phase 3: Full Plugin Architecture](#phase-3-full-plugin-architecture)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Appendix](#appendix)

---




## Phase 2: Plugin-Based Parsers

**Effort**: 1 week  
**Risk**: Medium  
**Goal**: Add new sources without code changes using configurable parsers

### Problem

Each source requires a hardcoded parser in `unified_scan_workflow.py`:

```python
def _parse_content(self, content, source_type, source_name):
    if source_type == "who_outbreak":
        return self._parse_who_outbreak(content, source_name)
    elif source_type == "cdc_outbreak":
        return self._parse_cdc_outbreak(content, source_name)
    else:
        return self._parse_generic(content, source_name)
```

### Solution: Parser Plugin Architecture

```
parsers/
├── __init__.py           # Parser registry
├── base_parser.py        # Abstract base class
├── who_parser.py         # WHO-specific parser
├── cdc_parser.py         # CDC-specific parser
├── generic_parser.py     # CSS selector-based parser
└── ai_parser.py          # LLM-based extraction (fallback)
```

### Config-Driven Parser

```json
{
  "id": "ECDC",
  "type": "changedetection",
  "parser": "generic",
  "parser_config": {
    "item_selector": "article.threat-item",
    "title_selector": "h2.threat-title",
    "date_selector": "span.date",
    "date_format": "%d %B %Y",
    "content_selector": "div.threat-content",
    "link_selector": "a.read-more"
  }
}
```

### AI Fallback Parser

```python
class AIParser(BaseParser):
    """Use LLM when CSS selectors fail or for unknown sources."""
    
    async def parse(self, content: str, source: Source) -> List[RawFinding]:
        prompt = f"""
        Extract disease outbreak findings from this content.
        Source: {source.name}
        
        For each finding, extract:
        - headline: Main title
        - disease: Disease name (or "Unknown")
        - date: Publication date (YYYY-MM-DD)
        - location: Geographic location
        - summary: Brief description
        
        Return as JSON array.
        
        Content:
        {content[:8000]}
        """
        return await self._extract_with_llm(prompt)
```

---

## Phase 3: Full Plugin Architecture

**Effort**: 2-3 weeks  
**Risk**: Medium-High  
**Goal**: Database-backed source registry, hot-reload, UI management

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   Full Plugin Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────┐     ┌─────────────────────┐           │
│   │   Admin UI/API      │────▶│  Source Registry    │           │
│   │   (Add/Edit/Test)   │     │  (NocoDB Table)     │           │
│   └─────────────────────┘     └──────────┬──────────┘           │
│                                          │                       │
│   ┌──────────────────────────────────────┼──────────────────┐   │
│   │              Source Handler Manager  │                   │   │
│   │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────┐ │   │
│   │  │ ChangeDet │ │    RSS    │ │  Google   │ │  Custom  │ │   │
│   │  │  Handler  │ │  Handler  │ │  Handler  │ │  Handler │ │   │
│   │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └────┬─────┘ │   │
│   └────────┼─────────────┼─────────────┼────────────┼───────┘   │
│            │             │             │            │            │
│   ┌────────▼─────────────▼─────────────▼────────────▼───────┐   │
│   │                  Unified Processing Pipeline             │   │
│   │  Fetch ──▶ Parse ──▶ Analyze ──▶ Translate ──▶ Store    │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### NocoDB Sources Table Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | Text (PK) | Unique source ID (e.g., "ECDC") |
| `name` | Text | Display name |
| `type` | SingleSelect | changedetection, rss, google, api |
| `url` | URL | Source URL |
| `watch_uuid` | Text | ChangeDetection.io watch UUID |
| `parser` | Text | Parser ID or "ai" |
| `parser_config` | JSON | CSS selectors, patterns |
| `check_interval` | JSON | {hours, minutes, seconds} |
| `config` | JSON | Type-specific config |
| `enabled` | Checkbox | Active/Inactive |
| `last_scan` | DateTime | Last successful scan |
| `last_error` | LongText | Last error message |
| `status` | SingleSelect | healthy, error, disabled |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |

### Admin API Endpoints

```
POST   /api/admin/sources           — Create new source
GET    /api/admin/sources           — List all sources
GET    /api/admin/sources/{id}      — Get source details
PUT    /api/admin/sources/{id}      — Update source
DELETE /api/admin/sources/{id}      — Delete source
POST   /api/admin/sources/{id}/test — Test source (fetch & parse)
POST   /api/admin/sources/reload    — Hot-reload all sources
```

### Hot-Reload Capability

```python
@app.post("/api/admin/sources/reload")
async def reload_sources():
    """Reload sources without container restart."""
    source_registry.reload()
    return {
        "status": "reloaded",
        "sources": len(source_registry.list_all()),
        "enabled": len(source_registry.list_enabled())
    }
```

---

## Implementation Roadmap

| Phase | Timeline | Deliverables | Risk |
|-------|----------|--------------|------|
| **Bug Fixes** | Week 1 | Fix BUG-001 to BUG-005 | Low |
| **Phase 1** | Week 2-3 | `sources.json`, `source_registry.py` | Low |
| **Phase 2** | Week 4-5 | `parsers/` directory, CSS selectors, AI fallback | Medium |
| **Phase 3** | Week 6-8 | NocoDB sources table, Admin API, hot-reload | Medium-High |

### Week 1: Bug Fixes (Priority Order)

1. **BUG-001**: Fix deduplication (duplicate COVID-19 entries)
2. **BUG-002**: Fix notification pipeline (all `notification_sent: false`)
3. **BUG-005**: Investigate overdue watches
4. **BUG-003**: Activate CDC_RSS
5. **BUG-004**: Activate Google Search

### Week 2-3: Phase 1

1. Create `config/sources.json`
2. Create `health_agents/shared/source_registry.py`
3. Refactor `models.py` to use registry
4. Refactor `server.py` to use registry
5. Refactor `unified_scan_workflow.py` to use registry
6. Test all sources working
7. Document new "add source" process

### Week 4-5: Phase 2

1. Create `parsers/base_parser.py`
2. Migrate WHO parser to plugin
3. Migrate CDC parser to plugin
4. Create generic CSS selector parser
5. Create AI fallback parser
6. Add `parser_config` to sources.json
7. Test with new source (ECDC)

### Week 6-8: Phase 3

1. Design NocoDB sources table
2. Migrate `sources.json` to NocoDB
3. Create Admin API endpoints
4. Implement hot-reload
5. Create simple admin UI (optional)
6. Documentation and training

---

## Appendix

### A. Current File Structure

```
health-agents/
├── server.py                 # FastAPI main entrypoint
├── main.py                   # Alternative entrypoint
├── health_agents/
│   ├── shared/
│   │   ├── models.py         # Pydantic models, VALID_SOURCES ❌
│   │   ├── context.py
│   │   ├── config_loader.py
│   │   └── tracing.py
│   ├── master_agent.py
│   ├── fetcher_agent.py
│   ├── epidemiological_agent.py
│   ├── translator_agent.py
│   └── database_agent.py
├── tools/
│   ├── nocodb_client.py
│   ├── changedetection_client.py
│   ├── deduplication.py
│   ├── rss_parser.py
│   ├── google_search.py
│   ├── epi_triad_analyzer.py
│   ├── arabic_translator.py
│   └── email_digest.py
├── workflows/
│   ├── unified_scan_workflow.py   # WATCH_CONFIG hardcoded ❌
│   ├── email_digest_workflow.py
│   ├── periodic_scan_workflow.py
│   └── webhook_workflow.py
├── config/
│   ├── agency_configs.json        # Partial source config
│   └── diseases.json
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
└── .env
```

### B. Proposed File Structure (v4)

```
health-agents/
├── server.py
├── health_agents/
│   ├── shared/
│   │   ├── models.py
│   │   ├── source_registry.py     # NEW ✅
│   │   ├── context.py
│   │   └── config_loader.py
│   └── agents/...
├── parsers/                        # NEW ✅
│   ├── __init__.py
│   ├── base_parser.py
│   ├── who_parser.py
│   ├── cdc_parser.py
│   ├── generic_parser.py
│   └── ai_parser.py
├── handlers/                       # NEW ✅
│   ├── __init__.py
│   ├── base_handler.py
│   ├── changedetection_handler.py
│   ├── rss_handler.py
│   └── google_handler.py
├── tools/...
├── workflows/
│   └── unified_pipeline.py        # Simplified ✅
├── config/
│   ├── sources.json               # NEW - Single source of truth ✅
│   └── diseases.json
└── ...
```

### C. NocoDB Findings Table Schema

| Field | Type | Notes |
|-------|------|-------|
| id | Number | Auto-increment PK |
| date | Date | Legacy |
| agency | Text | Legacy |
| headline | LongText | Finding title |
| summary | LongText | Legacy |
| url | URL | Legacy |
| disease | Text | Disease name |
| source | Text | Source ID |
| source_type | Text | changedetection, rss, google_search |
| source_link | URL | Original URL |
| publication_date | Date | YYYY-MM-DD |
| short_description_en | LongText | English summary |
| detailed_description_en | LongText | English analysis |
| short_description_ar | LongText | Arabic summary |
| detailed_description_ar | LongText | Arabic analysis |
| content_hash | Text | SHA-256 for dedup |
| priority | SingleSelect | critical, high, medium, low |
| notification_sent | Checkbox | Included in digest? |

### D. API Quick Reference

#### ChangeDetection.io

```bash
# List watches
curl -X GET "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"

# Get latest snapshot
curl -X GET "https://changedetection.fayaa92.sa/api/v1/watch/{uuid}/history/latest" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"

# Force recheck
curl -X GET "https://changedetection.fayaa92.sa/api/v1/watch/{uuid}?recheck=1" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"

# Create watch
curl -X POST "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" \
  -H "Content-Type: application/json" \
  -d '{"url": "...", "title": "...", "notification_urls": ["..."]}'
```

#### DabDar API

```bash
# Health check
curl https://phn-agents.fayaa92.sa/status

# Trigger scan
curl -X POST https://phn-agents.fayaa92.sa/api/scan-unified

# Get findings
curl https://phn-agents.fayaa92.sa/api/findings?limit=10

# Trigger digest
curl -X POST https://phn-agents.fayaa92.sa/api/trigger-digest
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-07 | Initial document |

---

**Document maintained by**: DarDab (Health Surveillance Specialist)  
**Project location**: `/srv/docker/health-agents`
