import asyncio
import os
import sys
import types

_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

if "tools" not in sys.modules:
    _stub_tools = types.ModuleType("tools")
    _stub_tools.__path__ = [os.path.join(_project_root, "tools")]
    _stub_tools.__package__ = "tools"
    sys.modules["tools"] = _stub_tools

from tools.syncdetection_store import SyncDetectionStore

sys.modules.pop("tools", None)


def test_queue_idempotency(tmp_path) -> None:
    async def _run() -> None:
        store = SyncDetectionStore(str(tmp_path / "syncdetection.db"))
        await store.initialize()

        first = await store.enqueue_event(
            watch_uuid="watch-1",
            last_changed=100.0,
            payload={"x": 1},
        )
        second = await store.enqueue_event(
            watch_uuid="watch-1",
            last_changed=100.0,
            payload={"x": 2},
        )

        assert first.queued is True
        assert first.deduplicated is False
        assert second.queued is False
        assert second.deduplicated is True
        assert first.event_key == second.event_key

        counts = await store.get_status_counts()
        assert counts["pending"] == 1

    asyncio.run(_run())
