"""
Source Registry — Single source of truth for all data sources.

DabDar v4.0 Phase 1: Configuration Consolidation
Loads from config/sources.json and provides lookup methods.

This replaces fragmented configuration across:
- config/agency_configs.json
- health_agents/shared/models.py (VALID_SOURCES)
- server.py (VALID_AGENCIES)
- workflows/unified_scan_workflow.py (WATCH_CONFIG)
"""

import json
import os
from typing import Dict, List, Optional, Any
from pathlib import Path
from functools import lru_cache

from pydantic import BaseModel, Field
from health_agents.shared.models import SourceType


class Source(BaseModel):
    """Source configuration model."""

    id: str
    name: str
    type: SourceType
    url: Optional[str] = None
    watch_uuid: Optional[str] = None
    rsshub_route: Optional[str] = None
    rsshub_config: Optional[Dict[str, Any]] = None
    parser: Optional[str] = "generic"
    check_interval: Optional[Dict[str, int]] = None
    config: Optional[Dict[str, Any]] = None
    enabled: bool = True
    priority_boost: int = 0
    tags: List[str] = Field(default_factory=list)


class SourceRegistry:
    """
    Centralized registry for all data sources.
    Loads configuration from config/sources.json.

    Singleton pattern ensures single source of truth.
    """

    _instance: Optional["SourceRegistry"] = None

    def __init__(self):
        """Initialize instance variables."""
        if not hasattr(self, "_sources"):
            self._sources: Dict[str, Source] = {}
            self._config_path: Optional[Path] = None
            self._load_config()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _load_config(self) -> None:
        """Load sources from config file."""
        # Find config file
        base_path = Path(__file__).parent.parent.parent
        self._config_path = base_path / "config" / "sources.json"

        if not self._config_path.exists():
            # Fallback to legacy config
            legacy_path = base_path / "config" / "agency_configs.json"
            if legacy_path.exists():
                print("⚠️  Using legacy config - consider migrating to sources.json")
                self._load_legacy_config(legacy_path)
                return
            raise FileNotFoundError(f"Config not found: {self._config_path}")

        with open(self._config_path) as f:
            data = json.load(f)

        self._sources = {}
        for source_data in data.get("sources", []):
            source = Source(**source_data)
            self._sources[source.id] = source

        print(f"📚 Loaded {len(self._sources)} sources from {self._config_path.name}")

    def _load_legacy_config(self, path: Path) -> None:
        """Load from legacy agency_configs.json format."""
        with open(path) as f:
            data = json.load(f)

        self._sources = {}

        # Load changedetection sources
        for src in data.get("periodic_sources", []):
            source = Source(
                id=src["name"],
                name=src.get("description", src["name"]),
                type=SourceType.CHANGEDETECTION,
                url=src.get("url"),
                watch_uuid=src.get("watch_uuid"),
                enabled=src.get("enabled", True),
            )
            self._sources[source.id] = source

        # Load RSS sources
        for src in data.get("rss_sources", []):
            source = Source(
                id=src["name"],
                name=src["name"],
                type=SourceType.RSS,
                url=src.get("url"),
                check_interval={"hours": src.get("check_interval_hours", 6)},
                enabled=src.get("enabled", True),
            )
            self._sources[source.id] = source

        # Load Google search
        google_config = data.get("google_search_config", {})
        if google_config.get("enabled"):
            source = Source(
                id="GOOGLE",
                name="Google Search",
                type=SourceType.GOOGLE_SEARCH,
                config=google_config,
                enabled=True,
            )
            self._sources["GOOGLE"] = source

        print(f"📚 Loaded {len(self._sources)} sources from legacy config")

    def reload(self) -> None:
        """Reload configuration from disk."""
        self._load_config()

    def get(self, source_id: str) -> Optional[Source]:
        """Get source by ID."""
        return self._sources.get(source_id)

    def get_by_uuid(self, watch_uuid: str) -> Optional[Source]:
        """Get source by ChangeDetection.io watch UUID."""
        for source in self._sources.values():
            if source.watch_uuid == watch_uuid:
                return source
        return None

    def list_all(self) -> List[Source]:
        """List all sources."""
        return list(self._sources.values())

    def list_enabled(self) -> List[Source]:
        """List only enabled sources."""
        return [s for s in self._sources.values() if s.enabled]

    def list_by_type(self, source_type: SourceType) -> List[Source]:
        """List sources by type."""
        return [s for s in self._sources.values() if s.type == source_type]

    def get_valid_source_ids(self) -> List[str]:
        """Get list of valid source IDs (replaces VALID_SOURCES)."""
        return list(self._sources.keys())

    def get_valid_agency_ids(self) -> List[str]:
        """
        Get list of valid agency IDs (for backward compatibility).
        Only includes changedetection sources.
        """
        return [
            s.id for s in self._sources.values() if s.type == SourceType.CHANGEDETECTION
        ]

    def get_watch_config(self) -> Dict[str, Dict[str, Any]]:
        """
        Get watch config dict for unified_scan_workflow.py compatibility.
        Maps UUID -> {name, type, url}
        """
        config = {}
        for source in self._sources.values():
            if source.type == SourceType.CHANGEDETECTION and source.watch_uuid:
                config[source.watch_uuid] = {
                    "name": source.id,
                    "type": source.parser or "generic",
                    "url": source.url or "",
                }
        return config

    def get_rsshub_route_configs(self) -> List[Dict[str, Any]]:
        """Build route config dicts for RSSHubClient.fetch_multiple()."""
        configs = []
        for source in self._sources.values():
            if (
                source.type == SourceType.RSSHUB
                and source.enabled
                and source.rsshub_route
            ):
                route_cfg: Dict[str, Any] = {
                    "route": source.rsshub_route,
                    "source_id": source.id,
                }
                if source.rsshub_config:
                    route_cfg.update(source.rsshub_config)
                configs.append(route_cfg)
        return configs

    def get_statistics(self) -> Dict[str, Any]:
        """Get registry statistics."""
        all_sources = self.list_all()
        enabled_sources = self.list_enabled()

        type_counts = {}
        for source_type in SourceType:
            type_counts[source_type.value] = len(self.list_by_type(source_type))

        return {
            "total_sources": len(all_sources),
            "enabled_sources": len(enabled_sources),
            "disabled_sources": len(all_sources) - len(enabled_sources),
            "by_type": type_counts,
            "config_file": str(self._config_path),
        }


# Singleton instance
source_registry = SourceRegistry()


# Convenience functions for backward compatibility
def get_valid_sources() -> List[str]:
    """Get list of valid source IDs."""
    return source_registry.get_valid_source_ids()


def get_valid_agencies() -> List[str]:
    """Get list of valid agency IDs (changedetection sources only)."""
    return source_registry.get_valid_agency_ids()


def get_watch_config() -> Dict[str, Dict[str, Any]]:
    """Get watch config for unified_scan_workflow.py."""
    return source_registry.get_watch_config()
