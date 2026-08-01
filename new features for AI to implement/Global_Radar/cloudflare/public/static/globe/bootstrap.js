// ----- Refresh All Data -----

async function refreshAllData() {
    if (state._refreshing) {
        state._refreshPending = true;
        return;
    }

    state._refreshing = true;
    state._refreshPending = false;
    showMapLoading();
    setRefreshBtnLoading(true);

    try {
        if (state.mapMode === 'travel') {
            await Promise.all([
                fetchTravelCountries(),
                fetchTravelHealthMatrix(),
                ensureCountryCentroids(),
            ]);
            if (state.selectedCountryCode) {
                await loadTravelCountryDetail(state.selectedCountryCode, true);
            } else {
                showCountryBrief(null);
            }
        } else {
            await Promise.all([fetchGeoData(), fetchStats()]);
            if (state.selectedCountryCode) {
                showCountryBrief(buildCountryBrief(state.selectedCountryCode));
            } else {
                showCountryBrief(null);
            }
        }
        updateGlobeLayers();
    } catch (e) {
        console.error('❌ Refresh failed:', e);
    } finally {
        const rerun = state._refreshPending;
        state._refreshing = false;
        state._refreshPending = false;
        hideMapLoading();
        setRefreshBtnLoading(false);
        if (rerun) {
            requestAnimationFrame(() => {
                void refreshAllData();
            });
        }
    }
}

// ----- Auto-Refresh Timers -----

function startAutoRefresh() {
    // Data refresh every 5 min (force bypass cache)
    setInterval(async () => {
        if (state.mapMode === 'travel') {
            travelCountriesCache.data = null;
            travelHealthMatrixCache.data = null;
            await Promise.all([
                fetchTravelCountries(true),
                fetchTravelHealthMatrix(true),
            ]);
            if (state.selectedCountryCode) {
                await loadTravelCountryDetail(state.selectedCountryCode, true);
            }
        } else {
            delete geoCache[state.days];
            await fetchGeoData(true);
        }
        updateGlobeLayers();
    }, 5 * 60 * 1000);

    // Stats refresh every 2 min (force bypass cache)
    setInterval(async () => {
        if (state.mapMode === 'travel') {
            updateGlobeLayers();
        } else {
            delete statsCache[state.days];
            await fetchStats(true);
            updateGlobeLayers();
        }
    }, 2 * 60 * 1000);

    // Ticker refresh every 60s
    setInterval(() => {
        updateTicker();
    }, 60 * 1000);

    // Update "updated ago" text every 10s
    setInterval(() => {
        updateLastUpdated();
    }, 10 * 1000);
}

// ----- Event Listeners -----

function setupEventListeners() {
    // Time filter select
    const timeFilterSelect = document.getElementById('time-filter-select');
    if (timeFilterSelect) {
        timeFilterSelect.addEventListener('change', () => setTimeFilter(parseInt(timeFilterSelect.value, 10)));
    }

    // Date range picker
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');
    [fromInput, toInput].forEach(input => {
        if (!input) return;
        input.addEventListener('focus', () => {
            renderDateOptions(input.id);
            toggleDatePopover(input.id, true);
        });
        input.addEventListener('input', () => {
            renderDateOptions(input.id);
            toggleDatePopover(input.id, true);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                toggleDatePopover(input.id, false);
                applyDateRangeFromInputs();
            } else if (event.key === 'Escape') {
                toggleDatePopover(input.id, false);
            }
        });
        input.addEventListener('blur', () => {
            requestAnimationFrame(() => {
                if (!document.activeElement?.closest('.date-input-wrap')) {
                    toggleDatePopover(input.id, false);
                    applyDateRangeFromInputs();
                }
            });
        });
    });

    // Region preset buttons
    document.querySelectorAll('.region-btn').forEach(btn => {
        btn.addEventListener('click', () => flyToRegion(btn.dataset.region));
    });

    // Country search (autocomplete)
    const countrySearch = document.getElementById('country-search');
    if (countrySearch) {
        countrySearch.addEventListener('focus', () => {
            renderCountryAutocomplete();
            document.getElementById('country-options')?.classList.add('visible');
        });
        countrySearch.addEventListener('input', () => {
            updateCountrySearchAction();
            renderCountryAutocomplete();
            document.getElementById('country-options')?.classList.add('visible');
        });
        countrySearch.addEventListener('change', onCountryInputCommit);
        countrySearch.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') onCountryInputCommit();
            if (event.key === 'Escape') document.getElementById('country-options')?.classList.remove('visible');
        });
        countrySearch.addEventListener('blur', () => {
            requestAnimationFrame(() => {
                if (!document.activeElement?.closest('#country-filter')) {
                    document.getElementById('country-options')?.classList.remove('visible');
                }
            });
        });
    }

    const diseaseList = document.getElementById('disease-list');
    if (diseaseList) {
        diseaseList.addEventListener('click', event => {
            const item = event.target.closest('.news-feed-item');
            if (!item || !diseaseList.contains(item)) return;
            const itemId = item.dataset.newsId || '';
            const lng = parseFloat(item.dataset.lng || '');
            const lat = parseFloat(item.dataset.lat || '');
            onNewsItemClick(
                itemId,
                Number.isFinite(lng) ? lng : null,
                Number.isFinite(lat) ? lat : null,
            );
        });
    }

    const travelHealthPanel = document.getElementById('travel-health-panel');
    if (travelHealthPanel) {
        travelHealthPanel.addEventListener('click', event => {
            const item = event.target.closest('[data-travel-health-slug]');
            if (!item || !travelHealthPanel.contains(item)) return;
            const slug = item.getAttribute('data-travel-health-slug') || null;
            setTravelHealthRiskSelection(slug || null);
        });
    }

    document.addEventListener('mousedown', (event) => {
        const dateButton = event.target.closest('[data-date-value]');
        if (dateButton) {
            event.preventDefault();
            applyDateOption(dateButton.dataset.dateTarget, dateButton.dataset.dateValue);
            return;
        }

        const countryButton = event.target.closest('[data-country-code]');
        if (countryButton) {
            event.preventDefault();
            const code = countryButton.dataset.countryCode;
            if (code) setCountrySelection(code);
            document.getElementById('country-options')?.classList.remove('visible');
            return;
        }

        if (!event.target.closest('.date-range-control') && !event.target.closest('#country-filter')) {
            closeAllControlPopovers();
        }
    });

    // Language toggle
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
    });

    document.querySelectorAll('.mode-link').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            setMapMode(link.dataset.mapMode || 'outbreaks');
        });
    });
}

// ----- Initialization -----

async function init() {
    // 1. Read URL state
    readURLState();

    // 2. Apply language
    applyI18n();
    applyMapModeUI();

    // 3. Set initial UI state from URL
    const timeFilterSelect = document.getElementById('time-filter-select');
    if (timeFilterSelect) timeFilterSelect.value = String(state.days);
    document.querySelectorAll('.region-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.region === state.region)
    );
    document.querySelectorAll('.lang-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.lang === state.lang)
    );
    document.querySelectorAll('.disease-tab').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tab === state.diseaseTab)
    );
    document.querySelectorAll('.risk-item').forEach(el =>
        el.classList.toggle('active', el.dataset.risk === state.riskFilter)
    );

    // 4. Setup event listeners
    setupEventListeners();

    // 5. Start shell rendering immediately and hydrate data in parallel
    const dynamicDiseasesPromise = loadDynamicDiseases();
    createGlobe();
    requestAnimationFrame(hideInitialLoadingOverlay);

    // 6. Fetch critical data (geo + stats) in parallel while the shell is already visible
    if (state.mapMode === 'travel') {
        await Promise.all([
            fetchTravelCountries(),
            fetchTravelHealthMatrix(),
            ensureCountryCentroids(),
        ]);
    } else {
        await Promise.all([
            fetchGeoData(),
            fetchStats(),
        ]);
    }
    await dynamicDiseasesPromise;

    // 7. Update UI panels
    if (state.mapMode === 'travel') {
        updateTravelOverview();
        updateTravelHealthPicker();
    } else {
        updateOverviewStats();
        updateDiseaseList();
    }
    updateGlobeLayers();
    updateTicker();

    // Restore country scope from URL if present
    if (state.selectedCountryCode) {
        if (state.mapMode === 'travel') {
            await loadTravelCountryDetail(state.selectedCountryCode);
        } else {
            const brief = buildCountryBrief(state.selectedCountryCode);
            showCountryBrief(brief);
        }
    }

    // 8. Start pulse animation
    animatePulse();

    // 9. Start auto-refresh
    startAutoRefresh();

    hideInitialLoadingOverlay();

    // 10. Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    console.log('%c SehaRadar initialized', 'color: #06b6d4; font-weight: bold;');
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
