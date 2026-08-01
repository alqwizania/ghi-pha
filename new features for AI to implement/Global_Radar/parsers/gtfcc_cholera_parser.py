"""
GTFCC Cholera Parser.

Parses ChangeDetection snapshots for the GTFCC cholera trends watch where the
snapshot body is JSON in the shape:

{
  "features": [
    {"attributes": {"adm0_nm": "AFGHANISTAN", ...}}
  ]
}

Produces one RawFinding per country with a deterministic, human-friendly
headline that includes weekly and cumulative metrics.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .base_parser import BaseParser, RawFinding


class GTFCCCholeraParser(BaseParser):
    """Parser for the GTFCC global cholera trends JSON snapshot."""

    @staticmethod
    def _safe_int(value: Any) -> int:
        if value is None:
            return 0
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _safe_float(value: Any) -> float:
        if value is None:
            return 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _to_week_date(date_wk: Any) -> str:
        """Convert epoch milliseconds to YYYY-MM-DD."""
        try:
            timestamp_ms = int(float(date_wk))
            dt = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
            return dt.strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            return datetime.now(timezone.utc).strftime("%Y-%m-%d")

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
            print(f"⚠️ GTFCC parser JSON decode failed: {exc}")
            return findings

        features = payload.get("features")
        if not isinstance(features, list):
            return findings

        for feature in features:
            if not isinstance(feature, dict):
                continue
            attributes = feature.get("attributes", {})
            if not isinstance(attributes, dict):
                continue

            country_raw = str(attributes.get("adm0_nm", "")).strip()
            if not country_raw:
                continue

            country = self._format_country(country_raw)
            weekly_cases = self._safe_int(attributes.get("cas_1wk"))
            weekly_deaths = self._safe_int(attributes.get("dth_1wk"))
            cumulative_cases = self._safe_int(attributes.get("cum_cas"))
            cumulative_deaths = self._safe_int(attributes.get("cum_dth"))
            cumulative_cfr = self._safe_float(attributes.get("cfr_cum"))
            week_date = self._to_week_date(attributes.get("date_wk"))

            weekly_cases_text = self._format_int(weekly_cases)
            weekly_deaths_text = self._format_int(weekly_deaths)
            cumulative_cases_text = self._format_int(cumulative_cases)
            cumulative_deaths_text = self._format_int(cumulative_deaths)

            headline = (
                f"Country: {country} | "
                f"Weekly cases: {weekly_cases_text} | "
                f"Weekly deaths: {weekly_deaths_text} | "
                f"Cumulative cases: {cumulative_cases_text} | "
                f"Cumulative deaths: {cumulative_deaths_text} | "
                f"Cumulative CFR: {cumulative_cfr:.4f} | "
                f"Week date: {week_date}"
            )

            description = (
                f"Weekly cholera update for {country} on {week_date}: "
                f"{weekly_cases_text} weekly cases, {weekly_deaths_text} weekly deaths, "
                f"{cumulative_cases_text} cumulative cases, {cumulative_deaths_text} cumulative deaths, "
                f"cumulative CFR {cumulative_cfr:.4f}."
            )

            findings.append(
                RawFinding(
                    title=headline,
                    headline=headline,
                    description=description,
                    date=week_date,
                    location=country,
                    link=source_url,
                    article_url=None,
                    source=source_name,
                    raw_text=json.dumps(attributes, ensure_ascii=True),
                )
            )

        print(f"📄 GTFCC Parser: Extracted {len(findings)} country findings")
        return findings
