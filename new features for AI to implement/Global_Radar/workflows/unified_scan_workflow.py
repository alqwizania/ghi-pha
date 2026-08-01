"""
Unified Scan Workflow for SehaRadar v1.0
Uses ChangeDetection.io + RSSHub as complementary data pipelines.

v5.0 Changes (Performance):
- Parallel watch processing: 5 CD watches concurrently via asyncio.Semaphore
- Parallel LLM analysis: 5 items analyzed concurrently within each source
- Parallel translation: 5 findings translated concurrently
- Skip unchanged watches: only process if last_changed > last_scan timestamp
- Estimated speedup: ~2 hours → ~15-20 minutes for full scan

v4.0 Changes:
- WATCH_CONFIG now loaded dynamically from source_registry
- Single source of truth for all source configuration
- Removed hardcoded watch mappings
- Phase 2: Plugin-based parser architecture

v1.0 (RSSHub integration):
- Parallel RSSHub feed fetching via rsshub_client
- RSSHubParser converts JSON Feed items -> RawFinding
- RSSHub sources follow the same analyze -> translate -> store pipeline
- source_type="rsshub" for provenance tracking

ChangeDetection.io monitors page-diff sources; RSSHub handles RSS-native feeds.
"""

import os
import asyncio
import hashlib
import re
from datetime import datetime
from typing import Optional, Dict, Any, List

from health_agents.shared.models import HealthContext
from health_agents.shared.source_registry import source_registry
from parsers import parser_registry

# Concurrency limits — tuned to avoid OpenAI rate limits while maximizing throughput
MAX_CONCURRENT_WATCHES = 3  # How many CD watches to process in parallel
MAX_CONCURRENT_LLM = 3  # How many LLM analysis calls in parallel (per source)
MAX_CONCURRENT_TRANSLATE = 2  # How many translation calls in parallel

LOW_QUALITY_HEADLINES = {
    "date title",
    "generated location generated disease",
    "international outbreaks",
    "international travel health notices",
    "travel health notices",
    "level 4 avoid all travel",
    "level 3 reconsider nonessential travel",
    "level 2 practice enhanced precautions",
    "level 1 practice usual precautions",
}

LOW_QUALITY_PREFIXES = (
    "currently there are no travel health notices",
    "destination list",
)

LOW_QUALITY_CONTAINS = (
    "generated location",
    "generated disease",
    "date title",
)

LOW_QUALITY_SUMMARY_MARKERS = (
    "there were unknown",
    "during an unspecified period",
    "location not specified",
)


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class UnifiedScanWorkflow:
    def __init__(self):
        self.last_scan: Optional[datetime] = None
        self.last_scan_timestamp: float = 0.0  # Unix timestamp for CD comparison
        self.quality_gate_enabled = (
            os.getenv("QUALITY_GATE_ENABLED", "true").lower() == "true"
        )
        self.quarantine_enabled = (
            os.getenv("QUALITY_GATE_QUARANTINE_ENABLED", "true").lower() == "true"
        )
        print("📚 Unified workflow initialized with parser registry")

    @staticmethod
    def _normalize_for_quality_gate(text: str) -> str:
        """Normalize text for deterministic quality checks."""
        lower = text.lower()
        alnum_spaced = re.sub(r"[^a-z0-9]+", " ", lower)
        return re.sub(r"\s+", " ", alnum_spaced).strip()

    def _get_parse_quality_issue(
        self, item: Dict[str, Any], source_name: str
    ) -> Optional[str]:
        """Return rejection reason when parsed item is low-signal."""
        headline = (item.get("headline") or item.get("title") or "").strip()
        if not headline:
            return "empty_headline"

        normalized = self._normalize_for_quality_gate(headline)
        if len(normalized) < 10:
            return "headline_too_short"

        if normalized in LOW_QUALITY_HEADLINES:
            return f"blocked_headline:{normalized}"

        if any(fragment in normalized for fragment in LOW_QUALITY_CONTAINS):
            return "placeholder_headline"

        if any(normalized.startswith(prefix) for prefix in LOW_QUALITY_PREFIXES):
            return "section_header"

        if source_name == "CDC_TRAVEL":
            if normalized.startswith("level ") and "travel" in normalized:
                if " in " not in normalized:
                    return "travel_level_without_specific_outbreak"
            if normalized.startswith("destination list") and "read more" in normalized:
                return "travel_destination_list_navigation"

        if source_name == "PROMED" and normalized == "date title":
            return "promed_table_header"

        return None

    def _get_analysis_quality_issue(
        self, finding: Dict[str, Any], source_name: str
    ) -> Optional[str]:
        """Return rejection reason when analyzed finding is still low-signal."""
        parse_issue = self._get_parse_quality_issue(finding, source_name)
        if parse_issue:
            return parse_issue

        disease = str(finding.get("disease", "") or "").strip().lower()
        short_desc = (
            finding.get("short_description_en")
            or finding.get("summary")
            or finding.get("description")
            or ""
        )
        short_desc_norm = self._normalize_for_quality_gate(str(short_desc))

        if disease == "news":
            marker_hits = sum(
                marker in short_desc_norm for marker in LOW_QUALITY_SUMMARY_MARKERS
            )
            if marker_hits >= 2:
                return "placeholder_summary_unknowns"

        return None

    async def _quarantine_low_quality(
        self,
        finding: Dict[str, Any],
        source_name: str,
        source_type: str,
        reason: str,
        stage: str,
        nocodb_v3: Any,
    ) -> None:
        """Persist low-quality findings into quarantine table."""
        if not self.quarantine_enabled:
            return
        if not hasattr(nocodb_v3, "create_quarantine_record"):
            return

        try:
            await nocodb_v3.create_quarantine_record(
                finding=finding,
                reason=reason,
                source=source_name,
                source_type=source_type,
                stage=stage,
            )
        except Exception as exc:
            print(
                f"    ⚠️ Could not quarantine finding from {source_name}: {exc}",
                flush=True,
            )

    async def _apply_parse_quality_gate(
        self,
        items: List[Dict[str, Any]],
        source_name: str,
        source_type: str,
        nocodb_v3: Any,
    ) -> tuple[List[Dict[str, Any]], int]:
        """Filter low-quality parsed items and quarantine rejected rows."""
        if not self.quality_gate_enabled:
            return items, 0

        approved: List[Dict[str, Any]] = []
        quarantined = 0
        for item in items:
            reason = self._get_parse_quality_issue(item, source_name)
            if not reason:
                approved.append(item)
                continue

            quarantined += 1
            await self._quarantine_low_quality(
                finding=item,
                source_name=source_name,
                source_type=source_type,
                reason=reason,
                stage="parse",
                nocodb_v3=nocodb_v3,
            )

        return approved, quarantined

    async def scan_all_sources(self) -> Dict[str, Any]:
        """
        Scan all configured sources: ChangeDetection.io watches + RSSHub feeds.

        Performance optimizations:
        - Phase A processes up to MAX_CONCURRENT_WATCHES watches in parallel
        - Skips watches that haven't changed since last scan
        - LLM analysis runs MAX_CONCURRENT_LLM items concurrently per source
        - Translation runs MAX_CONCURRENT_TRANSLATE items concurrently

        Returns:
            Summary of scan results
        """
        scan_start = datetime.now()
        print(f"\n{'=' * 80}")
        print(f"🔄 UNIFIED SCAN: ChangeDetection.io + RSSHub")
        print(
            f"⚡ Concurrency: {MAX_CONCURRENT_WATCHES} watches, {MAX_CONCURRENT_LLM} LLM, {MAX_CONCURRENT_TRANSLATE} translate"
        )
        print(f"{'=' * 80}\n", flush=True)

        from tools.changedetection_client import changedetection_client
        from tools.epi_triad_analyzer import epi_analyzer
        from tools.arabic_translator import arabic_translator
        from tools.nocodb_client import nocodb_v3
        from tools.deduplication import dedup_service

        total_items = 0
        total_analyzed = 0
        total_stored = 0
        total_duplicates = 0
        total_quarantined = 0
        total_skipped = 0
        total_disabled = 0

        # ── Phase A: ChangeDetection.io watches (parallel) ───────────────
        watches = await changedetection_client.list_watches()
        print(f"📡 Found {len(watches)} watches in ChangeDetection.io", flush=True)

        # Filter to only watches with changes since last scan
        watches_to_process: Dict[str, Dict[str, Any]] = {}
        for watch_uuid, watch_info in watches.items():
            source = source_registry.get_by_uuid(watch_uuid)
            if source and not source.enabled:
                total_disabled += 1
                continue

            last_changed = watch_info.get("last_changed", 0)
            if (
                self.last_scan_timestamp > 0
                and last_changed <= self.last_scan_timestamp
            ):
                total_skipped += 1
                continue
            watches_to_process[watch_uuid] = watch_info

        if total_skipped > 0:
            print(
                f"⏭️  Skipping {total_skipped} unchanged watches "
                f"(last scan: {self.last_scan.strftime('%H:%M') if self.last_scan else 'never'})",
                flush=True,
            )
        if total_disabled > 0:
            print(f"🚫 Skipping {total_disabled} disabled watches", flush=True)
        print(
            f"📥 Processing {len(watches_to_process)} watches with changes", flush=True
        )

        # Process watches concurrently with semaphore
        watch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_WATCHES)

        async def process_watch_with_semaphore(
            uuid: str, info: Dict[str, Any]
        ) -> Dict[str, int]:
            async with watch_semaphore:
                try:
                    return await self._process_cd_watch(
                        uuid,
                        info,
                        epi_analyzer,
                        arabic_translator,
                        nocodb_v3,
                        dedup_service,
                        changedetection_client,
                    )
                except Exception as e:
                    print(f"  ❌ Error processing watch {uuid[:8]}...: {e}")
                    return {
                        "items": 0,
                        "analyzed": 0,
                        "stored": 0,
                        "duplicates": 0,
                        "quarantined": 0,
                    }

        watch_tasks = [
            process_watch_with_semaphore(uuid, info)
            for uuid, info in watches_to_process.items()
        ]
        watch_results = await asyncio.gather(*watch_tasks, return_exceptions=True)

        for result in watch_results:
            if isinstance(result, Exception):
                print(f"  ❌ Watch task failed: {result}")
                continue
            if not isinstance(result, dict):
                continue
            total_items += result["items"]
            total_analyzed += result["analyzed"]
            total_stored += result["stored"]
            total_duplicates += result["duplicates"]
            total_quarantined += result.get("quarantined", 0)

        # ── Phase B: RSSHub feeds (already parallel internally) ──────────
        rsshub_result = await self._scan_rsshub_sources(
            epi_analyzer,
            arabic_translator,
            nocodb_v3,
            dedup_service,
        )
        total_items += rsshub_result["items"]
        total_analyzed += rsshub_result["analyzed"]
        total_stored += rsshub_result["stored"]
        total_duplicates += rsshub_result["duplicates"]
        total_quarantined += rsshub_result.get("quarantined", 0)

        self.last_scan = datetime.now()
        self.last_scan_timestamp = self.last_scan.timestamp()

        elapsed = (datetime.now() - scan_start).total_seconds()
        elapsed_min = elapsed / 60

        print(f"\n{'=' * 80}")
        print(f"✅ UNIFIED SCAN COMPLETE in {elapsed_min:.1f} minutes")
        print(
            f"   CD Watches: {len(watches_to_process)} processed, "
            f"{total_skipped} skipped (unchanged), {total_disabled} skipped (disabled)"
        )
        print(f"   RSSHub Feeds: {rsshub_result['feeds_fetched']}")
        print(f"   Items found: {total_items}")
        print(f"   Analyzed: {total_analyzed}")
        print(f"   Stored: {total_stored}")
        print(f"   Duplicates: {total_duplicates}")
        print(f"   Quarantined: {total_quarantined}")
        print(f"{'=' * 80}\n")

        return {
            "success": True,
            "sources_scanned": len(watches_to_process) + rsshub_result["feeds_fetched"],
            "cd_watches_processed": len(watches_to_process),
            "cd_watches_skipped": total_skipped,
            "cd_watches_disabled": total_disabled,
            "cd_watches_total": len(watches),
            "rsshub_feeds": rsshub_result["feeds_fetched"],
            "items_found": total_items,
            "analyzed": total_analyzed,
            "stored": total_stored,
            "duplicates": total_duplicates,
            "quarantined": total_quarantined,
            "elapsed_seconds": round(elapsed, 1),
            "timestamp": datetime.now().isoformat(),
        }

    async def scan_test(
        self,
        max_sources: int = 5,
        watch_uuids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Run a lightweight test scan on a small subset of sources.

        Default behavior picks up to ``max_sources`` sources — a mix of
        ChangeDetection.io watches and RSSHub feeds — so you can validate
        the full pipeline (parse -> analyze -> translate -> dedup -> store)
        without waiting for the entire 40+ source scan.

        If ``watch_uuids`` is provided, the scan runs only those specific
        ChangeDetection.io watches and skips RSSHub for deterministic testing.

        Args:
            max_sources: Total number of sources to process (default 5).
            watch_uuids: Optional explicit ChangeDetection.io watch UUIDs.
        """
        scan_start = datetime.now()
        print(f"\n{'=' * 80}")
        print(f"🧪 TEST SCAN: {max_sources}-source subset")
        print(f"{'=' * 80}\n", flush=True)

        from tools.changedetection_client import changedetection_client
        from tools.epi_triad_analyzer import epi_analyzer
        from tools.arabic_translator import arabic_translator
        from tools.nocodb_client import nocodb_v3
        from tools.deduplication import dedup_service

        total_items = 0
        total_analyzed = 0
        total_stored = 0
        total_duplicates = 0
        total_quarantined = 0

        selected_watch_uuids: List[str] = []
        if watch_uuids:
            seen: set[str] = set()
            for raw_uuid in watch_uuids:
                watch_uuid = raw_uuid.strip()
                if not watch_uuid or watch_uuid in seen:
                    continue
                seen.add(watch_uuid)
                selected_watch_uuids.append(watch_uuid)

        # Budget: split sources between CD and RSSHub unless specific watches are requested
        if selected_watch_uuids:
            cd_budget = len(selected_watch_uuids)
            rsshub_budget = 0
            print(
                f"🎯 Test: explicit watch list provided ({len(selected_watch_uuids)} watches)",
                flush=True,
            )
        else:
            cd_budget = max(1, max_sources - 2)  # at least 1 CD watch
            rsshub_budget = max_sources - cd_budget  # remaining goes to RSSHub

        # ── Phase A: ChangeDetection.io (limited) ────────────────────────
        watches = await changedetection_client.list_watches()
        # Pick explicit watch UUIDs if provided; otherwise pick first cd_budget
        cd_watches: Dict[str, Dict[str, Any]] = {}
        missing_watch_uuids: List[str] = []
        if selected_watch_uuids:
            for watch_uuid in selected_watch_uuids:
                watch_info = watches.get(watch_uuid)
                if watch_info:
                    cd_watches[watch_uuid] = watch_info
                else:
                    missing_watch_uuids.append(watch_uuid)
        else:
            for watch_uuid, watch_info in watches.items():
                if len(cd_watches) >= cd_budget:
                    break
                source = source_registry.get_by_uuid(watch_uuid)
                if source and source.enabled:
                    cd_watches[watch_uuid] = watch_info

        if selected_watch_uuids:
            print(
                f"📡 Test: processing {len(cd_watches)} selected CD watches "
                f"(of {len(watches)} total)",
                flush=True,
            )
            if missing_watch_uuids:
                print(
                    f"  ⚠️ {len(missing_watch_uuids)} watch UUIDs not found in ChangeDetection.io",
                    flush=True,
                )
        else:
            print(
                f"📡 Test: processing {len(cd_watches)} CD watches "
                f"(of {len(watches)} total)",
                flush=True,
            )

        watch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_WATCHES)

        async def _process_test_watch(
            uuid: str, info: Dict[str, Any]
        ) -> Dict[str, int]:
            async with watch_semaphore:
                try:
                    return await self._process_cd_watch(
                        uuid,
                        info,
                        epi_analyzer,
                        arabic_translator,
                        nocodb_v3,
                        dedup_service,
                        changedetection_client,
                    )
                except Exception as e:
                    print(f"  ❌ Error processing watch {uuid[:8]}...: {e}")
                    return {
                        "items": 0,
                        "analyzed": 0,
                        "stored": 0,
                        "duplicates": 0,
                        "quarantined": 0,
                    }

        watch_tasks = [
            _process_test_watch(uuid, info) for uuid, info in cd_watches.items()
        ]
        watch_results = await asyncio.gather(*watch_tasks, return_exceptions=True)

        for result in watch_results:
            if isinstance(result, Exception):
                print(f"  ❌ Watch task failed: {result}")
                continue
            if not isinstance(result, dict):
                continue
            total_items += result["items"]
            total_analyzed += result["analyzed"]
            total_stored += result["stored"]
            total_duplicates += result["duplicates"]
            total_quarantined += result.get("quarantined", 0)

        # ── Phase B: RSSHub (limited) ────────────────────────────────────
        rsshub_result = {
            "feeds_fetched": 0,
            "items": 0,
            "analyzed": 0,
            "stored": 0,
            "duplicates": 0,
            "quarantined": 0,
        }
        if rsshub_budget > 0:
            from tools.rsshub_client import rsshub_client
            from parsers.rsshub_parser import RSSHubParser

            route_configs = source_registry.get_rsshub_route_configs()[:rsshub_budget]
            if route_configs:
                print(
                    f"\n📡 Test: fetching {len(route_configs)} RSSHub feeds",
                    flush=True,
                )
                is_healthy = await rsshub_client.healthcheck()
                if is_healthy:
                    feeds = await rsshub_client.fetch_multiple(route_configs)
                    for source_id, feed in feeds.items():
                        if feed is None:
                            continue
                        rsshub_result["feeds_fetched"] += 1
                        source = source_registry.get(source_id)
                        source_url = source.url if source and source.url else ""
                        items = []
                        # Fewer items per feed for test runs
                        for rsshub_item in feed.items[:5]:
                            raw_finding = RSSHubParser.rsshub_item_to_raw_finding(
                                rsshub_item.model_dump(),
                                source_id,
                                source_url,
                            )
                            items.append(raw_finding.to_dict())
                        if not items:
                            continue
                        rsshub_result["items"] += len(items)
                        (
                            items,
                            parse_quarantined,
                        ) = await self._apply_parse_quality_gate(
                            items,
                            source_name=source_id,
                            source_type="rsshub",
                            nocodb_v3=nocodb_v3,
                        )
                        rsshub_result["quarantined"] += parse_quarantined
                        if not items:
                            continue
                        analyzed = await self._analyze_items(
                            items,
                            source_id,
                            source_url,
                            epi_analyzer,
                        )
                        if not analyzed:
                            continue
                        rsshub_result["analyzed"] += len(analyzed)
                        translated = await arabic_translator.batch_translate(
                            analyzed,
                            max_concurrent=MAX_CONCURRENT_TRANSLATE,
                        )
                        (
                            stored,
                            duplicates,
                            store_quarantined,
                        ) = await self._store_findings(
                            translated,
                            source_id,
                            "rsshub",
                            dedup_service,
                            nocodb_v3,
                        )
                        rsshub_result["stored"] += stored
                        rsshub_result["duplicates"] += duplicates
                        rsshub_result["quarantined"] += store_quarantined
                else:
                    print("  ⚠️ RSSHub unreachable, skipping", flush=True)

        total_items += rsshub_result["items"]
        total_analyzed += rsshub_result["analyzed"]
        total_stored += rsshub_result["stored"]
        total_duplicates += rsshub_result["duplicates"]
        total_quarantined += rsshub_result.get("quarantined", 0)

        elapsed = (datetime.now() - scan_start).total_seconds()

        print(f"\n{'=' * 80}")
        print(f"🧪 TEST SCAN COMPLETE in {elapsed:.1f}s")
        print(f"   CD Watches: {len(cd_watches)}")
        print(f"   RSSHub Feeds: {rsshub_result['feeds_fetched']}")
        print(
            f"   Items: {total_items} found, {total_analyzed} analyzed, "
            f"{total_stored} stored, {total_duplicates} dupes, "
            f"{total_quarantined} quarantined",
        )
        print(f"{'=' * 80}\n")

        return {
            "success": True,
            "test_mode": True,
            "max_sources": max_sources,
            "watch_uuids_requested": selected_watch_uuids,
            "watch_uuids_missing": missing_watch_uuids,
            "cd_watches_processed": len(cd_watches),
            "rsshub_feeds_processed": rsshub_result["feeds_fetched"],
            "items_found": total_items,
            "analyzed": total_analyzed,
            "stored": total_stored,
            "duplicates": total_duplicates,
            "quarantined": total_quarantined,
            "elapsed_seconds": round(elapsed, 1),
            "timestamp": datetime.now().isoformat(),
        }

    async def scan_watch(
        self,
        watch_uuid: str,
        expected_last_changed: float | None = None,
    ) -> Dict[str, Any]:
        """
        Process one ChangeDetection watch through the existing pipeline.

        This path is intended for event-driven processing from webhook/queue
        workers and avoids running a full scan.
        """
        from tools.changedetection_client import changedetection_client
        from tools.epi_triad_analyzer import epi_analyzer
        from tools.arabic_translator import arabic_translator
        from tools.nocodb_client import nocodb_v3
        from tools.deduplication import dedup_service
        from tools.syncdetection_store import get_syncdetection_store

        watch_info = await changedetection_client.get_watch(watch_uuid)
        if not watch_info:
            return {
                "success": False,
                "watch_uuid": watch_uuid,
                "error": "watch_not_found",
                "timestamp": datetime.now().isoformat(),
            }

        source = source_registry.get_by_uuid(watch_uuid)
        if not source:
            return {
                "success": True,
                "watch_uuid": watch_uuid,
                "skipped": True,
                "skip_reason": "unknown_watch_uuid",
                "processed_last_changed": _safe_float(
                    expected_last_changed or watch_info.get("last_changed")
                ),
                "timestamp": datetime.now().isoformat(),
            }

        if not source.enabled:
            return {
                "success": True,
                "watch_uuid": watch_uuid,
                "source": source.id,
                "skipped": True,
                "skip_reason": "source_disabled",
                "processed_last_changed": _safe_float(
                    expected_last_changed or watch_info.get("last_changed")
                ),
                "timestamp": datetime.now().isoformat(),
            }

        if expected_last_changed is not None:
            try:
                store = get_syncdetection_store()
                await store.initialize()
                watermark = await store.get_watch_watermark(watch_uuid)
                if expected_last_changed <= watermark:
                    return {
                        "success": True,
                        "watch_uuid": watch_uuid,
                        "source": source.id,
                        "skipped": True,
                        "skip_reason": "stale_event",
                        "watermark": watermark,
                        "processed_last_changed": watermark,
                        "timestamp": datetime.now().isoformat(),
                    }
            except Exception as exc:
                print(
                    f"⚠️ Could not read sync watermark for {watch_uuid[:8]}...: {exc}",
                    flush=True,
                )

        result = await self._process_cd_watch(
            watch_uuid,
            watch_info,
            epi_analyzer,
            arabic_translator,
            nocodb_v3,
            dedup_service,
            changedetection_client,
        )

        processed_last_changed = max(
            _safe_float(watch_info.get("last_changed")),
            _safe_float(expected_last_changed),
        )

        return {
            "success": True,
            "watch_uuid": watch_uuid,
            "source": source.id,
            "last_changed": _safe_float(watch_info.get("last_changed")),
            "expected_last_changed": _safe_float(expected_last_changed),
            "processed_last_changed": processed_last_changed,
            "items": result["items"],
            "analyzed": result["analyzed"],
            "stored": result["stored"],
            "duplicates": result["duplicates"],
            "quarantined": result.get("quarantined", 0),
            "skipped": False,
            "timestamp": datetime.now().isoformat(),
        }

    async def _process_cd_watch(
        self,
        watch_uuid: str,
        watch_info: Dict[str, Any],
        epi_analyzer: Any,
        arabic_translator: Any,
        nocodb_v3: Any,
        dedup_service: Any,
        changedetection_client: Any,
    ) -> Dict[str, int]:
        source = source_registry.get_by_uuid(watch_uuid)

        if not source:
            print(
                f"⚠️ Source not found for watch {watch_uuid[:8]}... skipping unknown watch",
                flush=True,
            )
            return {
                "items": 0,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": 0,
            }
        else:
            source_name = source.id
            if not source.enabled:
                print(f"  🚫 Source disabled in config: {source_name}", flush=True)
                return {
                    "items": 0,
                    "analyzed": 0,
                    "stored": 0,
                    "duplicates": 0,
                    "quarantined": 0,
                }
            parser_id = source.parser or "generic"
            source_url = source.url or watch_info.get("url", "")
            parser_config = dict(source.config or {}) if source.config else None

        print(
            f"\n📥 Processing: {source_name} ({watch_uuid[:8]}...) [Parser: {parser_id}]",
            flush=True,
        )

        content = await changedetection_client.fetch_snapshot(watch_uuid)
        if not content:
            print(f"  ⚠️ No content available for {source_name}")
            return {
                "items": 0,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": 0,
            }

        print(f"  ✅ Fetched {len(content)} chars", flush=True)

        if source_name == "PROMED":
            existing_headlines = await nocodb_v3.query_headlines_by_source(
                source=source_name,
                limit=2000,
            )
            if parser_config is None:
                parser_config = {}
            parser_config["existing_headlines"] = existing_headlines

        parser = parser_registry.get_parser_safe(parser_id, parser_config)
        raw_findings = await parser.parse(content, source_name, source_url)
        items = [finding.to_dict() for finding in raw_findings]

        if not items:
            print(f"  ℹ️ No items parsed from {source_name}")
            return {
                "items": 0,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": 0,
            }

        parsed_count = len(items)
        print(f"  ✅ Parsed {parsed_count} items", flush=True)

        items, parse_quarantined = await self._apply_parse_quality_gate(
            items,
            source_name=source_name,
            source_type="changedetection",
            nocodb_v3=nocodb_v3,
        )
        if parse_quarantined:
            print(f"  🚧 Quarantined at parse stage: {parse_quarantined}", flush=True)

        if not items:
            return {
                "items": parsed_count,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": parse_quarantined,
            }

        max_items: Optional[int] = None
        if parser_config and isinstance(parser_config.get("max_items"), int):
            configured_max_items = parser_config.get("max_items")
            if configured_max_items and configured_max_items > 0:
                max_items = configured_max_items
        if max_items is not None and len(items) > max_items:
            print(f"  ℹ️ Limiting to {max_items} items")
            items = items[:max_items]

        structured_disease_map = {
            "gtfcc_cholera": "Cholera",
            "who_mpox": "Mpox",
            "mhlw_covid_pdf": "COVID-19",
        }

        if parser_id in structured_disease_map:
            analyzed = self._build_structured_findings(
                items=items,
                source_name=source_name,
                source_url=source_url,
                disease=structured_disease_map[parser_id],
            )
        else:
            analyzed = await self._analyze_items(
                items, source_name, source_url, epi_analyzer
            )
        if not analyzed:
            return {
                "items": parsed_count,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": parse_quarantined,
            }

        print(f"  ✅ Analyzed {len(analyzed)} items", flush=True)

        if parser_id in structured_disease_map:
            translated = analyzed
            print("  ℹ️ Skipped translation for structured source", flush=True)
        else:
            translated = await arabic_translator.batch_translate(
                analyzed, max_concurrent=MAX_CONCURRENT_TRANSLATE
            )
            print(f"  ✅ Translated {len(translated)} items", flush=True)

        stored, duplicates, store_quarantined = await self._store_findings(
            translated,
            source_name,
            "changedetection",
            dedup_service,
            nocodb_v3,
        )

        total_quarantined = parse_quarantined + store_quarantined
        print(
            f"  ✅ Stored: {stored} new, {duplicates} duplicates, {total_quarantined} quarantined",
            flush=True,
        )

        await changedetection_client.mark_as_viewed(watch_uuid)

        return {
            "items": parsed_count,
            "analyzed": len(analyzed),
            "stored": stored,
            "duplicates": duplicates,
            "quarantined": total_quarantined,
        }

    async def _scan_rsshub_sources(
        self,
        epi_analyzer: Any,
        arabic_translator: Any,
        nocodb_v3: Any,
        dedup_service: Any,
    ) -> Dict[str, int]:
        from tools.rsshub_client import rsshub_client
        from parsers.rsshub_parser import RSSHubParser

        route_configs = source_registry.get_rsshub_route_configs()
        if not route_configs:
            print("ℹ️ No RSSHub sources configured, skipping")
            return {
                "feeds_fetched": 0,
                "items": 0,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": 0,
            }

        print(
            f"\n📡 RSSHub: Fetching {len(route_configs)} feeds in parallel", flush=True
        )

        is_healthy = await rsshub_client.healthcheck()
        if not is_healthy:
            print("❌ RSSHub instance unreachable, skipping RSSHub scan")
            return {
                "feeds_fetched": 0,
                "items": 0,
                "analyzed": 0,
                "stored": 0,
                "duplicates": 0,
                "quarantined": 0,
            }

        feeds = await rsshub_client.fetch_multiple(route_configs)

        total_items = 0
        total_analyzed = 0
        total_stored = 0
        total_duplicates = 0
        total_quarantined = 0
        feeds_fetched = 0

        for source_id, feed in feeds.items():
            if feed is None:
                print(f"  ⚠️ No feed returned for {source_id}")
                continue

            feeds_fetched += 1
            source = source_registry.get(source_id)
            source_url = source.url if source and source.url else ""

            print(f"\n📥 RSSHub [{source_id}]: {len(feed.items)} items", flush=True)

            items = []
            for rsshub_item in feed.items[:10]:
                raw_finding = RSSHubParser.rsshub_item_to_raw_finding(
                    rsshub_item.model_dump(),
                    source_id,
                    source_url,
                )
                items.append(raw_finding.to_dict())

            if not items:
                continue

            total_items += len(items)

            items, parse_quarantined = await self._apply_parse_quality_gate(
                items,
                source_name=source_id,
                source_type="rsshub",
                nocodb_v3=nocodb_v3,
            )
            total_quarantined += parse_quarantined
            if not items:
                continue

            analyzed = await self._analyze_items(
                items, source_id, source_url, epi_analyzer
            )
            if not analyzed:
                continue

            total_analyzed += len(analyzed)
            print(f"  ✅ Analyzed {len(analyzed)} items", flush=True)

            translated = await arabic_translator.batch_translate(
                analyzed,
                max_concurrent=MAX_CONCURRENT_TRANSLATE,
            )
            print(f"  ✅ Translated {len(translated)} items", flush=True)

            stored, duplicates, store_quarantined = await self._store_findings(
                translated,
                source_id,
                "rsshub",
                dedup_service,
                nocodb_v3,
            )

            total_stored += stored
            total_duplicates += duplicates
            total_quarantined += store_quarantined
            print(f"  ✅ Stored: {stored} new, {duplicates} duplicates", flush=True)

        print(
            f"\n📊 RSSHub scan: {feeds_fetched} feeds, {total_items} items, {total_stored} stored",
            flush=True,
        )

        return {
            "feeds_fetched": feeds_fetched,
            "items": total_items,
            "analyzed": total_analyzed,
            "stored": total_stored,
            "duplicates": total_duplicates,
            "quarantined": total_quarantined,
        }

    async def _analyze_items(
        self,
        items: List[Dict[str, Any]],
        source_name: str,
        source_url: str,
        epi_analyzer: Any,
    ) -> List[Dict[str, Any]]:
        """Analyze items with parallel LLM calls (bounded by semaphore)."""
        llm_semaphore = asyncio.Semaphore(MAX_CONCURRENT_LLM)

        async def analyze_single(
            idx: int, item: Dict[str, Any]
        ) -> Optional[Dict[str, Any]]:
            async with llm_semaphore:
                try:
                    title = item.get("title", item.get("headline", ""))[:200]
                    description = item.get("description", title)

                    analysis = await epi_analyzer.analyze_finding(
                        headline=title,
                        description=description,
                        source=source_name,
                    )

                    if analysis:
                        return {
                            "headline": title,
                            "source": source_name,
                            "source_link": source_url,
                            "url": item.get("article_url")
                            or item.get("link", "")
                            or source_url,
                            "publication_date": item.get("date", ""),
                            "location": item.get("location", ""),
                            **analysis,
                        }
                except Exception as e:
                    print(f"    ⚠️ Error analyzing item {idx + 1}: {e}")
            return None

        tasks = [analyze_single(idx, item) for idx, item in enumerate(items)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        analyzed: List[Dict[str, Any]] = []
        for result in results:
            if isinstance(result, Exception):
                print(f"    ⚠️ Analysis task failed: {result}")
                continue
            if result is not None and isinstance(result, dict):
                analyzed.append(result)
        return analyzed

    def _build_structured_findings(
        self,
        items: List[Dict[str, Any]],
        source_name: str,
        source_url: str,
        disease: str,
    ) -> List[Dict[str, Any]]:
        """Build structured findings for deterministic dashboard parsers."""
        findings: List[Dict[str, Any]] = []

        for item in items:
            headline = item.get("headline") or item.get("title", "")
            location = item.get("location", "")
            publication_date = item.get("date", "")
            description = item.get("description", headline)

            findings.append(
                {
                    "headline": headline,
                    "source": source_name,
                    "source_link": source_url,
                    "url": item.get("article_url")
                    or item.get("link", "")
                    or source_url,
                    "publication_date": publication_date,
                    "location": location,
                    "disease": disease,
                    "priority": "medium",
                    "short_description_en": description,
                    "detailed_description_en": item.get("raw_text", ""),
                    "countries": [location] if location else [],
                }
            )

        return findings

    def _build_structured_content_hash(
        self, finding: Dict[str, Any], disease: str
    ) -> str:
        """Deduplicate deterministic source rows by disease + country + date."""
        country = (finding.get("location") or "").upper().strip()
        if not country:
            country = "UNKNOWN"

        week_date = (finding.get("publication_date") or "").strip()
        if not week_date:
            week_date = datetime.now().strftime("%Y-%m-%d")

        content = f"{disease.lower()}|{country}|{week_date}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:32]

    async def _store_findings(
        self,
        findings: List[Dict[str, Any]],
        source_name: str,
        source_type: str,
        dedup_service: Any,
        nocodb_v3: Any,
    ) -> tuple[int, int, int]:
        from tools.disease_catalog import has_icon_metadata, add_discovered_disease
        from tools.epi_triad_analyzer import normalize_disease_name

        stored = 0
        duplicates = 0
        quarantined = 0
        for finding in findings:
            try:
                quality_issue = self._get_analysis_quality_issue(finding, source_name)
                if quality_issue:
                    quarantined += 1
                    await self._quarantine_low_quality(
                        finding=finding,
                        source_name=source_name,
                        source_type=source_type,
                        reason=quality_issue,
                        stage="analysis",
                        nocodb_v3=nocodb_v3,
                    )
                    continue

                structured_source_disease = {
                    "GTFCC_CHOLERA": "Cholera",
                    "WHO_MPX_API": "Mpox",
                    "JAPAN_MHLW": "COVID-19",
                }

                if source_name in structured_source_disease:
                    fixed_disease = structured_source_disease[source_name]
                    finding["disease"] = fixed_disease
                    content_hash = self._build_structured_content_hash(
                        finding,
                        disease=fixed_disease,
                    )

                    existing = await dedup_service.check_hash_exists(content_hash)
                    finding["content_hash"] = content_hash
                    finding["source_type"] = source_type
                    finding["source"] = source_name

                    if existing:
                        existing_id = existing.get("Id") or existing.get("id")
                        if existing_id is not None:
                            updated = await nocodb_v3.update_finding_v3(
                                existing_id,
                                finding,
                            )
                            if updated:
                                print(
                                    f"    ♻️ Updated existing structured finding (ID: {existing_id})"
                                )
                        duplicates += 1
                        continue

                    result = await nocodb_v3.create_finding_v3(finding)
                    if result:
                        stored += 1
                    continue

                disease = finding.get("disease", "news") or "news"

                # Normalize any "Unknown" values to the "news" sentinel
                if disease.lower() in ("unknown", "unknown disease", ""):
                    disease = "news"
                    finding["disease"] = "news"

                # Normalize disease name to canonical form (e.g. "Nipah virus" → "Nipah")
                if disease != "news":
                    normalized = normalize_disease_name(disease)
                    if normalized != disease:
                        print(
                            f"    📎 Normalized disease: '{disease}' → '{normalized}'"
                        )
                    disease = normalized
                    finding["disease"] = disease

                # Auto-catalog newly discovered diseases — assign icon, color & Arabic name
                # Uses has_icon_metadata() instead of is_known_disease() because
                # the disease may already be in diseases.json (keyword library) but
                # not yet have display metadata (icon/color) assigned.
                if disease != "news" and not has_icon_metadata(disease):
                    try:
                        await add_discovered_disease(disease)
                    except Exception as catalog_err:
                        print(
                            f"    ⚠️ Could not catalog disease '{disease}': {catalog_err}"
                        )

                dedup_result = await dedup_service.check_duplicate(
                    disease=disease,
                    headline=finding.get("headline", ""),
                    countries=finding.get("countries", []),
                )

                finding["content_hash"] = dedup_result.content_hash
                finding["source_type"] = source_type
                finding["source"] = source_name

                if dedup_result.is_duplicate:
                    duplicates += 1
                    continue

                result = await nocodb_v3.create_finding_v3(finding)
                if result:
                    stored += 1
            except Exception as e:
                print(f"    ⚠️ Error storing finding: {e}")
                continue
        return stored, duplicates, quarantined


# Global workflow instance
unified_scan_workflow = UnifiedScanWorkflow()


# =============================================================================
# SCHEDULED SCAN
# =============================================================================


async def run_scheduled_scan() -> Dict[str, Any]:
    """
    Run a scheduled scan of all ChangeDetection.io sources.

    This is called by the scheduler (e.g., every hour).

    Returns:
        Scan results
    """
    print(
        f"\n📡 Running scheduled scan at {datetime.now().strftime('%H:%M')}", flush=True
    )

    return await unified_scan_workflow.scan_all_sources()


# Export
__all__ = [
    "UnifiedScanWorkflow",
    "unified_scan_workflow",
    "run_scheduled_scan",
]
