"""
WHO AFRO document parser.

Parses ChangeDetection snapshots for WHO AFRO PDF links, downloads documents,
extracts readable text from the first pages, and emits one RawFinding per PDF.
"""

from __future__ import annotations

import io
import importlib
import importlib.util
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx

from .base_parser import BaseParser, RawFinding

PDFPLUMBER_AVAILABLE = importlib.util.find_spec("pdfplumber") is not None
if not PDFPLUMBER_AVAILABLE:
    print("⚠️ pdfplumber not available - WHO AFRO document extraction limited")


class WHOAFRODocumentParser(BaseParser):
    """Parser for WHO AFRO document links surfaced in page snapshots."""

    PDF_URL_PATTERN = re.compile(
        r"https?://[^\s\]]+\.pdf(?:\?[^\s\]]*)?", re.IGNORECASE
    )
    ISO_DATE_PATTERN = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
    TEXT_DATE_PATTERN = re.compile(
        r"\b(\d{1,2}\s+"
        r"(?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)"
        r"\s+\d{4})\b",
        re.IGNORECASE,
    )

    def _extract_report_date(self, text: str) -> Optional[str]:
        if not text:
            return None

        iso_match = self.ISO_DATE_PATTERN.search(text)
        if iso_match:
            return iso_match.group(1)

        text_match = self.TEXT_DATE_PATTERN.search(text)
        if not text_match:
            return None

        try:
            parsed = datetime.strptime(text_match.group(1), "%d %B %Y")
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            return None

    def _title_from_line(self, line_text: str, url: str) -> str:
        cleaned = self._clean_text(re.sub(r"^[-*\s]+", "", line_text or ""))
        if cleaned:
            return cleaned

        filename = url.rsplit("/", 1)[-1].split("?", 1)[0]
        return filename or "WHO AFRO document"

    def _extract_pdf_candidates(self, content: str) -> List[Dict[str, str]]:
        candidates: List[Dict[str, str]] = []
        seen_urls: set[str] = set()

        for line in content.splitlines():
            clean_line, article_url = self.preprocess_line(line)
            line_text = self._clean_text(clean_line)

            urls: List[str] = []
            if article_url and ".pdf" in article_url.lower():
                urls.append(article_url)

            urls.extend(self.PDF_URL_PATTERN.findall(line))

            for url in urls:
                normalized_url = url.strip()
                if not normalized_url or normalized_url in seen_urls:
                    continue

                seen_urls.add(normalized_url)
                candidates.append(
                    {
                        "url": normalized_url,
                        "line_text": line_text,
                        "title": self._title_from_line(line_text, normalized_url),
                        "report_date": self._extract_report_date(line_text) or "",
                    }
                )

        candidates.sort(key=lambda item: item.get("report_date", ""), reverse=True)
        return candidates

    async def _download_pdf_bytes(
        self,
        pdf_url: str,
        timeout_sec: float,
    ) -> Optional[bytes]:
        timeout = httpx.Timeout(timeout_sec)
        headers = {
            "User-Agent": "SehaRadar/1.0 (+https://seha-radar.fayaa92.sa)",
        }

        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
            ) as client:
                response = await client.get(pdf_url, headers=headers)
                response.raise_for_status()
                return response.content
        except Exception as exc:
            print(f"⚠️ WHO AFRO parser failed to download PDF {pdf_url}: {exc}")
            return None

    def _extract_pdf_text(
        self,
        pdf_bytes: bytes,
        max_pages: int,
        max_chars: int,
    ) -> Tuple[str, int]:
        if not PDFPLUMBER_AVAILABLE:
            return "", 0

        pdfplumber = importlib.import_module("pdfplumber")
        segments: List[str] = []

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total_pages = len(pdf.pages)
            for page in pdf.pages[:max_pages]:
                page_text = self._clean_text(page.extract_text() or "")
                if page_text:
                    segments.append(page_text)

        combined = "\n\n".join(segments).strip()
        return combined[:max_chars], total_pages

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        findings: List[RawFinding] = []
        if not content:
            return findings

        candidates = self._extract_pdf_candidates(content)
        if not candidates:
            print("📄 WHO AFRO Parser: No PDF links found in snapshot")
            return findings

        max_pdfs = max(1, int(self.config.get("max_pdfs", 3)))
        timeout_sec = float(self.config.get("request_timeout_sec", 45))
        extract_pages = max(1, int(self.config.get("extract_pages", 2)))
        extract_max_chars = max(600, int(self.config.get("extract_max_chars", 5000)))

        for candidate in candidates[:max_pdfs]:
            pdf_url = candidate["url"]
            pdf_bytes = await self._download_pdf_bytes(pdf_url, timeout_sec=timeout_sec)
            if not pdf_bytes:
                continue

            extracted_text = ""
            total_pages = 0
            if PDFPLUMBER_AVAILABLE:
                try:
                    extracted_text, total_pages = self._extract_pdf_text(
                        pdf_bytes=pdf_bytes,
                        max_pages=extract_pages,
                        max_chars=extract_max_chars,
                    )
                except Exception as exc:
                    print(f"⚠️ WHO AFRO parser failed to parse PDF {pdf_url}: {exc}")

            title = candidate.get("title") or "WHO AFRO document"
            report_date = candidate.get("report_date") or None
            description = (
                extracted_text[:900]
                if extracted_text
                else f"WHO AFRO document detected: {title}"
            )

            payload: Dict[str, Any] = {
                "document_title": title,
                "report_date": report_date,
                "pdf_url": pdf_url,
                "source_line": candidate.get("line_text", ""),
                "total_pages": total_pages,
                "document_excerpt": extracted_text,
            }

            findings.append(
                RawFinding(
                    title=title,
                    headline=title,
                    description=description,
                    date=report_date,
                    location="Africa",
                    link=pdf_url or source_url,
                    article_url=pdf_url,
                    source=source_name,
                    raw_text=json.dumps(payload, ensure_ascii=False),
                )
            )

        print(
            f"📄 WHO AFRO Parser: Processed {min(len(candidates), max_pdfs)} PDF(s), "
            f"produced {len(findings)} finding(s)"
        )
        return findings
