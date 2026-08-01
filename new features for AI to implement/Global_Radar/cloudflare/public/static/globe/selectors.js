function formatTimeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 10) return t('just_now');
    if (seconds < 60) return t('seconds_ago').replace('{n}', seconds);
    const minutes = Math.floor(seconds / 60);
    return t('minutes_ago').replace('{n}', minutes);
}

function getTodayDateString() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

function extractDateString(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    const tzOffset = parsed.getTimezoneOffset() * 60000;
    return new Date(parsed.getTime() - tzOffset).toISOString().slice(0, 10);
}

function dateInRange(publicationDate) {
    if (!state.dateCustom) return true;
    if (!state.dateFrom && !state.dateTo) return true;
    const d = extractDateString(publicationDate);
    if (!d) return false;
    if (state.dateFrom && d < state.dateFrom) return false;
    if (state.dateTo && d > state.dateTo) return false;
    return true;
}

function normalizeRegionCode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';

    if (raw.includes('afro') || raw.includes('africa')) return 'afro';
    if (raw.includes('amro') || raw.includes('america')) return 'amro';
    if (raw.includes('emro') || raw.includes('eastern mediterranean')) return 'emro';
    if (raw.includes('euro') || raw === 'eur' || raw.includes('europe')) return 'euro';
    if (raw.includes('searo') || raw.includes('south-east asia') || raw.includes('south east asia')) return 'searo';
    if (raw.includes('wpro') || raw.includes('western pacific')) return 'wpro';

    return raw;
}

function regionPasses(featureRegion, selectedRegion = state.region) {
    if (!selectedRegion || selectedRegion === 'global') return true;
    const featureCode = normalizeRegionCode(featureRegion);
    return featureCode === selectedRegion;
}

function updateOverviewGroupVisibility() {
    const outbreaksScopeGroup = document.getElementById('stats-group-outbreak-scope');
    const outbreaksRiskGroup = document.getElementById('stats-group-outbreak-risk');
    const newsOnly = state.diseaseFilterMode === 'news';

    if (outbreaksScopeGroup) outbreaksScopeGroup.classList.toggle('hidden', newsOnly);
    if (outbreaksRiskGroup) outbreaksRiskGroup.classList.toggle('hidden', newsOnly);
}

function syncDatePickerBounds() {
    const fromInput = document.getElementById('date-from');
    const toInput = document.getElementById('date-to');
    if (!fromInput || !toInput) return;

    const features = (state.geoData?.features || []).filter(feature => {
        const p = feature.properties || {};
        if (!regionPasses(p.region)) return false;
        if (!dateInRange(p.publication_date)) return false;
        return true;
    });
    const newsDates = features
        .filter(isNewsFinding)
        .map(f => extractDateString(f.properties?.publication_date))
        .filter(Boolean)
        .sort();

    const fallbackDates = features
        .map(f => extractDateString(f.properties?.publication_date))
        .filter(Boolean)
        .sort();

    const minDate = newsDates[0] || fallbackDates[0] || getTodayDateString();
    const maxDate = getTodayDateString();
    const availableDates = Array.from(new Set(fallbackDates)).sort((a, b) => b.localeCompare(a));

    state.dateMin = minDate;
    state.dateMax = maxDate;
    state.availableDates = availableDates;

    if (!state.dateFrom || !state.dateCustom) state.dateFrom = minDate;
    if (!state.dateTo || !state.dateCustom) state.dateTo = maxDate;

    if (state.dateFrom < minDate) state.dateFrom = minDate;
    if (state.dateFrom > maxDate) state.dateFrom = maxDate;
    if (state.dateTo < minDate) state.dateTo = minDate;
    if (state.dateTo > maxDate) state.dateTo = maxDate;
    if (state.dateFrom > state.dateTo) state.dateTo = state.dateFrom;

    fromInput.value = state.dateFrom;
    toInput.value = state.dateTo;

    renderDateOptions('date-from');
    renderDateOptions('date-to');
}

function getFilteredDateOptions(inputId) {
    const input = document.getElementById(inputId);
    const raw = String(input?.value || '').trim();
    const options = state.availableDates || [];
    if (!raw) return options.slice(0, 14);
    return options.filter(date => date.includes(raw)).slice(0, 14);
}

function renderDateOptions(inputId) {
    const popover = document.getElementById(`${inputId}-options`);
    if (!popover) return;
    const options = getFilteredDateOptions(inputId);
    if (!options.length) {
        popover.innerHTML = `<div class="control-empty">No matching dates</div>`;
        return;
    }
    popover.innerHTML = options.map(date => `
        <button class="control-option" type="button" data-date-target="${inputId}" data-date-value="${date}">${date}</button>
    `).join('');
}

function toggleDatePopover(inputId, visible) {
    const popover = document.getElementById(`${inputId}-options`);
    if (!popover) return;
    popover.classList.toggle('visible', visible);
    state.activeDatePopover = visible ? inputId : (state.activeDatePopover === inputId ? null : state.activeDatePopover);
}

function closeAllControlPopovers() {
    ['date-from', 'date-to'].forEach(id => toggleDatePopover(id, false));
    const countryPopover = document.getElementById('country-options');
    if (countryPopover) countryPopover.classList.remove('visible');
}

function applyDateOption(inputId, value) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value;
    toggleDatePopover(inputId, false);
    applyDateRangeFromInputs();
}

function getCountryDisplayName(meta) {
    if (!meta) return '';
    if (state.lang === 'ar') return meta.name_ar || meta.name_en || meta.code;
    return meta.name_en || meta.name_ar || meta.code;
}

function updateCountryAutocomplete() {
    const input = document.getElementById('country-search');
    const popover = document.getElementById('country-options');
    if (!input || !popover) return;

    if (state.mapMode === 'travel') {
        const byCode = {};
        for (const country of state.travelCountries || []) {
            const code = String(country.iso2 || '').toUpperCase();
            if (!code) continue;
            byCode[code] = {
                code,
                name_en: state.lang === 'ar' ? '' : (country.name || code),
                name_ar: state.lang === 'ar' ? (country.name || code) : '',
            };
        }

        state.countryMetaByCode = byCode;
        state.countryLabelToCode = {};

        const options = Object.values(byCode).sort((a, b) => {
            const an = getCountryDisplayName(a).toLowerCase();
            const bn = getCountryDisplayName(b).toLowerCase();
            return an.localeCompare(bn);
        });

        state.countryAutocompleteItems = options.map(meta => ({
            code: meta.code,
            label: `${getCountryDisplayName(meta)} (${meta.code})`,
            meta,
        }));

        options.forEach(meta => {
            const label = `${getCountryDisplayName(meta)} (${meta.code})`;
            state.countryLabelToCode[label.toLowerCase()] = meta.code;
            if (meta.name_en) state.countryLabelToCode[meta.name_en.toLowerCase()] = meta.code;
            if (meta.name_ar) state.countryLabelToCode[meta.name_ar.toLowerCase()] = meta.code;
        });

        renderCountryAutocomplete();
        syncCountrySearchValue();
        return;
    }

    const byCode = {};

    Object.entries(getCountryFeaturesByCode()).forEach(([code, countryFeatures]) => {
        const firstProperties = countryFeatures[0]?.properties || {};
        if (!code) return;
        byCode[code] = {
            code,
            name_en: firstProperties.country_name || '',
            name_ar: firstProperties.country_name_ar || '',
        };
    });

    state.countryMetaByCode = byCode;
    state.countryLabelToCode = {};

    const options = Object.values(byCode).sort((a, b) => {
        const an = getCountryDisplayName(a).toLowerCase();
        const bn = getCountryDisplayName(b).toLowerCase();
        return an.localeCompare(bn);
    });

    state.countryAutocompleteItems = options.map(meta => ({
        code: meta.code,
        label: `${getCountryDisplayName(meta)} (${meta.code})`,
        meta,
    }));

    options.forEach(meta => {
        const label = `${getCountryDisplayName(meta)} (${meta.code})`;
        state.countryLabelToCode[label.toLowerCase()] = meta.code;
        if (meta.name_en) state.countryLabelToCode[meta.name_en.toLowerCase()] = meta.code;
        if (meta.name_ar) state.countryLabelToCode[meta.name_ar.toLowerCase()] = meta.code;
    });

    renderCountryAutocomplete();
    syncCountrySearchValue();
}

function getFilteredCountryOptions() {
    const query = String(document.getElementById('country-search')?.value || '').trim().toLowerCase();
    const items = state.countryAutocompleteItems || [];
    if (!query) return items.slice(0, 10);
    return items.filter(item => {
        const label = item.label.toLowerCase();
        const en = String(item.meta?.name_en || '').toLowerCase();
        const ar = String(item.meta?.name_ar || '').toLowerCase();
        return label.includes(query) || en.includes(query) || ar.includes(query) || item.code.toLowerCase().includes(query);
    }).slice(0, 10);
}

function renderCountryAutocomplete() {
    const popover = document.getElementById('country-options');
    if (!popover) return;
    const options = getFilteredCountryOptions();
    if (!options.length) {
        setElementHTML(popover, `<div class="control-empty">No matching countries</div>`);
        return;
    }
    setElementHTML(popover, options.map(item => `
        <button class="control-option" type="button" data-country-code="${item.code}">
            <div>${escapeHtml(item.label)}</div>
            <div class="control-option-meta">${escapeHtml(item.code)}</div>
        </button>
    `).join(''));
}

function syncCountrySearchValue() {
    const input = document.getElementById('country-search');
    if (!input) return;
    if (!state.selectedCountryCode) {
        input.value = '';
        updateCountrySearchAction();
        return;
    }
    const meta = state.countryMetaByCode[state.selectedCountryCode];
    if (!meta) {
        input.value = state.selectedCountryCode;
        updateCountrySearchAction();
        return;
    }
    input.value = `${getCountryDisplayName(meta)} (${meta.code})`;
    updateCountrySearchAction();
}

function updateCountrySearchAction() {
    const input = document.getElementById('country-search');
    const actionBtn = document.getElementById('country-search-action');
    const container = document.getElementById('country-filter');
    if (!input || !actionBtn || !container) return;

    const hasValue = Boolean(input.value.trim()) || Boolean(state.selectedCountryCode);
    container.classList.toggle('has-value', hasValue);
    actionBtn.title = hasValue ? t('country_clear') : t('country_search_placeholder');
}

function handleCountrySearchAction() {
    const input = document.getElementById('country-search');
    const hasValue = Boolean(input?.value.trim()) || Boolean(state.selectedCountryCode);
    if (!hasValue) return;
    clearCountrySelection();
    renderCountryAutocomplete();
}

function resolveCountryCodeFromInput(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    const mapped = state.countryLabelToCode[value.toLowerCase()];
    if (mapped) return mapped;

    const m = value.match(/\(([a-zA-Z]{2})\)\s*$/);
    if (m) return m[1].toUpperCase();

    if (/^[a-zA-Z]{2}$/.test(value)) return value.toUpperCase();
    return null;
}

function isNewsDiseaseName(diseaseName) {
    return NEWS_DISEASES.has(diseaseName || '');
}

function isNewsFinding(feature) {
    return isNewsDiseaseName(feature?.properties?.disease);
}

function getRiskAssessmentText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        for (const item of value) {
            const extracted = getRiskAssessmentText(item);
            if (extracted) return extracted;
        }
        return '';
    }
    if (typeof value === 'object') {
        for (const key of ['risk_assessment', 'assessment', 'risk_level', 'level', 'name', 'title', 'label', 'value', 'status']) {
            const extracted = getRiskAssessmentText(value[key]);
            if (extracted) return extracted;
        }
        return '';
    }
    return String(value).trim();
}

function normalizeRiskClass(value) {
    if (value == null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;

    if (['critical', 'very high', 'severe'].includes(normalized)) return 'critical';
    if (['high'].includes(normalized)) return 'high';
    if (['medium', 'moderate', 'moderate risk'].includes(normalized)) return 'medium';
    if (['low', 'low risk'].includes(normalized)) return 'low';
    if (['no risk', 'none', 'minimal', 'no_risk', 'no-risk'].includes(normalized)) return 'no_risk';
    if (['unclassified', 'unknown', 'not assessed', 'pending'].includes(normalized)) return 'unclassified';

    return null;
}

function getRiskClassFromAssessmentText(text) {
    const raw = getRiskAssessmentText(text);
    if (!raw) return null;
    const directMatch = normalizeRiskClass(raw);
    if (directMatch) return directMatch;
    const value = raw.toLowerCase();
    if (value.includes('no risk') || value.includes('minimal risk')) return 'no_risk';
    if (value.includes('unclassified risk')) return 'unclassified';
    if (value.includes('critical risk') || value.includes('very high risk')) return 'critical';
    if (value.includes('high risk')) return 'high';
    if (value.includes('moderate risk') || value.includes('medium risk')) return 'medium';
    if (value.includes('low risk')) return 'low';
    return null;
}

function getRiskClass(properties) {
    if (!properties || isNewsDiseaseName(properties.disease)) return null;

    const assessment = getRiskAssessmentText(properties.risk_assessment);
    if (assessment) return getRiskClassFromAssessmentText(assessment) || 'unclassified';

    const explicit = normalizeRiskClass(properties.risk || properties.priority);
    if (explicit) return explicit;

    return 'unclassified';
}

function getCountryFillRiskClass(properties) {
    if (!properties) return null;
    const assessmentRisk = getRiskClassFromAssessmentText(properties.risk_assessment);
    if (assessmentRisk) return assessmentRisk;
    if (isNewsDiseaseName(properties.disease)) return null;
    return normalizeRiskClass(properties.risk || properties.priority) || 'unclassified';
}

function getOutbreakCountryRiskColor(riskClass) {
    return OUTBREAK_COUNTRY_RISK_COLORS[riskClass] || 'rgba(0,0,0,0)';
}

function getRiskLabel(riskClass) {
    if (riskClass === 'no_risk') return t('risk_no_risk');
    return t(`risk_${riskClass || 'unclassified'}`);
}

function getRiskAssessmentSuffix(text, riskClass) {
    const raw = String(text || '').trim();
    if (!raw) return '';

    const patterns = [
        /^critical risk\.?\s*/i,
        /^high risk\.?\s*/i,
        /^(medium|moderate) risk\.?\s*/i,
        /^low risk\.?\s*/i,
        /^no risk\.?\s*/i,
        /^unclassified risk\.?\s*/i,
    ];

    let cleaned = raw;
    patterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    cleaned = cleaned.trim().replace(/^[-:;,.\s]+/, '').trim();
    if (!cleaned) return '';
    return cleaned;
}

function getRiskDisplayText(riskClass, assessment) {
    const label = getRiskLabel(riskClass);
    const suffix = getRiskAssessmentSuffix(assessment, riskClass);
    return suffix ? `${label} (${suffix})` : label;
}

function buildRiskOptions(selectedRisk) {
    return RISK_EDIT_OPTIONS.map(riskValue => `
        <option value="${riskValue}" ${riskValue === selectedRisk ? 'selected' : ''}>${escapeHtml(getRiskLabel(riskValue))}</option>
    `).join('');
}

function riskPasses(feature) {
    if (state.riskFilter === 'all') return true;
    if (isNewsFinding(feature)) return true; // risk filter applies to outbreaks only
    return getRiskClass(feature.properties) === state.riskFilter;
}

function getDiseaseFilterStateKey() {
    return Object.keys(state.diseasesEnabled)
        .sort((a, b) => a.localeCompare(b))
        .map(disease => `${disease}:${state.diseasesEnabled[disease] === false ? 0 : 1}`)
        .join('|');
}

function getFilteredFeatureCacheKey(options = {}) {
    const {
        ignoreRiskFilter = false,
        ignoreCountryFilter = false,
    } = options;
    return [
        state.geoDataVersion || 0,
        state.region || 'global',
        state.days,
        state.dateCustom ? 1 : 0,
        state.dateFrom || '',
        state.dateTo || '',
        ignoreCountryFilter ? '' : (state.selectedCountryCode || ''),
        ignoreRiskFilter ? 'all' : state.riskFilter,
        getDiseaseFilterStateKey(),
    ].join('::');
}

function getFilteredFeatures(options = {}) {
    const {
        ignoreRiskFilter = false,
        ignoreCountryFilter = false,
    } = options;

    if (!state.geoData?.features) return [];
    const cacheKey = getFilteredFeatureCacheKey(options);
    if (selectorCache.filteredFeatures.has(cacheKey)) {
        return selectorCache.filteredFeatures.get(cacheKey);
    }

    const filtered = state.geoData.features.filter(f => {
        const p = f.properties;
        if (!dateInRange(p.publication_date)) return false;
        if (!regionPasses(p.region)) return false;
        if (state.diseasesEnabled[p.disease] === false) return false;
        if (!ignoreCountryFilter && state.selectedCountryCode && p.country_code !== state.selectedCountryCode) return false;
        if (!ignoreRiskFilter && !riskPasses(f)) return false;
        return true;
    });

    selectorCache.filteredFeatures.set(cacheKey, filtered);
    trimCacheMap(selectorCache.filteredFeatures);
    return filtered;
}

function getOutbreakViewModel() {
    const cacheKey = `${getFilteredFeatureCacheKey()}::outbreak-view`;
    if (selectorCache.outbreakViewKey === cacheKey && selectorCache.outbreakView) {
        return selectorCache.outbreakView;
    }

    const visibleFeatures = getFilteredFeatures();
    const visibleNews = [];
    const visibleOutbreaks = [];
    const outbreakDiseases = new Set();
    const outbreakCountries = new Set();
    const visibleRiskCounts = {
        unclassified: 0,
        no_risk: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
    };
    const outbreakCountryRiskByCode = {};
    const countryFindingCounts = {};
    const countryMap = {};
    const alerts = [];

    const getRepresentativeScore = (feature) => {
        if (isNewsFinding(feature)) return -1;
        const rc = getRiskClass(feature.properties) || 'unclassified';
        return RISK_CLASS_ORDER[rc] ?? 0;
    };

    for (const feature of visibleFeatures) {
        const properties = feature.properties || {};
        const countCode = String(properties.country_code || properties.id || '').trim().toUpperCase();
        if (countCode) {
            countryFindingCounts[countCode] = (countryFindingCounts[countCode] || 0) + 1;
        }

        const markerCode = properties.country_code || properties.id;
        if (markerCode) {
            if (!countryMap[markerCode]) {
                countryMap[markerCode] = { feature, count: 1 };
            } else {
                countryMap[markerCode].count++;
                const current = getRepresentativeScore(countryMap[markerCode].feature);
                const next = getRepresentativeScore(feature);
                if (next > current) countryMap[markerCode].feature = feature;
            }
        }

        if (isNewsFinding(feature)) {
            visibleNews.push(feature);
            continue;
        }

        visibleOutbreaks.push(feature);
        const riskClass = getRiskClass(properties) || 'unclassified';

        if (properties.disease) outbreakDiseases.add(properties.disease);
        if (properties.country_code) outbreakCountries.add(properties.country_code);
        visibleRiskCounts[riskClass] = (visibleRiskCounts[riskClass] || 0) + 1;

        if (riskClass === 'critical' || riskClass === 'high') {
            alerts.push(feature);
        }

        const code = String(properties.country_code || properties.id || '').trim().toUpperCase();
        if (code) {
            const fillRiskClass = getCountryFillRiskClass(properties);
            if (fillRiskClass) {
                const current = outbreakCountryRiskByCode[code];
                if (!current || (RISK_CLASS_ORDER[fillRiskClass] ?? -1) > (RISK_CLASS_ORDER[current] ?? -1)) {
                    outbreakCountryRiskByCode[code] = fillRiskClass;
                }
            }
        }
    }

    const outbreakScopeNoRiskFilter = getFilteredFeatures({ ignoreRiskFilter: true })
        .filter(feature => !isNewsFinding(feature));
    const panelRiskCounts = {
        unclassified: 0,
        no_risk: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
    };
    for (const feature of outbreakScopeNoRiskFilter) {
        const riskClass = getRiskClass(feature.properties) || 'unclassified';
        panelRiskCounts[riskClass] = (panelRiskCounts[riskClass] || 0) + 1;
    }

    const dots = Object.values(countryMap).map(({ feature, count }) => ({
        ...feature,
        _count: count,
        _riskClass: isNewsFinding(feature) ? 'news' : (getRiskClass(feature.properties) || 'unclassified'),
        _riskColor: isNewsFinding(feature)
            ? RISK_COLORS.news
            : getRiskColor(getRiskClass(feature.properties) || 'unclassified'),
    }));

    const newsFeaturesSorted = visibleNews.slice().sort((a, b) => {
        const da = a.properties?.publication_date || '';
        const db = b.properties?.publication_date || '';
        return db.localeCompare(da);
    });

    const viewModel = {
        visibleFeatures,
        visibleNews,
        visibleOutbreaks,
        outbreakDiseases,
        outbreakCountries,
        visibleRiskCounts,
        outbreakScopeNoRiskFilter,
        panelRiskCounts,
        outbreakCountryRiskByCode,
        countryFindingCounts,
        dots,
        alerts: alerts.slice(0, 20),
        newsFeaturesSorted,
    };

    selectorCache.outbreakViewKey = cacheKey;
    selectorCache.outbreakView = viewModel;
    return viewModel;
}

function getCountryFeaturesByCode() {
    if (selectorCache.countryFeaturesByCodeKey === state.geoDataVersion && selectorCache.countryFeaturesByCode) {
        return selectorCache.countryFeaturesByCode;
    }

    const grouped = {};
    for (const feature of state.geoData?.features || []) {
        const code = String(feature.properties?.country_code || '').trim().toUpperCase();
        if (!code) continue;
        if (!grouped[code]) grouped[code] = [];
        grouped[code].push(feature);
    }

    Object.values(grouped).forEach(countryFeatures => {
        countryFeatures.sort((a, b) => (b.properties?.publication_date || '').localeCompare(a.properties?.publication_date || ''));
    });

    selectorCache.countryFeaturesByCodeKey = state.geoDataVersion;
    selectorCache.countryFeaturesByCode = grouped;
    selectorCache.countryBriefs.clear();
    return grouped;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeExternalUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.toString();
        }
    } catch (_) {
        return '';
    }
    return '';
}

function getPreferredArticleUrl(properties) {
    return sanitizeExternalUrl(properties?.url) || sanitizeExternalUrl(properties?.source_link);
}

function buildNewsItemId(properties, index) {
    const raw = properties?.id ?? `${properties?.source || 'news'}-${properties?.publication_date || 'date'}-${index}`;
    return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// ----- URL State Management -----

function readURLState() {
    state.mapMode = 'outbreaks';
    const params = new URLSearchParams(window.location.search);
    if (params.has('days')) state.days = parseInt(params.get('days')) || 30;
    if (params.has('lang')) state.lang = params.get('lang') === 'ar' ? 'ar' : 'en';
    if (params.has('region')) state.region = String(params.get('region') || 'global').toLowerCase();
    if (params.has('risk')) {
        state.riskFilter = normalizeRiskClass(params.get('risk')) || 'all';
    } else if (params.has('priority')) {
        // Backward compatibility with old URL param name
        state.riskFilter = normalizeRiskClass(params.get('priority')) || 'all';
    }
    if (params.has('country')) state.selectedCountryCode = (params.get('country') || '').toUpperCase() || null;
    if (params.has('from') || params.has('to')) {
        state.dateFrom = extractDateString(params.get('from') || '');
        state.dateTo = extractDateString(params.get('to') || '');
        state.dateCustom = Boolean(state.dateFrom || state.dateTo);
        if (state.dateCustom) state.days = 9999;
    }
    if (params.has('selected')) {
        // A single disease is selected/focused
        const selected = params.get('selected');
        if (DISEASE_COLORS[selected]) {
            state.selectedDisease = selected;
            state.diseaseFilterMode = isNewsDiseaseName(selected) ? 'news' : 'outbreaks';
            state.diseaseTab = isNewsDiseaseName(selected) ? 'news' : 'diseases';
            Object.keys(state.diseasesEnabled).forEach(d => {
                state.diseasesEnabled[d] = (d === selected);
            });
        }
    } else if (params.has('disease')) {
        // Legacy: if disease param present, only enable those diseases
        const enabledList = params.get('disease').split(',');
        Object.keys(state.diseasesEnabled).forEach(d => {
            state.diseasesEnabled[d] = enabledList.includes(d);
        });
        const hasNewsEnabled = enabledList.some(name => isNewsDiseaseName(name));
        const hasOutbreakEnabled = enabledList.some(name => !isNewsDiseaseName(name));
        if (hasNewsEnabled && hasOutbreakEnabled) {
            state.diseaseFilterMode = 'all';
            state.diseaseTab = 'diseases';
        } else if (hasNewsEnabled) {
            state.diseaseFilterMode = 'news';
            state.diseaseTab = 'news';
        } else {
            state.diseaseFilterMode = 'outbreaks';
            state.diseaseTab = 'diseases';
        }
    }
}

function updateURL() {
    const params = new URLSearchParams();
    if (state.mapMode === 'outbreaks' && state.days !== 9999) params.set('days', state.days);
    if (state.lang !== 'en') params.set('lang', state.lang);
    if (state.region !== 'global') params.set('region', state.region);
    if (state.mapMode === 'outbreaks' && state.riskFilter !== 'all') params.set('risk', state.riskFilter);
    if (state.selectedCountryCode) params.set('country', state.selectedCountryCode);
    if (state.mapMode === 'outbreaks' && state.dateCustom) {
        if (state.dateFrom) params.set('from', state.dateFrom);
        if (state.dateTo) params.set('to', state.dateTo);
    }
    // Encode selected disease (solo mode)
    if (state.mapMode === 'outbreaks' && state.selectedDisease) {
        params.set('selected', state.selectedDisease);
    }
    const qs = params.toString();
    const url = '/map/outbreaks' + (qs ? '?' + qs : '');
    history.replaceState(null, '', url);
}
