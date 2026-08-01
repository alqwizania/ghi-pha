"""
LLM-based HTML extraction tool
"""

from datetime import datetime
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import Finding, HealthContext
from health_agents.shared.config_loader import config_loader
import json
from typing import List, Dict, Any, Optional

from .openai_client import get_default_llm_model, get_openai_client


class HTMLExtractor:
    """HTML content extractor using LLM"""

    def __init__(self):
        self.max_html_chars = 50000

    async def extract_findings(
        self,
        html_content: str,
        source_url: str = "",
        agency: str = "Unknown",
    ) -> List[Dict[str, Any]]:
        """
        Extract findings from HTML content using LLM.

        Args:
            html_content: Raw HTML content
            source_url: URL of the source page
            agency: Agency name for context

        Returns:
            List of finding dictionaries
        """
        # Truncate if needed
        html_truncated = (
            html_content[: self.max_html_chars]
            if len(html_content) > self.max_html_chars
            else html_content
        )

        if len(html_content) > self.max_html_chars:
            print(
                f"⚠️ HTML truncated from {len(html_content)} to {self.max_html_chars} chars"
            )

        # Prepare extraction prompt
        prompt = f"""Extract ALL recent health surveillance findings from this HTML content.

Agency: {agency}
Source URL: {source_url}

Look for ALL health-related news items, alerts, or updates. For each finding extract:
- title: The main title or headline
- description: A brief summary (1-2 sentences)
- link: The URL to the full article (if available)
- date: Publication date (if available)

IMPORTANT: 
- Extract ALL findings you can identify
- Focus on recent items
- Each finding should be a distinct health event
- Return an array of findings

HTML Content ({len(html_truncated)} chars):
{html_truncated}

Return a JSON array:
[
  {{"title": "...", "description": "...", "link": "...", "date": "..."}},
  {{"title": "...", "description": "...", "link": "...", "date": "..."}}
]

Return ONLY valid JSON array, no markdown."""

        try:
            response = await get_openai_client().chat.completions.create(
                model=get_default_llm_model(),
                messages=[
                    {
                        "role": "system",
                        "content": "You are a health surveillance data extraction specialist.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                timeout=60.0,
            )

            content = response.choices[0].message.content
            if content is None:
                print("❌ LLM returned empty response")
                return []

            extracted_json = content.strip()

            # Remove markdown code blocks if present
            if extracted_json.startswith("```"):
                extracted_json = extracted_json.split("```")[1]
                if extracted_json.startswith("json"):
                    extracted_json = extracted_json[4:]
                extracted_json = extracted_json.strip()

            # Parse and validate
            extracted_data = json.loads(extracted_json)

            # Ensure it's an array
            if not isinstance(extracted_data, list):
                extracted_data = [extracted_data]

            # Normalize the findings
            findings = []
            for item in extracted_data:
                finding = {
                    "title": item.get("title", item.get("headline", "")),
                    "headline": item.get("title", item.get("headline", "")),
                    "description": item.get("description", item.get("summary", "")),
                    "summary": item.get("description", item.get("summary", "")),
                    "link": item.get("link", item.get("url", source_url)),
                    "url": item.get("link", item.get("url", source_url)),
                    "date": item.get("date", item.get("published_date", "")),
                    "published_date": item.get("date", item.get("published_date", "")),
                    "source": agency,
                }

                # Skip if no title
                if finding["title"] and finding["title"].strip():
                    findings.append(finding)

            print(f"✅ Extracted {len(findings)} findings from HTML")
            return findings

        except Exception as e:
            print(f"❌ HTML extraction error: {e}")
            return []


# Global extractor instance
html_extractor = HTMLExtractor()


@function_tool
async def extract_findings_from_html(
    ctx: RunContextWrapper[HealthContext],
    html_content: str,
    agency: str,
    source_url: str = "",
) -> str:
    """
    Extract ALL structured findings from HTML using LLM (multiple findings support)

    Args:
        html_content: The FULL HTML content to extract from (no truncation)
        agency: The agency name (WHO, CDC, PROMED, PLACEHOLDER_1, PLACEHOLDER_2)
        source_url: The source URL of the HTML (optional - will be looked up from config if not provided)

    Returns:
        JSON string containing array of Finding objects
    """
    ctx.context.log(f"Extracting ALL findings from HTML for agency: {agency}")

    # Get source URL from agency config if not provided
    if not source_url:
        agency_config = config_loader.get_agency_config(agency)
        if agency_config:
            source_url = agency_config.url_pattern
            ctx.context.log(f"Using source URL from config: {source_url}")

    # Calculate how much HTML we can send (leaving room for prompt)
    # gpt-4o-mini has 128k context, but we'll use max 50k chars to be safe
    max_html_chars = 50000
    html_truncated = (
        html_content[:max_html_chars]
        if len(html_content) > max_html_chars
        else html_content
    )

    if len(html_content) > max_html_chars:
        ctx.context.log(
            f"⚠️ HTML truncated from {len(html_content)} to {max_html_chars} chars"
        )
    else:
        ctx.context.log(f"Processing full HTML content ({len(html_content)} chars)")

    # Prepare extraction prompt for MULTIPLE findings
    prompt = f"""Extract ALL recent health surveillance findings from this HTML content.

Agency: {agency}
Source URL: {source_url}

Look for ALL health-related news items, alerts, or updates. For each finding extract:
- headline: The main title or headline of the health finding
- summary: A brief summary (1-2 sentences) of the health event

IMPORTANT: 
- Extract ALL findings you can identify in the content
- Focus on recent items (typically found near the top or in "latest news" sections)
- Each finding should be a distinct health event or update
- Return an array of findings, even if there's only one

HTML Content ({len(html_truncated)} chars):
{html_truncated}

Return a JSON array of findings with this structure:
[
  {{"headline": "...", "summary": "..."}},
  {{"headline": "...", "summary": "..."}}
]

Return ONLY valid JSON array, no markdown formatting."""

    try:
        response = await get_openai_client().chat.completions.create(
            model=get_default_llm_model(),
            messages=[
                {
                    "role": "system",
                    "content": "You are a health surveillance data extraction specialist. Extract ALL health findings from HTML content into a structured format.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )

        # Parse LLM response
        content = response.choices[0].message.content
        if content is None:
            ctx.context.log("❌ LLM returned empty response")
            return json.dumps([])

        extracted_json = content.strip()

        # Remove markdown code blocks if present
        if extracted_json.startswith("```"):
            extracted_json = extracted_json.split("```")[1]
            if extracted_json.startswith("json"):
                extracted_json = extracted_json[4:]
            extracted_json = extracted_json.strip()

        # Parse and validate
        extracted_data = json.loads(extracted_json)

        # Ensure it's an array
        if not isinstance(extracted_data, list):
            extracted_data = [extracted_data]

        # Create Finding objects
        findings = []
        for item in extracted_data:
            # Build dict and use model_validate to bypass type checking
            finding_dict = {
                "agency": agency,
                "headline": item.get("headline", "No headline found"),
                "summary": item.get("summary", "No summary available"),
                "url": source_url,
            }
            finding = Finding.model_validate(finding_dict)
            findings.append(finding)

        ctx.context.log(f"✅ Extracted {len(findings)} finding(s)")
        for i, finding in enumerate(findings[:5], 1):  # Log first 5
            ctx.context.log(f"  {i}. {finding.headline[:60]}...")

        # Return array of findings as JSON
        return json.dumps([f.model_dump() for f in findings])

    except Exception as e:
        ctx.context.log(f"❌ Extraction error: {e}")

        # Return empty array on error
        return json.dumps([])
