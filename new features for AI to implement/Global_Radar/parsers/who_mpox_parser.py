"""
WHO Mpox API Parser.

Parses ChangeDetection snapshots for the WHO MPX API where the snapshot body is
JSON in the shape:

{
  "value": [
    {
      "COUNTRY": "Lithuania",
      "DATE": "2022-08-24",
      "NEW_CONF_CASES": 0,
      ...
    }
  ]
}

This parser emits one RawFinding per row that has new activity.
"""

import json
from typing import Any, Dict, List, Optional

from .base_parser import BaseParser, RawFinding


class WHOMpoxParser(BaseParser):
    """Parser for WHO Mpox API JSON snapshots."""

    @staticmethod
    def _safe_int(value: Any) -> int:
        if value is None:
            return 0
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _format_country(country: str) -> str:
        return " ".join(country.strip().split()).title()

    @staticmethod
    def _format_int(value: int) -> str:
        return f"{value:,}"

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        findings: List[RawFinding] = []

        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            print(f"⚠️ WHO Mpox parser JSON decode failed: {exc}")
            return findings

        rows = payload.get("value")
        if not isinstance(rows, list):
            return findings

        active_rows: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue

            new_conf_cases = self._safe_int(row.get("NEW_CONF_CASES"))
            new_conf_deaths = self._safe_int(row.get("NEW_CONF_DEATHS"))
            new_prob_cases = self._safe_int(row.get("NEW_PROB_CASES"))

            if new_conf_cases <= 0 and new_conf_deaths <= 0 and new_prob_cases <= 0:
                continue

            active_rows.append(row)

        active_rows.sort(
            key=lambda x: (
                str(x.get("DATE") or ""),
                str(x.get("COUNTRY") or ""),
            ),
            reverse=True,
        )

        for row in active_rows:
            country_raw = str(row.get("COUNTRY", "")).strip()
            date_text = str(row.get("DATE", "")).strip()

            if not country_raw or not date_text:
                continue

            country = self._format_country(country_raw)
            iso3 = str(row.get("ISO3", "")).strip().upper()
            who_region = str(row.get("WHO_REGION", "")).strip().upper()

            new_conf_cases = self._safe_int(row.get("NEW_CONF_CASES"))
            new_conf_deaths = self._safe_int(row.get("NEW_CONF_DEATHS"))
            new_prob_cases = self._safe_int(row.get("NEW_PROB_CASES"))
            total_conf_cases = self._safe_int(row.get("TOTAL_CONF_CASES"))
            total_conf_deaths = self._safe_int(row.get("TOTAL_CONF_DEATHS"))
            total_prob_cases = self._safe_int(row.get("TOTAL_PROB_CASES"))

            headline = (
                f"Country: {country} | "
                f"New confirmed cases: {self._format_int(new_conf_cases)} | "
                f"New confirmed deaths: {self._format_int(new_conf_deaths)} | "
                f"New probable cases: {self._format_int(new_prob_cases)} | "
                f"Total confirmed cases: {self._format_int(total_conf_cases)} | "
                f"Total confirmed deaths: {self._format_int(total_conf_deaths)} | "
                f"Total probable cases: {self._format_int(total_prob_cases)} | "
                f"WHO region: {who_region or 'N/A'} | "
                f"Date: {date_text}"
            )

            summary = (
                f"Mpox daily update for {country} on {date_text}: "
                f"{self._format_int(new_conf_cases)} new confirmed cases, "
                f"{self._format_int(new_conf_deaths)} new confirmed deaths, "
                f"{self._format_int(new_prob_cases)} new probable cases; "
                f"cumulative totals are {self._format_int(total_conf_cases)} confirmed cases, "
                f"{self._format_int(total_conf_deaths)} confirmed deaths, and "
                f"{self._format_int(total_prob_cases)} probable cases."
            )

            if iso3:
                summary = f"{summary} ISO3: {iso3}."

            findings.append(
                RawFinding(
                    title=headline,
                    headline=headline,
                    description=summary,
                    date=date_text,
                    location=country,
                    link=source_url,
                    article_url=None,
                    source=source_name,
                    raw_text=json.dumps(row, ensure_ascii=True),
                )
            )

        print(f"📄 WHO Mpox Parser: Extracted {len(findings)} active country findings")
        return findings
