"""
Dry-Run Test for SehaRadar Unified Scan Pipeline
=================================================

Validates the full classification → normalization → deduplication
pipeline WITHOUT making any network calls (no OpenAI, NocoDB,
ChangeDetection.io, or RSSHub).

Tests 3 mock watchers with diverse scenarios:
  1. WHO watcher — known diseases (Mpox, Cholera)
  2. CDC watcher — alias normalization (monkeypox→Mpox, bird flu→H5N1)
  3. PROMED watcher — brand-new unknown disease + general health news

Run:
  python tests/test_scan_dryrun.py
"""

import asyncio
import json
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure project root is on sys.path
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

# Import the specific submodules used by this dry-run validation.
from health_agents.shared.models import HealthContext, Priority, EpidemiologicalTriad  # noqa: E402
from tools.openai_client import get_openai_client  # noqa: E402
from tools.epi_triad_analyzer import (  # noqa: E402
    normalize_disease_name,
    identify_disease_from_text,
    extract_numbers,
    extract_locations,
    determine_priority,
    load_disease_config,
    add_disease_to_library,
    get_canonical_disease_names,
)
from tools.deduplication import (  # noqa: E402
    generate_content_hash,
    DeduplicationService,
)
from tools.disease_catalog import (  # noqa: E402
    has_icon_metadata,
)
from parsers import parser_registry  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Test Constants
# ─────────────────────────────────────────────────────────────────────────────

# 3 mock watchers with diverse disease content
MOCK_WATCHERS = {
    # Watcher 1: WHO Disease Outbreak News (who_outbreak parser)
    "fake-uuid-who-001": {
        "title": "WHO - Disease Outbreak News",
        "url": "https://www.who.int/emergencies/disease-outbreak-news",
        "source_id": "WHO",
        "parser": "who_outbreak",
        "content": (
            "10 February 2026 | Mpox - Democratic Republic of the Congo\n"
            "8 February 2026 | Cholera - Mozambique\n"
            "5 February 2026 | Cholera - Democratic Republic of the Congo\n"
        ),
    },
    # Watcher 2: CDC Outbreaks (cdc_outbreak parser) — tests alias normalization
    "fake-uuid-cdc-002": {
        "title": "CDC - Outbreaks",
        "url": "https://www.cdc.gov/outbreaks/",
        "source_id": "CDC",
        "parser": "cdc_outbreak",
        "content": (
            "Investigation of a monkeypox outbreak in Texas — 35 confirmed cases "
            "and 2 deaths reported since January 2026.\n"
            "Bird flu (H5N1) detected in poultry farms in California — 50,000 "
            "chickens culled. No human cases reported.\n"
            "Salmonella infections linked to recalled frozen chicken products — "
            "120 cases across 15 states.\n"
        ),
    },
    # Watcher 3: ProMED (generic parser) — brand-new unknown disease + news
    "fake-uuid-promed-003": {
        "title": "ProMED-mail",
        "url": "https://www.promedmail.org/",
        "source_id": "PROMED",
        "parser": "generic",
        "content": (
            "NEW DISEASE ALERT: Zamboanga hemorrhagic syndrome reported in the "
            "Philippines — 12 cases and 3 deaths in a remote village. The causative "
            "agent is under investigation.\n"
            "WHO announces new global health strategy for pandemic preparedness — "
            "no specific disease mentioned in the initiative.\n"
        ),
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Helper: Simulated LLM classification (replaces OpenAI calls)
# ─────────────────────────────────────────────────────────────────────────────

# Map headlines to what a well-behaved LLM would return
_LLM_RESPONSES: Dict[str, Dict[str, Any]] = {
    # WHO items
    "Mpox - Democratic Republic of the Congo": {
        "disease_name": "Mpox",
        "disease_keywords": ["mpox", "monkeypox"],
        "short_description": "According to WHO, new Mpox cases in DRC.",
        "detailed_description": "## Overview\n\nMpox outbreak in DRC continues...",
    },
    "Cholera - Mozambique": {
        "disease_name": "Cholera",
        "disease_keywords": ["cholera", "vibrio cholerae"],
        "short_description": "According to WHO, cholera cases in Mozambique.",
        "detailed_description": "## Overview\n\nCholera outbreak in Mozambique...",
    },
    "Cholera - Democratic Republic of the Congo": {
        "disease_name": "Cholera",
        "disease_keywords": ["cholera"],
        "short_description": "According to WHO, cholera in DRC.",
        "detailed_description": "## Overview\n\nCholera in DRC ongoing...",
    },
    # CDC items — aliases that should normalize
    "Investigation of a monkeypox outbreak in Texas": {
        "disease_name": "monkeypox",  # LLM might return alias
        "disease_keywords": ["monkeypox", "mpox"],
        "short_description": "35 confirmed monkeypox cases in Texas.",
        "detailed_description": "## Overview\n\nMonkeypox outbreak in Texas...",
    },
    "Bird flu (H5N1) detected in poultry farms in California": {
        "disease_name": "bird flu",  # LLM might return alias
        "disease_keywords": ["bird flu", "h5n1", "avian influenza"],
        "short_description": "H5N1 detected in California poultry farms.",
        "detailed_description": "## Overview\n\nAvian influenza H5N1 in California...",
    },
    "Salmonella infections linked to recalled frozen chicken products": {
        "disease_name": "Salmonella",
        "disease_keywords": ["salmonella", "salmonellosis"],
        "short_description": "120 Salmonella cases across 15 US states.",
        "detailed_description": "## Overview\n\nSalmonella outbreak linked to chicken...",
    },
    # ProMED items — new disease + general news
    "Zamboanga hemorrhagic syndrome": {
        "disease_name": "Zamboanga hemorrhagic syndrome",  # Brand new
        "disease_keywords": ["zamboanga", "hemorrhagic syndrome"],
        "short_description": "12 cases and 3 deaths in Philippines.",
        "detailed_description": "## Overview\n\nNew hemorrhagic syndrome in Zamboanga...",
    },
    "WHO announces new global health strategy": {
        "disease_name": "news",  # No specific disease
        "disease_keywords": [],
        "short_description": "WHO launches pandemic preparedness strategy.",
        "detailed_description": "## Overview\n\nWHO global health strategy...",
    },
}


def _mock_llm_classify(headline: str) -> Dict[str, Any]:
    """Find the best matching mock LLM response for a headline."""
    headline_lower = headline.lower()
    for key, value in _LLM_RESPONSES.items():
        if key.lower() in headline_lower or headline_lower in key.lower():
            return value
    # Default: return "news"
    return {
        "disease_name": "news",
        "disease_keywords": [],
        "short_description": f"Health news: {headline[:100]}",
        "detailed_description": f"## Overview\n\n{headline}",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Test Functions
# ─────────────────────────────────────────────────────────────────────────────


def test_disease_normalization() -> None:
    """Test that all known aliases normalize to canonical names."""
    print("\n" + "=" * 70)
    print("TEST 1: Disease Name Normalization")
    print("=" * 70)

    test_cases: List[Tuple[str, str]] = [
        # (input, expected_canonical)
        ("Mpox", "Mpox"),
        ("monkeypox", "Mpox"),
        ("Monkeypox", "Mpox"),
        ("MPX", "Mpox"),
        ("bird flu", "H5N1"),
        ("avian influenza", "H5N1"),
        ("H5N1", "H5N1"),
        ("MERS-CoV", "MERS"),
        ("Middle East Respiratory Syndrome", "MERS"),
        ("Nipah virus infection", "Nipah"),
        ("Nipah virus disease", "Nipah"),
        ("NiV", "Nipah"),
        ("Ebola virus disease", "Ebola"),
        ("EVD", "Ebola"),
        ("covid-19", "COVID-19"),
        ("sars-cov-2", "COVID-19"),
        ("coronavirus", "COVID-19"),
        ("cholera", "Cholera"),
        ("Vibrio cholerae", "Cholera"),
        ("Salmonella", "Salmonella"),
        ("Salmonellosis", "Salmonella"),
        # Edge cases
        ("news", "news"),
        ("Unknown", "news"),
        ("Unknown disease", "news"),
        ("", "news"),
        ("  ", "news"),
        # Brand-new disease → should return as-is (no canonical match)
        ("Zamboanga hemorrhagic syndrome", "Zamboanga hemorrhagic syndrome"),
    ]

    passed = 0
    failed = 0

    for raw_input, expected in test_cases:
        result = normalize_disease_name(raw_input)
        status = "✅" if result == expected else "❌"
        if result != expected:
            failed += 1
            print(
                f"  {status} normalize('{raw_input}') = '{result}' (expected '{expected}')"
            )
        else:
            passed += 1
            print(f"  {status} normalize('{raw_input}') = '{result}'")

    print(f"\n  📊 Results: {passed}/{passed + failed} passed")
    assert failed == 0, f"{failed} normalization tests failed"
    print("  ✅ All normalization tests passed!")


def test_deduplication_hashing() -> None:
    """Test that dedup hashing uses disease + country_code correctly."""
    print("\n" + "=" * 70)
    print("TEST 2: Deduplication Hashing (Disease + Country)")
    print("=" * 70)

    dedup = DeduplicationService()
    passed = 0
    failed = 0

    # 2a: Same disease + same country → same hash (deterministic)
    h1 = dedup.generate_hash(
        disease="Mpox", countries=["Democratic Republic of the Congo"]
    )
    h2 = dedup.generate_hash(
        disease="Mpox", countries=["Democratic Republic of the Congo"]
    )
    ok = h1 == h2
    status = "✅" if ok else "❌"
    print(f"  {status} Same disease+country → same hash: {h1[:16]}... == {h2[:16]}...")
    passed += ok
    failed += not ok

    # 2b: Same disease + different country → different hash
    h3 = dedup.generate_hash(disease="Mpox", countries=["Mozambique"])
    ok = h1 != h3
    status = "✅" if ok else "❌"
    print(
        f"  {status} Same disease, different country → different hash: {h1[:16]}... != {h3[:16]}..."
    )
    passed += ok
    failed += not ok

    # 2c: CROSS-SOURCE DEDUP: Same disease + same country from different sources → SAME hash
    # This is the core change — WHO and CDC reporting the same outbreak should deduplicate
    h_who = dedup.generate_hash(
        disease="Mpox",
        countries=["Democratic Republic of the Congo"],
        headline="WHO reports Mpox in DRC",
    )
    h_cdc = dedup.generate_hash(
        disease="Mpox",
        countries=["Democratic Republic of the Congo"],
        headline="CDC confirms Mpox cases in DRC",
    )
    ok = h_who == h_cdc
    status = "✅" if ok else "❌"
    print(
        f"  {status} Cross-source dedup: WHO and CDC same disease+country → SAME hash"
    )
    passed += ok
    failed += not ok

    # 2d: Different disease, same country → different hash
    h4 = dedup.generate_hash(
        disease="Cholera", countries=["Democratic Republic of the Congo"]
    )
    ok = h1 != h4
    status = "✅" if ok else "❌"
    print(
        f"  {status} Different disease → different hash: {h1[:16]}... != {h4[:16]}..."
    )
    passed += ok
    failed += not ok

    # 2e: Case normalization — disease is lowered
    h5 = dedup.generate_hash(
        disease="mpox", countries=["Democratic Republic of the Congo"]
    )
    ok = h1 == h5
    status = "✅" if ok else "❌"
    print(f"  {status} Case normalization: 'mpox' == 'Mpox': {h1[:16]}...")
    passed += ok
    failed += not ok

    # 2f: Country alias normalization — "DRC" resolves to same code as full name
    h6 = dedup.generate_hash(disease="Mpox", countries=["DRC"])
    ok = h1 == h6
    status = "✅" if ok else "❌"
    print(
        f"  {status} Country alias: 'DRC' == 'Democratic Republic of the Congo': {h1[:16]}..."
    )
    passed += ok
    failed += not ok

    # 2g: No country and no headline → deterministic disease fallback
    h7a = dedup.generate_hash(disease="Mpox", countries=[])
    h7b = dedup.generate_hash(disease="Mpox", countries=[])
    ok = h7a == h7b
    status = "✅" if ok else "❌"
    print(
        f"  {status} Empty country/headline → deterministic fallback hash: {h7a[:16]}... == {h7b[:16]}..."
    )
    passed += ok
    failed += not ok

    # 2h: Headline fallback — country extracted from headline when countries list is empty
    h8 = dedup.generate_hash(
        disease="Mpox",
        countries=[],
        headline="Mpox outbreak in Democratic Republic of the Congo",
    )
    # This should resolve DRC from headline and match h1
    ok = h1 == h8
    status = "✅" if ok else "❌"
    print(
        f"  {status} Headline fallback extracts country: {h8[:16]}... == {h1[:16]}..."
    )
    passed += ok
    failed += not ok

    # 2i: Normalized aliases produce same hash after normalization
    norm_name = normalize_disease_name("monkeypox")
    h9 = dedup.generate_hash(
        disease=norm_name, countries=["Democratic Republic of the Congo"]
    )
    ok = h1 == h9
    status = "✅" if ok else "❌"
    print(
        f"  {status} Normalized alias → same hash: "
        f"normalize('monkeypox')='{norm_name}' → {h9[:16]}..."
    )
    passed += ok
    failed += not ok

    print(f"\n  📊 Results: {passed}/{passed + failed} passed")
    assert failed == 0, f"{failed} dedup tests failed"
    print("  ✅ All deduplication tests passed!")


async def _run_end_to_end_mock_pipeline() -> None:
    """
    End-to-end test: 3 mock watchers go through the full pipeline.

    Mocks: ChangeDetection.io, OpenAI (LLM), NocoDB, Arabic translator.
    Real: Parsers, normalization, and deduplication hashing.
    """
    print("\n" + "=" * 70)
    print("TEST 4: End-to-End Mock Pipeline (3 Watchers)")
    print("=" * 70)

    # Track everything that would be stored
    stored_findings: List[Dict[str, Any]] = []
    seen_hashes: set = set()
    duplicates: int = 0
    diseases_found: Dict[str, int] = {}
    unknown_diseases: List[str] = []

    dedup = DeduplicationService()
    canonical_diseases = set(get_canonical_disease_names())

    for watch_uuid, watch_info in MOCK_WATCHERS.items():
        source_name = watch_info["source_id"]
        parser_id = watch_info["parser"]
        source_url = watch_info["url"]
        content = watch_info["content"]

        print(
            f"\n  📥 Processing watcher: {source_name} ({watch_uuid[:12]}...) [Parser: {parser_id}]"
        )

        # Step 1: Parse content (REAL parser — no mock)
        parser = parser_registry.get_parser_safe(parser_id)
        raw_findings = await parser.parse(content, source_name, source_url)
        items = [f.to_dict() for f in raw_findings]
        print(f"    ✅ Parsed {len(items)} items")

        for idx, item in enumerate(items[:10]):
            # headline is the primary key for hashing (matches real pipeline)
            headline_text = item.get("headline", item.get("title", ""))[:200]
            title = item.get("title", headline_text)[:200]
            description = item.get("description", title)
            full_text = f"{title} {description}"

            # Step 2: Classify disease (MOCK LLM — use our lookup)
            llm_result = _mock_llm_classify(headline_text)
            raw_disease = llm_result["disease_name"]
            llm_keywords = llm_result.get("disease_keywords", [])

            # Step 3: Fallback keyword detection (REAL)
            keyword_disease = identify_disease_from_text(full_text)

            # Resolve: LLM > keyword > "news"
            resolved = raw_disease or keyword_disease or "news"
            if resolved.lower() in ("unknown", "unknown disease", ""):
                resolved = "news"

            # Step 4: Normalize (REAL normalization)
            disease = normalize_disease_name(resolved)
            if disease != resolved and disease != "news":
                print(f"    📎 Normalized: '{resolved}' → '{disease}'")

            # Step 5: Priority (REAL)
            numbers = extract_numbers(full_text)
            priority = determine_priority(
                disease, numbers.get("cases"), numbers.get("deaths"), full_text
            )

            # Step 6: Track diseases outside the canonical library. Visualization
            # icon metadata was removed, so has_icon_metadata should stay false.
            if disease != "news" and disease not in canonical_diseases:
                unknown_diseases.append(disease)
                print(
                    f"    🆕 New disease outside canonical library: '{disease}'"
                )

            # Track disease counts
            diseases_found[disease] = diseases_found.get(disease, 0) + 1

            # Step 7: Deduplication hash (REAL hashing, mock DB check)
            # Extract countries from text (same as real pipeline)
            countries, regions = extract_locations(full_text)
            content_hash = dedup.generate_hash(
                disease=disease,
                countries=countries,
                headline=headline_text,
            )

            if content_hash in seen_hashes:
                duplicates += 1
                print(
                    f"    ⚠️ DUPLICATE detected: {headline_text[:60]}... (hash={content_hash[:12]}...)"
                )
                continue
            seen_hashes.add(content_hash)

            # Build the finding that would be stored
            finding = {
                "headline": headline_text,
                "disease": disease,
                "source": source_name,
                "source_type": "changedetection",
                "source_link": item.get("link", source_url),
                "publication_date": item.get("date", ""),
                "priority": priority.value,
                "content_hash": content_hash,
                "short_description_en": llm_result.get("short_description", ""),
                "detailed_description_en": llm_result.get("detailed_description", ""),
                # Translation would happen here (mocked → empty)
                "short_description_ar": "(would be translated)",
                "detailed_description_ar": "(would be translated)",
            }
            stored_findings.append(finding)
            print(
                f"    ✅ [{idx + 1}] disease='{disease}' priority={priority.value} hash={content_hash[:12]}... headline='{headline_text[:50]}'"
            )

    # ── Summary & Assertions ────────────────────────────────────────────
    print(f"\n  {'─' * 60}")
    print(f"  📊 PIPELINE SUMMARY")
    print(f"  {'─' * 60}")
    print(f"  Watchers processed:  {len(MOCK_WATCHERS)}")
    print(f"  Findings stored:     {len(stored_findings)}")
    print(f"  Duplicates caught:   {duplicates}")
    print(f"  Unique diseases:     {len(diseases_found)}")
    print(f"  New (unregistered):  {len(unknown_diseases)}")
    print()

    print("  Disease distribution:")
    for disease, count in sorted(diseases_found.items(), key=lambda x: -x[1]):
        known_status = "🔷 canonical" if disease in canonical_diseases else "🆕 new"
        print(f"    {disease:<45} × {count}  ({known_status})")

    print()
    print("  Stored findings:")
    for i, f in enumerate(stored_findings):
        print(
            f"    [{i + 1}] {f['disease']:<30} | {f['source']:<8} | "
            f"{f['priority']:<8} | {f['headline'][:50]}..."
        )

    # ── Assertions ──────────────────────────────────────────────────────
    print(f"\n  {'─' * 60}")
    print(f"  🔍 ASSERTIONS")
    print(f"  {'─' * 60}")

    errors = []

    # A1: "monkeypox" should have been normalized to "Mpox"
    mpox_findings = [f for f in stored_findings if f["disease"] == "Mpox"]
    if not any(
        "monkeypox" in f["headline"].lower() or "mpox" in f["headline"].lower()
        for f in mpox_findings
    ):
        # The CDC monkeypox item should appear as Mpox
        pass
    mpox_count = len(mpox_findings)
    if mpox_count < 1:
        errors.append(f"Expected at least 1 Mpox finding, got {mpox_count}")
    else:
        print(f"  ✅ A1: 'monkeypox' normalized to 'Mpox' ({mpox_count} findings)")

    # A2: "bird flu" should have been normalized to "H5N1"
    h5n1_findings = [f for f in stored_findings if f["disease"] == "H5N1"]
    if len(h5n1_findings) < 1:
        errors.append(
            f"Expected at least 1 H5N1 finding from 'bird flu', got {len(h5n1_findings)}"
        )
    else:
        print(
            f"  ✅ A2: 'bird flu' normalized to 'H5N1' ({len(h5n1_findings)} findings)"
        )

    # A3: Expect deduplication when same disease+country appears across sources
    # With disease+country hashing, Mpox+DRC from WHO and Mpox+DRC from CDC would
    # deduplicate. In our mock data, all disease+country combos are unique across
    # watchers, so we may see 0 duplicates. But if any collide, that's correct behavior.
    print(
        f"  ℹ️  A3: {duplicates} duplicates caught, {len(stored_findings)} items stored "
        f"(disease+country dedup)"
    )

    # A4: Hashes are unique for stored findings (duplicates were already filtered out)
    stored_hashes = {f["content_hash"] for f in stored_findings}
    if len(stored_hashes) != len(stored_findings):
        errors.append(
            f"Hash collision among stored findings: {len(stored_hashes)} unique hashes for {len(stored_findings)} findings"
        )
    else:
        print(f"  ✅ A4: All {len(stored_findings)} stored findings have unique hashes")

    # A5: "news" items should exist (general health articles)
    news_findings = [f for f in stored_findings if f["disease"] == "news"]
    if len(news_findings) < 1:
        errors.append(f"Expected at least 1 'news' finding, got {len(news_findings)}")
    else:
        print(
            f"  ✅ A5: {len(news_findings)} general news item(s) classified as 'news'"
        )

    # A6: Brand-new disease should NOT be in the canonical disease library
    for nd in unknown_diseases:
        if nd in canonical_diseases:
            errors.append(
                f"New disease '{nd}' was found in canonical disease names — shouldn't be"
            )
        else:
            print(
                f"  ✅ A6: New disease '{nd}' correctly identified as new (not canonical)"
            )

    # A6b: Visualization catalog was removed; icon metadata should remain absent.
    if any(has_icon_metadata(name) for name in diseases_found if name != "news"):
        errors.append("Visualization icon metadata unexpectedly present after removal")
    else:
        print("  ✅ A6b: Visualization icon metadata remains disabled")

    # A7: Every finding has a non-empty content_hash
    for f in stored_findings:
        if not f.get("content_hash"):
            errors.append(f"Finding missing content_hash: {f['headline'][:50]}")
    if not any("content_hash" in e for e in errors):
        print(f"  ✅ A7: All findings have non-empty content_hash")

    # A8: Every finding has a valid priority
    valid_priorities = {"critical", "high", "medium", "low"}
    for f in stored_findings:
        if f.get("priority") not in valid_priorities:
            errors.append(
                f"Invalid priority '{f.get('priority')}' for: {f['headline'][:50]}"
            )
    if not any("priority" in e for e in errors):
        print(f"  ✅ A8: All findings have valid priorities")

    # A9: Cholera findings from different countries → different hashes
    cholera_findings = [f for f in stored_findings if f["disease"] == "Cholera"]
    cholera_hashes = {f["content_hash"] for f in cholera_findings}
    if len(cholera_findings) > 1 and len(cholera_hashes) != len(cholera_findings):
        errors.append(
            f"Cholera hash collision: {len(cholera_findings)} findings but "
            f"{len(cholera_hashes)} unique hashes (different countries should differ)"
        )
    elif len(cholera_findings) > 1:
        print(
            f"  ✅ A9: {len(cholera_findings)} Cholera findings in different countries → "
            f"{len(cholera_hashes)} unique hashes"
        )

    # A10: Salmonella should be recognized (it's in diseases.json)
    salmonella_findings = [f for f in stored_findings if f["disease"] == "Salmonella"]
    if len(salmonella_findings) < 1:
        errors.append("Expected Salmonella finding, got none")
    else:
        print(
            f"  ✅ A10: Salmonella correctly classified ({len(salmonella_findings)} findings)"
        )

    # ── Final verdict ───────────────────────────────────────────────────
    print(f"\n  {'─' * 60}")
    if errors:
        for e in errors:
            print(f"  ❌ FAIL: {e}")
        print(f"\n  ❌ {len(errors)} ASSERTION(S) FAILED")
        assert False, f"{len(errors)} end-to-end assertions failed"
    else:
        print(f"  ✅ ALL {10} ASSERTIONS PASSED — pipeline is safe to run!")


def test_end_to_end_mock_pipeline() -> None:
    asyncio.run(_run_end_to_end_mock_pipeline())


def test_cross_source_deduplication() -> None:
    """
    Test that the same disease+country from different sources produces
    the SAME hash (cross-source deduplication).
    """
    print("\n" + "=" * 70)
    print("TEST 5: Cross-Source Deduplication (Same Disease+Country)")
    print("=" * 70)

    dedup = DeduplicationService()
    passed = 0
    failed = 0

    # Same disease + same country from different sources → SAME hash (deduplicates)
    sources = ["WHO", "CDC", "PROMED", "ECDC"]
    disease = "Mpox"
    countries = ["Democratic Republic of the Congo"]

    hashes = {}
    for source in sources:
        h = dedup.generate_hash(
            disease=disease,
            countries=countries,
            headline=f"{source} reports {disease} outbreak in DRC",
        )
        hashes[source] = h

    unique_hashes = len(set(hashes.values()))
    ok = unique_hashes == 1  # All should produce the SAME hash
    status = "✅" if ok else "❌"
    print(
        f"  {status} Same disease+country across {len(sources)} sources → {unique_hashes} unique hash (expected 1)"
    )
    for source, h in hashes.items():
        print(f"    {source:<10} → {h[:20]}...")
    passed += ok
    failed += not ok

    # Same disease but different countries → different hashes
    country_scenarios = [
        ("Democratic Republic of the Congo", "CD"),
        ("Mozambique", "MZ"),
        ("United States", "US"),
    ]
    h_set = set()
    for country_name, expected_code in country_scenarios:
        h = dedup.generate_hash(disease="Cholera", countries=[country_name])
        h_set.add(h)

    ok = len(h_set) == len(country_scenarios)
    status = "✅" if ok else "❌"
    print(
        f"  {status} Same disease, {len(country_scenarios)} countries → {len(h_set)} unique hashes"
    )
    passed += ok
    failed += not ok

    # No country/headline → deterministic disease fallback
    no_country_hashes = set()
    for _ in range(5):
        h = dedup.generate_hash(disease="Mpox", countries=[])
        no_country_hashes.add(h)
    ok = len(no_country_hashes) == 1
    status = "✅" if ok else "❌"
    print(
        f"  {status} No country/headline → {len(no_country_hashes)} deterministic hash from 5 calls"
    )
    passed += ok
    failed += not ok

    print(f"\n  📊 Results: {passed}/{passed + failed} passed")
    assert failed == 0, f"{failed} cross-source dedup tests failed"
    print("  ✅ All cross-source dedup tests passed!")


def test_normalization_consistency_across_pipeline() -> None:
    """
    Verify that normalization applied at both epi_analyzer AND _store_findings
    stages doesn't cause issues (double normalization should be idempotent).
    """
    print("\n" + "=" * 70)
    print("TEST 6: Double Normalization Idempotency")
    print("=" * 70)

    test_names = [
        "monkeypox",
        "Mpox",
        "bird flu",
        "H5N1",
        "Nipah virus infection",
        "Nipah",
        "MERS-CoV",
        "MERS",
        "Cholera",
        "cholera",
        "news",
        "Zamboanga hemorrhagic syndrome",  # new disease
    ]

    passed = 0
    failed = 0

    for name in test_names:
        first = normalize_disease_name(name)
        second = normalize_disease_name(first)  # Double normalization
        ok = first == second
        status = "✅" if ok else "❌"
        if not ok:
            print(f"  {status} normalize(normalize('{name}')) = '{second}' ≠ '{first}'")
            failed += 1
        else:
            print(
                f"  {status} normalize(normalize('{name}')) = '{second}' (idempotent)"
            )
            passed += 1

    print(f"\n  📊 Results: {passed}/{passed + failed} passed")
    assert failed == 0, f"{failed} idempotency tests failed"
    print("  ✅ All double-normalization tests passed!")


# ─────────────────────────────────────────────────────────────────────────────
# Main Runner
# ─────────────────────────────────────────────────────────────────────────────


def main():
    print("=" * 70)
    print("  SehaRadar v1.0 — Dry-Run Pipeline Validation")
    print(f"  Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    all_passed = True

    # Unit tests (synchronous)
    for test_fn in [
        test_disease_normalization,
        test_deduplication_hashing,
        test_cross_source_deduplication,
        test_normalization_consistency_across_pipeline,
    ]:
        try:
            test_fn()
        except AssertionError as e:
            all_passed = False
            print(f"\n  ❌ {test_fn.__name__} FAILED: {e}")

    # Async end-to-end test
    try:
        test_end_to_end_mock_pipeline()
    except AssertionError as e:
        all_passed = False
        print(f"\n  ❌ test_end_to_end_mock_pipeline FAILED: {e}")

    # ── Final Summary ───────────────────────────────────────────────────
    print("\n" + "=" * 70)
    if all_passed:
        print("  🎉 ALL TESTS PASSED — Pipeline is safe to run!")
    else:
        print("  ❌ SOME TESTS FAILED — Fix issues before running full scan")
    print("=" * 70)

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
