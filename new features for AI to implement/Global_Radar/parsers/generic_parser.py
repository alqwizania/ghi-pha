"""
Generic Parser — CSS selector-based parser for any HTML source.

This parser uses BeautifulSoup with CSS selectors from config to extract
structured data from any HTML page.

Configuration example (in sources.json):
{
  "parser": "generic",
  "parser_config": {
    "item_selector": "article.news-item",
    "title_selector": "h2.title",
    "date_selector": "span.date",
    "date_format": "%d %B %Y",
    "content_selector": "div.content",
    "link_selector": "a.read-more",
    "location_selector": "span.location"
  }
}
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from urllib.parse import urljoin

import httpx

from .base_parser import BaseParser, RawFinding

try:
    from bs4 import BeautifulSoup

    BEAUTIFULSOUP_AVAILABLE = True
except ImportError:
    BEAUTIFULSOUP_AVAILABLE = False
    BeautifulSoup = None
    print("⚠️ BeautifulSoup not available - GenericParser will use text fallback")


class GenericParser(BaseParser):
    """
    CSS selector-based parser for HTML content.

    Uses BeautifulSoup to extract structured data using CSS selectors
    defined in parser_config.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize with CSS selector configuration.

        Config keys:
            - item_selector: CSS selector for item containers
            - title_selector: CSS selector for titles
            - date_selector: CSS selector for dates
            - date_format: strptime format for parsing dates
            - content_selector: CSS selector for content/description
            - link_selector: CSS selector for links
            - location_selector: CSS selector for location
            - fetch_article_content: Follow detected article URLs (default: true)
            - max_article_fetches: Max URL fetches per parse call (default: 5)
            - article_fetch_timeout_sec: HTTP timeout for URL fetch (default: 12)
            - article_fetch_max_chars: Max article text chars kept (default: 6000)
        """
        super().__init__(config)

        # Validate BeautifulSoup availability
        if not BEAUTIFULSOUP_AVAILABLE and config:
            print("⚠️ BeautifulSoup required for CSS selector parsing")

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        """Parse HTML using CSS selectors or fallback to text."""

        fetch_enabled_raw = self.config.get("fetch_article_content", True)
        fetch_enabled = (
            fetch_enabled_raw.lower() == "true"
            if isinstance(fetch_enabled_raw, str)
            else bool(fetch_enabled_raw)
        )

        try:
            max_fetches = int(self.config.get("max_article_fetches", 5))
        except (TypeError, ValueError):
            max_fetches = 5
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

        if fetch_enabled and max_fetches > 0:
            timeout = httpx.Timeout(timeout_sec)
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True
            ) as client:
                if self.config and BEAUTIFULSOUP_AVAILABLE:
                    return await self._parse_with_css(
                        content,
                        source_name,
                        source_url,
                        fetch_state=fetch_state,
                        http_client=client,
                    )
                return await self._parse_as_text(
                    content,
                    source_name,
                    source_url,
                    fetch_state=fetch_state,
                    http_client=client,
                )

        # If CSS selectors provided and BeautifulSoup available, use it
        if self.config and BEAUTIFULSOUP_AVAILABLE:
            return await self._parse_with_css(content, source_name, source_url)

        # Otherwise fallback to simple text parsing
        return await self._parse_as_text(content, source_name, source_url)

    async def _parse_with_css(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
        fetch_state: Optional[Dict[str, Any]] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> List[RawFinding]:
        """Parse HTML using CSS selectors."""
        findings: List[RawFinding] = []

        if not BEAUTIFULSOUP_AVAILABLE or BeautifulSoup is None:
            return await self._parse_as_text(
                content,
                source_name,
                source_url,
                fetch_state=fetch_state,
                http_client=http_client,
            )

        bs4_parser = BeautifulSoup
        if bs4_parser is None:
            return await self._parse_as_text(
                content,
                source_name,
                source_url,
                fetch_state=fetch_state,
                http_client=http_client,
            )

        soup = bs4_parser(content, "html.parser")

        # Get item selector
        item_selector = self.config.get("item_selector")
        if not item_selector:
            print("⚠️ No item_selector in config, falling back to text parsing")
            return await self._parse_as_text(
                content,
                source_name,
                source_url,
                fetch_state=fetch_state,
                http_client=http_client,
            )

        # Find all items
        items = soup.select(item_selector)
        print(
            f"📄 Generic Parser: Found {len(items)} items with selector '{item_selector}'"
        )

        for item in items[:50]:  # Limit to 50 items
            try:
                # Extract title
                title_elem = item.select_one(
                    self.config.get("title_selector", "h2, h3, .title")
                )
                title = self._clean_text(title_elem.text) if title_elem else None

                if not title or len(title) < 10:
                    continue

                # Extract date
                date_str = None
                date_selector = self.config.get("date_selector")
                if date_selector:
                    date_elem = item.select_one(date_selector)
                    if date_elem:
                        date_str = self._clean_text(date_elem.text)

                # Extract content/description
                description = None
                content_selector = self.config.get("content_selector")
                if content_selector:
                    content_elem = item.select_one(content_selector)
                    if content_elem:
                        description = self._clean_text(content_elem.text)

                # Extract link
                link = source_url
                article_url: Optional[str] = None
                link_selector = self.config.get("link_selector")
                if link_selector:
                    link_elem = item.select_one(link_selector)
                    if link_elem and link_elem.get("href"):
                        article_url = str(link_elem.get("href"))
                        # Make absolute URL if relative
                        if article_url and not article_url.startswith("http"):
                            article_url = (
                                urljoin(source_url, article_url)
                                if source_url
                                else article_url
                            )

                if not article_url:
                    detected_urls = self.extract_urls(item.get_text(" ", strip=True))
                    if detected_urls:
                        article_url = max(detected_urls, key=len)

                link = article_url or source_url

                description, fetched_text = await self._enrich_from_url(
                    article_url=article_url,
                    fallback_description=description or title,
                    fetch_state=fetch_state,
                    http_client=http_client,
                )

                # Extract location
                location = None
                location_selector = self.config.get("location_selector")
                if location_selector:
                    location_elem = item.select_one(location_selector)
                    if location_elem:
                        location = self._clean_text(location_elem.text)

                # Create finding
                finding = RawFinding(
                    title=title,
                    headline=title,
                    description=description,
                    date=date_str,
                    location=location,
                    link=link,
                    article_url=article_url,
                    source=source_name,
                    raw_text=(
                        f"{self._clean_text(item.text)[:1000]}\n\n{fetched_text[:3000]}"
                        if fetched_text
                        else self._clean_text(item.text)[:1000]
                    ),
                )
                findings.append(finding)

            except Exception as e:
                print(f"⚠️ Error parsing item with CSS selectors: {e}")
                continue

        print(f"📄 Generic Parser (CSS): Extracted {len(findings)} findings")
        return findings

    async def _parse_as_text(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
        fetch_state: Optional[Dict[str, Any]] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> List[RawFinding]:
        """Fallback: Parse as plain text (line by line)."""
        findings: List[RawFinding] = []
        lines = content.strip().split("\n")

        for line in lines[:50]:  # Limit to 50 lines
            # Pre-process: strip JS-injected [URL] [Checked:...] artifacts
            clean_line, article_url = self.preprocess_line(line)
            clean_line = self._clean_text(clean_line)

            if not article_url:
                detected_urls = self.extract_urls(line)
                if detected_urls:
                    article_url = max(detected_urls, key=len)

            # Skip short or empty lines
            if not clean_line or len(clean_line) < 20:
                continue

            # Skip navigation/UI text
            skip_words = ["menu", "skip", "search", "footer", "header", "navigation"]
            if any(word in clean_line.lower() for word in skip_words):
                continue

            try:
                description, fetched_text = await self._enrich_from_url(
                    article_url=article_url,
                    fallback_description=clean_line,
                    fetch_state=fetch_state,
                    http_client=http_client,
                )

                finding = RawFinding(
                    title=clean_line[:200],
                    headline=clean_line[:200],
                    description=description,
                    date=None,
                    location=None,
                    link=article_url or source_url,
                    article_url=article_url,
                    source=source_name,
                    raw_text=(
                        f"{line.strip()}\n\n{fetched_text[:3000]}"
                        if fetched_text
                        else line.strip()
                    ),
                )
                findings.append(finding)
            except Exception as e:
                print(f"⚠️ Error creating finding from text: {e}")
                continue

        print(f"📄 Generic Parser (Text): Extracted {len(findings)} findings")
        return findings

    async def _enrich_from_url(
        self,
        article_url: Optional[str],
        fallback_description: str,
        fetch_state: Optional[Dict[str, Any]],
        http_client: Optional[httpx.AsyncClient],
    ) -> tuple[str, Optional[str]]:
        """Fetch and attach article text when URL enrichment is enabled."""
        if not article_url or not fetch_state or not fetch_state.get("enabled"):
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
