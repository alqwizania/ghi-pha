"""
Tools initialization - DabDar v3.0
All tools for the health surveillance system
"""

# ===== EXISTING TOOLS =====
from .changedetection_client import fetch_html_snapshot
from .html_extraction import extract_findings_from_html
from .data_validator import validate_finding
from .nocodb_client import (
    query_historical_findings,
    write_finding_to_database,
    # DabDar v3.0 additions
    batch_write_findings,
    query_findings_by_disease,
    query_unsent_for_digest,
    mark_findings_as_sent,
    get_database_statistics,
    nocodb_v3,
)
from .llm_comparison import compare_with_historical_findings
from .keyword_detector import detect_keywords
from .report_generator import generate_daily_report_narrative
from .batch_analyzer import analyze_findings_batch

# ===== DABDAR v3.0 NEW TOOLS =====

# Deduplication
from .deduplication import (
    check_duplicate_finding,
    generate_finding_hash,
    calculate_text_similarity,
    generate_content_hash,
    dedup_service,
)

# RSS Parser (DEPRECATED — use RSSHub or ChangeDetection instead)
# from .rss_parser import (
#     fetch_rss_feeds,
#     fetch_all_rss_sources,
#     rss_parser,
# )

# Google Search
from .google_search import (
    search_disease_news,
    search_all_configured_diseases,
    search_custom_query,
    google_search_client,
)

# Epidemiological Triad Analyzer
from .epi_triad_analyzer import (
    analyze_epidemiological_content,
    identify_disease,
    extract_case_numbers,
    batch_analyze_findings,
    epi_analyzer,
)

# Arabic Translator
from .arabic_translator import (
    translate_to_arabic,
    translate_finding,
    batch_translate_findings,
    get_arabic_disease_name,
    get_arabic_medical_term,
    arabic_translator,
)

# Email Digest
from .email_digest import (
    compile_email_digest,
    send_digest_email,
    preview_digest,
    digest_service,
)

# Geocoder (SehaRadar Globe)
from .geocoder import get_geocoder

# RSSHub Client
from .rsshub_client import rsshub_client


__all__ = [
    # ===== EXISTING TOOLS =====
    "fetch_html_snapshot",
    "extract_findings_from_html",
    "validate_finding",
    "query_historical_findings",
    "write_finding_to_database",
    "compare_with_historical_findings",
    "detect_keywords",
    "generate_daily_report_narrative",
    "analyze_findings_batch",
    # ===== DABDAR v3.0 - NocoDB Enhanced =====
    "batch_write_findings",
    "query_findings_by_disease",
    "query_unsent_for_digest",
    "mark_findings_as_sent",
    "get_database_statistics",
    "nocodb_v3",
    # ===== DABDAR v3.0 - Deduplication =====
    "check_duplicate_finding",
    "generate_finding_hash",
    "calculate_text_similarity",
    "generate_content_hash",
    "dedup_service",
    # ===== DABDAR v3.0 - RSS Parser (DEPRECATED) =====
    # "fetch_rss_feeds",
    # "fetch_all_rss_sources",
    # "rss_parser",
    # ===== DABDAR v3.0 - Google Search =====
    "search_disease_news",
    "search_all_configured_diseases",
    "search_custom_query",
    "google_search_client",
    # ===== DABDAR v3.0 - Epidemiological Analyzer =====
    "analyze_epidemiological_content",
    "identify_disease",
    "extract_case_numbers",
    "batch_analyze_findings",
    "epi_analyzer",
    # ===== DABDAR v3.0 - Arabic Translator =====
    "translate_to_arabic",
    "translate_finding",
    "batch_translate_findings",
    "get_arabic_disease_name",
    "get_arabic_medical_term",
    "arabic_translator",
    # ===== DABDAR v3.0 - Email Digest =====
    "compile_email_digest",
    "send_digest_email",
    "preview_digest",
    "digest_service",
    # ===== SehaRadar Globe - Geocoder =====
    "get_geocoder",
    # ===== RSSHub =====
    "rsshub_client",
]
