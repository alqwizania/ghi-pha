# DabDar v4.0 Phase 2 Implementation Complete

**Date**: 2026-02-08  
**Phase**: Plugin-Based Parsers  
**Status**: ✅ Implemented

---

## What Was Implemented

### 1. Parser Plugin Architecture

Created a complete parser plugin system in `/srv/docker/SehaRadar/parsers/`:

```
parsers/
├── __init__.py              # Module exports
├── base_parser.py           # Abstract base class + RawFinding model
├── parser_registry.py       # Central registry (singleton)
├── who_parser.py            # WHO Disease Outbreak News parser
├── cdc_parser.py            # CDC Outbreaks parser
├── generic_parser.py        # CSS selector-based parser
└── ai_parser.py             # LLM-powered fallback parser
```

### 2. Key Components

#### BaseParser (base_parser.py)
- Abstract base class for all parsers
- `RawFinding` Pydantic model for extracted data
- Common utilities (`_clean_text`, `_extract_date`, `validate_finding`)

#### ParserRegistry (parser_registry.py)
- Singleton pattern for centralized parser management
- Auto-registration of built-in parsers
- `get_parser()` and `get_parser_safe()` methods
- Fallback to generic parser if parser not found

#### WHO Parser (who_parser.py)
- Specialized for WHO format: `Date | Title - Location`
- Date extraction using regex patterns
- Filters headers and navigation

#### CDC Parser (cdc_parser.py)
- Handles CDC's less structured format
- Extracts dates in multiple formats
- Location extraction with pattern matching
- Filters UI elements

#### Generic Parser (generic_parser.py)
- **CSS Selector Mode**: Uses BeautifulSoup with configurable selectors
- **Text Mode**: Fallback line-by-line parsing
- Configuration via `parser_config` in sources.json

#### AI Parser (ai_parser.py)
- Uses OpenAI GPT-4o-mini for content extraction
- Fallback when CSS selectors fail
- Structured JSON output
- Configurable model, temperature, max_tokens

### 3. Integration with Unified Workflow

Updated `workflows/unified_scan_workflow.py`:
- Removed hardcoded `_parse_content()` methods
- Uses `parser_registry.get_parser_safe()` for dynamic parser selection
- Parsers selected based on `source.parser` from sources.json
- Full backward compatibility with existing workflow

### 4. Dependencies

Added to `pyproject.toml`:
- `beautifulsoup4` — HTML parsing for GenericParser
- `lxml` — Fast HTML parser backend

---

## Configuration

### Sources.json Parser Configuration

```json
{
  "id": "WHO",
  "parser": "who_outbreak",
  "parser_config": null
}
```

For CSS selector-based parsing:

```json
{
  "id": "ECDC",
  "parser": "generic",
  "parser_config": {
    "item_selector": "article.threat-item",
    "title_selector": "h2.threat-title",
    "date_selector": "span.date",
    "date_format": "%d %B %Y",
    "content_selector": "div.threat-content",
    "link_selector": "a.read-more",
    "location_selector": "span.location"
  }
}
```

---

## Testing

### Run Phase 2 Tests

```bash
cd /srv/docker/SehaRadar
source .venv/bin/activate

# Run parser tests
python test_phase2.py
```

### Test Individual Parsers

```python
from parsers import parser_registry

# Get a parser
parser = parser_registry.get_parser("who_outbreak")

# Parse content
findings = await parser.parse(content, "WHO", "https://www.who.int")

# Findings are RawFinding objects
for finding in findings:
    print(finding.title, finding.location, finding.date)
```

### Test with Real System

```bash
# Sync dependencies
uv sync

# Restart container
cd /srv/docker/SehaRadar
docker compose down && docker compose up -d --build

# Trigger scan
curl -X POST https://phn-agents.fayaa92.sa/api/scan-unified

# Check logs
docker logs seha-radar -f
```

---

## Benefits Achieved

### Before Phase 2
- ❌ Hardcoded parsers in unified_scan_workflow.py
- ❌ Adding new source = modify code + restart
- ❌ No CSS selector support
- ❌ No AI fallback for unknown formats

### After Phase 2
- ✅ Plugin-based architecture
- ✅ Parsers selected dynamically from config
- ✅ CSS selector support for any HTML source
- ✅ AI fallback for complex/unknown structures
- ✅ Add new source with just config change (no code)

---

## Next Steps (Phase 3)

Phase 3 will add:
1. **NocoDB sources table** — Database-backed source registry
2. **Admin API** — CRUD endpoints for source management
3. **Hot-reload** — Reload sources without restart
4. **Test endpoint** — Test parser before enabling
5. **Admin UI** — Web interface for source management

---

## API Changes

### New Exports

```python
# From parsers module
from parsers import (
    parser_registry,
    BaseParser,
    RawFinding,
    WHOParser,
    CDCParser,
    GenericParser,
    AIParser,
)

# From source_registry
from health_agents.shared.source_registry import source_registry

# Get parser for a source
source = source_registry.get("WHO")
parser = parser_registry.get_parser(source.parser)
```

### Workflow Changes

The unified workflow now:
1. Fetches source from `source_registry.get_by_uuid(watch_uuid)`
2. Gets parser ID from `source.parser`
3. Retrieves parser from `parser_registry.get_parser_safe(parser_id)`
4. Parses content: `await parser.parse(content, source_name, source_url)`
5. Returns `List[RawFinding]` objects

---

## Migration Notes

### For Existing Sources
No changes needed! The parser registry auto-registers:
- `who_outbreak` → WHOParser
- `cdc_outbreak` → CDCParser  
- `generic` → GenericParser
- `ai` → AIParser

### For New Sources

**Option 1**: Use existing parser
```json
{
  "id": "NEW_SOURCE",
  "parser": "generic"
}
```

**Option 2**: Use CSS selectors
```json
{
  "id": "NEW_SOURCE",
  "parser": "generic",
  "parser_config": {
    "item_selector": ".news-item",
    "title_selector": "h2"
  }
}
```

**Option 3**: Use AI fallback
```json
{
  "id": "NEW_SOURCE",
  "parser": "ai"
}
```

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `parsers/__init__.py` | NEW | Module exports |
| `parsers/base_parser.py` | NEW | Abstract base class |
| `parsers/parser_registry.py` | NEW | Parser registry |
| `parsers/who_parser.py` | NEW | WHO parser |
| `parsers/cdc_parser.py` | NEW | CDC parser |
| `parsers/generic_parser.py` | NEW | Generic parser |
| `parsers/ai_parser.py` | NEW | AI parser |
| `workflows/unified_scan_workflow.py` | MODIFIED | Integrated parser system |
| `pyproject.toml` | MODIFIED | Added beautifulsoup4, lxml |
| `test_phase2.py` | NEW | Test suite |
| `PHASE2_COMPLETE.md` | NEW | This document |

---

## Commands Reference

```bash
# Install dependencies
uv sync

# Run tests
python test_phase2.py

# Rebuild and restart
docker compose down && docker compose up -d --build

# View logs
docker logs seha-radar -f --tail 100

# Trigger scan
curl -X POST https://phn-agents.fayaa92.sa/api/scan-unified

# Check findings
curl https://phn-agents.fayaa92.sa/api/findings?limit=5
```

---

## Success Criteria

- ✅ Parser registry loads all parsers
- ✅ WHO parser extracts findings correctly
- ✅ CDC parser filters navigation
- ✅ Generic parser has CSS + text modes
- ✅ AI parser integrates with OpenAI
- ✅ Workflow uses dynamic parser selection
- ✅ No breaking changes to existing functionality
- ✅ Test suite passes all checks

---

**Implementation Status**: ✅ Complete  
**Ready for Production**: ✅ Yes (after testing)  
**Next Phase**: Phase 3 (NocoDB + Admin API)
