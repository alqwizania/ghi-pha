"""
Ensure ChangeDetection watches include SehaRadar webhook URL.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from health_agents.shared.models import SourceType
from health_agents.shared.source_registry import source_registry


def build_canonical_webhook_url(base_url: str, token: str = "") -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return ""

    parsed = urlparse(base)
    host = parsed.netloc or parsed.path
    host = host.strip().rstrip("/")
    if not host:
        return ""

    # ChangeDetection uses Apprise notification URLs. json:// is the
    # interoperable webhook transport for posting JSON payloads.
    if token:
        return f"json://{host}/webhook/changedetection/{token}"
    return f"json://{host}/webhook/changedetection"


def _normalize_notification_urls(raw_value: Any) -> List[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, list):
        return [str(item).strip() for item in raw_value if str(item).strip()]
    if isinstance(raw_value, str):
        return [item.strip() for item in raw_value.splitlines() if item.strip()]
    return []


async def sync_watch_webhooks(
    changedetection_client: Any,
    webhook_url: str,
    include_disabled_sources: bool = False,
) -> Dict[str, Any]:
    """
    Sync notification_urls across configured ChangeDetection watches.

    Returns operational summary for observability.
    """

    if not webhook_url:
        return {
            "success": False,
            "updated": 0,
            "already_configured": 0,
            "failed": 0,
            "message": "webhook_url is empty",
            "updated_watch_uuids": [],
            "failed_watch_uuids": [],
        }

    updated = 0
    already_configured = 0
    failed = 0
    updated_watch_uuids: List[str] = []
    failed_watch_uuids: List[str] = []

    for source in source_registry.list_all():
        if source.type != SourceType.CHANGEDETECTION:
            continue
        if not source.watch_uuid:
            continue
        if not include_disabled_sources and not source.enabled:
            continue

        watch_uuid = source.watch_uuid
        watch = await changedetection_client.get_watch(watch_uuid)
        if not watch:
            failed += 1
            failed_watch_uuids.append(watch_uuid)
            continue

        notification_urls = _normalize_notification_urls(watch.get("notification_urls"))
        if webhook_url in notification_urls:
            already_configured += 1
            continue

        notification_urls.append(webhook_url)
        ok = await changedetection_client.update_watch(
            watch_uuid,
            {"notification_urls": notification_urls},
        )
        if ok:
            updated += 1
            updated_watch_uuids.append(watch_uuid)
        else:
            failed += 1
            failed_watch_uuids.append(watch_uuid)

    return {
        "success": True,
        "updated": updated,
        "already_configured": already_configured,
        "failed": failed,
        "updated_watch_uuids": updated_watch_uuids,
        "failed_watch_uuids": failed_watch_uuids,
        "webhook_url": webhook_url,
    }
