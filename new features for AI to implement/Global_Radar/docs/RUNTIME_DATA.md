# Runtime Data And Secrets

This repo contains source code, configuration templates, Docker files, docs, and helper scripts. It intentionally does not contain live secrets or persisted service data.

## Excluded Secrets

Create these from templates when needed:

- `SehaRadar/.env` from `.env.example`
- `SehaRadar/infra/changedetection/.env` from `infra/changedetection/.env.example`

Typical secret-bearing values include:

- `OPENROUTER_API_KEY`
- `CHANGEDETECTION_API_KEY`
- `CHANGEDETECTION_WEBHOOK_TOKEN`
- `WEBHOOK_SECRET`
- `NOCODB_API_TOKEN`
- `PROMED_EMAIL`
- `PROMED_PASSWORD`
- SMTP, Twilio, or other notification credentials

## Excluded Runtime Data

Back up these paths separately before deleting any server copy:

- `/srv/data/changedetection` - ChangeDetection watch definitions, history, snapshots, and service secret state.
- `/srv/data/seharadar` - SehaRadar persistent app data, including SyncDetection queue data if used.
- `/srv/data/changedetection-mcp` - legacy MCP runtime path from older packaging.
- NocoDB/Postgres data used by SehaRadar findings storage.

## Reinstall Considerations

`config/sources.json` contains ChangeDetection watch UUIDs. A clean reinstall that creates new watches will need either restored ChangeDetection data or an updated source registry with the new UUIDs.

Webhook processing needs matching values between SehaRadar and ChangeDetection:

- `PUBLIC_BASE_URL`
- `CHANGEDETECTION_WEBHOOK_TOKEN`
- ChangeDetection watch `notification_urls`

Do not assume a Git clone alone recreates historical watches, snapshots, NocoDB records, or queue contents.
