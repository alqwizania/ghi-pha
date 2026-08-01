"""
Webhook payload parsing and authentication helpers for syncdetection.
"""

from __future__ import annotations

import hmac
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


class ChangeDetectionWebhookEnvelope(BaseModel):
    """Tolerant webhook envelope for different ChangeDetection payload shapes."""

    watch_uuid: Optional[str] = None
    uuid: Optional[str] = None
    last_changed: Optional[float] = None
    triggered_at_ts: Optional[float] = None
    watch: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    model_config = ConfigDict(extra="allow")


class WebhookAuthEnvelope(BaseModel):
    """Optional token fields some notification templates include in payload."""

    token: Optional[str] = None
    webhook_token: Optional[str] = None
    secret: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)
    model_config = ConfigDict(extra="allow")


@dataclass
class ParsedWebhookEvent:
    watch_uuid: str
    last_changed: float
    source: str


def _get_by_path(data: Dict[str, Any], dotted_path: str) -> Any:
    node: Any = data
    for part in dotted_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _first_non_empty(data: Dict[str, Any], *paths: str) -> Any:
    for path in paths:
        value = _get_by_path(data, path)
        if value not in (None, "", []):
            return value
    return None


def _to_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_watch_uuid(payload: Dict[str, Any]) -> Optional[str]:
    value = _first_non_empty(
        payload, "watch_uuid", "uuid", "watch.uuid", "meta.watch_uuid"
    )
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def extract_last_changed(payload: Dict[str, Any]) -> Optional[float]:
    value = _first_non_empty(
        payload,
        "last_changed",
        "triggered_at_ts",
        "meta.last_changed",
        "watch.last_changed",
    )
    return _to_float(value)


def extract_watch_url(payload: Dict[str, Any]) -> Optional[str]:
    direct = _first_non_empty(payload, "url", "watch_url", "watch.url", "link")
    if isinstance(direct, list):
        for item in direct:
            if isinstance(item, str) and item.strip().startswith(
                ("http://", "https://")
            ):
                return item.strip()
    if isinstance(direct, str) and direct.strip().startswith(("http://", "https://")):
        return direct.strip()

    title = payload.get("title")
    if isinstance(title, str):
        match = re.search(r"https?://\S+", title)
        if match:
            return match.group(0).rstrip(".,)")

    message = payload.get("message")
    if isinstance(message, str):
        match = re.search(r"https?://\S+", message)
        if match:
            return match.group(0).rstrip(".,)")

    return None


def _normalize_url(value: str) -> str:
    return value.strip().rstrip("/")


def _resolve_watch_uuid_from_url(
    target_url: str,
    watches: Dict[str, Dict[str, Any]],
) -> Optional[str]:
    normalized_target = _normalize_url(target_url)

    for watch_uuid, watch_info in watches.items():
        candidates = []

        url_value = watch_info.get("url")
        if isinstance(url_value, str):
            candidates.append(url_value)

        link_value = watch_info.get("link")
        if isinstance(link_value, str):
            candidates.append(link_value)
        elif isinstance(link_value, list):
            candidates.extend(
                item for item in link_value if isinstance(item, str) and item.strip()
            )

        for candidate in candidates:
            if _normalize_url(candidate) == normalized_target:
                return watch_uuid

    return None


async def parse_changedetection_payload(
    payload: Dict[str, Any],
    changedetection_client: Any,
    fallback_watch_uuid: Optional[str] = None,
) -> ParsedWebhookEvent:
    """
    Parse and normalize webhook payload into watch UUID and last_changed.

    If ``last_changed`` is missing, watch details are fetched from ChangeDetection.
    """

    ChangeDetectionWebhookEnvelope.model_validate(payload)

    watch_uuid = extract_watch_uuid(payload) or fallback_watch_uuid
    if not watch_uuid:
        watch_url = extract_watch_url(payload)
        if watch_url:
            watches = await changedetection_client.list_watches()
            watch_uuid = _resolve_watch_uuid_from_url(watch_url, watches or {})

    if not watch_uuid:
        raise ValueError("Missing watch_uuid/uuid in webhook payload")

    last_changed = extract_last_changed(payload)
    source = "payload"

    if last_changed is None:
        watch_info = await changedetection_client.get_watch(watch_uuid)
        if not watch_info:
            raise ValueError("Missing last_changed and unable to fetch watch details")

        last_changed = _to_float(watch_info.get("last_changed"))
        source = "watch_lookup"

    if last_changed is None:
        raise ValueError("Unable to determine last_changed for webhook event")

    return ParsedWebhookEvent(
        watch_uuid=watch_uuid,
        last_changed=last_changed,
        source=source,
    )


def payload_to_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, default=str)


def is_webhook_authenticated(
    expected_token: str,
    header_token: Optional[str],
    query_token: Optional[str],
    payload: Optional[Dict[str, Any]] = None,
) -> bool:
    if not expected_token:
        return True

    candidates = [header_token, query_token]

    if payload:
        auth_payload = WebhookAuthEnvelope.model_validate(payload)
        candidates.extend(
            [
                auth_payload.token,
                auth_payload.webhook_token,
                auth_payload.secret,
                auth_payload.meta.get("token"),
                auth_payload.meta.get("webhook_token"),
                auth_payload.meta.get("secret"),
            ]
        )

    for candidate in candidates:
        if candidate and hmac.compare_digest(str(candidate), expected_token):
            return True

    return False
