"""
Master Agent for DabDar v3.0
Enhanced orchestrator that coordinates all agents in the pipeline:
Fetcher -> Epidemiological -> Translator -> Database
"""

import os
import json
from typing import Optional
from datetime import datetime
from agents import Agent, ModelSettings, function_tool, RunContextWrapper, Runner
from health_agents.shared.models import HealthContext, SourceType

# Import all sub-agents
from health_agents.fetcher_agent import fetcher_agent
from health_agents.epidemiological_agent import epidemiological_agent
from health_agents.translator_agent import translator_agent
from health_agents.database_agent import database_agent


@function_tool
async def run_full_pipeline(
    ctx: RunContextWrapper[HealthContext],
    source_type: str = "all",
    include_rss: bool = True,
    include_google: bool = True,
    days_back: int = 7,
) -> str:
    """
    Run the full DabDar v3.0 pipeline:
    Fetch -> Analyze -> Translate -> Store

    Args:
        source_type: Type of source to fetch from (all, rss, google, changedetection)
        include_rss: Include RSS feeds in fetch
        include_google: Include Google search in fetch
        days_back: Look back period for RSS/Google

    Returns:
        JSON summary of pipeline execution
    """
    ctx.context.log(f"=== Starting DabDar v3.0 Pipeline ===")
    ctx.context.log(f"Source type: {source_type}, Days back: {days_back}")

    start_time = datetime.now()
    results = {
        "start_time": start_time.isoformat(),
        "source_type": source_type,
        "stages": {},
        "success": False,
    }

    try:
        # Stage 1: Fetch
        ctx.context.log("--- Stage 1: Fetching Data ---")
        from tools.rss_parser import fetch_all_rss_sources
        from tools.google_search import (
            search_all_configured_diseases,
            google_search_client,
        )

        all_findings = []

        if source_type in ["all", "rss"] and include_rss:
            rss_result = await fetch_all_rss_sources(ctx, days_back)
            rss_findings = json.loads(rss_result)
            all_findings.extend(rss_findings)
            ctx.context.log(f"  RSS: {len(rss_findings)} items fetched")

        if (
            source_type in ["all", "google"]
            and include_google
            and google_search_client.enabled
        ):
            try:
                google_result = await search_all_configured_diseases(
                    ctx, "en", days_back
                )
                google_findings = json.loads(google_result)
                # Flatten the dictionary to a list
                for disease, items in google_findings.items():
                    for item in items:
                        item["disease"] = disease
                        item["source"] = "GOOGLE"
                        item["source_type"] = "google_search"
                        all_findings.append(
                            {
                                "headline": item.get("title", ""),
                                "source": "GOOGLE",
                                "source_type": "google_search",
                                "source_link": item.get("link", ""),
                                "short_description_en": item.get("snippet", ""),
                                "disease": disease,
                                "priority": "medium",
                            }
                        )
                ctx.context.log(f"  Google: {len(google_findings)} diseases searched")
            except Exception as e:
                ctx.context.log(f"  Google search error: {e}")

        results["stages"]["fetch"] = {
            "success": True,
            "findings_count": len(all_findings),
        }

        if not all_findings:
            ctx.context.log("No findings to process")
            results["success"] = True
            results["message"] = "No new findings found"
            results["end_time"] = datetime.now().isoformat()
            return json.dumps(results, ensure_ascii=False)

        # Stage 2: Epidemiological Analysis
        ctx.context.log("--- Stage 2: Epidemiological Analysis ---")
        from tools.epi_triad_analyzer import batch_analyze_findings

        analyzed_result = await batch_analyze_findings(
            ctx, json.dumps(all_findings, ensure_ascii=False)
        )
        analyzed_findings = json.loads(analyzed_result)
        ctx.context.log(f"  Analyzed: {len(analyzed_findings)} findings")

        results["stages"]["analysis"] = {
            "success": True,
            "findings_analyzed": len(analyzed_findings),
        }

        # Stage 3: Translation
        ctx.context.log("--- Stage 3: Arabic Translation ---")
        from tools.arabic_translator import batch_translate_findings

        translated_result = await batch_translate_findings(
            ctx, json.dumps(analyzed_findings, ensure_ascii=False)
        )
        translated_findings = json.loads(translated_result)
        ctx.context.log(f"  Translated: {len(translated_findings)} findings")

        results["stages"]["translation"] = {
            "success": True,
            "findings_translated": len(translated_findings),
        }

        # Stage 4: Database Storage
        ctx.context.log("--- Stage 4: Database Storage ---")
        from tools.nocodb_client import batch_write_findings

        db_result = await batch_write_findings(
            ctx, json.dumps(translated_findings, ensure_ascii=False)
        )
        db_response = json.loads(db_result)
        ctx.context.log(
            f"  Stored: {db_response.get('written', 0)} findings, {db_response.get('duplicates', 0)} duplicates"
        )

        results["stages"]["database"] = {
            "success": True,
            "written": db_response.get("written", 0),
            "duplicates": db_response.get("duplicates", 0),
            "errors": db_response.get("errors", 0),
        }

        # Success
        results["success"] = True
        results["end_time"] = datetime.now().isoformat()
        results["total_processed"] = len(translated_findings)
        results["new_stored"] = db_response.get("written", 0)
        results["duration_seconds"] = (datetime.now() - start_time).total_seconds()

        ctx.context.log(f"=== Pipeline Complete ===")
        ctx.context.log(f"Duration: {results['duration_seconds']:.2f}s")
        ctx.context.log(
            f"Processed: {results['total_processed']}, Stored: {results['new_stored']}"
        )

        return json.dumps(results, ensure_ascii=False)

    except Exception as e:
        ctx.context.log(f"Pipeline error: {e}")
        results["success"] = False
        results["error"] = str(e)
        results["end_time"] = datetime.now().isoformat()
        return json.dumps(results, ensure_ascii=False)


@function_tool
async def run_rss_scan(
    ctx: RunContextWrapper[HealthContext],
    days_back: int = 7,
) -> str:
    """
    Run RSS feed scan only.

    Args:
        days_back: Look back period

    Returns:
        JSON summary
    """
    return await run_full_pipeline(
        ctx, "rss", include_rss=True, include_google=False, days_back=days_back
    )


@function_tool
async def run_google_scan(
    ctx: RunContextWrapper[HealthContext],
    disease: str = "ALL",
    days_back: int = 7,
) -> str:
    """
    Run Google search scan.

    Args:
        disease: Specific disease to search or ALL
        days_back: Look back period

    Returns:
        JSON summary
    """
    return await run_full_pipeline(
        ctx, "google", include_rss=False, include_google=True, days_back=days_back
    )


@function_tool
async def get_system_statistics(ctx: RunContextWrapper[HealthContext]) -> str:
    """
    Get current system statistics.

    Returns:
        JSON with system stats
    """
    from tools.nocodb_client import nocodb_v3

    ctx.context.log("Fetching system statistics...")

    try:
        stats = await nocodb_v3.get_statistics()
        ctx.context.log(f"Total findings: {stats.get('total', 0)}")
        return json.dumps(stats, ensure_ascii=False)
    except Exception as e:
        ctx.context.log(f"Error fetching stats: {e}")
        return json.dumps({"error": str(e)})


@function_tool
async def trigger_email_digest(
    ctx: RunContextWrapper[HealthContext],
    interval: str = "daily",
) -> str:
    """
    Trigger email digest compilation and sending.

    Args:
        interval: Digest interval (hourly, 6hours, daily)

    Returns:
        Status message
    """
    from tools.email_digest import send_digest_email

    ctx.context.log(f"Triggering {interval} email digest...")
    result = await send_digest_email(ctx, interval)
    return result


@function_tool
async def process_changedetection_webhook(
    ctx: RunContextWrapper[HealthContext],
    agency: str,
    webhook_id: str = "",
) -> str:
    """
    Process a ChangeDetection.io webhook (for backward compatibility).

    Args:
        agency: Agency name (WHO, CDC, PROMED)
        webhook_id: Webhook identifier

    Returns:
        Processing result
    """
    ctx.context.log(f"Processing webhook for {agency} (ID: {webhook_id})")
    ctx.context.agency = agency
    ctx.context.webhook_id = webhook_id
    ctx.context.source_type = SourceType.CHANGEDETECTION

    # Use the existing workflow
    from workflows.webhook_workflow import process_webhook

    result = await process_webhook(agency, webhook_id)
    return json.dumps({"success": True, "agency": agency, "result": result})


# Master Agent definition
MASTER_SYSTEM_PROMPT = """
You are the Master Agent (DabDar v3.0) - the central orchestrator for the health surveillance system.

Your responsibilities:
1. Coordinate data collection from multiple sources:
   - ChangeDetection.io webhooks (real-time website monitoring)
   - RSS feeds (WHO, CDC news feeds)
   - Google Custom Search (disease-specific searches)

2. Orchestrate the processing pipeline:
   - Fetcher Agent: Collects data from configured sources
   - Epidemiological Agent: Analyzes content for WHO/WHERE/WHEN triad
   - Translator Agent: Translates findings to Arabic
   - Database Agent: Stores with deduplication

3. Manage scheduled tasks:
   - Periodic RSS scans (every 6 hours)
   - Google searches (daily for each disease)
   - Email digests (configurable: hourly/6hours/daily)

AVAILABLE TOOLS:
- run_full_pipeline: Run complete fetch -> analyze -> translate -> store pipeline
- run_rss_scan: Run RSS-only scan
- run_google_scan: Run Google-only scan
- get_system_statistics: Get database statistics
- trigger_email_digest: Send email digest
- process_changedetection_webhook: Handle incoming webhooks (legacy)

WORKFLOW HANDLING:

For "scan all sources" or "run pipeline":
1. Call run_full_pipeline with appropriate parameters
2. Report results: findings processed, stored, duplicates

For "scan RSS feeds":
1. Call run_rss_scan
2. Report results

For "search Google for [disease]":
1. Call run_google_scan with disease parameter
2. Report results

For "send digest" or "trigger email":
1. Call trigger_email_digest with interval
2. Report delivery status

For "get statistics":
1. Call get_system_statistics
2. Report database counts

For ChangeDetection webhooks (agency parameter provided):
1. Call process_changedetection_webhook
2. Report processing result

IMPORTANT:
- Always log progress through the pipeline
- Report errors clearly with context
- Track statistics for monitoring
- Prioritize critical findings in reports
"""

master_agent = Agent[HealthContext](
    name="Master Agent",
    instructions=MASTER_SYSTEM_PROMPT,
    tools=[
        run_full_pipeline,
        run_rss_scan,
        run_google_scan,
        get_system_statistics,
        trigger_email_digest,
        process_changedetection_webhook,
    ],
    model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    model_settings=ModelSettings(
        parallel_tool_calls=False,  # Sequential for logging
    ),
)


# Helper functions for running the master agent
async def run_master_pipeline(
    source_type: str = "all",
    include_rss: bool = True,
    include_google: bool = True,
    days_back: int = 7,
) -> dict:
    """
    Helper function to run the master pipeline programmatically.

    Returns:
        Pipeline execution results
    """
    context = HealthContext(
        source=source_type,
        timestamp=datetime.now(),
    )

    # Create wrapper-like context for direct tool calls
    class SimpleContext:
        def __init__(self, ctx):
            self.context = ctx

    wrapper = SimpleContext(context)

    result = await run_full_pipeline(
        wrapper,
        source_type=source_type,
        include_rss=include_rss,
        include_google=include_google,
        days_back=days_back,
    )

    return json.loads(result)


async def run_master_agent_conversation(message: str) -> str:
    """
    Run the master agent with a conversation message.

    Args:
        message: User message/instruction

    Returns:
        Agent response
    """
    context = HealthContext(
        timestamp=datetime.now(),
    )

    runner = Runner(master_agent, context=context)
    result = await runner.run(message)

    return result.final_output
