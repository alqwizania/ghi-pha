"""RSSHub Client — fetches structured JSON feeds from a self-hosted RSSHub instance."""

import os
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

import httpx
from pydantic import BaseModel, Field


class RSSHubItem(BaseModel):
    """Single item from an RSSHub JSON feed."""

    title: str = Field(default="", description="Item title")
    description: str = Field(
        default="", description="Item body/summary (may contain HTML)"
    )
    link: str = Field(default="", description="Original article URL")
    pub_date: str = Field(default="", description="Publication date (ISO or RFC 822)")
    author: str = Field(default="", description="Author name")
    guid: str = Field(default="", description="Unique item identifier")
    category: List[str] = Field(
        default_factory=list, description="Item categories/tags"
    )


class RSSHubFeed(BaseModel):
    """Parsed RSSHub JSON feed envelope."""

    title: str = Field(default="")
    description: str = Field(default="")
    link: str = Field(default="")
    items: List[RSSHubItem] = Field(default_factory=list)
    last_build_date: str = Field(default="")


class RSSHubClient:
    def __init__(self):
        self.base_url = os.getenv("RSSHUB_BASE_URL", "http://rsshub:1200").rstrip("/")
        self.access_key = os.getenv("RSSHUB_ACCESS_KEY", "")
        self.timeout = float(os.getenv("RSSHUB_TIMEOUT", "30"))

    def _build_url(
        self,
        route: str,
        limit: Optional[int] = None,
        filter_title: Optional[str] = None,
        filterout: Optional[str] = None,
    ) -> str:
        """Build full RSSHub URL with query parameters."""
        url = f"{self.base_url}/{route.lstrip('/')}"

        params: List[str] = ["format=json"]

        if self.access_key:
            params.append(f"key={self.access_key}")
        if limit is not None:
            params.append(f"limit={limit}")
        if filter_title:
            params.append(f"filter_title={filter_title}")
        if filterout:
            params.append(f"filterout={filterout}")

        return f"{url}?{'&'.join(params)}"

    def _parse_json_feed(self, data: Dict[str, Any]) -> RSSHubFeed:
        """Parse RSSHub JSON response into RSSHubFeed model."""
        items: List[RSSHubItem] = []

        for raw_item in data.get("items", []):
            items.append(
                RSSHubItem(
                    title=raw_item.get("title", ""),
                    description=raw_item.get(
                        "content_html", raw_item.get("summary", "")
                    ),
                    link=raw_item.get("url", raw_item.get("external_url", "")),
                    pub_date=raw_item.get(
                        "date_published", raw_item.get("date_modified", "")
                    ),
                    author=self._extract_author(raw_item),
                    guid=raw_item.get("id", ""),
                    category=raw_item.get("tags", []),
                )
            )

        return RSSHubFeed(
            title=data.get("title", ""),
            description=data.get("description", ""),
            link=data.get("home_page_url", ""),
            items=items,
            last_build_date=data.get("date_modified", ""),
        )

    @staticmethod
    def _extract_author(item: Dict[str, Any]) -> str:
        """Extract author name from JSON Feed author object or string."""
        authors = item.get("authors", [])
        if authors and isinstance(authors, list):
            first = authors[0]
            if isinstance(first, dict):
                return first.get("name", "")
            return str(first)
        author = item.get("author", "")
        if isinstance(author, dict):
            return author.get("name", "")
        return str(author) if author else ""

    async def healthcheck(self) -> bool:
        """Check if the RSSHub instance is reachable."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/healthz")
                return response.status_code == 200
        except Exception:
            return False

    async def fetch_feed(
        self,
        route: str,
        limit: Optional[int] = 20,
        filter_title: Optional[str] = None,
        filterout: Optional[str] = None,
    ) -> Optional[RSSHubFeed]:
        """
        Fetch a single RSSHub route as a structured feed.

        Args:
            route: RSSHub route path (e.g. "who/news/en")
            limit: Maximum items to return
            filter_title: Regex to include only matching titles
            filterout: Regex to exclude matching titles

        Returns:
            RSSHubFeed or None on error
        """
        url = self._build_url(
            route, limit=limit, filter_title=filter_title, filterout=filterout
        )
        print(f"📡 RSSHub fetch: {route}", flush=True)

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    url,
                    headers={"User-Agent": "SehaRadar/1.0"},
                    follow_redirects=True,
                )
                response.raise_for_status()
                data = response.json()

            feed = self._parse_json_feed(data)
            print(f"  ✅ {len(feed.items)} items from {route}", flush=True)
            return feed

        except httpx.HTTPStatusError as e:
            print(f"  ❌ HTTP {e.response.status_code} for route {route}")
            return None
        except Exception as e:
            print(f"  ❌ Error fetching route {route}: {e}")
            return None

    async def fetch_multiple(
        self,
        routes: List[Dict[str, Any]],
    ) -> Dict[str, Optional[RSSHubFeed]]:
        """
        Fetch multiple routes in parallel.

        Args:
            routes: List of dicts with keys: route (str), and optionally
                    limit (int), filter_title (str), filterout (str), source_id (str)

        Returns:
            Dict mapping source_id (or route) -> RSSHubFeed
        """
        feeds: Dict[str, Optional[RSSHubFeed]] = {}

        async def _fetch_one(route_config: Dict[str, Any]) -> None:
            source_id = route_config.get("source_id", route_config["route"])
            try:
                feed = await self.fetch_feed(
                    route=route_config["route"],
                    limit=route_config.get("limit", 20),
                    filter_title=route_config.get("filter_title"),
                    filterout=route_config.get("filterout"),
                )
                feeds[source_id] = feed
            except Exception as e:
                print(f"  ⚠️ Route fetch error ({source_id}): {e}")
                feeds[source_id] = None

        tasks = [_fetch_one(rc) for rc in routes]
        await asyncio.gather(*tasks)

        return feeds

    async def list_available_routes(self) -> Optional[Dict[str, Any]]:
        """Fetch RSSHub route status/metadata from the API."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.base_url}/api/routes")
                response.raise_for_status()
                return response.json()
        except Exception as e:
            print(f"❌ Failed to list RSSHub routes: {e}")
            return None


rsshub_client = RSSHubClient()
