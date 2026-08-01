"""
Configuration loader for agency configs and keywords
"""

import json
import os
from pathlib import Path
from typing import Dict, List
from .models import AgencyConfig


class ConfigLoader:
    """Load and manage agency configurations"""
    
    def __init__(self, config_dir: str = None):
        if config_dir is None:
            # Default to config/ directory relative to project root
            config_dir = Path(__file__).parent.parent.parent / "config"
        self.config_dir = Path(config_dir)
        self._agencies: Dict[str, AgencyConfig] = {}
        self._keywords_critical: List[str] = []
        self._keywords_watch: List[str] = []
        self._load_configs()
    
    def _load_configs(self):
        """Load configurations from JSON files"""
        # Load agency configs
        agency_config_path = self.config_dir / "agency_configs.json"
        if agency_config_path.exists():
            with open(agency_config_path) as f:
                data = json.load(f)
                
                # Load keywords
                self._keywords_critical = data.get("keywords_critical", [])
                self._keywords_watch = data.get("keywords_watch", [])
                
                # Load agency configs
                for agency_data in data.get("agencies", []):
                    agency_config = AgencyConfig(
                        name=agency_data["name"],
                        watch_id=agency_data.get("watch_id", ""),
                        url_pattern=agency_data.get("url_pattern", ""),
                        keywords_critical=self._keywords_critical,
                        keywords_watch=self._keywords_watch,
                    )
                    self._agencies[agency_config.name] = agency_config
    
    def get_agency_config(self, agency_name: str) -> AgencyConfig:
        """Get configuration for a specific agency"""
        return self._agencies.get(agency_name)
    
    def get_watch_id(self, agency_name: str) -> str:
        """Get watch UUID for agency from environment"""
        env_var = f"WATCH_UUID_{agency_name}"
        return os.getenv(env_var, "")
    
    @property
    def keywords_critical(self) -> List[str]:
        """Get critical keywords list"""
        return self._keywords_critical
    
    @property
    def keywords_watch(self) -> List[str]:
        """Get watch keywords list"""
        return self._keywords_watch
    
    @property
    def all_agencies(self) -> Dict[str, AgencyConfig]:
        """Get all agency configurations"""
        return self._agencies


# Global config loader instance
config_loader = ConfigLoader()
