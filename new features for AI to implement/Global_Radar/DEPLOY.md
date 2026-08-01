# Cloudflare Deployment Implementation Plan

SehaRadar will be deployed as a Cloudflare-only application. Do not use the historical FayaaLink server, Docker Compose deployment, ChangeDetection.io datastore, RSSHub container, NocoDB, Caddy, or Cloudflare Tunnel for this project.

## Target Architecture

The production system should use Cloudflare-managed services only:

- Cloudflare Workers for public API routes, scheduled jobs, queue consumers, and orchestration entrypoints.
- Cloudflare D1 as the queryable source of truth for sources, findings, scan state, scan runs, deduplication, quarantine rows, and digest metadata.
- Cloudflare R2 as the artifact store for raw HTML, rendered HTML, PDFs, parser payloads, generated reports, and optional screenshots.
- Cloudflare Queues for scan and processing jobs with retries and dead-letter handling.
- Cloudflare Workflows for durable multi-step source processing where scan work can exceed a single request lifecycle.
- Cloudflare Browser Rendering for JavaScript-heavy source pages that previously depended on ChangeDetection.io browser workers or local Playwright.
- Cloudflare Containers for the first-pass processor runtime, wrapping the existing Python parser and LLM pipeline while Workers own public API, scheduler, scanner, queue, and orchestration entrypoints.
- Cloudflare Workers observability and optional Analytics Engine for runtime metrics.

## Explicit Non-Goals

- Do not restore the old server deployment.
- Do not use NocoDB or Supabase.
- Do not run ChangeDetection.io as an external service.
- Do not run RSSHub as a required service.
- Do not use Cloudflare Access; public read surfaces are meant for public consumption.
- Do not expose internal scan trigger, write, or reclassification endpoints without separate secret-based protection and WAF/rate-limit rules.

## Storage Responsibilities

Use D1 and R2 together:

| Data | Store | Notes |
| --- | --- | --- |
| Source registry | D1 | Seed from `config/sources.json`; old `watch_uuid` values become obsolete metadata only. |
| Source scan state | D1 | Tracks `next_check_at`, last hashes, failures, and timestamps. |
| Findings | D1 | Replaces NocoDB findings table. |
| Deduplication keys | D1 | Use unique indexes on `content_hash` and source-specific event keys. |
| Quarantine findings | D1 | Replaces NocoDB quarantine table. |
| Scan jobs and runs | D1 | Persistent run/event history and status. |
| Raw fetched HTML | R2 | Store full content outside D1. |
| Browser-rendered HTML | R2 | Store Browser Rendering output. |
| PDFs and large documents | R2 | Store binary source artifacts. |
| Parser input/output payloads | R2 | Store bulky JSON for audit/debug. |
| Digest/report HTML | R2 | Store generated report artifacts. |

D1 should store R2 object keys and short excerpts, not full large artifacts.

## Proposed D1 Schema

Create one production D1 database, for example `seharadar-prod`.

```sql
create table sources (
  id text primary key,
  name text not null,
  type text not null,
  url text,
  parser text,
  enabled integer not null default 1,
  check_interval_seconds integer not null default 3600,
  priority_boost integer not null default 0,
  tags_json text,
  config_json text,
  legacy_watch_uuid text,
  created_at text not null,
  updated_at text not null
);

create table source_state (
  source_id text primary key references sources(id),
  last_checked_at text,
  next_check_at text,
  last_content_hash text,
  last_changed_at text,
  last_success_at text,
  last_error text,
  consecutive_failures integer not null default 0
);

create table source_snapshots (
  id integer primary key autoincrement,
  source_id text not null references sources(id),
  content_hash text not null,
  snapshot_kind text not null,
  r2_key text not null,
  snapshot_excerpt text,
  fetched_at text not null,
  status_code integer,
  metadata_json text,
  unique(source_id, content_hash, snapshot_kind)
);

create table scan_runs (
  id text primary key,
  source_id text references sources(id),
  trigger_type text not null,
  status text not null,
  started_at text not null,
  finished_at text,
  items_found integer not null default 0,
  findings_stored integer not null default 0,
  duplicates integer not null default 0,
  quarantined integer not null default 0,
  error text,
  metadata_json text
);

create table scan_events (
  id integer primary key autoincrement,
  event_key text unique not null,
  source_id text not null references sources(id),
  event_type text not null,
  status text not null,
  attempts integer not null default 0,
  next_attempt_at text,
  payload_json text,
  error text,
  received_at text not null,
  processed_at text
);

create table findings (
  id integer primary key autoincrement,
  disease text not null,
  source text not null,
  source_id text references sources(id),
  source_type text,
  source_link text,
  publication_date text,
  headline text not null,
  short_description_en text,
  detailed_description_en text,
  short_description_ar text,
  detailed_description_ar text,
  content_hash text unique,
  risk text,
  risk_assessment text,
  countries_json text,
  regions_json text,
  notification_sent integer not null default 0,
  approved integer not null default 1,
  source_snapshot_id integer references source_snapshots(id),
  parser_payload_r2_key text,
  created_at text not null,
  updated_at text not null
);

create table quarantine_findings (
  id integer primary key autoincrement,
  quarantine_key text unique not null,
  source_id text references sources(id),
  source text,
  source_type text,
  stage text not null,
  reason text not null,
  disease text,
  headline text,
  publication_date text,
  payload_r2_key text,
  created_at text not null
);

create table digest_runs (
  id text primary key,
  period text not null,
  r2_html_key text,
  findings_count integer not null default 0,
  created_at text not null,
  sent_at text,
  metadata_json text
);
```

Add indexes for public queries and workers:

```sql
create index idx_source_state_next_check on source_state(next_check_at);
create index idx_source_snapshots_source_time on source_snapshots(source_id, fetched_at desc);
create index idx_scan_events_status_next on scan_events(status, next_attempt_at);
create index idx_scan_runs_source_time on scan_runs(source_id, started_at desc);
create index idx_findings_publication_date on findings(publication_date desc);
create index idx_findings_risk_date on findings(risk, publication_date desc);
create index idx_findings_disease_date on findings(disease, publication_date desc);
create index idx_findings_source_date on findings(source_id, publication_date desc);
create index idx_findings_approved_date on findings(approved, publication_date desc);
```

## R2 Bucket Layout

Create one private R2 bucket, for example `seharadar-artifacts`.

Use stable, content-addressed keys where possible:

```text
snapshots/{source_id}/{yyyy}/{mm}/{dd}/{content_hash}.html
rendered/{source_id}/{yyyy}/{mm}/{dd}/{content_hash}.html
pdfs/{source_id}/{yyyy}/{mm}/{dd}/{content_hash}.pdf
parser-runs/{scan_run_id}/{source_id}.json
digests/{yyyy}/{mm}/{dd}/{digest_id}.html
screenshots/{source_id}/{yyyy}/{mm}/{dd}/{content_hash}.webp
traces/{scan_run_id}.json
```

Keep the bucket private. Public routes should read artifacts through Workers only when necessary.

R2 retention is finite for bulky operational artifacts. D1 keeps durable digest, finding, source, scan, and artifact metadata, including R2 object keys and short excerpts needed for public queries and audit trails. R2 lifecycle cleanup should remove raw snapshots, rendered pages, PDFs, parser payloads, screenshots, traces, and generated digest HTML after their configured operational retention window unless an artifact is explicitly promoted for investigation or reporting.

## Worker Applications

Split the deployment into small Workers rather than a single long-running FastAPI process:

| Worker | Responsibility |
| --- | --- |
| `seharadar-public` | Public site/API, Workers Static Assets, read-only D1 queries, cached responses. |
| `seharadar-scheduler` | Cron trigger, finds due sources in D1, enqueues scan jobs. |
| `seharadar-scanner` | Queue consumer, fetches source content, writes R2 snapshots, updates D1 state. |
| `seharadar-processor` | Parses snapshots, runs analysis/translation, writes findings. May call a container. |
| `seharadar-admin` | Optional secret-protected internal operations, not public UI. |

The public Worker should expose only read APIs by default:

- `GET /status`
- `GET /api/stats`
- `GET /api/findings`
- `GET /api/findings/{id}`
- `GET /api/sources`
- `GET /api/diseases`

Do not carry over Docker log endpoints such as `/api/logs/{service}` or `/api/stream/{service}`.

The public frontend should be served with Workers Static Assets attached to `seharadar-public`. Do not create a separate Cloudflare Pages project for the MVP public surface; keep static hosting, public reads, caching, and security policy in the same Worker deployment boundary.

## Queue And Workflow Design

Use Cloudflare Queues for job delivery:

- `source-scan-jobs`: one message per due source scan.
- `finding-process-jobs`: one message per changed snapshot or parser batch.
- `dead-letter-jobs`: failed messages after retry exhaustion.

Use D1 `scan_events` for durable event state and idempotency:

- Event key format: `{source_id}:{content_hash}` for changed snapshots.
- Manual rescan key format: `{source_id}:manual:{timestamp_or_uuid}`.
- Status values: `pending`, `processing`, `done`, `failed`, `dead`.

Use Workflows when a source processing path needs multiple retryable steps:

1. Load source and scan event from D1.
2. Fetch source or call Browser Rendering.
3. Write artifact to R2.
4. Compare content hash against D1 state.
5. Parse content.
6. Run LLM analysis and Arabic translation.
7. Deduplicate using D1.
8. Insert findings and quarantine records.
9. Update `source_state`, `scan_runs`, and `scan_events`.

## Source Monitoring Replacement

ChangeDetection.io is replaced by Cloudflare-native scanning:

1. `seharadar-scheduler` runs on a cron expression.
2. It queries `source_state.next_check_at <= now` from D1.
3. It enqueues scan jobs for due enabled sources.
4. The scanner fetches the source URL directly using Worker `fetch` when possible.
5. The scanner uses Browser Rendering for JavaScript-heavy pages.
6. The scanner hashes normalized content and compares it to `source_state.last_content_hash`.
7. If unchanged, it updates check timestamps only.
8. If changed, it writes the artifact to R2, records metadata in D1, and enqueues processing.

Old `watch_uuid` fields in `config/sources.json` should be retained only as migration metadata until removed.

## RSSHub Replacement

RSSHub should not be deployed as a Cloudflare service dependency.

For RSSHub sources in `config/sources.json`:

1. Prefer direct upstream RSS/feed/page fetching in Workers or the processor.
2. Convert RSSHub route metadata into source-specific fetcher configuration.
3. Store normalized feed entries in D1 findings after analysis.
4. Use R2 only for bulky raw feed or parser payload artifacts.

## Python Pipeline Migration

The current Python code in `server.py`, `workflows/`, `parsers/`, `tools/`, and `health_agents/` should be split into reusable processing modules.

First migration pass:

1. Run the first-pass processor as a Cloudflare Container wrapping the existing Python parser and LLM pipeline.
2. Create a container-compatible processor entrypoint that accepts a JSON job payload.
3. Keep Workers responsible for public API routes, scheduling, scanning, queue production/consumption, and workflow orchestration.
4. Remove assumptions about local `.env`, Docker socket, local SQLite, and background scheduler loops.
5. Read secrets from Cloudflare Worker/Container environment variables.
6. Return structured parser/analyzer results to the calling Worker or write directly through a D1-aware adapter.

Later migration pass:

1. Move lightweight parsers and public APIs to Workers-native TypeScript or Python Workers where practical.
2. Keep only heavy PDF, Browser, or Python-specific workloads in Containers.

## Storage Adapter Migration

Replace NocoDB coupling with a D1 storage adapter.

Keep these method names initially to reduce refactor size:

- `create_finding_v3`
- `write_finding_v3`
- `update_finding_v3`
- `query_findings`
- `query_findings_all`
- `patch_records`
- `query_unsent_findings`
- `mark_as_sent`
- `get_statistics`
- `get_finding_by_id`
- `check_duplicate_by_hash`
- `query_headlines_by_source`
- `create_quarantine_record`

Map NocoDB-style filtering to explicit SQL query builders. Do not preserve NocoDB `where` syntax as a long-term API.

## Configuration And Secrets

Cloudflare secrets:

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `GOOGLE_SEARCH_API_KEY`, if Google scanning stays enabled.
- `GOOGLE_CX_ID`, if Google scanning stays enabled.
- `PROMED_EMAIL`, if ProMED remains enabled.
- `PROMED_PASSWORD`, if ProMED remains enabled.
- Internal admin or trigger secret, if any write endpoints exist.

Cloudflare bindings:

- D1 binding: `DB`
- R2 binding: `ARTIFACTS`
- Queue producer bindings for scan and processing jobs.
- Queue consumer bindings for scanner and processor Workers.
- Browser Rendering binding/API access for rendered sources.

Public configuration such as enabled sources, disease catalog, and scan intervals should live in D1 after seeding.

## Public Security Model

This is a public consumption site, but only read surfaces should be public.

- Public endpoints must be read-only.
- Internal write, scan, reclassify, and digest-trigger endpoints require a secret header if exposed at all.
- Apply Cloudflare WAF/rate limiting to expensive endpoints and trigger routes.
- Use cache headers for public list/stat endpoints where data freshness permits.
- Never expose provider secrets or write-capable bindings to browser-side code.

## Implementation Phases

### Phase 1: Foundations

1. Add `wrangler.jsonc` configuration for Workers, D1, R2, Queues, and environment names.
2. Create D1 database `seharadar-prod`.
3. Create R2 bucket `seharadar-artifacts`.
4. Add D1 migrations for the schema above.
5. Add a seed script that imports `config/sources.json` into D1 `sources` and `source_state`.
6. Add a D1 storage adapter replacing NocoDB calls.

### Phase 2: Public API

1. Implement `seharadar-public` read endpoints on D1.
2. Add public filtering by disease, source, risk, date, and limit.
3. Add public stats endpoint backed by D1 aggregate queries.
4. Remove or ignore old Docker log and stream endpoints for Cloudflare deployment.

### Phase 3: Scanner

1. Implement cron scheduler that reads due sources from D1.
2. Implement scan queue producer.
3. Implement scanner queue consumer.
4. Write fetched or rendered artifacts to R2.
5. Store snapshot metadata in D1.
6. Enqueue processing only when content changes.

### Phase 4: Processor

1. Adapt existing parser pipeline to accept R2 artifact keys and source config.
2. Run parser output through existing quality gates.
3. Run OpenRouter analysis and Arabic translation.
4. Deduplicate through D1.
5. Insert findings and quarantine records into D1.
6. Record parser payloads in R2.

### Phase 5: Source Coverage

1. Start with `WHO`, `CDC`, and one generic source.
2. Add PDF sources after R2 artifact handling is stable.
3. Defer ProMED until after MVP because it depends on login/unlock/browser-heavy behavior that needs a separate Cloudflare-compatible source path.
4. Convert RSSHub sources to direct fetchers.
5. Remove disabled or obsolete server-specific source configuration.

### Phase 6: Operations

1. Add dashboards based on D1 `scan_runs`, `scan_events`, and Worker observability.
2. Add dead-letter inspection endpoint protected by a secret header.
3. Add retention cleanup for old R2 operational artifacts while preserving D1 metadata.
4. Add scheduled D1 export backup to R2 if desired.
5. Document recovery and redeploy commands.

## Validation Checklist

- D1 migrations apply locally and remotely.
- Source seed script is idempotent.
- Public API returns findings from D1.
- Scheduler enqueues only due enabled sources.
- Scanner writes R2 artifact and D1 snapshot metadata.
- Unchanged content does not enqueue duplicate processing.
- Changed content enqueues exactly one processing event per source/content hash.
- Processor inserts a finding and rejects duplicates through D1 unique/hash logic.
- Quarantine records are written for low-quality parser output.
- Public endpoints do not expose secrets or internal trigger capabilities.
- R2 bucket remains private.

## Initial Cloudflare Commands

These are examples and should be adjusted after `wrangler.jsonc` exists:

```bash
npx wrangler d1 create seharadar-prod
npx wrangler r2 bucket create seharadar-artifacts
npx wrangler queues create source-scan-jobs
npx wrangler queues create finding-process-jobs
npx wrangler queues create dead-letter-jobs
npx wrangler d1 migrations apply seharadar-prod --remote
npx wrangler secret put OPENROUTER_API_KEY
```

## Resolved Migration Decisions

### First-Pass Processor Runtime

Decision: the first-pass processor runtime is Cloudflare Containers wrapping the existing Python parser and LLM pipeline. Workers own public API routes, scheduler triggers, scanner execution, queue production/consumption, and workflow orchestration.

Operational implications: processor jobs should be shaped as explicit JSON payloads containing D1 IDs and R2 artifact keys; the container must not depend on the old Docker Compose runtime, local SQLite, local `.env` loading, background scheduler loops, or direct public exposure; Worker/Container secrets and bindings are the deployment boundary.

Unblocks: `SehaRadar-pi8.22`.

### Public Frontend Hosting

Decision: public frontend hosting is Workers Static Assets attached to `seharadar-public`, not Cloudflare Pages.

Operational implications: static assets, read-only public APIs, cache headers, and WAF/rate-limit behavior should be deployed and reviewed with the public Worker; no separate Pages project, Pages build pipeline, or Pages-specific routing is required for MVP.

Unblocks: `SehaRadar-pi8.12`.

### ProMED MVP Scope

Decision: ProMED is deferred from MVP because the current source path depends on login/unlock/browser-heavy behavior.

Operational implications: MVP source seeding and validation should exclude ProMED credentials and ProMED scan jobs; ProMED can return only after a separate Cloudflare-compatible authenticated/browser source path is designed and validated.

Unblocks: `SehaRadar-pi8.30`.

### R2 Artifact Retention

Decision: R2 uses explicit finite retention for bulky operational artifacts, while digest and finding metadata stay in D1.

Retention windows:

- Raw HTML snapshots and Browser-rendered HTML: 90 days.
- Source PDFs and large source documents: 180 days.
- Parser input/output payload JSON: 30 days.
- Screenshots and browser debug artifacts: 30 days.
- Trace/debug JSON: 14 days.
- Generated digest/report HTML: 365 days.

Operational implications: D1 remains the durable query/audit source for findings, digests, scan runs, artifact keys, and short excerpts; R2 lifecycle cleanup should cover raw snapshots, rendered pages, PDFs, parser payloads, screenshots, traces, and generated digest HTML after the configured retention window unless an artifact is promoted for investigation or reporting. Promoted artifacts should be copied to a retained prefix before cleanup rather than exempting whole source prefixes.

Unblocks: `SehaRadar-pi8.34`.

### Digest Delivery MVP Scope

Decision: the digest MVP stores digest artifacts and metadata only; delivery channels are deferred.

Operational implications: the first Cloudflare deployment should generate digest records and R2 artifacts without email, webhook, SMS, or other outbound delivery; delivery-specific secrets, retries, templates, and recipient management should be added in a later delivery bead.

Unblocks: `SehaRadar-pi8.37`.
