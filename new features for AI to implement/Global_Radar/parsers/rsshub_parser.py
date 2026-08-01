"""RSSHub Parser — converts RSSHub JSON Feed items into RawFinding objects."""

import re
from typing import List, Optional
from datetime import datetime

from .base_parser import BaseParser, RawFinding


class RSSHubParser(BaseParser):
    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        """
        Parse pre-structured RSSHub JSON items passed as pipe-delimited text.

        For RSSHub sources, items are already structured by RSSHubClient.
        This parser is used when raw HTML/text content needs fallback parsing.
        Normally, the workflow converts RSSHubItem -> RawFinding directly.
        """
        findings: List[RawFinding] = []

        lines = [line.strip() for line in content.split("\n") if line.strip()]
        for line in lines:
            if len(line) < 15:
                continue

            findings.append(
                RawFinding(
                    title=self._clean_text(line[:200]),
                    description=self._clean_text(line),
                    link=source_url or "",
                    source=source_name,
                    date=datetime.now().strftime("%Y-%m-%d"),
                )
            )

        return findings

    @staticmethod
    def rsshub_item_to_raw_finding(
        item_dict: dict,
        source_name: str,
        source_url: str = "",
    ) -> RawFinding:
        """Convert an RSSHubItem (as dict) to a RawFinding for the analysis pipeline."""
        title = item_dict.get("title", "")
        description = _strip_html(item_dict.get("description", ""))
        link = item_dict.get("link", "") or source_url
        pub_date = _normalize_date(item_dict.get("pub_date", ""))

        return RawFinding(
            title=title,
            headline=title,
            description=description[:1000] if description else title,
            link=link,
            source=source_name,
            date=pub_date,
            raw_text=description,
        )


def _strip_html(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", clean).strip()


def _normalize_date(date_str: str) -> str:
    if not date_str:
        return datetime.now().strftime("%Y-%m-%d")

    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%a, %d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue

    iso_match = re.search(r"(\d{4}-\d{2}-\d{2})", date_str)
    if iso_match:
        return iso_match.group(1)

    return datetime.now().strftime("%Y-%m-%d")
