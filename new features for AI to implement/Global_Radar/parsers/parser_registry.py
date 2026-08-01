"""
Parser Registry — Central registry for all parser plugins.

This registry manages parser instances and provides lookup by parser ID.
"""

from typing import Dict, Optional, Any
from .base_parser import BaseParser
from .who_parser import WHOParser
from .cdc_parser import CDCParser
from .generic_parser import GenericParser
from .ai_parser import AIParser
from .rsshub_parser import RSSHubParser
from .promed_parser import ProMEDParser
from .gtfcc_cholera_parser import GTFCCCholeraParser
from .who_mpox_parser import WHOMpoxParser
from .mhlw_covid_pdf_parser import MHLWCovidPDFParser
from .who_afro_document_parser import WHOAFRODocumentParser
from .ecdc_cdtr_pdf_parser import ECDCCDTRPDFParser


class ParserRegistry:
    """
    Central registry for parser plugins.

    Manages parser instances and provides lookup by parser ID.
    Singleton pattern ensures single registry across application.
    """

    _instance: Optional["ParserRegistry"] = None

    def __init__(self):
        """Initialize parser registry."""
        if not hasattr(self, "_parsers"):
            self._parsers: Dict[str, BaseParser] = {}
            self._register_default_parsers()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _register_default_parsers(self) -> None:
        """Register built-in parsers."""
        # WHO parser
        self.register("who_outbreak", WHOParser())
        self.register("who", WHOParser())

        # CDC parser
        self.register("cdc_outbreak", CDCParser())
        self.register("cdc", CDCParser())

        # Generic parser (default)
        self.register("generic", GenericParser())

        # AI parser (fallback)
        self.register("ai", AIParser())

        # RSSHub parser
        self.register("rsshub", RSSHubParser())
        self.register("rsshub_json", RSSHubParser())

        # ProMED parser
        self.register("promed", ProMEDParser())

        # GTFCC cholera dashboard JSON parser
        self.register("gtfcc_cholera", GTFCCCholeraParser())

        # WHO mpox API JSON parser
        self.register("who_mpox", WHOMpoxParser())

        # Japan MHLW COVID-19 PDF parser
        self.register("mhlw_covid_pdf", MHLWCovidPDFParser())

        # WHO AFRO documents parser
        self.register("who_afro_document", WHOAFRODocumentParser())

        # ECDC CDTR PDF parser
        self.register("ecdc_cdtr_pdf", ECDCCDTRPDFParser())

        print(f"📚 Registered {len(self._parsers)} parsers")

    def register(
        self,
        parser_id: str,
        parser: BaseParser,
    ) -> None:
        """
        Register a parser.

        Args:
            parser_id: Unique identifier for the parser
            parser: Parser instance
        """
        self._parsers[parser_id] = parser

    def get_parser(
        self,
        parser_id: str,
        config: Optional[Dict[str, Any]] = None,
    ) -> Optional[BaseParser]:
        """
        Get parser by ID.

        Args:
            parser_id: Parser identifier
            config: Optional parser configuration

        Returns:
            Parser instance or None if not found
        """
        # If config provided, create new instance with config
        if config is not None:
            parser_instance = self._parsers.get(parser_id)
            if parser_instance is not None:
                parser_class = type(parser_instance)
                parser_ctor: Any = parser_class
                parser = parser_ctor()
                parser.config = config

                # Keep AI parser runtime knobs in sync when config is provided.
                if hasattr(parser, "model"):
                    parser.model = config.get("model", getattr(parser, "model"))
                if hasattr(parser, "max_tokens"):
                    parser.max_tokens = config.get(
                        "max_tokens", getattr(parser, "max_tokens")
                    )
                if hasattr(parser, "temperature"):
                    parser.temperature = config.get(
                        "temperature", getattr(parser, "temperature")
                    )
                return parser

        # Return existing instance
        return self._parsers.get(parser_id)

    def get_parser_safe(
        self,
        parser_id: str,
        config: Optional[Dict[str, Any]] = None,
    ) -> BaseParser:
        """
        Get parser by ID with fallback to generic parser.

        Args:
            parser_id: Parser identifier
            config: Optional parser configuration

        Returns:
            Parser instance (never None, falls back to generic)
        """
        parser = self.get_parser(parser_id, config)
        if parser is None:
            print(f"⚠️ Parser '{parser_id}' not found, using generic parser")
            parser = self.get_parser("generic", config)
        return parser or GenericParser()  # Final fallback

    def list_parsers(self) -> Dict[str, str]:
        """
        List all registered parsers.

        Returns:
            Dict mapping parser_id -> parser class name
        """
        return {
            parser_id: type(parser).__name__
            for parser_id, parser in self._parsers.items()
        }


# Singleton instance
parser_registry = ParserRegistry()


# Convenience function
def get_parser(
    parser_id: str, config: Optional[Dict[str, Any]] = None
) -> Optional[BaseParser]:
    """Get parser by ID (convenience function)."""
    return parser_registry.get_parser(parser_id, config)
