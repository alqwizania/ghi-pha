"""
MHLW COVID-19 PDF Parser.

Parses ChangeDetection snapshots for Japan MHLW COVID-19 weekly report links,
downloads PDF files, and extracts totals from table cells labeled "総数".

Outputs one RawFinding per PDF with extracted totals embedded in ``raw_text``
as structured JSON.
"""

from __future__ import annotations

import io
import importlib
import importlib.util
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from .base_parser import BaseParser, RawFinding

PDFPLUMBER_AVAILABLE = importlib.util.find_spec("pdfplumber") is not None
if not PDFPLUMBER_AVAILABLE:
    print("⚠️ pdfplumber not available - MHLW PDF parser disabled")


class MHLWCovidPDFParser(BaseParser):
    """Parser for MHLW COVID-19 weekly report PDFs."""

    PDF_URL_PATTERN = re.compile(r"https?://[^\s\]]+\.pdf", re.IGNORECASE)
    DATE_PATTERN = re.compile(
        r"(?P<year>[0-9０-９]{4})\s*年\s*(?P<month>[0-9０-９]{1,2})\s*月\s*(?P<day>[0-9０-９]{1,2})\s*日"
    )
    NUMBER_PATTERN = re.compile(r"[+-]?[0-9０-９][0-9０-９,，\.．]*")

    _DIGIT_TRANSLATION = str.maketrans(
        "０１２３４５６７８９，．",
        "0123456789,.",
    )
    _TITLE_EXCLUDE_FRAGMENTS = (
        "区分",
        "報告数",
        "定点当たり",
        "#REF",
        "期間",
        "総数",
    )

    def _normalize_digits(self, text: str) -> str:
        if not text:
            return ""
        return text.translate(self._DIGIT_TRANSLATION)

    def _normalize_label(self, text: str) -> str:
        if not text:
            return ""
        normalized = self._normalize_digits(text)
        # Remove all spaces (including full-width) for robust matching.
        normalized = normalized.replace(" ", "").replace("\u3000", "")
        return normalized

    def _is_total_label(self, text: str) -> bool:
        return self._normalize_label(text).startswith("総数")

    def _parse_number(self, text: str) -> Optional[float]:
        if not text:
            return None

        raw = self._normalize_digits(text)
        raw = raw.replace(",", "").strip()

        # Keep one leading sign and decimal point if present.
        if raw.count(".") > 1:
            return None

        try:
            return float(raw)
        except ValueError:
            return None

    def _format_number(self, value: float) -> float | int:
        # Preserve integers as int for cleaner downstream JSON.
        if float(value).is_integer():
            return int(value)
        return round(value, 4)

    def _format_number_for_headline(self, value: float | int) -> str:
        if isinstance(value, int):
            return f"{value:,}"

        if float(value).is_integer():
            return f"{int(value):,}"

        return f"{value:.4f}".rstrip("0").rstrip(".")

    def _looks_like_table_title(self, text: str) -> bool:
        clean = self._clean_text(text)
        if not clean or len(clean) < 6:
            return False

        if clean.startswith("※"):
            return False

        for fragment in self._TITLE_EXCLUDE_FRAGMENTS:
            if fragment in clean and len(clean) <= 16:
                return False

        if re.fullmatch(r"[0-9０-９\s\-～/\.,()（）]+", clean):
            return False

        return True

    def _extract_table_title_from_rows(
        self,
        table_rows: List[List[str]],
        page_idx: int,
        table_idx: int,
    ) -> str:
        for row in table_rows[:3]:
            if not isinstance(row, list):
                continue
            cells = [self._clean_text(cell or "") for cell in row]
            cells = [cell for cell in cells if cell]
            if not cells:
                continue

            combined = " ".join(cells)
            if self._looks_like_table_title(combined):
                return combined[:120]

            for cell in cells:
                if self._looks_like_table_title(cell):
                    return cell[:120]

        return f"Page {page_idx} Table {table_idx}"

    def _extract_table_title_from_page_lines(
        self,
        page_lines: List[Dict[str, Any]],
        table_top: float,
        table_rows: List[List[str]],
        page_idx: int,
        table_idx: int,
    ) -> str:
        candidates: List[tuple[float, str]] = []

        for line in page_lines:
            text = self._clean_text(str(line.get("text", "")))
            if not self._looks_like_table_title(text):
                continue

            bottom = line.get("bottom")
            if not isinstance(bottom, (int, float)):
                continue

            # Prefer lines close above the table (likely section heading).
            if table_top - 140 <= float(bottom) <= table_top - 2:
                distance = table_top - float(bottom)
                candidates.append((distance, text))

        if candidates:
            candidates.sort(key=lambda item: item[0])
            return candidates[0][1][:120]

        return self._extract_table_title_from_rows(table_rows, page_idx, table_idx)

    def _build_headline_sections(self, totals: List[Dict[str, Any]]) -> List[str]:
        grouped: Dict[tuple[int, int, str], List[str]] = {}

        for item in totals:
            page = int(item.get("page", 0))
            table = int(item.get("table", 0))
            table_title = self._clean_text(str(item.get("table_title", "")))
            key = (page, table, table_title)

            values = grouped.setdefault(key, [])
            values.append(self._format_number_for_headline(item["value"]))

        sections: List[str] = []
        for (page, table, title), values in grouped.items():
            title_text = self._translate_table_title_to_english(title, page, table)
            sections.append(f"{title_text} | Total Number: {', '.join(values)}")

        return sections

    def _translate_table_title_to_english(
        self,
        title: str,
        page: int,
        table: int,
    ) -> str:
        clean_title = self._clean_text(title)
        if clean_title and clean_title.isascii():
            return clean_title

        normalized = self._normalize_label(clean_title)

        if "年代別推移" in normalized:
            return "COVID-19 cases per sentinel site trend by age group"
        if "年代別" in normalized and "報告数" in normalized:
            return "COVID-19 cases per sentinel site by age group"
        if "都道府県別" in normalized:
            return "COVID-19 cases per sentinel site by prefecture"
        if "報告数推移" in normalized:
            return "COVID-19 cases per sentinel site trend by prefecture"
        if "入院患者" in normalized and "概況" in normalized:
            return "COVID-19 hospital admissions overview"
        if "入院患者" in normalized and "推移" in normalized:
            return "COVID-19 hospital admissions trend"

        return f"COVID-19 data table (Page {page}, Table {table})"

    def _extract_report_date(self, text: str) -> Optional[str]:
        match = self.DATE_PATTERN.search(text)
        if not match:
            return None

        try:
            year = int(self._normalize_digits(match.group("year")))
            month = int(self._normalize_digits(match.group("month")))
            day = int(self._normalize_digits(match.group("day")))
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            return None

    def _extract_pdf_candidates(self, content: str) -> List[Dict[str, str]]:
        candidates: List[Dict[str, str]] = []
        seen_urls: set[str] = set()

        for line in content.splitlines():
            clean_line, article_url = self.preprocess_line(line)
            line_text = self._clean_text(clean_line)

            urls: List[str] = []
            if article_url and article_url.lower().endswith(".pdf"):
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
                        "report_date": self._extract_report_date(line_text) or "",
                    }
                )

        # Newest reports first when date is present.
        candidates.sort(key=lambda item: item.get("report_date", ""), reverse=True)
        return candidates

    def _find_row_value(self, row: List[str], total_idx: int) -> Optional[float]:
        # Prefer numbers to the right of the "総数" label.
        search_order = list(range(total_idx + 1, len(row))) + list(
            range(total_idx - 1, -1, -1)
        )

        for idx in search_order:
            cell = row[idx]
            if not cell:
                continue

            matches = self.NUMBER_PATTERN.findall(cell)
            if not matches:
                continue

            # Use the last numeric token in the cell (often the value).
            number = self._parse_number(matches[-1])
            if number is not None:
                return number

        return None

    def _extract_totals_from_tables(self, pdf_bytes: bytes) -> List[Dict[str, Any]]:
        totals: List[Dict[str, Any]] = []
        seen_keys: set[tuple[Any, ...]] = set()

        if not PDFPLUMBER_AVAILABLE:
            return totals

        pdfplumber = importlib.import_module("pdfplumber")

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page_idx, page in enumerate(pdf.pages, start=1):
                table_objects = page.find_tables() or []
                page_lines = page.extract_text_lines() or []

                for table_idx, table_obj in enumerate(table_objects, start=1):
                    table = table_obj.extract() or []
                    if not isinstance(table, list):
                        continue

                    table_top = float(table_obj.bbox[1]) if table_obj.bbox else 0.0
                    table_title = self._extract_table_title_from_page_lines(
                        page_lines=page_lines,
                        table_top=table_top,
                        table_rows=table,
                        page_idx=page_idx,
                        table_idx=table_idx,
                    )

                    for row_idx, row in enumerate(table, start=1):
                        if not isinstance(row, list):
                            continue

                        normalized_row = [self._clean_text(cell or "") for cell in row]
                        if not any(normalized_row):
                            continue

                        for col_idx, cell in enumerate(normalized_row, start=1):
                            if not self._is_total_label(cell):
                                continue

                            value = self._find_row_value(normalized_row, col_idx - 1)
                            if value is None:
                                continue

                            result_value = self._format_number(value)
                            dedup_key = (
                                page_idx,
                                table_idx,
                                row_idx,
                                col_idx,
                                result_value,
                            )
                            if dedup_key in seen_keys:
                                continue
                            seen_keys.add(dedup_key)

                            totals.append(
                                {
                                    "page": page_idx,
                                    "table": table_idx,
                                    "table_title": table_title,
                                    "row": row_idx,
                                    "column": col_idx,
                                    "label_ja": cell,
                                    "label_en": "Total Number",
                                    "value": result_value,
                                }
                            )

        return totals

    async def _download_pdf_bytes(
        self, pdf_url: str, timeout_sec: float
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
            print(f"⚠️ MHLW parser failed to download PDF {pdf_url}: {exc}")
            return None

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        findings: List[RawFinding] = []

        if not PDFPLUMBER_AVAILABLE:
            return findings

        if not content:
            return findings

        candidates = self._extract_pdf_candidates(content)
        if not candidates:
            print("📄 MHLW PDF Parser: No PDF links found in snapshot")
            return findings

        max_pdfs = int(self.config.get("max_pdfs", 1))
        max_pdfs = max(1, max_pdfs)
        timeout_sec = float(self.config.get("request_timeout_sec", 45))

        for candidate in candidates[:max_pdfs]:
            pdf_url = candidate["url"]
            report_date = candidate.get("report_date") or datetime.utcnow().strftime(
                "%Y-%m-%d"
            )

            pdf_bytes = await self._download_pdf_bytes(pdf_url, timeout_sec=timeout_sec)
            if not pdf_bytes:
                continue

            totals = self._extract_totals_from_tables(pdf_bytes)
            if not totals:
                print(f"📄 MHLW PDF Parser: No '総数' totals extracted from {pdf_url}")
                continue

            payload = {
                "report_date": report_date,
                "pdf_url": pdf_url,
                "totals": totals,
            }

            finding_count = len(totals)
            sections = self._build_headline_sections(totals)
            headline = (
                f"Japan COVID-19 weekly report {report_date}: {' | '.join(sections)}"
            )

            findings.append(
                RawFinding(
                    title=headline,
                    headline=headline,
                    description=(
                        f"Extracted {finding_count} table values labeled Total Number "
                        f"from MHLW report dated {report_date}."
                    ),
                    date=report_date,
                    location="Japan",
                    link=pdf_url,
                    article_url=pdf_url,
                    source=source_name,
                    raw_text=json.dumps(payload, ensure_ascii=False),
                )
            )

        print(
            f"📄 MHLW PDF Parser: Processed {min(len(candidates), max_pdfs)} PDF(s), "
            f"produced {len(findings)} finding(s)"
        )
        return findings
