"""URL enrichment tests for ProMED parser."""

import asyncio

from parsers.promed_parser import ProMEDParser


def test_promed_direct_url_fetch_enriches_description() -> None:
    async def _run() -> None:
        parser = ProMEDParser(
            {
                "fetch_article_content": True,
                "resolve_links": False,
                "max_article_fetches": 2,
            }
        )

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            assert url == "https://example.com/promed-direct"
            return (
                "ProMED update: 18 suspected anthrax cases were identified in rural "
                "districts and veterinary containment was initiated."
            )

        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        content = (
            "Anthrax outbreak alert in northern pastoral districts "
            "[https://example.com/promed-direct] "
            "[Checked: 3/5/2026, 12:00:00 AM]"
        )

        findings = await parser.parse(content, source_name="PROMED")

        assert len(findings) == 1
        assert findings[0].article_url == "https://example.com/promed-direct"
        assert (findings[0].description or "").startswith("ProMED update")
        assert "18 suspected anthrax cases" in (findings[0].raw_text or "")

    asyncio.run(_run())


def test_promed_resolved_url_fetch_enriches_description() -> None:
    async def _run() -> None:
        parser = ProMEDParser(
            {
                "fetch_article_content": True,
                "resolve_links": True,
                "max_unlocks": 1,
                "max_article_fetches": 2,
            }
        )

        title = "Marburg cluster investigation update from cross-border response team"

        async def fake_resolve(unresolved_items, base_url):
            assert unresolved_items
            assert unresolved_items[0]["title"] == title
            return {title: "https://example.com/promed-resolved"}

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            assert url == "https://example.com/promed-resolved"
            return (
                "Field report: cross-border teams confirmed five additional marburg "
                "cases and expanded contact tracing operations."
            )

        parser._resolve_with_node = fake_resolve  # type: ignore[method-assign]
        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        findings = await parser.parse(title, source_name="PROMED")

        assert len(findings) == 1
        assert findings[0].article_url == "https://example.com/promed-resolved"
        assert (findings[0].description or "").startswith("Field report")
        assert "five additional marburg cases" in (findings[0].raw_text or "")

    asyncio.run(_run())
