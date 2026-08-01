# SehaRadar

## Production Launch Path

Production is the Cloudflare MVP, not the retired Docker host. Deploy with Wrangler from this repo using `wrangler.jsonc`, D1, R2, Queues, Workflows, Browser Rendering, and Workers Static Assets. See `DEPLOY.md` and `docs/DATABASE_STANCE.md`.

The older FastAPI, Docker Compose, NocoDB, ChangeDetection.io, RSSHub, and local SQLite queue path remains as legacy/server-mode reference only.

SehaRadar is an AI-assisted health surveillance platform that monitors outbreak sources, parses updates from public-health websites and feeds, analyzes findings with LLMs, translates them to Arabic, deduplicates records, and serves public health-surveillance APIs. The production MVP runs on Cloudflare Workers with D1, R2, Queues, Workflows, Browser Rendering, and Workers Static Assets.

## What It Does

- Monitors health surveillance sources through ChangeDetection.io and RSSHub
- Parses source-specific content with pluggable parsers
- Runs epidemiological analysis and bilingual summarization via OpenRouter
- Deduplicates and stores findings in NocoDB
- Processes ChangeDetection webhooks through a durable queue worker
- Exposes APIs, source endpoints, and operational status

## Processing Flow

```text
ChangeDetection.io / RSSHub / Google search
        -> parse
        -> analyze
        -> translate
        -> deduplicate
        -> store
        -> dashboard / digest APIs
```

Webhook-driven scans follow this path:

```text
ChangeDetection webhook -> durable SQLite queue -> syncdetection worker -> single-watch scan
```

## Current Scope

- `config/sources.json` is the canonical source registry
- 42 sources are currently configured
- Source mix: 36 `changedetection`, 5 `rsshub`, 1 `google_search`
- Main server entrypoint: `server.py`
- Core orchestration: `workflows/unified_scan_workflow.py`

## Stack

- Python 3.11+
- FastAPI + Uvicorn
- Pydantic v2
- `httpx` + `aiosqlite`
- OpenRouter via OpenAI-compatible client setup in `tools/openai_client.py`
- NocoDB for findings storage
- ChangeDetection.io for source monitoring
- RSSHub for feed ingestion

## Repository Layout

- `server.py` - FastAPI app, routes, startup/shutdown, schedulers
- `workflows/` - scan, digest, retry, webhook, and sync workers
- `parsers/` - source-specific parsing implementations
- `tools/` - API clients, translation, deduplication, geocoding, storage helpers
- `health_agents/shared/` - shared models and source registry
- `config/sources.json` - unified source configuration
- `infra/changedetection/` - packaged ChangeDetection.io infra, docs, and MCP server source
- `tests/` - focused pytest coverage for syncdetection, parsers, and dry runs
- `docs/` - supporting operational and integration docs

## Prerequisites

You will need:

- Python 3.11+
- `uv` for local dependency management
- Docker and Docker Compose for containerized runs
- An `OPENROUTER_API_KEY` for LLM-powered analysis
- Reachable ChangeDetection.io and NocoDB services

This repository's compose setup starts `seha-radar` and `rsshub`. It expects other infrastructure, such as ChangeDetection.io and NocoDB, to already exist on the Docker network.

## Environment Setup

Copy the template and fill in the required values:

```bash
cp .env.example .env
```

Important variables:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (defaults to `openai/gpt-4o-mini`)
- `CHANGEDETECTION_URL`
- `CHANGEDETECTION_API_KEY`
- `NOCODB_BASE_ID`
- `NOCODB_API_TOKEN`
- `WEBHOOK_SECRET`
- `CHANGEDETECTION_WEBHOOK_TOKEN`

See `.env.example` for the full list, including syncdetection and RSSHub settings.

## Local Development

```bash
uv sync
source .venv/bin/activate
python server.py
```

Useful checks:

```bash
curl http://localhost:8080/status
curl http://localhost:8080/stats
```

## Docker Run

```bash
docker compose up -d --build seha-radar
docker logs -f --tail 150 seha-radar
```

For local Mac development without the production Caddy network, use:

```bash
docker compose -f docker-compose.mac.yml up --build
```

This local Compose profile binds the app to `localhost`, uses a local Docker volume for `/data`, and disables the background schedulers by default.

Then open:

- `http://localhost:8080/status`
- `http://localhost:8080/map/outbreaks`
- `http://localhost:8080/map/travel` (redirects to `/map/outbreaks`)
- `http://localhost:8080/admin/travel` (redirects to `/map/outbreaks`)

If `OPENROUTER_API_KEY` is not set, the app still starts for local UI work, but LLM-dependent scans remain disabled until the key is added to `.env`.

Because LLM-dependent workflows rely on the container networking and runtime wiring, run LLM smoke tests inside the `seha-radar` container rather than on the host.

## Key Endpoints

- `GET /status` - health check
- `GET /stats` - lightweight runtime stats
- `POST /api/scan-unified` - full unified scan
- `POST /api/scan-test` - smaller test scan subset
- `POST /api/scan-google` - Google-search supplement scan
- `POST /api/trigger-digest` - send digest
- `POST /api/reclassify` - reclassify stored findings
- `POST /webhook/changedetection` - authenticated ChangeDetection webhook
- `GET /api/sources` - inspect configured sources
- `GET /api/statistics` - server + database statistics

Once the server is running, FastAPI docs are available at `/docs`.

## Testing

Baseline syntax check:

```bash
uv run python -m compileall .
```

Run a focused test file:

```bash
uv run --with pytest pytest -v tests/test_syncdetection_api.py
```

Run a single test case:

```bash
uv run --with pytest pytest -v tests/test_syncdetection_api.py::test_webhook_path_token_success
```

Run a focused suite:

```bash
uv run --with pytest pytest -v \
  tests/test_syncdetection_payload.py \
  tests/test_syncdetection_store.py \
  tests/test_syncdetection_worker.py \
  tests/test_syncdetection_api.py
```

Dry-run pipeline validation without network calls:

```bash
uv run python tests/test_scan_dryrun.py
```

## Notes for Contributors

- Keep `config/sources.json` as the single source of truth for monitored sources
- Preserve the pipeline order: parse -> analyze -> translate -> deduplicate -> store
- Keep webhook processing idempotent with `watch_uuid:last_changed` keys
- Do not commit `.env` or any secret-bearing files
- Do not commit runtime data from `/srv/data`; see `docs/RUNTIME_DATA.md`
- Prefer minimal, scoped changes over wide refactors

## More Docs

- `AGENTS.md` - repo-specific engineering guidance
- `docs/README.md` - documentation index
- `docs/QUICK_START.md` - operational quick start
- `docs/API_INTEGRATIONS.md` - external service details
- `docs/RUNTIME_DATA.md` - files and secrets intentionally excluded from Git
- `DEPLOY.md` - future deployment notes
