"""
Queue worker + reconciliation loops for ChangeDetection event-driven scans.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, Optional, Set

from health_agents.shared.models import SourceType
from health_agents.shared.source_registry import source_registry

from tools.syncdetection_store import SyncDetectionStore


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class SyncDetectionWorker:
    def __init__(
        self,
        store: SyncDetectionStore,
        unified_scan_workflow: Any,
        changedetection_client: Any,
        statistics_callback: Optional[Callable[[str, int], None]] = None,
        source_registry_obj: Any = source_registry,
        worker_concurrency: int = 2,
        max_retries: int = 5,
        retry_base_seconds: int = 15,
        reconcile_interval_seconds: int = 300,
        poll_interval_seconds: float = 2.0,
    ):
        self.store = store
        self.unified_scan_workflow = unified_scan_workflow
        self.changedetection_client = changedetection_client
        self.source_registry = source_registry_obj
        self.statistics_callback = statistics_callback

        self.worker_concurrency = max(1, worker_concurrency)
        self.max_retries = max(0, max_retries)
        self.retry_base_seconds = max(1, retry_base_seconds)
        self.reconcile_interval_seconds = max(30, reconcile_interval_seconds)
        self.poll_interval_seconds = max(0.2, poll_interval_seconds)

        self._stop_event = asyncio.Event()
        self._worker_task: Optional[asyncio.Task] = None
        self._reconcile_task: Optional[asyncio.Task] = None

        self._inflight_tasks: Set[asyncio.Task] = set()
        self._active_watches: Set[str] = set()

    def _inc(self, key: str, value: int = 1) -> None:
        if self.statistics_callback:
            self.statistics_callback(key, value)

    def start(self) -> None:
        if self._worker_task and not self._worker_task.done():
            return

        self._stop_event.clear()
        self._worker_task = asyncio.create_task(self.run_worker_loop())
        self._reconcile_task = asyncio.create_task(self.run_reconcile_loop())

    async def stop(self) -> None:
        self._stop_event.set()

        tasks_to_wait = [
            task for task in [self._worker_task, self._reconcile_task] if task
        ]
        for task in tasks_to_wait:
            task.cancel()

        for task in tasks_to_wait:
            try:
                await task
            except asyncio.CancelledError:
                pass

        if self._inflight_tasks:
            await asyncio.wait(self._inflight_tasks, timeout=10)

    def _attach_event_task(self, event: Dict[str, Any]) -> None:
        watch_uuid = event["watch_uuid"]
        self._active_watches.add(watch_uuid)

        task = asyncio.create_task(self._process_event(event))
        self._inflight_tasks.add(task)

        def _done(done_task: asyncio.Task, uuid: str = watch_uuid) -> None:
            self._active_watches.discard(uuid)
            self._inflight_tasks.discard(done_task)
            try:
                done_task.result()
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                print(f"❌ [syncdetection] event task crashed for {uuid[:8]}...: {exc}")

        task.add_done_callback(_done)

    async def run_worker_loop(self) -> None:
        await self.store.initialize()
        recovered = await self.store.reset_processing_events()
        if recovered:
            print(f"♻️ [syncdetection] recovered {recovered} processing event(s)")

        print("🔁 [syncdetection] queue worker started")

        while not self._stop_event.is_set():
            try:
                if len(self._inflight_tasks) >= self.worker_concurrency:
                    await asyncio.sleep(self.poll_interval_seconds)
                    continue

                event = await self.store.claim_next_event(
                    excluded_watch_uuids=self._active_watches
                )
                if not event:
                    await asyncio.sleep(self.poll_interval_seconds)
                    continue

                self._attach_event_task(event)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"❌ [syncdetection] worker loop error: {exc}")
                await asyncio.sleep(self.poll_interval_seconds)

        print("🛑 [syncdetection] queue worker stopped")

    async def _process_event(self, event: Dict[str, Any]) -> None:
        event_id = int(event["id"])
        event_key = event["event_key"]
        watch_uuid = event["watch_uuid"]
        last_changed = float(event["last_changed"])

        print(f"📨 [syncdetection:{watch_uuid[:8]}] processing {event_key}")
        try:
            result = await self.unified_scan_workflow.scan_watch(
                watch_uuid,
                expected_last_changed=last_changed,
            )

            if not result.get("success", False):
                raise RuntimeError(result.get("error", "scan_watch failed"))

            await self.store.mark_done(event_id)

            watermark = _to_float(result.get("processed_last_changed") or last_changed)
            await self.store.upsert_watch_watermark(watch_uuid, watermark)

            self._inc("cd_events_processed", 1)
            if result.get("stored"):
                self._inc("findings_stored", int(result.get("stored", 0)))

            print(f"✅ [syncdetection:{watch_uuid[:8]}] done {event_key}")
        except Exception as exc:
            failure = await self.store.mark_failed(
                event_id,
                error=str(exc),
                max_retries=self.max_retries,
                retry_base_seconds=self.retry_base_seconds,
            )
            self._inc("cd_events_failed", 1)

            if failure["status"] == "dead":
                self._inc("cd_events_dead_letter", 1)
                print(
                    f"💀 [syncdetection:{watch_uuid[:8]}] dead-letter {event_key}: {exc}"
                )
            else:
                print(
                    f"⚠️ [syncdetection:{watch_uuid[:8]}] retry {event_key} "
                    f"attempt={failure['attempts']} next={failure['next_attempt_at']} err={exc}"
                )

    async def run_reconcile_loop(self) -> None:
        print("🧭 [syncdetection] reconcile loop started")
        while not self._stop_event.is_set():
            try:
                await self.reconcile_once()
                await asyncio.wait_for(
                    self._stop_event.wait(), timeout=self.reconcile_interval_seconds
                )
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"❌ [syncdetection] reconcile loop error: {exc}")
                await asyncio.sleep(5)

        print("🛑 [syncdetection] reconcile loop stopped")

    async def reconcile_once(self) -> Dict[str, int]:
        enqueued = 0
        deduplicated = 0
        scanned = 0

        watches = await self.changedetection_client.list_watches()
        if not watches:
            return {"scanned": 0, "enqueued": 0, "deduplicated": 0}

        for source in self.source_registry.list_enabled():
            if source.type != SourceType.CHANGEDETECTION:
                continue
            if not source.watch_uuid:
                continue

            scanned += 1
            watch_uuid = source.watch_uuid
            watch_info = watches.get(watch_uuid)
            if not watch_info:
                continue

            remote_last_changed = _to_float(watch_info.get("last_changed"))
            if remote_last_changed <= 0:
                continue

            local_watermark = await self.store.get_watch_watermark(watch_uuid)
            if remote_last_changed <= local_watermark:
                continue

            result = await self.store.enqueue_event(
                watch_uuid=watch_uuid,
                last_changed=remote_last_changed,
                payload={
                    "source": "reconcile",
                    "watch_uuid": watch_uuid,
                    "last_changed": remote_last_changed,
                },
            )
            if result.deduplicated:
                deduplicated += 1
                self._inc("cd_events_deduplicated", 1)
            else:
                enqueued += 1
                self._inc("cd_reconcile_enqueued", 1)
                self._inc("cd_events_queued", 1)

        if enqueued:
            print(f"🧭 [syncdetection] reconcile enqueued {enqueued} event(s)")

        return {
            "scanned": scanned,
            "enqueued": enqueued,
            "deduplicated": deduplicated,
        }
