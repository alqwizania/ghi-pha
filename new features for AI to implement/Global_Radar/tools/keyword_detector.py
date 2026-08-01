"""
Keyword detection tool using config files
"""

import json
from typing import List
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext
from health_agents.shared.config_loader import config_loader


@function_tool
def detect_keywords(
    ctx: RunContextWrapper[HealthContext],
    finding_json: str
) -> str:
    """
    Detect critical and watch keywords in a finding
    
    Args:
        finding_json: JSON string of Finding object
        
    Returns:
        JSON array of detected keywords
    """
    finding_data = json.loads(finding_json)
    headline = finding_data.get("headline", "").lower()
    summary = finding_data.get("summary", "").lower()
    
    # Combine headline and summary for keyword detection
    text = f"{headline} {summary}"
    
    detected_keywords: List[str] = []
    
    # Check critical keywords
    for keyword in config_loader.keywords_critical:
        if keyword.lower() in text:
            detected_keywords.append(keyword)
    
    # Check watch keywords
    for keyword in config_loader.keywords_watch:
        if keyword.lower() in text:
            detected_keywords.append(keyword)
    
    # Remove duplicates
    detected_keywords = list(set(detected_keywords))
    
    if detected_keywords:
        ctx.context.log(f"🔍 Detected {len(detected_keywords)} keywords: {', '.join(detected_keywords[:5])}")
    else:
        ctx.context.log("No keywords detected")
    
    return json.dumps(detected_keywords)
