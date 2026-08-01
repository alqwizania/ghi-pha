function buildOutbreakCountryRiskMap(features = getFilteredFeatures()) {
    const countryRisk = {};
    (features || []).forEach(feature => {
        const code = String(feature?.properties?.country_code || feature?.properties?.id || '').trim().toUpperCase();
        if (!code) return;
        const riskClass = getCountryFillRiskClass(feature.properties);
        if (!riskClass) return;
        const current = countryRisk[code];
        if (!current || (RISK_CLASS_ORDER[riskClass] ?? -1) > (RISK_CLASS_ORDER[current] ?? -1)) {
            countryRisk[code] = riskClass;
        }
    });
    return countryRisk;
}

async function loadCountryBoundariesGeoJson() {
    if (state.countryBoundariesData) return state.countryBoundariesData;
    if (!state.countryBoundariesPromise) {
        state.countryBoundariesPromise = (async () => {
            const res = await fetch('/data/countries.geojson');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const geojson = await res.json();
            state.countryBoundariesData = geojson;
            return geojson;
        })().catch(error => {
            state.countryBoundariesData = null;
            throw error;
        }).finally(() => {
            state.countryBoundariesPromise = null;
        });
    }

    return state.countryBoundariesPromise;
}

function buildOutbreakCountryColorExpression() {
    const entries = Object.entries(state.outbreakCountryRiskByCode || {});
    if (!entries.length) return 'rgba(0,0,0,0)';

    const expression = ['match', ['get', 'ISO3166-1-Alpha-2']];
    entries.forEach(([code, riskClass]) => {
        expression.push(code, getOutbreakCountryRiskColor(riskClass));
    });
    expression.push('rgba(0,0,0,0)');
    return expression;
}

function buildOutbreakCountryOpacityExpression() {
    const entries = Object.entries(state.outbreakCountryRiskByCode || {});
    if (!entries.length) return 0;

    const expression = ['match', ['get', 'ISO3166-1-Alpha-2']];
    entries.forEach(([code, riskClass]) => {
        expression.push(code, OUTBREAK_COUNTRY_RISK_COLORS[riskClass] ? 0.32 : 0);
    });
    expression.push(0);
    return expression;
}

async function ensureOutbreakCountryLayers() {
    if (!state.maplibre) return;
    if (state.maplibre.getSource('outbreak-country-boundaries')) {
        applyOutbreakCountryLayerStyles();
        return;
    }
    try {
        const geojson = await loadCountryBoundariesGeoJson();
        if (!state.maplibre || state.maplibre.getSource('outbreak-country-boundaries')) return;

        state.maplibre.addSource('outbreak-country-boundaries', {
            type: 'geojson',
            data: geojson,
        });
        state.maplibre.addLayer({
            id: 'outbreak-country-fill',
            type: 'fill',
            source: 'outbreak-country-boundaries',
            paint: {
                'fill-color': 'rgba(0,0,0,0)',
                'fill-opacity': 0,
            },
        });
        state.maplibre.addLayer({
            id: 'outbreak-country-border',
            type: 'line',
            source: 'outbreak-country-boundaries',
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.28)',
                'line-width': 0.7,
                'line-opacity': 0,
            },
        });

        applyOutbreakCountryLayerStyles();
    } catch (e) {
        console.error('Failed to load outbreak country boundaries:', e);
    }
}

function applyOutbreakCountryLayerStyles() {
    if (!state.maplibre || !state.maplibre.getLayer('outbreak-country-fill')) return;
    const visible = state.mapMode === 'outbreaks';
    try {
        state.maplibre.setPaintProperty('outbreak-country-fill', 'fill-color', buildOutbreakCountryColorExpression());
        state.maplibre.setPaintProperty('outbreak-country-fill', 'fill-opacity', visible ? buildOutbreakCountryOpacityExpression() : 0);
        state.maplibre.setPaintProperty('outbreak-country-border', 'line-opacity', visible ? 0.36 : 0);
    } catch (e) {
        console.warn('Failed to update outbreak country layer styles:', e);
    }
}

function queryOutbreakCountryAtPoint(x, y) {
    if (!state.maplibre || state.mapMode !== 'outbreaks') return null;
    try {
        const features = state.maplibre.queryRenderedFeatures([x, y], { layers: ['outbreak-country-fill'] });
        const properties = features?.[0]?.properties || {};
        const code = String(properties['ISO3166-1-Alpha-2'] || '').trim().toUpperCase();
        const riskClass = state.outbreakCountryRiskByCode?.[code];
        if (!code || !riskClass || !OUTBREAK_COUNTRY_RISK_COLORS[riskClass]) return null;
        return {
            code,
            name: String(properties.name || code),
            riskClass,
            count: state.countryFindingCounts[code] || 0,
        };
    } catch (_) {
        return null;
    }
}

function buildTravelRiskColorExpression() {
    if (!state.travelCountries.length) return TRAVEL_RISK_COLORS.unknown;
    const expression = ['match', ['get', 'ISO3166-1-Alpha-2']];
    (state.travelCountries || []).forEach(country => {
        expression.push(country.iso2, country.color || getTravelRiskColor(country.risk_code));
    });
    expression.push(TRAVEL_RISK_COLORS.unknown);
    return expression;
}

async function ensureTravelCountryLayers() {
    if (!state.maplibre) return;
    if (state.maplibre.getSource('travel-country-boundaries')) {
        applyTravelCountryLayerStyles();
        return;
    }
    try {
        const geojson = await loadCountryBoundariesGeoJson();
        if (!state.maplibre || state.maplibre.getSource('travel-country-boundaries')) return;

        state.maplibre.addSource('travel-country-boundaries', {
            type: 'geojson',
            data: geojson,
        });
        state.maplibre.addLayer({
            id: 'travel-country-fill',
            type: 'fill',
            source: 'travel-country-boundaries',
            paint: {
                'fill-color': TRAVEL_RISK_COLORS.unknown,
                'fill-opacity': 0,
                'fill-color-transition': { duration: 250, delay: 0 },
                'fill-opacity-transition': { duration: 250, delay: 0 },
            },
        });
        state.maplibre.addLayer({
            id: 'travel-country-border',
            type: 'line',
            source: 'travel-country-boundaries',
            paint: {
                'line-color': OUTBREAK_COUNTRY_BORDER_COLOR,
                'line-width': 0.7,
                'line-opacity': 0,
                'line-color-transition': { duration: 250, delay: 0 },
                'line-opacity-transition': { duration: 250, delay: 0 },
            },
        });
        state.maplibre.addLayer({
            id: 'travel-country-selected-fill',
            type: 'fill',
            source: 'travel-country-boundaries',
            paint: {
                'fill-color': '#ffffff',
                'fill-opacity': 0,
                'fill-opacity-transition': { duration: 250, delay: 0 },
            },
            filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        state.maplibre.addLayer({
            id: 'travel-country-selected-border',
            type: 'line',
            source: 'travel-country-boundaries',
            paint: {
                'line-color': '#ffffff',
                'line-width': 1.4,
                'line-opacity': 0,
                'line-opacity-transition': { duration: 250, delay: 0 },
            },
            filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });

        applyTravelCountryLayerStyles();
    } catch (e) {
        console.error('Failed to load travel country boundaries:', e);
    }
}

function applyTravelCountryLayerStyles() {
    if (!state.maplibre || !state.maplibre.getLayer('travel-country-fill')) return;
    const travelMode = state.mapMode === 'travel';
    const hasTravelData = (state.travelCountries || []).length > 0;
    const showTravelRiskBorders = travelMode && hasTravelData;
    const selectedCode = state.selectedCountryCode || '';
    try {
        state.maplibre.setPaintProperty('travel-country-fill', 'fill-color', buildTravelRiskColorExpression());
        state.maplibre.setPaintProperty('travel-country-fill', 'fill-opacity', 0);
        state.maplibre.setPaintProperty(
            'travel-country-border',
            'line-color',
            showTravelRiskBorders ? buildTravelRiskColorExpression() : OUTBREAK_COUNTRY_BORDER_COLOR,
        );
        state.maplibre.setPaintProperty('travel-country-border', 'line-opacity', showTravelRiskBorders ? 0.72 : 0.24);
        state.maplibre.setPaintProperty('travel-country-selected-fill', 'fill-opacity', selectedCode ? (travelMode ? 0.04 : 0.025) : 0);
        state.maplibre.setPaintProperty('travel-country-selected-border', 'line-opacity', selectedCode ? (travelMode ? 0.9 : 0.55) : 0);
        state.maplibre.setFilter('travel-country-selected-fill', ['==', ['get', 'ISO3166-1-Alpha-2'], selectedCode]);
        state.maplibre.setFilter('travel-country-selected-border', ['==', ['get', 'ISO3166-1-Alpha-2'], selectedCode]);
    } catch (e) {
        console.warn('Failed to update travel country layer styles:', e);
    }
}

function queryTravelCountryAtPoint(x, y) {
    if (!state.maplibre || state.mapMode !== 'travel') return null;
    try {
        const features = state.maplibre.queryRenderedFeatures([x, y], { layers: ['travel-country-fill'] });
        const properties = features?.[0]?.properties || {};
        const code = String(properties['ISO3166-1-Alpha-2'] || '').trim().toUpperCase();
        if (!code) return null;
        const summary = getTravelCountrySummary(code);
        return {
            code,
            name: summary?.name || String(properties.name || code),
            summary,
        };
    } catch (_) {
        return null;
    }
}
