"""
ChangeDetection.io Client for DabDar v3.0
Central source of truth for all website monitoring

This client handles:
1. Fetching snapshots from configured watches
2. Polling for changes across all watches
3. Creating/updating watches via API
4. Processing webhook notifications
"""

import os
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext


class ChangeDetectionClient:
    """
    Unified client for ChangeDetection.io API.

    ChangeDetection.io is the single source of truth for all website monitoring.
    It handles:
    - Website change detection with configurable intervals
    - JavaScript rendering for dynamic pages
    - Content filtering and extraction
    - Snapshot history storage
    - Webhook notifications on changes
    """

    def __init__(self):
        self.base_url = os.getenv(
            "CHANGEDETECTION_URL", "https://changedetection.fayaa92.sa"
        )
        self.api_key = os.getenv("CHANGEDETECTION_API_KEY", "")
        self.timeout = 30.0

    @property
    def headers(self) -> Dict[str, str]:
        """API headers with authentication"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        return headers

    # =========================================================================
    # WATCH MANAGEMENT
    # =========================================================================

    async def list_watches(self) -> Dict[str, Dict[str, Any]]:
        """
        List all configured watches.

        Returns:
            Dictionary of watch_uuid -> watch_info
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/watch", headers=self.headers
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"❌ Error listing watches: {e}")
            return {}

    async def get_watch(self, watch_uuid: str) -> Optional[Dict[str, Any]]:
        """
        Get detailed information about a specific watch.

        Args:
            watch_uuid: UUID of the watch

        Returns:
            Watch details or None if not found
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}", headers=self.headers
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"❌ Error getting watch {watch_uuid}: {e}")
            return None

    async def create_watch(
        self,
        url: str,
        title: str,
        tag: str = "",
        include_filters: List[str] = None,
        notification_urls: List[str] = None,
        time_between_check_hours: int = 1,
        fetch_backend: str = "html_webdriver",
    ) -> Optional[str]:
        """
        Create a new watch in ChangeDetection.io.

        Args:
            url: URL to monitor
            title: Watch title/name
            tag: Optional tag for grouping
            include_filters: CSS/XPath selectors to include
            notification_urls: Webhook URLs to notify on change
            time_between_check_hours: Check interval in hours
            fetch_backend: "html_requests" or "html_webdriver"

        Returns:
            UUID of created watch or None
        """
        data = {
            "url": url,
            "title": title,
            "tag": tag,
            "fetch_backend": fetch_backend,
            "time_between_check": {"hours": time_between_check_hours},
        }

        if include_filters:
            data["include_filters"] = include_filters
        if notification_urls:
            data["notification_urls"] = notification_urls

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/v1/watch", headers=self.headers, json=data
                )
                response.raise_for_status()
                result = response.json()
                return result.get("uuid")
        except Exception as e:
            print(f"❌ Error creating watch: {e}")
            return None

    async def update_watch(self, watch_uuid: str, updates: Dict[str, Any]) -> bool:
        """
        Update an existing watch.

        Args:
            watch_uuid: UUID of watch to update
            updates: Dictionary of fields to update

        Returns:
            True if successful
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.put(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}",
                    headers=self.headers,
                    json=updates,
                )
                response.raise_for_status()
                return True
        except Exception as e:
            print(f"❌ Error updating watch {watch_uuid}: {e}")
            return False

    async def delete_watch(self, watch_uuid: str) -> bool:
        """Delete a watch"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.delete(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}", headers=self.headers
                )
                response.raise_for_status()
                return True
        except Exception as e:
            print(f"❌ Error deleting watch {watch_uuid}: {e}")
            return False

    async def trigger_recheck(self, watch_uuid: str) -> bool:
        """
        Trigger an immediate recheck of a watch.

        Args:
            watch_uuid: UUID of watch to recheck

        Returns:
            True if triggered successfully
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Mark as viewed first (required by API)
                response = await client.post(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}/recheck",
                    headers=self.headers,
                )
                response.raise_for_status()
                return True
        except Exception as e:
            print(f"❌ Error triggering recheck for {watch_uuid}: {e}")
            return False

    # =========================================================================
    # CONTENT FETCHING
    # =========================================================================

    async def fetch_snapshot(self, watch_uuid: str) -> Optional[str]:
        """
        Fetch the latest snapshot content for a watch.

        This returns the processed/filtered text content that
        ChangeDetection.io has extracted from the page.

        Args:
            watch_uuid: UUID of the watch

        Returns:
            Text content or None if unavailable
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # First check if there's any history
                history_response = await client.get(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}/history",
                    headers=self.headers,
                )
                history_response.raise_for_status()
                history = history_response.json()

                if not history:
                    print(f"⚠️ No snapshots available for watch {watch_uuid}")
                    return None

                # Fetch the latest snapshot
                response = await client.get(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}/history/latest",
                    headers=self.headers,
                )
                response.raise_for_status()
                return response.text

        except Exception as e:
            print(f"❌ Error fetching snapshot for {watch_uuid}: {e}")
            return None

    async def fetch_snapshot_by_timestamp(
        self, watch_uuid: str, timestamp: int
    ) -> Optional[str]:
        """
        Fetch a specific snapshot by timestamp.

        Args:
            watch_uuid: UUID of the watch
            timestamp: Unix timestamp of the snapshot

        Returns:
            Text content or None
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}/history/{timestamp}",
                    headers=self.headers,
                )
                response.raise_for_status()
                return response.text
        except Exception as e:
            print(f"❌ Error fetching snapshot {timestamp} for {watch_uuid}: {e}")
            return None

    async def get_history(self, watch_uuid: str) -> Dict[str, str]:
        """
        Get snapshot history for a watch.

        Returns:
            Dictionary of timestamp -> snapshot_path
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}/history",
                    headers=self.headers,
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"❌ Error getting history for {watch_uuid}: {e}")
            return {}

    # =========================================================================
    # POLLING & CHANGE DETECTION
    # =========================================================================

    async def get_changed_watches(self) -> List[Dict[str, Any]]:
        """
        Get all watches that have unviewed changes.

        Returns:
            List of watch info dictionaries with changes
        """
        watches = await self.list_watches()
        changed = []

        for uuid, info in watches.items():
            # Check if watch has unviewed changes
            if info.get("last_changed", 0) > 0 and not info.get("viewed", True):
                info["uuid"] = uuid
                changed.append(info)

        return changed

    async def mark_as_viewed(self, watch_uuid: str) -> bool:
        """
        Mark a watch as viewed (clears the 'new changes' flag).

        Note: This endpoint may not be available in all ChangeDetection.io versions.
        If it fails, we silently return True since it's not critical functionality.

        Args:
            watch_uuid: UUID of watch

        Returns:
            True if successful or if the endpoint is not available
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/v1/watch/{watch_uuid}/viewed",
                    headers=self.headers,
                )
                response.raise_for_status()
                return True
        except httpx.HTTPStatusError as e:
            # 405 Method Not Allowed means endpoint doesn't exist - that's OK
            if e.response.status_code == 405:
                return True  # Silently succeed
            print(f"⚠️ Error marking watch as viewed: {e}")
            return False
        except Exception as e:
            # Don't log other errors either - this is non-critical
            return True

    async def poll_all_watches(self) -> List[Dict[str, Any]]:
        """
        Poll all watches and return their latest content.

        This is useful for scheduled scans or when webhooks
        may have been missed.

        Returns:
            List of dicts with watch info and content
        """
        watches = await self.list_watches()
        results = []

        for uuid, info in watches.items():
            content = await self.fetch_snapshot(uuid)
            if content:
                results.append(
                    {
                        "uuid": uuid,
                        "title": info.get("title", ""),
                        "url": info.get("url", ""),
                        "last_checked": info.get("last_checked", 0),
                        "last_changed": info.get("last_changed", 0),
                        "content": content,
                    }
                )

        return results

    # =========================================================================
    # CONTENT PARSING
    # =========================================================================

    def parse_disease_outbreak_list(self, content: str) -> List[Dict[str, Any]]:
        """
        Parse WHO-style disease outbreak news list content.

        The content from ChangeDetection.io is already cleaned text like:
        "30 January 2026 | Nipah virus infection - India"

        Args:
            content: Text content from snapshot

        Returns:
            List of parsed items
        """
        items = []
        lines = content.strip().split("\n")

        for line in lines:
            line = line.strip()
            if not line or "|" not in line:
                continue

            # Parse "DATE | TITLE - LOCATION" format
            parts = line.split("|", 1)
            if len(parts) != 2:
                continue

            date_str = parts[0].strip()
            title_location = parts[1].strip()

            # Skip header lines
            if "Disease Outbreak" in title_location or "Page of" in line:
                continue

            # Parse title and location
            if " - " in title_location:
                title_parts = title_location.rsplit(" - ", 1)
                title = title_parts[0].strip()
                location = title_parts[1].strip() if len(title_parts) > 1 else ""
            else:
                title = title_location
                location = ""

            items.append(
                {
                    "date": date_str,
                    "title": title,
                    "headline": f"{title} - {location}" if location else title,
                    "location": location,
                    "source": "WHO",
                }
            )

        return items

    def parse_cdc_outbreak_list(self, content: str) -> List[Dict[str, Any]]:
        """
        Parse CDC-style outbreak list content.

        Args:
            content: Text content from snapshot

        Returns:
            List of parsed items
        """
        items = []
        lines = content.strip().split("\n")

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # CDC format varies - try to extract meaningful content
            # Skip navigation/header lines
            if any(
                skip in line.lower()
                for skip in ["menu", "skip", "search", "home", "about"]
            ):
                continue

            # Look for disease-related lines
            items.append(
                {
                    "title": line,
                    "headline": line,
                    "source": "CDC",
                }
            )

        return items

    def parse_generic_content(
        self, content: str, source: str = "Unknown"
    ) -> List[Dict[str, Any]]:
        """
        Parse generic text content into items.

        Args:
            content: Text content from snapshot
            source: Source name

        Returns:
            List of parsed items
        """
        items = []
        lines = content.strip().split("\n")

        for line in lines:
            line = line.strip()
            if not line or len(line) < 10:
                continue

            items.append(
                {
                    "title": line[:200],
                    "headline": line[:200],
                    "description": line,
                    "source": source,
                }
            )

        return items


# Global client instance
changedetection_client = ChangeDetectionClient()


# =============================================================================
# FUNCTION TOOLS FOR AGENT USE
# =============================================================================


@function_tool
async def fetch_html_snapshot(
    ctx: RunContextWrapper[HealthContext], watch_uuid: str
) -> str:
    """
    Fetch the latest snapshot from ChangeDetection.io.

    Args:
        watch_uuid: UUID of the watch to fetch

    Returns:
        Text content from the snapshot
    """
    ctx.context.log(f"Fetching snapshot for watch: {watch_uuid}")

    content = await changedetection_client.fetch_snapshot(watch_uuid)

    if content:
        ctx.context.log(f"✅ Fetched snapshot ({len(content)} chars)")
        return content
    else:
        ctx.context.log(f"❌ Failed to fetch snapshot")
        return ""


@function_tool
async def list_all_watches(ctx: RunContextWrapper[HealthContext]) -> str:
    """
    List all configured watches in ChangeDetection.io.

    Returns:
        JSON string of watches
    """
    import json

    ctx.context.log("Listing all watches from ChangeDetection.io")

    watches = await changedetection_client.list_watches()

    ctx.context.log(f"✅ Found {len(watches)} watches")

    return json.dumps(watches, default=str)


@function_tool
async def get_changed_watches(ctx: RunContextWrapper[HealthContext]) -> str:
    """
    Get watches with unviewed changes.

    Returns:
        JSON string of changed watches
    """
    import json

    ctx.context.log("Checking for changed watches")

    changed = await changedetection_client.get_changed_watches()

    ctx.context.log(f"✅ Found {len(changed)} watches with changes")

    return json.dumps(changed, default=str)


@function_tool
async def trigger_watch_recheck(
    ctx: RunContextWrapper[HealthContext], watch_uuid: str
) -> str:
    """
    Trigger an immediate recheck of a watch.

    Args:
        watch_uuid: UUID of watch to recheck

    Returns:
        Status message
    """
    ctx.context.log(f"Triggering recheck for watch: {watch_uuid}")

    success = await changedetection_client.trigger_recheck(watch_uuid)

    if success:
        ctx.context.log("✅ Recheck triggered")
        return "Recheck triggered successfully"
    else:
        ctx.context.log("❌ Failed to trigger recheck")
        return "Failed to trigger recheck"
