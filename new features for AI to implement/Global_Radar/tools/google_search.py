"""
Google Custom Search API integration for DabDar v3.0
Search for disease news across the web
"""

import os
import httpx
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from agents import function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext, GoogleSearchResult


class GoogleSearchClient:
    """Client for Google Custom Search API"""

    GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"

    # Language codes for different languages
    LANGUAGE_CODES = {
        "en": "lang_en",
        "ar": "lang_ar",
        "fr": "lang_fr",
        "es": "lang_es",
        "zh": "lang_zh-CN",
    }

    # Region-specific search parameters
    REGION_PARAMS = {
        "global": {},
        "middle_east": {"gl": "sa", "cr": "countrySA|countryAE|countryEG|countryJO"},
        "africa": {"gl": "za", "cr": "countryZA|countryNG|countryKE|countryEG"},
        "asia": {"gl": "in", "cr": "countryIN|countryCN|countryJP|countryKR"},
        "europe": {"gl": "uk", "cr": "countryGB|countryDE|countryFR|countryIT"},
    }

    def __init__(self):
        self.api_key = os.getenv("GOOGLE_SEARCH_API_KEY", "")
        self.cx_id = os.getenv("GOOGLE_CX_ID", "")
        self.timeout = 30.0

        # BUG-004 FIX: Check for placeholder values, not just empty strings
        is_placeholder = (
            not self.api_key
            or not self.cx_id
            or self.api_key.startswith("your_")
            or self.cx_id.startswith("your_")
        )
        self.enabled = not is_placeholder

        if not self.enabled:
            print(
                "⚠️ Google Custom Search API not configured or using placeholder values. "
                "Set GOOGLE_SEARCH_API_KEY and GOOGLE_CX_ID in .env to enable."
            )

    def build_search_query(
        self,
        disease: str,
        additional_terms: List[str] = None,
        exclude_terms: List[str] = None,
        days_back: int = 7,
    ) -> str:
        """
        Build an optimized search query for disease news.

        Args:
            disease: Disease name to search for
            additional_terms: Additional search terms
            exclude_terms: Terms to exclude from results
            days_back: Only search within last N days

        Returns:
            Formatted search query string
        """
        # Base disease query with outbreak context
        query_parts = [
            f'"{disease}"',
            "(outbreak OR cases OR deaths OR epidemic OR infection OR confirmed)",
        ]

        # Add additional terms
        if additional_terms:
            query_parts.extend(additional_terms)

        # Add date restriction (Google uses dateRestrict parameter, but this helps)
        # query_parts.append(f"after:{(datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')}")

        # Build final query
        query = " ".join(query_parts)

        # Add exclusions
        if exclude_terms:
            exclusions = " ".join(f"-{term}" for term in exclude_terms)
            query = f"{query} {exclusions}"

        return query

    async def search(
        self,
        query: str,
        language: str = "en",
        region: str = "global",
        max_results: int = 10,
        days_back: int = 7,
    ) -> List[GoogleSearchResult]:
        """
        Perform a Google Custom Search.

        Args:
            query: Search query
            language: Language code (en, ar, fr, es)
            region: Region filter (global, middle_east, africa, asia, europe)
            max_results: Maximum number of results (max 10 per request)
            days_back: Restrict to last N days

        Returns:
            List of GoogleSearchResult objects
        """
        if not self.enabled:
            print("❌ Google Search not configured")
            return []

        results = []

        try:
            params = {
                "key": self.api_key,
                "cx": self.cx_id,
                "q": query,
                "num": min(max_results, 10),
                "safe": "off",
            }

            # Add language restriction
            if language in self.LANGUAGE_CODES:
                params["lr"] = self.LANGUAGE_CODES[language]

            # Add region parameters
            if region in self.REGION_PARAMS:
                params.update(self.REGION_PARAMS[region])

            # Add date restriction
            if days_back > 0:
                params["dateRestrict"] = f"d{days_back}"

            # Prefer news results
            params["siteSearch"] = ""

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(self.GOOGLE_SEARCH_URL, params=params)
                response.raise_for_status()
                data = response.json()

            # Parse results
            items = data.get("items", [])
            for item in items:
                result = GoogleSearchResult(
                    title=item.get("title", ""),
                    link=item.get("link", ""),
                    snippet=item.get("snippet", ""),
                    source="GOOGLE",
                    language=language,
                    disease=query.split('"')[1] if '"' in query else query.split()[0],
                )
                results.append(result)

            print(
                f"✅ Google search returned {len(results)} results for: {query[:50]}..."
            )

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                print("❌ Google Search API rate limit exceeded")
            elif e.response.status_code == 403:
                print("❌ Google Search API access denied. Check your API key.")
            else:
                print(f"❌ Google Search API error: {e.response.status_code}")
        except Exception as e:
            print(f"❌ Error performing Google search: {e}")

        return results

    async def search_disease_news(
        self,
        disease: str,
        language: str = "en",
        days_back: int = 7,
        max_results: int = 10,
    ) -> List[GoogleSearchResult]:
        """
        Search for news about a specific disease.

        Args:
            disease: Disease name (e.g., "Mpox", "Marburg")
            language: Search language
            days_back: Only return results from last N days
            max_results: Maximum number of results

        Returns:
            List of GoogleSearchResult objects
        """
        query = self.build_search_query(disease, days_back=days_back)
        return await self.search(
            query=query, language=language, max_results=max_results, days_back=days_back
        )

    async def search_all_diseases(
        self,
        diseases: List[str] = None,
        language: str = "en",
        days_back: int = 7,
        max_results_per_disease: int = 5,
    ) -> Dict[str, List[GoogleSearchResult]]:
        """
        Search for news about all configured diseases.

        Args:
            diseases: List of disease names (uses config if not provided)
            language: Search language
            days_back: Only return results from last N days
            max_results_per_disease: Max results per disease

        Returns:
            Dictionary mapping disease names to their search results
        """
        if diseases is None:
            # Get from environment
            diseases_str = os.getenv("SEARCH_DISEASES", "Mpox,Marburg,MERS,Cholera")
            diseases = [d.strip() for d in diseases_str.split(",")]

        results = {}
        for disease in diseases:
            print(f"🔍 Searching for {disease} news in {language}...")
            disease_results = await self.search_disease_news(
                disease=disease,
                language=language,
                days_back=days_back,
                max_results=max_results_per_disease,
            )
            results[disease] = disease_results

        return results


# Global client instance
google_search_client = GoogleSearchClient()


@function_tool
async def search_disease_news(
    ctx: RunContextWrapper[HealthContext],
    disease: str,
    language: str = "en",
    days_back: int = 7,
) -> str:
    """
    Search Google for news about a specific disease outbreak.

    Args:
        disease: Disease name to search for (e.g., "Mpox", "Marburg", "MERS")
        language: Search language code (en, ar, fr, es)
        days_back: Only return results from the last N days

    Returns:
        JSON string of search results:
        [
            {
                "title": "Article title",
                "link": "https://...",
                "snippet": "Article snippet...",
                "source": "GOOGLE",
                "language": "en",
                "disease": "Mpox"
            }
        ]
    """
    import json

    ctx.context.log(f"🔍 Google search: {disease} ({language}, last {days_back} days)")
    ctx.context.current_disease = disease

    results = await google_search_client.search_disease_news(
        disease=disease, language=language, days_back=days_back
    )

    ctx.context.log(f"✅ Found {len(results)} Google results for {disease}")

    # Convert to dictionaries
    results_dict = [r.model_dump() for r in results]

    return json.dumps(results_dict, ensure_ascii=False)


@function_tool
async def search_all_configured_diseases(
    ctx: RunContextWrapper[HealthContext], language: str = "en", days_back: int = 7
) -> str:
    """
    Search Google for news about all configured diseases.

    Args:
        language: Search language code (en, ar)
        days_back: Only return results from the last N days

    Returns:
        JSON string with search results grouped by disease
    """
    import json

    ctx.context.log(f"🔍 Searching all diseases ({language}, last {days_back} days)")

    results = await google_search_client.search_all_diseases(
        language=language, days_back=days_back
    )

    # Convert to serializable format
    output = {}
    total_count = 0
    for disease, disease_results in results.items():
        output[disease] = [r.model_dump() for r in disease_results]
        total_count += len(disease_results)

    ctx.context.log(
        f"✅ Total Google results: {total_count} across {len(results)} diseases"
    )

    return json.dumps(output, ensure_ascii=False)


@function_tool
async def search_custom_query(
    ctx: RunContextWrapper[HealthContext],
    query: str,
    language: str = "en",
    days_back: int = 7,
    max_results: int = 10,
) -> str:
    """
    Perform a custom Google search query.

    Args:
        query: Custom search query string
        language: Search language code
        days_back: Date restriction
        max_results: Maximum number of results

    Returns:
        JSON string of search results
    """
    import json

    ctx.context.log(f"🔍 Custom search: {query[:50]}...")

    results = await google_search_client.search(
        query=query, language=language, days_back=days_back, max_results=max_results
    )

    ctx.context.log(f"✅ Found {len(results)} results")

    results_dict = [r.model_dump() for r in results]

    return json.dumps(results_dict, ensure_ascii=False)
