"""
Email Digest Workflow for DabDar v3.0
Handles scheduled compilation and sending of email digests
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional

from tools.email_digest import digest_service
from tools.nocodb_client import nocodb_v3


async def compile_email_digest(interval: str = None) -> dict:
    """
    Compile unsent findings into an email digest.

    Args:
        interval: "daily" | "6hours" | "hourly"

    Returns:
        {
            "findings": [...],
            "html_content_en": "...",
            "html_content_ar": "...",
            "statistics": {...}
        }

    Process:
    1. Query findings where notification_sent = false
    2. Group by disease, priority, source
    3. Generate bilingual HTML digest
    4. Return digest ready for sending
    """
    interval = interval or os.getenv("DIGEST_INTERVAL", "daily")

    print(f"📧 Compiling {interval} email digest...")

    digest = await digest_service.compile_digest(interval)

    return {
        "digest_id": digest.digest_id,
        "period": digest.period,
        "findings": digest.findings,
        "html_content_en": digest.html_content_en,
        "html_content_ar": digest.html_content_ar,
        "statistics": {
            "total_findings": digest.total_findings,
            "critical_count": digest.critical_count,
            "high_count": digest.high_count,
            "medium_count": digest.medium_count,
            "low_count": digest.low_count,
        },
        "recipients": digest.recipients,
    }


async def send_email_digest(interval: str = None) -> dict:
    """
    Compile and send email digest via n8n.

    Args:
        interval: Digest interval

    Returns:
        Result dict with success status
    """
    interval = interval or os.getenv("DIGEST_INTERVAL", "daily")

    # Compile digest
    digest = await digest_service.compile_digest(interval)

    if digest.total_findings == 0:
        print("ℹ️ No findings to send in digest")
        return {
            "success": True,
            "message": "No new findings to send",
            "findings_sent": 0,
        }

    # Send to n8n
    success = await digest_service.send_to_n8n(digest)

    if success:
        # Mark findings as sent
        await digest_service.mark_findings_sent(digest.findings)

        print(
            f"✅ Digest sent: {digest.total_findings} findings to {len(digest.recipients)} recipients"
        )

        return {
            "success": True,
            "message": f"Digest sent successfully",
            "findings_sent": digest.total_findings,
            "recipients": digest.recipients,
            "digest_id": digest.digest_id,
        }
    else:
        print("❌ Failed to send digest")
        return {
            "success": False,
            "message": "Failed to send digest via n8n",
            "findings_sent": 0,
        }


class DigestScheduler:
    """Scheduler for periodic email digests"""

    def __init__(self):
        self.interval = os.getenv("DIGEST_INTERVAL", "daily")
        self.daily_hour = int(os.getenv("DIGEST_SCHEDULE_HOUR", "19"))
        self.running = False

    def get_interval_hours(self) -> int:
        """Get interval in hours"""
        if self.interval == "hourly":
            return 1
        elif self.interval == "6hours":
            return 6
        else:  # daily
            return 24

    async def should_send_now(self) -> bool:
        """Check if digest should be sent now based on interval"""
        now = datetime.now()

        if self.interval == "daily":
            # Send at configured hour
            return now.hour == self.daily_hour and now.minute < 5
        elif self.interval == "6hours":
            # Send at 00:00, 06:00, 12:00, 18:00
            return now.hour in [0, 6, 12, 18] and now.minute < 5
        elif self.interval == "hourly":
            # Send at start of every hour
            return now.minute < 5

        return False

    async def run(self):
        """Run the digest scheduler"""
        self.running = True
        print(f"📅 Digest scheduler started (interval: {self.interval})")

        while self.running:
            try:
                if await self.should_send_now():
                    print(
                        f"⏰ Triggering scheduled digest at {datetime.now().strftime('%H:%M')}"
                    )
                    await send_email_digest(self.interval)

                    # Wait until next check period to avoid duplicate sends
                    await asyncio.sleep(300)  # 5 minutes
                else:
                    # Check every minute
                    await asyncio.sleep(60)

            except Exception as e:
                print(f"❌ Scheduler error: {e}")
                await asyncio.sleep(60)

    def stop(self):
        """Stop the scheduler"""
        self.running = False
        print("📅 Digest scheduler stopped")


# Global scheduler instance
digest_scheduler = DigestScheduler()
