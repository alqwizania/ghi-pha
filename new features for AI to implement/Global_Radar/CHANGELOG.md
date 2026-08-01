# DabDar Changelog

## [4.0.0-phase1] - 2026-02-08

### Added - Configuration Consolidation (Phase 1)

#### New Files
- `config/sources.json` - Unified source configuration (single source of truth)
- `health_agents/shared/source_registry.py` - Centralized source registry with singleton pattern
- `tools/openai_client.py` - Shared OpenAI client with lazy initialization
- `test_phase1.py` - Comprehensive test suite for Phase 1
- `test_api_phase1.py` - API endpoint tests
- `PHASE1_COMPLETE.md` - Detailed implementation guide
- `PHASE1_SUMMARY.md` - Implementation summary and results

#### New API Endpoints
- `GET /api/sources` - List all configured sources (with optional filtering)
- `GET /api/sources/{id}` - Get specific source details
- `POST /api/sources/reload` - Hot-reload source configuration without restart

#### Features
- **Single Source of Truth**: All source configuration now in `config/sources.json`
- **Hot-Reload**: Update sources without container restart
- **Dynamic Loading**: VALID_SOURCES and VALID_AGENCIES loaded from registry
- **Lazy OpenAI Init**: Prevents import-time crashes when API key not set
- **Reduced Complexity**: Adding new source reduced from 7-8 steps to 2-3 steps

### Changed
- `health_agents/shared/models.py` - `VALID_SOURCES` now dynamically loaded from registry
- `server.py` - `VALID_AGENCIES` now dynamically loaded, added new source management endpoints
- `workflows/unified_scan_workflow.py` - `WATCH_CONFIG` dynamically loaded from registry
- `tools/html_extraction.py` - Uses shared OpenAI client with lazy initialization
- `tools/llm_comparison.py` - Uses shared OpenAI client with lazy initialization
- `tools/report_generator.py` - Uses shared OpenAI client with lazy initialization
- `tools/epi_triad_analyzer.py` - Uses shared OpenAI client with lazy initialization
- `tools/arabic_translator.py` - Uses shared OpenAI client with lazy initialization

### Fixed
- OpenAI client import-time initialization errors (no longer crashes when API key not set)
- Configuration fragmentation across 5+ files

### Deprecated
- `config/agency_configs.json` - Kept for backward compatibility, but use `sources.json` instead

---

## [3.0.0] - Previous Release

### Features
- Multi-source scanning (ChangeDetection.io, RSS, Google)
- Epidemiological triad analysis (WHO/WHERE/WHEN)
- Bilingual support (English/Arabic)
- Email digest generation
- NocoDB integration for findings storage
- Deduplication system

---

**Documentation**: See `PHASE1_COMPLETE.md` and `PHASE1_SUMMARY.md` for detailed Phase 1 information.
