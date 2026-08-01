"""
Basic tests for MHLW COVID-19 PDF parser.

Run:
  uv run python tests/test_mhlw_covid_pdf_parser.py
"""

import asyncio

from parsers import mhlw_covid_pdf_parser
from parsers.mhlw_covid_pdf_parser import MHLWCovidPDFParser


# Allow running these tests even when pdfplumber is not installed in the env.
mhlw_covid_pdf_parser.PDFPLUMBER_AVAILABLE = True


def test_extract_pdf_candidates() -> None:
    parser = MHLWCovidPDFParser()
    content = (
        "* 2026年２月27日 新型コロナウイルス感染症（COVID-19）の発生状況［393KB］ "
        "[https://www.mhlw.go.jp/content/001662419.pdf] [Checked: 3/2/2026, 8:41:32 PM]\n"
    )

    candidates = parser._extract_pdf_candidates(content)
    assert len(candidates) == 1
    assert candidates[0]["url"] == "https://www.mhlw.go.jp/content/001662419.pdf"
    assert candidates[0]["report_date"] == "2026-02-27"


def test_total_label_and_number_parsing() -> None:
    parser = MHLWCovidPDFParser()

    assert parser._is_total_label("総 数")
    assert parser._is_total_label("総数")
    assert parser._parse_number("6,936") == 6936.0
    assert parser._parse_number("１．８３") == 1.83


def test_table_title_translation_to_english() -> None:
    parser = MHLWCovidPDFParser()

    title = "新型コロナウイルス感染症（COVID-19）定点当たり報告数・都道府県別"
    translated = parser._translate_table_title_to_english(title, page=2, table=1)
    assert translated == "COVID-19 cases per sentinel site by prefecture"


async def _run_parse_with_mocked_pdf_extraction() -> None:
    class MockedParser(MHLWCovidPDFParser):
        async def _download_pdf_bytes(self, pdf_url: str, timeout_sec: float):
            return b"%PDF-mock"

        def _extract_totals_from_tables(self, pdf_bytes: bytes):
            return [
                {
                    "page": 2,
                    "table": 1,
                    "table_title": "Table A",
                    "row": 3,
                    "column": 2,
                    "label_ja": "総数",
                    "label_en": "Total Number",
                    "value": 6936,
                },
                {
                    "page": 2,
                    "table": 1,
                    "table_title": "Table A",
                    "row": 4,
                    "column": 2,
                    "label_ja": "総数",
                    "label_en": "Total Number",
                    "value": 1.83,
                },
                {
                    "page": 3,
                    "table": 1,
                    "table_title": "Table B",
                    "row": 4,
                    "column": 2,
                    "label_ja": "総数",
                    "label_en": "Total Number",
                    "value": 5.5,
                },
            ]

    parser = MockedParser(config={"max_pdfs": 1})
    content = (
        "* 2026年２月27日 新型コロナウイルス感染症（COVID-19）の発生状況［393KB］ "
        "[https://www.mhlw.go.jp/content/001662419.pdf] [Checked: 3/2/2026, 8:41:32 PM]\n"
    )

    findings = await parser.parse(content, source_name="JAPAN_MHLW")
    assert len(findings) == 1
    assert findings[0].date == "2026-02-27"
    assert findings[0].location == "Japan"
    headline = findings[0].headline or ""
    assert "Total Number" in headline
    assert "Table A" in headline
    assert "Table B" in headline
    assert "6,936" in headline
    assert "1.83" in headline
    assert "5.5" in headline
    assert "総数" in (findings[0].raw_text or "")


def test_parse_with_mocked_pdf_extraction() -> None:
    asyncio.run(_run_parse_with_mocked_pdf_extraction())


def main() -> int:
    test_extract_pdf_candidates()
    test_total_label_and_number_parsing()
    test_table_title_translation_to_english()
    test_parse_with_mocked_pdf_extraction()
    print("✅ MHLW parser tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
