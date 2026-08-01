"""
Database Agent for DabDar v3.0
Handles all database operations with deduplication and query interface
"""

import os

from agents import Agent, ModelSettings
from health_agents.shared.models import HealthContext
from tools.nocodb_client import (
    write_finding_to_database,
    batch_write_findings,
    query_historical_findings,
    query_findings_by_disease,
    query_unsent_for_digest,
    mark_findings_as_sent,
    get_database_statistics,
)
from tools.deduplication import (
    check_duplicate_finding,
    generate_finding_hash,
)
from tools.report_generator import generate_daily_report_narrative


# Database Agent system prompt
DATABASE_SYSTEM_PROMPT = """
You are the database specialist for the DabDar health surveillance system.

Your responsibilities:
1. Store analyzed and translated findings to NocoDB
2. Prevent duplicate entries using content hashing
3. Provide query interface for reports and digests
4. Track notification status for email digests
5. Generate statistics and reports

STORAGE WORKFLOW:
1. Receive translated findings from Translator Agent
2. For each finding:
   a. Generate content hash (if not already present)
   b. Check for duplicates using check_duplicate_finding
   c. If not duplicate, write using batch_write_findings
3. Track statistics (written, duplicates, errors)
4. Report completion

DEDUPLICATION RULES:
- Use content hash based on: disease + source + date + key_facts + headline
- Check for exact hash matches
- Check for similar headlines (85% similarity threshold)
- Skip duplicate entries, don't update existing

QUERY FUNCTIONS:
- query_findings_by_disease: Get findings for specific disease
- query_historical_findings: Get recent findings for an agency
- query_unsent_for_digest: Get findings not yet emailed
- get_database_statistics: Get counts and metrics

NOTIFICATION TRACKING:
- New findings have notification_sent = false
- After email digest sent, call mark_findings_as_sent
- This prevents findings from being included in multiple digests

WORKFLOW FOR INCOMING FINDINGS:
1. Parse the JSON array of findings
2. Use batch_write_findings to write all at once (handles deduplication)
3. The function returns: {written, duplicates, errors, summary}
4. Log the summary
5. End workflow (no further handoff needed)

WORKFLOW FOR DAILY REPORT:
1. Use generate_daily_report_narrative tool
2. Log the report
3. End workflow

If you receive an empty array [] or all duplicates, log "No new findings to write" 
and end successfully.

Respond with a clear summary of what was written to the database.
"""


database_agent = Agent[HealthContext](
    name="Database Agent",
    instructions=DATABASE_SYSTEM_PROMPT,
    tools=[
        write_finding_to_database,
        batch_write_findings,
        query_historical_findings,
        query_findings_by_disease,
        query_unsent_for_digest,
        mark_findings_as_sent,
        get_database_statistics,
        check_duplicate_finding,
        generate_finding_hash,
        generate_daily_report_narrative,
    ],
    model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    model_settings=ModelSettings(
        parallel_tool_calls=False,
    ),
)
