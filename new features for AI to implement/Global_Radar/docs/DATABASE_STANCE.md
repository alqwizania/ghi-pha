# Database Stance

Launch decision: ship the Cloudflare MVP with D1 as the canonical query store, R2 for artifacts, and Cloudflare Queues for durable scan and processing jobs.

## Current Stance

- D1 is the production source of truth for sources, findings, scan state, scan runs, deduplication keys, quarantine rows, and digest metadata.
- R2 stores bulky operational artifacts such as raw HTML, rendered HTML, PDFs, parser payloads, generated reports, screenshots, and traces.
- Cloudflare Queues replace the old local SQLite SyncDetection queue for production job delivery and retry behavior.
- NocoDB, ChangeDetection.io, RSSHub containers, Docker Compose, and local SQLite queues are legacy/server-mode components and are not part of the production Cloudflare MVP.
- Production runtime values belong in Cloudflare Worker configuration and Wrangler-managed runtime values, not in local `.env` files.

## Why This Is The Launch Path

- The previous Docker host was retired, so there is no production machine for Docker Compose.
- `wrangler.jsonc`, `cloudflare/src/index.ts`, `migrations/0001_cloudflare_schema.sql`, and `cloudflare/scripts/seed-sources.mjs` already define a Cloudflare-native MVP path.
- Cloudflare-managed D1, R2, and Queues remove the need to restore the old server, NocoDB, ChangeDetection.io, RSSHub, Caddy, or Tunnel stack.
- Starting with the MVP source set keeps launch scope small while preserving the path to add heavier source coverage later.

## Operational Requirements

- Apply D1 migrations with Wrangler before deploying or seeding sources.
- Seed MVP sources into D1 with the idempotent seed script.
- Keep R2 private and expose artifact-backed data only through Worker routes when needed.
- Configure production runtime values through Wrangler or the Cloudflare dashboard without printing or committing values.
- Deploy from the repository root with `npx wrangler deploy`, not `docker compose`.

## Post-Launch Revisit Criteria

Revisit Cloudflare Containers only if the Workers-native processor cannot cover required Python parser fidelity, PDF-heavy workflows, browser-heavy authenticated sources, or other workloads that need the existing Python runtime.
