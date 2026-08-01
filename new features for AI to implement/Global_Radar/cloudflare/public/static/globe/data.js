// ----- Data Fetching (with per-period cache) -----

// Caches: { days -> { data, timestamp } }
const geoCache = {};
const statsCache = {};
const travelCountriesCache = { data: null, timestamp: 0 };
const travelCountryDetailCache = {};
const travelHealthMatrixCache = { data: null, timestamp: 0 };
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

function isCacheValid(cache, days) {
    const entry = cache[days];
    return entry && (Date.now() - entry.timestamp < CACHE_TTL);
}

async function fetchGeoData(forceRefresh = false) {
    const days = state.days;
    if (!forceRefresh && isCacheValid(geoCache, days)) {
        state.geoData = geoCache[days].data;
        bumpGeoDataVersion();
        state.lastUpdated = new Date(geoCache[days].timestamp);
        updateLastUpdated();
        syncDatePickerBounds();
        updateCountryAutocomplete();
        return state.geoData;
    }

    try {
        await ensureCountryCentroids();
        const data = await fetchWorkerFindingsGeoJson(days);
        state.geoData = data;
        bumpGeoDataVersion();
        applyResponseMetadata(data?.metadata);
        state.statsData = buildWorkerStatsFromGeoData(data);
        statsCache[days] = { data: state.statsData, timestamp: Date.now() };
        if (!state.lastUpdated) state.lastUpdated = new Date();
        geoCache[days] = { data, timestamp: Date.now() };
        updateLastUpdated();
        syncDatePickerBounds();
        updateCountryAutocomplete();
        return data;
    } catch (e) {
        console.error('Failed to fetch geo data:', e);
        return null;
    }
}

async function fetchStats(forceRefresh = false) {
    const days = state.days;
    if (!forceRefresh && isCacheValid(statsCache, days)) {
        state.statsData = statsCache[days].data;
        return state.statsData;
    }

    try {
        const data = buildWorkerStatsFromGeoData(state.geoData);
        state.statsData = data;
        applyResponseMetadata(data?.metadata);
        statsCache[days] = { data, timestamp: Date.now() };
        return data;
    } catch (e) {
        console.error('Failed to fetch stats:', e);
        return null;
    }
}

async function fetchWorkerFindingsGeoJson(days) {
    const pageSize = 1000;
    const maxRecords = 5000;
    const dateFrom = days === 9999 ? '' : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const findings = [];

    for (let offset = 0; offset < maxRecords; offset += pageSize) {
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
        if (dateFrom) params.set('date', dateFrom);
        const res = await fetch(`/api/findings?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const batch = Array.isArray(payload?.findings) ? payload.findings : [];
        findings.push(...batch);
        if (batch.length < pageSize) break;
    }

    const features = findings.flatMap(findingToGeoFeatures);
    return {
        type: 'FeatureCollection',
        features,
        metadata: {
            data_source: { kind: 'd1', label: 'Cloudflare D1', table: 'findings' },
            total: findings.length,
            geocoded: features.length,
            ungeocodable: findings.length - new Set(features.map(feature => feature.properties.id)).size,
            generated_at: new Date().toISOString(),
            time_range: {
                start: dateFrom || '',
                end: new Date().toISOString().slice(0, 10),
            },
        },
    };
}

function findingToGeoFeatures(finding) {
    const countries = parseJsonArray(finding.countries_json ?? finding.countries);
    const regions = parseJsonArray(finding.regions_json ?? finding.regions);
    const resolvedCountries = resolveFindingCountries(countries, regions, finding);

    return resolvedCountries.map(country => ({
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [country.lon, country.lat],
        },
        properties: {
            id: finding.id,
            disease: finding.disease || 'Unknown',
            risk: normalizeRiskClass(finding.risk) || 'unclassified',
            risk_assessment: getRiskAssessmentText(finding.risk_assessment),
            headline: finding.headline || '',
            short_description_en: finding.short_description_en || '',
            detailed_description_en: finding.detailed_description_en || '',
            short_description_ar: finding.short_description_ar || '',
            detailed_description_ar: finding.detailed_description_ar || '',
            source: finding.source || finding.source_id || '',
            publication_date: finding.publication_date || '',
            country_code: country.code,
            country_name: country.name,
            country_name_ar: '',
            region: country.region || '',
            url: finding.source_link || '',
            source_link: finding.source_link || '',
        },
    }));
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch (_) {
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }
}

function resolveFindingCountries(countries, regions, finding) {
    const resolved = [];
    const seen = new Set();
    const candidates = [...countries];
    const textFallback = `${finding.headline || ''} ${finding.short_description_en || ''} ${finding.detailed_description_en || ''}`;

    if (candidates.length === 0 && textFallback) {
        candidates.push(...resolveCountriesFromText(textFallback));
    }

    for (const value of candidates) {
        const country = resolveCountry(value);
        if (!country || seen.has(country.code)) continue;
        seen.add(country.code);
        resolved.push(country);
    }

    if (resolved.length === 0) {
        for (const region of regions) {
            const regionCountries = state.countryCentroidsRegions?.[String(region || '').toUpperCase()] || [];
            for (const code of regionCountries) {
                const country = resolveCountry(code);
                if (!country || seen.has(country.code)) continue;
                seen.add(country.code);
                resolved.push(country);
            }
        }
    }

    return resolved;
}

function resolveCountriesFromText(text) {
    const normalized = String(text || '').toLowerCase();
    const matches = [];
    for (const [alias, code] of Object.entries(state.countryCentroidsAliases || {})) {
        if (normalized.includes(alias)) matches.push(code);
    }
    return matches;
}

function resolveCountry(value) {
    const raw = String(value || '').trim();
    if (!raw || !state.countryCentroids) return null;
    const directCode = raw.toUpperCase();
    const code = state.countryCentroids[directCode]
        ? directCode
        : state.countryCentroidsAliases?.[raw.toLowerCase()];
    const centroid = code ? state.countryCentroids[code] : null;
    if (!code || !centroid || centroid.lon == null || centroid.lat == null) return null;
    return {
        code,
        name: centroid.name || code,
        lat: centroid.lat,
        lon: centroid.lon,
        region: centroid.region || '',
    };
}

function buildWorkerStatsFromGeoData(geoData) {
    const features = geoData?.features || [];
    const byDiseaseMap = {};
    const byRisk = { unclassified: 0, no_risk: 0, low: 0, medium: 0, high: 0, critical: 0 };

    for (const feature of features) {
        const disease = feature.properties?.disease || 'Unknown';
        byDiseaseMap[disease] = (byDiseaseMap[disease] || 0) + 1;
        const risk = getRiskClass(feature.properties) || 'unclassified';
        byRisk[risk] = (byRisk[risk] || 0) + 1;
    }

    return {
        summary: {
            total_findings: features.length,
            countries_affected: new Set(features.map(feature => feature.properties?.country_code).filter(Boolean)).size,
            active_diseases: Object.keys(byDiseaseMap).length,
            critical_alerts: byRisk.critical || 0,
            high_alerts: byRisk.high || 0,
        },
        by_disease: Object.entries(byDiseaseMap)
            .map(([disease, count]) => ({ disease, count }))
            .sort((a, b) => b.count - a.count),
        by_risk: byRisk,
        metadata: geoData?.metadata || { generated_at: new Date().toISOString() },
    };
}

function normalizeTravelCountrySummary(raw) {
    const iso2 = String(raw?.iso2 || '').trim().toUpperCase();
    const riskCode = normalizeTravelRiskCode(raw?.risk_code ?? raw?.riskCode);
    return {
        iso2,
        name: String(raw?.name || iso2),
        risk_code: riskCode,
        color: String(raw?.color || getTravelRiskColor(riskCode)),
        next_review_at: raw?.next_review_at || raw?.nextReviewAt || null,
        last_reviewed_at: raw?.last_reviewed_at || raw?.lastReviewedAt || null,
    };
}

function normalizeTravelCountryDetail(raw, iso2 = '') {
    const code = String(raw?.iso2 || iso2 || '').trim().toUpperCase();
    const riskCode = normalizeTravelRiskCode(raw?.risk_code ?? raw?.riskCode);
    return {
        iso2: code,
        name: String(raw?.name || code),
        risk_code: riskCode,
        level_label: raw?.level_label || raw?.levelLabel || '',
        level_meaning: raw?.level_meaning || raw?.levelMeaning || '',
        why_summary: raw?.why_summary || raw?.whySummary || '',
        why: Array.isArray(raw?.why) ? raw.why : [],
        measures: Array.isArray(raw?.measures) ? raw.measures : [],
        contacts: Array.isArray(raw?.contacts) ? raw.contacts : [],
        source_refs: Array.isArray(raw?.source_refs) ? raw.source_refs : (Array.isArray(raw?.sourceRefs) ? raw.sourceRefs : []),
        last_reviewed_at: raw?.last_reviewed_at || raw?.lastReviewedAt || null,
        next_review_at: raw?.next_review_at || raw?.nextReviewAt || null,
        updated_by: raw?.updated_by || raw?.updatedBy || '',
        is_overdue: Boolean(raw?.is_overdue ?? raw?.isOverdue),
    };
}

function getTravelCountrySummary(countryCode) {
    return state.travelCountryByCode[String(countryCode || '').toUpperCase()] || null;
}

async function fetchTravelCountries(forceRefresh = false) {
    if (!forceRefresh && travelCountriesCache.data && (Date.now() - travelCountriesCache.timestamp < CACHE_TTL)) {
        state.travelCountries = travelCountriesCache.data;
        state.travelCountryByCode = Object.fromEntries(state.travelCountries.map(country => [country.iso2, country]));
        state.lastUpdated = new Date(travelCountriesCache.timestamp);
        updateLastUpdated();
        updateCountryAutocomplete();
        updateTravelOverview();
        applyTravelCountryLayerStyles();
        return state.travelCountries;
    }

    state.travelCountries = [];
    state.travelCountryByCode = {};
    travelCountriesCache.data = [];
    travelCountriesCache.timestamp = Date.now();
    updateTravelOverview();
    return [];
}

async function fetchTravelCountryDetail(countryCode, forceRefresh = false) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code) return null;

    const cacheEntry = travelCountryDetailCache[code];
    if (!forceRefresh && cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL)) {
        return cacheEntry.data;
    }

    return null;
}

function getTravelHealthRiskOptionsForUI() {
    return [
        {
            slug: null,
            name: t('travel_health_off'),
            count: state.travelCountries.length,
            iconUrl: '',
            size: 14,
            isOff: true,
        },
        {
            slug: TRAVEL_ALL_HEALTH_RISKS_SLUG,
            name: t('travel_health_all'),
            count: Object.keys(state.travelHealthRiskByCountry || {}).length,
            iconUrl: state.travelHealthRiskOptions[0]?.iconUrl || '',
            size: 14,
            isAll: true,
        },
        ...state.travelHealthRiskOptions,
    ];
}

function getSelectedTravelHealthRiskLabel() {
    if (!state.selectedTravelHealthRiskSlug) return t('travel_health_off');
    if (state.selectedTravelHealthRiskSlug === TRAVEL_ALL_HEALTH_RISKS_SLUG) return t('travel_health_all');
    return state.travelHealthRiskOptions.find(risk => risk.slug === state.selectedTravelHealthRiskSlug)?.name || t('travel_health_off');
}

function setTravelHealthRiskSelection(slug) {
    state.selectedTravelHealthRiskSlug = slug || null;
    updateTravelHealthPicker();
    updateGlobeLayers();
}

function updateTravelHealthPicker() {
    const panel = document.getElementById('travel-health-panel');
    if (!panel) return;

    if (state.mapMode !== 'travel') {
        setElementHTML(panel, '');
        return;
    }

    const badgeLabel = escapeHtml(getSelectedTravelHealthRiskLabel());
    if (state.travelHealthLoading && state.travelHealthRiskOptions.length === 0) {
        setElementHTML(panel, `
            <div class="panel-title">
                <span>${escapeHtml(t('travel_health_title'))}</span>
                <span class="badge">${badgeLabel}</span>
            </div>
            <div class="empty-state"><p>${escapeHtml(t('travel_health_loading'))}</p></div>
        `);
        return;
    }

    if (state.travelHealthLoadError && state.travelHealthRiskOptions.length === 0) {
        setElementHTML(panel, `
            <div class="panel-title">
                <span>${escapeHtml(t('travel_health_title'))}</span>
                <span class="badge">${badgeLabel}</span>
            </div>
            <div class="empty-state"><p>${escapeHtml(state.travelHealthLoadError)}</p></div>
        `);
        return;
    }

    const options = getTravelHealthRiskOptionsForUI();
    setElementHTML(panel, `
        <div class="panel-title">
            <span>${escapeHtml(t('travel_health_title'))}</span>
            <span class="badge">${badgeLabel}</span>
        </div>
        ${options.length > 2 || state.travelHealthRiskOptions.length > 0 ? `
            <div class="disease-list">
                ${options.map(option => {
                    const selected = (state.selectedTravelHealthRiskSlug || null) === (option.slug || null);
                    const iconHtml = option.iconUrl
                        ? `<img src="${escapeHtml(option.iconUrl)}" width="16" height="16" alt="${escapeHtml(option.name)}" class="disease-icon" loading="lazy" />`
                        : `<div class="disease-dot" style="background: transparent;"></div>`;
                    return `
                        <div class="disease-item travel-health-item ${selected ? 'selected' : ''}" data-travel-health-slug="${escapeHtml(option.slug || '')}">
                            ${iconHtml}
                            <span class="disease-name">${escapeHtml(option.name)}</span>
                            <span class="disease-count">${option.count || ''}</span>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="travel-health-note">${escapeHtml(t('travel_health_hint'))}</div>
        ` : `
            <div class="empty-state"><p>${escapeHtml(t('travel_health_empty'))}</p></div>
        `}
    `);
}

async function fetchTravelHealthMatrix(forceRefresh = false) {
    if (!forceRefresh && travelHealthMatrixCache.data && (Date.now() - travelHealthMatrixCache.timestamp < CACHE_TTL)) {
        state.travelHealthRiskOptions = travelHealthMatrixCache.data.options;
        state.travelHealthRiskByCountry = travelHealthMatrixCache.data.byCountry;
        state.travelHealthLoadError = '';
        updateTravelHealthPicker();
        return travelHealthMatrixCache.data;
    }

    state.travelHealthLoading = true;
    state.travelHealthLoadError = '';
    updateTravelHealthPicker();

    try {
        const matrixData = { options: [], byCountry: {} };
        state.travelHealthRiskOptions = matrixData.options;
        state.travelHealthRiskByCountry = matrixData.byCountry;
        travelHealthMatrixCache.data = matrixData;
        travelHealthMatrixCache.timestamp = Date.now();
        return matrixData;
    } finally {
        state.travelHealthLoading = false;
        updateTravelHealthPicker();
    }
}

function buildTravelHealthMarkerOffsets(centerLat, count) {
    if (count <= 1) return [{ lon: 0, lat: 0 }];
    const latCos = Math.max(0.4, Math.cos((Math.abs(centerLat) * Math.PI) / 180));
    const radiusLon = Math.min(2.1, 0.8 + (count - 2) * 0.18) / latCos;
    const radiusLat = Math.min(1.2, 0.45 + (count - 2) * 0.1);
    return Array.from({ length: count }, (_, index) => {
        const angle = (Math.PI * 2 * index) / count;
        return {
            lon: Math.cos(angle) * radiusLon,
            lat: Math.sin(angle) * radiusLat,
        };
    });
}

function createTravelHealthRiskLayer() {
    const selectedSlug = state.selectedTravelHealthRiskSlug;
    if (!selectedSlug || !state.countryCentroids) return null;

    const showAllRisks = selectedSlug === TRAVEL_ALL_HEALTH_RISKS_SLUG;
    const selectedRisk = showAllRisks
        ? null
        : state.travelHealthRiskOptions.find(risk => risk.slug === selectedSlug);
    if (!showAllRisks && !selectedRisk) return null;

    const markers = [];
    Object.entries(state.travelHealthRiskByCountry || {}).forEach(([iso2, risks]) => {
        const centroid = state.countryCentroids?.[iso2];
        if (!centroid || centroid.lon == null || centroid.lat == null || !Array.isArray(risks) || !risks.length) return;
        const countryName = getTravelCountrySummary(iso2)?.name || iso2;

        if (!showAllRisks && selectedRisk) {
            if (!risks.some(risk => risk.slug === selectedSlug)) return;
            markers.push({
                iso2,
                countryName,
                riskName: selectedRisk.name,
                riskSlug: selectedRisk.slug,
                riskColor: selectedRisk.color,
                travelRiskCode: getTravelCountrySummary(iso2)?.risk_code || 'unknown',
                iconUrl: selectedRisk.iconUrl,
                size: Math.max(14, Math.min(18, selectedRisk.size || 16)),
                lon: centroid.lon,
                lat: centroid.lat,
            });
            return;
        }

        const offsets = buildTravelHealthMarkerOffsets(centroid.lat, risks.length);
        risks.forEach((risk, index) => {
            const delta = offsets[index] || { lon: 0, lat: 0 };
            markers.push({
                iso2,
                countryName,
                riskName: risk.name,
                riskSlug: risk.slug,
                riskColor: risk.color,
                travelRiskCode: getTravelCountrySummary(iso2)?.risk_code || 'unknown',
                iconUrl: risk.iconUrl,
                size: Math.max(12, Math.min(16, risk.size || 16)),
                lon: centroid.lon + delta.lon,
                lat: centroid.lat + delta.lat,
            });
        });
    });

    if (!markers.length) return null;

    return new deck.IconLayer({
        id: 'travel-health-risk-layer',
        data: markers,
        pickable: true,
        billboard: true,
        getPosition: d => [d.lon, d.lat],
        getIcon: d => ({
            url: d.iconUrl,
            width: 64,
            height: 64,
            anchorY: 32,
        }),
        getSize: d => d.size,
        sizeUnits: 'pixels',
        sizeMinPixels: 14,
        sizeMaxPixels: 18,
    });
}

async function ensureCountryCentroids() {
    if (state.countryCentroids) return state.countryCentroids;
    try {
        const res = await fetch('/config/country_centroids.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        state.countryCentroids = data?.countries || {};
        state.countryCentroidsAliases = {
            ...(data?.aliases || {}),
            ...(data?.demonyms || {}),
        };
        state.countryCentroidsRegions = data?.regions || {};
        return state.countryCentroids;
    } catch (e) {
        console.warn('Failed to load country centroids:', e);
        state.countryCentroids = {};
        return state.countryCentroids;
    }
}

async function flyToTravelCountry(countryCode) {
    const code = String(countryCode || '').toUpperCase();
    if (!code || !state.deckgl) return;
    const centroids = await ensureCountryCentroids();
    const hit = centroids?.[code];
    if (!hit || hit.lon == null || hit.lat == null) return;
    flyToFinding(hit.lon, hit.lat);
}
