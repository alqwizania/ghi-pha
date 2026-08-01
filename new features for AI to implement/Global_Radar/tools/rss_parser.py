"""
RSS Feed Parser for DabDar v3.0
Parses health surveillance RSS feeds from WHO, CDC, and other sources

⚠️ DEPRECATED (v1.0): Direct RSS parsing is deprecated.
All RSS feeds are now monitored via ChangeDetection.io for unified pipeline.
See docs/RSS_DEPRECATION.md for migration guide.

This module is kept for backward compatibility only and will be removed in v2.0.
"""

import os
import httpx
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import re
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext, RSSItem


class RSSParser:
    """Parser for health surveillance RSS feeds"""

    # Default RSS feed sources
    DEFAULT_FEEDS = {
        "WHO_RSS": {
            "url": "https://www.who.int/rss-feeds/news-english.xml",
            "category": "health_news",
        },
        "CDC_RSS": {
            "url": "https://tools.cdc.gov/podcasts/feed.asp?feedid=183",
            "category": "outbreak_updates",
        },
    }

    def __init__(self):
        self.timeout = 30.0

    async def fetch_feed(self, url: str) -> Optional[str]:
        """
        Fetch RSS feed content from URL.

        Args:
            url: RSS feed URL

        Returns:
            XML content as string or None if failed
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                headers = {
                    "User-Agent": "DabDar Health Surveillance Bot/3.0",
                    "Accept": "application/rss+xml, application/xml, text/xml",
                }
                response = await client.get(url, headers=headers, follow_redirects=True)
                response.raise_for_status()
                return response.text
        except Exception as e:
            print(f"❌ Error fetching RSS feed {url}: {e}")
            return None

    def parse_date(self, date_str: str) -> str:
        """
        Parse various date formats to YYYY-MM-DD.

        Args:
            date_str: Date string in various formats

        Returns:
            Date in YYYY-MM-DD format
        """
        if not date_str:
            return datetime.now().strftime("%Y-%m-%d")

        # Common RSS date formats
        formats = [
            "%a, %d %b %Y %H:%M:%S %z",  # RFC 822
            "%a, %d %b %Y %H:%M:%S %Z",
            "%Y-%m-%dT%H:%M:%S%z",  # ISO 8601
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
            "%d %b %Y",
            "%B %d, %Y",
        ]

        for fmt in formats:
            try:
                dt = datetime.strptime(date_str.strip(), fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue

        # Try to extract date with regex
        date_match = re.search(r"(\d{4})-(\d{2})-(\d{2})", date_str)
        if date_match:
            return date_match.group(0)

        return datetime.now().strftime("%Y-%m-%d")

    def clean_html(self, text: str) -> str:
        """Remove HTML tags from text"""
        if not text:
            return ""
        # Remove HTML tags
        clean = re.sub(r"<[^>]+>", "", text)
        # Normalize whitespace
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean

    def parse_rss(self, xml_content: str, source_name: str) -> List[RSSItem]:
        """
        Parse RSS XML content into RSSItem objects.

        Args:
            xml_content: Raw XML string
            source_name: Name of the RSS source

        Returns:
            List of RSSItem objects
        """
        items = []

        try:
            root = ET.fromstring(xml_content)

            # Handle different RSS formats
            # Standard RSS 2.0
            channel = root.find("channel")
            if channel is not None:
                for item in channel.findall("item"):
                    try:
                        title = item.find("title")
                        link = item.find("link")
                        pub_date = item.find("pubDate")
                        description = item.find("description")
                        guid = item.find("guid")

                        rss_item = RSSItem(
                            title=self.clean_html(title.text)
                            if title is not None and title.text
                            else "No title",
                            link=link.text.strip()
                            if link is not None and link.text
                            else "",
                            published_date=self.parse_date(
                                pub_date.text
                                if pub_date is not None and pub_date.text
                                else ""
                            ),
                            description=self.clean_html(description.text)
                            if description is not None and description.text
                            else "",
                            source=source_name,
                            guid=guid.text if guid is not None and guid.text else None,
                        )
                        items.append(rss_item)
                    except Exception as e:
                        print(f"⚠️ Error parsing RSS item: {e}")
                        continue

            # Handle Atom feeds
            else:
                # Look for Atom entries - try multiple namespace options
                # The default Atom namespace (no prefix)
                default_ns = {"": "http://www.w3.org/2005/Atom"}
                ns = {"atom": "http://www.w3.org/2005/Atom"}

                # Try finding entries with default namespace first
                entries = root.findall(".//{http://www.w3.org/2005/Atom}entry")
                if not entries:
                    entries = root.findall(".//atom:entry", ns)
                if not entries:
                    entries = root.findall(".//entry")

                for entry in entries:
                    try:
                        # Try different namespace patterns for each element
                        title = (
                            entry.find("{http://www.w3.org/2005/Atom}title")
                            or entry.find("atom:title", ns)
                            or entry.find("title")
                        )
                        link_elem = (
                            entry.find("{http://www.w3.org/2005/Atom}link")
                            or entry.find("atom:link", ns)
                            or entry.find("link")
                        )
                        link = (
                            link_elem.get("href", "") if link_elem is not None else ""
                        )
                        updated = (
                            entry.find("{http://www.w3.org/2005/Atom}updated")
                            or entry.find("atom:updated", ns)
                            or entry.find("updated")
                            or entry.find("{http://www.w3.org/2005/Atom}published")
                            or entry.find("atom:published", ns)
                            or entry.find("published")
                        )
                        summary = (
                            entry.find("{http://www.w3.org/2005/Atom}summary")
                            or entry.find("atom:summary", ns)
                            or entry.find("summary")
                            or entry.find("{http://www.w3.org/2005/Atom}content")
                            or entry.find("atom:content", ns)
                            or entry.find("content")
                        )
                        id_elem = (
                            entry.find("{http://www.w3.org/2005/Atom}id")
                            or entry.find("atom:id", ns)
                            or entry.find("id")
                        )

                        rss_item = RSSItem(
                            title=self.clean_html(title.text)
                            if title is not None and title.text
                            else "No title",
                            link=link,
                            published_date=self.parse_date(
                                updated.text
                                if updated is not None and updated.text
                                else ""
                            ),
                            description=self.clean_html(summary.text)
                            if summary is not None and summary.text
                            else "",
                            source=source_name,
                            guid=id_elem.text
                            if id_elem is not None and id_elem.text
                            else None,
                        )
                        items.append(rss_item)
                    except Exception as e:
                        print(f"⚠️ Error parsing Atom entry: {e}")
                        continue

        except ET.ParseError as e:
            print(f"❌ XML parsing error: {e}")
        except Exception as e:
            print(f"❌ Error parsing feed: {e}")

        return items

    async def fetch_and_parse(
        self, source_name: str, url: Optional[str] = None, days_back: int = 7
    ) -> List[RSSItem]:
        """
        Fetch and parse an RSS feed.

        Args:
            source_name: Name of the RSS source (e.g., "WHO_RSS", "CDC_RSS")
            url: Optional URL override
            days_back: Only return items from the last N days

        Returns:
            List of RSSItem objects
        """
        # Get URL from environment or defaults
        if url is None:
            if source_name in self.DEFAULT_FEEDS:
                url = self.DEFAULT_FEEDS[source_name]["url"]
            else:
                env_var = f"RSS_{source_name.upper().replace('_RSS', '')}"
                url = os.getenv(env_var)

        if not url:
            print(f"❌ No URL found for RSS source: {source_name}")
            return []

        print(f"📡 Fetching RSS feed: {source_name} from {url}")

        # Fetch the feed
        xml_content = await self.fetch_feed(url)
        if not xml_content:
            return []

        # Parse the feed
        items = self.parse_rss(xml_content, source_name)

        # Filter by date if specified
        if days_back > 0:
            cutoff_date = (datetime.now() - timedelta(days=days_back)).strftime(
                "%Y-%m-%d"
            )
            items = [item for item in items if item.published_date >= cutoff_date]

        print(f"✅ Found {len(items)} items from {source_name}")
        return items

    async def fetch_all_sources(self, days_back: int = 7) -> List[Dict[str, Any]]:
        """
        Fetch RSS feeds from all configured sources.

        Args:
            days_back: Only return items from the last N days

        Returns:
            List of dictionaries representing RSS items from all sources
        """
        all_items = []

        # Fetch from all default sources
        for source_name in self.DEFAULT_FEEDS.keys():
            print(f"📡 Fetching {source_name}...")
            items = await self.fetch_and_parse(source_name, days_back=days_back)
            # Convert RSSItem objects to dictionaries
            # Filter out items with "No title" or empty titles
            for item in items:
                if item.title and item.title.strip() and item.title != "No title":
                    all_items.append(item.model_dump())

        print(f"✅ Total RSS items fetched: {len(all_items)}")
        return all_items


# Global parser instance
rss_parser = RSSParser()


@function_tool
async def fetch_rss_feeds(
    ctx: RunContextWrapper[HealthContext], source: str, days_back: int = 7
) -> str:
    """
    ⚠️ DEPRECATED: Use unified_scan_workflow instead.

    Fetch and parse RSS feeds from health surveillance sources.

    Args:
        source: RSS source name (WHO_RSS, CDC_RSS, or custom)
        days_back: Only return items from the last N days (default 7)

    Returns:
        JSON string of RSS items:
        [
            {
                "title": "Article title",
                "link": "https://...",
                "published_date": "2024-01-15",
                "description": "Article summary...",
                "source": "WHO_RSS",
                "guid": "unique-id"
            }
        ]
    """
    import json

    ctx.context.log(
        f"⚠️  DEPRECATED: fetch_rss_feeds() is deprecated. Use unified_scan_workflow instead."
    )
    ctx.context.log(f"📡 Fetching RSS feed: {source} (last {days_back} days)")

    items = await rss_parser.fetch_and_parse(source, days_back=days_back)

    ctx.context.log(f"✅ Found {len(items)} RSS items from {source}")

    # Convert to dictionaries
    items_dict = [item.model_dump() for item in items]

    return json.dumps(items_dict, ensure_ascii=False)


@function_tool
async def fetch_all_rss_sources(
    ctx: RunContextWrapper[HealthContext], days_back: int = 7
) -> str:
    """
    ⚠️ DEPRECATED: Use unified_scan_workflow instead.

    Fetch RSS feeds from all configured sources.

    Args:
        days_back: Only return items from the last N days

    Returns:
        JSON string with all RSS items from all sources
    """
    import json

    ctx.context.log(
        f"⚠️  DEPRECATED: fetch_all_rss_sources() is deprecated. Use unified_scan_workflow instead."
    )

    all_items = []

    # Fetch from default sources
    for source_name in rss_parser.DEFAULT_FEEDS.keys():
        ctx.context.log(f"📡 Fetching {source_name}...")
        items = await rss_parser.fetch_and_parse(source_name, days_back=days_back)
        all_items.extend(items)

    ctx.context.log(f"✅ Total RSS items fetched: {len(all_items)}")

    # Convert to dictionaries
    items_dict = [item.model_dump() for item in all_items]

    return json.dumps(items_dict, ensure_ascii=False)
