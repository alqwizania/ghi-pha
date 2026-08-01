// ----- Application State -----

const state = {
    lang: 'en',
    mapMode: 'outbreaks',
    days: 9999,
    region: 'global',
    dateFrom: '',
    dateTo: '',
    dateMin: '',
    dateMax: '',
    dateCustom: false,
    diseaseFilterMode: 'outbreaks', // 'outbreaks' | 'news' | 'all'
    riskFilter: 'all',
    diseasesEnabled: {},
    selectedDisease: null,  // null = all shown, string = solo that disease
    selectedNewsId: null,   // selected news item in News tab
    diseaseTab: 'diseases', // 'diseases' or 'news' — controls which items appear in the filter list
    selectedCountryCode: null, // country scope from map click
    geoData: null,         // GeoJSON FeatureCollection
    statsData: null,       // Map stats
    dataSource: null,
    countryBrief: null,
    outbreakCountryRiskByCode: {},
    hriByCountry: {},
    lastUpdated: null,
    deckgl: null,
    maplibre: null,
    animationFrame: 0,
    countryFindingCounts: {},  // { country_code: count } – rebuilt on layer update
    countryMetaByCode: {},
    countryLabelToCode: {},
    countryAutocompleteItems: [],
    availableDates: [],
    activeDatePopover: null,
    activeRiskEditorId: null,
    riskDetailsOpen: {},
    travelCountries: [],
    travelCountryByCode: {},
    travelCountryDetails: {},
    travelDetailRequestToken: 0,
    travelHealthRiskOptions: [],
    travelHealthRiskByCountry: {},
    selectedTravelHealthRiskSlug: null,
    travelHealthLoading: false,
    travelHealthLoadError: '',
    countryCentroids: null,
    countryBoundariesData: null,
    countryBoundariesPromise: null,
    geoDataVersion: 0,
    iconRefreshScheduled: false,
    iconRefreshVersion: 0,
    _refreshing: false,        // Guard against overlapping refreshes
    _refreshPending: false,    // Re-run refresh once after current pass finishes
};

// Set of disease names that are actually "news" (general health news, not specific diseases)
const NEWS_DISEASES = new Set(['news']);

// Initialize all diseases as enabled, but news items hidden (default tab is 'diseases')
Object.keys(DISEASE_COLORS).forEach(d => {
    state.diseasesEnabled[d] = !NEWS_DISEASES.has(d);
});

// ----- Utility Functions -----

function t(key) {
    return I18N[state.lang]?.[key] || I18N.en[key] || key;
}

function normalizeDataSource(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const kind = String(raw.kind || '').trim().toLowerCase();
    const label = String(raw.label || '').trim();
    const table = String(raw.table || '').trim();
    const tableId = String(raw.table_id || raw.tableId || '').trim();
    const baseId = String(raw.base_id || raw.baseId || '').trim();

    if (!kind && !label && !table && !tableId && !baseId) return null;

    return {
        kind,
        label,
        table,
        tableId,
        baseId,
    };
}

function applyResponseMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return;

    const dataSource = normalizeDataSource(metadata.data_source);
    if (dataSource) state.dataSource = dataSource;

    if (metadata.generated_at) {
        const generatedAt = new Date(metadata.generated_at);
        if (!Number.isNaN(generatedAt.getTime())) {
            state.lastUpdated = generatedAt;
        }
    }

    updateLastUpdated();
}

function getDataSourceLabel() {
    const explicitLabel = String(state.dataSource?.label || '').trim();
    if (explicitLabel) return explicitLabel;

    const kind = String(state.dataSource?.kind || '').trim().toLowerCase();
    if (!kind) return '';
    if (kind === 'nocodb') return 'NocoDB';
    return kind;
}

function trimCacheMap(map, limit = FILTER_CACHE_LIMIT) {
    while (map.size > limit) {
        const oldestKey = map.keys().next().value;
        map.delete(oldestKey);
    }
}

function setElementHTML(el, html) {
    if (!el) return false;
    if (el.innerHTML === html) return false;
    el.innerHTML = html;
    return true;
}

function setElementText(el, value) {
    if (!el) return false;
    const nextValue = String(value);
    if (el.textContent === nextValue) return false;
    el.textContent = nextValue;
    return true;
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');
    const dateReset = document.getElementById('date-reset-btn');
    const countrySearch = document.getElementById('country-search');
    const countrySearchAction = document.getElementById('country-search-action');
    if (dateFrom) dateFrom.title = t('date_from_label');
    if (dateTo) dateTo.title = t('date_to_label');
    if (dateReset) dateReset.title = t('date_reset');
    if (countrySearch) countrySearch.placeholder = t('country_search_placeholder');
    if (countrySearchAction) {
        countrySearchAction.title = t('country_search_placeholder');
    }

    // Update sidebars direction
    const dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('left-sidebar').setAttribute('dir', dir);
    document.getElementById('right-sidebar').setAttribute('dir', dir);

    updateCountryAutocomplete();
    updateCountrySearchAction();
}

function syncModeLinks() {
    document.querySelectorAll('.mode-link').forEach(link => {
        link.classList.toggle('active', link.dataset.mapMode === state.mapMode);
    });
}

function applyMapModeUI() {
    const travelMode = state.mapMode === 'travel';
    document.getElementById('date-range-control')?.classList.toggle('app-hidden', travelMode);
    document.getElementById('time-filters')?.classList.toggle('app-hidden', travelMode);
    document.getElementById('overview-panel')?.classList.toggle('app-hidden', travelMode);
    document.getElementById('diseases-panel')?.classList.toggle('app-hidden', travelMode);
    document.getElementById('risk-panel')?.classList.toggle('app-hidden', travelMode);
    document.getElementById('travel-overview-panel')?.classList.toggle('app-hidden', !travelMode);
    document.getElementById('travel-health-panel')?.classList.toggle('app-hidden', !travelMode);
    syncModeLinks();
}

function setMapMode(mode) {
    const nextMode = mode === 'travel' ? 'travel' : 'outbreaks';
    if (state.mapMode === nextMode) {
        applyMapModeUI();
        updateGlobeLayers();
        updateURL();
        return;
    }

    state.mapMode = nextMode;
    state.activeRiskEditorId = null;
    applyMapModeUI();
    updateCountryAutocomplete();
    updateLegend();

    const tooltip = document.getElementById('globe-tooltip');
    if (tooltip) tooltip.style.display = 'none';

    if (nextMode === 'travel') {
        if (state.selectedCountryCode) {
            showTravelCountryBriefPlaceholder(state.selectedCountryCode, t('travel_loading_detail'));
        } else {
            showCountryBrief(null);
        }
    } else {
        if (state.selectedCountryCode) {
            showCountryBrief(buildCountryBrief(state.selectedCountryCode));
        } else {
            showCountryBrief(null);
        }
    }

    updateGlobeLayers();
    updateURL();
    void refreshAllData();
}
