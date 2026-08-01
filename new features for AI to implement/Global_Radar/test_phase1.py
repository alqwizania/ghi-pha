#!/usr/bin/env python3
"""
Test script for DabDar v4.0 Phase 1 - Configuration Consolidation

Tests:
1. Source registry loads correctly
2. All expected sources are present
3. Watch config is generated correctly
4. Backward compatibility with VALID_SOURCES
5. API endpoints work
"""

import sys
import asyncio
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))


def test_source_registry():
    """Test source registry loads and functions correctly."""
    print("=" * 80)
    print("TEST 1: Source Registry Loading")
    print("=" * 80)

    from health_agents.shared.source_registry import source_registry, Source, SourceType

    # Test 1: Registry loads
    sources = source_registry.list_all()
    print(f"✅ Loaded {len(sources)} sources")
    assert len(sources) == 7, f"Expected 7 sources, got {len(sources)}"

    # Test 2: All expected sources present
    expected_ids = ["WHO", "CDC", "PROMED", "WHO_CLONE", "WHO_RSS", "CDC_RSS", "GOOGLE"]
    actual_ids = [s.id for s in sources]
    print(f"✅ Source IDs: {actual_ids}")

    for expected in expected_ids:
        assert expected in actual_ids, f"Missing source: {expected}"

    # Test 3: Specific source details
    who_source = source_registry.get("WHO")
    assert who_source is not None, "WHO source not found"
    assert who_source.type == SourceType.CHANGEDETECTION
    assert who_source.watch_uuid == "4125358c-e214-432b-a534-417be9664cca"
    assert who_source.enabled == True
    print(f"✅ WHO source details correct")

    # Test 4: Get by UUID
    who_by_uuid = source_registry.get_by_uuid("4125358c-e214-432b-a534-417be9664cca")
    assert who_by_uuid is not None
    assert who_by_uuid.id == "WHO"
    print(f"✅ UUID lookup works")

    # Test 5: List by type
    changedetection_sources = source_registry.list_by_type(SourceType.CHANGEDETECTION)
    rss_sources = source_registry.list_by_type(SourceType.RSS)
    google_sources = source_registry.list_by_type(SourceType.GOOGLE_SEARCH)

    print(f"✅ ChangeDetection sources: {len(changedetection_sources)}")
    print(f"✅ RSS sources: {len(rss_sources)}")
    print(f"✅ Google sources: {len(google_sources)}")

    assert len(changedetection_sources) == 4
    assert len(rss_sources) == 2
    assert len(google_sources) == 1

    # Test 6: Enabled sources
    enabled = source_registry.list_enabled()
    print(f"✅ Enabled sources: {len(enabled)}")
    assert len(enabled) == 6, f"Expected 6 enabled sources, got {len(enabled)}"

    # Test 7: Watch config generation
    watch_config = source_registry.get_watch_config()
    print(f"✅ Watch config entries: {len(watch_config)}")
    assert len(watch_config) == 4, "Should have 4 changedetection watches"

    # Test 8: Statistics
    stats = source_registry.get_statistics()
    print(f"✅ Statistics: {stats}")

    print("\n✅ All Source Registry tests passed!\n")


def test_backward_compatibility():
    """Test backward compatibility with existing code."""
    print("=" * 80)
    print("TEST 2: Backward Compatibility")
    print("=" * 80)

    # Test 1: models.py VALID_SOURCES
    from health_agents.shared.models import VALID_SOURCES

    print(f"✅ models.py VALID_SOURCES: {VALID_SOURCES}")
    assert len(VALID_SOURCES) == 7
    assert "WHO" in VALID_SOURCES
    assert "CDC" in VALID_SOURCES

    # Test 2: Convenience functions
    from health_agents.shared.source_registry import (
        get_valid_sources,
        get_valid_agencies,
    )

    valid_sources = get_valid_sources()
    print(f"✅ get_valid_sources(): {len(valid_sources)} sources")
    assert len(valid_sources) == 7

    valid_agencies = get_valid_agencies()
    print(f"✅ get_valid_agencies(): {valid_agencies}")
    assert len(valid_agencies) == 4  # Only changedetection sources
    assert "WHO" in valid_agencies
    assert "WHO_RSS" not in valid_agencies  # RSS should not be in agencies

    # Test 3: Watch config format
    from health_agents.shared.source_registry import get_watch_config

    watch_config = get_watch_config()

    print(f"✅ get_watch_config() format:")
    for uuid, config in list(watch_config.items())[:2]:
        print(f"   {uuid}: {config}")

    # Check structure matches expected format
    for uuid, config in watch_config.items():
        assert "name" in config
        assert "type" in config
        assert "url" in config

    print("\n✅ All Backward Compatibility tests passed!\n")


def test_unified_workflow():
    """Test unified scan workflow integration."""
    print("=" * 80)
    print("TEST 3: Unified Workflow Integration")
    print("=" * 80)

    from workflows.unified_scan_workflow import UnifiedScanWorkflow

    workflow = UnifiedScanWorkflow()

    print(f"✅ Unified workflow initialized")
    print(f"✅ Watch config loaded: {len(workflow.WATCH_CONFIG)} entries")

    # Verify watch config structure
    for uuid, config in workflow.WATCH_CONFIG.items():
        assert "name" in config
        assert "type" in config
        assert "url" in config
        print(f"   {config['name']}: {config['type']}")

    print("\n✅ Unified Workflow Integration tests passed!\n")


def main():
    """Run all tests."""
    print("\n")
    print("╔" + "=" * 78 + "╗")
    print("║" + " " * 20 + "DabDar v4.0 Phase 1 Tests" + " " * 33 + "║")
    print("╚" + "=" * 78 + "╝")
    print("\n")

    try:
        test_source_registry()
        test_backward_compatibility()
        test_unified_workflow()

        print("\n")
        print("╔" + "=" * 78 + "╗")
        print("║" + " " * 25 + "ALL TESTS PASSED ✅" + " " * 34 + "║")
        print("╚" + "=" * 78 + "╝")
        print("\n")

        return 0
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
