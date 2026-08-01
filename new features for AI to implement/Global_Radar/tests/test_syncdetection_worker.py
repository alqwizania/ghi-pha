import asyncio
import importlib.util
import os
import sys
import types
from types import SimpleNamespace

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

if "tools" not in sys.modules:
    _stub_tools = types.ModuleType("tools")
    _stub_tools.__path__ = [os.path.join(_project_root, "tools")]
    _stub_tools.__package__ = "tools"
    sys.modules["tools"] = _stub_tools

if "health_agents" not in sys.modules:
    _stub_agents = types.ModuleType("health_agents")
    _stub_agents.__path__ = [os.path.join(_project_root, "health_agents")]
    _stub_agents.__package__ = "health_agents"
    sys.modules["health_agents"] = _stub_agents

from health_agents.shared.models import SourceType
from tools.syncdetection_store import SyncDetectionStore

_worker_spec = importlib.util.spec_from_file_location(
    "syncdetection_worker_module",
    os.path.join(_project_root, "workflows", "syncdetection_worker.py"),
)
assert _worker_spec and _worker_spec.loader
_worker_module = importlib.util.module_from_spec(_worker_spec)
_worker_spec.loader.exec_module(_worker_module)
SyncDetectionWorker = _worker_module.SyncDetectionWorker

sys.modules.pop("tools", None)
sys.modules.pop("health_agents", None)


class _FakeWorkflow:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail

    async def scan_watch(
        self, watch_uuid: str, expected_last_changed: float | None = None
    ):
        if self.should_fail:
            raise RuntimeError("forced failure")
        return {
            "success": True,
            "watch_uuid": watch_uuid,
            "stored": 2,
            "processed_last_changed": expected_last_changed or 0.0,
        }


class _FakeChangeDetectionClient:
    def __init__(self, watches=None):
        self._watches = watches or {}

    async def list_watches(self):
        return self._watches


class _FakeRegistry:
    def __init__(self, watch_uuid: str):
        self.watch_uuid = watch_uuid

    def list_enabled(self):
        return [
            SimpleNamespace(
                type=SourceType.CHANGEDETECTION,
                enabled=True,
                watch_uuid=self.watch_uuid,
            )
        ]


async def _wait_for_status(
    store: SyncDetectionStore, event_key: str, status: str
) -> bool:
    for _ in range(100):
        event = await store.get_event(event_key)
        if event and event["status"] == status:
            return True
        await asyncio.sleep(0.05)
    return False


def test_worker_success_updates_watermark(tmp_path) -> None:
    async def _run() -> None:
        store = SyncDetectionStore(str(tmp_path / "worker-success.db"))
        await store.initialize()

        queued = await store.enqueue_event("watch-success", 200.0, payload={"x": 1})

        worker = SyncDetectionWorker(
            store=store,
            unified_scan_workflow=_FakeWorkflow(should_fail=False),
            changedetection_client=_FakeChangeDetectionClient(),
            source_registry_obj=_FakeRegistry("watch-success"),
            worker_concurrency=1,
            max_retries=1,
            retry_base_seconds=1,
            reconcile_interval_seconds=3600,
            poll_interval_seconds=0.05,
        )
        worker.start()

        try:
            done = await _wait_for_status(store, queued.event_key, "done")
            assert done is True
            watermark = await store.get_watch_watermark("watch-success")
            assert watermark == 200.0
        finally:
            await worker.stop()

    asyncio.run(_run())


def test_worker_dead_letter_after_retries(tmp_path) -> None:
    async def _run() -> None:
        store = SyncDetectionStore(str(tmp_path / "worker-dead.db"))
        await store.initialize()

        queued = await store.enqueue_event("watch-dead", 300.0, payload={"x": 1})

        worker = SyncDetectionWorker(
            store=store,
            unified_scan_workflow=_FakeWorkflow(should_fail=True),
            changedetection_client=_FakeChangeDetectionClient(),
            source_registry_obj=_FakeRegistry("watch-dead"),
            worker_concurrency=1,
            max_retries=1,
            retry_base_seconds=1,
            reconcile_interval_seconds=3600,
            poll_interval_seconds=0.05,
        )
        worker.start()

        try:
            dead = await _wait_for_status(store, queued.event_key, "dead")
            assert dead is True
            event = await store.get_event(queued.event_key)
            assert event is not None
            assert event["attempts"] == 2
        finally:
            await worker.stop()

    asyncio.run(_run())


def test_reconcile_enqueues_when_remote_is_newer(tmp_path) -> None:
    async def _run() -> None:
        watch_uuid = "watch-reconcile"
        store = SyncDetectionStore(str(tmp_path / "worker-reconcile.db"))
        await store.initialize()
        await store.upsert_watch_watermark(watch_uuid, 100.0)

        worker = SyncDetectionWorker(
            store=store,
            unified_scan_workflow=_FakeWorkflow(should_fail=False),
            changedetection_client=_FakeChangeDetectionClient(
                watches={watch_uuid: {"last_changed": 150.0}}
            ),
            source_registry_obj=_FakeRegistry(watch_uuid),
            worker_concurrency=1,
            max_retries=1,
            retry_base_seconds=1,
            reconcile_interval_seconds=3600,
            poll_interval_seconds=0.05,
        )

        result = await worker.reconcile_once()
        assert result["enqueued"] == 1

        event_key = store.make_event_key(watch_uuid, 150.0)
        event = await store.get_event(event_key)
        assert event is not None
        assert event["status"] == "pending"

    asyncio.run(_run())


def test_reconcile_skips_when_remote_not_newer(tmp_path) -> None:
    async def _run() -> None:
        watch_uuid = "watch-reconcile-skip"
        store = SyncDetectionStore(str(tmp_path / "worker-reconcile-skip.db"))
        await store.initialize()
        await store.upsert_watch_watermark(watch_uuid, 200.0)

        worker = SyncDetectionWorker(
            store=store,
            unified_scan_workflow=_FakeWorkflow(should_fail=False),
            changedetection_client=_FakeChangeDetectionClient(
                watches={watch_uuid: {"last_changed": 199.0}}
            ),
            source_registry_obj=_FakeRegistry(watch_uuid),
            worker_concurrency=1,
            max_retries=1,
            retry_base_seconds=1,
            reconcile_interval_seconds=3600,
            poll_interval_seconds=0.05,
        )

        result = await worker.reconcile_once()
        assert result["enqueued"] == 0

        event_key = store.make_event_key(watch_uuid, 199.0)
        event = await store.get_event(event_key)
        assert event is None

    asyncio.run(_run())
