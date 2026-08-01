"""
Batch analysis tool - processes multiple findings in a single call
"""

import json
from typing import Any
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext, Finding
from tools.keyword_detector import detect_keywords
from tools.llm_comparison import compare_with_historical_findings


@function_tool
async def analyze_findings_batch(
    ctx: RunContextWrapper[HealthContext],
    findings_json: str,
    historical_findings_json: str,
) -> str:
    """
    Analyze a batch of findings - detect keywords and find supersedes relationships.

    Args:
        findings_json: JSON array of findings to analyze
        historical_findings_json: JSON array of historical findings for comparison

    Returns:
        JSON array of enriched findings with keywords and supersedes_id added
    """
    ctx.context.log(f"Starting batch analysis of findings")

    try:
        # Parse inputs
        findings = json.loads(findings_json)
        historical = json.loads(historical_findings_json)

        ctx.context.log(
            f"Analyzing {len(findings)} findings against {len(historical)} historical findings"
        )

        enriched_findings = []

        for idx, finding in enumerate(findings, 1):
            finding_str = json.dumps(finding)

            # Detect keywords
            keywords_result = await detect_keywords.__call__(ctx, finding_str)
            keywords_data = json.loads(keywords_result)

            # Compare with historical
            compare_result = await compare_with_historical_findings.__call__(
                ctx, finding_str
            )
            compare_data = json.loads(compare_result)

            # Build enriched finding
            enriched = {
                **finding,
                "keywords": keywords_data.get("keywords", []),
                "supersedes_id": compare_data.get("supersedes_id"),
            }

            enriched_findings.append(enriched)

            ctx.context.log(
                f"✅ Analyzed finding {idx}/{len(findings)}: "
                f"{len(keywords_data.get('keywords', []))} keywords, "
                f"supersedes: {compare_data.get('supersedes_id')}"
            )

        result = json.dumps(enriched_findings)
        ctx.context.log(
            f"✅ Batch analysis complete: {len(enriched_findings)} findings processed"
        )

        return result

    except Exception as e:
        error_msg = f"❌ Batch analysis failed: {str(e)}"
        ctx.context.log(error_msg)
        raise ValueError(error_msg)
