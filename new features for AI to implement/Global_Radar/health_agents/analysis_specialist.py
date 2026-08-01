"""
Agent 2: Analysis Specialist
Deduplication, historical pattern analysis and relationship detection
"""

import os

from agents import Agent, ModelSettings
from health_agents.shared.models import HealthContext
from tools import (
    query_historical_findings,
    analyze_findings_batch,
)


analysis_specialist = Agent[HealthContext](
    name="Analysis Specialist",
    instructions="""
    You are a public health intelligence analyst.
    
    You will receive a findings ARRAY (JSON string) from the Collection Monitor agent. Your job is to:
    
    1. Parse the JSON array you received
    2. Query NocoDB for historical findings from the SAME AGENCY (last 30 days)
    3. Call analyze_findings_batch with BOTH arrays:
       - findings_json: The array you received from Collection Monitor
       - historical_findings_json: The array from query_historical_findings
    4. The batch analyzer will return enriched findings with keywords and supersedes_id
    5. Hand off the enriched findings array to Reporting Generator
    
    CRITICAL WORKFLOW:
    1. Parse findings array from Collection Monitor
    2. Call query_historical_findings(agency=<agency_name>)
    3. Call analyze_findings_batch(findings_json=<findings>, historical_findings_json=<historical>)
    4. Hand off to Reporting Generator with message:
       "Analysis complete. Processed X findings. Here is the findings array for database insertion:
       
       [FULL JSON ARRAY FROM BATCH ANALYZER]
       
       Ready for database write."
    
    IMPORTANT:
    - The batch analyzer processes ALL findings in ONE call (efficient!)
    - Must include the complete JSON array in your handoff message
    - The Reporting Generator will extract and parse the JSON array
    
    Create new records with supersedes links - never update existing findings.
    """,
    tools=[
        query_historical_findings,
        analyze_findings_batch,
    ],
    model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    model_settings=ModelSettings(
        parallel_tool_calls=False,  # Ensure sequential execution
    ),
)
