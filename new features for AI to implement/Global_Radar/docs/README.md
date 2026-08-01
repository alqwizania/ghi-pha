# SehaRadar Documentation

> **SehaRadar** - Cloudflare-native health surveillance MVP

## Documentation Index

| Document | Description |
|----------|-------------|
| [Quick Start Guide](QUICK_START.md) | Legacy/server setup reference |
| [API Integrations](API_INTEGRATIONS.md) | External APIs, authentication, and costs |
| [Database Stance](DATABASE_STANCE.md) | Cloudflare MVP database and queue decision |
| [Cloudflare Deployment](../DEPLOY.md) | Production architecture and launch checklist |
| [Bug Fixes v4.0](../BUGFIXES_V4.md) | Historical changelog |

## Production Deployment

- Production target: Cloudflare Workers, D1, R2, Queues, Workflows, Browser Rendering, and Workers Static Assets.
- Deploy from the repo root with `npx wrangler deploy`.
- Do not use Docker Compose, NocoDB, ChangeDetection.io, RSSHub containers, Caddy, or Cloudflare Tunnel for production launch.
- See [DEPLOY.md](../DEPLOY.md) for the Cloudflare implementation plan and launch checklist.

## Cloudflare MVP Architecture

```text
WHO / CDC / ECDC sources
        -> Cloudflare Worker scheduler
        -> Cloudflare Queues
        -> scanner queue consumer
        -> R2 source artifacts
        -> processor queue consumer
        -> OpenRouter analysis and Arabic translation
        -> D1 deduplication and findings storage
        -> public Worker API and static assets
```

## Key Production Commands

```bash
npm install
npm run worker:types
npm run worker:check
npx wrangler d1 migrations apply seharadar-prod --remote
npm run sources:seed:mvp -- --database seharadar-prod --remote
npx wrangler deploy --dry-run
npx wrangler deploy
```

## Smoke Tests

After deploy, check the deployed Worker URL:

```bash
curl https://<worker-url>/status
curl https://<worker-url>/api/stats
curl https://<worker-url>/api/sources
curl https://<worker-url>/api/scan-health
```

## Operations

- Worker logs: `npx wrangler tail seharadar-cloudflare`
- Database: D1 database `seharadar-prod`
- Artifacts: private R2 bucket `seharadar-artifacts`
- Job delivery: Cloudflare Queues `source-scan-jobs`, `finding-process-jobs`, and `dead-letter-jobs`
- Production runtime values: configure in Cloudflare with Wrangler or the dashboard, never in committed files

## Legacy References

The FastAPI/Docker/NocoDB/ChangeDetection path remains useful for code history and local reference only. It is not the production launch path now that the Docker host has been retired.
