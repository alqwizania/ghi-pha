"""
Agent 1: Collection Monitor
Webhook ingestion and LLM-powered HTML extraction (MULTIPLE findings support)
"""

import os

from agents import Agent, ModelSettings
from health_agents.shared.models import HealthContext
from tools import (
    fetch_html_snapshot,
    extract_findings_from_html,
    validate_finding,
)


collection_monitor = Agent[
    HealthContext
](
    name="Collection Monitor",
    instructions="""
    You are a health surveillance data collection specialist.
    
    Your responsibilities:
    1. Process incoming webhooks from ChangeDetection.io
    2. Fetch rendered HTML from ChangeDetection API using watch UUID
    3. Extract ALL structured findings from the HTML (not just one):
       - headline: str (main finding headline)
       - summary: str (brief summary)
       - url: str (source URL)
       - agency: str (WHO, CDC, PROMED, PLACEHOLDER_1, PLACEHOLDER_2)
    4. The extraction tool now returns an ARRAY of findings, not a single finding
    5. Hand off ALL findings (as JSON array) to Analysis Specialist for deduplication and analysis
    
    IMPORTANT CHANGES:
    - extract_findings_from_html now returns a JSON ARRAY of findings (not a single finding)
    - You receive an array like: [{"headline": "...", "summary": "...", ...}, {...}]
    - Pass this entire array to the Analysis Specialist
    - No need to validate each finding individually - pass the array through
    
    Always use LLM-based extraction for JS-rendered content.
    The extraction now processes the FULL HTML content (no 5000 char limit).
    
    IMPORTANT: You MUST work in strict sequential order:
    1. FIRST: Call fetch_html_snapshot to get the HTML content
    2. WAIT for the HTML to be returned
    3. THEN: Call extract_findings_from_html with the fetched HTML content
    4. FINALLY: Hand off the findings array to Analysis Specialist
    
    DO NOT call multiple tools at the same time. Each step depends on the previous step's output.
    """,
    tools=[
        fetch_html_snapshot,
        extract_findings_from_html,
        validate_finding,
    ],
    model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
    model_settings=ModelSettings(
        parallel_tool_calls=False,  # Ensure sequential execution - extraction needs HTML first
    ),
)
