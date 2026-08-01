// ----- deck.gl Flat Map -----

const REGION_LABELS = [
    { name: 'NORTH AMERICA', coordinates: [-100, 45] },
    { name: 'SOUTH AMERICA', coordinates: [-58, -15] },
    { name: 'EUROPE', coordinates: [15, 54] },
    { name: 'AFRICA', coordinates: [20, 5] },
    { name: 'ASIA', coordinates: [80, 40] },
    { name: 'OCEANIA', coordinates: [135, -25] },
    { name: 'MIDDLE EAST', coordinates: [45, 28] },
];

const OUTBREAK_MARKER_LAYER_ID = 'markers';

function isOutbreakMarkerLayer(layer) {
    return String(layer?.id || '').startsWith(OUTBREAK_MARKER_LAYER_ID);
}

function createGlobe() {
    const initialView = REGION_VIEWS[state.region] || REGION_VIEWS.global;

    state.maplibre = new maplibregl.Map({
        container: 'maplibre-container',
        style: {
            version: 8,
            sources: {
                'carto-dark': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
                        'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
                        'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
                }
            },
            layers: [{
                id: 'carto-dark-layer',
                type: 'raster',
                source: 'carto-dark',
                minzoom: 0,
                maxzoom: 19,
            }],
        },
        center: [initialView.longitude, initialView.latitude],
        zoom: initialView.zoom,
        maxZoom: 12,
        minZoom: 1,
        interactive: false,
        attributionControl: false,
    });

    state.maplibre.on('load', () => {
        state.deckgl = new deck.DeckGL({
            container: 'deck-canvas',
            views: new deck.MapView({ repeat: true }),
            initialViewState: {
                ...initialView,
                transitionDuration: 0,
            },
            controller: true,
            getTooltip: null,
            layers: [],
            onHover: handleHover,
            onClick: handleClick,
            onViewStateChange: ({ viewState }) => {
                state.maplibre.jumpTo({
                    center: [viewState.longitude, viewState.latitude],
                    zoom: viewState.zoom,
                    bearing: viewState.bearing || 0,
                    pitch: viewState.pitch || 0,
                });
            },
        });

        updateGlobeLayers();
        updateLegend();
    });
}

function mapZoom(delta) {
    if (state.deckgl) {
        const vs = state.deckgl.viewManager?.getViewState() || {};
        state.deckgl.setProps({
            initialViewState: {
                ...vs,
                zoom: (vs.zoom || 1.8) + delta,
                transitionDuration: 300,
                transitionInterpolator: new deck.LinearInterpolator(['zoom']),
            },
        });
    }
}

function mapReset() {
    flyToRegion('global');
}

function updateLegend() {
    const el = document.getElementById('map-legend');
    if (!el) return;
    if (state.mapMode === 'travel') {
        const travelLevels = ['green', 'yellow', 'red', 'unknown'];
        const healthSuffix = state.selectedTravelHealthRiskSlug
            ? `<span class="legend-item"><span class="legend-dot" style="background: rgba(255,255,255,0.4)"></span>${escapeHtml(getSelectedTravelHealthRiskLabel())}</span>`
            : '';
        el.innerHTML = `<span class="legend-title">${escapeHtml(t('travel_legend'))}</span>` +
            travelLevels.map(level => `
                <span class="legend-item">
                    <span class="legend-dot" style="background: ${getTravelRiskColor(level)}"></span>
                    ${escapeHtml(getTravelRiskLabel(level))}
                </span>
            `).join('') + healthSuffix;
        return;
    }

    // Outbreak risk classes + news marker style
    const riskLevels = [
        { key: 'risk_unclassified', color: RISK_COLORS.unclassified },
        { key: 'risk_no_risk', color: RISK_COLORS.no_risk },
        { key: 'risk_low', color: RISK_COLORS.low },
        { key: 'risk_medium', color: OUTBREAK_COUNTRY_RISK_COLORS.medium },
        { key: 'risk_high', color: OUTBREAK_COUNTRY_RISK_COLORS.high },
        { key: 'risk_critical', color: OUTBREAK_COUNTRY_RISK_COLORS.critical },
    ];
    const title = state.lang === 'ar' ? 'مخاطر التفشي' : 'Outbreak Risk';
    const newsLabel = t('risk_news_label');
    el.innerHTML = `<span class="legend-title">${escapeHtml(title)}</span>` +
        riskLevels.map(r => {
            return `<span class="legend-item">
                <span class="legend-dot" style="background: ${r.color}"></span>
                ${escapeHtml(t(r.key))}
            </span>`;
        }).join('') +
        `<span class="legend-item"><span class="legend-dot" style="background: ${RISK_COLORS.news}"></span>${escapeHtml(newsLabel)}</span>`;
}

function updateGlobeLayers() {
    if (!state.deckgl) return;
    void ensureOutbreakCountryLayers();

    void ensureTravelCountryLayers();
    applyTravelCountryLayerStyles();

    if (state.mapMode === 'travel') {
        const travelLayers = [];
        const healthLayer = createTravelHealthRiskLayer();
        if (healthLayer) travelLayers.push(healthLayer);
        state.deckgl.setProps({ layers: travelLayers });
        applyOutbreakCountryLayerStyles();
        applyTravelCountryLayerStyles();
        updateLegend();
        updateTravelOverview();
        updateTravelHealthPicker();
        updateTicker();
        return;
    }

    ++state.animationFrame;
    const viewModel = getOutbreakViewModel();
    const features = viewModel.visibleFeatures;
    state.outbreakCountryRiskByCode = viewModel.outbreakCountryRiskByCode;
    state.countryFindingCounts = viewModel.countryFindingCounts;
    applyOutbreakCountryLayerStyles();
    const dots = viewModel.dots;

    const layers = [];

    if (REGION_LABELS.length > 0) {
        layers.push(new deck.TextLayer({
            id: 'region-labels',
            data: REGION_LABELS,
            getPosition: d => d.coordinates,
            getText: d => d.name,
            getSize: 14,
            getColor: [100, 116, 139, 60],
            fontFamily: 'Inter, sans-serif',
            fontWeight: 700,
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            billboard: false,
            sizeUnits: 'pixels',
            sizeMinPixels: 10,
            sizeMaxPixels: 18,
        }));
    }

    if (dots.length > 0) {
        layers.push(new deck.IconLayer({
            id: `${OUTBREAK_MARKER_LAYER_ID}-${state.iconRefreshVersion}`,
            data: dots,
            pickable: true,
            getPosition: d => d.geometry.coordinates,
            updateTriggers: {
                getIcon: state.iconRefreshVersion,
            },
            getIcon: d => {
                const disease = d.properties.disease;
                const color = d._riskColor;
                const iconName = DISEASE_ICONS[disease];
                const iconUrl = iconName
                    ? getDiseaseIconUrl(disease, color)
                    : buildFallbackMarkerIcon(color);
                return {
                    url: iconUrl,
                    width: 64,
                    height: 64,
                    anchorY: 32,
                };
            },
            getSize: d => {
                // Uniform size for all markers (matching legend size 14x14)
                return 14;
            },
            sizeUnits: 'pixels',
            sizeMinPixels: 16,
            sizeMaxPixels: 64,
        }));

        // Pulse rings removed - no pulsating effect
    }

    state.deckgl.setProps({ layers });
    updateOverviewStats();
    updateDiseaseList();
    updateTicker();
}

// ----- Hover & Click Handlers -----

function handleHover(info) {
    const tooltip = document.getElementById('globe-tooltip');

    if (state.mapMode === 'travel') {
        if (info?.picked && info?.layer?.id === 'travel-health-risk-layer' && info.object) {
            const marker = info.object;
            const summary = getTravelCountrySummary(marker.iso2);
            tooltip.innerHTML = `
                <div class="tooltip-country-name">${ccToFlag(marker.iso2)} ${escapeHtml(marker.countryName || summary?.name || marker.iso2)}</div>
                <div class="tooltip-disease">
                    <img src="${escapeHtml(marker.iconUrl)}" width="16" height="16" alt="${escapeHtml(marker.riskName)}" style="vertical-align: middle;" />
                    ${escapeHtml(marker.riskName)}
                </div>
                <div class="tooltip-meta">
                    <span>${escapeHtml(getTravelRiskLabel(marker.travelRiskCode || summary?.risk_code || 'unknown'))}</span>
                    ${summary?.next_review_at ? `<span>${escapeHtml(t('travel_next_review'))}: ${escapeHtml(formatDate(summary.next_review_at))}</span>` : ''}
                </div>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = Math.min(info.x + 12, window.innerWidth - 300) + 'px';
            tooltip.style.top = Math.min(info.y + 12, window.innerHeight - 150) + 'px';
            return;
        }

        const hit = queryTravelCountryAtPoint(info?.x, info?.y);
        if (!hit) {
            tooltip.style.display = 'none';
            return;
        }

        const summary = hit.summary;
        tooltip.innerHTML = `
            <div class="tooltip-country-name">${ccToFlag(hit.code)} ${escapeHtml(summary?.name || hit.name)}</div>
            <div class="tooltip-disease">
                <span class="disease-chip-dot" style="background:${getTravelRiskColor(summary?.risk_code, summary?.color)}"></span>
                ${escapeHtml(getTravelRiskLabel(summary?.risk_code || 'unknown'))}
            </div>
            <div class="tooltip-meta">
                ${summary?.next_review_at ? `<span>${escapeHtml(t('travel_next_review'))}: ${escapeHtml(formatDate(summary.next_review_at))}</span>` : ''}
                ${summary?.last_reviewed_at ? `<span>${escapeHtml(t('travel_last_reviewed'))}: ${escapeHtml(formatDate(summary.last_reviewed_at))}</span>` : ''}
            </div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = Math.min(info.x + 12, window.innerWidth - 300) + 'px';
        tooltip.style.top = Math.min(info.y + 12, window.innerHeight - 150) + 'px';
        return;
    }

    if (!info.picked || !info.object) {
        const countryHit = queryOutbreakCountryAtPoint(info?.x, info?.y);
        if (countryHit) {
            tooltip.innerHTML = `
                <div class="tooltip-country-name">${ccToFlag(countryHit.code)} ${escapeHtml(countryHit.name)}</div>
                <div class="tooltip-disease">
                    <span class="disease-chip-dot" style="background:${getOutbreakCountryRiskColor(countryHit.riskClass)}"></span>
                    ${escapeHtml(getRiskLabel(countryHit.riskClass))}
                </div>
                <div class="tooltip-meta">
                    <span>${escapeHtml(String(countryHit.count || 0))} ${escapeHtml(t('findings'))}</span>
                </div>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = Math.min(info.x + 12, window.innerWidth - 300) + 'px';
            tooltip.style.top = Math.min(info.y + 12, window.innerHeight - 150) + 'px';
            return;
        }
        tooltip.style.display = 'none';
        return;
    }

    // Finding marker hover
    if (isOutbreakMarkerLayer(info.layer)) {
        const p = info.object.properties;
        const color = info.object._riskColor || DISEASE_COLORS_HEX[p.disease] || '#64748b';
        const iconName = DISEASE_ICONS[p.disease] || '';
        const headline = state.lang === 'ar' && p.short_description_ar
            ? p.short_description_ar.slice(0, 120)
            : (p.headline || '').slice(0, 120);
        const country = state.lang === 'ar' && p.country_name_ar ? p.country_name_ar : p.country_name;
        const riskClass = getRiskClass(p);
        const riskLabel = isNewsDiseaseName(p.disease)
            ? t('news_label')
            : getRiskDisplayText(riskClass || 'unclassified', p.risk_assessment);

        // Count how many findings share the same country (from cached counts)
        const cc = p.country_code;
        const colocatedCount = cc ? (state.countryFindingCounts[cc] || 1) : 1;
        const countBadge = colocatedCount > 1
            ? `<span class="tooltip-count-badge">${colocatedCount}</span>`
            : '';

        const iconImg = iconName 
            ? `<img src="${escapeHtml(getDiseaseIconUrl(p.disease, color))}" width="16" height="16" alt="${escapeHtml(p.disease)}" style="vertical-align: middle;" />`
            : `<span class="disease-chip-dot" style="background: ${color}; width: 8px; height: 8px; display: inline-block; border-radius: 50%;"></span>`;

        tooltip.innerHTML = `
            <div class="tooltip-disease">
                ${iconImg}
                ${state.lang === 'ar' ? (DISEASE_NAMES_AR[p.disease] || p.disease) : p.disease}
                <span style="font-size: 0.65rem; color: var(--text-muted); margin-left: 6px;">${escapeHtml(riskLabel)}</span>${countBadge}
            </div>
            <div class="tooltip-headline">${headline}</div>
            <div class="tooltip-meta">
                <span>${ccToFlag(p.country_code)} ${country}</span>
                <span>${p.source} &middot; ${p.publication_date?.slice(0, 10) || ''}</span>
            </div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = Math.min(info.x + 12, window.innerWidth - 300) + 'px';
        tooltip.style.top = Math.min(info.y + 12, window.innerHeight - 150) + 'px';
        return;
    }

    tooltip.style.display = 'none';
}

function handleClick(info) {
    if (state.mapMode === 'travel') {
        if (info?.picked && info?.layer?.id === 'travel-health-risk-layer' && info.object?.iso2) {
            setCountrySelection(info.object.iso2, { skipFly: true });
            return;
        }
        const hit = queryTravelCountryAtPoint(info?.x, info?.y);
        if (hit?.code) {
            setCountrySelection(hit.code, { skipFly: true });
        }
        return;
    }

    if (!info.picked || !info.object) {
        const hit = queryOutbreakCountryAtPoint(info?.x, info?.y);
        if (hit?.code) {
            setCountrySelection(hit.code, { skipFly: true });
        }
        return;
    }

    // Marker click -> show finding's country brief (instant, no API call)
    if (isOutbreakMarkerLayer(info.layer)) {
        const cc = info.object.properties.country_code;
        if (cc) {
            setCountrySelection(cc, { skipFly: true });
        }
        return;
    }

}

// ----- Pulse Animation Loop (disabled - no pulsating effect) -----

function animatePulse() {
    // Animation loop disabled since pulse rings were removed
    // No longer calling requestAnimationFrame
}

// ----- Loading State Helpers -----

function showMapLoading() {
    const el = document.getElementById('map-loading');
    if (el) el.classList.add('visible');
}

function hideMapLoading() {
    const el = document.getElementById('map-loading');
    if (el) el.classList.remove('visible');
}

function hideInitialLoadingOverlay() {
    const el = document.getElementById('loading-overlay');
    if (el) el.classList.add('hidden');
}

function setRefreshBtnLoading(loading) {
    const btn = document.getElementById('refresh-btn');
    if (!btn) return;
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

async function manualRefresh() {
    if (state._refreshing) return;
    if (state.mapMode === 'travel') {
        travelCountriesCache.data = null;
        Object.keys(travelCountryDetailCache).forEach(key => delete travelCountryDetailCache[key]);
        travelHealthMatrixCache.data = null;
        state.travelCountryDetails = {};
    } else {
        delete geoCache[state.days];
        delete statsCache[state.days];
    }
    await refreshAllData();
}
