"""
Geocoding utility for SehaRadar globe visualization.
Extracts country information from findings and maps to lat/lon coordinates.

Uses a multi-strategy approach:
1. Structured field: EpidemiologicalTriad.countries
2. Text extraction: regex against headline + description
3. Source inference: source tags/config → default country
"""

import os
import json
import re
from typing import Optional, List, Dict, Any, Tuple


class OutbreakGeocoder:
    """
    Extracts country information from findings and maps to lat/lon coordinates.

    Uses a multi-strategy approach:
    1. Structured field: EpidemiologicalTriad.countries
    2. NLP extraction: regex against headline + description
    3. Source inference: source tags/config → default country
    """

    # Source ID → default country code mapping (last-resort fallback)
    SOURCE_COUNTRY_MAP = {
        "WHO_EMRO_MERS": "SA",
        "CDC": "US",
        "CDC_COVID_SURVEILLANCE": "US",
        "CDC_FLUVIEW": "US",
        "CDC_TRAVEL": "US",
        "CDC_RSS": "US",
        "CHINA_CDC": "CN",
        "ITALY_HEALTH": "IT",
        "HONG_KONG_CHP": "HK",
        "UK_UKHSA": "GB",
        "UK_HPR": "GB",
        "GERMANY_RKI": "DE",
        "JAPAN_MHLW": "JP",
        "CANADA_HEALTH": "CA",
        "AUSTRALIA_HEALTH": "AU",
        "FRANCE_SANTE": "FR",
        "BRAZIL_HEALTH": "BR",
        "INDIA_NCDC": "IN",
        "SOUTH_KOREA_KDCA": "KR",
        "SAUDI_MOH": "SA",
        "WHO_EMRO": "SA",
    }

    def __init__(self, centroids_path: Optional[str] = None):
        if centroids_path is None:
            centroids_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "config",
                "country_centroids.json",
            )

        self.centroids_data = self._load_centroids(centroids_path)
        self.countries = self.centroids_data.get("countries", {})
        self.aliases = self.centroids_data.get("aliases", {})
        self.demonyms = self.centroids_data.get("demonyms", {})
        self.cities = self.centroids_data.get("cities", {})
        self.regions = self.centroids_data.get("regions", {})

        # Build combined lookup for text matching (sorted longest-first for greedy match)
        self._text_patterns = self._build_text_patterns()

    def _load_centroids(self, path: str) -> Dict[str, Any]:
        """Load country centroids from JSON file."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"❌ Failed to load country centroids from {path}: {e}")
            return {"countries": {}, "aliases": {}, "demonyms": {}, "cities": {}}

    def _build_text_patterns(self) -> List[Tuple[re.Pattern, str]]:
        """
        Build regex patterns for text-based country extraction.
        Sorted longest-first so 'South Africa' matches before 'Africa'.

        Returns:
            List of (compiled_pattern, country_code) tuples
        """
        patterns = []

        # Country names from centroids
        for code, info in self.countries.items():
            name = info["name"]
            patterns.append((name.lower(), code))

        # Aliases
        for alias, code in self.aliases.items():
            patterns.append((alias.lower(), code))

        # Demonyms
        for demonym, code in self.demonyms.items():
            patterns.append((demonym.lower(), code))

        # Cities
        for city, code in self.cities.items():
            patterns.append((city.lower(), code))

        # Sort by length descending (greedy matching)
        patterns.sort(key=lambda x: len(x[0]), reverse=True)

        # Compile regex patterns with word boundaries
        compiled = []
        for text, code in patterns:
            try:
                pattern = re.compile(r"\b" + re.escape(text) + r"\b", re.IGNORECASE)
                compiled.append((pattern, code))
            except re.error:
                continue

        return compiled

    def resolve_country_code(self, name: str) -> Optional[str]:
        """
        Resolve a country name/alias/code to ISO alpha-2 code.

        Args:
            name: Country name, alias, or code

        Returns:
            ISO alpha-2 code or None
        """
        if not name:
            return None

        # Direct code match
        upper = name.upper().strip()
        if upper in self.countries:
            return upper

        # Alias lookup
        lower = name.lower().strip()
        if lower in self.aliases:
            return self.aliases[lower]

        return None

    def extract_countries_from_text(self, text: str) -> List[str]:
        """
        Extract country codes from free text using regex matching.

        Args:
            text: Text to search for country mentions

        Returns:
            List of unique ISO alpha-2 country codes found
        """
        if not text:
            return []

        found = []
        seen = set()

        for pattern, code in self._text_patterns:
            if code not in seen and pattern.search(text):
                found.append(code)
                seen.add(code)

        return found

    def geocode_finding(self, finding: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Geocode a single finding to lat/lon coordinates.

        Strategy (in priority order):
        1. Check structured 'countries' field from EpidemiologicalTriad
        2. Extract from headline + short_description_en text
        3. Infer from source ID

        Args:
            finding: Finding dictionary from NocoDB

        Returns:
            Dict with country_code, lat, lon, country_name or None if ungeocodable
        """
        country_code = None

        # Strategy 1: Structured countries field
        countries_field = finding.get("countries")
        if countries_field:
            # Could be a JSON string or list
            if isinstance(countries_field, str):
                try:
                    countries_field = json.loads(countries_field)
                except (json.JSONDecodeError, TypeError):
                    countries_field = [countries_field]

            if isinstance(countries_field, list) and countries_field:
                # Try to resolve the first country
                for country_name in countries_field:
                    resolved = self.resolve_country_code(country_name)
                    if resolved:
                        country_code = resolved
                        break

        # Strategy 2: Text extraction from headline + description
        if not country_code:
            search_text = " ".join(
                filter(
                    None,
                    [
                        finding.get("headline", ""),
                        finding.get("short_description_en", ""),
                    ],
                )
            )
            codes = self.extract_countries_from_text(search_text)
            if codes:
                country_code = codes[0]  # Use first match (longest pattern wins)

        # Strategy 3: Source inference
        if not country_code:
            source = finding.get("source", "")
            if source in self.SOURCE_COUNTRY_MAP:
                country_code = self.SOURCE_COUNTRY_MAP[source]

        # Lookup coordinates
        if country_code and country_code in self.countries:
            info = self.countries[country_code]
            return {
                "country_code": country_code,
                "lat": info["lat"],
                "lon": info["lon"],
                "country_name": info["name"],
                "country_name_ar": info.get("name_ar", ""),
                "region": info.get("region", ""),
            }

        return None

    def geocode_batch(self, findings: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Geocode a batch of findings.

        Args:
            findings: List of finding dictionaries

        Returns:
            Dict with 'geocoded' list and 'ungeocodable' list
        """
        geocoded = []
        ungeocodable = []

        for finding in findings:
            geo = self.geocode_finding(finding)
            if geo:
                geocoded.append({**finding, **geo})
            else:
                ungeocodable.append(finding)

        return {
            "geocoded": geocoded,
            "ungeocodable": ungeocodable,
            "total": len(findings),
            "geocoded_count": len(geocoded),
            "ungeocodable_count": len(ungeocodable),
        }

    def get_country_info(self, country_code: str) -> Optional[Dict[str, Any]]:
        """
        Get full info for a country by ISO code.

        Args:
            country_code: ISO 3166-1 alpha-2 code

        Returns:
            Country info dict or None
        """
        code = country_code.upper().strip()
        if code in self.countries:
            info = self.countries[code]
            return {
                "country_code": code,
                **info,
            }
        return None

    def get_region_info(self, region_code: str) -> Optional[Dict[str, Any]]:
        """
        Get WHO region info.

        Args:
            region_code: WHO region code (AFRO, AMRO, EMRO, EURO, SEARO, WPRO)

        Returns:
            Region info dict or None
        """
        code = region_code.upper().strip()
        if code in self.regions:
            return {"region_code": code, **self.regions[code]}
        return None

    def get_countries_by_region(self, region_code: str) -> List[Dict[str, Any]]:
        """
        Get all countries in a WHO region.

        Args:
            region_code: WHO region code

        Returns:
            List of country info dicts
        """
        code = region_code.upper().strip()
        results = []
        for cc, info in self.countries.items():
            if info.get("region") == code:
                results.append({"country_code": cc, **info})
        return results


# Global instance (lazy-loaded)
_geocoder_instance: Optional[OutbreakGeocoder] = None


def get_geocoder() -> OutbreakGeocoder:
    """Get or create the global geocoder instance."""
    global _geocoder_instance
    if _geocoder_instance is None:
        _geocoder_instance = OutbreakGeocoder()
    return _geocoder_instance
