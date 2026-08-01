"""
ProMED Account Manager — Configuration & Status

The main resolution flow now uses ``promed.js --signup-and-resolve`` which
handles both signup and resolution in a single browser session.  This module
retains configuration defaults and a lightweight status helper for API
endpoints that want to report ProMED policy settings.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


# Policy defaults
DEFAULT_BATCH_SIZE = 5
DEFAULT_MAX_ACCOUNTS_PER_RUN = 2
DEFAULT_SIGNUP_DELAY_SEC = 5


class ProMEDAccountManager:
    """ProMED configuration holder and status reporter."""

    def __init__(
        self,
        batch_size: int = DEFAULT_BATCH_SIZE,
        max_accounts_per_run: int = DEFAULT_MAX_ACCOUNTS_PER_RUN,
        signup_delay_sec: float = DEFAULT_SIGNUP_DELAY_SEC,
    ):
        self.batch_size = batch_size
        self.max_accounts_per_run = max_accounts_per_run
        self.signup_delay_sec = signup_delay_sec

    def status(self) -> Dict[str, Any]:
        """Return manager status summary."""
        return {
            "mode": "signup-and-resolve",
            "batch_size": self.batch_size,
            "max_accounts_per_run": self.max_accounts_per_run,
            "max_titles_per_run": self.batch_size * self.max_accounts_per_run,
            "signup_delay_sec": self.signup_delay_sec,
        }


# ---------------------------------------------------------------------------
# Module-level singleton (configured lazily from sources.json)
# ---------------------------------------------------------------------------

_manager_instance: Optional[ProMEDAccountManager] = None


def get_account_pool(config: Optional[Dict[str, Any]] = None) -> ProMEDAccountManager:
    """
    Get or create the singleton manager instance.
    Pass config dict (from sources.json PROMED config) on first call.

    Name kept as ``get_account_pool`` for backward compatibility.
    """
    global _manager_instance
    if _manager_instance is None:
        cfg = config or {}
        _manager_instance = ProMEDAccountManager(
            batch_size=int(cfg.get("per_account_batch_size", DEFAULT_BATCH_SIZE)),
            max_accounts_per_run=int(
                cfg.get("max_accounts_per_run", DEFAULT_MAX_ACCOUNTS_PER_RUN)
            ),
            signup_delay_sec=float(
                cfg.get("signup_delay_sec", DEFAULT_SIGNUP_DELAY_SEC)
            ),
        )
    return _manager_instance
