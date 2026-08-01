"""
Data validation tool (soft validation with warnings)
"""

from typing import List
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import Finding, HealthContext


@function_tool
def validate_finding(
    ctx: RunContextWrapper[HealthContext],
    finding_json: str
) -> str:
    """
    Validate finding data with soft validation (warnings only, doesn't fail)
    
    Args:
        finding_json: JSON string of Finding object
        
    Returns:
        Validation report as string
    """
    import json
    
    warnings: List[str] = []
    
    try:
        finding_data = json.loads(finding_json)
        finding = Finding(**finding_data)
        
        # Check headline
        if not finding.headline or finding.headline == "":
            warnings.append("Empty headline")
        
        # Check summary
        if not finding.summary or finding.summary == "":
            warnings.append("Empty summary")
        
        # Check URL format
        if not finding.url.startswith("http"):
            warnings.append(f"Invalid URL format: {finding.url}")
        
        # Check agency
        valid_agencies = ["WHO", "CDC", "PROMED", "PLACEHOLDER_1", "PLACEHOLDER_2"]
        if finding.agency not in valid_agencies:
            warnings.append(f"Invalid agency: {finding.agency}")
        
        if warnings:
            for warning in warnings:
                ctx.context.log(f"⚠️  Validation warning: {warning}")
            return f"Validation completed with {len(warnings)} warnings: {', '.join(warnings)}"
        else:
            ctx.context.log("✅ Validation passed")
            return "Validation passed - no warnings"
            
    except Exception as e:
        error_msg = f"Validation error: {e}"
        ctx.context.log(f"❌ {error_msg}")
        return error_msg
