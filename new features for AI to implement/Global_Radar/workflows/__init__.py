"""
Workflows initialization - DabDar v3.0
"""

# ===== EXISTING WORKFLOWS =====
from .scheduled_workflow import generate_daily_report
from .retry_handler import retry_with_backoff

# ===== DABDAR v3.0 WORKFLOWS =====

# Unified scan workflow (ChangeDetection.io as source of truth)
from .unified_scan_workflow import (
    UnifiedScanWorkflow,
    unified_scan_workflow,
    run_scheduled_scan,
)

# Email digest
from .email_digest_workflow import (
    compile_email_digest,
    send_email_digest,
    DigestScheduler,
    digest_scheduler,
)

# Legacy periodic scan (kept for Google search only)
from .periodic_scan_workflow import (
    ScanScheduler,
    scan_scheduler,
    trigger_google_scan,
)

# Reclassify unclassified DB findings
from .reclassify_workflow import reclassify_unclassified


__all__ = [
    # Existing workflows
    "generate_daily_report",
    "retry_with_backoff",
    # DabDar v3.0 - Unified Scan (ChangeDetection.io)
    "UnifiedScanWorkflow",
    "unified_scan_workflow",
    "run_scheduled_scan",
    # DabDar v3.0 - Email Digest
    "compile_email_digest",
    "send_email_digest",
    "DigestScheduler",
    "digest_scheduler",
    # DabDar v3.0 - Google Search Only
    "ScanScheduler",
    "scan_scheduler",
    "trigger_google_scan",
    # Reclassify
    "reclassify_unclassified",
]
