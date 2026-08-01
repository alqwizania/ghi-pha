"""
ProMED Parser - Title extraction with Playwright link resolution.

This parser is designed for ProMED snapshots where ChangeDetection.io captures
headline text, but does not provide item-level outbound links.

Flow:
1. Extract candidate titles from snapshot text
2. Drop titles already stored in NocoDB (passed via config.existing_headlines)
3. Resolve up to ``max_unlocks`` titles using ``promed.js`` batch mode
4. Use one authenticated ProMED account from env (no account creation fallback)
5. Return only findings that have an item-level resolved URL

If ``resolve_links`` is disabled, the parser runs in title-only mode and returns
new titles using the source URL as fallback link.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from typing import Any, Dict, List, Optional

import httpx

from .base_parser import BaseParser, RawFinding


class ProMEDParser(BaseParser):
    """ProMED parser that resolves item links via Node/Playwright.

    Optional config keys:
        - fetch_article_content: Follow detected article URLs (default: true)
        - max_article_fetches: Max URL fetches per parse call (default: 8)
        - article_fetch_timeout_sec: HTTP timeout for URL fetch (default: 12)
        - article_fetch_max_chars: Max article text chars kept (default: 6000)
    """

    _SKIP_PHRASES = (
        "date             title",
        "sign up",
        "login",
        "read full article",
        "subscribe",
        "privacy policy",
        "terms",
        "home",
        "menu",
        "search",
    )

    async def parse(
        self,
        content: str,
        source_name: str,
        source_url: Optional[str] = None,
    ) -> List[RawFinding]:
        """Parse ProMED snapshot and resolve links for new titles only."""
        if not content:
            return []

        fetch_enabled_raw = self.config.get("fetch_article_content", True)
        fetch_enabled = (
            fetch_enabled_raw.lower() == "true"
            if isinstance(fetch_enabled_raw, str)
            else bool(fetch_enabled_raw)
        )
        try:
            max_fetches = int(self.config.get("max_article_fetches", 8))
        except (TypeError, ValueError):
            max_fetches = 8
        max_fetches = max(0, max_fetches)
        try:
            timeout_sec = float(self.config.get("article_fetch_timeout_sec", 12))
        except (TypeError, ValueError):
            timeout_sec = 12.0
        try:
            max_chars = int(self.config.get("article_fetch_max_chars", 6000))
        except (TypeError, ValueError):
            max_chars = 6000

        fetch_state: Dict[str, Any] = {
            "enabled": fetch_enabled,
            "max_fetches": max_fetches,
            "timeout_sec": timeout_sec,
            "max_chars": max_chars,
            "fetched": 0,
            "cache": {},
        }

        http_client: Optional[httpx.AsyncClient] = None
        if fetch_enabled and max_fetches > 0:
            timeout = httpx.Timeout(timeout_sec)
            http_client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)

        try:
            extracted = self._extract_titles(content)
            if not extracted:
                print("📄 ProMED Parser: No candidate titles extracted")
                return []

            existing_headlines = {
                self._normalize_title(v)
                for v in self.config.get("existing_headlines", [])
                if isinstance(v, str)
            }

            only_new_titles = bool(self.config.get("only_new_titles", True))
            if only_new_titles and existing_headlines:
                extracted = [
                    item
                    for item in extracted
                    if self._normalize_title(item["title"]) not in existing_headlines
                ]

            if not extracted:
                print("📄 ProMED Parser: No new titles to resolve")
                return []

            # Keep direct URLs when available (rare for ProMED snapshots).
            findings: List[RawFinding] = []
            unresolved: List[Dict[str, Any]] = []
            for item in extracted:
                article_url = item.get("article_url")
                if article_url:
                    description, fetched_text = await self._enrich_from_url(
                        article_url=article_url,
                        fallback_description=item["title"],
                        fetch_state=fetch_state,
                        http_client=http_client,
                    )
                    findings.append(
                        RawFinding(
                            title=item["title"],
                            headline=item["title"],
                            description=description,
                            date=None,
                            location=None,
                            link=article_url,
                            article_url=article_url,
                            source=source_name,
                            raw_text=(
                                f"{item['raw_text']}\n\n{fetched_text[:3000]}"
                                if fetched_text
                                else item["raw_text"]
                            ),
                        )
                    )
                else:
                    unresolved.append(item)

            if not unresolved:
                print(
                    f"📄 ProMED Parser: Returning {len(findings)} direct-link findings"
                )
                return findings

            max_unlocks = max(1, int(self.config.get("max_unlocks", 5)))
            resolve_links = bool(self.config.get("resolve_links", True))
            if not resolve_links:
                fallback_url = source_url or "https://www.promedmail.org/"
                for item in unresolved:
                    findings.append(
                        RawFinding(
                            title=item["title"],
                            headline=item["title"],
                            description=item["title"],
                            date=None,
                            location=None,
                            link=fallback_url,
                            article_url=item.get("article_url") or None,
                            source=source_name,
                            raw_text=item["raw_text"],
                        )
                    )
                print(
                    "⚠️ ProMED Parser: resolve_links disabled, "
                    f"title-only mode returning {len(findings)} findings"
                )
                return findings

            to_resolve = unresolved[:max_unlocks]
            title_to_link = await self._resolve_with_node(
                to_resolve,
                source_url or "https://www.promedmail.org/",
            )

            for item in to_resolve:
                resolved = title_to_link.get(item["title"])
                if not resolved:
                    continue
                description, fetched_text = await self._enrich_from_url(
                    article_url=resolved,
                    fallback_description=item["title"],
                    fetch_state=fetch_state,
                    http_client=http_client,
                )
                findings.append(
                    RawFinding(
                        title=item["title"],
                        headline=item["title"],
                        description=description,
                        date=None,
                        location=None,
                        link=resolved,
                        article_url=resolved,
                        source=source_name,
                        raw_text=(
                            f"{item['raw_text']}\n\n{fetched_text[:3000]}"
                            if fetched_text
                            else item["raw_text"]
                        ),
                    )
                )

            print(
                "📄 ProMED Parser: "
                f"{len(extracted)} new titles, {len(to_resolve)} attempted, {len(findings)} resolved"
            )
            return findings
        finally:
            if http_client is not None:
                await http_client.aclose()

    def _extract_titles(self, content: str) -> List[Dict[str, Any]]:
        """Extract and deduplicate title lines from snapshot content."""
        lines = content.strip().split("\n")
        candidates: List[Dict[str, Any]] = []
        seen: set[str] = set()

        for line in lines[:300]:
            clean_line, article_url = self.preprocess_line(line)
            title = self._clean_text(clean_line)

            if not article_url:
                detected_urls = self.extract_urls(line)
                if detected_urls:
                    article_url = max(detected_urls, key=len)

            if not self._looks_like_title(title):
                continue

            normalized = self._normalize_title(title)
            if normalized in seen:
                continue

            seen.add(normalized)
            candidates.append(
                {
                    "title": title,
                    "raw_text": line.strip(),
                    "article_url": article_url or "",
                    "row_number": len(candidates) + 1,
                }
            )

        return candidates

    async def _enrich_from_url(
        self,
        article_url: Optional[str],
        fallback_description: str,
        fetch_state: Dict[str, Any],
        http_client: Optional[httpx.AsyncClient],
    ) -> tuple[str, Optional[str]]:
        """Fetch article content when a title has resolved URL."""
        if not article_url or not fetch_state.get("enabled"):
            return fallback_description, None

        cache: Dict[str, str] = fetch_state["cache"]
        if article_url in cache:
            cached = cache[article_url]
            return (cached[:900], cached) if cached else (fallback_description, None)

        if fetch_state["fetched"] >= fetch_state["max_fetches"]:
            return fallback_description, None

        article_text = await self.fetch_url_text(
            article_url,
            timeout_sec=fetch_state["timeout_sec"],
            max_chars=fetch_state["max_chars"],
            client=http_client,
        )
        fetch_state["fetched"] += 1
        cache[article_url] = article_text or ""

        if not article_text:
            return fallback_description, None

        snippet = article_text[:900]
        if len(snippet) < 80:
            return fallback_description, article_text

        return snippet, article_text

    def _looks_like_title(self, text: str) -> bool:
        """Heuristic filter for ProMED title lines."""
        if not text or len(text) < 20:
            return False

        lowered = text.lower()
        if any(phrase in lowered for phrase in self._SKIP_PHRASES):
            return False

        # ProMED item lines are often long and mostly uppercase disease/location text.
        # Keep permissive to avoid missing multilingual entries.
        return True

    @staticmethod
    def _normalize_title(title: str) -> str:
        """Normalize title for comparison and deduping."""
        return " ".join(title.strip().lower().split())

    async def _resolve_with_node(
        self,
        unresolved_items: List[Dict[str, Any]],
        base_url: str,
    ) -> Dict[str, str]:
        """Resolve ProMED titles to external article links via promed.js."""
        if not unresolved_items:
            return {}

        node_command = str(self.config.get("node_command", "node"))
        resolver_script = str(self.config.get("resolver_script", "promed.js"))
        timeout_seconds = float(self.config.get("resolver_timeout_sec", 240))
        headless = bool(self.config.get("headless", True))

        promed_email = os.getenv("PROMED_EMAIL", "").strip()
        promed_password = os.getenv("PROMED_PASSWORD", "").strip()

        if not promed_email or not promed_password:
            print(
                "❌ ProMED credentials are required. "
                "Set PROMED_EMAIL and PROMED_PASSWORD in .env"
            )
            return {}

        targets: List[Dict[str, Any]] = []
        for idx, item in enumerate(unresolved_items):
            title = str(item.get("title", "")).strip()
            if not title:
                continue

            raw_row_number = item.get("row_number", idx + 1)
            row_number = raw_row_number if isinstance(raw_row_number, int) else idx + 1
            if row_number < 1:
                row_number = idx + 1

            targets.append(
                {
                    "title": title,
                    "row_number": row_number,
                }
            )

        if not targets:
            return {}

        payload: Dict[str, Any] = {
            "titles": [target["title"] for target in targets],
            "targets": targets,
            "base_url": base_url,
            "headless": headless,
            "email": promed_email,
            "password": promed_password,
        }
        print(f"  🔑 ProMED credentials loaded ({promed_email[:4]}...)")

        temp_path = ""
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, encoding="utf-8"
            ) as temp_file:
                json.dump(payload, temp_file, ensure_ascii=False)
                temp_path = temp_file.name

            process = await asyncio.create_subprocess_exec(
                node_command,
                resolver_script,
                "--resolve-batch",
                temp_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout_b, stderr_b = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout_seconds,
            )

            stdout_text = stdout_b.decode("utf-8", errors="ignore")
            stderr_text = stderr_b.decode("utf-8", errors="ignore")

            if process.returncode != 0:
                print(
                    "❌ ProMED resolver failed: "
                    f"exit={process.returncode}, stderr={stderr_text[:800]}"
                )
                return {}

            payload_json = self._extract_json_payload(stdout_text)
            if payload_json is None:
                print("❌ ProMED resolver output did not include JSON payload marker")
                return {}

            resolved_map: Dict[str, str] = {}
            for entry in payload_json.get("resolved", []):
                title = entry.get("title")
                url = entry.get("url")
                if (
                    isinstance(title, str)
                    and isinstance(url, str)
                    and url.startswith("http")
                ):
                    resolved_map[title] = url

            return resolved_map

        except asyncio.TimeoutError:
            print(f"❌ ProMED resolver timeout after {timeout_seconds} seconds")
            return {}
        except Exception as exc:
            print(f"❌ ProMED resolver execution error: {exc}")
            return {}
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    @staticmethod
    def _extract_json_payload(stdout_text: str) -> Optional[Dict[str, Any]]:
        """Read JSON payload from script output marker."""
        marker = "PROMED_RESOLVE_JSON:"
        for line in stdout_text.splitlines():
            if not line.startswith(marker):
                continue
            raw = line[len(marker) :].strip()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                return None
            if isinstance(payload, dict):
                return payload
        return None
