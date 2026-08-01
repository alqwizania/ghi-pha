"""
Periodic Scan Workflow for DabDar v3.0
Handles scheduled RSS feed checks and Google searches
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any

from health_agents.shared.models import HealthContext


class ScanScheduler:
    """
    Scheduler for periodic RSS and Google scans.

    Schedule:
    - RSS feeds: Every 6 hours (configurable)
    - Google searches: Daily for each disease (configurable)
    """

    def __init__(self, statistics_callback=None):
        # Configuration from environment
        self.rss_interval_hours = int(os.getenv("RSS_SCAN_INTERVAL_HOURS", "6"))
        self.google_scan_hour = int(os.getenv("GOOGLE_SCAN_HOUR", "8"))  # 8 AM
        self.enabled = os.getenv("PERIODIC_SCAN_ENABLED", "true").lower() == "true"
        self.running = False

        # Track last scan times
        self.last_rss_scan: Optional[datetime] = None
        self.last_google_scan: Optional[datetime] = None

        # Callback to update statistics in server.py
        self.statistics_callback = statistics_callback

    async def should_run_rss_scan(self) -> bool:
        """
        DEPRECATED: RSS feeds are now monitored via ChangeDetection.io
        This method always returns False to prevent legacy RSS scanning.
        """
        return False

    async def should_run_google_scan(self) -> bool:
        """Check if Google scan should run (once daily at configured hour)"""
        now = datetime.now()

        # Check if it's the right hour
        if now.hour != self.google_scan_hour:
            return False

        # Check if we already scanned today
        if self.last_google_scan and self.last_google_scan.date() == now.date():
            return False

        return True

    async def run_rss_scan(self) -> Dict[str, Any]:
        """
        DEPRECATED: RSS feed scanning (v1.0)

        RSS feeds are now monitored via ChangeDetection.io webhook integration.
        This method is kept for backward compatibility but does nothing.

        Use /api/scan-unified endpoint instead.
        """
        print(
            f"⚠️  Legacy RSS scan called - RSS feeds now monitored via ChangeDetection.io"
        )
        return {
            "success": True,
            "message": "RSS scanning deprecated - use ChangeDetection.io",
            "items_found": 0,
            "stored": 0,
        }

    async def run_google_scan(self) -> Dict[str, Any]:
        """Execute Google search scan for all configured diseases"""
        print(f"🔍 Running scheduled Google scan at {datetime.now().strftime('%H:%M')}")

        context = HealthContext(
            source="GOOGLE_SCAN",
            timestamp=datetime.now(),
        )

        try:
            from tools.google_search import google_search_client
            from tools.epi_triad_analyzer import epi_analyzer
            from tools.arabic_translator import arabic_translator
            from tools.nocodb_client import nocodb_v3
            from tools.deduplication import dedup_service

            if not google_search_client.enabled:
                print("  Google Search not configured, skipping")
                self.last_google_scan = datetime.now()
                return {"success": True, "message": "Google Search not configured"}

            # Get diseases from config file
            config_path = os.path.join(
                os.path.dirname(__file__), "..", "config", "diseases.json"
            )
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    diseases = [d.get("name") for d in config.get("diseases", [])]
            except Exception as e:
                print(f"  Error loading diseases config: {e}")
                diseases = ["Mpox", "Marburg", "MERS", "Cholera"]  # Fallback

            print(f"  Searching for {len(diseases)} diseases")

            all_findings = []

            for disease in diseases:
                try:
                    results = await google_search_client.search_disease_news(
                        disease=disease,
                        language="en",
                        days_back=1,
                    )

                    for result in results:
                        # GoogleSearchResult is a Pydantic model with title, link, snippet attributes
                        finding = {
                            "headline": result.title,
                            "source": "GOOGLE",
                            "source_type": "google_search",
                            "source_link": result.link,
                            "short_description_en": result.snippet,
                            "disease": disease,
                        }
                        all_findings.append(finding)

                except Exception as e:
                    print(f"  Error searching {disease}: {e}")

            print(f"  Found {len(all_findings)} search results")

            if not all_findings:
                self.last_google_scan = datetime.now()
                return {"success": True, "items_found": 0, "stored": 0}

            # Analyze
            analyzed = []
            for finding in all_findings:
                try:
                    analysis = await epi_analyzer.analyze_finding(
                        headline=finding.get("headline", ""),
                        description=finding.get("short_description_en", ""),
                        source=finding.get("source", "GOOGLE"),
                    )
                    analyzed.append({**finding, **analysis})
                except Exception as e:
                    print(f"  Error analyzing: {e}")

            # Translate
            translated = await arabic_translator.batch_translate(analyzed)

            # Store with deduplication
            written = 0
            duplicates = 0

            for finding in translated:
                content_hash = dedup_service.generate_hash(
                    disease=finding.get("disease", "Unknown"),
                    countries=finding.get("countries", []),
                    headline=finding.get("headline", ""),
                )
                finding["content_hash"] = content_hash

                is_dup = await nocodb_v3.check_duplicate_by_hash(content_hash)
                if is_dup:
                    duplicates += 1
                    continue

                try:
                    await nocodb_v3.write_finding_v3(finding)
                    written += 1
                except Exception as e:
                    print(f"  Error writing: {e}")

            print(f"  Stored: {written} new, {duplicates} duplicates")

            self.last_google_scan = datetime.now()

            # Update statistics in server.py
            if self.statistics_callback:
                self.statistics_callback("google_scans", 1)
                self.statistics_callback("findings_stored", written)

            return {
                "success": True,
                "diseases_searched": len(diseases),
                "items_found": len(all_findings),
                "stored": written,
                "duplicates": duplicates,
            }

        except Exception as e:
            print(f"❌ Google scan error: {e}")
            return {"success": False, "error": str(e)}

    async def run(self):
        """Main scheduler loop"""
        self.running = True
        print(f"📅 Periodic scan scheduler started")
        print(f"   RSS: Deprecated (now via ChangeDetection.io webhooks)")
        print(f"   Google scan: daily at {self.google_scan_hour}:00")

        while self.running:
            try:
                # Check RSS scan
                if await self.should_run_rss_scan():
                    await self.run_rss_scan()

                # Check Google scan
                if await self.should_run_google_scan():
                    await self.run_google_scan()

                # Sleep for 5 minutes before next check
                await asyncio.sleep(300)

            except Exception as e:
                print(f"❌ Scheduler error: {e}")
                await asyncio.sleep(60)

    def stop(self):
        """Stop the scheduler"""
        self.running = False
        print("📅 Periodic scan scheduler stopped")


# Global scheduler instance (will be initialized in server.py with callback)
scan_scheduler = None


# Convenience functions for manual triggers
async def trigger_google_scan() -> Dict[str, Any]:
    """Manually trigger a Google scan"""
    return await scan_scheduler.run_google_scan()
