"""
Epidemiological Triad Analyzer for DabDar v3.0
Extracts WHO/WHERE/WHEN information from health news
"""

import os
import json
import re
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext, EpidemiologicalTriad, Priority

from .openai_client import get_default_llm_model, get_openai_client


# Disease configuration loader
def load_disease_config() -> Dict[str, Any]:
    """Load disease configuration from JSON file"""
    config_path = os.path.join(
        os.path.dirname(__file__), "..", "config", "diseases.json"
    )
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ Could not load disease config: {e}")
        return {"diseases": []}


def get_disease_keywords() -> Dict[str, List[str]]:
    """Get disease keywords mapping"""
    config = load_disease_config()
    keywords = {}
    for disease in config.get("diseases", []):
        name = disease["name"]
        all_keywords = (
            disease.get("keywords_en", []) + disease.get("aliases", []) + [name.lower()]
        )
        keywords[name] = [kw.lower() for kw in all_keywords]
    return keywords


def _build_alias_map() -> Dict[str, str]:
    """
    Build a lower-cased lookup table mapping every known alias, keyword, and
    variant to its canonical disease name.

    Sources:
      - diseases.json: name, aliases, keywords_en
      - BUILTIN fallback for core diseases

    Returns:
        Dict[str, str]: lower-cased alias -> canonical name
    """
    config = load_disease_config()
    alias_map: Dict[str, str] = {}

    for disease in config.get("diseases", []):
        canonical = disease["name"]
        canonical_lower = canonical.lower()

        # Map the canonical name itself
        alias_map[canonical_lower] = canonical

        # Map all explicit aliases
        for alias in disease.get("aliases", []):
            alias_map[alias.lower()] = canonical

        # Map all keywords
        for kw in disease.get("keywords_en", []):
            alias_map[kw.lower()] = canonical

    return alias_map


# Module-level cache; rebuilt on first call and when diseases.json changes
_alias_map_cache: Optional[Dict[str, str]] = None
_alias_map_mtime: float = 0.0


def _get_alias_map() -> Dict[str, str]:
    """Get (cached) alias map, rebuilding if diseases.json was modified."""
    global _alias_map_cache, _alias_map_mtime

    config_path = os.path.join(
        os.path.dirname(__file__), "..", "config", "diseases.json"
    )
    try:
        current_mtime = os.path.getmtime(config_path)
    except OSError:
        current_mtime = 0.0

    if _alias_map_cache is None or current_mtime != _alias_map_mtime:
        _alias_map_cache = _build_alias_map()
        _alias_map_mtime = current_mtime

    return _alias_map_cache


def normalize_disease_name(raw_name: str) -> str:
    """
    Normalize a disease name to its canonical form using diseases.json aliases.

    Strategy (in order):
      1. Exact match (case-insensitive) against canonical names and aliases
      2. Suffix stripping: removes common suffixes like "virus", "disease",
         "infection", "outbreak" and retries matching
      3. Containment check: if any known alias is a substring of raw_name
         (or vice versa), return the canonical name

    If no match is found, returns the input stripped of leading/trailing whitespace
    with the original casing preserved.

    Args:
        raw_name: The disease name as returned by the LLM or any upstream source

    Returns:
        Canonical disease name (e.g. "Nipah" instead of "Nipah virus infection")

    Examples:
        >>> normalize_disease_name("Nipah virus infection")
        'Nipah'
        >>> normalize_disease_name("monkeypox")
        'Mpox'
        >>> normalize_disease_name("MERS-CoV")
        'MERS'
        >>> normalize_disease_name("bird flu")
        'H5N1'
        >>> normalize_disease_name("SomeNewDisease")
        'SomeNewDisease'
    """
    if not raw_name or raw_name.strip().lower() in (
        "news",
        "unknown",
        "unknown disease",
        "none",
        "null",
        "",
    ):
        return "news"

    cleaned = raw_name.strip()
    lookup = cleaned.lower()
    alias_map = _get_alias_map()

    # 1. Exact match
    if lookup in alias_map:
        return alias_map[lookup]

    # 2. Suffix stripping — remove common trailing words and retry
    suffixes_to_strip = [
        " virus infection",
        " virus disease",
        " hemorrhagic fever",
        " haemorrhagic fever",
        " disease",
        " virus",
        " infection",
        " outbreak",
        " fever",
    ]
    for suffix in suffixes_to_strip:
        if lookup.endswith(suffix):
            stripped = lookup[: -len(suffix)].strip()
            if stripped in alias_map:
                return alias_map[stripped]

    # 3. Containment check — does any alias appear inside raw_name, or vice versa?
    # Sort by length descending so longer (more specific) aliases match first.
    for alias, canonical in sorted(alias_map.items(), key=lambda x: -len(x[0])):
        if len(alias) >= 3 and (alias in lookup or lookup in alias):
            return canonical

    # No match found — return as-is (new unknown disease)
    return cleaned


def get_canonical_disease_names() -> List[str]:
    """
    Return a sorted list of all canonical disease names from diseases.json.

    Used to inject the known-disease list into the LLM prompt so it can
    pick from established names rather than inventing variants.

    Returns:
        List of canonical disease names (e.g. ["Cholera", "COVID-19", "Dengue", ...])
    """
    config = load_disease_config()
    names = [d["name"] for d in config.get("diseases", [])]
    return sorted(names)


def identify_disease_from_text(text: str) -> Optional[str]:
    """
    Identify disease name from text using keyword matching against diseases.json.

    Used as a FALLBACK when the LLM classifier is unavailable or returns nothing.

    Args:
        text: Text to analyze

    Returns:
        Disease name if found, None otherwise
    """
    if not text:
        return None

    text_lower = text.lower()
    keywords = get_disease_keywords()

    # First pass: exact word boundary matching (most reliable)
    for disease_name, disease_keywords in keywords.items():
        for keyword in disease_keywords:
            pattern = r"\b" + re.escape(keyword) + r"\b"
            if re.search(pattern, text_lower, re.IGNORECASE):
                return disease_name

    # Second pass: simple substring matching (catches more cases)
    for disease_name, disease_keywords in keywords.items():
        for keyword in disease_keywords:
            if len(keyword) >= 3 and keyword in text_lower:
                return disease_name

    return None


def add_disease_to_library(disease_name: str, keywords: List[str]) -> None:
    """
    Persist a newly LLM-identified disease into config/diseases.json so it
    enriches the keyword library for future fallback matching.

    If the disease already exists in the library (by name or alias), its
    keyword list is merged with any new keywords supplied.

    Args:
        disease_name: Canonical disease name (e.g. "Nipah")
        keywords:     Lower-cased keyword variants the LLM inferred
    """
    config_path = os.path.join(
        os.path.dirname(__file__), "..", "config", "diseases.json"
    )
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"⚠️ Could not load diseases.json for library update: {e}")
        return

    diseases: list = config.get("diseases", [])

    # Check if already present by canonical name (case-insensitive)
    for entry in diseases:
        if entry["name"].lower() == disease_name.lower():
            # Merge any new keywords
            existing_kw = [k.lower() for k in entry.get("keywords_en", [])]
            merged = list(set(existing_kw + [k.lower() for k in keywords]))
            entry["keywords_en"] = merged
            break
    else:
        # Also check if disease_name matches any existing alias
        for entry in diseases:
            all_aliases = [a.lower() for a in entry.get("aliases", [])] + [
                k.lower() for k in entry.get("keywords_en", [])
            ]
            if disease_name.lower() in all_aliases:
                # This disease already exists under a different canonical name;
                # just merge keywords and add this variant as an alias
                existing_kw = [k.lower() for k in entry.get("keywords_en", [])]
                merged = list(
                    set(
                        existing_kw
                        + [k.lower() for k in keywords]
                        + [disease_name.lower()]
                    )
                )
                entry["keywords_en"] = merged
                if disease_name not in entry.get("aliases", []):
                    entry.setdefault("aliases", []).append(disease_name)
                print(
                    f"📚 Disease library: merged '{disease_name}' into existing '{entry['name']}'"
                )
                break
        else:
            # New disease — add a minimal entry so keyword matching can use it later
            new_entry: Dict[str, Any] = {
                "name": disease_name,
                "aliases": [],
                "arabic_name": disease_name,  # placeholder; translator enriches later
                "keywords_en": list(
                    set([disease_name.lower()] + [k.lower() for k in keywords])
                ),
                "keywords_ar": [],
                "priority": "medium",
                "who_classification": "Auto-discovered",
            }
            diseases.append(new_entry)
            print(f"📚 Disease library: added new entry '{disease_name}'")

    config["diseases"] = diseases
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        # Invalidate the alias map cache so normalization picks up the new entry
        global _alias_map_cache
        _alias_map_cache = None
    except Exception as e:
        print(f"⚠️ Could not write diseases.json: {e}")


def extract_numbers(text: str) -> Dict[str, Optional[int]]:
    """
    Extract case/death numbers from text.

    Args:
        text: Text to analyze

    Returns:
        Dictionary with extracted numbers
    """
    numbers: Dict[str, Optional[int]] = {
        "cases": None,
        "deaths": None,
        "confirmed": None,
        "suspected": None,
    }

    # Common patterns for case numbers
    case_patterns = [
        r"(\d+(?:,\d+)?)\s*(?:new\s+)?cases?",
        r"(\d+(?:,\d+)?)\s*(?:new\s+)?infections?",
        r"total\s+(?:of\s+)?(\d+(?:,\d+)?)\s*cases?",
    ]

    # Death patterns
    death_patterns = [
        r"(\d+(?:,\d+)?)\s*deaths?",
        r"(\d+(?:,\d+)?)\s*fatalities",
        r"(\d+(?:,\d+)?)\s*(?:have\s+)?died",
    ]

    # Confirmed/suspected patterns
    confirmed_patterns = [
        r"(\d+(?:,\d+)?)\s*confirmed",
        r"confirmed\s*:\s*(\d+(?:,\d+)?)",
    ]

    suspected_patterns = [
        r"(\d+(?:,\d+)?)\s*suspected",
        r"suspected\s*:\s*(\d+(?:,\d+)?)",
    ]

    text_lower = text.lower()

    def extract_first_match(patterns: List[str]) -> Optional[int]:
        for pattern in patterns:
            match = re.search(pattern, text_lower)
            if match:
                num_str = match.group(1).replace(",", "")
                try:
                    return int(num_str)
                except ValueError:
                    continue
        return None

    numbers["cases"] = extract_first_match(case_patterns)
    numbers["deaths"] = extract_first_match(death_patterns)
    numbers["confirmed"] = extract_first_match(confirmed_patterns)
    numbers["suspected"] = extract_first_match(suspected_patterns)

    return numbers


def extract_locations(text: str) -> Tuple[List[str], List[str]]:
    """
    Extract country and region names from text.

    Args:
        text: Text to analyze

    Returns:
        Tuple of (countries list, regions list)
    """
    # Common country names (can be expanded)
    countries = [
        "Afghanistan",
        "Algeria",
        "Angola",
        "Argentina",
        "Australia",
        "Bangladesh",
        "Brazil",
        "Cameroon",
        "Canada",
        "Chad",
        "China",
        "Colombia",
        "Congo",
        "Democratic Republic of the Congo",
        "DRC",
        "Egypt",
        "Ethiopia",
        "France",
        "Germany",
        "Ghana",
        "Guinea",
        "India",
        "Indonesia",
        "Iran",
        "Iraq",
        "Italy",
        "Japan",
        "Jordan",
        "Kenya",
        "Lebanon",
        "Libya",
        "Madagascar",
        "Malawi",
        "Malaysia",
        "Mali",
        "Mexico",
        "Morocco",
        "Mozambique",
        "Myanmar",
        "Nepal",
        "Niger",
        "Nigeria",
        "Pakistan",
        "Peru",
        "Philippines",
        "Rwanda",
        "Saudi Arabia",
        "Senegal",
        "Sierra Leone",
        "Somalia",
        "South Africa",
        "South Sudan",
        "Spain",
        "Sudan",
        "Syria",
        "Tanzania",
        "Thailand",
        "Tunisia",
        "Turkey",
        "Uganda",
        "Ukraine",
        "United Kingdom",
        "UK",
        "United States",
        "USA",
        "US",
        "Vietnam",
        "Yemen",
        "Zambia",
        "Zimbabwe",
        "Africa",
        "Asia",
        "Europe",
        "Americas",
        "Middle East",
    ]

    found_countries = []
    found_regions = []

    text_lower = text.lower()

    for country in countries:
        if country.lower() in text_lower:
            if country in ["Africa", "Asia", "Europe", "Americas", "Middle East"]:
                found_regions.append(country)
            else:
                found_countries.append(country)

    return list(set(found_countries)), list(set(found_regions))


def determine_priority(
    disease: str, cases: Optional[int], deaths: Optional[int], text: str
) -> Priority:
    """
    Determine finding priority based on content.

    Args:
        disease: Disease name
        cases: Number of cases
        deaths: Number of deaths
        text: Full text for keyword analysis

    Returns:
        Priority level
    """
    text_lower = text.lower()

    # Critical keywords
    critical_keywords = [
        "pandemic",
        "pheic",
        "public health emergency",
        "international concern",
        "marburg",
        "ebola",
        "highly pathogenic",
    ]

    # High priority keywords
    high_keywords = [
        "outbreak",
        "epidemic",
        "emergency",
        "rapid spread",
        "surge",
        "mortality",
        "fatality rate",
        "cluster",
    ]

    # Check for critical indicators
    for keyword in critical_keywords:
        if keyword in text_lower:
            return Priority.CRITICAL

    # Check disease-based priority
    config = load_disease_config()
    for d in config.get("diseases", []):
        if d["name"].lower() == disease.lower():
            if d.get("priority") == "critical":
                return Priority.CRITICAL
            elif d.get("priority") == "high":
                # Could be elevated to critical based on numbers
                pass

    # Check numbers
    if deaths and deaths > 10:
        return Priority.HIGH
    if cases and cases > 100:
        return Priority.HIGH

    # Check high priority keywords
    for keyword in high_keywords:
        if keyword in text_lower:
            return Priority.HIGH

    return Priority.MEDIUM


class EpidemiologicalAnalyzer:
    """Analyzer for epidemiological triad extraction"""

    def __init__(self):
        self.model = get_default_llm_model()

    async def analyze_finding(
        self, headline: str, description: str, source: str
    ) -> Dict[str, Any]:
        """
        Analyze a finding to extract epidemiological triad and generate descriptions.

        Disease classification strategy:
          1. PRIMARY  — LLM reads the article and returns the disease name in the
                        same call that generates descriptions (no extra API round-trip).
          2. FALLBACK — keyword matching against diseases.json if LLM is unavailable
                        or returns nothing recognisable.
          3. LIBRARY  — any LLM-identified disease not yet in diseases.json is written
                        back into the library to enrich future keyword matching.

        Args:
            headline: Finding headline
            description: Initial description/snippet
            source: Source name

        Returns:
            Dictionary with analysis results
        """
        full_text = f"{headline} {description}"

        # Rule-based extraction (always runs — cheap, no network)
        numbers = extract_numbers(full_text)
        countries, regions = extract_locations(full_text)

        # Keyword-based disease ID used only as fallback seed; may be None
        keyword_disease = identify_disease_from_text(full_text)

        # Build epidemiological triad (preliminary — uses keyword results)
        triad = EpidemiologicalTriad(
            who_affected=f"{numbers.get('cases', 0) or 'Unknown number of'} cases reported",
            cases_confirmed=numbers.get("confirmed"),
            cases_suspected=numbers.get("suspected"),
            deaths=numbers.get("deaths"),
            where_location=", ".join(countries)
            if countries
            else "Location not specified",
            countries=countries,
            regions=regions,
        )

        # PRIMARY: LLM classifies disease AND generates descriptions in one call.
        # Returns (disease_name, short_desc, detailed_desc, keywords_hint).
        (
            llm_disease,
            short_desc,
            detailed_desc,
            llm_keywords,
        ) = await self.classify_and_describe(
            headline=headline,
            description=description,
            source=source,
            triad=triad,
        )

        # Resolve final disease name: LLM wins; keyword matching is the safety net
        raw_disease = llm_disease or keyword_disease or "news"

        # NORMALIZE: map aliases/variants to canonical name from diseases.json
        # e.g. "Nipah virus infection" → "Nipah", "monkeypox" → "Mpox"
        disease = normalize_disease_name(raw_disease)
        if disease != raw_disease and disease != "news":
            print(
                f"    📎 Normalized disease: '{raw_disease}' → '{disease}'",
                flush=True,
            )

        # Persist LLM-discovered disease into diseases.json library
        # Use the NORMALIZED name so the library stays consistent
        if disease and disease not in ("news", "Unknown"):
            add_disease_to_library(disease, llm_keywords)

        priority = determine_priority(
            disease, numbers.get("cases"), numbers.get("deaths"), full_text
        )

        return {
            "disease": disease,
            "priority": priority.value,
            "short_description_en": short_desc,
            "detailed_description_en": detailed_desc,
            "triad": triad.model_dump(),
            "numbers": numbers,
            "countries": countries,
            "regions": regions,
        }

    async def classify_and_describe(
        self,
        headline: str,
        description: str,
        source: str,
        triad: EpidemiologicalTriad,
    ) -> Tuple[str, str, str, List[str]]:
        """
        PRIMARY disease classifier + description generator in a single LLM call.

        Asks the model to:
          - Identify the exact disease name from the article context
          - Suggest keyword variants that would match this disease
          - Generate a short and a detailed epidemiological description

        If no specific disease is identifiable, returns "news" as the disease name.

        Args:
            headline:    News headline
            description: Raw article snippet
            source:      Source name
            triad:       Pre-computed epidemiological triad (numbers/locations)

        Returns:
            Tuple of:
              disease_name  — canonical disease name, or "news" if not identifiable
              short_desc    — 1-2 sentence summary
              detailed_desc — 3-5 paragraph analysis
              keywords      — list of lower-cased keyword hints for library storage
        """
        # Build the known-disease list so the LLM picks from established names
        known_names = get_canonical_disease_names()
        known_names_str = ", ".join(f"'{n}'" for n in known_names)

        prompt = f"""You are an epidemiological scientist and disease surveillance expert.

Analyze the health news article below and respond with a JSON object.

HEADLINE: {headline}

DESCRIPTION: {description}

SOURCE: {source}

PRE-EXTRACTED DATA:
- Cases: {triad.cases_confirmed or "Unknown"} confirmed, {triad.cases_suspected or "Unknown"} suspected
- Deaths: {triad.deaths or "Unknown"}
- Location: {triad.where_location}
- Countries: {", ".join(triad.countries) if triad.countries else "Not specified"}

KNOWN DISEASES (use these exact names when possible):
{known_names_str}

Your response MUST be a JSON object with these keys:

{{
  "disease_name": "<canonical disease name — MUST match one of the KNOWN DISEASES above if the article is about that disease. Only use a new name if the disease is genuinely not in the known list. Use the string 'news' if the article is general health news with no specific disease>",
  "disease_keywords": ["<lower-cased keyword variants>", "..."],
  "short_description": "<1-2 sentences. Format: 'According to [SOURCE], there were [NUMBERS] new [DISEASE] cases (X confirmed, Y suspected) and [DEATHS] deaths in [LOCATION] during [PERIOD]. [INTERVENTION if any].' >",
  "detailed_description": "<3-5 paragraphs covering: full epidemiological triad (who/where/when), case numbers and mortality, interventions, risk assessment, scientific terminology>"
}}

Rules:
- disease_name: MUST use the exact canonical name from the KNOWN DISEASES list above when the article matches a known disease (e.g. 'Mpox' not 'Monkeypox', 'H5N1' not 'bird flu', 'Marburg' not 'Marburg virus disease', 'Nipah' not 'Nipah virus infection'). Only invent a new name if the disease is genuinely absent from the known list. If the article is general health news, policy, or institutional content with no specific disease or outbreak, use the string "news" — never use null, "Unknown", or an empty string.
- disease_keywords: include common aliases and abbreviations in lower-case.
- Always generate both descriptions regardless of whether the disease is identified."""

        try:
            print(
                f"    🤖 LLM: classifying disease + generating descriptions...",
                flush=True,
            )
            response = await get_openai_client().chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an epidemiological scientist specialised in disease "
                            "surveillance. Always respond with valid JSON only."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                response_format={"type": "json_object"},
                timeout=30.0,
            )
            print(f"    ✅ LLM response received", flush=True)

            response_content = response.choices[0].message.content
            if not response_content:
                raise ValueError("LLM returned empty response")

            result = json.loads(response_content)
            raw_disease: Optional[str] = result.get("disease_name")
            keywords: List[str] = result.get("disease_keywords") or []
            short = result.get("short_description", description)
            detailed = result.get("detailed_description", description)

            # Normalize: null / "Unknown" / empty → "news"
            if not raw_disease or raw_disease.strip().lower() in (
                "unknown",
                "unknown disease",
                "null",
                "none",
                "",
            ):
                disease_name = "news"
                print(
                    f"    ⚠️ LLM could not identify a specific disease — marked as 'news'",
                    flush=True,
                )
            else:
                # Normalize LLM output to canonical name from diseases.json
                disease_name = normalize_disease_name(raw_disease.strip())
                print(f"    🦠 LLM identified disease: '{disease_name}'", flush=True)

            return disease_name, short, detailed, keywords

        except Exception as e:
            print(f"⚠️ LLM classify_and_describe failed: {e}", flush=True)
            # Build template fallbacks so the pipeline never stalls
            disease_name = "news"
            short = f"According to {source}, a health event has been reported. {description[:200]}"
            detailed = f"""## Overview\n\n{description}\n\n## Epidemiological Summary\n\nLocation: {triad.where_location}\nCases: {triad.cases_confirmed or "Not specified"} confirmed\nDeaths: {triad.deaths or "Not specified"}\n\nSource: {source}\n"""
            return disease_name, short, detailed, []


# Global analyzer instance
epi_analyzer = EpidemiologicalAnalyzer()


@function_tool
async def analyze_epidemiological_content(
    ctx: RunContextWrapper[HealthContext], headline: str, description: str, source: str
) -> str:
    """
    Analyze health news content for epidemiological information.

    Extracts WHO/WHERE/WHEN triad and generates structured descriptions.

    Args:
        headline: News headline
        description: Initial description or snippet
        source: Source name (WHO, CDC, etc.)

    Returns:
        JSON string with analysis results including:
        - disease: Identified disease name
        - priority: Finding priority (critical, high, medium, low)
        - short_description_en: 1-2 sentence summary
        - detailed_description_en: 3-5 paragraph analysis
        - triad: Epidemiological triad data
    """
    ctx.context.log(f"🔬 Analyzing: {headline[:50]}...")

    result = await epi_analyzer.analyze_finding(headline, description, source)

    ctx.context.log(f"✅ Disease: {result['disease']}, Priority: {result['priority']}")

    return json.dumps(result, ensure_ascii=False)


@function_tool
async def identify_disease(ctx: RunContextWrapper[HealthContext], text: str) -> str:
    """
    Identify disease name from text.

    Args:
        text: Text to analyze

    Returns:
        Disease name or "Unknown"
    """
    disease = identify_disease_from_text(text)

    if disease:
        ctx.context.log(f"✅ Identified disease: {disease}")
    else:
        ctx.context.log("⚠️ Could not identify disease from text")

    return disease or "news"


@function_tool
async def extract_case_numbers(ctx: RunContextWrapper[HealthContext], text: str) -> str:
    """
    Extract case and death numbers from text.

    Args:
        text: Text to analyze

    Returns:
        JSON string with extracted numbers
    """
    numbers = extract_numbers(text)
    ctx.context.log(f"📊 Extracted numbers: {numbers}")
    return json.dumps(numbers)


@function_tool
async def batch_analyze_findings(
    ctx: RunContextWrapper[HealthContext], findings_json: str
) -> str:
    """
    Analyze multiple findings in batch.

    Args:
        findings_json: JSON array of findings to analyze

    Returns:
        JSON array of analyzed findings with epidemiological data
    """
    findings = json.loads(findings_json)
    analyzed = []

    ctx.context.log(f"🔬 Batch analyzing {len(findings)} findings...")

    for i, finding in enumerate(findings):
        try:
            headline = finding.get("headline", "")
            description = (
                finding.get("short_description_en", "")
                or finding.get("description", "")
                or finding.get("summary", "")
            )
            source = finding.get("source", "Unknown")

            # analyze_finding() now runs LLM-primary classification internally;
            # only forward a pre-existing confirmed disease to skip redundant work.
            pre_disease = finding.get("disease", "")
            if pre_disease and pre_disease not in ("Unknown", "news", ""):
                # Trust upstream classification; still generate descriptions
                analysis = await epi_analyzer.analyze_finding(
                    headline, description, source
                )
                analysis["disease"] = pre_disease  # preserve confirmed upstream value
            else:
                analysis = await epi_analyzer.analyze_finding(
                    headline, description, source
                )

            # Merge with original finding (analysis takes precedence)
            enriched = {**finding, **analysis}
            analyzed.append(enriched)

            ctx.context.log(
                f"  [{i + 1}/{len(findings)}] {headline[:40]}... → {enriched.get('disease', 'news')}"
            )

        except Exception as e:
            ctx.context.log(f"  ❌ Error analyzing finding {i + 1}: {e}")
            analyzed.append(finding)  # Keep original on error

    ctx.context.log(f"✅ Batch analysis complete: {len(analyzed)} findings processed")

    return json.dumps(analyzed, ensure_ascii=False)
