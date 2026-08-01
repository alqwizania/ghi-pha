"""
AI Parser — LLM-based content extraction fallback.

Uses OpenRouter (OpenAI-compatible API) to extract structured data when CSS selectors fail or
for sources with complex/unknown structures.
"""

from typing import List, Optional, Dict, Any
import json

from tools.openai_client import get_default_llm_model, get_openai_client

from .base_parser import BaseParser, RawFinding

OPENROUTER_AVAILABLE = True


class AIParser(BaseParser):
    """
    AI-powered parser using LLM for content extraction.

    This parser sends content to an LLM (via OpenRouter) and asks it to extract
    structured outbreak findings. Used as a fallback when CSS selectors fail.

    Configuration:
        - model: OpenRouter model to use (default: openai/gpt-4o-mini)
        - max_tokens: Maximum tokens in response (default: 2000)
        - temperature: Sampling temperature (default: 0.0)
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize AI parser with OpenRouter configuration."""
        super().__init__(config)

        self.model = self.config.get("model", get_default_llm_model())
        self.max_tokens = self.config.get("max_tokens", 2000)
        self.temperature = self.config.get("temperature", 0.0)

        if not OPENROUTER_AVAILABLE:
            print("⚠️ AIParser initialized but OpenRouter client not available")

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        """Parse content using LLM extraction."""

        if not OPENROUTER_AVAILABLE:
            print("❌ AIParser: OpenRouter client not available")
            return []

        # Truncate content to avoid token limits
        content_truncated = content[:8000] if len(content) > 8000 else content

        print(
            f"🤖 AIParser: Extracting findings from {len(content_truncated)} chars..."
        )

        try:
            findings_data = await self._extract_with_llm(
                content_truncated,
                source_name,
                source_url,
            )

            if not findings_data:
                return []

            # Convert to RawFinding objects
            findings = []
            for item in findings_data:
                try:
                    finding = RawFinding(
                        title=item.get("headline", item.get("title", "")),
                        headline=item.get("headline", item.get("title", "")),
                        description=item.get("summary", item.get("description", "")),
                        date=item.get("date"),
                        location=item.get("location"),
                        link=item.get("link") or source_url,
                        article_url=item.get("article_url"),
                        source=source_name,
                        raw_text=item.get("raw_text", ""),
                    )
                    findings.append(finding)
                except Exception as e:
                    print(f"⚠️ Error creating finding from AI response: {e}")
                    continue

            print(f"🤖 AIParser: Extracted {len(findings)} findings")
            return findings

        except Exception as e:
            print(f"❌ AIParser failed: {e}")
            return []

    async def _extract_with_llm(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Use LLM to extract structured data from unstructured content.

        Returns:
            List of dicts with keys: headline, disease, date, location, summary
        """

        prompt = f"""Extract disease outbreak findings from this content.

Source: {source_name}
URL: {source_url or "N/A"}

For each disease outbreak or health alert mentioned, extract:
- headline: Main title or headline (required)
- disease: Disease name if identifiable (e.g., "Mpox", "COVID-19", "Cholera")
- date: Publication or report date in YYYY-MM-DD format if possible
- location: Geographic location (country, region, city)
- summary: Brief 1-2 sentence description
- link: URL if different from source URL

Return ONLY a JSON array of findings. If no findings, return empty array [].

Example:
[
  {{
    "headline": "Mpox outbreak in Democratic Republic of Congo",
    "disease": "Mpox",
    "date": "2026-02-08",
    "location": "Democratic Republic of the Congo",
    "summary": "New cases of Mpox reported in eastern provinces.",
    "link": null
  }}
]

Content to analyze:
{content}

JSON array of findings:"""

        response_text = ""
        try:
            client = get_openai_client()

            response = await client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a health surveillance expert that extracts structured data from outbreak reports. Always return valid JSON arrays.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            # Parse response
            response_text = response.choices[0].message.content
            if not response_text:
                return []

            response_text = response_text.strip()

            # Clean markdown code blocks if present
            if response_text.startswith("```"):
                # Remove ```json and ``` markers
                response_text = response_text.strip("`")
                if response_text.startswith("json"):
                    response_text = response_text[4:].strip()

            # Parse JSON
            findings = json.loads(response_text)

            if not isinstance(findings, list):
                print(f"⚠️ AI response not a list: {type(findings)}")
                return []

            return findings

        except json.JSONDecodeError as e:
            print(f"❌ Failed to parse AI response as JSON: {e}")
            if response_text:
                print(f"Response: {response_text[:200]}...")
            return []
        except Exception as e:
            print(f"❌ LLM extraction failed: {e}")
            return []
