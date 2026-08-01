# Travel Notice Implementation

- [x] Inspect SehaRadar and the external Travel Alert reference app to define the merge approach
- [x] Draft the integration plan in `docs/TravelNoticeIntegration.md`
- [x] Implement `travel_notice` backend package
- [x] Add FastAPI routes and static asset serving for travel notice pages
- [x] Build public Travel Notice page
- [x] Build Travel Notice admin page
- [x] Add tests for review and publish rules
- [x] Run targeted verification and capture follow-up issues

## Review

- Removed `SessionMiddleware` from `server.py` and completed the Travel Notice admin auth flow with signed cookies in `travel_notice/auth.py` and `travel_notice/admin_router.py`.
- Verified imports and syntax with `python3 -m py_compile server.py travel_notice/*.py tests/test_travel_notice_review.py`.
- Verified backend logic with `python3 tests/test_travel_notice_review.py`.
- Smoke-tested `GET /api/travel-notice/countries`, `GET /api/travel-notice/countries/SA`, `POST /api/admin/travel-notice/login`, `GET /api/admin/travel-notice/bootstrap`, and `GET /map/travel` via `fastapi.testclient.TestClient`; all returned `200`.

## Cleanup Plan

- [x] Remove the external reference checkout/gitlink from the repo
- [x] Trim Travel Notice docs so they keep only brief reference history
- [x] Re-verify git status and key Travel Notice routes after cleanup

## Cleanup Review

- Removed the local `travel-alert` reference checkout from the repository workspace.
- Trimmed `docs/TravelNoticeIntegration.md` so it keeps only brief historical/reference notes instead of path-level dependency on the removed checkout.
- Updated `server.py` so `/travel-alert-main` is now a legacy redirect to `/map/travel`.
- Re-verified `/map/travel` returns `200` and `/travel-alert-main` returns `307` to `/map/travel`.

## Admin Publish Guard Review

- Added draft availability tracking to Travel Notice admin bootstrap data so the UI can tell whether the selected country currently has a draft.
- Updated the admin page to disable `Publish` until a draft exists for the selected country and to show a short hint explaining why publishing is disabled.
- Updated publish flow behavior so publishing archives the current draft, which turns the button back off until the next draft is saved.
- Added backend `400` JSON responses for invalid draft/publish requests and verified the flow with compile checks, unit tests, and a `TestClient` smoke test.

## Merge Conflict Plan

- [x] Inspect unresolved merge conflicts from the interrupted `git pull`
- [x] Merge `server.py` and `globe.html` by combining remote platform updates with local Travel Notice work
- [x] Accept deletion of conflicted tracked `__pycache__` artifacts
- [x] Re-run targeted checks on resolved files

## Merge Conflict Review

- Resolved `server.py` by keeping the Travel Notice routes and redirects while also preserving the incoming webhook/auth imports and the new `/pha-radar` page route.
- Resolved `globe.html` by keeping both the local mode switch and the incoming country filter UI, plus the matching i18n labels.
- Accepted deletion of conflicted tracked `__pycache__` artifacts so the merge no longer contains unmerged binary cache files.
- Verified the merge with `python3 -m py_compile server.py`, `git diff --check -- server.py globe.html`, and route smoke tests for `/map/travel`, `/travel-alert-main`, and `/pha-radar`.

## Local Docker Review

- Added `docker-compose.mac.yml` for local Mac usage without the production Caddy network, with direct `localhost` port mappings and a local named data volume.
- Disabled the background schedulers in the Mac Compose profile so local UI sessions do not depend on the production automation stack.
- Updated `Dockerfile` to copy `travel_notice/` and `static/` so the Travel Notice feature is available inside the container image.
- Updated OpenRouter startup wiring so missing `OPENROUTER_API_KEY` no longer blocks local UI startup; LLM-dependent scans remain disabled until credentials are configured.

## Travel Map UI Plan

- [x] Convert the Travel Notice country list into a dropdown selector
- [x] Rework the public page layout so the map sits in the middle of the page
- [x] Show the country advisory in a popup/modal after selecting a country from the map or dropdown
- [x] Re-verify the public Travel Notice UI behavior after the layout changes

## Travel Map UI Review

- Reworked the Travel Notice public page around a centered map panel with a compact top control bar instead of the old side list/detail layout.
- Replaced the country list with a dropdown selector and a small selection summary card that can reopen the advisory popup.
- Moved the country advisory into a modal popup that opens from either the dropdown or a map click, with keyboard `Escape` and backdrop-close support.
- Fixed the map overlay so the empty-state layer no longer blocks clicks on the countries, then verified the new flow in a browser by opening advisories from both the dropdown and the map.

## Shared Travel Layer Plan

- [x] Make `/map/outbreaks` and `/map/travel` load the same `globe.html` shell
- [x] Serve `config/countries.geojson` from the main app for travel country fills
- [x] Add shared-page mode switching in `globe.html` so Travel swaps map layers without opening a new page
- [x] Render the travel country risk choropleth and travel country detail drawer on the shared map
- [x] Run targeted verification on the updated routes and files

## Shared Travel Layer Review

- Updated `server.py` so `/map/travel` now serves the shared `globe.html` shell and added `/data/countries.geojson` for the travel country fill source.
- Updated `globe.html` with a path-aware `mapMode`, in-place mode toggle handling, travel country fetch/detail helpers, and a MapLibre travel risk choropleth that reuses the same shared map.
- Added a compact travel overview panel, travel legend/ticker behavior, country search reuse, and a travel-specific country detail drawer for map clicks.
- Verified the change set with `python3 -m py_compile server.py travel_notice/*.py`, `git diff --check -- server.py globe.html tasks/todo.md`, `node --check` on the extracted inline `globe.html` script, and `TestClient` smoke tests for `/map/outbreaks`, `/map/travel`, `/data/countries.geojson`, `/api/travel-notice/countries`, and `/api/travel-notice/countries/SA`.

## Travel Health Overlay Plan

- [x] Inspect the shared travel mode and identify how to add the v2 health-risk overlay without breaking outbreak mode
- [x] Add travel health-risk matrix loading and deck.gl icon overlays to `globe.html`
- [x] Build a globe-consistent picker panel for travel health risks in the shared sidebar
- [x] Re-run targeted verification for the picker/overlay flow

## Travel Health Overlay Review

- Added `travel_notice` health-matrix loading, icon visual mapping, and a travel health `IconLayer` in `globe.html` so travel mode can render optional country-level health-risk icons on top of the country risk colors.
- Added a new travel health panel in the left sidebar that reuses the globe panel and disease-list visual language, with `Country risk only`, `All health risks`, and per-risk options instead of the v2 standalone pill picker.
- Updated travel hover/click handling and ticker/legend behavior so selected health overlays feel native to the shared globe experience.
- Verified the update with `python3 -m py_compile server.py travel_notice/*.py`, `git diff --check -- globe.html server.py tasks/todo.md tasks/lessons.md`, `node --check` on the extracted inline `globe.html` script, and `TestClient` smoke tests for `/map/travel`, `/api/travel-notice/health-matrix`, and `/api/travel-notice/countries`.

## Travel V2 Cleanup

- [x] Move the shared countries GeoJSON into the main repo config so runtime no longer depends on `travel_notice_v2/`
- [x] Update the shared map route to use the moved GeoJSON asset
- [x] Delete the local `travel_notice_v2/` workspace copy
- [x] Re-run focused checks after the cleanup

## Travel V2 Cleanup Review

- Moved the travel country GeoJSON into `config/countries.geojson` and updated `server.py` so the shared travel map no longer depends on the separate v2 checkout.
- Removed the local `travel_notice_v2/` directory after confirming no runtime code still imported or served files from it.
- Re-verified the shared travel routes and APIs after the cleanup with compile, diff, and `TestClient` smoke checks.

## Globe Client Refactor Plan (`SehaRadar-sa3`)

- [x] Audit `globe.html` with subagents and map the epic subtasks to concrete code paths
- [x] Externalize the globe shell assets into `static/globe/` and move the client bootstrap out of `globe.html`
- [x] Reduce first-load work by rendering the map shell early, deferring third-party dependencies, and lazy-loading disease icon assets
- [x] Remove repeated data scans by introducing shared memoized selectors, country grouping, and reusable country-boundary loading
- [x] Trim sidebar and ticker rerender churn, run focused verification, and update the related bead statuses

## Globe Client Refactor Review

- Moved the inline globe stylesheet and bootstrap code out of `globe.html` into `static/globe/` assets, which also enables `/static` serving without touching `server.py`.
- Updated startup so `createGlobe()` runs before the initial data awaits, hid the blocking overlay as soon as the shell is ready, removed the unused `Chart.js` and Iconify runtime scripts, and deferred the remaining head scripts.
- Replaced eager disease icon preloading with lazy shared caching, added memoized outbreak selectors/country grouping, and loaded `/data/countries.geojson` once for both outbreak and travel layers.
- Reduced rerender churn by reusing cached HTML for key panels/ticker, switching news and travel-health item clicks to delegated listeners, and reusing shared derived view models across overview, list, ticker, and marker rendering.
- Verified the initial extraction with JS syntax checks, `uv run python -m compileall server.py`, diff checks, and `TestClient` smoke checks for the globe shell and static asset routes.

## Globe Module Split Plan (`SehaRadar-sa3.3`)

- [x] Split the globe client into focused classic-script modules while preserving current behavior and globals
- [x] Update `globe.html` to load the ordered module files from `static/globe/`
- [x] Re-run syntax, diff, and route smoke checks on the modularized globe client

## Globe Module Split Review

- Replaced the last monolithic client file with focused modules in `static/globe/`: `config.js`, `state.js`, `selectors.js`, `data.js`, `layers.js`, `travel-ui.js`, `ui.js`, `map.js`, and `bootstrap.js`.
- Updated `globe.html` to load the new scripts in dependency order as classic deferred scripts so existing inline handlers and generated `onclick` callbacks still resolve on `window` without a behavior rewrite.
- Removed the unused `static/globe/app.js` entrypoint so future globe work happens in the focused modules instead of another catch-all file.
- Verified the split with `node --check` on all nine module files, `git diff --check -- globe.html static/globe/config.js static/globe/state.js static/globe/selectors.js static/globe/data.js static/globe/layers.js static/globe/travel-ui.js static/globe/ui.js static/globe/map.js static/globe/bootstrap.js tasks/todo.md`, and `TestClient` smoke checks for `/globe`, `/map/outbreaks`, and each `/static/globe/*.js` module route.

## Globe Icon Regression Fix (`SehaRadar-w2k`)

- [x] Restore first-load outbreak marker rendering after the earlier-shell startup reorder
- [x] Stop showing fallback circles for mapped disease icons during lazy icon loading
- [x] Re-run focused syntax and route checks for the globe modules

## Globe Icon Regression Review

- Added an explicit `updateGlobeLayers()` during `static/globe/bootstrap.js` initialization after the initial data fetch/UI hydration so the first marker render no longer depends on a manual refresh click.
- Updated `static/globe/config.js` so mapped diseases use their direct Iconify SVG URL immediately while the lazy cached data URL warms in the background, avoiding the fallback-circle state for known icons.
- Re-verified the patch with `node --check static/globe/config.js && node --check static/globe/bootstrap.js && node --check static/globe/map.js && node --check static/globe/ui.js`, `git diff --check -- static/globe/config.js static/globe/bootstrap.js tasks/todo.md tasks/lessons.md`, and `TestClient` smoke checks for `/globe`, `/static/globe/config.js`, and `/static/globe/bootstrap.js`.

## Globe Icon Invalidation Fix (`SehaRadar-xwq`)

- [x] Invalidate the deck marker icon accessor whenever lazy disease icons finish resolving
- [x] Re-run focused syntax and route checks for the marker-layer fix

## Globe Icon Invalidation Review

- Added `state.iconRefreshVersion` and increment it whenever a lazy disease icon resolves so icon-cache changes become an explicit rendering signal instead of hidden mutable state.
- Wired the outbreak `deck.IconLayer` to `updateTriggers.getIcon`, forcing the marker layer to re-evaluate icon URLs as the cache warms and preventing the "icons only appear after another click" behavior.
- Re-verified the marker-layer patch with `node --check static/globe/state.js && node --check static/globe/config.js && node --check static/globe/map.js`, `git diff --check -- static/globe/state.js static/globe/config.js static/globe/map.js tasks/todo.md tasks/lessons.md`, and `TestClient` smoke checks for `/globe`, `/static/globe/state.js`, `/static/globe/config.js`, and `/static/globe/map.js`.

## Outbreak Icon First-Load Plan

- [x] Inspect the outbreak marker icon invalidation path on initial load
- [x] Patch the marker repaint logic with a minimal diff
- [x] Run focused JS syntax and browser sanity verification

## Outbreak Icon First-Load Review

- Updated `static/globe/map.js` so the outbreak `IconLayer` gets a versioned layer id tied to `state.iconRefreshVersion`, which forces deck.gl to rebuild the marker layer/icon atlas when lazy icon URLs resolve during first load.
- Kept event handling stable by matching outbreak marker layers via an id prefix helper instead of the old exact `'markers'` string.
- Verified with `node --check static/globe/map.js`, `git diff --check -- static/globe/map.js tasks/todo.md`, and HTTP smoke checks returning `200` for `/map/outbreaks?days=7` and `/static/globe/map.js`.
