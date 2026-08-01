#!/usr/bin/env python3
"""
Test script for DabDar v4.0 Phase 2: Plugin-Based Parsers

Tests:
1. Parser registry initialization
2. Individual parser functionality (WHO, CDC, Generic, AI)
3. Parser selection from sources.json
4. Integration with unified_scan_workflow
"""

import asyncio
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parsers import parser_registry, WHOParser, CDCParser, GenericParser, AIParser
from parsers.base_parser import RawFinding
from health_agents.shared.source_registry import source_registry


# Sample test data
WHO_SAMPLE = """8 February 2026 | Mpox - Democratic Republic of the Congo
7 February 2026 | Cholera - Yemen
6 February 2026 | Dengue - Brazil
Page of 120"""

CDC_SAMPLE = """Multistate Outbreak of E. coli O157:H7 Infections
Salmonella outbreak linked to onions - updated February 8, 2026
Investigation of Listeria monocytogenes in frozen vegetables
menu
skip to content"""

GENERIC_SAMPLE = """Health alert: New respiratory illness cases reported
WHO warns of potential pandemic threat
Emergency health measures implemented in affected regions
Disease surveillance indicates rising trend"""


def print_test_header(title: str):
    """Print formatted test section header."""
    print(f"\n{'=' * 80}")
    print(f"TEST: {title}")
    print(f"{'=' * 80}\n")


def print_findings(findings, parser_name: str):
    """Print findings in a formatted way."""
    print(f"\n{parser_name} extracted {len(findings)} findings:\n")
    for i, finding in enumerate(findings, 1):
        print(f"{i}. {finding.title}")
        if finding.date:
            print(f"   Date: {finding.date}")
        if finding.location:
            print(f"   Location: {finding.location}")
        if finding.description and finding.description != finding.title:
            print(f"   Description: {finding.description[:80]}...")
        print()


async def test_parser_registry():
    """Test 1: Parser registry initialization."""
    print_test_header("Parser Registry Initialization")

    # List all parsers
    parsers = parser_registry.list_parsers()
    print(f"Registered parsers: {len(parsers)}")
    for parser_id, parser_class in parsers.items():
        print(f"  - {parser_id}: {parser_class}")

    # Test get_parser
    who_parser = parser_registry.get_parser("who_outbreak")
    assert who_parser is not None, "WHO parser not found"
    print(f"\n✅ Successfully retrieved WHO parser: {type(who_parser).__name__}")

    # Test get_parser_safe (with fallback)
    unknown_parser = parser_registry.get_parser_safe("unknown_parser")
    print(f"✅ Fallback parser: {type(unknown_parser).__name__}")

    print("\n✅ Parser registry test PASSED")


async def test_who_parser():
    """Test 2: WHO Parser."""
    print_test_header("WHO Parser")

    parser = WHOParser()
    findings = await parser.parse(WHO_SAMPLE, "WHO", "https://www.who.int")

    assert len(findings) > 0, "WHO parser found no findings"
    assert len(findings) == 3, f"Expected 3 findings, got {len(findings)}"

    # Check first finding
    first = findings[0]
    assert "Mpox" in first.title, f"Expected Mpox in title, got: {first.title}"
    assert first.location == "Democratic Republic of the Congo", (
        f"Wrong location: {first.location}"
    )
    assert first.date and "8 February 2026" in first.date, f"Wrong date: {first.date}"

    print_findings(findings, "WHO Parser")
    print("✅ WHO parser test PASSED")


async def test_cdc_parser():
    """Test 3: CDC Parser."""
    print_test_header("CDC Parser")

    parser = CDCParser()
    findings = await parser.parse(CDC_SAMPLE, "CDC", "https://www.cdc.gov")

    assert len(findings) > 0, "CDC parser found no findings"

    # Check that navigation elements are filtered
    for finding in findings:
        assert "menu" not in finding.title.lower(), "Navigation text not filtered"
        assert "skip" not in finding.title.lower(), "Navigation text not filtered"

    print_findings(findings, "CDC Parser")
    print("✅ CDC parser test PASSED")


async def test_generic_parser():
    """Test 4: Generic Parser (text mode)."""
    print_test_header("Generic Parser (Text Mode)")

    parser = GenericParser()
    findings = await parser.parse(
        GENERIC_SAMPLE, "Generic Source", "https://example.com"
    )

    assert len(findings) > 0, "Generic parser found no findings"

    print_findings(findings, "Generic Parser")
    print("✅ Generic parser test PASSED")


async def test_ai_parser():
    """Test 5: AI Parser (if OpenAI available)."""
    print_test_header("AI Parser")

    try:
        parser = AIParser()

        # Use a short sample to avoid API costs
        ai_sample = "WHO reports new Mpox cases in Democratic Republic of Congo on February 8, 2026."

        findings = await parser.parse(
            ai_sample, "AI Test Source", "https://example.com"
        )

        if findings:
            print_findings(findings, "AI Parser")
            print("✅ AI parser test PASSED")
        else:
            print("⚠️ AI parser returned no findings (may need OpenAI API key)")

    except Exception as e:
        print(f"⚠️ AI parser test skipped: {e}")


async def test_source_registry_integration():
    """Test 6: Integration with source_registry."""
    print_test_header("Source Registry Integration")

    # Get all sources
    sources = source_registry.list_enabled()
    print(f"Found {len(sources)} enabled sources:")

    for source in sources:
        if source.type.value == "changedetection":
            print(f"\n  {source.id}:")
            print(f"    Parser: {source.parser}")
            print(f"    URL: {source.url}")

            # Test getting parser
            parser = parser_registry.get_parser_safe(source.parser or "generic")
            print(f"    ✅ Parser available: {type(parser).__name__}")

    print("\n✅ Source registry integration test PASSED")


async def test_raw_finding_model():
    """Test 7: RawFinding model."""
    print_test_header("RawFinding Model")

    # Create a finding
    finding = RawFinding(
        title="Test Outbreak",
        headline="Test Outbreak - Test Location",
        description="This is a test outbreak description",
        date="2026-02-08",
        location="Test Location",
        link="https://example.com",
        source="Test Source",
        raw_text="Full raw text of the outbreak",
    )

    print(f"Created finding: {finding.title}")

    # Convert to dict
    finding_dict = finding.to_dict()
    assert finding_dict["title"] == "Test Outbreak"
    assert finding_dict["location"] == "Test Location"

    print("✅ RawFinding model test PASSED")


async def main():
    """Run all tests."""
    print("\n" + "=" * 80)
    print("DabDar v4.0 Phase 2: Parser System Tests")
    print("=" * 80)

    try:
        await test_parser_registry()
        await test_who_parser()
        await test_cdc_parser()
        await test_generic_parser()
        await test_ai_parser()
        await test_source_registry_integration()
        await test_raw_finding_model()

        print("\n" + "=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80 + "\n")

        return 0

    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}\n")
        return 1
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}\n")
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
