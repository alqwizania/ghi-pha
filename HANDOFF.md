# GHI System — Project Handoff Documentation

> **System Name:** Global Health Intelligence System (GHI-PHA)  
> **Client:** Public Health Authority (PHA), Global Health Department, Saudi Arabia  
> **Date:** August 2, 2026  
> **Live Frontend Target:** `https://ghi-pha.pages.dev`  
> **Backend Worker:** `https://ghi-core.rads-pha.workers.dev`  
> **Local Dev Servers:** Frontend (`http://localhost:5173`), Backend (`http://localhost:8787`)

---

## 🚀 1. Executive Overview

The **Global Health Intelligence (GHI) System** is an executive-grade health surveillance platform engineered for the Saudi Public Health Authority (PHA). It provides real-time global epidemic tracking, automated risk scoring, GCC relevance detection, social signal listening, triage management, rapid risk assessment (RRA/IHR), and RSS feed exporting.

---

## 🛠️ 2. Technology Stack & Infrastructure

- **Frontend:** React 18, Vite 7, TypeScript, Tailwind CSS, `react-simple-maps`, Lucide Icons
- **Backend:** Hono Framework, Cloudflare Workers, TypeScript
- **Database:** Neon Serverless PostgreSQL (`drizzle-orm`, `drizzle-kit`) with SSL enforced (`sslmode=require`)
- **API Base URL Resolution:** `frontend/src/lib/api.ts` dynamically detects `localhost` and routes to `http://localhost:8787`, while production routes to `https://ghi-core.rads-pha.workers.dev`.

---

## 📡 3. Data Ingestion & Live Sources Engine

All mock/seed data has been replaced with a real-time HTTP ingestion engine located in [`backend/src/services/radar-collector.ts`](file:///d:/Vibecoding/GHI%20System/backend/src/services/radar-collector.ts).

### How ingestion works

Sources live in the `surveillance_sources` table, not in code — adding one is
an insert. Each row carries a `fetch_strategy` (`json`, `rss`, `html`,
`browser`) and a `parser_hint` naming the extractor in
[`radar-collector.ts`](file:///d:/Vibecoding/GHI%20System/backend/src/services/radar-collector.ts).

A scan **fetches, normalizes, hashes, and only extracts when the hash moved**
since the last pass. `normalizeForHash` strips timestamps, nonces, session ids,
and cache-busting query strings so cosmetic churn doesn't read as new content.
The hash lives in `source_snapshots`. In practice about three quarters of
sources are unchanged on any given scan and skip parsing entirely — this is
what replaces a self-hosted ChangeDetection.io deployment.

Requests are **serialized per host** with a short delay, so a scan never opens
several connections to the same agency at once. Different hosts still run in
parallel; a full 40-source pass takes roughly 20–50 seconds.

A manual scan from the UI forces every source; the 6-hourly cron respects each
source's `fetch_interval_hours`.

### Registry status (2 Aug 2026)

59 sources registered, **40 collecting**. A full scan yields events from
~27 of them.

### ⚠️ Known limit: a forced full scan takes ~5 minutes

The 6-hourly cron is fine — it only fetches sources whose interval has elapsed
and only extracts the ones whose content hash moved, so a normal run handles a
handful of sources. **The manual Scan button forces every source**, and when
many need extraction that takes around five minutes in one HTTP request.

That is longer than a Worker request should hold open. The fix is the queue
split from the architecture plan: a fetch queue and an extract queue, so each
source is an independent message. Until that lands, avoid pressing Scan
immediately after a config change that clears many hashes at once.

### Structured extraction

**32 of the 40 collecting sources** use `parser_hint = 'ai'` and route their
content through Claude with a fixed extraction schema
([`event-extractor.ts`](file:///d:/Vibecoding/GHI%20System/backend/src/services/event-extractor.ts)).

This exists because the title scraper cannot tell an outbreak headline from
page furniture. Measured against ECDC's threats page, **five of the eight
"events" it recorded were navigation chrome** — "Main Navigation (desktop)",
"Global Navigation", "Public health topics" — and those became rows in
`radar_events` and candidate triage signals.

The division of responsibility is deliberate: **the model extracts facts**
(disease, country, case and death counts, dates), and **risk classification
stays in deterministic code**. A health authority must be able to explain why
something was rated Critical, and "the model decided" is not a defensible
answer.

`htmlToText` strips scripts, styles, and navigation landmarks before the
content is sent, which cuts a page by 95–97% (ECDC 99KB → 4KB, WHO AFRO 48KB →
1.4KB). That keeps per-extraction cost small and removes the nav text that
confused the old extractor at source.

**To enable it:**

```bash
cd backend
npx wrangler secret put ANTHROPIC_API_KEY
```

Locally, add `ANTHROPIC_API_KEY="sk-ant-..."` to `backend/.dev.vars`. Without a
key these four sources fall back to the legacy extractor rather than failing,
and the scan banner reports that they ran degraded.

**Not switched, deliberately:** `WHO_DONS` and `WHO_MPX_API` keep their
purpose-built JSON parsers, which read the APIs' own fields — more accurate
than extraction and free.

**Measured cost:** about **$0.04 per HTML page** and **$0.14 per RSS feed** (a
feed carries many items, and generating one event per item is output-token
heavy). Extraction only runs when a page's hash moved, so spend tracks how
often these agencies publish rather than how often the cron fires.

Effort is left at the default. Dropping it to `low` cut cost 27% but stopped
splitting multi-country outbreaks into one row per country and dropped the
Saudi-Arabia-specific MERS figures in favour of the global total — the most
valuable row on that page for this authority. Not worth the saving.

**Two known false positives** worth a prompt tweak if they bother analysts: a
Czech hospital-preparedness feature was recorded as an Ebola event in Czechia,
and UKHSA's "Yellow heat health alerts" is captured as an event with disease
"Unspecified". Whether heat alerts belong in the triage queue is a domain call.

### Sources awaiting Browser Rendering

Six sources are reachable but return a page whose content is assembled
client-side, so static extraction yields nothing. They are marked
`fetch_strategy = 'browser'` and report that state rather than looking empty:
**China CDC, Germany RKI, Japan MHLW, Italy Ministry of Health, Hong Kong CHP,
and the WHO Mpox Shiny dashboard.**

Enabling them needs three things: the `@cloudflare/puppeteer` package, a
`[browser]` binding in `wrangler.toml`, and Browser Rendering enabled on the
Cloudflare account. The dispatch point is `retrieveSource()` in
`radar-collector.ts`.

### Live Ingestion Sources

Verified against the live upstreams on **2 Aug 2026**. A scan returns a
per-source `diagnostics` map, so a feed that breaks is reported rather than
silently contributing zero events.

| # | Source | Method | Status |
|---|--------|--------|--------|
| 1 | WHO Disease Outbreak News | JSON API `/api/news/diseaseoutbreaknews` | ✅ Live |
| 2 | WHO Mpox Daily | xMART OData `/MPX/V_MPX_VALIDATED_DAILY` | ✅ Live |
| 3 | CDC Travel Health Notices | RSS `tools.cdc.gov/.../316422.rss` | ✅ Live |
| 4 | PAHO | RSS `paho.org/en/rss.xml` | ✅ Live |
| 5 | CIDRAP (8 topic feeds) | RSS `cidrap.umn.edu/news/{id}/rss` | ✅ Live |
| 6 | WHO AFRO Regional | HTML headline extractor | ✅ Live |
| 7 | ECDC Threats Portal | HTML headline extractor | ✅ Live |
| 8 | WHO News & Features | RSS `who.int/rss-feeds/news-english.xml` | ⚠️ Reachable but upstream feed has not published since Feb 2026 |
| 9 | ReliefWeb | REST API v2 | ❌ Disabled — see below |
| 10 | ProMED-mail | RSS | ❌ Removed — see below |

### Known Source Issues

- **ReliefWeb** — API v1 was decommissioned (returns HTTP 410) and v2 rejects
  unregistered callers with HTTP 403. Request an approved appname at
  <https://apidoc.reliefweb.int>, then set `RELIEFWEB_APPNAME` in
  `radar-collector.ts` to re-enable. The fetcher is written and ready.
- **ProMED-mail** — every published feed path now returns HTTP 404 and the
  homepage exposes no feed link; ProMED appears to have moved behind a
  subscription portal. Removed from the scan rather than left failing silently.
- **CIDRAP** — the site-wide `rss.xml` still resolves but has been frozen since
  2022. Live content is only on per-topic feeds, so the scan now pulls eight of
  them (Misc Emerging, COVID-19, Avian Influenza, Measles, Ebola, Mpox, Cholera,
  MERS-CoV).
- **WHO Mpox** — the xMART view exposes `DATE` and `TOTAL_CONF_DEATHS`. Ordering
  or reading any other field name makes the endpoint reject the query with HTTP
  400, which is what previously made this source return nothing.

### Retrospective Window

Ingestion and the `/api/radar/events` query both use a **rolling 14-day window**
(`RETRO_WINDOW_DAYS` in `radar-collector.ts`). This replaced a hardcoded
`2026-07-25` cutoff that would have silently widened as time passed.

### Deduplication

`radar_events` has no natural unique constraint — its primary key is a random
UUID — so `onConflictDoNothing()` could never fire and every scan re-inserted
the same headlines. The collector now dedupes on `sourceId + title` against
existing rows in the window and within the batch. A scan reports `inserted` and
`skippedDuplicates`.

### Supporting Features
- **Geocoding:** Integrated 150+ country coordinate map (`COUNTRY_COORDS`) mapping country names to lat/lng for map marker rendering.
- **Disease Extractor:** 25+ disease keyword extractors (Cholera, Mpox, Ebola, Marburg, MERS, H5N1, Dengue, Polio, etc.).
- **Risk Level Engine:** Assigns `Critical`, `High`, `Moderate`, or `Low` based on death toll, case count, and PHEIC keywords.
- **GCC Relevance Filter:** Automatically flags events in GCC & regional countries (`Saudi Arabia`, `Yemen`, `Oman`, `UAE`, `Qatar`, `Bahrain`, `Kuwait`, `Iraq`, `Jordan`, `Egypt`, `Sudan`).

---

## 🖼️ 4. UI/UX & Layout Specs

### Global Radar View ([GlobalRadarView.tsx](file:///d:/Vibecoding/GHI%20System/frontend/src/views/GlobalRadarView.tsx))
- **Responsive Container:** `h-[calc(100vh-170px)] min-h-[500px]` — zero vertical scrollbar on standard desktop screens.
- **Floating Action Buttons:** Positioned at `bottom-16` on left (**45 Sources Monitor**, **Live Signals**) and right (map zoom controls `+`, `-`, `Reset`) to prevent overlap.
- **Live Moving RSS Ticker Strip:** Fixed at `bottom-2` under the map. Shown by default, auto-scrolls marquee, pauses on hover, opens event detail modal on click, includes direct link to `/api/radar/rss`.
- **Filters:** Top header bar includes Board type switcher, Disease dropdown, Severity dropdown, and Search input.

---

## 🔑 5. Verified API Endpoints

All tested and verified (`200 OK`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/auth/login` | Returns JWT token & Superadmin permissions |
| `GET`  | `/api/v1/signals` | Signals in triage queue |
| `GET`  | `/api/v1/assessments` | Completed/pending risk assessments |
| `GET`  | `/api/v1/social-signals` | Listener feed posts |
| `GET`  | `/api/v1/monitored-accounts` | X/Twitter & News account registry |
| `GET`  | `/api/v1/listener-keywords` | Keyword triggers |
| `GET`  | `/api/radar/events` | Outbreak events within the rolling 14-day window |
| `GET`  | `/api/radar/sources` | Source registry list |
| `GET`  | `/api/radar/rss` | **Live RSS 2.0 XML Feed Stream** (also aliased at `/api/v1/radar/rss`) |
| `POST` | `/api/radar/scan` | Parallel live fetch across all sources; returns `{status, count, inserted, skippedDuplicates, cutoffDate, sources, degraded, diagnostics}` |
| `POST` | `/api/radar/promote` | Promotes a radar event into a 24-hr SLA Triage signal |

---

## 📁 6. Key Project Files

```
GHI System/
├── HANDOFF.md                           # Master handoff documentation
├── frontend/
│   ├── src/
│   │   ├── App.tsx                      # Main navigation & view router
│   │   ├── lib/api.ts                   # Dynamic API base URL configuration
│   │   └── views/
│   │       ├── GlobalRadarView.tsx      # World map + RSS ticker + filters
│   │       ├── Triage.tsx               # Card & Line-listing views + 24h SLA timers
│   │       ├── AssessmentView.tsx       # Rapid Risk Assessment (RRA/IHR)
│   │       ├── ListenerView.tsx         # Social signal monitoring
│   │       ├── UserManagement.tsx       # Personnel role management
│   │       └── Dashboard.tsx            # Executive KPI summary
│   └── public/
│       ├── pha-logo.png                 # PHA Official logo
│       └── _redirects                   # SPA routing fallback (/* /index.html 200)
└── backend/
    ├── src/
    │   ├── index.ts                     # Hono app routes & getDB Neon SSL bypass
    │   ├── db/schema.ts                 # Drizzle schema (radarEvents, signals, users...)
    │   └── services/
    │       └── radar-collector.ts       # Real HTTP fetchers & geocoding engine
    ├── wrangler.jsonc                   # Cloudflare Worker configuration
    └── drizzle.config.ts                # Drizzle migration config
```

---

## 🏃 7. Running Locally

### Start Backend:

Create `backend/.dev.vars` first (gitignored — it holds live credentials):

```
DATABASE_URL="postgresql://<user>:<password>@<host>/neondb?sslmode=require"
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://<user>:<password>@<host>/neondb?sslmode=require"
```

Wrangler reads `DATABASE_URL` from `.dev.vars`, but the Hyperdrive local
connection string must be a real process env var or `wrangler dev` refuses to
start:

```bash
cd backend
export $(grep -E '^WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=' .dev.vars | sed 's/"//g')
npx wrangler dev
# Runs at http://localhost:8787
```

### Start Frontend:
```bash
cd frontend
npm run dev
# Runs at http://localhost:5173
```

### Trigger Live Radar Ingestion:
```powershell
Invoke-RestMethod -Uri 'http://localhost:8787/api/radar/scan' -Method Post
```

---

## 🚢 8. Production Deployment Instructions

### Deploy Backend Worker:
```bash
cd backend
set CLOUDFLARE_API_TOKEN=<your-token>
npx wrangler secret put DATABASE_URL
npx wrangler deploy
```

`DATABASE_URL` is the fallback used when the Hyperdrive binding is unavailable.
It must be a Worker **secret**, not a `[vars]` entry in `wrangler.toml`, since
that file is committed.

### Deploy Frontend to Cloudflare Pages:
```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=ghi-pha
```

---

## ▶️ Where to pick up next

In priority order, with reasoning:

1. **Browser Rendering** — unblocks **7 sources**, including **Beacon Bio**,
   which historically supplied 148 of 150 triage signals. Needs
   `@cloudflare/puppeteer`, a `[browser]` binding in `wrangler.toml`, and
   Browser Rendering enabled on the account. Dispatch point is
   `retrieveSource()` in `radar-collector.ts` — the code path exists and
   currently returns a clear "not configured" diagnostic.

2. **Automated assessment (was Phase 4)** — add `machine_draft` JSONB plus
   `machine_model` / `machine_generated_at` / `machine_confidence` to
   `assessments`. On accept, high-tier signals get an auto-generated IHR Annex 2
   answer set and RRA draft written to **both** the frozen draft and the live
   fields. Analyst edits change only the live fields, so any divergence *is* the
   human override with no extra flags. Scoring already supplies the IHR domain
   answers, so the draft is largely a mapping exercise.

3. **Queue split** — a forced full scan takes ~5 minutes in one request.
   Fetch queue + extract queue makes each source an independent message.

4. **Listener ingestion** — currently 8 mock rows (`post_id` = `mock_1`…`mock_8`).
   Build against **Bluesky, Telegram and regional news RSS** first: free, open
   APIs, no ToS risk. X's Basic tier (~$200/month) behind an adapter if
   procurement approves. **Do not scrape X with a logged-in account** — it
   violates their ToS and creates real institutional exposure for a government
   authority. The 12 monitored accounts and 32 keywords are real config worth
   keeping.

5. **Hajj/Umrah windows** — set `MASS_GATHERING_WINDOWS` annually.

### Known false positives worth a prompt tweak

A Czech hospital-preparedness feature was recorded as an Ebola event in
Czechia; UKHSA "Yellow heat health alerts" is captured with disease
"Unspecified"; a long-COVID research analysis passes the occurrence filter.
Whether heat alerts belong in triage is a domain call, not a technical one.

## 🟢 Current State & Readiness

- **Frontend Compilation:** `npm run build` $\rightarrow$ **0 errors**
- **Backend Compilation:** `npx tsc --noEmit` $\rightarrow$ **0 errors**
- **Mock Data Status:** 100% replaced with live APIs & RSS feeds
- **Live Ingested Events:** 136 real events in database; a full scan currently
  yields 74 events across 8 live sources (up from 27 across 4 before the source
  repairs on 2 Aug 2026)
- **Source Health UI:** The Global Radar sources drawer is wired to
  `/api/radar/sources` and the live scan diagnostics. It shows four states —
  Live, No new items, Unavailable, Not yet scanned — instead of the previous
  hardcoded all-green list.

## 🎯 Priority Scoring & Auto-Promotion (Phase 3 — done)

Every radar event is scored on five domains and anything clearing the threshold
is promoted into triage **automatically**. This closed the gap where an event
only reached an analyst if someone spotted it on a map and pressed a button —
which had happened twice in the system's history.

Implementation:
[`signal-scoring.ts`](file:///d:/Vibecoding/GHI%20System/backend/src/services/signal-scoring.ts).

### The method (not a hunch)

Four domains map directly onto **IHR (2005) Annex 2**, so a high triage score
predicts the IHR outcome analysts reach downstream rather than being a separate
opinion. The fifth is the WHO RRA context leg, specialised for the Kingdom.

| Domain | IHR question | Scored 0–3 on |
|---|---|---|
| Severity | Q1 — impact serious? | CFR vs disease baseline, deaths, cases vs expected annual, health-system strain |
| Unusualness | Q2 — unusual/unexpected? | Novel pathogen, outside known range, atypical presentation, endemic status |
| Spread | Q3 — international spread? | Human-to-human, **healthcare-worker infections**, multi-country, transmission route |
| Trade & travel | Q4 — restrictions? | Advisories, border measures, restriction language |
| KSA relevance | RRA context | Border/GCC, pilgrim corridors, mass-gathering window, endemic status |

**Founding principle: anomaly is deviation from expectation, not magnitude.**
Forty cholera cases in Yemen mid-epidemic is background; four in Riyadh is an
emergency. Severity is judged against `disease_baselines`, never raw counts.

**The escalation rule comes from IHR, not from us.** Annex 2 requires
notification when *any two of the four* questions are yes, so a signal is high
priority at **two or more domains scoring ≥2**. KSA relevance is a one-tier
modifier — it can raise a signal, never escalate one alone.

**Mandatory overrides:** Annex 2 always-notifiable diseases (smallpox, wild
poliovirus, novel influenza subtypes, SARS) bypass scoring — *but only when the
item reports an actual occurrence*. Without that guard a polio vaccination
campaign escalated as critical.

**Confidence is a separate axis** and gates automation, never severity. Low-confidence
sources are never auto-promoted; WHO's EBS process puts verification before risk
assessment, and collapsing the two is how a system escalates a rumour.

**Sub-scores are stored, not just totals.** `event_scores.evidence` holds the
reasons behind each domain so an analyst can see *why* something scored high
and challenge it.

### Auto-promotion and corroboration

Events at `critical`/`high` tier with adequate confidence become triage signals
automatically. WHO, ECDC and CIDRAP all report the same outbreak, so before
creating a signal the collector looks for an open signal with the same disease
and country in the window — if one exists it records a **corroboration link**
instead. Independent agreement raises confidence; it is not a second outbreak.

Current state: **112 events scored, 3 critical, 4 high, 7 auto-promoted**,
including MERS-CoV Saudi Arabia (2,226 cases / 869 deaths, CFR above baseline)
and WPV1 Pakistan.

### ⚠️ `MASS_GATHERING_WINDOWS` is deliberately empty

Hajj moves ~11 days earlier each Gregorian year and encoding a guessed date
would be worse than encoding none. **PHA must set the Hajj and Umrah windows
annually** in `signal-scoring.ts`; until then that modifier never fires.

### Noise filter

`reportsOccurrence` separates a disease *actually happening* from vaccination
campaigns, preparedness features, funding news and product recalls with no
confirmed illness. `/api/radar/events` returns only actionable items by
default; `?all=1` returns everything.

The filter is on **occurrence, not case counts** — 220 of 234 events carried no
count, and among them were "measles outbreak in Delaware" and an Ebola
escalation. The first report of an outbreak almost never has a number, and that
is exactly the signal worth having. Currently 53 actionable of 111 total.

## 📊 Dashboard

The "GCC & Regional Border Threat Level" panel was a **hardcoded array** —
Yemen/Cholera/420 and three siblings that never changed. It now queries scored
radar events for GCC and bordering states, ordered by tier.

Also replaced: the fabricated "96.4% SLA compliance" figure, the "+12% from
previous week" trend, and "Priority Score > 85" (which read 0 because nothing
computed a score). All now show real values or are gone.

Added: the **assessed-signals line listing** — disease, country, cases, CFR,
IHR decision, RRA risk, and whether a human reviewed it or it is still
machine-only.

### Design decision: escalation is not a separate view

Escalations appear as a **red band on the Dashboard**, shown only when one is
open, plus status in the line listing. There is deliberately no Escalations tab.

Escalations are rare and urgent. A tab hides rare things until someone thinks to
look, which is the opposite of what an escalation is for; an unmissable band on
the view executives already open interrupts appropriately. The `escalations`
table and the escalate action in AssessmentView are unchanged — this is about
where the state is *surfaced*, not how it is recorded.

## 🔐 Authentication

Every endpoint except the list below requires a `Authorization: Bearer <jwt>`
header. Tokens are issued by `/api/v1/auth/login`, signed HS256, and expire
after 24 hours. The frontend attaches the token automatically via
`frontend/src/lib/api.ts`; a `401` clears the stored session and returns the
operator to the login screen.

**Public endpoints:** `/`, `/health`, `/api/v1/ping`, `/api/v1/auth/login`,
and the RSS feed (`/api/radar/rss`, `/api/v1/radar/rss`) — the feed is
deliberately open because it carries only already-public outbreak data and feed
readers cannot present a bearer token.

**Admin-only** (`Superadmin`, `Admin`, `Director`): `/api/v1/users*` and
`/api/admin/*`.

**CORS** is restricted to `https://ghi-pha.pages.dev`, its preview
subdomains, and `localhost:5173`.

### ⚠️ Required before the next production deploy

`JWT_SECRET` was removed from `[vars]` in `wrangler.toml` because that file is
committed, and the code now refuses to sign or verify tokens with the old
`change-me-later` placeholder. **The Worker will return 500 on login until both
secrets are set:**

```bash
cd backend
npx wrangler secret put JWT_SECRET     # use a fresh 32-byte random value
npx wrangler secret put DATABASE_URL
npx wrangler deploy
```

Locally both live in `backend/.dev.vars` (gitignored). Note that rotating
`JWT_SECRET` invalidates every existing session, which is intended.

## 🔐 Outstanding Security Items

1. **Rotate the Neon database password.** It was previously hardcoded in
   `backend/src/index.ts` in the working tree. It was never committed (verified
   with `git log -S`), but it is present in `backend/.env`,
   `backend/.dev.vars`, and `scratch/test_db.js` on disk. All three are now
   gitignored. Rotate the password and update the Worker secret.
2. **Passwords are stored in plain text** — `passwordHash` holds the raw value
   and login compares it directly. This must be replaced with bcrypt or argon2
   before production use.

## 🗄️ Migrations

`backend/migrations/` holds one-off data and schema migrations run with plain
Node. Each is idempotent and dry-runs by default.

```bash
cd backend
node migrations/001_radar_events_unique.mjs           # report only
node migrations/001_radar_events_unique.mjs --apply   # execute
```

**013 — actionability filter (applied 2 Aug 2026).** Purged 122 legacy
naive-extractor rows (identifiable by their "Headline detected from …"
summary), added `event_scores.reports_occurrence`, and cleared scores for
recompute.

**012 — disease baselines (applied 2 Aug 2026).** Seeded 45 baseline rows:
endemic status, expected annual cases, baseline CFR, transmission route, and
IHR Annex 2 obligations per disease and country. Indicative starting values
meant to be corrected by PHA epidemiologists — **this table is curation work
and is the highest-value dataset in the system.**

**011 — scoring schema (applied 2 Aug 2026).** Created `disease_baselines`,
`event_scores`, `signal_links`; added `source_stream`, `radar_event_id` and
`auto_promoted` to `signals`.

**010 — purge scraper artifacts (applied 2 Aug 2026).** Removed 21 navigation
rows written as surveillance events.

**009 / 008 — extraction rollout (applied 2 Aug 2026).** Switched 12 RSS and 16
HTML sources to structured extraction.

**007 — structured extraction pilot (applied 2 Aug 2026).** Switched ECDC, WHO
AFRO, UK UKHSA, and WHO EMRO MERS to `parser_hint = 'ai'`. Deliberately four
and not forty — extraction quality has to be measured against what an analyst
would record before it is trusted across the registry.

**006 — Beacon correction (applied 2 Aug 2026).** Migration 003 had swept
Beacon Bio up with the legacy entries and labelled it "superseded by the merged
registry". That was wrong: nothing superseded it, and **148 of the 150 signals
in the triage queue originated from Beacon**. Its registered URL
(`beacon.bio/api/feed`) also pointed at an unrelated company's domain. The real
site serves a shell whose Next.js payload carries only UI strings — the event
list loads client-side — and its API paths return 403 to plain requests, which
is why the old Jina-proxy collector matched zero events on every run. Beacon is
now registered against `beaconbio.org` as a `browser` source and is the
**highest-value Browser Rendering candidate**.

**005 — CDC egress workaround (applied 2 Aug 2026).** `www.cdc.gov` returns
HTTP 403 to Cloudflare Workers egress — verified with and without a browser
User-Agent, and with requests serialized per host. `tools.cdc.gov` is
unaffected. CDC now reads the newsroom RSS feed there; the two CDC pages with
no feed equivalent are disabled with the reason recorded.

**004 — source corrections (applied 2 Aug 2026).** Fixed two stale manifest
URLs (WHO SEARO, UK Health Protection Reports) and marked six sources as
requiring browser rendering — evidenced by the first full scan rather than
assumed. See "Sources awaiting Browser Rendering" below.

**003 — merged source registry (applied 2 Aug 2026).** Seeded 59 sources by
reconciling the inherited 42-source manifest with GHI's verified fetchers.
Where both describe the same agency, GHI's verified URL wins. Seven legacy
entries from the old hardcoded seeding were retired in place rather than
deleted, because radar_events rows still reference them.

**002 — registry-driven ingestion (applied 2 Aug 2026).** Added fetch strategy,
parser hint, priority, tags, and config columns to `surveillance_sources`, plus
the `source_snapshots` table holding the last content hash per source.

**001 — radar_events uniqueness (applied 2 Aug 2026).** Removed 63 duplicate
rows (136 → 73), added a generated `content_hash` column
(`md5(source_id || '::' || lower(btrim(title)))`), and created a unique index on
it. `radar_events` previously had no natural unique constraint — its primary key
is a random UUID — so `onConflictDoNothing()` could never fire. Duplicate groups
kept a promoted row where one existed, so no triage signal lost its originating
event.
