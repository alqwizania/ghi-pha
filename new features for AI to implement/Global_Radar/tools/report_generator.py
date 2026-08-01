"""
AI-powered report generator for daily summaries
"""

import json
from datetime import datetime
from typing import List, Dict, Any
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext, Report

from .openai_client import get_default_llm_model, get_openai_client


@function_tool
async def generate_daily_report_narrative(
    ctx: RunContextWrapper[HealthContext], findings_json: str
) -> str:
    """
    Generate AI narrative for daily report from findings

    Args:
        findings_json: JSON array of all findings from today

    Returns:
        Report JSON with AI-generated narrative
    """
    ctx.context.log("Generating daily report narrative")

    findings: List[Dict[str, Any]] = json.loads(findings_json)

    if not findings:
        ctx.context.log("No findings to report")
        report = Report(
            report_date=datetime.now().strftime("%Y-%m-%d"),
            narrative="No new health surveillance findings today.",
            findings_count=0,
            agencies_active=[],
        )
        return report.model_dump_json()

    # Extract agencies
    agencies = list(set(f.get("agency", "Unknown") for f in findings))

    # Prepare report generation prompt
    findings_summary = "\n\n".join(
        [
            f"- {f.get('agency')}: {f.get('headline')}\n  {f.get('summary', '')[:200]}"
            for f in findings[:20]  # Limit to first 20 findings
        ]
    )

    prompt = f"""Generate an executive summary for today's health surveillance findings.

Date: {datetime.now().strftime("%Y-%m-%d")}
Total Findings: {len(findings)}
Active Agencies: {", ".join(agencies)}

Findings:
{findings_summary}

Write a professional, narrative-style executive summary (2-3 paragraphs) that:
1. Highlights the most significant health events
2. Notes any concerning patterns or trends
3. Provides context and implications
4. Uses storytelling style, not bullet points or statistics

Write in the style of a public health intelligence briefing.

Return ONLY the narrative text, no JSON, no formatting."""

    try:
        response = await get_openai_client().chat.completions.create(
            model=get_default_llm_model(),
            messages=[
                {
                    "role": "system",
                    "content": "You are a public health intelligence analyst writing executive briefings.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=500,
        )

        content = response.choices[0].message.content
        narrative = content.strip() if content else "No narrative generated."

        report = Report(
            report_date=datetime.now().strftime("%Y-%m-%d"),
            narrative=narrative,
            findings_count=len(findings),
            agencies_active=agencies,
        )

        ctx.context.log(f"✅ Generated daily report ({len(findings)} findings)")

        return report.model_dump_json()

    except Exception as e:
        ctx.context.log(f"❌ Report generation error: {e}")

        # Fallback report
        fallback_report = Report(
            report_date=datetime.now().strftime("%Y-%m-%d"),
            narrative=f"Report generation failed: {str(e)}",
            findings_count=len(findings),
            agencies_active=agencies,
        )
        return fallback_report.model_dump_json()
