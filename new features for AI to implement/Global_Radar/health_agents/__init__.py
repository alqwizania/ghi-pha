"""
Agents initialization - DabDar v3.0
All health surveillance agents
"""

# Note: Handoff configuration is done in configure_handoffs.py
# to avoid circular import issues

_AGENT_MODULES = {
    # Legacy agents
    "collection_monitor": ".collection_monitor",
    "analysis_specialist": ".analysis_specialist",
    "reporting_generator": ".reporting_generator",
    "orchestrator": ".orchestrator",
    # DabDar v3.0 agents
    "fetcher_agent": ".fetcher_agent",
    "epidemiological_agent": ".epidemiological_agent",
    "translator_agent": ".translator_agent",
    "database_agent": ".database_agent",
    "master_agent": ".master_agent",
}


def __getattr__(name: str):
    if name not in _AGENT_MODULES:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    from importlib import import_module

    module = import_module(_AGENT_MODULES[name], __name__)
    value = getattr(module, name)
    globals()[name] = value
    return value


__all__ = [
    # Legacy agents
    "collection_monitor",
    "analysis_specialist",
    "reporting_generator",
    "orchestrator",
    # DabDar v3.0 agents
    "fetcher_agent",
    "epidemiological_agent",
    "translator_agent",
    "database_agent",
    "master_agent",
]
