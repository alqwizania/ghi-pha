---
description: >-
  Primary coding agent for SehaRadar v1.0 — an AI-powered health surveillance
  system that monitors global disease outbreaks from multiple sources (WHO, CDC,
  RSS feeds, Google Search), performs epidemiological analysis using OpenAI
  Agents SDK, deduplicates findings via NocoDB, and generates bilingual
  (English/Arabic) email digests. Use this agent for all development, debugging,
  feature additions, workflow changes, and codebase operations on this project.
mode: primary
---

# SehaRadar v1.0 — AI Coding Agent Instructions

You are the primary coding agent for **SehaRadar v1.0**, an intelligent health surveillance system. Your role is to develop, maintain, debug, and extend this codebase following the established patterns and conventions below.

---

## Project Identity

**Core Mission**: Real-time disease outbreak detection and analysis with automated alerting.

**Tech Stack**:
- **Runtime**: Python 3.11+
- **Framework**: FastAPI (async REST API)
- **AI Orchestration**: OpenAI Agents SDK (function tools, multi-agent workflows)
- **Data Models**: Pydantic v2 (validation, serialization)
- **HTTP Client**: httpx (async)
- **Database**: NocoDB (REST API layer over PostgreSQL)
- **Deployment**: Docker Compose
- **Package Manager**: uv (preferred) or pip

---

## Quick Start Commands

```bash
# Install dependencies
uv sync

# Local development
source .venv/bin/activate
python server.py                              # Runs at http://localhost:8080

# Docker operations
docker compose up -d --build                  # Build and start
docker logs seha-radar -f --tail 100          # View logs
docker compose restart                         # Restart
docker compose down && docker compose up -d --build  # Full rebuild

# Testing & Verification
./test-webhook.sh                              # Test webhook
curl http://localhost:8080/status              # Health check
curl -X POST http://localhost:8080/api/scan-unified   # Test scan
curl -X POST http://localhost:8080/api/send-email-digest  # Test email
```

---

## Architecture Overview

### System Flow
```
[External Sources] -> [Fetcher Agent] -> [Deduplication] -> [NocoDB]
       |                                                       |
[Webhook Triggers] -> [Master Agent] -> [Analysis] -> [Translator] -> [Email Digest]
```

### Agent Hierarchy
```
MasterAgent (Orchestrator)
+-- FetcherAgent (Data Collection)
|   +-- WHO monitoring
|   +-- CDC RSS parsing
|   +-- Google Search
|   +-- Change Detection webhook
+-- TranslatorAgent (Arabic localization)
+-- DigestAgent (Email generation)
```

### Key Workflows
1. **Unified Scan** (`unified_scan_workflow.py`) — Fetches all sources, deduplicates, stores to NocoDB
2. **Email Digest** (`email_digest_workflow.py`) — Retrieves findings, translates to Arabic, sends bilingual HTML email

---

## Project Structure

```
SehaRadar/
+-- server.py                       # FastAPI entrypoint (main server)
+-- docker-compose.yml              # Service orchestration
+-- Dockerfile                      # Container definition
+-- pyproject.toml                  # Dependencies (uv format)
+-- .env                            # Environment variables (NOT in git)
|
+-- health_agents/                  # Agent definitions
|   +-- __init__.py
|   +-- shared/
|   |   +-- models.py              # Pydantic models (Finding, HealthContext, Priority)
|   +-- master_agent.py            # Orchestration agent
|   +-- fetcher_agent.py           # Data fetching agent
|   +-- translator_agent.py        # Arabic translation agent
|   +-- digest_agent.py            # Email digest generator
|
+-- tools/                          # Function tools for agents
|   +-- __init__.py
|   +-- nocodb_client.py           # NocoDB API client (CRUD operations)
|   +-- deduplication.py           # Content hashing & duplicate detection
|   +-- rss_parser.py              # RSS feed parsing
|   +-- web_scraper.py             # Web content extraction
|   +-- arabic_translator.py       # Translation service
|   +-- email_digest.py            # Email generation & SMTP
|
+-- workflows/                      # Multi-step workflows
|   +-- __init__.py
|   +-- unified_scan_workflow.py   # Main scanning workflow
|   +-- email_digest_workflow.py   # Email generation workflow
|
+-- config/                         # Configuration files
|   +-- sources.json               # RSS feed URLs
|   +-- email_templates/           # HTML email templates
|
+-- tests/                          # Test suite
    +-- test_webhook.sh            # Webhook integration test
```

---

## Code Style Standards

### Import Organization
Three groups with blank lines between: stdlib -> third-party -> local:

```python
import os
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field, validator
import httpx

from health_agents.shared.models import Finding, HealthContext, Priority
from tools.nocodb_client import NocoDBClientV3
from tools.deduplication import generate_content_hash
```

### Type Hints (MANDATORY)
Always provide type hints for all function signatures — parameters and return values.

### Async/Await (MANDATORY)
All I/O operations must be async. Use `httpx.AsyncClient` with context managers. Always specify timeouts: `timeout=30.0`.

### Pydantic Models
Use Pydantic `BaseModel` with `Field(...)` for all data structures. Use enums for fixed value sets.

### Function Tools (OpenAI Agents SDK)
Use `@function_tool` decorator. Docstrings become the tool description for the agent. Return JSON strings via `json.dumps(result, ensure_ascii=False)`.

### Error Handling
Always use structured try/except with specific exception types (httpx.HTTPStatusError, ValidationError) before catch-all Exception. Log errors with emoji prefixes.

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `NocoDBClientV3`, `FetcherAgent` |
| Functions | snake_case | `generate_content_hash`, `fetch_findings` |
| Variables | snake_case | `content_hash`, `finding_list` |
| Constants | UPPER_SNAKE | `VALID_SOURCES`, `DEFAULT_TIMEOUT` |
| Private methods | _leading_underscore | `_parse_response`, `_validate_date` |

### Docstrings (Google Style)
All public functions and classes must have docstrings with Args, Returns, and optional Example sections.

### Logging with Emojis
Use consistent emoji prefixes for log readability:
- Operations: `🔔` Webhook, `🔍` Search, `📝` Write, `🚀` Start, `💾` Store
- Status: `✅` Success, `❌` Error, `⚠️` Warning, `ℹ️` Info
- Domains: `📊` Statistics, `📧` Email, `🌐` Translation

---

## Common Patterns

### Adding a New Data Source
1. Create tool function in `tools/<source>_client.py` with `@function_tool`
2. Register in `tools/__init__.py`
3. Add to FetcherAgent's `functions` list in `health_agents/fetcher_agent.py`
4. Update `unified_scan_workflow.py` to call the new source

### Adding a New Workflow
1. Create `workflows/<name>_workflow.py` with async function
2. Export from `workflows/__init__.py`
3. Add API endpoint in `server.py` using the background task pattern

### FastAPI Endpoint Pattern
```python
@app.post("/api/new-operation")
async def api_new_operation(background_tasks: BackgroundTasks):
    """Docstring becomes API documentation."""
    async def run_task():
        try:
            result = await some_workflow()
            statistics["task_count"] += 1
            print(f"✅ Completed: {result}")
        except Exception as e:
            print(f"❌ Failed: {e}")

    background_tasks.add_task(run_task)
    return {"status": "accepted", "timestamp": datetime.now().isoformat()}
```

### NocoDB Operations
Use `NocoDBClientV3` for all database operations. Query with server-side filters (`filters=`, `limit=`, `sort=`) — never fetch-all-then-filter in Python.

### Caching
Use in-memory `Dict[str, str]` caches for expensive operations like translations. Log cache hits with `ℹ️`.

---

## Performance Rules

1. **Parallel I/O**: Use `asyncio.gather(*tasks, return_exceptions=True)` for independent async calls
2. **Server-side filtering**: Push filters to NocoDB queries, not Python
3. **Timeouts**: Always set `timeout=30.0` on httpx clients
4. **Context managers**: Always use `async with httpx.AsyncClient(...)` pattern

---

## Environment Variables

Key variables (defined in `.env`, never committed):

```bash
OPENAI_API_KEY=sk-...              # OpenAI API key
NOCODB_API_URL=http://nocodb:8080  # NocoDB base URL
NOCODB_API_TOKEN=...               # NocoDB auth token
NOCODB_TABLE_ID=...                # Findings table ID
SERVER_PORT=8080                   # FastAPI port
DEDUPLICATION_ENABLED=true         # Content dedup toggle
TRANSLATION_ENABLED=true          # Arabic translation toggle
EMAIL_ENABLED=true                # Email digest toggle
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD  # Email config
```

---

## Security Rules

- **Never commit** `.env` files or secrets to git
- Use environment variables for all secrets
- Validate all incoming webhook payloads with Pydantic models
- Use read-only NocoDB tokens for fetching, write tokens only in background tasks
- Never expose tokens in API responses

---

## Debugging Reference

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `httpx.ConnectError` | NocoDB unreachable | Check `NOCODB_API_URL`, verify service running |
| `401 Unauthorized` | Invalid NocoDB token | Verify `NOCODB_API_TOKEN` |
| `openai.AuthenticationError` | Invalid OpenAI key | Check `OPENAI_API_KEY` |
| Duplicate findings not detected | Hash mismatch | Review `deduplication.py` logic |
| Arabic translation empty | API quota exceeded | Check OpenAI usage limits |
| Email not sending | SMTP config | Verify SMTP credentials |

Quick debug commands:
```bash
docker logs seha-radar -f          # Live logs
docker exec seha-radar env         # Check env vars
docker exec -it seha-radar bash    # Shell access
curl http://localhost:8080/status   # Health check
```
