"""
FastAPI server with webhook endpoints and email scheduling
SehaRadar v1.0 - Health Surveillance System

v1.0 Features:
- Dynamic source loading from source_registry
- Single source of truth for all source configuration
- Unified health surveillance automation
- Bilingual reporting (English/Arabic)
"""

import asyncio
from collections import defaultdict
import json
import os
import subprocess
from datetime import datetime, timedelta
from typing import Dict, Optional, List, Any

from dotenv import load_dotenv

load_dotenv(override=True)

from fastapi import (
    FastAPI,
    HTTPException,
    BackgroundTasks,
    Query,
    Body,
    Request,
    Header,
)
from fastapi.responses import (
    StreamingResponse,
    HTMLResponse,
    FileResponse,
    RedirectResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
import httpx

from workflows import (
    send_email_digest,
    digest_scheduler,
    trigger_google_scan,
    unified_scan_workflow,
    run_scheduled_scan,
    reclassify_unclassified,
)

from health_agents.shared.source_registry import source_registry
from tools.syncdetection_payload import (
    parse_changedetection_payload,
    is_webhook_authenticated,
)
from tools.syncdetection_store import init_syncdetection_store
from tools.openai_client import configure_agents_sdk_for_openrouter

from tools.geocoder import get_geocoder

# FastAPI app
app = FastAPI(
    title="SehaRadar - Health Surveillance System",
    description="AI-powered health surveillance system with unified source configuration, epidemiological analysis, and bilingual reporting",
    version="1.0.0",
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# Request models
class DigestRequest(BaseModel):
    """Request for email digest"""

    interval: str = "daily"  # hourly, 6hours, daily


class ScanRequest(BaseModel):
    """Request for manual scan"""

    days_back: int = 7
    disease: Optional[str] = None  # For Google scan


class ScanTestRequest(BaseModel):
    """Request for targeted test scan"""

    watch_uuids: Optional[List[str]] = None


class FindingsQueryRequest(BaseModel):
    """Request for querying findings"""

    disease: Optional[str] = None
    source: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    priority: Optional[str] = None
    limit: int = 50


class FindingRiskUpdateRequest(BaseModel):
    """Manual risk update payload for a finding."""

    risk: str
    risk_assessment: str = ""


# Statistics tracking
statistics = {
    "daily_reports_generated": 0,
    "daily_email_runs": 0,
    "digests_sent": 0,
    "unified_scans": 0,
    "google_scans": 0,
    "findings_stored": 0,
    "cd_webhooks_received": 0,
    "cd_webhooks_rejected": 0,
    "cd_events_queued": 0,
    "cd_events_deduplicated": 0,
    "cd_events_processed": 0,
    "cd_events_failed": 0,
    "cd_events_dead_letter": 0,
    "cd_reconcile_enqueued": 0,
    "uptime_start": datetime.now().isoformat(),
}

RISK_ORDER = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "no_risk": 4,
    "unclassified": 5,
}

RISK_LABEL_PREFIX = {
    "critical": "Critical risk.",
    "high": "High risk.",
    "medium": "Medium risk.",
    "low": "Low risk.",
    "no_risk": "No risk.",
    "unclassified": "Unclassified risk.",
}


def normalize_risk_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if not normalized:
        return None
    if normalized in {"critical", "very high", "severe"}:
        return "critical"
    if normalized == "high":
        return "high"
    if normalized in {"medium", "moderate", "moderate risk"}:
        return "medium"
    if normalized in {"low", "low risk"}:
        return "low"
    if normalized in {"no risk", "none", "minimal", "no_risk", "no-risk"}:
        return "no_risk"
    if normalized in {"unclassified", "unknown", "not assessed", "pending"}:
        return "unclassified"
    return None


def extract_risk_assessment_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value).strip()
    if isinstance(value, list):
        for item in value:
            extracted = extract_risk_assessment_text(item)
            if extracted:
                return extracted
        return ""
    if isinstance(value, dict):
        for key in (
            "risk_assessment",
            "assessment",
            "risk_level",
            "level",
            "name",
            "title",
            "label",
            "value",
            "status",
        ):
            extracted = extract_risk_assessment_text(value.get(key))
            if extracted:
                return extracted
        return ""
    return str(value).strip()


def risk_from_assessment_text(text: Any) -> Optional[str]:
    value = extract_risk_assessment_text(text)
    if not value:
        return None
    normalized = value.lower()
    direct_match = normalize_risk_value(normalized)
    if direct_match:
        return direct_match
    if not normalized:
        return None
    if "no risk" in normalized or "minimal risk" in normalized:
        return "no_risk"
    if "critical risk" in normalized or "very high risk" in normalized:
        return "critical"
    if "high risk" in normalized:
        return "high"
    if "moderate risk" in normalized or "medium risk" in normalized:
        return "medium"
    if "low risk" in normalized:
        return "low"
    if "unclassified risk" in normalized:
        return "unclassified"
    return None


def get_finding_risk(record: Dict[str, Any]) -> str:
    assessment = extract_risk_assessment_text(record.get("risk_assessment"))
    if assessment:
        return risk_from_assessment_text(assessment) or "unclassified"

    normalized = normalize_risk_value(record.get("risk") or record.get("priority"))
    return normalized or "unclassified"


def normalize_risk_assessment(risk: str, assessment: str) -> str:
    cleaned = extract_risk_assessment_text(assessment)
    if not cleaned:
        return ""
    if risk_from_assessment_text(cleaned):
        return cleaned
    prefix = RISK_LABEL_PREFIX.get(risk, "Unclassified risk.")
    return f"{prefix} {cleaned}"


def build_nocodb_data_source_metadata(client: Any) -> Dict[str, str]:
    return {
        "kind": "nocodb",
        "label": "NocoDB",
        "table": "findings",
        "base_id": client.base_id or "",
        "table_id": client.table_id,
        "risk_field": "risk",
        "risk_assessment_field": "risk_assessment",
    }


# Global scan scheduler (initialized in startup with callback)
scan_scheduler = None
syncdetection_worker = None
syncdetection_store = None
syncdetection_auto_sync_task = None


# Dashboard service definitions
SERVICES = {"seha-radar": "seha-radar", "changedetection": "changedetection"}

# Trace log file path
TRACE_LOG_PATH = os.getenv("TRACE_FILE_PATH", "/tmp/seha-radar-trace.log")


def _env_bool(name: str, default: bool = False) -> bool:
    default_text = "true" if default else "false"
    return os.getenv(name, default_text).lower() == "true"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _increment_stat(key: str, increment: int = 1) -> None:
    statistics[key] = statistics.get(key, 0) + increment


def _sanitize_payload_for_storage(payload: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = json.loads(json.dumps(payload, default=str))
    for key in ("token", "webhook_token", "secret"):
        cleaned.pop(key, None)

    meta = cleaned.get("meta")
    if isinstance(meta, dict):
        for key in ("token", "webhook_token", "secret"):
            meta.pop(key, None)

    return cleaned


async def _ensure_syncdetection_store():
    global syncdetection_store

    if syncdetection_store is None:
        db_path = os.getenv("SYNCDETECTION_DB_PATH", "/tmp/syncdetection.db")
        syncdetection_store = await init_syncdetection_store(db_path=db_path)
    return syncdetection_store


async def _enqueue_webhook_event(
    payload: Dict[str, Any],
    header_token: Optional[str],
    query_token: Optional[str],
    fallback_watch_uuid: Optional[str] = None,
) -> Dict[str, Any]:
    if not _env_bool("SYNCDETECTION_ENABLED", default=True):
        raise HTTPException(status_code=503, detail="SyncDetection is disabled")

    expected_token = os.getenv("CHANGEDETECTION_WEBHOOK_TOKEN", "")
    if not is_webhook_authenticated(
        expected_token=expected_token,
        header_token=header_token,
        query_token=query_token,
        payload=payload,
    ):
        _increment_stat("cd_webhooks_rejected")
        raise HTTPException(status_code=401, detail="Invalid webhook token")

    from tools.changedetection_client import changedetection_client

    try:
        parsed = await parse_changedetection_payload(
            payload=payload,
            changedetection_client=changedetection_client,
            fallback_watch_uuid=fallback_watch_uuid,
        )
    except ValueError as exc:
        _increment_stat("cd_webhooks_rejected")
        raise HTTPException(status_code=400, detail=str(exc))

    source = source_registry.get_by_uuid(parsed.watch_uuid)
    reject_unknown = _env_bool("SYNCDETECTION_REJECT_UNKNOWN_WATCH", default=False)
    if not source and reject_unknown:
        _increment_stat("cd_webhooks_rejected")
        raise HTTPException(
            status_code=400,
            detail=f"Unknown watch_uuid: {parsed.watch_uuid}",
        )

    store = await _ensure_syncdetection_store()
    enqueue_result = await store.enqueue_event(
        watch_uuid=parsed.watch_uuid,
        last_changed=parsed.last_changed,
        payload=_sanitize_payload_for_storage(payload),
    )

    if enqueue_result.deduplicated:
        _increment_stat("cd_events_deduplicated")
    else:
        _increment_stat("cd_events_queued")

    return {
        "accepted": True,
        "watch_uuid": parsed.watch_uuid,
        "event_key": enqueue_result.event_key,
        "deduplicated": enqueue_result.deduplicated,
        "queued": enqueue_result.queued,
        "source_id": source.id if source else None,
        "timestamp": datetime.now().isoformat(),
    }


# ===== HEALTH & STATUS ENDPOINTS =====


@app.get("/status")
async def status():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "SehaRadar",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat(),
        "statistics": statistics,
    }


@app.get("/stats")
async def stats():
    """Statistics endpoint"""
    return statistics


# ===== API ENDPOINTS =====


@app.post("/api/trigger-digest")
async def api_trigger_digest(
    request: DigestRequest,
    background_tasks: BackgroundTasks,
):
    """
    Trigger email digest compilation and sending

    Args:
        request: DigestRequest with interval (hourly, 6hours, daily)

    Returns:
        Status message
    """
    print(f"\n📧 Digest triggered: {request.interval}")

    async def send_digest():
        try:
            result = await send_email_digest(request.interval)
            if result.get("success"):
                statistics["digests_sent"] += 1
            print(f"✅ Digest result: {result}")
        except Exception as e:
            print(f"❌ Digest failed: {e}")

    background_tasks.add_task(send_digest)

    return {
        "status": "accepted",
        "message": f"Email digest ({request.interval}) triggered",
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/scan-google")
async def api_scan_google(
    background_tasks: BackgroundTasks,
    request: Optional[ScanRequest] = None,
):
    """
    Trigger Google search scan

    Returns:
        Scan result
    """
    disease = request.disease if request else None
    print(f"\n🔍 Google scan triggered (disease={disease or 'ALL'})")

    async def run_scan():
        try:
            result = await trigger_google_scan()
            statistics["google_scans"] += 1
            if result.get("stored"):
                statistics["findings_stored"] += result["stored"]
            print(f"✅ Google scan result: {result}")
        except Exception as e:
            print(f"❌ Google scan failed: {e}")

    background_tasks.add_task(run_scan)

    return {
        "status": "accepted",
        "message": "Google scan triggered",
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/scan-unified")
async def api_scan_unified(background_tasks: BackgroundTasks):
    """
    Trigger unified scan from ChangeDetection.io sources.

    This is the primary scan method that uses ChangeDetection.io
    as the single source of truth for all website monitoring.

    Returns:
        Scan result
    """
    print(f"\n🔄 Unified scan triggered (ChangeDetection.io)")

    async def run_scan():
        try:
            result = await run_scheduled_scan()
            statistics["unified_scans"] += 1  # Track unified scans
            if result.get("stored"):
                statistics["findings_stored"] += result["stored"]
            print(f"✅ Unified scan result: {result}")
        except Exception as e:
            print(f"❌ Unified scan failed: {e}")

    background_tasks.add_task(run_scan)

    return {
        "status": "accepted",
        "message": "Unified scan (ChangeDetection.io) triggered",
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/scan-test")
async def api_scan_test(
    background_tasks: BackgroundTasks,
    max_sources: int = Query(
        5, description="Number of sources to test (default 5)", ge=1, le=20
    ),
    request: Optional[ScanTestRequest] = Body(default=None),
):
    """
    Trigger a lightweight test scan on a small subset of sources.

    Processes ``max_sources`` sources (default 5: 3 CD + 2 RSSHub) through
    the full pipeline (parse -> analyze -> translate -> dedup -> store)
    without running the entire 40+ source scan.

    Optional JSON body:
        {"watch_uuids": ["uuid1", "uuid2", ...]}

    When ``watch_uuids`` is provided, scan_test runs only those specific
    ChangeDetection.io watches and skips RSSHub.
    """
    watch_uuids = request.watch_uuids if request else None
    if watch_uuids:
        print(
            f"\n🧪 Test scan triggered ({len(watch_uuids)} explicit watches)",
            flush=True,
        )
    else:
        print(f"\n🧪 Test scan triggered ({max_sources} sources)", flush=True)

    async def run_test():
        try:
            result = await unified_scan_workflow.scan_test(
                max_sources=max_sources,
                watch_uuids=watch_uuids,
            )
            statistics["unified_scans"] += 1
            if result.get("stored"):
                statistics["findings_stored"] += result["stored"]
            print(f"🧪 Test scan result: {result}")
        except Exception as e:
            print(f"❌ Test scan failed: {e}")

    background_tasks.add_task(run_test)

    return {
        "status": "accepted",
        "message": (
            f"Test scan triggered ({len(watch_uuids)} explicit watches)"
            if watch_uuids
            else f"Test scan triggered ({max_sources} sources)"
        ),
        "test_mode": True,
        "max_sources": max_sources,
        "watch_uuids": watch_uuids or [],
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/webhook/changedetection", status_code=202)
async def webhook_changedetection(
    request: Request,
    token: Optional[str] = Query(None),
    x_webhook_token: Optional[str] = Header(default=None, alias="X-Webhook-Token"),
):
    """Ingest ChangeDetection notifications into the durable event queue."""
    _increment_stat("cd_webhooks_received")

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {"raw_payload": str(payload)}

    response = await _enqueue_webhook_event(
        payload=payload,
        header_token=x_webhook_token,
        query_token=token,
    )
    return response


@app.post("/webhook/changedetection/{token_value}", status_code=202)
async def webhook_changedetection_with_path_token(
    token_value: str,
    request: Request,
):
    """Ingest ChangeDetection notifications using token in URL path.

    This supports Apprise JSON notifications, which do not preserve arbitrary
    query parameters like ``token`` in all versions/configurations.
    """
    _increment_stat("cd_webhooks_received")

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {"raw_payload": str(payload)}

    response = await _enqueue_webhook_event(
        payload=payload,
        header_token=None,
        query_token=token_value,
    )
    return response


@app.post("/webhook/{source_id}", status_code=202)
async def webhook_changedetection_source(
    source_id: str,
    request: Request,
    token: Optional[str] = Query(None),
    x_webhook_token: Optional[str] = Header(default=None, alias="X-Webhook-Token"),
):
    """Compatibility webhook endpoint that maps source_id to watch_uuid."""
    _increment_stat("cd_webhooks_received")

    source = source_registry.get(source_id)
    if not source:
        source = source_registry.get(source_id.upper())
    if not source:
        _increment_stat("cd_webhooks_rejected")
        raise HTTPException(status_code=404, detail=f"Unknown source_id: {source_id}")
    if not source.watch_uuid:
        _increment_stat("cd_webhooks_rejected")
        raise HTTPException(
            status_code=400,
            detail=f"source_id '{source.id}' has no watch_uuid",
        )

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {"raw_payload": str(payload)}

    payload.setdefault("source_id", source.id)
    response = await _enqueue_webhook_event(
        payload=payload,
        header_token=x_webhook_token,
        query_token=token,
        fallback_watch_uuid=source.watch_uuid,
    )
    response["source_id"] = source.id
    return response


@app.post("/api/reclassify")
async def api_reclassify(
    background_tasks: BackgroundTasks,
    limit: int = Query(200, description="Max records to process"),
    dry_run: bool = Query(False, description="Classify only, do not write back to DB"),
    concurrency: int = Query(
        5, description="Max parallel LLM calls (1-10)", ge=1, le=10
    ),
):
    """
    Re-classify existing findings whose disease is unidentified ('news' / 'Unknown').

    Uses the LLM-primary classifier to identify the disease from the stored
    headline and description, then patches the record in NocoDB.

    Query Parameters:
        limit:       Max records to process (default 200)
        dry_run:     Set true to preview without writing changes
        concurrency: Parallel LLM calls (default 5, max 10)
    """
    print(
        f"\n🔬 Reclassify triggered — limit={limit}, dry_run={dry_run}, concurrency={concurrency}"
    )

    result_container: Dict[str, Any] = {}

    async def run_reclassify():
        try:
            result = await reclassify_unclassified(
                limit=limit, dry_run=dry_run, concurrency=concurrency
            )
            result_container.update(result)
            statistics["unified_scans"] += 1
            print(f"✅ Reclassify complete: {result}")
        except Exception as e:
            print(f"❌ Reclassify failed: {e}")

    background_tasks.add_task(run_reclassify)

    return {
        "status": "accepted",
        "message": f"Reclassify job started (limit={limit}, dry_run={dry_run}, concurrency={concurrency}). Check server logs for progress.",
        "timestamp": datetime.now().isoformat(),
    }


async def api_get_findings(
    disease: Optional[str] = Query(None, description="Filter by disease"),
    source: Optional[str] = Query(None, description="Filter by source"),
    risk: Optional[str] = Query(None, description="Filter by risk"),
    priority: Optional[str] = Query(None, description="Legacy filter alias for risk"),
    limit: int = Query(50, description="Max results"),
):
    """
    Query findings from database

    Returns:
        List of findings
    """
    try:
        from tools.nocodb_client import nocodb_v3

        # Build where clause
        conditions = []
        if disease:
            conditions.append(f"(disease,eq,{disease})")
        if source:
            conditions.append(f"(source,eq,{source})")
        selected_risk = normalize_risk_value(risk or priority)
        if selected_risk:
            conditions.append(f"(risk,eq,{selected_risk})")

        where = "~and".join(conditions) if conditions else None

        findings = await nocodb_v3.query_findings(
            where=where,
            limit=limit,
        )

        return {
            "count": len(findings),
            "findings": findings,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/findings/{finding_id}")
async def api_get_finding(finding_id: int):
    """
    Get a specific finding by ID

    Returns:
        Finding details
    """
    try:
        from tools.nocodb_client import nocodb_v3

        finding = await nocodb_v3.get_finding_by_id(finding_id)
        if not finding:
            raise HTTPException(status_code=404, detail="Finding not found")

        return finding
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/findings/{finding_id}/risk")
async def api_update_finding_risk(
    finding_id: int,
    payload: FindingRiskUpdateRequest,
):
    """Manually update a finding's normalized risk and risk assessment."""
    try:
        from tools.nocodb_client import nocodb_v3

        risk_value = normalize_risk_value(payload.risk)
        if not risk_value:
            raise HTTPException(status_code=400, detail="Invalid risk value")

        updates = {
            "risk": risk_value,
            "risk_assessment": normalize_risk_assessment(
                risk_value,
                payload.risk_assessment,
            ),
        }
        ok = await nocodb_v3.patch_records([{"id": finding_id, **updates}])
        if not ok:
            raise HTTPException(status_code=502, detail="Failed to update finding risk")

        updated = await nocodb_v3.get_finding_by_id(finding_id)
        return {
            "ok": True,
            "finding": updated or {"id": finding_id, **updates},
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/statistics")
async def api_get_statistics():
    """
    Get comprehensive system statistics

    Returns:
        Statistics including database counts
    """
    try:
        from tools.nocodb_client import nocodb_v3

        db_stats = await nocodb_v3.get_statistics()

        return {
            "server": statistics,
            "database": db_stats,
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        return {
            "server": statistics,
            "database": {"error": str(e)},
            "timestamp": datetime.now().isoformat(),
        }


@app.get("/api/diseases")
async def api_get_diseases():
    """
    Get configured diseases list

    Returns:
        List of configured diseases
    """
    try:
        config_path = os.path.join(os.path.dirname(__file__), "config", "diseases.json")
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)

        return {
            "diseases": config.get("diseases", []),
            "count": len(config.get("diseases", [])),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sources")
async def api_get_sources(
    enabled_only: bool = Query(False, description="Only return enabled sources"),
    source_type: Optional[str] = Query(None, description="Filter by source type"),
):
    """
    Get configured sources from source registry (SehaRadar v1.0)

    Query Parameters:
        enabled_only: Only return enabled sources
        source_type: Filter by type (changedetection, rss, google_search)

    Returns:
        List of configured sources with metadata
    """
    try:
        if enabled_only:
            sources = source_registry.list_enabled()
        else:
            sources = source_registry.list_all()

        # Filter by type if specified
        if source_type:
            from health_agents.shared.source_registry import SourceType

            try:
                st = SourceType(source_type)
                sources = [s for s in sources if s.type == st]
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid source_type. Must be one of: changedetection, rss, google_search",
                )

        # Convert to dict for JSON serialization
        sources_data = [
            {
                "id": s.id,
                "name": s.name,
                "type": s.type.value,
                "url": s.url,
                "watch_uuid": s.watch_uuid,
                "parser": s.parser,
                "enabled": s.enabled,
                "tags": s.tags,
            }
            for s in sources
        ]

        return {
            "sources": sources_data,
            "count": len(sources_data),
            "statistics": source_registry.get_statistics(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sources/{source_id}")
async def api_get_source(source_id: str):
    """
    Get details for a specific source

    Path Parameters:
        source_id: Source ID (e.g., WHO, CDC, PROMED)

    Returns:
        Source configuration details
    """
    source = source_registry.get(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source not found: {source_id}")

    return {
        "id": source.id,
        "name": source.name,
        "type": source.type.value,
        "url": source.url,
        "watch_uuid": source.watch_uuid,
        "parser": source.parser,
        "check_interval": source.check_interval,
        "config": source.config,
        "enabled": source.enabled,
        "priority_boost": source.priority_boost,
        "tags": source.tags,
    }


@app.post("/api/sources/reload")
async def api_reload_sources():
    """
    Reload source configuration from config/sources.json (SehaRadar v1.0)

    This allows hot-reloading of source configuration without container restart.

    Returns:
        Reload status and updated statistics
    """
    try:
        source_registry.reload()

        return {
            "status": "reloaded",
            "timestamp": datetime.now().isoformat(),
            "statistics": source_registry.get_statistics(),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to reload sources: {str(e)}"
        )


@app.get("/api/digest-preview")
async def api_preview_digest():
    """
    Preview next email digest without sending

    Returns:
        Digest preview
    """
    try:
        from tools.email_digest import digest_service

        digest = await digest_service.compile_digest()

        return {
            "total_findings": digest.total_findings,
            "critical_count": digest.critical_count,
            "high_count": digest.high_count,
            "medium_count": digest.medium_count,
            "low_count": digest.low_count,
            "would_send_to": digest.recipients,
            "html_preview": digest.html_content_en[:2000] + "..."
            if len(digest.html_content_en) > 2000
            else digest.html_content_en,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===== FLOWCHART ENDPOINTS =====


@app.get("/flowchart", response_class=HTMLResponse)
@app.get("/flowchart/", response_class=HTMLResponse)
async def system_flowchart():
    """System architecture flowchart at https://seha-radar.fayaa92.sa/flowchart"""
    path = os.path.join(os.path.dirname(__file__), "docs", "flowchart.html")
    with open(path, "r") as f:
        return f.read()


@app.get("/api/logs/{service}")
async def get_logs(service: str, tail: int = 50):
    """Fetch recent logs for a service"""
    if service not in SERVICES:
        raise HTTPException(status_code=404, detail="Service not found")

    container_name = SERVICES[service]
    try:
        # Using tail to get recent logs
        result = subprocess.run(
            ["docker", "logs", "--tail", str(tail), container_name],
            capture_output=True,
            text=True,
            check=True,
        )
        return {"service": service, "logs": result.stdout + result.stderr}
    except Exception as e:
        # Fallback for dev environment where docker might not be accessible
        return {
            "service": service,
            "logs": f"Error accessing logs: {str(e)}\n\n"
            f"--- MOCK LOGS (Dev Mode) ---\n"
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] Starting log stream for {service}...\n"
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [DEBUG] Polling for new events...\n",
        }


@app.get("/api/trace-logs")
async def get_trace_logs(tail: int = 100):
    """Fetch agent trace logs from file"""
    try:
        if not os.path.exists(TRACE_LOG_PATH):
            return {
                "logs": "Trace log file not found. Make sure TRACE_TO_FILE=true in .env\n\n"
                f"Expected path: {TRACE_LOG_PATH}\n"
                "Enable tracing by setting TRACE_TO_FILE=true and restart the container."
            }

        # Read last N lines from trace log
        with open(TRACE_LOG_PATH, "r") as f:
            lines = f.readlines()
            recent_lines = lines[-tail:] if len(lines) > tail else lines
            return {"logs": "".join(recent_lines)}
    except Exception as e:
        return {
            "logs": f"Error reading trace log: {str(e)}\n\n"
            f"Path: {TRACE_LOG_PATH}\n"
            "Make sure TRACE_TO_FILE=true in .env and the container has been restarted."
        }


@app.get("/api/stream/{service}")
async def stream_logs(service: str):
    """Stream logs via SSE"""
    if service not in SERVICES:
        raise HTTPException(status_code=404, detail="Service not found")

    async def log_generator():
        container_name = SERVICES[service]
        # Start docker logs -f
        process = await asyncio.create_subprocess_exec(
            "docker",
            "logs",
            "-f",
            "--tail",
            "10",
            container_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        try:
            if process.stdout:
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    yield f"data: {line.decode().strip()}\n\n"
        except Exception as e:
            yield f"data: Error during streaming: {str(e)}\n\n"
        finally:
            if process.returncode is None:
                process.terminate()

    return StreamingResponse(log_generator(), media_type="text/event-stream")


@app.get("/api/stats")
async def proxy_stats():
    """Return stats for dashboard (reuse existing stats)"""
    return {"status": "online", "statistics": statistics}


# ===== SCHEDULERS =====


async def daily_email_scheduler():
    """
    Background task that sends a daily digest at configured hour.

    This replaces the legacy daily narrative report scheduler.
    Default: 19:00 (7:00 PM)
    """
    email_hour = int(
        os.getenv("DAILY_EMAIL_SCHEDULE_HOUR", os.getenv("REPORT_SCHEDULE_HOUR", "19"))
    )
    email_interval = os.getenv("DAILY_EMAIL_INTERVAL", "daily")

    print(
        f"📅 Daily email scheduler started "
        f"(scheduled for {email_hour}:00, interval: {email_interval})"
    )

    while True:
        try:
            now = datetime.now()

            # Check if it's the scheduled hour
            if now.hour == email_hour and now.minute == 0:
                print(
                    f"\n⏰ Triggering scheduled daily email at {now.strftime('%H:%M')}"
                )

                try:
                    result = await send_email_digest(email_interval)
                    statistics["daily_email_runs"] += 1
                    # Backward-compatible metric key used by older dashboards.
                    statistics["daily_reports_generated"] += 1

                    if result.get("success") and result.get("findings_sent", 0) > 0:
                        statistics["digests_sent"] += 1

                    print(f"✅ Scheduled daily email result: {result}")
                except Exception as e:
                    print(f"❌ Scheduled daily email failed: {str(e)}")

                # Sleep for 60 minutes to avoid multiple triggers in the same hour
                await asyncio.sleep(3600)

            # Check every minute
            await asyncio.sleep(60)

        except Exception as e:
            print(f"❌ Scheduler error: {str(e)}")
            await asyncio.sleep(60)


@app.on_event("startup")
async def startup_event():
    """Start background tasks on startup"""
    openrouter_configured = configure_agents_sdk_for_openrouter()

    # Configure agent handoffs
    from health_agents.configure_handoffs import configure_agent_handoffs
    from workflows.periodic_scan_workflow import ScanScheduler

    configure_agent_handoffs()

    print("\n" + "=" * 80)
    print("🚀 SEHARADAR v1.0 HEALTH SURVEILLANCE SYSTEM STARTING")
    print("=" * 80)
    print(f"Server Port: {os.getenv('SERVER_PORT', '8080')}")
    print(f"Log Level: {os.getenv('LOG_LEVEL', 'info')}")
    print(
        "Daily Email Hour: "
        f"{os.getenv('DAILY_EMAIL_SCHEDULE_HOUR', os.getenv('REPORT_SCHEDULE_HOUR', '19'))}:00"
    )
    print(
        "Daily Email Scheduler Enabled: "
        f"{os.getenv('DAILY_EMAIL_SCHEDULER_ENABLED', 'false')}"
    )
    print(f"Digest Interval: {os.getenv('DIGEST_INTERVAL', 'daily')}")
    print(f"Digest Hour: {os.getenv('DIGEST_SCHEDULE_HOUR', '19')}:00")
    print(f"Google Scan Hour: {os.getenv('GOOGLE_SCAN_HOUR', '8')}:00")
    print(f"Retry Count: {os.getenv('RETRY_COUNT', '3')}")
    print(f"SQLite Path: {os.getenv('SQLITE_PATH', '/tmp/agents_sessions.db')}")
    if openrouter_configured:
        print("OpenRouter SDK: configured")
    else:
        print("OpenRouter SDK: not configured (LLM-dependent scans disabled)")
    print("=" * 80)
    print("API Endpoints (v1.0):")
    print("  POST /api/trigger-digest  - Send email digest")
    print("  POST /api/scan-google     - Trigger Google scan")
    print("  POST /api/scan-unified    - Unified scan (ChangeDetection.io) ⭐")
    print("  POST /api/scan-test       - Test scan (5-source subset) 🧪")
    print("  POST /webhook/changedetection - ChangeDetection webhook")
    print("  POST /webhook/changedetection/{token} - Apprise-compatible webhook")
    print("  POST /webhook/{source_id} - Source webhook compatibility")
    print("  GET  /api/findings        - Query findings")
    print("  GET  /api/statistics      - System statistics")
    print("  GET  /api/diseases        - Configured diseases")
    print("  GET  /api/digest-preview  - Preview next digest")
    print("=" * 80 + "\n")

    # Start daily email scheduler (disabled by default)
    if os.getenv("DAILY_EMAIL_SCHEDULER_ENABLED", "false").lower() == "true":
        asyncio.create_task(daily_email_scheduler())

    # Start DabDar v3.0 schedulers
    if os.getenv("DIGEST_SCHEDULER_ENABLED", "true").lower() == "true":
        asyncio.create_task(digest_scheduler.run())

    # Initialize scan scheduler with statistics callback
    global scan_scheduler, syncdetection_worker, syncdetection_auto_sync_task

    scan_scheduler = ScanScheduler(statistics_callback=_increment_stat)

    if os.getenv("PERIODIC_SCAN_ENABLED", "true").lower() == "true":
        asyncio.create_task(scan_scheduler.run())

    if _env_bool("SYNCDETECTION_ENABLED", default=True):
        from workflows.syncdetection_worker import SyncDetectionWorker
        from tools.changedetection_client import changedetection_client

        store = await _ensure_syncdetection_store()
        syncdetection_worker = SyncDetectionWorker(
            store=store,
            unified_scan_workflow=unified_scan_workflow,
            changedetection_client=changedetection_client,
            statistics_callback=_increment_stat,
            worker_concurrency=_env_int("SYNCDETECTION_WORKER_CONCURRENCY", 2),
            max_retries=_env_int("SYNCDETECTION_MAX_RETRIES", 5),
            retry_base_seconds=_env_int("SYNCDETECTION_RETRY_BASE_SECONDS", 15),
            reconcile_interval_seconds=_env_int(
                "SYNCDETECTION_RECONCILE_INTERVAL_SECONDS", 300
            ),
            poll_interval_seconds=_env_float(
                "SYNCDETECTION_POLL_INTERVAL_SECONDS", 2.0
            ),
        )
        syncdetection_worker.start()

        if _env_bool("SYNCDETECTION_AUTO_SYNC_WEBHOOKS", default=False):
            from tools.syncdetection_watch_sync import (
                build_canonical_webhook_url,
                sync_watch_webhooks,
            )

            base_url = os.getenv("PUBLIC_BASE_URL", "")
            webhook_url = build_canonical_webhook_url(
                base_url,
                token=os.getenv("CHANGEDETECTION_WEBHOOK_TOKEN", ""),
            )

            async def _run_auto_sync() -> None:
                if not webhook_url:
                    print(
                        "⚠️ [syncdetection] PUBLIC_BASE_URL not set, skipping webhook auto-sync"
                    )
                    return
                result = await sync_watch_webhooks(changedetection_client, webhook_url)
                print(
                    "🔗 [syncdetection] webhook auto-sync "
                    f"updated={result.get('updated', 0)} "
                    f"already={result.get('already_configured', 0)} "
                    f"failed={result.get('failed', 0)}"
                )

            syncdetection_auto_sync_task = asyncio.create_task(_run_auto_sync())


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global syncdetection_worker, syncdetection_auto_sync_task

    # Stop schedulers
    digest_scheduler.stop()
    if scan_scheduler:
        scan_scheduler.stop()

    if syncdetection_auto_sync_task and not syncdetection_auto_sync_task.done():
        syncdetection_auto_sync_task.cancel()
        try:
            await syncdetection_auto_sync_task
        except asyncio.CancelledError:
            pass

    if syncdetection_worker:
        await syncdetection_worker.stop()
        syncdetection_worker = None

    print("\n" + "=" * 80)
    print("🛑 SEHARADAR v1.0 HEALTH SURVEILLANCE SYSTEM STOPPING")
    print("=" * 80)
    print(f"Total Daily Email Runs: {statistics['daily_email_runs']}")
    print(f"Total Daily Jobs (compat): {statistics['daily_reports_generated']}")
    print(f"Total Digests Sent: {statistics['digests_sent']}")
    print(f"Total Unified Scans: {statistics['unified_scans']}")
    print(f"Total Google Scans: {statistics['google_scans']}")
    print(f"Total Findings Stored: {statistics['findings_stored']}")
    print(
        "Webhook/Event Stats: "
        f"received={statistics['cd_webhooks_received']} "
        f"rejected={statistics['cd_webhooks_rejected']} "
        f"queued={statistics['cd_events_queued']} "
        f"dedup={statistics['cd_events_deduplicated']} "
        f"processed={statistics['cd_events_processed']} "
        f"failed={statistics['cd_events_failed']} "
        f"dead={statistics['cd_events_dead_letter']}"
    )
    print("=" * 80 + "\n")


if __name__ == "__main__":
    port = int(os.getenv("SERVER_PORT", "8080"))
    log_level = os.getenv("LOG_LEVEL", "info")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level=log_level,
    )
