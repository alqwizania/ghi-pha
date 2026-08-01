"""URL enrichment tests for Generic and CDC parsers."""

import asyncio

from parsers.cdc_parser import CDCParser
from parsers.generic_parser import GenericParser


def test_generic_parser_fetches_detected_article_url() -> None:
    async def _run() -> None:
        parser = GenericParser(
            {
                "fetch_article_content": True,
                "max_article_fetches": 3,
            }
        )

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            assert url == "https://example.com/outbreak-1"
            return (
                "Outbreak bulletin: 42 cholera cases were reported in coastal districts "
                "and response teams were deployed."
            )

        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        content = (
            "Cholera alert in coastal districts "
            "[https://example.com/outbreak-1] "
            "[Checked: 3/5/2026, 12:00:00 AM]"
        )

        findings = await parser.parse(content, source_name="GENERIC_TEST")

        assert len(findings) == 1
        assert findings[0].article_url == "https://example.com/outbreak-1"
        assert findings[0].description.startswith("Outbreak bulletin")
        assert "42 cholera cases" in (findings[0].raw_text or "")

    asyncio.run(_run())


def test_generic_parser_respects_fetch_disable_flag() -> None:
    async def _run() -> None:
        parser = GenericParser(
            {
                "fetch_article_content": False,
            }
        )

        called = False

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            nonlocal called
            called = True
            return "should not be used"

        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        content = (
            "Nipah update with source URL for verification "
            "[https://example.com/nipah] [Checked: 3/5/2026, 12:00:00 AM]"
        )

        findings = await parser.parse(content, source_name="GENERIC_TEST")

        assert len(findings) == 1
        assert called is False
        assert findings[0].description.startswith("Nipah update")

    asyncio.run(_run())


def test_cdc_parser_fetches_detected_article_url() -> None:
    async def _run() -> None:
        parser = CDCParser(
            {
                "fetch_article_content": True,
                "max_article_fetches": 2,
            }
        )

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            assert url == "https://example.com/cdc-story"
            return (
                "CDC report: A multistate salmonella outbreak linked to cucumbers "
                "has sickened 71 people across 19 states."
            )

        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        content = (
            "Salmonella outbreak update in the United States "
            "[https://example.com/cdc-story] "
            "[Checked: 3/5/2026, 12:00:00 AM]"
        )

        findings = await parser.parse(content, source_name="CDC")

        assert len(findings) == 1
        assert findings[0].article_url == "https://example.com/cdc-story"
        assert findings[0].description.startswith("CDC report")
        assert "71 people" in (findings[0].raw_text or "")

    asyncio.run(_run())


def test_cdc_parser_caches_same_url_once() -> None:
    async def _run() -> None:
        parser = CDCParser(
            {
                "fetch_article_content": True,
                "max_article_fetches": 5,
            }
        )

        call_count = 0

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            nonlocal call_count
            call_count += 1
            return "Detailed outbreak page text for cache test. " * 4

        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        content = (
            "First CDC line with shared URL [https://example.com/shared] "
            "[Checked: 3/5/2026, 12:00:00 AM]\n"
            "Second CDC line with same URL [https://example.com/shared] "
            "[Checked: 3/5/2026, 12:00:00 AM]"
        )

        findings = await parser.parse(content, source_name="CDC")

        assert len(findings) == 2
        assert call_count == 1
        assert findings[0].description.startswith("Detailed outbreak page text")
        assert findings[1].description.startswith("Detailed outbreak page text")

    asyncio.run(_run())
