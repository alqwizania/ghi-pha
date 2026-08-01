import asyncio
from typing import Any, cast

import httpx

import server


KNOWN_WATCH_UUID = "4125358c-e214-432b-a534-417be9664cca"


async def _post_webhook(path: str, payload: dict, headers: dict | None = None):
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(path, json=payload, headers=headers)


def _reset_sync_stats() -> None:
    for key in (
        "cd_webhooks_received",
        "cd_webhooks_rejected",
        "cd_events_queued",
        "cd_events_deduplicated",
    ):
        server.statistics[key] = 0


def test_webhook_auth_failure_returns_401(tmp_path, monkeypatch) -> None:
    async def _run() -> None:
        monkeypatch.setenv("SYNCDETECTION_ENABLED", "true")
        monkeypatch.setenv("CHANGEDETECTION_WEBHOOK_TOKEN", "test-token")
        monkeypatch.setenv("SYNCDETECTION_DB_PATH", str(tmp_path / "api-auth-fail.db"))

        server.syncdetection_store = None
        _reset_sync_stats()

        response = await _post_webhook(
            "/webhook/changedetection",
            payload={"watch_uuid": KNOWN_WATCH_UUID, "last_changed": 12345.0},
        )

        assert response.status_code == 401
        assert server.statistics["cd_webhooks_received"] == 1
        assert server.statistics["cd_webhooks_rejected"] == 1

    asyncio.run(_run())


def test_webhook_success_queues_event(tmp_path, monkeypatch) -> None:
    async def _run() -> None:
        monkeypatch.setenv("SYNCDETECTION_ENABLED", "true")
        monkeypatch.setenv("CHANGEDETECTION_WEBHOOK_TOKEN", "test-token")
        monkeypatch.setenv("SYNCDETECTION_DB_PATH", str(tmp_path / "api-success.db"))

        server.syncdetection_store = None
        _reset_sync_stats()

        response = await _post_webhook(
            "/webhook/changedetection",
            payload={"watch_uuid": KNOWN_WATCH_UUID, "last_changed": 22345.0},
            headers={"X-Webhook-Token": "test-token"},
        )

        assert response.status_code == 202
        body = response.json()
        assert body["accepted"] is True
        assert body["queued"] is True
        assert body["deduplicated"] is False

        store = cast(Any, server.syncdetection_store)
        assert store is not None
        event = await store.get_event(body["event_key"])
        assert event is not None
        assert event["watch_uuid"] == KNOWN_WATCH_UUID
        assert event["status"] == "pending"

        assert server.statistics["cd_webhooks_received"] == 1
        assert server.statistics["cd_events_queued"] == 1

    asyncio.run(_run())


def test_webhook_path_token_success(tmp_path, monkeypatch) -> None:
    async def _run() -> None:
        monkeypatch.setenv("SYNCDETECTION_ENABLED", "true")
        monkeypatch.setenv("CHANGEDETECTION_WEBHOOK_TOKEN", "path-token")
        monkeypatch.setenv("SYNCDETECTION_DB_PATH", str(tmp_path / "api-path-token.db"))

        server.syncdetection_store = None
        _reset_sync_stats()

        response = await _post_webhook(
            "/webhook/changedetection/path-token",
            payload={"watch_uuid": KNOWN_WATCH_UUID, "last_changed": 32345.0},
        )

        assert response.status_code == 202
        body = response.json()
        assert body["accepted"] is True

        store = cast(Any, server.syncdetection_store)
        assert store is not None
        event = await store.get_event(body["event_key"])
        assert event is not None
        assert event["status"] == "pending"

    asyncio.run(_run())
