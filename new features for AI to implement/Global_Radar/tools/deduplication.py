"""
Deduplication tool for SehaRadar v1.0
Content hashing and duplicate detection for health surveillance findings

Hash strategy (v3):
  Primary:  hash = sha256( normalized_disease | country_code )
  Fallback: hash = sha256( normalized_disease | normalized_headline )

  - Same disease + same country from ANY source → deduplicated
  - Same disease in different countries → stored separately
  - Empty/unknown country falls back to deterministic headline-based hash
"""

import hashlib
import os
import re
from typing import TYPE_CHECKING, Optional, Dict, Any, List
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext, DeduplicationResult

if TYPE_CHECKING:
    from tools.nocodb_client import NocoDBClientV3


def _resolve_country_code(
    countries: Optional[List[str]] = None,
    headline: str = "",
) -> str:
    """
    Resolve location data to an ISO alpha-2 country code using the geocoder.

    Strategy (in priority order):
      1. Structured 'countries' list → geocoder.resolve_country_code()
      2. Text extraction from headline → geocoder.extract_countries_from_text()
      3. Returns "" if nothing found

    Args:
        countries: List of country names from epi_triad analysis
        headline: Headline text for fallback extraction

    Returns:
        ISO alpha-2 country code (e.g. "CD", "US") or "" if unresolvable
    """
    from tools.geocoder import get_geocoder

    geocoder = get_geocoder()

    # Strategy 1: structured countries list
    if countries:
        for name in countries:
            code = geocoder.resolve_country_code(name)
            if code:
                return code
        # If resolve_country_code failed, try text extraction on the country names
        for name in countries:
            codes = geocoder.extract_countries_from_text(name)
            if codes:
                return codes[0]

    # Strategy 2: extract from headline text
    if headline:
        codes = geocoder.extract_countries_from_text(headline)
        if codes:
            return codes[0]

    return ""


def generate_content_hash(
    disease: str,
    countries: Optional[List[str]] = None,
    headline: str = "",
) -> str:
    """
    Generate unique hash for deduplication.

    Hash key priority:
      1) disease + country_code (resolved via geocoder)
      2) disease + normalized headline (fallback when country is missing)

    This keeps deterministic hashes even when country extraction fails, which
    improves duplicate detection across repeated scans of the same headlines.

    Args:
        disease: Disease name (e.g., "Mpox") — should be pre-normalized
        countries: List of country names from epi_triad analysis (optional)
        headline: Headline text for fallback country extraction (optional)

    Returns:
        32-character hash string
    """
    disease_norm = disease.lower().strip()

    # Resolve country code via geocoder
    country_code = _resolve_country_code(countries=countries, headline=headline)

    if not country_code:
        # Fallback: deterministic disease+headline hash when location is missing.
        # This prevents repeated inserts of the same headline across runs.
        normalized_headline = re.sub(r"\s+", " ", headline.lower()).strip()
        normalized_headline = re.sub(r"[^a-z0-9\s\-_/]", "", normalized_headline)

        # Keep some entropy for very short/empty headlines while remaining deterministic.
        if not normalized_headline:
            normalized_headline = "no_headline"

        content = f"{disease_norm}|{normalized_headline}"
        hash_obj = hashlib.sha256(content.encode("utf-8"))
        return hash_obj.hexdigest()[:32]

    country_norm = country_code.upper().strip()

    content = f"{disease_norm}|{country_norm}"

    hash_obj = hashlib.sha256(content.encode("utf-8"))
    return hash_obj.hexdigest()[:32]


def calculate_similarity(text1: str, text2: str) -> float:
    """
    Calculate simple word-based similarity between two texts.

    Uses Jaccard similarity on word sets.

    Args:
        text1: First text
        text2: Second text

    Returns:
        Similarity score between 0 and 1
    """
    if not text1 or not text2:
        return 0.0

    # Tokenize and normalize
    words1 = set(text1.lower().split())
    words2 = set(text2.lower().split())

    # Remove common stop words
    stop_words = {
        "the",
        "a",
        "an",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "and",
        "or",
        "is",
        "are",
        "was",
        "were",
    }
    words1 = words1 - stop_words
    words2 = words2 - stop_words

    if not words1 or not words2:
        return 0.0

    # Jaccard similarity
    intersection = len(words1 & words2)
    union = len(words1 | words2)

    return intersection / union if union > 0 else 0.0


class DeduplicationService:
    """Service for checking and managing duplicate findings"""

    def __init__(self):
        self.similarity_threshold = float(
            os.getenv("DEDUPLICATION_SIMILARITY_THRESHOLD", "0.85")
        )
        self.dedup_enabled = (
            os.getenv("DEDUPLICATION_ENABLED", "true").lower() == "true"
        )

    def _get_nocodb_client(self) -> "NocoDBClientV3":
        from tools.nocodb_client import nocodb_v3

        return nocodb_v3

    def generate_hash(
        self,
        disease: str,
        countries: Optional[List[str]] = None,
        headline: str = "",
    ) -> str:
        """
        Generate unique hash for deduplication.
        Wrapper around generate_content_hash function.

        Hash key: disease + country_code (resolved via geocoder).
        If country is empty/unresolvable, falls back to disease + normalized headline.

        Args:
            disease: Disease name (should be pre-normalized)
            countries: Country names from epi_triad analysis
            headline: Headline text for fallback country extraction

        Returns:
            32-character hash string
        """
        return generate_content_hash(
            disease=disease,
            countries=countries,
            headline=headline,
        )

    async def check_hash_exists(self, content_hash: str) -> Optional[Dict[str, Any]]:
        """
        Check if a content hash already exists in the database.

        Args:
            content_hash: The hash to check

        Returns:
            Existing record if found, None otherwise
        """
        if not self.dedup_enabled:
            return None

        try:
            records = await self._get_nocodb_client().query_findings(
                where=f"(content_hash,eq,{content_hash})",
                limit=1,
            )
            return records[0] if records else None
        except Exception as e:
            print(f"⚠️ Error checking hash in database: {e}")
            return None

    async def check_similar_headlines(
        self, headline: str, disease: str, days_back: int = 7
    ) -> Optional[Dict[str, Any]]:
        """
        Check for similar headlines in recent findings.

        Args:
            headline: Headline to check
            disease: Disease name to filter by
            days_back: How many days back to check

        Returns:
            Most similar existing record if above threshold, None otherwise
        """
        if not self.dedup_enabled:
            return None

        try:
            records = await self._get_nocodb_client().query_findings(
                where=f"(disease,eq,{disease})",
                limit=50,
                sort="-publication_date",
            )

            # Find most similar headline
            best_match = None
            best_score = 0.0

            for record in records:
                existing_headline = record.get("headline", "")
                similarity = calculate_similarity(headline, existing_headline)

                if similarity > best_score and similarity >= self.similarity_threshold:
                    best_score = similarity
                    best_match = record
                    best_match["_similarity_score"] = similarity

            return best_match
        except Exception as e:
            print(f"⚠️ Error checking similar headlines: {e}")
            return None

    async def check_duplicate(
        self,
        disease: str,
        headline: str,
        countries: Optional[List[str]] = None,
    ) -> DeduplicationResult:
        """
        Full deduplication check combining hash and similarity.

        Args:
            disease: Disease name (should be pre-normalized)
            headline: Finding headline
            countries: Country names from epi_triad analysis

        Returns:
            DeduplicationResult with duplicate status and details
        """
        # Generate hash
        content_hash = generate_content_hash(
            disease=disease,
            countries=countries,
            headline=headline,
        )

        # Check exact hash match
        exact_match = await self.check_hash_exists(content_hash)
        if exact_match:
            return DeduplicationResult(
                is_duplicate=True,
                existing_id=exact_match.get("id") or exact_match.get("Id"),
                existing_headline=exact_match.get("headline"),
                similarity_score=1.0,
                content_hash=content_hash,
            )

        # Check similar headlines
        similar_match = await self.check_similar_headlines(headline, disease)
        if similar_match:
            return DeduplicationResult(
                is_duplicate=True,
                existing_id=similar_match.get("id") or similar_match.get("Id"),
                existing_headline=similar_match.get("headline"),
                similarity_score=similar_match.get("_similarity_score", 0.0),
                content_hash=content_hash,
            )

        # No duplicate found
        return DeduplicationResult(is_duplicate=False, content_hash=content_hash)


# Global service instance
dedup_service = DeduplicationService()


@function_tool
async def check_duplicate_finding(
    ctx: RunContextWrapper[HealthContext],
    disease: str,
    headline: str,
    countries: Optional[List[str]] = None,
) -> str:
    """
    Check if a finding already exists in the database (deduplication).

    Uses disease + country_code for deduplication. If no country can be
    resolved, it falls back to disease + normalized headline.

    Args:
        disease: Disease name (e.g., "Mpox", "Marburg")
        headline: Finding headline (used for fallback country extraction)
        countries: List of country names from epi_triad analysis

    Returns:
        JSON string with deduplication result:
        {
            "is_duplicate": bool,
            "existing_id": int | null,
            "existing_headline": str | null,
            "similarity_score": float | null,
            "content_hash": str
        }
    """
    import json

    ctx.context.log(f"🔍 Checking for duplicate: {headline[:50]}...")

    result = await dedup_service.check_duplicate(
        disease=disease,
        headline=headline,
        countries=countries,
    )

    if result.is_duplicate:
        ctx.context.log(
            f"⚠️ Duplicate found! Existing ID: {result.existing_id}, "
            f"Similarity: {result.similarity_score:.2%}"
        )
    else:
        ctx.context.log(f"✅ No duplicate found. Hash: {result.content_hash}")

    return json.dumps(result.model_dump())


@function_tool
async def generate_finding_hash(
    ctx: RunContextWrapper[HealthContext],
    disease: str,
    headline: str = "",
    countries: Optional[List[str]] = None,
) -> str:
    """
    Generate a content hash for a finding without checking the database.

    Uses disease + country_code for the hash. If no country can be resolved,
    falls back to disease + normalized headline.

    Args:
        disease: Disease name
        headline: Finding headline (used for fallback country extraction)
        countries: List of country names from epi_triad analysis

    Returns:
        32-character content hash
    """
    content_hash = generate_content_hash(
        disease=disease,
        countries=countries,
        headline=headline,
    )
    ctx.context.log(f"🔑 Generated hash: {content_hash}")
    return content_hash


@function_tool
async def calculate_text_similarity(
    ctx: RunContextWrapper[HealthContext], text1: str, text2: str
) -> str:
    """
    Calculate similarity between two texts.

    Args:
        text1: First text
        text2: Second text

    Returns:
        JSON with similarity score and threshold status
    """
    import json

    similarity = calculate_similarity(text1, text2)
    threshold = float(os.getenv("DEDUPLICATION_SIMILARITY_THRESHOLD", "0.85"))

    result = {
        "similarity_score": similarity,
        "threshold": threshold,
        "is_similar": similarity >= threshold,
    }

    ctx.context.log(f"📊 Similarity: {similarity:.2%} (threshold: {threshold:.0%})")

    return json.dumps(result)
