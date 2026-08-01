"""
Fetcher Agent for DabDar v3.0
Unified agent for multi-source data collection (ChangeDetection, RSSHub, Google Search)
"""

import os
import json
from typing import List, Dict, Any, Optional
from agents import Agent, ModelSettings, function_tool, RunContextWrapper
from health_agents.shared.models import (
    HealthContext,
    SourceType,
    GoogleSearchResult,
    Finding,
)


# Import existing tools
from tools.changedetection_client import fetch_html_snapshot
from tools.html_extraction import extract_findings_from_html
from tools.google_search import (
    search_disease_news,
    search_all_configured_diseases,
    google_search_client,
)


@function_tool
async def fetch_from_changedetection(
    ctx: RunContextWrapper[HealthContext], agency: str
) -> str:
    """
    Fetch content from ChangeDetection.io for a specific agency.

    This uses the existing webhook-based monitoring system.

    Args:
        agency: Agency name (WHO, CDC, PROMED, PLACEHOLDER_1)

    Returns:
        JSON string of extracted findings
    """
    ctx.context.log(f"📡 Fetching from ChangeDetection.io: {agency}")
    ctx.context.source_type = SourceType.CHANGEDETECTION

    # Get watch UUID from environment
    watch_uuid_env = f"WATCH_UUID_{agency.upper()}"
    watch_uuid = os.getenv(watch_uuid_env, "")

    if not watch_uuid:
        ctx.context.log(f"⚠️ No watch UUID configured for {agency}")
        return json.dumps([])

    # Fetch HTML snapshot
    html_result = await fetch_html_snapshot.run(ctx, watch_uuid)

    if "Error" in html_result or not html_result:
        ctx.context.log(f"❌ Failed to fetch HTML for {agency}")
        return json.dumps([])

    # Extract findings
    findings_json = await extract_findings_from_html.run(ctx, html_result, agency)

    return findings_json


@function_tool
async def fetch_from_rss(
    ctx: RunContextWrapper[HealthContext], source: str = "ALL", days_back: int = 7
) -> str:
    """
    ⚠️ DEPRECATED (v1.0): Use unified_scan_workflow instead.
    RSS feeds are now handled via RSSHub (Phase B) and ChangeDetection.io (Phase A).
    This function is a no-op stub kept for backward compatibility.

    Args:
        source: RSS source name (ignored)
        days_back: Only return items from last N days (ignored)

    Returns:
        Empty JSON array
    """
    ctx.context.log(
        f"⚠️  DEPRECATED: fetch_from_rss() — RSS feeds now handled by RSSHub + ChangeDetection"
    )
    return json.dumps([])


@function_tool
async def fetch_from_google(
    ctx: RunContextWrapper[HealthContext],
    disease: str = "ALL",
    language: str = "en",
    days_back: int = 7,
) -> str:
    """
    Fetch news from Google Custom Search.

    Args:
        disease: Disease name to search for (or ALL for all configured diseases)
        language: Search language (en, ar)
        days_back: Only return results from last N days

    Returns:
        JSON string of search results converted to finding format
    """
    ctx.context.log(f"📡 Fetching from Google: {disease} ({language})")
    ctx.context.source_type = SourceType.GOOGLE_SEARCH

    if disease == "ALL":
        search_json = await search_all_configured_diseases.run(ctx, language, days_back)
        results_by_disease = json.loads(search_json)

        # Flatten results
        findings = []
        for disease_name, results in results_by_disease.items():
            for result in results:
                finding = {
                    "headline": result.get("title", ""),
                    "source": "GOOGLE",
                    "source_type": "google_search",
                    "source_link": result.get("link", ""),
                    "short_description_en": result.get("snippet", ""),
                    "disease": disease_name,
                    "priority": "medium",
                }
                findings.append(finding)
    else:
        search_json = await search_disease_news.run(ctx, disease, language, days_back)
        results = json.loads(search_json)

        findings = []
        for result in results:
            finding = {
                "headline": result.get("title", ""),
                "source": "GOOGLE",
                "source_type": "google_search",
                "source_link": result.get("link", ""),
                "short_description_en": result.get("snippet", ""),
                "disease": disease,
                "priority": "medium",
            }
            findings.append(finding)

    ctx.context.log(f"✅ Converted {len(findings)} Google results to findings")

    return json.dumps(findings, ensure_ascii=False)


@function_tool
async def fetch_all_sources(
    ctx: RunContextWrapper[HealthContext],
    include_changedetection: bool = True,
    include_rss: bool = True,
    include_google: bool = True,
    days_back: int = 7,
) -> str:
    """
    Fetch news from all configured sources.

    Args:
        include_changedetection: Include ChangeDetection.io sources
        include_rss: Include RSS feeds
        include_google: Include Google search
        days_back: Only return items from last N days

    Returns:
        JSON string of all findings from all sources
    """
    all_findings = []

    # RSS feeds are now handled by RSSHub + ChangeDetection (unified scan)
    if include_rss:
        ctx.context.log(
            "ℹ️ RSS feeds handled by RSSHub (Phase B) in unified scan — skipping here"
        )

    # Fetch from Google (if configured)
    if include_google and google_search_client.enabled:
        ctx.context.log("📡 Fetching from Google Search...")
        try:
            # Search in English
            google_findings = await fetch_from_google.run(ctx, "ALL", "en", days_back)
            all_findings.extend(json.loads(google_findings))

            # Optionally search in Arabic
            languages = os.getenv("SEARCH_LANGUAGES", "en").split(",")
            if "ar" in languages:
                google_findings_ar = await fetch_from_google.run(
                    ctx, "ALL", "ar", days_back
                )
                all_findings.extend(json.loads(google_findings_ar))
        except Exception as e:
            ctx.context.log(f"⚠️ Google search error: {e}")

    # Note: ChangeDetection is typically triggered by webhooks, not polled
    # But we can include it for manual scanning
    if include_changedetection:
        ctx.context.log("📡 ChangeDetection.io sources are webhook-triggered")
        # Could add manual polling here if needed

    ctx.context.log(f"✅ Total findings from all sources: {len(all_findings)}")

    return json.dumps(all_findings, ensure_ascii=False)


# Create the Fetcher Agent
fetcher_agent = Agent[HealthContext](
    name="Fetcher Agent",
    instructions="""
    You are the data collection specialist for the DabDar health surveillance system.
    
    Your responsibilities:
    1. Collect health news from multiple sources:
       - ChangeDetection.io (unified website & RSS monitoring)
       - Google Custom Search (disease-specific searches)
    
    2. Source handling:
       - For WEBHOOKS: Use fetch_from_changedetection with the agency name
       - For GOOGLE SEARCHES: Use fetch_from_google with disease name or "ALL"
       - For FULL SCAN: Use fetch_all_sources to get everything
    
    3. Output format:
       - Return findings as a JSON array
       - Each finding should have: headline, source, source_type, source_link, 
         publication_date, short_description_en, disease, priority
       - The disease field may be empty - will be identified later
    
    4. Handoff to Epidemiological Agent:
       - After fetching, hand off the findings to the Epidemiological Agent
       - Pass the complete JSON array in your handoff message
    
    WORKFLOW:
    1. Determine which sources to fetch based on the request
    2. Call appropriate fetch function(s)
    3. Combine all findings into a single array
    4. Hand off to Epidemiological Agent with the findings
    
    ERROR HANDLING:
    - If a source fails, log the error and continue with other sources
    - Always return at least an empty array if all sources fail
    - Google Search may not be configured - check before using
    
    ⚠️  NOTE: RSS feeds are now handled via RSSHub (Phase B) and ChangeDetection.io (Phase A).
    Direct RSS parsing functions are deprecated — use unified_scan_workflow instead.
    """,
    tools=[
        fetch_from_changedetection,
        fetch_from_google,
        fetch_all_sources,
        # Also include the underlying tools for flexibility
        fetch_html_snapshot,
        extract_findings_from_html,
        search_disease_news,
        search_all_configured_diseases,
    ],
    model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    model_settings=ModelSettings(
        parallel_tool_calls=False,  # Sequential for proper logging
    ),
)
