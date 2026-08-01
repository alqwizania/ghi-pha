"""
Parser Plugin System for DabDar v4.0 Phase 2

This module provides a plugin-based architecture for parsing content from various sources.
Parsers can be:
- Source-specific (WHO, CDC, etc.)
- CSS selector-based (generic)
- AI-powered (fallback)

Usage:
    from parsers import parser_registry

    parser = parser_registry.get_parser("who_outbreak")
    items = await parser.parse(content, source)
"""

from .parser_registry import ParserRegistry, parser_registry
from .base_parser import BaseParser, RawFinding
from .who_parser import WHOParser
from .cdc_parser import CDCParser
from .generic_parser import GenericParser
from .ai_parser import AIParser
from .promed_parser import ProMEDParser
from .gtfcc_cholera_parser import GTFCCCholeraParser
from .who_mpox_parser import WHOMpoxParser
from .mhlw_covid_pdf_parser import MHLWCovidPDFParser
from .who_afro_document_parser import WHOAFRODocumentParser
from .ecdc_cdtr_pdf_parser import ECDCCDTRPDFParser

__all__ = [
    "ParserRegistry",
    "parser_registry",
    "BaseParser",
    "RawFinding",
    "WHOParser",
    "CDCParser",
    "GenericParser",
    "AIParser",
    "ProMEDParser",
    "GTFCCCholeraParser",
    "WHOMpoxParser",
    "MHLWCovidPDFParser",
    "WHOAFRODocumentParser",
    "ECDCCDTRPDFParser",
]
