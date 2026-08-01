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

if "health_agents" not in sys.modules:
    _stub_agents = types.ModuleType("health_agents")
    _stub_agents.__path__ = [os.path.join(_project_root, "health_agents")]
    _stub_agents.__package__ = "health_agents"
    sys.modules["health_agents"] = _stub_agents

from tools.syncdetection_payload import (
    extract_last_changed,
    extract_watch_uuid,
    parse_changedetection_payload,
)

sys.modules.pop("tools", None)
sys.modules.pop("health_agents", None)


class _FakeChangeDetectionClient:
    def __init__(self, watch_data, watches_list=None):
        self.watch_data = watch_data
        self.watches_list = watches_list or {}

    async def get_watch(self, watch_uuid: str):
        return self.watch_data.get(watch_uuid)

    async def list_watches(self):
        return self.watches_list


def test_extract_watch_uuid_variants() -> None:
    assert extract_watch_uuid({"watch_uuid": "uuid-a"}) == "uuid-a"
    assert extract_watch_uuid({"uuid": "uuid-b"}) == "uuid-b"
    assert extract_watch_uuid({"watch": {"uuid": "uuid-c"}}) == "uuid-c"
    assert extract_watch_uuid({"meta": {"watch_uuid": "uuid-d"}}) == "uuid-d"


def test_extract_last_changed_variants() -> None:
    assert extract_last_changed({"last_changed": 123.4}) == 123.4
    assert extract_last_changed({"triggered_at_ts": "456"}) == 456.0
    assert extract_last_changed({"meta": {"last_changed": "789.5"}}) == 789.5
    assert extract_last_changed({}) is None


def test_parse_payload_fallback_watch_lookup() -> None:
    async def _run() -> None:
        client = _FakeChangeDetectionClient({"watch-x": {"last_changed": 101.25}})
        parsed = await parse_changedetection_payload(
            payload={"watch_uuid": "watch-x"},
            changedetection_client=client,
        )
        assert parsed.watch_uuid == "watch-x"
        assert parsed.last_changed == 101.25
        assert parsed.source == "watch_lookup"

    asyncio.run(_run())


def test_parse_payload_missing_watch_uuid_raises() -> None:
    async def _run() -> None:
        client = _FakeChangeDetectionClient({})
        try:
            await parse_changedetection_payload(
                payload={}, changedetection_client=client
            )
        except ValueError as exc:
            assert "watch_uuid" in str(exc)
            return
        assert False, "Expected ValueError for missing watch_uuid"

    asyncio.run(_run())


def test_parse_payload_resolves_watch_uuid_from_title_url() -> None:
    async def _run() -> None:
        watch_uuid = "watch-title-url"
        watch_url = "https://example.org/outbreaks"
        client = _FakeChangeDetectionClient(
            {watch_uuid: {"last_changed": 500.0}},
            watches_list={watch_uuid: {"url": watch_url}},
        )

        parsed = await parse_changedetection_payload(
            payload={
                "title": f"ChangeDetection.io Notification - {watch_url}",
                "message": "page changed",
            },
            changedetection_client=client,
        )

        assert parsed.watch_uuid == watch_uuid
        assert parsed.last_changed == 500.0
        assert parsed.source == "watch_lookup"

    asyncio.run(_run())
