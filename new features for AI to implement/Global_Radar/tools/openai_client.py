"""
Shared OpenRouter client (OpenAI-compatible SDK) with lazy initialization.

This avoids import-time errors when OPENROUTER_API_KEY is not set.
"""

import os
from typing import Optional

from agents import set_default_openai_api, set_default_openai_client
from openai import AsyncOpenAI


_openai_client: Optional[AsyncOpenAI] = None
_agents_sdk_configured = False


def get_default_llm_model() -> str:
    """Return default OpenRouter model for chat completions."""
    return os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")


def has_openrouter_api_key() -> bool:
    """Return whether OpenRouter credentials are available."""
    return bool(os.getenv("OPENROUTER_API_KEY"))


def get_openai_client() -> AsyncOpenAI:
    """
    Get or create OpenRouter client (lazy initialization).

    Returns:
        AsyncOpenAI: Configured OpenRouter client

    Raises:
        ValueError: If OPENROUTER_API_KEY is not set
    """
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENROUTER_API_KEY environment variable not set. "
                "Please configure it in .env file."
            )

        base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        default_headers = {}

        http_referer = os.getenv("OPENROUTER_HTTP_REFERER")
        if http_referer:
            default_headers["HTTP-Referer"] = http_referer

        app_title = os.getenv("OPENROUTER_APP_TITLE")
        if app_title:
            default_headers["X-Title"] = app_title

        _openai_client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            default_headers=default_headers,
        )
    return _openai_client


def configure_agents_sdk_for_openrouter() -> bool:
    """
    Configure OpenAI Agents SDK to route model calls through OpenRouter.

    Uses chat-completions API mode for best OpenRouter compatibility.

    Returns:
        bool: True when the SDK is configured, False when no API key is present.
    """
    global _agents_sdk_configured
    if _agents_sdk_configured:
        return True

    if not has_openrouter_api_key():
        return False

    set_default_openai_client(get_openai_client())
    set_default_openai_api("chat_completions")
    _agents_sdk_configured = True
    return True


def reset_client() -> None:
    """Reset the cached OpenRouter client and SDK config (for testing)."""
    global _openai_client, _agents_sdk_configured
    _openai_client = None
    _agents_sdk_configured = False
