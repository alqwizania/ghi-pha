"""
Base Parser — Abstract base class for all parsers.

All parsers must inherit from BaseParser and implement the parse() method.
"""

import html
import re
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

import httpx
from pydantic import BaseModel, Field


class RawFinding(BaseModel):
    """
    Raw finding data extracted by parsers (before AI analysis).

    This is what parsers return. The workflow then enriches it with
    epidemiological analysis, translation, etc.
    """

    title: str = Field(..., description="Main headline/title")
    headline: Optional[str] = Field(None, description="Alternative headline")
    description: Optional[str] = Field(None, description="Brief description")
    date: Optional[str] = Field(None, description="Publication date (any format)")
    location: Optional[str] = Field(None, description="Geographic location")
    link: Optional[str] = Field(None, description="Source URL")
    article_url: Optional[str] = Field(
        None, description="Individual article URL extracted from JS-injected snapshot"
    )
    source: Optional[str] = Field(None, description="Source name")
    raw_text: Optional[str] = Field(None, description="Full raw text")

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for backward compatibility."""
        return {
            "title": self.title,
            "headline": self.headline or self.title,
            "description": self.description or self.title,
            "date": self.date or "",
            "location": self.location or "",
            "link": self.link or "",
            "article_url": self.article_url or "",
            "source": self.source or "",
            "raw_text": self.raw_text or "",
        }


class BaseParser(ABC):
    """
    Abstract base class for content parsers.

    All parsers must implement the parse() method that takes raw content
    and returns a list of RawFinding objects.
    """

    # Matches JS-injected [URL] [Checked: timestamp] artifacts from ChangeDetection.io
    INJECTED_PATTERN = re.compile(r"\s*\[(https?://[^\]]+)\]\s*\[Checked:\s*[^\]]*\]")
    URL_PATTERN = re.compile(r"https?://[^\s\]>)\"']+", re.IGNORECASE)

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize parser with optional configuration.

        Args:
            config: Parser-specific configuration (CSS selectors, patterns, etc.)
        """
        self.config = config or {}

    @abstractmethod
    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        """
        Parse content and extract findings.

        Args:
            content: Raw content to parse
            source_name: Name of the source
            source_url: Optional URL of the source

        Returns:
            List of RawFinding objects
        """
        pass

    def _clean_text(self, text: str) -> str:
        """Remove extra whitespace and clean text."""
        if not text:
            return ""
        return " ".join(text.strip().split())

    # Matches the start of the first bracketed URL in a line
    _FIRST_BRACKET_URL = re.compile(r"\s*\[https?://")

    def preprocess_line(self, line: str) -> Tuple[str, Optional[str]]:
        """
        Strip JS-injected [URL] [Checked:...] artifacts from a snapshot line.

        ChangeDetection.io watches inject per-link URLs via JS:
            OriginalText [https://example.com/article] [Checked: 2/24/2026, 9:25:32 PM]

        After the last [Checked:...] block there may be trailing page text
        (e.g. "Disease Outbreak News") that bleeds from adjacent links.
        We strip from the first ``[http`` onward to remove both the injected
        pattern *and* any trailing garbage.

        Returns:
            (clean_text, best_article_url_or_None)
        """
        # Extract all injected URLs before cleaning
        urls = self.INJECTED_PATTERN.findall(line)

        # Truncate at the first [http...] to remove injected blocks + trailing text
        m = self._FIRST_BRACKET_URL.search(line)
        if m:
            clean = line[: m.start()]
        else:
            clean = line

        clean = " ".join(clean.split())  # collapse whitespace
        # Pick most specific URL (longest path)
        article_url = max(urls, key=len) if urls else None
        return clean, article_url

    def _extract_date(self, text: str) -> Optional[str]:
        """
        Extract date from text (basic implementation).

        Subclasses should override for format-specific parsing.
        """
        # This is a simple implementation
        # Subclasses can provide more sophisticated date extraction
        return text.strip() if text else None

    def extract_urls(self, text: str) -> List[str]:
        """Extract unique http(s) URLs from arbitrary text."""
        if not text:
            return []

        urls = self.URL_PATTERN.findall(text)
        seen: set[str] = set()
        ordered: List[str] = []
        for url in urls:
            if url in seen:
                continue
            seen.add(url)
            ordered.append(url)
        return ordered

    async def fetch_url_text(
        self,
        url: str,
        timeout_sec: float = 12.0,
        max_chars: int = 6000,
        client: Optional[httpx.AsyncClient] = None,
    ) -> Optional[str]:
        """Fetch URL content and return simplified readable text."""
        if not url or not url.startswith(("http://", "https://")):
            return None

        should_close_client = False
        active_client = client
        if active_client is None:
            timeout = httpx.Timeout(timeout_sec)
            active_client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
            should_close_client = True

        headers = {
            "User-Agent": "SehaRadar/1.0 (+https://seha-radar.fayaa92.sa)",
            "Accept": "text/html, text/plain, application/json;q=0.8, */*;q=0.5",
        }

        try:
            response = await active_client.get(url, headers=headers)
            response.raise_for_status()

            content_type = (response.headers.get("content-type") or "").lower()
            if content_type and all(
                marker not in content_type
                for marker in (
                    "text/html",
                    "text/plain",
                    "application/json",
                    "application/xml",
                    "text/xml",
                )
            ):
                return None

            readable = self._html_to_text(response.text)
            if not readable:
                return None
            return readable[:max_chars]
        except Exception as exc:
            print(f"⚠️ Failed to fetch URL content {url}: {exc}")
            return None
        finally:
            if should_close_client:
                await active_client.aclose()

    def _html_to_text(self, content: str) -> str:
        """Convert HTML/text payload into compact readable text."""
        if not content:
            return ""

        text = content
        if "<" in content and ">" in content:
            title = ""
            title_match = re.search(r"(?is)<title[^>]*>(.*?)</title>", content)
            if title_match:
                title = self._clean_text(
                    html.unescape(re.sub(r"(?is)<[^>]+>", " ", title_match.group(1)))
                )

            text = re.sub(
                r"(?is)<(script|style|noscript|svg|canvas)[^>]*>.*?</\1>",
                " ",
                text,
            )
            text = re.sub(r"(?is)<br\s*/?>", "\n", text)
            text = re.sub(r"(?is)</(p|div|li|h1|h2|h3|h4|h5|h6|tr)>", "\n", text)
            text = re.sub(r"(?is)<[^>]+>", " ", text)
            text = html.unescape(text)
            text = re.sub(r"\s+", " ", text).strip()

            if title and title.lower() not in text.lower():
                text = f"{title}. {text}" if text else title
            return self._clean_text(text)

        return self._clean_text(text)

    def validate_finding(self, finding: Dict[str, Any]) -> bool:
        """
        Validate that a finding has minimum required fields.

        Args:
            finding: Dict representing a finding

        Returns:
            True if valid, False otherwise
        """
        # Must have at least a title
        if not finding.get("title") and not finding.get("headline"):
            return False

        # Title/headline must have reasonable length
        title = finding.get("title") or finding.get("headline", "")
        if len(title.strip()) < 10:
            return False

        return True
