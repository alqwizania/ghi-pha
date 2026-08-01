"""Tests for ECDC CDTR PDF parser."""

import asyncio

import parsers.ecdc_cdtr_pdf_parser as ecdc_module
from parsers.ecdc_cdtr_pdf_parser import ECDCCDTRPDFParser


def test_extract_pdf_candidates_from_cdtr_listing() -> None:
    parser = ECDCCDTRPDFParser()
    content = (
        "Communicable disease threats report, 21 - 27 February 2026, week 9 "
        "[https://www.ecdc.europa.eu/en/publications-data/"
        "communicable-disease-threats-report-21-27-february-2026-week-9] "
        "[Checked: 3/5/2026, 12:31:29 AM]"
    )

    candidates = parser._extract_pdf_candidates(content)

    assert len(candidates) == 1
    assert candidates[0]["url"].endswith("week-9")
    assert candidates[0]["report_date"] == "2026-02-27"


def test_parse_summarizes_executive_summary_from_pdf() -> None:
    async def _run() -> None:
        parser = ECDCCDTRPDFParser({"max_reports": 1, "summary_max_chars": 900})

        async def fake_discover_pdf_url(
            publication_url: str,
            timeout_sec: float,
        ) -> str:
            assert "communicable-disease-threats-report" in publication_url
            return "https://www.ecdc.europa.eu/sites/default/files/documents/cdtr-week-9.pdf"

        async def fake_download_pdf_bytes(
            pdf_url: str,
            timeout_sec: float,
        ) -> bytes:
            assert pdf_url.endswith("cdtr-week-9.pdf")
            return b"%PDF-sample"

        def fake_extract_pdf_text(
            pdf_bytes: bytes,
            max_pages: int,
            max_chars: int,
        ) -> tuple[str, int]:
            assert pdf_bytes.startswith(b"%PDF")
            text = (
                "Executive summary\n"
                "This issue of the CDTR covers the period 21-27 February 2026 and "
                "includes updates on influenza, mpox, cholera and Marburg virus disease.\n\n"
                "Background\n"
                "Additional section content."
            )
            return text[:max_chars], 19

        parser._discover_pdf_url = fake_discover_pdf_url  # type: ignore[method-assign]
        parser._download_pdf_bytes = fake_download_pdf_bytes  # type: ignore[method-assign]
        parser._extract_pdf_text = fake_extract_pdf_text  # type: ignore[method-assign]

        content = (
            "Communicable disease threats report, 21 - 27 February 2026, week 9 "
            "[https://www.ecdc.europa.eu/en/publications-data/"
            "communicable-disease-threats-report-21-27-february-2026-week-9] "
            "[Checked: 3/5/2026, 12:31:29 AM]"
        )

        previous_flag = ecdc_module.PDFPLUMBER_AVAILABLE
        ecdc_module.PDFPLUMBER_AVAILABLE = True
        try:
            findings = await parser.parse(content, source_name="ECDC_OUTBREAKS")
        finally:
            ecdc_module.PDFPLUMBER_AVAILABLE = previous_flag

        assert len(findings) == 1
        finding = findings[0]
        assert finding.article_url and finding.article_url.endswith("cdtr-week-9.pdf")
        assert finding.date == "2026-02-27"
        assert (
            finding.description
            and "This issue of the CDTR covers the period" in finding.description
        )
        assert (
            finding.headline
            and "This issue of the CDTR covers the period" in finding.headline
        )

    asyncio.run(_run())
