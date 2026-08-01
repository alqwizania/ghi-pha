# ChangeDetection -> Unified Scan Sync Plan

## Goal

Implement a robust event-driven sync path so **every detected ChangeDetection change** triggers processing through `workflows/unified_scan_workflow.py` without running full scans for each event.

The solution must be:

- resilient to restarts,
- idempotent,
- safe under concurrency,
- easy to observe and operate.


## High-Level Design

Use a **hybrid model**:

1. **Push path (primary):** ChangeDetection webhooks enqueue watch-change events.
2. **Pull path (safety net):** periodic reconciliation compares ChangeDetection state vs local watermark and enqueues missed events.

Processing happens via a durable queue worker that runs a **single-watch scan** method in `UnifiedScanWorkflow`.


## Current State (relevant files)

- `server.py`
  - has `/api/scan-unified` and `/api/scan-test` endpoints.
  - no active ChangeDetection webhook endpoint.
- `workflows/unified_scan_workflow.py`
  - has robust per-watch logic in `_process_cd_watch(...)`.
  - public methods currently focus on full scan/test scan.
- `tools/changedetection_client.py`
  - supports list/get watches and snapshot fetching.
  - supports updating watches (`update_watch`) and reading changed state.
- `health_agents/shared/source_registry.py`
  - maps `watch_uuid <-> source` from `config/sources.json`.


## Implementation Scope

### In Scope

- Add webhook endpoint(s) for ChangeDetection events.
- Add durable event queue + watermark tracking.
- Add single-watch public scan method in unified workflow.
- Add queue worker lifecycle in app startup/shutdown.
- Add reconciliation task to catch missed webhooks.
- Add optional watch webhook auto-sync utility.
- Add tests for parsing, enqueueing, idempotency, and worker behavior.

### Out of Scope

- Rewriting parser/analyzer/translator/dedup internals.
- Replacing existing `/api/scan-unified` behavior.
- Changing source registry format.


## Data Model (SQLite, local durable queue)

Create a small SQLite-backed store (new module suggested: `tools/syncdetection_store.py`).

### Tables

1. `cd_events`

- `id` INTEGER PRIMARY KEY
- `event_key` TEXT UNIQUE NOT NULL          -- format: `<watch_uuid>:<last_changed>`
- `watch_uuid` TEXT NOT NULL
- `last_changed` REAL NOT NULL              -- unix timestamp from ChangeDetection
- `received_at` TEXT NOT NULL               -- ISO datetime
- `payload_json` TEXT                        -- raw payload for debugging
- `status` TEXT NOT NULL                    -- `pending|processing|done|failed|dead`
- `attempts` INTEGER NOT NULL DEFAULT 0
- `next_attempt_at` TEXT                     -- backoff scheduling
- `error` TEXT                               -- last error summary
- `processed_at` TEXT                        -- set when done

Indexes:

- unique index on `event_key`
- index on `(status, next_attempt_at)`
- index on `watch_uuid`

2. `cd_watch_state`

- `watch_uuid` TEXT PRIMARY KEY
- `last_processed_changed` REAL NOT NULL DEFAULT 0
- `updated_at` TEXT NOT NULL


## API and Routing

Add endpoints in `server.py`:

1. `POST /webhook/changedetection`

- Purpose: ingest ChangeDetection notifications.
- Auth: require token/header check (see Security section).
- Behavior:
  - parse payload;
  - derive `watch_uuid` and `last_changed`;
  - if unknown UUID: accept with warning (or 400 based on config);
  - enqueue idempotently;
  - return `202` quickly.

2. (Optional for compatibility) `POST /webhook/{source_id}`

- Resolve source from `source_registry` and map to `watch_uuid`.
- enqueue with inferred `last_changed` from current watch info if missing.

Response contract (recommended):

```json
{
  "accepted": true,
  "watch_uuid": "...",
  "event_key": "...",
  "deduplicated": false,
  "queued": true,
  "timestamp": "..."
}
```


## Webhook Payload Parsing Strategy

Add parser helper module (suggested `tools/syncdetection_payload.py`) with robust extraction:

- Try known keys for watch UUID:
  - `watch_uuid`, `uuid`, `watch.uuid`, `meta.watch_uuid`.
- Try known keys for change timestamp:
  - `last_changed`, `triggered_at_ts`, `meta.last_changed`.
- If `last_changed` missing:
  - fetch watch via `changedetection_client.get_watch(watch_uuid)` and use latest `last_changed`.
- If watch UUID still missing:
  - reject payload with `400` and clear error.

Keep parser tolerant because webhook payload formats may vary across ChangeDetection versions/notification templates.


## Worker Architecture

Add module: `workflows/syncdetection_worker.py`

### Components

1. **Queue poller loop**

- every N seconds (1-3s) fetch `pending` events where `next_attempt_at <= now`.
- claim event atomically by setting `status=processing`.

2. **Processing function**

- call `unified_scan_workflow.scan_watch(watch_uuid, expected_last_changed=...)`.
- on success:
  - set event `done`;
  - update `cd_watch_state.last_processed_changed`.
- on failure:
  - increment attempts;
  - if attempts <= max retry (e.g., 5), set `pending` with exponential backoff;
  - else set `dead`.

3. **Concurrency control**

- one global worker task with bounded watch-level concurrency (e.g., semaphore=2).
- enforce per-watch serialization by not processing two events for same watch concurrently.

4. **Graceful shutdown**

- stop loop on app shutdown;
- allow in-flight event(s) to complete or mark safely for retry.


## Unified Workflow Extension

Add a new public method in `workflows/unified_scan_workflow.py`:

`async def scan_watch(self, watch_uuid: str, expected_last_changed: float | None = None) -> Dict[str, Any]`

Behavior:

1. load watch info from ChangeDetection;
2. resolve source and enabled status via `source_registry`;
3. optional stale-event skip:
   - if `expected_last_changed` <= persisted watermark, skip as already processed;
4. run existing `_process_cd_watch(...)` pipeline;
5. return structured result payload with `items/analyzed/stored/duplicates/skipped`.

Important:

- Reuse existing `_process_cd_watch` logic, not duplicate it.
- Do not call full `scan_all_sources()` from webhook worker.


## Reconciliation (Missed Webhook Recovery)

Add periodic task (e.g., every 5-10 minutes):

1. `list_watches()` from ChangeDetection.
2. For each enabled watch in `source_registry`:
   - compare remote `last_changed` with local `cd_watch_state.last_processed_changed`.
   - if remote is newer, enqueue missing event key.

This guarantees eventual consistency even when webhooks are dropped or server is down.


## Webhook URL Auto-Sync (Operational robustness)

Add utility function (new module suggested: `tools/syncdetection_watch_sync.py`):

- Build canonical webhook URL from env (e.g., `PUBLIC_BASE_URL` + `/webhook/changedetection`).
- For each changedetection watch in `config/sources.json`:
  - fetch watch config;
  - ensure webhook URL is included in `notification_urls`;
  - patch watch via `changedetection_client.update_watch(...)` if missing.

Execution modes:

- startup check (`SYNCDETECTION_AUTO_SYNC_WEBHOOKS=true`)
- manual endpoint/admin command (optional)


## Security

1. **Authenticate webhook calls**

- Add env var: `CHANGEDETECTION_WEBHOOK_TOKEN`.
- Validate one of:
  - header `X-Webhook-Token`, or
  - query param token, or
  - shared secret inside payload.

2. **Allowlist source** (optional)

- If behind Cloudflare/Caddy, validate trusted proxy headers/IP ranges as feasible.

3. **Input validation**

- Add Pydantic models for webhook envelope variants.
- Persist raw payload for diagnostics, but avoid secret logging.


## Configuration Additions (.env)

- `SYNCDETECTION_ENABLED=true`
- `SYNCDETECTION_DB_PATH=/tmp/syncdetection.db`
- `SYNCDETECTION_WORKER_CONCURRENCY=2`
- `SYNCDETECTION_MAX_RETRIES=5`
- `SYNCDETECTION_RETRY_BASE_SECONDS=15`
- `SYNCDETECTION_RECONCILE_INTERVAL_SECONDS=300`
- `SYNCDETECTION_AUTO_SYNC_WEBHOOKS=false`
- `PUBLIC_BASE_URL=https://seha-radar.fayaa92.sa`
- `CHANGEDETECTION_WEBHOOK_TOKEN=<secret>`


## Startup/Shutdown Integration

In `server.py`:

- On startup:
  - initialize queue store;
  - create background tasks:
    - event worker loop,
    - reconciliation loop,
    - optional webhook auto-sync pass.
- On shutdown:
  - signal loops to stop;
  - wait for clean task cancellation.


## Observability

Add counters to existing `statistics` object:

- `cd_webhooks_received`
- `cd_webhooks_rejected`
- `cd_events_queued`
- `cd_events_deduplicated`
- `cd_events_processed`
- `cd_events_failed`
- `cd_events_dead_letter`
- `cd_reconcile_enqueued`

Add concise logs with watch UUID prefix and event key.


## Testing Plan

Add tests under `tests/`:

1. Payload parsing tests
- multiple payload shapes
- missing fields
- fallback watch lookup path

2. Queue idempotency tests
- duplicate `event_key` insertion deduplicates

3. Worker behavior tests
- success path updates watermark
- retry/backoff path
- dead-letter after max retries

4. Reconciliation tests
- remote newer than watermark enqueues event
- equal/older remote does not enqueue

5. API tests
- webhook auth fail/success
- 202 response and queue side effects


## Rollout Plan

### Phase 1 - Foundations

- create queue store module and schema migration.
- add payload parser + webhook auth helpers.

### Phase 2 - Processing Path

- add `scan_watch` in unified workflow.
- add worker loop using queue.

### Phase 3 - API + Lifecycle

- add webhook endpoint(s) in `server.py`.
- wire startup/shutdown background tasks.

### Phase 4 - Recovery + Auto-Sync

- add reconciliation loop.
- add optional watch webhook auto-sync utility.

### Phase 5 - Validation

- add and run tests.
- dry-run in staging with one watch.
- enable globally.


## Operational Runbook

### Verify webhook ingestion

- POST test payload to `/webhook/changedetection`.
- confirm `accepted=true` and `cd_events_queued` increments.

### Verify processing

- inspect logs for event key and `scan_watch` completion.
- confirm `cd_events_processed` increments.

### Verify recovery

- stop service, create page change, restart service.
- reconciliation should enqueue and process missed event.

### Troubleshooting

- `dead` events indicate persistent parser/source failure.
- replay by resetting status from `dead -> pending` after fix.


## Failure Modes and Mitigations

1. Webhook delivery failure
- mitigated by reconciliation loop.

2. Duplicate webhook bursts
- mitigated by unique `event_key` idempotency.

3. App restart during processing
- mitigated by durable queue state and retry semantics.

4. Source temporarily unavailable
- mitigated by exponential retries + dead-letter visibility.

5. Concurrent full scans and webhook scans
- mitigated by watch-level serialization and lock strategy.


## Acceptance Criteria

- Every changed watch eventually triggers `scan_watch` exactly-once per `watch_uuid:last_changed` event key.
- No full-scan invocation is required for webhook events.
- Missed webhooks are recovered by reconciliation.
- Duplicate webhook deliveries do not create duplicate findings.
- System survives restart without event loss.


## Suggested File Changes

- `server.py`
  - add webhook endpoint(s)
  - add startup/shutdown wiring for sync tasks
  - add statistics counters

- `workflows/unified_scan_workflow.py`
  - add `scan_watch(...)` public method

- `workflows/syncdetection_worker.py` (new)
  - queue worker + reconciliation loops

- `tools/syncdetection_store.py` (new)
  - sqlite schema + queue CRUD + watermark ops

- `tools/syncdetection_payload.py` (new)
  - payload parsing/normalization

- `tools/syncdetection_watch_sync.py` (new)
  - optional webhook URL auto-sync to watches

- `tests/test_syncdetection_*.py` (new)
  - ingestion, worker, reconciliation, idempotency tests


## Notes

- Keep existing `/api/scan-unified` as manual/full maintenance scan.
- Prefer minimal diffs and reuse the existing pipeline primitives already proven in production.
- Start with webhook + queue + single-watch processing; then enable reconciliation and auto-sync once baseline is stable.
