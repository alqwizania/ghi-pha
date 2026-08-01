"""
NocoDB API client for database operations - DabDar v3.0
Enhanced with new schema, deduplication, and query capabilities
"""

import os
import json
import hashlib
import httpx
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import Finding, HealthContext, Priority
from tools.deduplication import generate_content_hash, dedup_service


class NocoDBClientV3:
    """Enhanced NocoDB client for DabDar v3.0"""

    def __init__(self):
        internal_base_url = os.getenv("NOCODB_API_URL", "")
        public_base_url = os.getenv("NC_PUBLIC_URL", "")
        default_base_url = internal_base_url or public_base_url or "http://nocodb:8080"

        self.internal_base_url = self._normalize_base_url(internal_base_url)
        self.public_base_url = self._normalize_base_url(public_base_url)
        self.base_url = (
            self.internal_base_url
            or self.public_base_url
            or self._normalize_base_url(default_base_url)
        )
        self.api_token = os.getenv("NOCODB_API_TOKEN", "")
        self.base_id = os.getenv("NOCODB_BASE_ID", "")
        self.table_id = os.getenv("NOCODB_TABLE_ID", "m0s3bmpa8qzp4eh")
        self.quarantine_table_id = os.getenv(
            "NOCODB_QUARANTINE_TABLE_ID", "mn6vcva5rqv1272"
        )

    @staticmethod
    def _normalize_base_url(value: str) -> str:
        return str(value or "").replace("/api/v1", "").rstrip("/")

    @property
    def base_urls(self) -> List[str]:
        urls: List[str] = []
        for candidate in (
            self.internal_base_url,
            self.public_base_url,
            self.base_url,
        ):
            if candidate and candidate not in urls:
                urls.append(candidate)
        if not urls:
            urls.append("http://nocodb:8080")
        return urls

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Any] = None,
        allow_404: bool = False,
    ) -> Optional[httpx.Response]:
        errors: List[str] = []

        for base_url in self.base_urls:
            url = f"{base_url}{path}"
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.request(
                        method,
                        url,
                        headers=self.headers,
                        params=params,
                        json=json_body,
                    )
                if allow_404 and response.status_code == 404:
                    return None
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as e:
                status_code = e.response.status_code if e.response is not None else "?"
                errors.append(f"{url} -> HTTP {status_code}")
                if e.response is None or status_code not in {502, 503, 504}:
                    raise
            except httpx.RequestError as e:
                errors.append(f"{url} -> {e}")

        if allow_404:
            return None
        raise RuntimeError(
            "NocoDB request failed across configured URLs: " + " | ".join(errors)
        )

    @property
    def headers(self) -> Dict[str, str]:
        return {
            "xc-token": self.api_token,
            "Content-Type": "application/json",
        }

    @staticmethod
    def _finding_risk_value(finding: Dict[str, Any]) -> str:
        return str(finding.get("risk") or finding.get("priority") or "medium")

    @staticmethod
    def _finding_risk_assessment(finding: Dict[str, Any]) -> str:
        return str(finding.get("risk_assessment") or "")

    async def create_finding_v3(
        self, finding: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Create a new finding with v3 schema.

        Args:
            finding: Finding data dictionary

        Returns:
            Created record or None if failed
        """
        # Map to NocoDB schema
        raw_url = finding.get("url", "")
        raw_source_link = finding.get("source_link", "")
        data = {
            "disease": finding.get("disease", "Unknown"),
            "source": finding.get("source", ""),
            "source_type": finding.get("source_type", "changedetection"),
            "source_link": raw_source_link or raw_url,
            "publication_date": finding.get("publication_date")
            or datetime.now().strftime("%Y-%m-%d"),
            "headline": finding.get("headline", ""),
            "short_description_en": finding.get("short_description_en")
            or finding.get("summary", ""),
            "detailed_description_en": finding.get("detailed_description_en", ""),
            "short_description_ar": finding.get("short_description_ar", ""),
            "detailed_description_ar": finding.get("detailed_description_ar", ""),
            "content_hash": finding.get("content_hash", ""),
            "risk": self._finding_risk_value(finding),
            "risk_assessment": self._finding_risk_assessment(finding),
            "notification_sent": finding.get("notification_sent", False),
            # Legacy fields for backward compatibility
            "date": finding.get("publication_date")
            or datetime.now().strftime("%Y-%m-%d"),
            "agency": finding.get("source", ""),
            "summary": finding.get("short_description_en")
            or finding.get("summary", ""),
            "url": raw_url or raw_source_link,
        }

        try:
            response = await self._request(
                "POST",
                f"/api/v2/tables/{self.table_id}/records",
                json_body=data,
            )
            if response is None:
                return None
            return response.json()
        except Exception as e:
            print(f"❌ Error creating finding: {e}")
            return None

    async def query_findings(
        self,
        where: Optional[str] = None,
        sort: str = "-publication_date",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Query findings with flexible filtering.

        Args:
            where: NocoDB where clause
            sort: Sort field (prefix - for descending)
            limit: Max records to return
            offset: Pagination offset

        Returns:
            List of finding records
        """
        params = {
            "limit": limit,
            "offset": offset,
            "sort": sort,
        }

        if where:
            params["where"] = where

        try:
            response = await self._request(
                "GET",
                f"/api/v2/tables/{self.table_id}/records",
                params=params,
            )
            if response is None:
                return []
            data = response.json()
            return data.get("list", [])
        except Exception as e:
            print(f"❌ Error querying findings: {e}")
            return []

    async def patch_records(self, records: List[Dict[str, Any]]) -> bool:
        try:
            response = await self._request(
                "PATCH",
                f"/api/v2/tables/{self.table_id}/records",
                json_body=records,
            )
            return response is not None
        except Exception as e:
            print(f"❌ Error patching records: {e}")
            return False

    async def query_findings_all(
        self,
        where: Optional[str] = None,
        sort: str = "-publication_date",
        page_size: int = 1000,
        max_records: int = 50000,
    ) -> Dict[str, Any]:
        """
        Query findings across all NocoDB pages with a safety cap.

        Args:
            where: NocoDB where clause
            sort: Sort field (prefix - for descending)
            page_size: Records per page request
            max_records: Hard cap to prevent runaway payloads

        Returns:
            Dict with keys:
              - list: aggregated finding records
              - pages_fetched: number of page requests made
              - truncated: True when max_records cap was reached
        """
        if page_size <= 0:
            page_size = 1000
        if max_records <= 0:
            return {
                "list": [],
                "pages_fetched": 0,
                "truncated": False,
            }

        records: List[Dict[str, Any]] = []
        pages_fetched = 0
        offset = 0

        while len(records) < max_records:
            remaining = max_records - len(records)
            batch_limit = min(page_size, remaining)
            batch = await self.query_findings(
                where=where,
                sort=sort,
                limit=batch_limit,
                offset=offset,
            )
            pages_fetched += 1

            if not batch:
                break

            records.extend(batch)

            # End of dataset.
            if len(batch) < batch_limit:
                break

            offset += batch_limit

        return {
            "list": records,
            "pages_fetched": pages_fetched,
            "truncated": len(records) >= max_records,
        }

    async def query_by_disease(
        self, disease: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Query findings by disease name"""
        return await self.query_findings(where=f"(disease,eq,{disease})", limit=limit)

    async def query_by_source(
        self, source: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Query findings by source"""
        return await self.query_findings(where=f"(source,eq,{source})", limit=limit)

    async def query_headlines_by_source(
        self, source: str, limit: int = 2000
    ) -> List[str]:
        """Query headline values by source for pre-resolution filtering."""
        records = await self.query_by_source(source=source, limit=limit)
        headlines: List[str] = []
        for record in records:
            headline = record.get("headline")
            if isinstance(headline, str) and headline.strip():
                headlines.append(headline.strip())
        return headlines

    async def query_by_date_range(
        self, start_date: str, end_date: str, limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Query findings within a date range"""
        return await self.query_findings(
            where=f"(publication_date,btw,{start_date},{end_date})",
            limit=limit,
        )

    async def query_unsent_findings(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Query findings not yet included in email digest"""
        return await self.query_findings(
            where="(notification_sent,eq,false)", limit=limit
        )

    async def query_by_priority(
        self, priority: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Legacy alias: query findings by normalized risk level."""
        return await self.query_findings(where=f"(risk,eq,{priority})", limit=limit)

    async def mark_as_sent(self, record_ids: List[int]) -> bool:
        """
        Mark findings as included in email digest.

        Args:
            record_ids: List of record IDs to update

        Returns:
            True if successful
        """
        records = [{"id": rid, "notification_sent": True} for rid in record_ids]

        try:
            return await self.patch_records(records)
        except Exception as e:
            print(f"❌ Error marking findings as sent: {e}")
            return False

    async def get_statistics(self) -> Dict[str, Any]:
        """Get database statistics"""
        try:
            # Count by priority
            critical = await self.query_by_priority("critical")
            high = await self.query_by_priority("high")
            medium = await self.query_by_priority("medium")
            low = await self.query_by_priority("low")

            # Count unsent
            unsent = await self.query_unsent_findings()

            # Today's findings
            today = datetime.now().strftime("%Y-%m-%d")
            todays_findings = await self.query_findings(
                where=f"(publication_date,eq,exactDate,{today})"
            )

            return {
                "total_critical": len(critical),
                "total_high": len(high),
                "total_medium": len(medium),
                "total_low": len(low),
                "unsent_count": len(unsent),
                "today_count": len(todays_findings),
                "generated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            print(f"❌ Error getting statistics: {e}")
            return {}

    async def get_finding_by_id(self, record_id: int) -> Optional[Dict[str, Any]]:
        """
        Get a specific finding by ID.

        Args:
            record_id: The record ID

        Returns:
            Finding record or None
        """
        try:
            response = await self._request(
                "GET",
                f"/api/v2/tables/{self.table_id}/records/{record_id}",
                allow_404=True,
            )
            if response is None:
                return None
            return response.json()
        except Exception as e:
            print(f"❌ Error getting finding {record_id}: {e}")
            return None

    async def check_duplicate_by_hash(self, content_hash: str) -> bool:
        """
        Check if a finding with this content hash already exists.

        Args:
            content_hash: The content hash to check

        Returns:
            True if duplicate exists
        """
        results = await self.query_findings(
            where=f"(content_hash,eq,{content_hash})",
            limit=1,
        )
        return len(results) > 0

    async def write_finding_v3(
        self, finding: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Alias for create_finding_v3 for consistency.

        Args:
            finding: Finding data dictionary

        Returns:
            Created record or None
        """
        return await self.create_finding_v3(finding)

    async def update_finding_v3(
        self, record_id: int | str, finding: Dict[str, Any]
    ) -> bool:
        """Update an existing finding by record ID."""
        raw_url = finding.get("url", "")
        raw_source_link = finding.get("source_link", "")
        record = {
            "id": record_id,
            "disease": finding.get("disease", "Unknown"),
            "source": finding.get("source", ""),
            "source_type": finding.get("source_type", "changedetection"),
            "source_link": raw_source_link or raw_url,
            "publication_date": finding.get("publication_date")
            or datetime.now().strftime("%Y-%m-%d"),
            "headline": finding.get("headline", ""),
            "short_description_en": finding.get("short_description_en")
            or finding.get("summary", ""),
            "detailed_description_en": finding.get("detailed_description_en", ""),
            "short_description_ar": finding.get("short_description_ar", ""),
            "detailed_description_ar": finding.get("detailed_description_ar", ""),
            "content_hash": finding.get("content_hash", ""),
            "risk": self._finding_risk_value(finding),
            "risk_assessment": self._finding_risk_assessment(finding),
            "date": finding.get("publication_date")
            or datetime.now().strftime("%Y-%m-%d"),
            "agency": finding.get("source", ""),
            "summary": finding.get("short_description_en")
            or finding.get("summary", ""),
            "url": raw_url or raw_source_link,
        }

        try:
            return await self.patch_records([record])
        except Exception as e:
            print(f"❌ Error updating finding {record_id}: {e}")
            return False

    async def create_quarantine_record(
        self,
        finding: Dict[str, Any],
        reason: str,
        source: str,
        source_type: str,
        stage: str,
    ) -> Optional[Dict[str, Any]]:
        """Write a low-quality finding into quarantine table."""
        if not self.quarantine_table_id:
            return None

        headline = (finding.get("headline") or finding.get("title") or "").strip()
        publication_date = (
            finding.get("publication_date")
            or finding.get("date")
            or datetime.now().strftime("%Y-%m-%d")
        )

        location = finding.get("location") or ""
        if not location:
            countries = finding.get("countries") or []
            if isinstance(countries, list) and countries:
                location = ", ".join([str(country) for country in countries if country])

        disease = finding.get("disease", "news") or "news"
        record_seed = (
            f"{source}|{source_type}|{stage}|{publication_date}|{headline}|{reason}"
        )
        quarantine_id = hashlib.sha256(record_seed.encode("utf-8")).hexdigest()[:24]

        payload = {
            "don_id": quarantine_id,
            "date": str(publication_date),
            "location": str(location or ""),
            "disease": str(disease),
            "title": headline[:1000],
            "source": str(source),
            "source_type": str(source_type),
            "stage": str(stage),
            "reason": str(reason)[:255],
            "summary": f"[{source}/{source_type}] Quarantined at {stage}: {reason}",
            "full_content": json.dumps(
                {
                    "reason": reason,
                    "stage": stage,
                    "source": source,
                    "source_type": source_type,
                    "finding": finding,
                },
                ensure_ascii=False,
                default=str,
            )[:15000],
        }

        try:
            response = await self._request(
                "POST",
                f"/api/v2/tables/{self.quarantine_table_id}/records",
                json_body=payload,
            )
            if response is None:
                return None
            return response.json()
        except Exception as e:
            print(f"⚠️ Error writing quarantine record: {e}")
            return None


# Global client instance
nocodb_v3 = NocoDBClientV3()


# Legacy client for backward compatibility
class NocoDBClient:
    """Legacy client for backward compatibility"""

    def __init__(self):
        self.v3 = nocodb_v3

    async def query_findings(self, agency: str, days_back: int = 30, limit: int = 100):
        return await self.v3.query_by_source(agency, limit)

    async def create_finding(self, finding: Finding):
        return await self.v3.create_finding_v3(finding.model_dump())


nocodb_client = NocoDBClient()


@function_tool
async def query_historical_findings(
    ctx: RunContextWrapper[HealthContext], agency: str, days_back: int = 30
) -> str:
    """
    Query historical findings from NocoDB for comparison.

    Args:
        agency: Agency/source name to filter by
        days_back: How many days back to query (default 30)

    Returns:
        JSON string of findings list
    """
    ctx.context.log(
        f"Querying historical findings for {agency} (last {days_back} days)"
    )

    findings = await nocodb_v3.query_by_source(agency)

    ctx.context.log(f"✅ Found {len(findings)} historical findings")

    return json.dumps(findings, default=str)


@function_tool
async def write_finding_to_database(
    ctx: RunContextWrapper[HealthContext], finding_json: str
) -> str:
    """
    Write a finding to NocoDB database with v3 schema.

    Args:
        finding_json: JSON string of Finding object

    Returns:
        Success message with created record ID
    """
    try:
        finding_data = json.loads(finding_json)

        # Generate content hash if not present
        if not finding_data.get("content_hash"):
            finding_data["content_hash"] = generate_content_hash(
                disease=finding_data.get("disease", "Unknown"),
                countries=finding_data.get("countries", []),
                headline=finding_data.get("headline", ""),
            )

        # Check for duplicate
        dedup_result = await dedup_service.check_hash_exists(
            finding_data["content_hash"]
        )
        if dedup_result:
            existing_id = dedup_result.get("Id") or dedup_result.get("id")
            ctx.context.log(f"⚠️ Duplicate found (ID: {existing_id}), skipping")
            return f"Duplicate finding - existing ID: {existing_id}"

        headline = finding_data.get("headline", "")[:50]
        ctx.context.log(f"Writing finding to database: {headline}...")

        result = await nocodb_v3.create_finding_v3(finding_data)

        if result:
            finding_id = result.get("Id") or result.get("id", "unknown")
            ctx.context.log(f"✅ Finding written to database (ID: {finding_id})")
            return f"Finding successfully written with ID: {finding_id}"
        else:
            ctx.context.log(f"❌ Failed to write finding to database")
            return "Failed to write finding to database"

    except json.JSONDecodeError as e:
        ctx.context.log(f"❌ JSON parse error: {e}")
        return f"Failed to parse finding JSON: {e}"
    except Exception as e:
        ctx.context.log(f"❌ Error writing finding: {e}")
        return f"Failed to write finding: {e}"


@function_tool
async def batch_write_findings(
    ctx: RunContextWrapper[HealthContext], findings_json: str
) -> str:
    """
    Write multiple findings to database with deduplication.

    Args:
        findings_json: JSON array of findings

    Returns:
        Summary of write operations
    """
    findings = json.loads(findings_json)

    ctx.context.log(f"📝 Batch writing {len(findings)} findings...")

    written = 0
    duplicates = 0
    errors = 0

    for finding in findings:
        try:
            # Generate hash
            if not finding.get("content_hash"):
                finding["content_hash"] = generate_content_hash(
                    disease=finding.get("disease", "Unknown"),
                    countries=finding.get("countries", []),
                    headline=finding.get("headline", ""),
                )

            # Check duplicate
            existing = await dedup_service.check_hash_exists(finding["content_hash"])
            if existing:
                duplicates += 1
                continue

            # Write
            result = await nocodb_v3.create_finding_v3(finding)
            if result:
                written += 1
            else:
                errors += 1

        except Exception as e:
            ctx.context.log(f"❌ Error: {e}")
            errors += 1

    summary = (
        f"Batch complete: {written} written, {duplicates} duplicates, {errors} errors"
    )
    ctx.context.log(f"✅ {summary}")

    return json.dumps(
        {
            "written": written,
            "duplicates": duplicates,
            "errors": errors,
            "summary": summary,
        }
    )


@function_tool
async def query_findings_by_disease(
    ctx: RunContextWrapper[HealthContext], disease: str, limit: int = 50
) -> str:
    """
    Query findings by disease name.

    Args:
        disease: Disease name to filter by
        limit: Maximum number of results

    Returns:
        JSON array of findings
    """
    ctx.context.log(f"🔍 Querying findings for disease: {disease}")

    findings = await nocodb_v3.query_by_disease(disease, limit)

    ctx.context.log(f"✅ Found {len(findings)} findings for {disease}")

    return json.dumps(findings, default=str)


@function_tool
async def query_unsent_for_digest(
    ctx: RunContextWrapper[HealthContext], limit: int = 100
) -> str:
    """
    Query findings not yet included in email digest.

    Args:
        limit: Maximum number of results

    Returns:
        JSON array of unsent findings
    """
    ctx.context.log("🔍 Querying unsent findings for digest...")

    findings = await nocodb_v3.query_unsent_findings(limit)

    ctx.context.log(f"✅ Found {len(findings)} unsent findings")

    return json.dumps(findings, default=str)


@function_tool
async def mark_findings_as_sent(
    ctx: RunContextWrapper[HealthContext], record_ids_json: str
) -> str:
    """
    Mark findings as included in email digest.

    Args:
        record_ids_json: JSON array of record IDs

    Returns:
        Success/failure message
    """
    record_ids = json.loads(record_ids_json)

    ctx.context.log(f"📧 Marking {len(record_ids)} findings as sent...")

    success = await nocodb_v3.mark_as_sent(record_ids)

    if success:
        ctx.context.log(f"✅ Marked {len(record_ids)} findings as sent")
        return f"Successfully marked {len(record_ids)} findings as sent"
    else:
        ctx.context.log("❌ Failed to mark findings as sent")
        return "Failed to mark findings as sent"


@function_tool
async def get_database_statistics(ctx: RunContextWrapper[HealthContext]) -> str:
    """
    Get database statistics and counts.

    Returns:
        JSON object with statistics
    """
    ctx.context.log("📊 Getting database statistics...")

    stats = await nocodb_v3.get_statistics()

    ctx.context.log(f"✅ Statistics: {stats}")

    return json.dumps(stats)
