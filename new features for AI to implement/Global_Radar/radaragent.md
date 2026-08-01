# RadarAgent.md — SehaRadar v1.0 AI Agent Guidelines

> Comprehensive codebase guidelines for AI coding agents working on SehaRadar Health Surveillance System.

---

## Project Identity

**SehaRadar v1.0** is an intelligent health surveillance system that monitors global disease outbreaks through multi-source data aggregation (WHO, CDC, RSS feeds, Google Search), performs epidemiological analysis using AI agents, and generates bilingual (English/Arabic) email digests for health authorities.

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

### Local Development
```bash
# Install dependencies (uv is preferred)
uv sync

# Activate virtual environment
source .venv/bin/activate

# Run development server
python server.py

# Server runs at http://localhost:8080
```

### Docker Operations
```bash
# Build and start all services
docker compose up -d --build

# View logs (live tail)
docker logs seha-radar -f --tail 100

# Restart service
docker compose restart

# Full rebuild (when dependencies change)
docker compose down && docker compose up -d --build

# Stop all services
docker compose down
```

### Testing & Verification
```bash
# Test webhook endpoint
./test-webhook.sh

# Health check
curl http://localhost:8080/status

# Test unified scan
curl -X POST http://localhost:8080/api/scan-unified

# Test email digest
curl -X POST http://localhost:8080/api/send-email-digest
```

---

## Architecture Overview

### System Flow
```
[External Sources] → [Fetcher Agent] → [Deduplication] → [NocoDB]
       ↓                                                      ↓
[Webhook Triggers] → [Master Agent] → [Analysis] → [Translator] → [Email Digest]
```

### Agent Hierarchy
```
MasterAgent (Orchestrator)
├── FetcherAgent (Data Collection)
│   ├── WHO monitoring
│   ├── CDC RSS parsing
│   ├── Google Search
│   └── Change Detection webhook
├── TranslatorAgent (Arabic localization)
└── DigestAgent (Email generation)
```

### Key Workflows
1. **Unified Scan Workflow** (`unified_scan_workflow.py`)
   - Fetches from all sources
   - Deduplicates findings
   - Stores to NocoDB
   - Returns statistics

2. **Email Digest Workflow** (`email_digest_workflow.py`)
   - Retrieves recent findings
   - Translates to Arabic
   - Generates bilingual HTML email
   - Sends via SMTP

---

## Project Structure

```
SehaRadar/
├── server.py                       # FastAPI entrypoint (main server)
├── docker-compose.yml              # Service orchestration
├── Dockerfile                      # Container definition
├── pyproject.toml                  # Dependencies (uv format)
├── .env                            # Environment variables (not in git)
│
├── health_agents/                  # Agent definitions
│   ├── __init__.py
│   ├── shared/
│   │   └── models.py              # Pydantic models (Finding, HealthContext, Priority)
│   ├── master_agent.py            # Orchestration agent
│   ├── fetcher_agent.py           # Data fetching agent
│   ├── translator_agent.py        # Arabic translation agent
│   └── digest_agent.py            # Email digest generator
│
├── tools/                          # Function tools for agents
│   ├── __init__.py
│   ├── nocodb_client.py           # NocoDB API client (CRUD operations)
│   ├── deduplication.py           # Content hashing & duplicate detection
│   ├── rss_parser.py              # RSS feed parsing
│   ├── web_scraper.py             # Web content extraction
│   ├── arabic_translator.py       # Translation service
│   └── email_digest.py            # Email generation & SMTP
│
├── workflows/                      # Multi-step workflows
│   ├── __init__.py
│   ├── unified_scan_workflow.py   # Main scanning workflow
│   └── email_digest_workflow.py   # Email generation workflow
│
├── config/                         # Configuration files
│   ├── sources.json               # RSS feed URLs
│   └── email_templates/           # HTML email templates
│
└── tests/                          # Test suite (future)
    └── test_webhook.sh            # Webhook integration test
```

---

## Code Style Standards

### Import Organization
Always organize imports in three groups with blank lines between:

```python
# Group 1: Standard library
import os
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple

# Group 2: Third-party packages
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field, validator
import httpx
from openai import OpenAI

# Group 3: Local modules
from health_agents.shared.models import Finding, HealthContext, Priority
from tools.nocodb_client import NocoDBClientV3
from tools.deduplication import generate_content_hash, check_duplicate
```

### Type Hints (MANDATORY)
Always provide type hints for function signatures:

```python
# ✅ CORRECT
async def fetch_findings(
    source: str,
    limit: int = 10,
    date_range: Optional[Tuple[str, str]] = None
) -> List[Finding]:
    """Fetch findings from specified source."""
    pass

# ❌ WRONG - No type hints
async def fetch_findings(source, limit=10, date_range=None):
    pass
```

### Pydantic Models
Use Pydantic for all data structures with Field validators:

```python
from pydantic import BaseModel, Field
from enum import Enum

class SourceType(str, Enum):
    WHO = "WHO"
    CDC_RSS = "CDC_RSS"
    GOOGLE_SEARCH = "GOOGLE_SEARCH"
    CHANGEDETECTION = "ChangeDetection"

class Finding(BaseModel):
    """Represents a disease outbreak finding."""
    
    id: Optional[int] = None
    disease: str = Field(..., description="Primary disease name (e.g., 'Mpox', 'COVID-19')")
    source: str = Field(..., description="Source identifier (WHO, CDC, etc.)")
    source_type: SourceType = Field(default=SourceType.CHANGEDETECTION)
    headline: str = Field(..., min_length=10, description="Finding headline")
    url: Optional[str] = Field(None, description="Source URL")
    date: str = Field(..., description="Publication date (YYYY-MM-DD)")
    priority: Optional[Priority] = None
    summary: Optional[str] = None
    arabic_title: Optional[str] = None
    arabic_summary: Optional[str] = None
    content_hash: Optional[str] = None
    
    class Config:
        use_enum_values = True
        json_schema_extra = {
            "example": {
                "disease": "Mpox",
                "source": "WHO",
                "headline": "Mpox cases surge in Central Africa",
                "date": "2026-02-15"
            }
        }
```

### Function Tools (OpenAI Agents SDK)
Use `@function_tool` decorator with proper docstrings:

```python
from openai import OpenAI
from openai.agents import function_tool, RunContextWrapper

@function_tool
async def check_duplicate_finding(
    ctx: RunContextWrapper[HealthContext],
    disease: str,
    source: str,
    headline: str,
) -> str:
    """
    Check if a finding already exists in the database.
    
    This tool queries NocoDB to detect duplicate findings based on
    content hash generated from disease, source, and headline.
    
    Args:
        ctx: Agent run context with shared state
        disease: Disease name (e.g., "Mpox")
        source: Source identifier (e.g., "WHO", "CDC_RSS")
        headline: Finding headline text
    
    Returns:
        JSON string with {"is_duplicate": bool, "existing_id": int|null}
    """
    # Implementation
    ctx.context.log(f"🔍 Checking duplicate: {headline[:50]}...")
    
    content_hash = generate_content_hash(disease, source, headline)
    existing = await nocodb.find_by_hash(content_hash)
    
    result = {
        "is_duplicate": existing is not None,
        "existing_id": existing["id"] if existing else None
    }
    
    return json.dumps(result, ensure_ascii=False)
```

### Async/Await Patterns
All I/O operations **must** be async:

```python
# ✅ CORRECT - Async HTTP client with timeout
async def fetch_rss_feed(url: str) -> Optional[Dict[str, Any]]:
    """Fetch and parse RSS feed."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            return parse_rss(response.text)
    except httpx.HTTPStatusError as e:
        print(f"❌ HTTP error {e.response.status_code}: {url}")
        return None
    except Exception as e:
        print(f"❌ Error fetching RSS: {e}")
        return None

# ❌ WRONG - Blocking sync call
def fetch_rss_feed(url: str):
    response = requests.get(url)  # Blocks event loop!
    return response.json()
```

### Error Handling
Always use structured error handling with logging:

```python
async def save_finding(finding: Finding) -> Optional[int]:
    """Save finding to NocoDB."""
    try:
        # Attempt operation
        result = await nocodb.create_record(finding.model_dump())
        print(f"✅ Saved finding #{result['id']}: {finding.headline[:50]}")
        return result["id"]
    
    except httpx.HTTPStatusError as e:
        # HTTP-specific errors
        print(f"❌ HTTP {e.response.status_code} saving finding: {e.response.text}")
        return None
    
    except ValidationError as e:
        # Pydantic validation errors
        print(f"❌ Validation error: {e}")
        return None
    
    except Exception as e:
        # Catch-all for unexpected errors
        print(f"❌ Unexpected error saving finding: {type(e).__name__}: {e}")
        return None
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `NocoDBClientV3`, `FetcherAgent` |
| Functions | snake_case | `generate_content_hash`, `fetch_findings` |
| Variables | snake_case | `content_hash`, `finding_list` |
| Constants | UPPER_SNAKE | `VALID_SOURCES`, `DEFAULT_TIMEOUT` |
| Private methods | _leading_underscore | `_parse_response`, `_validate_date` |
| Async functions | async def snake_case | `async def fetch_data()` |

### Docstrings (Google Style)
All public functions and classes must have docstrings:

```python
def generate_content_hash(disease: str, source: str, headline: str) -> str:
    """
    Generate unique hash for finding deduplication.
    
    Uses MD5 hash of normalized content (lowercase, no extra whitespace).
    Used to prevent duplicate findings from being stored in NocoDB.
    
    Args:
        disease: Disease name (e.g., "Mpox", "COVID-19")
        source: Source identifier (e.g., "WHO", "CDC_RSS")
        headline: Finding headline text
    
    Returns:
        32-character hexadecimal hash string
    
    Example:
        >>> generate_content_hash("Mpox", "WHO", "New outbreak detected")
        'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    """
    # Implementation
```

### Logging with Emojis
Use consistent emoji prefixes for log readability:

```python
# Operation types
print(f"🔔 Webhook received: {payload['url']}")
print(f"🔍 Searching for duplicate findings...")
print(f"📝 Writing {len(findings)} findings to NocoDB")
print(f"🚀 Starting unified scan workflow")

# Status indicators
print(f"✅ Success: Saved finding #{finding_id}")
print(f"❌ Error: Failed to parse RSS feed")
print(f"⚠️ Warning: Duplicate finding detected")
print(f"ℹ️ Info: Using cached translation")

# Specific operations
print(f"📊 Statistics: {found} new, {duplicates} duplicates")
print(f"📧 Email sent to {recipient}")
print(f"🌐 Translating to Arabic: {text[:50]}...")
print(f"💾 Stored to NocoDB: {record_id}")
```

---

## Common Patterns & Recipes

### Pattern 1: Adding a New Data Source

**Scenario**: Add Twitter/X disease monitoring

**Steps**:
1. Create tool function in `tools/twitter_client.py`:
```python
@function_tool
async def fetch_twitter_mentions(
    ctx: RunContextWrapper[HealthContext],
    keyword: str,
    max_results: int = 10
) -> str:
    """Fetch recent tweets mentioning disease keywords."""
    # Implementation
```

2. Register in `tools/__init__.py`:
```python
from .twitter_client import fetch_twitter_mentions
```

3. Add to FetcherAgent in `health_agents/fetcher_agent.py`:
```python
fetcher_agent = Agent(
    name="FetcherAgent",
    instructions="...",
    functions=[
        fetch_rss_feeds,
        fetch_google_results,
        fetch_twitter_mentions,  # Add here
    ]
)
```

4. Update `unified_scan_workflow.py` to call new source

### Pattern 2: Creating a New Workflow

**Scenario**: Add PDF report generation workflow

**Steps**:
1. Create `workflows/pdf_report_workflow.py`:
```python
from typing import Dict, Any
from health_agents.shared.models import HealthContext
from tools.nocodb_client import NocoDBClientV3

async def generate_pdf_report(
    date_range: tuple[str, str],
    language: str = "en"
) -> Dict[str, Any]:
    """
    Generate PDF report for date range.
    
    Args:
        date_range: (start_date, end_date) in YYYY-MM-DD
        language: Report language ("en" or "ar")
    
    Returns:
        {"status": "success", "pdf_path": str, "findings_count": int}
    """
    # Implementation
    pass
```

2. Export from `workflows/__init__.py`:
```python
from .pdf_report_workflow import generate_pdf_report
```

3. Add API endpoint in `server.py`:
```python
@app.post("/api/generate-pdf-report")
async def api_generate_pdf_report(
    start_date: str,
    end_date: str,
    language: str = "en",
    background_tasks: BackgroundTasks = None
):
    """Generate PDF report for specified date range."""
    async def run_report():
        try:
            result = await generate_pdf_report((start_date, end_date), language)
            print(f"✅ PDF report generated: {result['pdf_path']}")
        except Exception as e:
            print(f"❌ PDF generation failed: {e}")
    
    background_tasks.add_task(run_report)
    return {"status": "accepted", "timestamp": datetime.now().isoformat()}
```

### Pattern 3: Adding NocoDB Table Operations

**Scenario**: Add support for new "Alerts" table

**Steps**:
1. Update `NocoDBClientV3` in `tools/nocodb_client.py`:
```python
class NocoDBClientV3:
    def __init__(self):
        self.base_url = os.getenv("NOCODB_API_URL")
        self.findings_table = os.getenv("NOCODB_TABLE_ID")
        self.alerts_table = os.getenv("NOCODB_ALERTS_TABLE_ID")  # New
    
    async def create_alert(self, alert_data: Dict[str, Any]) -> Optional[Dict]:
        """Create alert record."""
        endpoint = f"{self.base_url}/api/v2/tables/{self.alerts_table}/records"
        return await self._post(endpoint, alert_data)
```

2. Create Pydantic model:
```python
class Alert(BaseModel):
    finding_id: int
    severity: str  # "low", "medium", "high", "critical"
    notified_at: datetime
    recipients: List[str]
```

3. Create function tool if needed for agents

### Pattern 4: FastAPI Endpoint Template

```python
@app.post("/api/new-operation")
async def api_new_operation(
    param1: str,
    param2: int = 10,
    background_tasks: BackgroundTasks = None
) -> Dict[str, Any]:
    """
    Brief description of what this endpoint does.
    
    - **param1**: Description of param1
    - **param2**: Description of param2 (default: 10)
    """
    # Validation
    if param1 not in VALID_VALUES:
        raise HTTPException(status_code=400, detail=f"Invalid param1: {param1}")
    
    # Background task pattern (non-blocking)
    async def run_operation():
        try:
            result = await some_async_operation(param1, param2)
            statistics["operation_count"] += 1
            print(f"✅ Operation completed: {result}")
        except Exception as e:
            print(f"❌ Operation failed: {e}")
    
    background_tasks.add_task(run_operation)
    
    return {
        "status": "accepted",
        "message": "Operation queued",
        "timestamp": datetime.now().isoformat()
    }
```

---

## Agent Development Guidelines

### Agent Structure Template

```python
from openai import OpenAI
from openai.agents import Agent, function_tool, RunContextWrapper
from health_agents.shared.models import HealthContext

# Define function tools first
@function_tool
async def tool_function(
    ctx: RunContextWrapper[HealthContext],
    param1: str,
    param2: int = 10
) -> str:
    """Tool description for the agent."""
    # Access shared context
    ctx.context.log(f"Operation started: {param1}")
    
    # Perform operation
    result = await some_operation(param1, param2)
    
    # Return JSON string
    return json.dumps(result, ensure_ascii=False)

# Create agent instance
new_agent = Agent(
    name="NewAgent",
    instructions="""
    You are an expert at [specific domain].
    
    Your responsibilities:
    1. [Primary task]
    2. [Secondary task]
    
    Guidelines:
    - Always validate input before processing
    - Use available tools for all operations
    - Return structured JSON responses
    """,
    model="gpt-4o",
    functions=[tool_function],
)
```

### Context Management
Use `HealthContext` to share state across agent calls:

```python
from health_agents.shared.models import HealthContext

# Initialize context
context = HealthContext()

# Agents can access and modify shared context
result = await master_agent.run(
    instructions="Analyze recent findings",
    context=context
)

# Access logs
for log_entry in context.logs:
    print(log_entry)
```

### Multi-Agent Coordination

```python
async def coordinated_workflow() -> Dict[str, Any]:
    """Example of multi-agent workflow."""
    context = HealthContext()
    
    # Step 1: Data collection
    fetch_result = await fetcher_agent.run(
        instructions="Fetch findings from all sources",
        context=context
    )
    
    # Step 2: Translation (parallel if needed)
    translate_tasks = []
    for finding in context.findings:
        task = translator_agent.run(
            instructions=f"Translate to Arabic: {finding.headline}",
            context=context
        )
        translate_tasks.append(task)
    
    await asyncio.gather(*translate_tasks)
    
    # Step 3: Digest generation
    digest_result = await digest_agent.run(
        instructions="Generate email digest",
        context=context
    )
    
    return {
        "fetched": len(context.findings),
        "translated": len(translate_tasks),
        "digest_sent": digest_result.status == "sent"
    }
```

---

## Environment Variables Reference

### Required Variables

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-proj-...              # OpenAI API key for agents

# NocoDB Configuration
NOCODB_API_URL=http://nocodb:8080       # NocoDB base URL
NOCODB_API_TOKEN=your-token-here        # API authentication token
NOCODB_TABLE_ID=m1234567890abcdef       # Findings table ID
NOCODB_WORKSPACE_ID=ws_123456           # Workspace ID (optional)
NOCODB_BASE_ID=p_abcdef123456           # Base/Project ID (optional)

# Server Configuration
SERVER_PORT=8080                        # FastAPI server port
HOST=0.0.0.0                           # Bind address

# Feature Flags
DEDUPLICATION_ENABLED=true             # Enable content deduplication
TRANSLATION_ENABLED=true               # Enable Arabic translation
EMAIL_ENABLED=true                     # Enable email digest

# Email Configuration (for digest)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
EMAIL_FROM=noreply@seharadar.health
EMAIL_TO=recipient@example.com

# Optional: Webhook Security
WEBHOOK_SECRET=your-secret-key         # Validate incoming webhooks
```

### Development vs Production

```bash
# Development (.env.local)
OPENAI_API_KEY=sk-...
NOCODB_API_URL=http://localhost:8080
LOG_LEVEL=DEBUG
DEDUPLICATION_ENABLED=false            # Faster testing

# Production (.env)
OPENAI_API_KEY=sk-...
NOCODB_API_URL=http://nocodb:8080      # Docker service name
LOG_LEVEL=INFO
DEDUPLICATION_ENABLED=true
```

---

## Testing & Debugging

### Manual Testing

```bash
# 1. Health check
curl http://localhost:8080/status

# Expected: {"status": "ok", "timestamp": "..."}

# 2. Trigger unified scan
curl -X POST http://localhost:8080/api/scan-unified

# Expected: {"status": "accepted", "timestamp": "..."}

# 3. Test webhook (simulated)
curl -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.who.int/emergencies",
    "text": "Mpox outbreak in Central Africa",
    "timestamp": "2026-02-15T10:00:00Z"
  }'

# 4. Generate email digest
curl -X POST http://localhost:8080/api/send-email-digest

# 5. Check statistics
curl http://localhost:8080/status
```

### Debugging Agent Behavior

Enable verbose logging in agent context:

```python
context = HealthContext(verbose=True)
result = await agent.run(instructions="...", context=context)

# Print full conversation
for message in result.messages:
    print(f"{message.role}: {message.content}")
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| `httpx.ConnectError` | NocoDB not reachable | Check `NOCODB_API_URL`, verify service running |
| `401 Unauthorized` | Invalid NocoDB token | Verify `NOCODB_API_TOKEN` |
| `openai.AuthenticationError` | Invalid OpenAI key | Check `OPENAI_API_KEY` |
| Duplicate findings not detected | Hashing mismatch | Check `deduplication.py` logic |
| Arabic translation empty | API quota exceeded | Check OpenAI usage limits |
| Email not sending | SMTP config wrong | Test with `python -m smtplib` |

---

## Performance Considerations

### Async Best Practices
```python
# ✅ GOOD - Parallel requests
async def fetch_all_sources():
    tasks = [
        fetch_who_data(),
        fetch_cdc_rss(),
        fetch_google_results(),
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return results

# ❌ BAD - Sequential requests
async def fetch_all_sources():
    who_data = await fetch_who_data()
    cdc_data = await fetch_cdc_rss()
    google_data = await fetch_google_results()
    return [who_data, cdc_data, google_data]
```

### NocoDB Query Optimization
```python
# ✅ GOOD - Query with filters
findings = await nocodb.query_records(
    filters={"date": {"gte": "2026-02-01"}},
    limit=100,
    sort="-date"
)

# ❌ BAD - Fetch all then filter in Python
all_findings = await nocodb.list_all_records()
filtered = [f for f in all_findings if f["date"] >= "2026-02-01"]
```

### Caching Strategy
```python
from functools import lru_cache
from datetime import datetime, timedelta

# Cache expensive operations
_translation_cache: Dict[str, str] = {}

async def translate_with_cache(text: str) -> str:
    """Translate with in-memory caching."""
    if text in _translation_cache:
        print(f"ℹ️ Using cached translation")
        return _translation_cache[text]
    
    translation = await openai_translate(text)
    _translation_cache[text] = translation
    return translation
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All environment variables set in `.env`
- [ ] NocoDB tables created with correct schema
- [ ] OpenAI API key valid and has quota
- [ ] SMTP credentials tested
- [ ] Docker Compose file reviewed

### Deployment
```bash
# 1. Pull latest code
git pull origin main

# 2. Build fresh containers
docker compose down
docker compose build --no-cache

# 3. Start services
docker compose up -d

# 4. Verify health
docker logs seha-radar -f --tail 50

# 5. Test endpoints
curl http://localhost:8080/status
curl -X POST http://localhost:8080/api/scan-unified
```

### Post-Deployment
- [ ] Monitor logs for errors: `docker logs seha-radar -f`
- [ ] Verify webhooks receiving data
- [ ] Check NocoDB for new findings
- [ ] Test email digest delivery
- [ ] Set up monitoring/alerting (future)

---

## Security Guidelines

### API Keys
- **Never commit** `.env` files to git (already in `.gitignore`)
- Use environment variables for all secrets
- Rotate API keys regularly
- Use minimal permission scopes

### Input Validation
```python
# Always validate user input
from pydantic import BaseModel, validator

class WebhookPayload(BaseModel):
    url: str
    text: str
    timestamp: str
    
    @validator("url")
    def validate_url(cls, v):
        if not v.startswith(("http://", "https://")):
            raise ValueError("Invalid URL scheme")
        return v
```

### NocoDB Security
- Use read-only tokens for fetching
- Use write tokens only in background tasks
- Never expose tokens in API responses
- Validate all record IDs before deletion

---

## Future Enhancements Roadmap

### Phase 2 (Planned)
- [ ] Real-time WebSocket notifications
- [ ] Advanced analytics dashboard
- [ ] Machine learning outbreak prediction
- [ ] Multi-language support (French, Spanish)
- [ ] Mobile app integration

### Phase 3 (Backlog)
- [ ] Automated report generation (PDF)
- [ ] Integration with health authority APIs
- [ ] Geospatial visualization
- [ ] Historical trend analysis
- [ ] Custom alert rules engine

---

## Contributing Guidelines

### Before Making Changes
1. Read this entire document
2. Review existing code patterns
3. Check for similar implementations
4. Test locally before pushing

### Code Review Checklist
- [ ] Type hints on all functions
- [ ] Docstrings for public APIs
- [ ] Error handling with try/except
- [ ] Async functions for I/O
- [ ] Pydantic models for data structures
- [ ] Tests pass (when test suite exists)
- [ ] No hardcoded secrets
- [ ] Logging with appropriate emojis

---

## Support & Resources

### Documentation
- **FastAPI**: https://fastapi.tiangolo.com
- **Pydantic**: https://docs.pydantic.dev
- **OpenAI Agents SDK**: https://platform.openai.com/docs/guides/agents
- **httpx**: https://www.python-httpx.org
- **NocoDB**: https://docs.nocodb.com

### Internal Contacts
- Project Owner: [Your Name]
- DevOps: [Contact]
- Health Authority Liaison: [Contact]

### Quick Help
- Check logs: `docker logs seha-radar -f`
- Restart service: `docker compose restart`
- View env vars: `docker exec seha-radar env`
- Shell access: `docker exec -it seha-radar bash`

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-15  
**Maintained By**: SehaRadar Development Team
