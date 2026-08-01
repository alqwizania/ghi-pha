"""
Configure agent handoffs after all agents are imported
This avoids circular import issues

DabDar v3.0 Agent Pipeline:
Master Agent -> Fetcher -> Epidemiological -> Translator -> Database
"""

# Import legacy agents
from . import orchestrator, collection_monitor, analysis_specialist, reporting_generator

# Import DabDar v3.0 agents
from .fetcher_agent import fetcher_agent
from .epidemiological_agent import epidemiological_agent
from .translator_agent import translator_agent
from .database_agent import database_agent
from .master_agent import master_agent


def configure_agent_handoffs():
    """Configure handoffs between all agents"""

    # ===== LEGACY AGENT CHAIN =====
    # Orchestrator can hand off to Collection Monitor
    orchestrator.handoffs = [collection_monitor]

    # Collection Monitor can hand off to Analysis Specialist
    collection_monitor.handoffs = [analysis_specialist]

    # Analysis Specialist can hand off to Reporting Generator
    analysis_specialist.handoffs = [reporting_generator]

    # Reporting Generator is the end of the chain (no handoffs)
    reporting_generator.handoffs = []

    # ===== DABDAR v3.0 AGENT CHAIN =====
    # Master Agent can hand off to Fetcher Agent
    master_agent.handoffs = [fetcher_agent]

    # Fetcher Agent can hand off to Epidemiological Agent
    fetcher_agent.handoffs = [epidemiological_agent]

    # Epidemiological Agent can hand off to Translator Agent
    epidemiological_agent.handoffs = [translator_agent]

    # Translator Agent can hand off to Database Agent
    translator_agent.handoffs = [database_agent]

    # Database Agent is the end of the v3 chain (no handoffs)
    database_agent.handoffs = []

    print("=" * 60)
    print("Agent handoffs configured")
    print("=" * 60)
    print("Legacy chain: Orchestrator -> Collection -> Analysis -> Reporting")
    print(
        "DabDar v3.0:  Master -> Fetcher -> Epidemiological -> Translator -> Database"
    )
    print("=" * 60)


def configure_v3_handoffs_only():
    """Configure only the DabDar v3.0 agent handoffs"""

    # DabDar v3.0 chain only
    master_agent.handoffs = [fetcher_agent]
    fetcher_agent.handoffs = [epidemiological_agent]
    epidemiological_agent.handoffs = [translator_agent]
    translator_agent.handoffs = [database_agent]
    database_agent.handoffs = []

    print("DabDar v3.0 handoffs configured")
