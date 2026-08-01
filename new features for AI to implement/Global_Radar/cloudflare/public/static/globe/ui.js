function buildCountryBrief(cc) {
    const code = String(cc || '').trim().toUpperCase();
    if (!code) return null;

    const cacheKey = `${state.geoDataVersion}:${code}`;
    if (selectorCache.countryBriefs.has(cacheKey)) {
        const cachedBrief = selectorCache.countryBriefs.get(cacheKey);
        state.countryBrief = cachedBrief;
        return cachedBrief;
    }

    const countryFeatures = getCountryFeaturesByCode()[code] || [];

    if (countryFeatures.length === 0) return null;

    const first = countryFeatures[0].properties;
    const findings = countryFeatures.map(f => ({
            id: f.properties.id,
            disease: f.properties.disease,
            headline: f.properties.headline,
            risk: f.properties.risk,
            risk_assessment: f.properties.risk_assessment,
            short_description_en: f.properties.short_description_en,
            detailed_description_en: f.properties.detailed_description_en,
            short_description_ar: f.properties.short_description_ar,
            detailed_description_ar: f.properties.detailed_description_ar,
            risk_class: getRiskClass(f.properties),
            publication_date: f.properties.publication_date,
            source: f.properties.source,
            url: f.properties.url,
            source_link: f.properties.source_link,
        }));

    const brief = {
        country_code: code,
        country_name: first.country_name || code,
        country_name_ar: first.country_name_ar || '',
        who_region: first.region || '',
        findings: findings,
    };

    selectorCache.countryBriefs.set(cacheKey, brief);
    state.countryBrief = brief;
    return brief;
}

// ----- Update UI Components -----

function updateLastUpdated() {
    const el = document.getElementById('last-updated');
    if (!el) return;

    const parts = [];
    if (state.lastUpdated) parts.push(formatTimeAgo(state.lastUpdated));

    const sourceLabel = getDataSourceLabel();
    if (sourceLabel) parts.push(sourceLabel);

    if (parts.length) {
        el.textContent = parts.join(' • ');
    }

    const pill = document.getElementById('status-pill');
    if (pill && state.dataSource) {
        const sourceName = sourceLabel || state.dataSource.kind || 'live';
        const tableName = state.dataSource.table ? ` / ${state.dataSource.table}` : '';
        pill.title = `Live data source: ${sourceName}${tableName}`;
    }
}

function updateOverviewStats() {
    if (state.mapMode === 'travel') {
        updateTravelOverview();
        return;
    }

    const setText = (id, value) => {
        const el = document.getElementById(id);
        setElementText(el, value);
    };

    const viewModel = getOutbreakViewModel();

    setText('stat-findings-total', viewModel.visibleFeatures.length);
    setText('stat-news-total', viewModel.visibleNews.length);
    setText('stat-outbreaks-total', viewModel.visibleOutbreaks.length);

    setText('stat-outbreaks-only', viewModel.visibleOutbreaks.length);
    setText('stat-diseases-outbreak', viewModel.outbreakDiseases.size);
    setText('stat-countries-outbreak', viewModel.outbreakCountries.size);

    setText('stat-risk-unclassified', viewModel.visibleRiskCounts.unclassified);
    setText('stat-risk-no-risk', viewModel.visibleRiskCounts.no_risk);
    setText('stat-risk-low', viewModel.visibleRiskCounts.low);
    setText('stat-risk-medium', viewModel.visibleRiskCounts.medium);
    setText('stat-risk-high', viewModel.visibleRiskCounts.high);
    setText('stat-risk-critical', viewModel.visibleRiskCounts.critical);

    const overviewDays = document.getElementById('overview-days');
    setElementText(overviewDays, state.days === 9999 ? 'All' : state.days + 'd');

    setText('rcount-all', viewModel.outbreakScopeNoRiskFilter.length);
    setText('rcount-unclassified', viewModel.panelRiskCounts.unclassified);
    setText('rcount-no-risk', viewModel.panelRiskCounts.no_risk);
    setText('rcount-low', viewModel.panelRiskCounts.low);
    setText('rcount-medium', viewModel.panelRiskCounts.medium);
    setText('rcount-high', viewModel.panelRiskCounts.high);
    setText('rcount-critical', viewModel.panelRiskCounts.critical);

    document.querySelectorAll('.risk-item').forEach(el => {
        el.classList.toggle('active', el.dataset.risk === state.riskFilter);
    });

    const mode = state.diseaseFilterMode;
    document.getElementById('card-findings')?.classList.toggle('active', mode === 'all');
    document.getElementById('card-news')?.classList.toggle('active', mode === 'news');
    document.getElementById('card-outbreaks-all')?.classList.toggle('active', mode === 'outbreaks');
    updateOverviewGroupVisibility();
}

function updateDiseaseList() {
    if (state.mapMode === 'travel') return;

    const container = document.getElementById('disease-list');
    if (!container) return;
    const s = state.statsData;
    const diseaseCounts = {};
    if (s?.by_disease) {
        s.by_disease.forEach(d => { diseaseCounts[d.disease] = d.count; });
    }

    const allDiseases = Object.keys(DISEASE_COLORS);

    // Split diseases into two groups: actual diseases and news
    const diseaseItems = allDiseases.filter(d => !NEWS_DISEASES.has(d));

    const badgeEl = document.getElementById('diseases-showing');

    // ---- NEWS TAB: render scrollable news article list ----
    if (state.diseaseTab === 'news') {
        const newsFeatures = getOutbreakViewModel().newsFeaturesSorted;

        if (newsFeatures.length === 0) {
            const emptyMsg = state.lang === 'ar' ? 'لا توجد أخبار حالياً' : 'No news articles currently';
            setElementHTML(container, `<div class="empty-state"><p>${emptyMsg}</p></div>`);
            setElementText(badgeEl, '0');
            return;
        }

        // Render news feed list (cap at 50 for performance)
        const capped = newsFeatures.slice(0, 50);
        const isAr = state.lang === 'ar';
        const normalizedItems = capped.map((f, index) => {
            const p = f.properties;
            const lng = f.geometry?.coordinates?.[0];
            const lat = f.geometry?.coordinates?.[1];
            const itemId = buildNewsItemId(p, index);
            const articleUrl = getPreferredArticleUrl(p);
            const articleHref = escapeHtml(articleUrl);
            const headline = isAr
                ? (p.short_description_ar || p.headline || '').slice(0, 120)
                : (p.headline || '').slice(0, 120);
            const source = p.source || '';
            const date = (p.publication_date || '').slice(0, 10);
            const flag = ccToFlag(p.country_code);
            const countryName = isAr ? (p.country_name_ar || p.country_name || '') : (p.country_name || '');
            const hasCoords = Number.isFinite(lng) && Number.isFinite(lat);
            const isActive = state.selectedNewsId === itemId;
            const html = `
                <div class="news-feed-item ${isActive ? 'active' : ''}" data-news-id="${itemId}" data-lng="${hasCoords ? lng : ''}" data-lat="${hasCoords ? lat : ''}">
                    <div class="news-feed-headline">${escapeHtml(headline || (isAr ? 'بدون عنوان' : 'Untitled'))}</div>
                    <div class="news-feed-meta">
                        <span class="nf-source">${escapeHtml(source)}</span>
                        ${date ? `<span>${escapeHtml(date)}</span>` : ''}
                        ${flag ? `<span class="nf-flag">${flag}</span>` : ''}
                        ${countryName ? `<span>${escapeHtml(countryName)}</span>` : ''}
                    </div>
                    ${isActive && articleHref ? `
                        <div class="news-feed-link-row">
                            <a class="source-link news-feed-link" href="${articleHref}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
                                ${escapeHtml(t('article_link'))}: ${articleHref}
                            </a>
                        </div>
                    ` : ''}
                </div>
            `;
            return { itemId, html };
        });

        const validIds = new Set(normalizedItems.map(item => item.itemId));
        if (state.selectedNewsId && !validIds.has(state.selectedNewsId)) {
            state.selectedNewsId = null;
        }

        setElementHTML(container, `<div class="news-feed-list">${normalizedItems.map(item => item.html).join('')}</div>`);

        // Badge: show total article count
        const articlesLabel = isAr ? 'مقال' : 'articles';
        setElementText(badgeEl, `${newsFeatures.length} ${articlesLabel}`);
        return;
    }

    // ---- DISEASES TAB: keep existing toggle pattern ----
    const visibleItems = diseaseItems;
    let enabledCount = 0;

    const diseaseListHtml = visibleItems.map(disease => {
        const enabled = state.diseasesEnabled[disease];
        if (enabled) enabledCount++;
        const count = diseaseCounts[disease] || 0;
        const color = DISEASE_COLORS_HEX[disease];
        const iconName = DISEASE_ICONS[disease];
        const name = state.lang === 'ar' ? (DISEASE_NAMES_AR[disease] || disease) : disease;

        // Determine CSS class based on selection state
        let itemClass = 'disease-item';
        if (state.selectedDisease) {
            // A disease is selected — highlight it, dim others
            if (disease === state.selectedDisease) {
                itemClass += ' selected';
            } else {
                itemClass += ' dimmed';
            }
        }

        // Use Iconify icon instead of colored dot
        const iconUrl = iconName ? getDiseaseIconUrl(disease, color) : '';
        const iconImg = iconName 
            ? `<img src="${escapeHtml(iconUrl)}" width="16" height="16" alt="${escapeHtml(disease)}" class="disease-icon" loading="lazy" />`
            : `<div class="disease-dot" style="background: ${color}"></div>`;

        return `
            <div class="${itemClass}" data-disease="${disease}" onclick="toggleDisease('${disease}')">
                ${iconImg}
                <span class="disease-name">${name}</span>
                <span class="disease-count">${count}</span>
            </div>
        `;
    }).join('');
    setElementHTML(container, diseaseListHtml);

    // Show empty state if no disease items exist
    if (visibleItems.length === 0) {
        const emptyMsg = state.lang === 'ar' ? 'لا توجد أمراض حالياً' : 'No diseases currently';
        setElementHTML(container, `<div class="empty-state"><p>${emptyMsg}</p></div>`);
    }

    setElementText(badgeEl, `${enabledCount}/${visibleItems.length}`);
}

function updateTicker() {
    const container = document.getElementById('ticker-content');
    if (!container) return;
    if (state.mapMode === 'travel') {
        const selectedHealth = getSelectedTravelHealthRiskLabel();
        const summary = state.selectedCountryCode
            ? `${state.selectedCountryCode} - ${getTravelRiskLabel(getTravelCountrySummary(state.selectedCountryCode)?.risk_code || 'unknown')} - ${selectedHealth}`
            : `${t('travel_tracked_countries')}: ${state.travelCountries.length} - ${selectedHealth}`;
        setElementHTML(container, `<span class="ticker-item" style="color: var(--text-secondary)">${escapeHtml(summary)}</span>`);
        return;
    }

    const alerts = getOutbreakViewModel().alerts;

    if (alerts.length === 0) {
        setElementHTML(container, `<span class="ticker-item" style="color: var(--text-muted)">${t('no_alerts')}</span>`);
        return;
    }

    const items = alerts.map(f => {
        const p = f.properties;
        const riskClass = getRiskClass(p) || 'unclassified';
        const riskLabel = getRiskDisplayText(riskClass, p.risk_assessment);
        const color = getRiskColor(riskClass);
        const headline = state.lang === 'ar' && p.short_description_ar
            ? p.short_description_ar.slice(0, 80)
            : (p.headline || '').slice(0, 80);
        return `
            <span class="ticker-item">
                <span class="ticker-priority" style="background: ${color}"></span>
                <strong>${riskLabel}:</strong> ${headline} &mdash; ${p.source}, ${p.publication_date?.slice(0, 10) || ''}
            </span>
            <span class="ticker-separator">&bull;</span>
        `;
    }).join('');

    // Duplicate for seamless scroll
    setElementHTML(container, items + items);
}

// ----- Country Brief Panel -----

function showCountryBrief(data) {
    const panel = document.getElementById('country-brief');
    const sidebar = document.getElementById('right-sidebar');
    if (!panel || !sidebar) return;

    if (!data) {
        panel.style.display = 'none';
        sidebar.classList.add('collapsed');
        return;
    }

    sidebar.classList.remove('collapsed');
    panel.style.display = 'block';

    const countryName = state.lang === 'ar' ? (data.country_name_ar || data.country_name) : data.country_name;

    setElementHTML(panel, `
        <div class="panel">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; min-width: 0; gap: 8px;">
                <div class="country-brief-header">
                    <div class="country-flag">${ccToFlag(data.country_code)}</div>
                    <div class="country-names">
                        <h3>${countryName}</h3>
                        ${state.lang !== 'ar' && data.country_name_ar ? `<div class="name-ar">${data.country_name_ar}</div>` : ''}
                        <div class="country-region">${t('who_region')}: ${data.who_region}</div>
                    </div>
                </div>
                <button class="close-btn" onclick="closeCountryBrief()" title="Close">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>

        <!-- Recent Findings -->
        ${data.findings?.length ? `
        <div class="panel">
            <div class="panel-title"><span>${t('recent_findings')}</span></div>
            <div class="finding-list">
                ${data.findings.slice(0, 8).map(f => {
                    const color = DISEASE_COLORS_HEX[f.disease] || '#64748b';
                    const articleUrl = getPreferredArticleUrl(f);
                    const currentRisk = getRiskClass(f) || 'unclassified';
                    const riskBadgeColor = getRiskColor(currentRisk);
                    const isNews = isNewsDiseaseName(f.disease);
                    const detailText = state.lang === 'ar'
                        ? (f.detailed_description_ar || f.short_description_ar || f.headline || '')
                        : (f.detailed_description_en || f.short_description_en || '');
                    const detailPreview = detailText.replace(/\s+/g, ' ').trim();
                    return `
                        <div class="finding-item">
                            <div class="finding-headline">
                                <span class="disease-chip-dot" style="background:${isNews ? color : riskBadgeColor}"></span>
                                <span class="finding-detail-text">${escapeHtml((detailPreview || 'No detailed description available.').slice(0, 320))}</span>
                            </div>
                            <div class="finding-meta">
                                <span>${f.source}</span>
                                <span>${f.publication_date?.slice(0, 10) || ''}</span>
                            </div>
                            ${articleUrl ? `
                                <div class="finding-link-row">
                                    <a class="source-link finding-link" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
                                        ${escapeHtml(t('article_link'))}: ${escapeHtml(articleUrl)}
                                    </a>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}
    `);
}

function setCountrySelection(countryCode, options = {}) {
    const { skipFly = false } = options;
    const code = countryCode ? String(countryCode).toUpperCase() : null;

    state.selectedCountryCode = code;
    state.activeRiskEditorId = null;

    if (code) {
        if (state.mapMode === 'travel') {
            if (!skipFly) void flyToTravelCountry(code);
            void loadTravelCountryDetail(code);
        } else {
            const brief = buildCountryBrief(code);
            showCountryBrief(brief);
            if (!skipFly) {
                const hit = (state.geoData?.features || []).find(f => f.properties?.country_code === code);
                if (hit?.geometry?.coordinates?.length >= 2) {
                    flyToFinding(hit.geometry.coordinates[0], hit.geometry.coordinates[1]);
                }
            }
        }
    } else {
        state.countryBrief = null;
        showCountryBrief(null);
    }

    syncCountrySearchValue();
    renderCountryAutocomplete();
    updateGlobeLayers();
    updateURL();
}

function clearCountrySelection() {
    setCountrySelection(null, { skipFly: true });
}

function closeCountryBrief() {
    clearCountrySelection();
}

function toggleFindingRiskEditor(findingId) {
    const id = String(findingId);
    state.activeRiskEditorId = state.activeRiskEditorId === id ? null : id;
    if (state.selectedCountryCode) {
        showCountryBrief(buildCountryBrief(state.selectedCountryCode));
    }
}

function toggleFindingRiskDetails(findingId, checked) {
    state.riskDetailsOpen[String(findingId)] = checked;
    const row = document.getElementById(`risk-assessment-row-${findingId}`);
    if (row) row.classList.toggle('hidden', !checked);
}

async function saveFindingRisk(findingId) {
    console.warn('Risk editing is disabled on the Cloudflare public frontend.', findingId);
}

// ----- User Interaction Handlers -----

function setTimeFilter(days) {
    if (state._refreshing) return; // Prevent overlapping requests
    state.days = days;
    state.dateCustom = false;
    state.dateFrom = '';
    state.dateTo = '';
    const timeFilterSelect = document.getElementById('time-filter-select');
    if (timeFilterSelect) timeFilterSelect.value = String(days);
    updateURL();
    refreshAllData();
}

function resetDateRange() {
    state.dateCustom = false;
    state.dateFrom = '';
    state.dateTo = '';
    syncDatePickerBounds();
    updateGlobeLayers();
    updateURL();
}

async function applyDateRangeFromInputs() {
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');
    if (!fromInput || !toInput) return;

    let from = extractDateString(fromInput.value || '');
    let to = extractDateString(toInput.value || '');

    if (state.days !== 9999 && !state._refreshing) {
        state.days = 9999;
        const timeFilterSelect = document.getElementById('time-filter-select');
        if (timeFilterSelect) timeFilterSelect.value = '9999';
        await refreshAllData();
    }

    if (!from) from = state.dateMin || '';
    if (!to) to = state.dateMax || '';
    if (from && to && from > to) {
        const tmp = from;
        from = to;
        to = tmp;
    }

    state.dateFrom = from;
    state.dateTo = to;
    state.dateCustom = true;

    fromInput.value = state.dateFrom;
    toInput.value = state.dateTo;

    updateGlobeLayers();
    updateURL();
}

function onCountryInputCommit() {
    const input = document.getElementById('country-search');
    if (!input) return;
    const code = resolveCountryCodeFromInput(input.value);
    updateCountrySearchAction();

    if (!input.value.trim()) {
        clearCountrySelection();
        renderCountryAutocomplete();
        return;
    }

    if (!code) {
        syncCountrySearchValue();
        renderCountryAutocomplete();
        return;
    }

    setCountrySelection(code);
    const countryPopover = document.getElementById('country-options');
    if (countryPopover) countryPopover.classList.remove('visible');
}

function flyToRegion(region) {
    state.region = region;
    // Reset country scope when changing region to avoid stale country filtering
    state.selectedCountryCode = null;
    state.countryBrief = null;
    showCountryBrief(null);
    syncCountrySearchValue();

    document.querySelectorAll('.region-btn').forEach(b => b.classList.toggle('active', b.dataset.region === region));
    const view = REGION_VIEWS[region] || REGION_VIEWS.global;
    if (state.deckgl) {
        state.deckgl.setProps({
            initialViewState: {
                ...view,
                transitionDuration: 1200,
                transitionInterpolator: new deck.FlyToInterpolator(),
            }
        });
    }

    updateCountryAutocomplete();
    updateGlobeLayers();
    updateURL();
}

function flyToFinding(lng, lat) {
    if (!state.deckgl || lng == null || lat == null) return;
    state.deckgl.setProps({
        initialViewState: {
            longitude: parseFloat(lng),
            latitude: parseFloat(lat),
            zoom: 5,
            transitionDuration: 1200,
            transitionInterpolator: new deck.FlyToInterpolator(),
        }
    });
}

function onNewsItemClick(itemId, lng, lat) {
    state.selectedNewsId = state.selectedNewsId === itemId ? null : itemId;
    updateDiseaseList();
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
        flyToFinding(lng, lat);
    }
}

function applyDiseaseMode(mode) {
    Object.keys(state.diseasesEnabled).forEach(d => {
        const isNews = NEWS_DISEASES.has(d);
        if (mode === 'news') {
            state.diseasesEnabled[d] = isNews;
        } else if (mode === 'outbreaks') {
            state.diseasesEnabled[d] = !isNews;
        } else {
            state.diseasesEnabled[d] = true;
        }
    });
}

function setDiseaseFilterMode(mode) {
    state.diseaseFilterMode = mode;
    state.selectedDisease = null;
    state.selectedNewsId = null;

    // Keep tab UI behavior while allowing an "all findings" mode from overview cards.
    if (mode === 'news') {
        state.diseaseTab = 'news';
    } else {
        state.diseaseTab = 'diseases';
    }

    document.querySelectorAll('.disease-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === state.diseaseTab);
    });

    applyDiseaseMode(mode);
    updateGlobeLayers();
    updateURL();
}

function setDiseaseTab(tab) {
    setDiseaseFilterMode(tab === 'news' ? 'news' : 'outbreaks');
}

function toggleDisease(disease) {
    state.diseaseFilterMode = 'outbreaks';
    state.diseaseTab = 'diseases';
    document.querySelectorAll('.disease-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === 'diseases');
    });

    if (state.selectedDisease === disease) {
        // Clicking selected disease again -> return to outbreaks-only mode
        state.selectedDisease = null;
        applyDiseaseMode('outbreaks');
    } else {
        // Solo mode for the selected disease
        state.selectedDisease = disease;
        Object.keys(state.diseasesEnabled).forEach(d => {
            state.diseasesEnabled[d] = (d === disease);
        });
    }
    updateGlobeLayers();
    updateURL();
}

function setRiskFilter(riskClass) {
    state.riskFilter = riskClass;
    document.querySelectorAll('.risk-item').forEach(el => {
        el.classList.toggle('active', el.dataset.risk === riskClass);
    });
    updateGlobeLayers();
    updateURL();
}

function setLanguage(lang) {
    state.lang = lang;
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    applyI18n();
    updateLegend();

    if (state.mapMode === 'travel') {
        travelCountriesCache.data = null;
        Object.keys(travelCountryDetailCache).forEach(key => delete travelCountryDetailCache[key]);
        travelHealthMatrixCache.data = null;
        state.travelCountryDetails = {};
        state.travelHealthRiskOptions = [];
        state.travelHealthRiskByCountry = {};
        state.travelHealthLoadError = '';
        if (state.selectedCountryCode) {
            showTravelCountryBriefPlaceholder(state.selectedCountryCode, t('travel_loading_detail'));
        }
        updateTravelOverview();
        updateTravelHealthPicker();
        updateTicker();
        updateURL();
        void refreshAllData();
        return;
    }

    updateOverviewStats();
    updateDiseaseList();
    updateTicker();
    if (state.countryBrief) showCountryBrief(state.countryBrief);
    updateURL();
}
