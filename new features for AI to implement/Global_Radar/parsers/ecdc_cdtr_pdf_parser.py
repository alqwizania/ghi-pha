"""
ECDC CDTR PDF parser.

Parses ChangeDetection snapshots for ECDC Communicable Disease Threats Report
publication links, resolves PDF download links, extracts text from the report
PDF, and summarizes the Executive summary section.
"""

from __future__ import annotations

import io
import importlib
import importlib.util
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

import httpx

from .base_parser import BaseParser, RawFinding

PDFPLUMBER_AVAILABLE = importlib.util.find_spec("pdfplumber") is not None
if not PDFPLUMBER_AVAILABLE:
    print("⚠️ pdfplumber not available - ECDC CDTR PDF parser disabled")


class ECDCCDTRPDFParser(BaseParser):
    """Parser for ECDC Communicable Disease Threats Report PDFs."""

    CDTR_TITLE_PATTERN = re.compile(
        r"communicable disease threats report", re.IGNORECASE
    )
    CDTR_URL_FRAGMENT = "communicable-disease-threats-report"
    PDF_URL_PATTERN = re.compile(
        r"https?://[^\s\]>'\"\)]+\.pdf(?:\?[^\s\]>'\"\)]*)?",
        re.IGNORECASE,
    )
    RELATIVE_PDF_HREF_PATTERN = re.compile(
        r"href\s*=\s*['\"]([^'\"]+\.pdf(?:\?[^'\"]*)?)['\"]",
        re.IGNORECASE,
    )
    DATE_PATTERN = re.compile(
        r"\b(\d{1,2}\s+"
        r"(?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)"
        r"\s+\d{4})\b",
        re.IGNORECASE,
    )
    EXECUTIVE_SUMMARY_PATTERN = re.compile(r"\bexecutive\s+summary\b", re.IGNORECASE)
    CDTR_SENTENCE_PATTERN = re.compile(
        r"(This issue of the CDTR[^\.]*\.)",
        re.IGNORECASE,
    )
    SECTION_BREAK_PATTERN = re.compile(
        r"(?im)^\s*(?:\d+\.|"
        r"background|introduction|event background|threat assessment|"
        r"public health response|epidemiological update|annex|references)\b"
    )

    def _extract_report_date(self, text: str) -> Optional[str]:
        if not text:
            return None

        matches = self.DATE_PATTERN.findall(text)
        if not matches:
            return None

        # Use the right-most full date (often report end date in ranges).
        candidate = matches[-1]
        try:
            parsed = datetime.strptime(candidate, "%d %B %Y")
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            return None

    def _extract_pdf_candidates(self, content: str) -> List[Dict[str, str]]:
        candidates: List[Dict[str, str]] = []
        seen_urls: set[str] = set()

        for line in content.splitlines():
            clean_line, article_url = self.preprocess_line(line)
            title = self._clean_text(clean_line)
            if not title:
                continue

            urls: List[str] = []
            if article_url:
                urls.append(article_url)
            urls.extend(self.extract_urls(line))

            for url in urls:
                normalized_url = url.strip()
                if not normalized_url or normalized_url in seen_urls:
                    continue

                lower_url = normalized_url.lower()
                is_pdf = ".pdf" in lower_url
                is_cdtr_url = self.CDTR_URL_FRAGMENT in lower_url
                is_cdtr_title = bool(self.CDTR_TITLE_PATTERN.search(title))

                if not (is_pdf or is_cdtr_url or is_cdtr_title):
                    continue

                if ".zip" in lower_url:
                    continue

                seen_urls.add(normalized_url)
                candidates.append(
                    {
                        "title": title,
                        "url": normalized_url,
                        "report_date": self._extract_report_date(title) or "",
                    }
                )

        candidates.sort(key=lambda item: item.get("report_date", ""), reverse=True)
        return candidates

    async def _download_text(
        self,
        url: str,
        timeout_sec: float,
    ) -> Optional[str]:
        timeout = httpx.Timeout(timeout_sec)
        headers = {
            "User-Agent": "SehaRadar/1.0 (+https://seha-radar.fayaa92.sa)",
            "Accept": "text/html, text/plain, */*",
        }

        try:
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=True
            ) as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.text
        except Exception as exc:
            print(f"⚠️ ECDC CDTR parser failed to download text {url}: {exc}")
            return None

    async def _discover_pdf_url(
        self,
        publication_url: str,
        timeout_sec: float,
    ) -> Optional[str]:
        lower_url = publication_url.lower()
        if ".pdf" in lower_url:
            return publication_url

        html = await self._download_text(publication_url, timeout_sec=timeout_sec)
        if not html:
            return None

        for pdf_url in self.PDF_URL_PATTERN.findall(html):
            if self.CDTR_URL_FRAGMENT in pdf_url.lower():
                return pdf_url.strip()

        for pdf_url in self.PDF_URL_PATTERN.findall(html):
            return pdf_url.strip()

        for rel_href in self.RELATIVE_PDF_HREF_PATTERN.findall(html):
            resolved = urljoin(publication_url, rel_href.strip())
            if ".pdf" in resolved.lower():
                return resolved

        return None

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
                timeout=timeout, follow_redirects=True
            ) as client:
                response = await client.get(pdf_url, headers=headers)
                response.raise_for_status()
                return response.content
        except Exception as exc:
            print(f"⚠️ ECDC CDTR parser failed to download PDF {pdf_url}: {exc}")
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
                page_text = page.extract_text() or ""
                page_text = page_text.replace("\x00", "").strip()
                if page_text:
                    segments.append(page_text)

        combined = "\n\n".join(segments)
        combined = re.sub(r"[ \t]+", " ", combined)
        combined = re.sub(r"\n{3,}", "\n\n", combined).strip()
        return combined[:max_chars], total_pages

    def _extract_executive_summary(
        self,
        text: str,
        max_chars: int,
    ) -> str:
        if not text:
            return ""

        working_text = text.replace("\r", "\n")

        match = self.EXECUTIVE_SUMMARY_PATTERN.search(working_text)
        if match:
            tail = working_text[match.end() :].strip()
            if tail:
                section_break = self.SECTION_BREAK_PATTERN.search(tail)
                if section_break and section_break.start() > 120:
                    tail = tail[: section_break.start()]
                summary = self._clean_text(tail)
                if summary:
                    return summary[:max_chars]

        sentence_match = self.CDTR_SENTENCE_PATTERN.search(working_text)
        if sentence_match:
            sentence = self._clean_text(sentence_match.group(1))
            if sentence:
                return sentence[:max_chars]

        paragraphs = [
            self._clean_text(chunk)
            for chunk in re.split(r"\n\s*\n", working_text)
            if self._clean_text(chunk)
        ]
        for paragraph in paragraphs:
            lower = paragraph.lower()
            if "cdtr" in lower or "communicable disease threats report" in lower:
                return paragraph[:max_chars]

        return self._clean_text(working_text)[:max_chars]

    @staticmethod
    def _first_sentence(text: str, max_chars: int) -> str:
        if not text:
            return ""

        sentence_match = re.search(r"(.+?[.!?])(?:\s|$)", text)
        if sentence_match:
            sentence = sentence_match.group(1).strip()
        else:
            sentence = text.strip()
        return sentence[:max_chars]

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        findings: List[RawFinding] = []
        if not content:
            return findings

        if not PDFPLUMBER_AVAILABLE:
            return findings

        candidates = self._extract_pdf_candidates(content)
        if not candidates:
            print("📄 ECDC CDTR Parser: No candidate links found in snapshot")
            return findings

        max_reports = max(1, int(self.config.get("max_reports", 1)))
        timeout_sec = float(self.config.get("request_timeout_sec", 45))
        extract_pages = max(1, int(self.config.get("extract_pages", 3)))
        extract_max_chars = max(1200, int(self.config.get("extract_max_chars", 12000)))
        summary_max_chars = max(320, int(self.config.get("summary_max_chars", 1200)))

        for candidate in candidates[:max_reports]:
            publication_url = candidate["url"]
            title = candidate.get("title") or "ECDC Communicable disease threats report"
            report_date = candidate.get("report_date") or None

            pdf_url = await self._discover_pdf_url(
                publication_url, timeout_sec=timeout_sec
            )
            if not pdf_url:
                print(f"⚠️ ECDC CDTR parser could not find PDF for {publication_url}")
                continue

            pdf_bytes = await self._download_pdf_bytes(pdf_url, timeout_sec=timeout_sec)
            if not pdf_bytes:
                continue

            try:
                extracted_text, total_pages = self._extract_pdf_text(
                    pdf_bytes=pdf_bytes,
                    max_pages=extract_pages,
                    max_chars=extract_max_chars,
                )
            except Exception as exc:
                print(f"⚠️ ECDC CDTR parser failed to parse PDF {pdf_url}: {exc}")
                continue

            executive_summary = self._extract_executive_summary(
                extracted_text,
                max_chars=summary_max_chars,
            )
            if not executive_summary:
                executive_summary = f"CDTR publication detected for {title}."

            summary_sentence = self._first_sentence(executive_summary, max_chars=220)
            headline = f"{title}: {summary_sentence}" if summary_sentence else title

            payload: Dict[str, Any] = {
                "report_title": title,
                "report_date": report_date,
                "publication_url": publication_url,
                "pdf_url": pdf_url,
                "total_pages": total_pages,
                "executive_summary": executive_summary,
                "pdf_excerpt": extracted_text[:4000],
            }

            findings.append(
                RawFinding(
                    title=title,
                    headline=headline,
                    description=executive_summary,
                    date=report_date,
                    location="Europe (EU/EEA)",
                    link=pdf_url,
                    article_url=pdf_url,
                    source=source_name,
                    raw_text=json.dumps(payload, ensure_ascii=False),
                )
            )

        print(
            f"📄 ECDC CDTR Parser: Processed {min(len(candidates), max_reports)} "
            f"candidate(s), produced {len(findings)} finding(s)"
        )
        return findings
