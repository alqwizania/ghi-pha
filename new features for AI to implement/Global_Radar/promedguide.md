# ProMED Targeted Test Scan Guide

This guide covers setup, testing, and troubleshooting for the ProMED watcher:

- UUID: `ee064572-cd0c-4e42-b512-43b7f7300684`

---

## Architecture

ProMED articles live behind Auth0 authentication with Cloudflare Turnstile CAPTCHA.
The resolver (`promed.js`) uses **playwright-extra** with the **stealth plugin** to
bypass Turnstile's bot detection automatically. The stealth plugin applies 17+
browser fingerprint evasion techniques so Turnstile auto-solves without manual clicks.

```
ChangeDetection.io snapshot (titles only)
  -> promed_parser.py (extract titles, filter duplicates)
    -> promed.js (Playwright + stealth: login, navigate, extract article links)
      -> epi_triad_analyzer (LLM disease classification)
        -> NocoDB (store findings with resolved URLs)
```

Key files:

| File | Role |
|------|------|
| `promed.js` | Playwright resolver — login, CAPTCHA bypass, link extraction |
| `parsers/promed_parser.py` | Python parser — calls `promed.js` via subprocess |
| `package.json` | Node deps: `playwright-extra`, `puppeteer-extra-plugin-stealth` |

---

## 0) Prerequisites — ProMED Credentials

ProMED requires authentication to view full articles and extract external source links.
The server IP is **rate-limited for new signups**, so you must create an account manually.

### Create account (one-time, from a different device)

1. Go to [promedmail.org](https://promedmail.org) on your phone/laptop/VPN
2. Click **Subscribe** and create a free account
3. Verify the email if required
4. Confirm you can log in and see full article bodies

### Add credentials to `.env`

```bash
nano /srv/docker/SehaRadar/.env
```

Set these two variables (they should already exist as empty placeholders):

```
PROMED_EMAIL=your@email.com
PROMED_PASSWORD=yourpassword
```

### Verify credentials are loaded

After rebuilding (step 1), confirm the container sees them:

```bash
docker exec seha-radar printenv | grep PROMED
```

Expected output:
```
PROMED_EMAIL=your@email.com
PROMED_PASSWORD=yourpassword
```

---

## 1) Rebuild and restart (after code or .env changes)

From repo root:

```bash
docker compose down && docker compose up -d --build
```

Verify container is healthy:

```bash
docker ps --filter name=seha-radar --format "table {{.Names}}\t{{.Status}}"
```

Verify stealth plugin loads correctly:

```bash
docker exec seha-radar node -e "
  const { chromium } = require('playwright-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  chromium.use(StealthPlugin());
  console.log('stealth plugin OK');
"
```

## 2) Run targeted test scan (recommended: inside container)

```bash
docker exec -i seha-radar python -u - <<'PY'
import asyncio
import json
from workflows.unified_scan_workflow import unified_scan_workflow

WATCH_UUID = "ee064572-cd0c-4e42-b512-43b7f7300684"

async def main() -> None:
    result = await unified_scan_workflow.scan_test(
        max_sources=1,
        watch_uuids=[WATCH_UUID],
    )
    print(json.dumps(result, ensure_ascii=False))

asyncio.run(main())
PY
```

What to look for in logs/output:

- `Processing: PROMED ... [Parser: promed]` — source picked up
- `ProMED credentials provided` — creds loaded from env
- `ProMED Parser: <N> new titles, 5 attempted, <M> resolved` — resolution stats
- `stored` value in final JSON > 0 — findings saved

Example successful output:
```
ProMED Parser: 141 new titles, 5 attempted, 5 resolved
  Parsed 5 items
  Analyzed 5 items
  Stored: 4 new, 1 duplicates
```

## 3) Optional: Trigger via API endpoint

If API is reachable from your environment:

```bash
curl -X POST http://localhost:8080/api/scan-test \
  -H "Content-Type: application/json" \
  -d '{"watch_uuids": ["ee064572-cd0c-4e42-b512-43b7f7300684"]}'
```

Then inspect container logs:

```bash
docker logs seha-radar -f --tail 200
```

## 4) Verify inserted links in NocoDB

Goal: new PROMED findings should store resolved article links in `url` (not the root site).

Quick in-app check (if endpoint enabled in your setup):

```bash
curl "http://localhost:8080/api/findings?source=PROMED&limit=20"
```

Then inspect `url` values — they should be external article URLs, not `https://promedmail.org/`.

---

## 5) Troubleshooting

### If resolution is 0

Common causes:

1. **No credentials in `.env`** — `PROMED_EMAIL` / `PROMED_PASSWORD` are empty or missing
2. **Bad credentials** — wrong email/password, account not verified
3. **Stealth plugin not installed** — `playwright-extra` or stealth plugin missing from `node_modules`
4. **Auth flow changed** — ProMED/Auth0 updated their login page selectors
5. **Page flow changed** — article panel or radix component selectors shifted
6. **Turnstile upgraded** — Cloudflare may update Turnstile to detect newer stealth techniques

### Debug: Check auth status in logs

```bash
docker logs seha-radar --tail 50 | grep -i -E "auth|login|promed|captcha|turnstile"
```

Look for:
- `Login successful` — credentials worked, Turnstile bypassed
- `Turnstile auto-solved` — stealth plugin worked, CAPTCHA passed
- `Turnstile did NOT auto-solve` — stealth evasion failed, check screenshot at `/tmp/promed_captcha_timeout.png`
- `auth_failed` — login didn't go through
- `ProMED credentials NOT found` — env vars missing

### Debug: Run resolver directly

Create a test payload inside the container:

```bash
docker exec seha-radar bash -c 'cat > /tmp/test_payload.json << EOF
{
  "base_url": "https://www.promedmail.org/",
  "headless": true,
  "email": "'$PROMED_EMAIL'",
  "password": "'$PROMED_PASSWORD'",
  "targets": [
    { "title": "SAMPLE TITLE FROM PROMED", "row_number": 1 }
  ]
}
EOF'
```

Run the resolver directly:

```bash
docker exec seha-radar node /app/promed.js --resolve-batch /tmp/test_payload.json
```

> **Note**: When running through the normal scan pipeline (steps 2-3), credentials
> are read from env vars automatically by `promed_parser.py` — you don't need to
> put them in the payload JSON manually.

### Debug: Check screenshots

If Turnstile fails to auto-solve, `promed.js` saves a screenshot:

```bash
docker cp seha-radar:/tmp/promed_captcha_timeout.png ./captcha_debug.png
```

### Debug: Verify stealth is actually active

If you suspect the stealth plugin isn't loading:

```bash
docker exec seha-radar node -e "
  const { chromium } = require('playwright-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  chromium.use(StealthPlugin());
  (async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const webdriver = await page.evaluate(() => navigator.webdriver);
    console.log('navigator.webdriver:', webdriver);
    await browser.close();
  })();
"
```

Expected: `navigator.webdriver: false` (stealth hides it). If `true`, the plugin isn't working.

---

## 6) End-to-end verification checklist

After setting credentials and rebuilding:

- [ ] `docker exec seha-radar printenv | grep PROMED` shows both vars populated
- [ ] Container is healthy: `docker ps --filter name=seha-radar`
- [ ] Stealth plugin loads: `node -e "require('playwright-extra')"` succeeds inside container
- [ ] Test scan (step 2) logs show `Login successful` or `redirected to`
- [ ] No `Turnstile did NOT auto-solve` errors in logs
- [ ] Test scan resolves at least 1 external article link (not `external_link_not_found`)
- [ ] NocoDB findings (step 4) have real article URLs, not just `https://promedmail.org/`

---

## 7) How the CAPTCHA bypass works

The `promed.js` resolver uses [`playwright-extra`](https://github.com/nicedayfor/playwright-extra)
with [`puppeteer-extra-plugin-stealth`](https://github.com/nicedayfor/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
to make headless Chromium appear indistinguishable from a real browser.

The stealth plugin patches:
- `navigator.webdriver` (hidden)
- `navigator.plugins` (faked)
- `navigator.languages` (realistic)
- Chrome runtime properties (`window.chrome`)
- WebGL renderer/vendor strings
- Codec support fingerprints
- iframe content window access patterns
- And 10+ other detection vectors

With these evasions active, Cloudflare Turnstile auto-solves in the background
without requiring any user interaction or explicit clicking. The `promed.js` code
polls for up to 20 seconds for Turnstile to complete (checking for a token in the
hidden input or the container disappearing), then proceeds with form submission.

If Turnstile detection evolves and the stealth plugin stops working, potential
fallback strategies include:
- Updating `puppeteer-extra-plugin-stealth` to a newer version
- Session cookie reuse (login once, persist cookies across runs)
- ProMED API access if one becomes available
