"""
CDC Parser — Specialized parser for CDC Outbreaks page.

CDC format is more free-form, typically lines of text describing outbreaks.
"""

from typing import List, Optional, Dict, Any
import re

import httpx

from .base_parser import BaseParser, RawFinding


class CDCParser(BaseParser):
    """
    Parser for CDC Outbreaks page format.

    CDC format is less structured than WHO. Each line typically contains
    outbreak information in free-form text.

    Optional config keys:
        - fetch_article_content: Follow detected article URLs (default: true)
        - max_article_fetches: Max URL fetches per parse call (default: 8)
        - article_fetch_timeout_sec: HTTP timeout for URL fetch (default: 12)
        - article_fetch_max_chars: Max article text chars kept (default: 6000)
    """

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        """Parse CDC outbreak format."""
        findings: List[RawFinding] = []
        lines = content.strip().split("\n")

        fetch_enabled_raw = self.config.get("fetch_article_content", True)
        fetch_enabled = (
            fetch_enabled_raw.lower() == "true"
            if isinstance(fetch_enabled_raw, str)
            else bool(fetch_enabled_raw)
        )
        try:
            max_fetches = int(self.config.get("max_article_fetches", 8))
        except (TypeError, ValueError):
            max_fetches = 8
        max_fetches = max(0, max_fetches)
        try:
            timeout_sec = float(self.config.get("article_fetch_timeout_sec", 12))
        except (TypeError, ValueError):
            timeout_sec = 12.0
        try:
            max_chars = int(self.config.get("article_fetch_max_chars", 6000))
        except (TypeError, ValueError):
            max_chars = 6000

        fetch_state: Dict[str, Any] = {
            "enabled": fetch_enabled,
            "max_fetches": max_fetches,
            "timeout_sec": timeout_sec,
            "max_chars": max_chars,
            "fetched": 0,
            "cache": {},
        }

        http_client: Optional[httpx.AsyncClient] = None
        if fetch_enabled and max_fetches > 0:
            timeout = httpx.Timeout(timeout_sec)
            http_client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)

        try:
            for line in lines:
                line = line.strip()

                # Skip short lines
                if not line or len(line) < 15:
                    continue

                # Pre-process: strip JS-injected [URL] [Checked:...] artifacts
                clean_line, article_url = self.preprocess_line(line)

                # Skip short or empty lines after cleaning
                if not clean_line or len(clean_line) < 15:
                    continue

                if not article_url:
                    detected_urls = self.extract_urls(line)
                    if detected_urls:
                        article_url = max(detected_urls, key=len)

                # Skip navigation and UI elements
                skip_words = [
                    "menu",
                    "skip",
                    "search",
                    "home",
                    "about",
                    "contact",
                    "footer",
                    "navigation",
                    "breadcrumb",
                    "header",
                    "toggle",
                    "filter",
                    "sort by",
                    "page ",
                    "of ",
                    "results",
                ]
                line_lower = clean_line.lower()
                if any(skip in line_lower for skip in skip_words):
                    continue

                # Skip if too short or too long
                if len(clean_line) < 20 or len(clean_line) > 500:
                    continue

                description, fetched_text = await self._enrich_from_url(
                    article_url=article_url,
                    fallback_description=clean_line,
                    fetch_state=fetch_state,
                    http_client=http_client,
                )

                # Create finding
                try:
                    # Extract date if present (CDC often uses "Month DD, YYYY")
                    date_str = self._extract_date(clean_line)

                    # Extract location if present
                    location = self._extract_location(clean_line)

                    finding = RawFinding(
                        title=clean_line[:200],
                        headline=clean_line[:200],
                        description=description,
                        date=date_str,
                        location=location,
                        link=article_url
                        or source_url
                        or "https://www.cdc.gov/outbreaks/",
                        article_url=article_url,
                        source=source_name,
                        raw_text=(
                            f"{line}\n\n{fetched_text[:3000]}" if fetched_text else line
                        ),
                    )
                    findings.append(finding)
                except Exception as e:
                    print(f"⚠️ Failed to create CDC finding: {e}")
                    continue
        finally:
            if http_client is not None:
                await http_client.aclose()

        print(f"📄 CDC Parser: Extracted {len(findings)} findings")
        return findings

    async def _enrich_from_url(
        self,
        article_url: Optional[str],
        fallback_description: str,
        fetch_state: Dict[str, Any],
        http_client: Optional[httpx.AsyncClient],
    ) -> tuple[str, Optional[str]]:
        """Fetch article content when a line includes an article URL."""
        if not article_url or not fetch_state.get("enabled"):
            return fallback_description, None

        cache: Dict[str, str] = fetch_state["cache"]
        if article_url in cache:
            cached = cache[article_url]
            return (cached[:900], cached) if cached else (fallback_description, None)

        if fetch_state["fetched"] >= fetch_state["max_fetches"]:
            return fallback_description, None

        article_text = await self.fetch_url_text(
            article_url,
            timeout_sec=fetch_state["timeout_sec"],
            max_chars=fetch_state["max_chars"],
            client=http_client,
        )
        fetch_state["fetched"] += 1
        cache[article_url] = article_text or ""

        if not article_text:
            return fallback_description, None

        snippet = article_text[:900]
        if len(snippet) < 80:
            return fallback_description, article_text

        return snippet, article_text

    def _extract_date(self, text: str) -> Optional[str]:
        """
        Extract date from CDC text.

        CDC typically uses: "Month DD, YYYY" or "MM/DD/YYYY"
        """
        # Pattern 1: "February 8, 2026"
        pattern1 = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}"
        match = re.search(pattern1, text)
        if match:
            return match.group(0)

        # Pattern 2: "02/08/2026"
        pattern2 = r"\d{1,2}/\d{1,2}/\d{4}"
        match = re.search(pattern2, text)
        if match:
            return match.group(0)

        return None

    def _extract_location(self, text: str) -> Optional[str]:
        """
        Extract location from CDC text.

        Simple pattern matching for common location phrases.
        """
        # Look for "in [Location]" or "- [Location]"
        patterns = [
            r"\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
            r"-\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
        ]

        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                location = match.group(1)
                # Verify it's not a common false positive
                false_positives = ["Updated", "Posted", "Published", "Alert", "Warning"]
                if location not in false_positives:
                    return location

        return None
