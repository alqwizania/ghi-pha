"""
WHO Parser — Specialized parser for WHO outbreak and emergency pages.

Primary format:
    Date | Title - Location

Fallback format (for regional/sitrep pages):
    Date line
    Title [URL]
"""

from typing import List, Optional, Set, Dict, Any
import re

import httpx

from .base_parser import BaseParser, RawFinding


class WHOParser(BaseParser):
    """
    Parser for WHO Disease Outbreak News format.

    Expected format:
        Date | Title - Location

    Example:
        8 February 2026 | Mpox - Democratic Republic of the Congo

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
        """Parse WHO outbreak format with a forgiving fallback."""
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

                # Skip empty lines
                if not line or len(line) < 15:
                    continue

                # Pre-process: strip JS-injected [URL] [Checked:...] artifacts
                clean_line, article_url = self.preprocess_line(line)
                if not article_url:
                    detected_urls = self.extract_urls(line)
                    if detected_urls:
                        article_url = max(detected_urls, key=len)

                # Skip empty lines after cleaning
                if not clean_line or len(clean_line) < 15:
                    continue

                # Must contain pipe separator
                if "|" not in clean_line:
                    continue

                # Split by pipe
                parts = clean_line.split("|", 1)
                if len(parts) != 2:
                    continue

                date_str = parts[0].strip()
                title_location = parts[1].strip()

                # Skip headers and navigation
                skip_phrases = [
                    "Disease Outbreak",
                    "Page of",
                    "Skip to",
                    "Navigation",
                    "Filter",
                    "Sort by",
                ]
                if any(phrase in title_location for phrase in skip_phrases):
                    continue

                # Parse title and location
                title = title_location
                location = ""

                if " - " in title_location:
                    parts = title_location.rsplit(" - ", 1)
                    title = parts[0].strip()
                    location = parts[1].strip() if len(parts) > 1 else ""

                # Build description
                if location:
                    description = f"{title} reported in {location}"
                    headline = f"{title} - {location}"
                else:
                    description = title
                    headline = title

                description, fetched_text = await self._enrich_from_url(
                    article_url=article_url,
                    fallback_description=description,
                    fetch_state=fetch_state,
                    http_client=http_client,
                )

                # Create finding
                try:
                    finding = RawFinding(
                        title=title,
                        headline=headline,
                        description=description,
                        date=date_str,
                        location=location,
                        link=article_url
                        or source_url
                        or "https://www.who.int/emergencies/disease-outbreak-news",
                        article_url=article_url,
                        source=source_name,
                        raw_text=(
                            f"{line}\n\n{fetched_text[:3000]}" if fetched_text else line
                        ),
                    )
                    findings.append(finding)
                except Exception as e:
                    print(f"⚠️ Failed to create WHO finding: {e}")
                    continue

            if findings:
                print(f"📄 WHO Parser: Extracted {len(findings)} findings")
                return findings

            fallback_findings = await self._parse_without_separator(
                lines,
                source_name,
                source_url,
                fetch_state=fetch_state,
                http_client=http_client,
            )
            print(f"📄 WHO Parser: Extracted {len(fallback_findings)} findings")
            return fallback_findings
        finally:
            if http_client is not None:
                await http_client.aclose()

    async def _parse_without_separator(
        self,
        lines: List[str],
        source_name: str,
        source_url: Optional[str],
        fetch_state: Dict[str, Any],
        http_client: Optional[httpx.AsyncClient],
    ) -> List[RawFinding]:
        """Fallback parser for WHO pages that do not use the `|` separator."""
        findings: List[RawFinding] = []
        seen_keys: Set[str] = set()
        pending_date: Optional[str] = None
        configured_limit = self.config.get("fallback_max_items", 30)
        try:
            max_items = int(configured_limit)
        except (TypeError, ValueError):
            max_items = 30
        if max_items <= 0:
            max_items = 30

        for line in lines:
            raw_line = line.strip()
            if not raw_line:
                continue

            clean_line, article_url = self.preprocess_line(raw_line)
            clean_line = self._clean_text(clean_line)
            if not clean_line:
                continue

            if not article_url:
                detected_urls = self.extract_urls(raw_line)
                if detected_urls:
                    article_url = max(detected_urls, key=len)

            if self._is_date_only_line(clean_line):
                pending_date = self._extract_date_candidate(clean_line)
                continue

            if not article_url:
                continue

            if self._is_fallback_noise(clean_line):
                continue

            title = clean_line
            location = ""
            if " - " in clean_line:
                parts = clean_line.rsplit(" - ", 1)
                title = parts[0].strip()
                location = parts[1].strip() if len(parts) > 1 else ""

            if len(title) < 10:
                continue

            date_str = self._extract_date_candidate(clean_line) or pending_date

            dedupe_key = f"{article_url}|{title.lower()}"
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            description = f"{title} reported in {location}" if location else title
            headline = f"{title} - {location}" if location else title

            description, fetched_text = await self._enrich_from_url(
                article_url=article_url,
                fallback_description=description,
                fetch_state=fetch_state,
                http_client=http_client,
            )

            try:
                findings.append(
                    RawFinding(
                        title=title,
                        headline=headline,
                        description=description,
                        date=date_str,
                        location=location,
                        link=article_url
                        or source_url
                        or "https://www.who.int/emergencies/disease-outbreak-news",
                        article_url=article_url,
                        source=source_name,
                        raw_text=(
                            f"{raw_line}\n\n{fetched_text[:3000]}"
                            if fetched_text
                            else raw_line
                        ),
                    )
                )
            except Exception as e:
                print(f"⚠️ Failed to create WHO fallback finding: {e}")
                continue

            if len(findings) >= max_items:
                break

        return findings

    async def _enrich_from_url(
        self,
        article_url: Optional[str],
        fallback_description: str,
        fetch_state: Dict[str, Any],
        http_client: Optional[httpx.AsyncClient],
    ) -> tuple[str, Optional[str]]:
        """Fetch article content when line includes an article URL."""
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

    def _is_date_only_line(self, text: str) -> bool:
        """Return True when line is mostly a standalone date marker."""
        extracted_date = self._extract_date_candidate(text)
        if not extracted_date:
            return False

        normalized = re.sub(r"\s+", " ", text.strip())
        tail = normalized.replace(extracted_date, "", 1).strip(" -,:;")
        if not tail:
            return True

        return tail.lower() in {"news release", "media release"}

    def _is_fallback_noise(self, text: str) -> bool:
        """Skip non-finding labels common on WHO listing pages."""
        normalized = re.sub(r"\s+", " ", text.strip()).lower()
        if len(normalized) < 15:
            return True

        if normalized in {
            "all",
            "all ->",
            "all →",
            "current update",
            "previous issues",
            "monthly mers updates",
            "summary reviews of influenza seasons",
        }:
            return True

        if normalized.startswith(("current emergencies", "read more", "» read more")):
            return True

        if normalized.startswith(
            (
                "if you wish to be notified",
                "covid-19 epidemiological updates will be integrated",
            )
        ):
            return True

        if re.fullmatch(r"\d{4}", normalized):
            return True

        return False

    def _extract_date_candidate(self, text: str) -> Optional[str]:
        """Extract WHO-like date snippets from a line, or None."""
        if not text:
            return None

        # WHO date pattern: "DD Month YYYY"
        pattern = (
            r"\d{1,2}\s+"
            r"(?:January|February|March|April|May|June|July|August|September|"
            r"October|November|December)"
            r"\s+\d{4}"
        )
        match = re.search(pattern, text)
        return match.group(0) if match else None

    def _extract_date(self, text: str) -> Optional[str]:
        """
        Extract date from WHO format.

        WHO uses format: "8 February 2026"
        """
        # WHO date pattern: "DD Month YYYY"
        pattern = r"\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}"
        match = re.search(pattern, text)
        return match.group(0) if match else text.strip()
