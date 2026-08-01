# ProMED Automation Logic (SehaRadar)

This document explains the current ProMED integration for watcher:

- `ee064572-cd0c-4e42-b512-43b7f7300684`

## Why this exists

ChangeDetection snapshot content for ProMED mostly contains article titles, not usable outbound article links. To store useful links in findings, SehaRadar runs a dedicated resolver flow.

## Implemented architecture

1. **Watcher remains ChangeDetection source**
   - Source ID: `PROMED`
   - Watch UUID: `ee064572-cd0c-4e42-b512-43b7f7300684`
   - Config in `config/sources.json` uses parser `promed`.

2. **Custom parser: `parsers/promed_parser.py`**
   - Extracts title candidates from snapshot text.
   - Filters boilerplate lines (`Date Title`, login/signup/menu text, etc.).
   - Deduplicates and keeps only new titles by comparing against existing stored PROMED headlines.
   - Attempts resolution for max `5` titles per run (`max_unlocks`).

3. **Resolver script: `promed.js`**
   - Called by parser as: `node promed.js --resolve-batch <payload.json>`.
   - Accepts either `targets` (preferred) or `titles` payload.
   - Uses Playwright to automate ProMED access and resolve item links.
   - Uses row-based clicking with this XPath template:
     - `/html/body/div[2]/article/div/section[1]/div[2]/div/div[1]/div/div[2]/div[2]/div/div/div/table/tbody/tr[%ROW%]/td[2]/div`
   - Emits JSON on stdout with prefix:
     - `PROMED_RESOLVE_JSON:{...}`

4. **Storage mapping**
   - On successful resolution, parser returns findings with `link` and `article_url` set to the resolved link.
   - Workflow writes this into NocoDB `url` via normal mapping path.

## Files changed for this integration

- `config/sources.json`
- `parsers/promed_parser.py`
- `parsers/parser_registry.py`
- `parsers/__init__.py`
- `workflows/unified_scan_workflow.py`
- `tools/nocodb_client.py`
- `promed.js`
- `Dockerfile`
- `package.json`
- `package-lock.json`

## Current runtime behavior

- New-only logic is active: no backfill behavior is implemented.
- Resolver currently attempts signup flow by default.
- If ProMED blocks signups from the IP, link resolution fails (no resolved links stored).

## Known operational caveat

If signup is rate-limited by ProMED/Auth provider (for example: `Too many signups from the same IP`), resolver may return zero links even when title extraction works.
