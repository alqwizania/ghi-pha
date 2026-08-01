"""
Basic tests for WHO AFRO document parser.

Run:
  uv run python tests/test_who_afro_document_parser.py
"""

import asyncio
import json

from parsers import who_afro_document_parser
from parsers.who_afro_document_parser import WHOAFRODocumentParser


# Allow tests to run in environments without pdfplumber.
who_afro_document_parser.PDFPLUMBER_AVAILABLE = True


def test_extract_pdf_candidates() -> None:
    parser = WHOAFRODocumentParser()
    content = (
        "10 February 2026 Cholera situation update "
        "[https://example.org/reports/cholera-update.pdf] "
        "[Checked: 3/4/2026, 9:25:38 PM]\n"
    )

    candidates = parser._extract_pdf_candidates(content)
    assert len(candidates) == 1
    assert candidates[0]["url"] == "https://example.org/reports/cholera-update.pdf"
    assert candidates[0]["report_date"] == "2026-02-10"
    assert candidates[0]["title"].startswith("10 February 2026 Cholera")


async def _run_parse_with_mocked_pdf_extraction() -> None:
    class MockedParser(WHOAFRODocumentParser):
        async def _download_pdf_bytes(self, pdf_url: str, timeout_sec: float):
            return b"%PDF-mock"

        def _extract_pdf_text(self, pdf_bytes: bytes, max_pages: int, max_chars: int):
            return (
                "Marburg outbreak response guidance for regional operations.",
                12,
            )

    parser = MockedParser(config={"max_pdfs": 1})
    content = (
        "Standard Operating Procedures for AFRO SHOC "
        "[http://who.insomnation.com/sites/default/files/pdf/9789290232803.pdf] "
        "[Checked: 3/4/2026, 9:25:38 PM]\n"
    )

    findings = await parser.parse(content, source_name="WHO_AFRO")
    assert len(findings) == 1

    finding = findings[0]
    assert finding.location == "Africa"
    assert finding.article_url == (
        "http://who.insomnation.com/sites/default/files/pdf/9789290232803.pdf"
    )
    assert "Marburg outbreak response" in (finding.description or "")

    payload = json.loads(finding.raw_text or "{}")
    assert payload.get("total_pages") == 12
    assert payload.get("pdf_url", "").endswith("9789290232803.pdf")


def test_parse_with_mocked_pdf_extraction() -> None:
    asyncio.run(_run_parse_with_mocked_pdf_extraction())


def main() -> int:
    test_extract_pdf_candidates()
    test_parse_with_mocked_pdf_extraction()
    print("✅ WHO AFRO document parser tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
