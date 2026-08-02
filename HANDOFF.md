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

**001 — radar_events uniqueness (applied 2 Aug 2026).** Removed 63 duplicate
rows (136 → 73), added a generated `content_hash` column
(`md5(source_id || '::' || lower(btrim(title)))`), and created a unique index on
it. `radar_events` previously had no natural unique constraint — its primary key
is a random UUID — so `onConflictDoNothing()` could never fire. Duplicate groups
kept a promoted row where one existed, so no triage signal lost its originating
event.
