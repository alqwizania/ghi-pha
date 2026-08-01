"""
ChangeDetection.io Webhook Workflow for DabDar v3.0
Processes incoming webhooks and fetches/analyzes content
"""

import os
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any

from health_agents.shared.models import HealthContext
from health_agents.shared.config_loader import config_loader


async def process_webhook(
    agency: str, webhook_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Process a ChangeDetection.io webhook using the v3 pipeline.

    This fetches the HTML snapshot from ChangeDetection.io, analyzes it
    using the epidemiological triad analyzer, translates to Arabic,
    and stores in NocoDB with deduplication.

    Args:
        agency: Agency name (WHO, CDC, PROMED, etc.)
        webhook_id: Unique webhook ID (generated if not provided)

    Returns:
        Result dictionary with processing stats
    """
    if webhook_id is None:
        webhook_id = f"webhook_{agency}_{int(datetime.now().timestamp())}"

    print(f"\n{'=' * 80}")
    print(f"🔔 WEBHOOK RECEIVED: {agency}")
    print(f"Webhook ID: {webhook_id}")
    print(f"{'=' * 80}\n", flush=True)

    # Get watch UUID from environment
    watch_uuid = config_loader.get_watch_id(agency)

    if not watch_uuid:
        print(f"❌ No watch UUID configured for agency: {agency}")
        return {
            "success": False,
            "error": f"No watch UUID configured for agency: {agency}",
            "webhook_id": webhook_id,
        }

    # Get source URL from config
    agency_config = config_loader.get_agency_config(agency)
    source_url = agency_config.url_pattern if agency_config else ""

    # Create context
    context = HealthContext(
        agency=agency,
        webhook_id=webhook_id,
        timestamp=datetime.now(),
        report_mode=False,
    )

    context.log(f"Processing webhook for {agency} (watch: {watch_uuid})")

    try:
        # Import tools
        from tools.changedetection_client import changedetection_client
        from tools.html_extraction import html_extractor
        from tools.epi_triad_analyzer import epi_analyzer
        from tools.arabic_translator import arabic_translator
        from tools.nocodb_client import nocodb_v3
        from tools.deduplication import dedup_service

        # Step 1: Fetch HTML snapshot from ChangeDetection.io
        print(f"📥 Fetching HTML snapshot from ChangeDetection.io...", flush=True)
        html_content = await changedetection_client.fetch_snapshot(watch_uuid)

        if not html_content:
            print(f"❌ Failed to fetch HTML snapshot for {agency}")
            return {
                "success": False,
                "error": "Failed to fetch HTML snapshot",
                "webhook_id": webhook_id,
            }

        print(f"✅ Fetched HTML snapshot ({len(html_content)} bytes)", flush=True)

        # Step 2: Extract findings from HTML using class-based extractor
        print(f"🔍 Extracting findings from HTML...", flush=True)
        findings = await html_extractor.extract_findings(
            html_content=html_content,
            source_url=source_url,
            agency=agency,
        )

        if not findings:
            print(f"ℹ️ No findings extracted from {agency} HTML")
            return {
                "success": True,
                "items_found": 0,
                "stored": 0,
                "webhook_id": webhook_id,
            }

        print(f"✅ Extracted {len(findings)} findings", flush=True)

        # Limit to 10 findings per webhook to avoid very long processing
        max_items = 10
        if len(findings) > max_items:
            print(f"  Limiting to {max_items} findings (out of {len(findings)})")
            findings = findings[:max_items]

        # Step 3: Analyze each finding
        analyzed = []
        print(f"📊 Analyzing {len(findings)} findings...", flush=True)

        for idx, finding in enumerate(findings):
            try:
                title = finding.get("title", finding.get("headline", ""))[:50]
                print(
                    f"  📊 Analyzing {idx + 1}/{len(findings)}: {title}...", flush=True
                )

                # Analyze with epidemiological triad
                analysis = await epi_analyzer.analyze_content(
                    title=title,
                    description=finding.get("description", finding.get("summary", "")),
                    source=agency,
                    source_link=finding.get("link", finding.get("url", source_url)),
                    publication_date=finding.get(
                        "date", finding.get("published_date", "")
                    ),
                )

                if analysis:
                    analyzed.append(analysis)
                    print(f"  ✅ Analysis done for finding {idx + 1}", flush=True)

            except Exception as e:
                print(f"  ⚠️ Error analyzing finding {idx + 1}: {e}")
                continue

        print(f"✅ Analyzed {len(analyzed)} findings", flush=True)

        if not analyzed:
            return {
                "success": True,
                "items_found": len(findings),
                "analyzed": 0,
                "stored": 0,
                "webhook_id": webhook_id,
            }

        # Step 4: Translate to Arabic
        print(f"🌐 Translating {len(analyzed)} findings to Arabic...", flush=True)
        translated = await arabic_translator.translate_batch(analyzed)
        print(f"✅ Translated {len(translated)} findings", flush=True)

        # Step 5: Store with deduplication
        print(f"💾 Storing {len(translated)} findings...", flush=True)
        stored = 0
        duplicates = 0

        for finding in translated:
            try:
                # Generate content hash
                content_hash = dedup_service.generate_hash(
                    disease=finding.get("disease", "news"),
                    countries=finding.get("countries", []),
                    headline=finding.get("headline", ""),
                )
                finding["content_hash"] = content_hash
                finding["source_type"] = "changedetection"

                # Check for duplicate
                is_duplicate = await dedup_service.check_hash_exists(content_hash)
                if is_duplicate:
                    duplicates += 1
                    continue

                # Store in NocoDB
                result = await nocodb_v3.create_finding_v3(finding)
                if result:
                    stored += 1

            except Exception as e:
                print(f"  ⚠️ Error storing finding: {e}")
                continue

        print(f"✅ Stored: {stored} new, {duplicates} duplicates", flush=True)

        print(f"\n{'=' * 80}")
        print(f"✅ WEBHOOK PROCESSED: {agency}")
        print(f"Webhook ID: {webhook_id}")
        print(
            f"Results: {len(findings)} found → {len(analyzed)} analyzed → {stored} stored"
        )
        print(f"{'=' * 80}\n")

        return {
            "success": True,
            "items_found": len(findings),
            "analyzed": len(analyzed),
            "translated": len(translated),
            "stored": stored,
            "duplicates": duplicates,
            "webhook_id": webhook_id,
        }

    except Exception as e:
        print(f"\n❌ ERROR processing webhook: {str(e)}\n")
        context.log(f"❌ Webhook processing failed: {str(e)}")
        return {"success": False, "error": str(e), "webhook_id": webhook_id}


async def extract_findings_from_html(
    html_content: str, source_url: str, agency: str
) -> list:
    """
    Extract findings from HTML content.

    This uses the html_extraction tool to parse the HTML and extract
    news items/findings based on the agency's page structure.

    Args:
        html_content: Raw HTML content
        source_url: Original URL of the page
        agency: Agency name for context

    Returns:
        List of finding dictionaries
    """
    from tools.html_extraction import html_extractor

    # Extract findings using the HTML extractor
    findings = await html_extractor.extract_findings(
        html_content=html_content,
        source_url=source_url,
        agency=agency,
    )

    return findings


# Export for compatibility
__all__ = ["process_webhook"]
