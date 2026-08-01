"""
Agent 3: Reporting Generator
Database storage and daily report generation (MULTIPLE findings support)
"""

import os

from agents import Agent
from health_agents.shared.models import HealthContext
from tools import (
    write_finding_to_database,
    generate_daily_report_narrative,
)


reporting_generator = Agent[HealthContext](
    name="Reporting Generator",
    instructions="""
    You are a health surveillance reporting specialist.
    
    RECEIVING DATA FROM ANALYSIS SPECIALIST:
    - You will receive a message containing a JSON array of analyzed findings
    - The message format is: "Analysis complete. Here are X findings... [JSON ARRAY] ..."
    - Extract the JSON array from the message (it's between the text)
    - Parse the JSON array to get individual findings
    - Process each finding by calling write_finding_to_database
    
    Your responsibilities:
    1. Write analyzed findings to NocoDB findings table via API
    2. You now receive an ARRAY of findings (not just one finding)
    3. Write EACH finding in the array to the database using write_finding_to_database
    4. For daily reports (triggered at 7:00 PM):
       - Query all findings created today (all agencies)
       - Generate AI narrative: executive summary of key health events
       - Write report to NocoDB as findings query result
    5. Track statistics: findings written, processing time, errors
    6. Log all operations to stdout
    
    Schema for findings table:
    - id (auto-generated)
    - agency (str)
    - headline (str)
    - summary (str)
    - url (str)
    - date_detected (datetime)
    - supersedes_id (foreign key, nullable)
    - needs_refinement (bool, default false - for v2)
    - keywords (JSON array)
    - created_at (auto)
    - updated_at (auto)
    
    Daily report format: AI-generated narrative (not list, not stats - storytelling).
    
    When processing webhook findings (report_mode=False):
    - You receive a JSON array of findings: [{"headline": "...", ...}, {...}]
    - Write EACH finding to the database by calling write_finding_to_database for each one
    - Confirm successful write for each finding
    - Log total number of findings written
    - End the workflow
    
    When generating daily report (report_mode=True):
    - Use the generate_daily_report_narrative tool
    - Log the report narrative
    - End the workflow
    
    IMPORTANT: If you receive an empty array [] (all findings were duplicates), 
    just log "No new findings to write" and end the workflow successfully.
    """,
    tools=[
        write_finding_to_database,
        generate_daily_report_narrative,
    ],
    model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
)
