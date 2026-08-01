"""
Basic tests for WHO parser strict + fallback behavior.

Run:
  uv run python tests/test_who_parser.py
"""

import asyncio

from parsers.who_parser import WHOParser


def test_pipe_format_parses_as_before() -> None:
    async def _run() -> None:
        parser = WHOParser({"fetch_article_content": False})
        content = (
            "14 February 2026 | Mpox - Democratic Republic of the Congo "
            "[https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON595] "
            "[Checked: 3/4/2026, 3:50:19 AM]\n"
            "6 February 2026 | Nipah virus infection - Bangladesh "
            "[https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON594] "
            "[Checked: 3/4/2026, 3:50:19 AM]"
        )

        findings = await parser.parse(content, source_name="WHO")

        assert len(findings) == 2
        assert findings[0].date == "14 February 2026"
        assert findings[0].location == "Democratic Republic of the Congo"
        assert findings[1].date == "6 February 2026"
        assert findings[1].location == "Bangladesh"

    asyncio.run(_run())


def test_fallback_parses_date_title_pairs_without_separator() -> None:
    async def _run() -> None:
        parser = WHOParser({"fetch_article_content": False})
        content = (
            "1 March 2024\n"
            "Tonga becomes first Pacific island country to apply WHO toolkit "
            "[https://www.who.int/westernpacific/newsroom/feature-stories/item/tonga] "
            "[Checked: 3/4/2026, 8:44:08 PM]\n"
            "28 February 2024 News release\n"
            "Severe dzud in Mongolia hinders access to health care "
            "[https://www.who.int/mongolia/news/detail/28-02-2024-severe-dzud] "
            "[Checked: 3/4/2026, 8:44:08 PM]"
        )

        findings = await parser.parse(content, source_name="WHO_WPRO")

        assert len(findings) == 2
        assert findings[0].date == "1 March 2024"
        assert findings[1].date == "28 February 2024"
        assert (
            findings[0].article_url
            == "https://www.who.int/westernpacific/newsroom/feature-stories/item/tonga"
        )
        assert (
            findings[1].article_url
            == "https://www.who.int/mongolia/news/detail/28-02-2024-severe-dzud"
        )

    asyncio.run(_run())


def test_fallback_skips_navigation_like_lines() -> None:
    async def _run() -> None:
        parser = WHOParser({"fetch_article_content": False})
        content = (
            "Current emergencies > "
            "[https://www.who.int/europe/emergencies/situations] "
            "[Checked: 3/4/2026, 8:44:08 PM]\n"
            "Mpox (monkeypox) "
            "[https://www.who.int/europe/emergencies/situations/monkeypox] "
            "[Checked: 3/4/2026, 8:44:08 PM]"
        )

        findings = await parser.parse(content, source_name="WHO_EURO")

        assert len(findings) == 1
        assert findings[0].title == "Mpox (monkeypox)"

    asyncio.run(_run())


def test_fallback_extracts_date_embedded_in_title() -> None:
    async def _run() -> None:
        parser = WHOParser({"fetch_article_content": False})
        content = (
            "COVID-19 epidemiological update – 12 March 2025 "
            "[https://www.who.int/publications/m/item/covid-19-epidemiological-update-edition-177] "
            "[Checked: 3/4/2026, 8:43:40 PM]"
        )

        findings = await parser.parse(content, source_name="WHO_COVID_SITREP")

        assert len(findings) == 1
        assert findings[0].date == "12 March 2025"

    asyncio.run(_run())


def main() -> int:
    test_pipe_format_parses_as_before()
    test_fallback_parses_date_title_pairs_without_separator()
    test_fallback_skips_navigation_like_lines()
    test_fallback_extracts_date_embedded_in_title()
    test_pipe_format_fetches_article_content_when_enabled()
    print("✅ WHO parser tests passed")
    return 0


def test_pipe_format_fetches_article_content_when_enabled() -> None:
    async def _run() -> None:
        parser = WHOParser({"fetch_article_content": True, "max_article_fetches": 2})

        async def fake_fetch(
            url: str,
            timeout_sec: float = 12.0,
            max_chars: int = 6000,
            client=None,
        ) -> str:
            assert url == "https://example.com/who-article"
            return (
                "WHO bulletin: authorities reported 29 new cholera cases in coastal "
                "districts and activated rapid response teams."
            )

        parser.fetch_url_text = fake_fetch  # type: ignore[method-assign]

        content = (
            "14 February 2026 | Cholera - Exampleland "
            "[https://example.com/who-article] "
            "[Checked: 3/5/2026, 12:00:00 AM]"
        )

        findings = await parser.parse(content, source_name="WHO")

        assert len(findings) == 1
        assert findings[0].article_url == "https://example.com/who-article"
        assert (findings[0].description or "").startswith("WHO bulletin")
        assert "29 new cholera cases" in (findings[0].raw_text or "")

    asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())
