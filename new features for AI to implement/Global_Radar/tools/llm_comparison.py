"""
LLM-based historical comparison tool
"""

import json
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext

from .openai_client import get_default_llm_model, get_openai_client


@function_tool
async def compare_with_historical_findings(
    ctx: RunContextWrapper[HealthContext],
    current_finding_json: str,
    historical_findings_json: str,
) -> str:
    """
    Use LLM to compare current finding with historical findings

    Args:
        current_finding_json: JSON of current finding
        historical_findings_json: JSON array of historical findings

    Returns:
        JSON with comparison result: {"supersedes_id": int or null, "reason": str}
    """
    ctx.context.log("Comparing current finding with historical findings using LLM")

    current = json.loads(current_finding_json)
    historical = json.loads(historical_findings_json)

    if not historical:
        ctx.context.log("No historical findings to compare")
        return json.dumps({"supersedes_id": None, "reason": "No historical findings"})

    # Prepare comparison prompt
    prompt = f"""Compare this current health finding to historical findings from the same agency.

Current Finding:
- Headline: {current.get("headline")}
- Summary: {current.get("summary")}
- Date: {current.get("date_detected")}

Historical Findings (last 30 days):
{json.dumps(historical[:10], indent=2)}

Determine if the current finding is an UPDATE or CONTINUATION of any historical finding.

Examples of updates:
- "Marburg Outbreak - Day 1" → "Marburg Outbreak - Day 5"
- "COVID-19 variant detected" → "COVID-19 variant spreading"
- "Investigation ongoing" → "Investigation complete"

Return JSON:
{{
  "supersedes_id": <ID of historical finding if this is an update, otherwise null>,
  "reason": "<brief explanation>"
}}

Return ONLY valid JSON, no markdown."""

    try:
        response = await get_openai_client().chat.completions.create(
            model=get_default_llm_model(),
            messages=[
                {
                    "role": "system",
                    "content": "You are a public health intelligence analyst comparing health surveillance findings.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )

        content = response.choices[0].message.content
        if not content:
            return json.dumps(
                {"supersedes_id": None, "reason": "LLM returned empty response"}
            )

        result_text = content.strip()

        # Remove markdown if present
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
            result_text = result_text.strip()

        result = json.loads(result_text)

        if result.get("supersedes_id"):
            ctx.context.log(
                f"✅ Found supersedes relationship: ID {result['supersedes_id']}"
            )
        else:
            ctx.context.log("✅ No supersedes relationship found")

        return json.dumps(result)

    except Exception as e:
        ctx.context.log(f"❌ Comparison error: {e}")
        return json.dumps({"supersedes_id": None, "reason": f"Error: {str(e)}"})
