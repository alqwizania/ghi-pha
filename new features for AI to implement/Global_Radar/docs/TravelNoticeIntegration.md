# Travel Notice Integration Plan

## Objective

Integrate the Travel Alert public experience and editorial workflow into SehaRadar as a native SehaRadar capability, with two first-class product modes inside one system:

1. Outbreaks and news monitoring
2. Travel notices and country advisories

This plan assumes a clean-room rewrite approach. An external AGPL Travel Alert reference app informed the product behavior during planning, but that reference checkout is not part of this repository because SehaRadar remains MIT.

## Guiding Decisions

- Keep SehaRadar FastAPI as the single backend and deployment runtime.
- Keep one SehaRadar brand and visual language, with two modes instead of two separate apps.
- Reuse current SehaRadar map concepts, country metadata, and bilingual patterns where possible.
- Store travel notice data in dedicated NocoDB tables, separate from outbreak findings.
- Do not adopt the fork's Vercel and Node API deployment shape.
- Do not reuse the fork's password-in-header admin auth model.

## Desired End State

### Public Routes

- `/map/outbreaks` - canonical outbreak and news map
- `/map/travel` - canonical travel notices map
- `/globe` - redirect or alias to `/map/outbreaks` during migration
- `/travel-alert-main` - optional compatibility redirect to `/map/travel`

### Admin Routes

- `/admin/travel` - travel notice editorial dashboard

### Public API Routes

- `GET /api/travel-notice/countries`
- `GET /api/travel-notice/countries/{iso2}`
- `GET /api/travel-notice/health-matrix`

### Admin API Routes

- `POST /api/admin/travel-notice/login`
- `POST /api/admin/travel-notice/logout`
- `GET /api/admin/travel-notice/bootstrap`
- `GET /api/admin/travel-notice/review-queue`
- `POST /api/admin/travel-notice/upsert-draft`
- `POST /api/admin/travel-notice/publish`
- `POST /api/admin/travel-notice/settings/risk-levels`
- `POST /api/admin/travel-notice/settings/health-risks`
- `POST /api/admin/travel-notice/settings/health-measures`

## Current-State Constraints

### SehaRadar Today

- `server.py` serves APIs and static HTML pages directly from disk.
- `globe.html` is the current outbreak map and is a large monolithic HTML and JavaScript page.
- `tools/nocodb_client.py` is focused on the findings table, not travel advisory entities.
- Existing admin surfaces are operational dashboards, not editorial workflows.

### External Reference App

- The external Travel Alert app was used only to understand the public map flow, admin workflow, review cadence, and advisory store behavior.
- The larger World Monitor shell around that app was too coupled for a clean merge into SehaRadar.

### License Constraint

- Do not copy implementation code, bundled assets, or data files from the former reference app into SehaRadar.
- Recreate the functionality from behavior and product requirements, not by porting source files.
- Source country polygons and map assets from permissive datasets, not from the fork.

## Product Shape

### 1. Shared SehaRadar Shell

Create a shared SehaRadar map shell with:

- a consistent header
- a mode switch: `Outbreaks` and `Travel Notices`
- shared language toggle for English and Arabic
- shared country selection behavior
- shared map region presets where it makes sense

### 2. Outbreak Mode

Outbreak mode continues to use SehaRadar data:

- findings from `/api/findings/geo`
- outbreak statistics from `/api/globe/*`
- disease and news markers

### 3. Travel Notice Mode

Travel notice mode uses country-level travel advisory data:

- country fill color by risk level
- optional health-risk overlay icons
- country detail drawer with advisory meaning, why, measures, contacts, and review freshness

### 4. Separate Editorial Admin

Travel notice editing lives in a dedicated SehaRadar admin page instead of being mixed into `dashboard/index.html`.

## Architecture Recommendation

Implement Travel Notice as a domain package inside SehaRadar.

### Recommended New Backend Package

Create a new package:

```text
travel_notice/
  __init__.py
  models.py
  review.py
  store.py
  auth.py
  router.py
  admin_router.py
```

Responsibilities:

- `models.py` - Pydantic request and response models
- `review.py` - review cadence and publish validation logic
- `store.py` - NocoDB reads and writes for travel notice entities
- `auth.py` - session cookie auth for admin routes
- `router.py` - public API endpoints
- `admin_router.py` - admin API endpoints

Supporting updates:

- update `pyproject.toml` package list if needed
- include the routers from `server.py`

### Recommended New Frontend Files

For an incremental first implementation that fits current SehaRadar patterns:

```text
public/travel_notice.html
public/travel_notice_admin.html
public/assets/travel_notice.css
public/assets/travel_notice.js
public/assets/travel_notice_admin.css
public/assets/travel_notice_admin.js
```

This avoids forcing a frontend framework migration before the feature is live.

### Later Consolidation Target

After the first release is stable, move both map modes into a single shared shell such as:

```text
public/map_shell.html
public/assets/map_shell.js
```

At that point:

- `/map/outbreaks` and `/map/travel` can render from the same shell
- `globe.html` can be retired or reduced to a compatibility redirect

## Data Model Plan

Use dedicated travel notice tables in the existing NocoDB instance.

### Recommended Table Prefix

Use `tn_` to clearly separate travel notice data from outbreak findings.

### Tables

- `tn_risk_levels`
- `tn_health_risks`
- `tn_health_measures`
- `tn_countries`
- `tn_country_advisories`
- `tn_country_advisory_risks`
- `tn_country_contacts`
- `tn_audit_log`

### Why Separate Tables

- keeps travel notices independent from outbreak findings
- avoids polluting the current findings schema
- makes admin publishing and review workflows easier to reason about
- allows independent retention and auditing rules

### Environment Variables

Prefer reusing the existing NocoDB connection settings and only adding travel-specific table identifiers.

Recommended new env vars:

- `TRAVEL_NOTICE_TABLE_RISK_LEVELS`
- `TRAVEL_NOTICE_TABLE_HEALTH_RISKS`
- `TRAVEL_NOTICE_TABLE_HEALTH_MEASURES`
- `TRAVEL_NOTICE_TABLE_COUNTRIES`
- `TRAVEL_NOTICE_TABLE_COUNTRY_ADVISORIES`
- `TRAVEL_NOTICE_TABLE_COUNTRY_ADVISORY_RISKS`
- `TRAVEL_NOTICE_TABLE_COUNTRY_CONTACTS`
- `TRAVEL_NOTICE_TABLE_AUDIT`
- `TRAVEL_NOTICE_ADMIN_SESSION_SECRET`

Optional overrides if travel notices later move to a separate NocoDB project:

- `TRAVEL_NOTICE_NOCODB_API_URL`
- `TRAVEL_NOTICE_NOCODB_API_TOKEN`

## Domain Logic To Port

Recreate the following logic in Python from the behavior described in the fork:

### Review Recommendation Logic

From the fork's behavior reference:

- `recommended_review_days = min(level_default_review_days, min(selected_health_risk.default_review_days))`
- if no health risks are selected, use the level cadence only
- earlier review date is allowed
- later review date requires an override reason

### Publish Constraints

- each selected health risk must have at least one predefined measure before publish
- publish creates a new published version and archives prior published versions for the same country
- publish writes an audit record

### Review Queue Buckets

- overdue
- today
- week
- all

## API Contract Plan

Match the fork's API shapes closely enough that the public page and admin workflow remain familiar, but rename the route prefix to `travel-notice` for SehaRadar consistency.

### Public Endpoints

#### `GET /api/travel-notice/countries?lang=en|ar`

Returns country cards for the map and list.

Fields:

- `iso2`
- `name`
- `riskCode`
- `color`
- `nextReviewAt`
- `lastReviewedAt`

#### `GET /api/travel-notice/countries/{iso2}?lang=en|ar`

Returns the selected country advisory.

Fields:

- `iso2`
- `name`
- `riskCode`
- `levelLabel`
- `levelMeaning`
- `whySummary`
- `why[]`
- `measures[]`
- `contacts[]`
- `sourceRefs[]`
- `lastReviewedAt`
- `nextReviewAt`
- `updatedBy`
- `isOverdue`

#### `GET /api/travel-notice/health-matrix?lang=en|ar`

Returns the health risk overlay data keyed by country.

### Admin Endpoints

#### `POST /api/admin/travel-notice/login`

- validates credentials
- sets an `HttpOnly` signed cookie
- returns role and user metadata

#### `GET /api/admin/travel-notice/bootstrap`

- loads countries
- loads risk levels
- loads health risks
- loads health measures
- loads current review queue

#### `GET /api/admin/travel-notice/review-queue?bucket=...`

- returns urgency-sorted advisory review items

#### `POST /api/admin/travel-notice/upsert-draft`

- creates or updates a country draft
- recomputes recommendation preview

#### `POST /api/admin/travel-notice/publish`

- validates publish constraints
- creates a new published advisory version
- writes audit data

#### `POST /api/admin/travel-notice/settings/*`

- manages risk levels
- manages health risks
- manages predefined measures

## Authentication Plan

Do not port the old password-in-header request model from the reference app.

Recommended SehaRadar admin auth flow:

1. Admin opens `/admin/travel`
2. Login form posts to `/api/admin/travel-notice/login`
3. Server validates credentials from environment variables or upstream identity
4. Server returns a signed session cookie
5. All admin APIs use cookie-based auth with role checks

Recommended roles:

- `editor` - create and update drafts
- `admin` - editor permissions plus publish and settings changes

If SehaRadar already moves behind SSO or reverse-proxy auth later, `travel_notice/auth.py` should be the swappable boundary.

## Map and Asset Plan

### Shared Assets To Reuse From SehaRadar

- current map concepts in `globe.html`
- `config/country_centroids.json` for country labels and metadata
- bilingual formatting patterns already present in SehaRadar

### New Assets To Introduce

- permissively licensed country polygon GeoJSON or TopoJSON with ISO2 support
- a compact travel notice icon mapping for health risks
- a shared SehaRadar risk color scale for travel levels

### Important Rule

Do not copy country polygon data from the former reference app directly. Fetch or generate equivalent data from a permissive source such as Natural Earth.

## UI Implementation Plan

### Phase 1 UI: Feature-Complete Travel Notices

Build a dedicated SehaRadar public page and admin page first.

#### Public Page

Core features:

- world map colored by country travel risk
- country search
- bilingual English and Arabic support
- country detail panel with advisory explanation and measures
- review freshness metadata
- optional health-risk overlay toggle

#### Admin Page

Core features:

- login
- review queue buckets
- country advisory draft editor
- risk level selector
- health risk multi-select
- predefined measures preview
- draft save and publish

### Phase 2 UI: Seamless Dual-Mode Shell

After Phase 1 is stable, unify outbreak and travel modes into one map shell.

Core features:

- one header and navigation system
- one country click model
- mode-specific panels and legends
- consistent visual styling and iconography

## Proposed Implementation Phases

### Phase 0 - Specification and Schema Preparation

Deliverables:

- confirm the SehaRadar product name: `Travel Notices` or `Travel Alert`
- finalize table prefix and environment variable names
- create the NocoDB schema and seed data
- source permissive country polygon data

Success criteria:

- schema exists in NocoDB
- initial risk levels are seeded
- country catalog exists with English and Arabic names

### Phase 1 - Backend Domain Layer

Deliverables:

- create `travel_notice/models.py`
- create `travel_notice/review.py`
- create `travel_notice/store.py`
- create unit tests for cadence and publish validation

Success criteria:

- review logic matches the fork's behavior
- bilingual record shaping works
- store layer can read and write drafts and published advisories

### Phase 2 - Public Travel Notice APIs

Deliverables:

- create `travel_notice/router.py`
- wire public routes in `server.py`
- add health-matrix endpoint

Success criteria:

- public APIs return stable JSON contracts
- a country with no published advisory returns a safe default response

### Phase 3 - Admin APIs and Auth

Deliverables:

- create `travel_notice/auth.py`
- create `travel_notice/admin_router.py`
- add login and logout flow
- add bootstrap, review queue, draft, publish, and settings endpoints

Success criteria:

- editors cannot publish
- admins can publish
- unauthorized users cannot call admin APIs

### Phase 4 - Public Travel Notice UI

Deliverables:

- create `public/travel_notice.html`
- create `public/assets/travel_notice.css`
- create `public/assets/travel_notice.js`
- add route handlers in `server.py`

Success criteria:

- map loads correctly on desktop and mobile
- country search and country detail flow work
- Arabic layout and labels render correctly

### Phase 5 - Travel Notice Admin UI

Deliverables:

- create `public/travel_notice_admin.html`
- create `public/assets/travel_notice_admin.css`
- create `public/assets/travel_notice_admin.js`
- add route handler in `server.py`

Success criteria:

- draft editing works end to end
- review queue sorting is correct
- publish flow creates an auditable published record

### Phase 6 - SehaRadar Dual-Mode Unification

Deliverables:

- add a shared mode switch between outbreak and travel modes
- decide whether to keep `globe.html` or migrate to a shared shell
- add route aliases and redirects

Success criteria:

- users can move between outbreak and travel views without feeling they left SehaRadar
- navigation, layout, and language handling are consistent

## Verification Plan

### Unit Tests

- review cadence calculation
- override validation
- publish validation
- risk-to-measure validation
- review queue bucketing

### API Tests

- public countries list
- public country detail
- public health-matrix
- admin login and logout
- draft save
- publish success and failure cases
- settings upserts

### UI Verification

- desktop and mobile rendering
- Arabic and English text flow
- travel map country selection
- overdue badge behavior
- publish workflow from draft to public visibility

### Regression Checks

- `/globe` still works during the rollout
- outbreak APIs remain unchanged
- ops dashboards at `/dashboard` and `/logs` remain unaffected

## Rollout Strategy

### Step 1 - Dark Launch

- deploy schema and APIs
- keep UI routes hidden or unlinked
- test with mock and real data

### Step 2 - Internal Admin Launch

- expose `/admin/travel` to internal users
- validate publishing workflow

### Step 3 - Public Travel Notice Launch

- expose `/map/travel`
- add internal header switch for staff first

### Step 4 - Full SehaRadar Integration

- add public navigation between outbreak and travel modes
- optionally redirect legacy routes to canonical routes

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Direct code or asset reuse from AGPL fork | Legal and licensing risk | Use reference rewrite only |
| Monolithic `globe.html` makes reuse awkward | Slows seamless merge | Ship travel mode first, unify shell later |
| No current frontend build pipeline | UI maintainability risk | Use incremental static pages first |
| Travel admin auth copied from fork would be weak | Security risk | Use signed cookie auth instead |
| Country polygon data lacks ISO2 or Arabic mapping | Map correctness risk | validate source data before UI build |
| Travel advisory tables drift from spec | Publish flow bugs | lock schema before implementation |

## Acceptance Criteria

This integration is complete when:

- SehaRadar serves both outbreak and travel notice experiences
- travel notice data is stored separately from outbreak findings
- editorial users can manage drafts and publish advisories inside SehaRadar
- public users can switch between outbreak and travel views from one product experience
- Arabic and English work in both modes
- no AGPL implementation code or assets are copied into SehaRadar

## Recommended Implementation Order

1. NocoDB schema and seed data
2. Python domain logic for review and publish rules
3. Public travel notice APIs
4. Admin auth and admin APIs
5. Public travel notice UI
6. Admin UI
7. Shared mode switch and route consolidation

## Reference Inputs

Historical planning inputs included the external Travel Alert app's product docs, public map flow, admin flow, and review/store behavior. The implementation in this repository should now be treated as self-contained, with `server.py`, `globe.html`, and `tools/nocodb_client.py` as the local integration references.
