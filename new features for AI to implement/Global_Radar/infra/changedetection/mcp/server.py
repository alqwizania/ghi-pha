import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP


DEFAULT_BASE_URL = "http://changedetection:5000"
DEFAULT_TIMEOUT = 30.0
VALID_FETCH_BACKENDS = {"html_requests", "html_webdriver"}
VALID_PROCESSORS = {"text_json_diff", "restock_diff"}
VALID_DIFF_FORMATS = {"text", "html", "htmlcolor", "markdown"}


class ChangeDetectionAPI:
    def __init__(self) -> None:
        self.base_url = os.getenv("CHANGEDETECTION_URL", DEFAULT_BASE_URL).rstrip("/")
        self.api_key = os.getenv("CHANGEDETECTION_API_KEY") or os.getenv(
            "SALTED_PASS", ""
        )
        self.timeout = self._parse_timeout(
            os.getenv("CHANGEDETECTION_TIMEOUT", str(DEFAULT_TIMEOUT))
        )

    @staticmethod
    def _parse_timeout(raw_timeout: str) -> float:
        try:
            return float(raw_timeout)
        except ValueError:
            return DEFAULT_TIMEOUT

    @property
    def headers(self) -> dict[str, str]:
        if not self.api_key:
            raise RuntimeError(
                "Missing API key. Set CHANGEDETECTION_API_KEY or SALTED_PASS in environment."
            )
        return {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        text_response: bool = False,
    ) -> Any:
        url = f"{self.base_url}{path}"
        with httpx.Client(timeout=self.timeout) as client:
            response = client.request(
                method,
                url,
                headers=self.headers,
                params=params,
                json=json_body,
            )

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body_preview = (response.text or "").strip()[:1000]
            raise RuntimeError(
                f"ChangeDetection API error {response.status_code} on {path}: {body_preview}"
            ) from exc

        if text_response:
            return response.text

        if not response.text:
            return {}

        try:
            return response.json()
        except ValueError:
            return {"raw": response.text}


def _validate_fetch_backend(fetch_backend: str) -> None:
    if fetch_backend not in VALID_FETCH_BACKENDS:
        allowed = ", ".join(sorted(VALID_FETCH_BACKENDS))
        raise ValueError(f"Invalid fetch_backend '{fetch_backend}'. Allowed: {allowed}")


def _validate_processor(processor: str) -> None:
    if processor not in VALID_PROCESSORS:
        allowed = ", ".join(sorted(VALID_PROCESSORS))
        raise ValueError(f"Invalid processor '{processor}'. Allowed: {allowed}")


def _validate_diff_format(diff_format: str) -> None:
    if diff_format not in VALID_DIFF_FORMATS:
        allowed = ", ".join(sorted(VALID_DIFF_FORMATS))
        raise ValueError(f"Invalid format '{diff_format}'. Allowed: {allowed}")


mcp = FastMCP("ChangeDetection MCP", json_response=True)
api = ChangeDetectionAPI()


@mcp.tool()
def system_info() -> dict[str, Any]:
    """Get ChangeDetection system info and stats."""
    try:
        return api.request("GET", "/api/v1/systeminfo")
    except RuntimeError:
        watches = api.request("GET", "/api/v1/watch")
        watch_count = len(watches) if isinstance(watches, dict) else 0
        return {
            "systeminfo_endpoint": "forbidden",
            "watch_count": watch_count,
            "base_url": api.base_url,
        }


@mcp.tool()
def list_watches(tag: str | None = None, recheck_all: bool = False) -> dict[str, Any]:
    """List all watches, optionally filtered by tag, with optional recheck trigger."""
    params: dict[str, Any] = {}
    if tag:
        params["tag"] = tag
    if recheck_all:
        params["recheck_all"] = "1"
    return api.request("GET", "/api/v1/watch", params=params or None)


@mcp.tool()
def get_watch(watch_uuid: str) -> dict[str, Any]:
    """Get details for a single watch UUID."""
    return api.request("GET", f"/api/v1/watch/{watch_uuid}")


@mcp.tool()
def search_watches(
    query: str,
    tag: str | None = None,
    partial: bool = True,
) -> dict[str, Any] | list[Any]:
    """Search watches by query and optional tag filter."""
    if not query.strip():
        raise ValueError("query must not be empty")

    params: dict[str, Any] = {"q": query.strip(), "partial": "1" if partial else "0"}
    if tag:
        params["tag"] = tag
    return api.request("GET", "/api/v1/search", params=params)


@mcp.tool()
def create_watch(
    url: str,
    title: str = "",
    check_hours: int = 1,
    fetch_backend: str = "html_requests",
    processor: str = "text_json_diff",
    paused: bool = False,
    notification_muted: bool = False,
    notification_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Create a new watch with safe defaults."""
    if not url.strip():
        raise ValueError("url must not be empty")
    _validate_fetch_backend(fetch_backend)
    _validate_processor(processor)

    payload: dict[str, Any] = {
        "url": url.strip(),
        "fetch_backend": fetch_backend,
        "processor": processor,
        "paused": paused,
        "notification_muted": notification_muted,
        "time_between_check": {"hours": max(0, check_hours)},
    }
    if title:
        payload["title"] = title
    if notification_urls:
        payload["notification_urls"] = notification_urls

    return api.request("POST", "/api/v1/watch", json_body=payload)


@mcp.tool()
def update_watch(
    watch_uuid: str,
    title: str | None = None,
    check_hours: int | None = None,
    fetch_backend: str | None = None,
    processor: str | None = None,
    paused: bool | None = None,
    notification_muted: bool | None = None,
    notification_urls: list[str] | None = None,
) -> dict[str, Any]:
    """Update safe editable fields for a watch."""
    updates: dict[str, Any] = {}
    if title is not None:
        updates["title"] = title
    if check_hours is not None:
        updates["time_between_check"] = {"hours": max(0, check_hours)}
    if fetch_backend is not None:
        _validate_fetch_backend(fetch_backend)
        updates["fetch_backend"] = fetch_backend
    if processor is not None:
        _validate_processor(processor)
        updates["processor"] = processor
    if paused is not None:
        updates["paused"] = paused
    if notification_muted is not None:
        updates["notification_muted"] = notification_muted
    if notification_urls is not None:
        updates["notification_urls"] = notification_urls

    if not updates:
        raise ValueError("No updates provided")

    return api.request("PUT", f"/api/v1/watch/{watch_uuid}", json_body=updates)


@mcp.tool()
def set_watch_state(
    watch_uuid: str,
    paused: bool | None = None,
    muted: bool | None = None,
) -> dict[str, Any]:
    """Set paused and/or muted state for a watch using API query flags."""
    if paused is None and muted is None:
        raise ValueError("At least one of paused or muted must be provided")

    params: dict[str, str] = {}
    if paused is not None:
        params["paused"] = "paused" if paused else "unpaused"
    if muted is not None:
        params["muted"] = "muted" if muted else "unmuted"

    return api.request("GET", f"/api/v1/watch/{watch_uuid}", params=params)


@mcp.tool()
def trigger_recheck(watch_uuid: str) -> dict[str, Any]:
    """Trigger immediate recheck for a watch, with fallback method."""
    try:
        result = api.request("POST", f"/api/v1/watch/{watch_uuid}/recheck")
        return {"status": "triggered", "method": "post", "result": result}
    except RuntimeError as post_error:
        fallback = api.request(
            "GET", f"/api/v1/watch/{watch_uuid}", params={"recheck": "1"}
        )
        return {
            "status": "triggered",
            "method": "query",
            "result": fallback,
            "fallback_reason": str(post_error),
        }


@mcp.tool()
def get_watch_history(watch_uuid: str) -> dict[str, str]:
    """List available snapshots for a watch."""
    return api.request("GET", f"/api/v1/watch/{watch_uuid}/history")


@mcp.tool()
def get_snapshot(
    watch_uuid: str,
    timestamp: str = "latest",
    html: bool = False,
) -> str:
    """Get watch snapshot content by timestamp or keyword (latest/previous)."""
    params = {"html": "1"} if html else None
    return api.request(
        "GET",
        f"/api/v1/watch/{watch_uuid}/history/{timestamp}",
        params=params,
        text_response=True,
    )


@mcp.tool()
def get_difference(
    watch_uuid: str,
    from_timestamp: str = "previous",
    to_timestamp: str = "latest",
    format: str = "text",
    word_diff: bool = False,
    changes_only: bool = True,
) -> str:
    """Get a diff between two snapshots."""
    _validate_diff_format(format)
    params = {
        "format": format,
        "word_diff": "true" if word_diff else "false",
        "changesOnly": "true" if changes_only else "false",
    }
    return api.request(
        "GET",
        f"/api/v1/watch/{watch_uuid}/difference/{from_timestamp}/{to_timestamp}",
        params=params,
        text_response=True,
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
