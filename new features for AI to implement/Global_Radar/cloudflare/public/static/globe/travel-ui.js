function updateTravelOverview() {
    const panel = document.getElementById('travel-overview-panel');
    if (!panel) return;

    if (state.mapMode !== 'travel') {
        setElementHTML(panel, '');
        return;
    }

    const counts = { green: 0, yellow: 0, red: 0, unknown: 0 };
    for (const country of state.travelCountries || []) {
        const riskCode = normalizeTravelRiskCode(country.risk_code);
        counts[riskCode] = (counts[riskCode] || 0) + 1;
    }

    setElementHTML(panel, `
        <div class="panel-title">
            <span>${escapeHtml(t('travel_overview'))}</span>
            <span class="badge">${state.travelCountries.length}</span>
        </div>
        <div class="stats-grid cols-3">
            <div class="stat-item"><div class="stat-value" style="color:${TRAVEL_RISK_COLORS.green}">${counts.green}</div><div class="stat-label">${escapeHtml(t('travel_risk_green'))}</div></div>
            <div class="stat-item"><div class="stat-value" style="color:${TRAVEL_RISK_COLORS.yellow}">${counts.yellow}</div><div class="stat-label">${escapeHtml(t('travel_risk_yellow'))}</div></div>
            <div class="stat-item"><div class="stat-value" style="color:${TRAVEL_RISK_COLORS.red}">${counts.red}</div><div class="stat-label">${escapeHtml(t('travel_risk_red'))}</div></div>
        </div>
        <div class="empty-state" style="padding-bottom:0;">
            <p>${escapeHtml(t('travel_click_country'))}</p>
        </div>
    `);
}

function showTravelCountryBriefPlaceholder(countryCode, message) {
    const summary = getTravelCountrySummary(countryCode);
    const panel = document.getElementById('country-brief');
    const sidebar = document.getElementById('right-sidebar');
    if (!panel || !sidebar) return;

    sidebar.classList.remove('collapsed');
    panel.style.display = 'block';
    setElementHTML(panel, `
        <div class="panel">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; min-width:0; gap:8px;">
                <div class="country-brief-header">
                    <div class="country-flag">${ccToFlag(countryCode)}</div>
                    <div class="country-names">
                        <h3>${escapeHtml(summary?.name || countryCode)}</h3>
                        <div class="country-region">${escapeHtml(getTravelRiskLabel(summary?.risk_code || 'unknown'))}</div>
                    </div>
                </div>
                <button class="close-btn" onclick="closeCountryBrief()" title="Close">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="empty-state"><p>${escapeHtml(message)}</p></div>
        </div>
    `);
}

function showTravelCountryBrief(detail) {
    const panel = document.getElementById('country-brief');
    const sidebar = document.getElementById('right-sidebar');
    if (!panel || !sidebar) return;

    if (!detail) {
        panel.style.display = 'none';
        sidebar.classList.add('collapsed');
        return;
    }

    sidebar.classList.remove('collapsed');
    panel.style.display = 'block';

    const riskCode = normalizeTravelRiskCode(detail.risk_code);
    const whyItems = Array.isArray(detail.why) ? detail.why : [];
    const measures = Array.isArray(detail.measures) ? detail.measures : [];
    const reviewItems = [];
    if (detail.last_reviewed_at) reviewItems.push(`${t('travel_last_reviewed')}: ${formatDate(detail.last_reviewed_at)}`);
    if (detail.next_review_at) reviewItems.push(`${t('travel_next_review')}: ${formatDate(detail.next_review_at)}`);
    if (detail.updated_by) reviewItems.push(`${t('travel_updated_by')}: ${detail.updated_by}`);

    setElementHTML(panel, `
        <div class="panel">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; min-width:0; gap:8px;">
                <div class="country-brief-header">
                    <div class="country-flag">${ccToFlag(detail.iso2)}</div>
                    <div class="country-names">
                        <h3>${escapeHtml(detail.name)}</h3>
                        <div class="country-region">${escapeHtml(getTravelRiskLabel(riskCode))}</div>
                    </div>
                </div>
                <button class="close-btn" onclick="closeCountryBrief()" title="Close">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="finding-list">
                <div class="finding-item">
                    <div class="finding-headline"><span class="disease-chip-dot" style="background:${getTravelRiskColor(riskCode, detail.color)}"></span><span class="finding-detail-text">${escapeHtml(detail.level_label || getTravelRiskLabel(riskCode))}</span></div>
                    <div class="finding-meta"><span>${escapeHtml(t('travel_level_meaning'))}</span></div>
                    <div class="finding-detail-text" style="padding-left:12px; margin-top:4px; font-size:0.72rem; color:var(--text-secondary);">${escapeHtml(detail.level_meaning || t('travel_no_advisory'))}</div>
                </div>
                <div class="finding-item">
                    <div class="panel-title" style="margin-bottom:6px;"><span>${escapeHtml(t('travel_why'))}</span></div>
                    <div class="finding-detail-text" style="font-size:0.72rem; color:var(--text-secondary); margin-bottom:6px;">${escapeHtml(detail.why_summary || t('travel_no_advisory'))}</div>
                    ${whyItems.length ? `<div class="finding-meta">${whyItems.map(item => `<span>${escapeHtml(item.name || item.slug || item.id || '')}</span>`).join('')}</div>` : ''}
                </div>
                <div class="finding-item">
                    <div class="panel-title" style="margin-bottom:6px;"><span>${escapeHtml(t('travel_measures'))}</span></div>
                    ${measures.length
                        ? `<div class="finding-list">${measures.map(item => `<div class="finding-detail-text" style="font-size:0.72rem; color:var(--text-secondary);">- ${escapeHtml(item.text || '')}</div>`).join('')}</div>`
                        : `<div class="finding-detail-text" style="font-size:0.72rem; color:var(--text-secondary);">${escapeHtml(t('travel_no_measures'))}</div>`}
                </div>
                <div class="finding-item">
                    <div class="panel-title" style="margin-bottom:6px;"><span>${escapeHtml(t('travel_review'))}</span></div>
                    ${reviewItems.length
                        ? `<div class="finding-list">${reviewItems.map(item => `<div class="finding-detail-text" style="font-size:0.72rem; color:var(--text-secondary);">${escapeHtml(item)}</div>`).join('')}</div>`
                        : `<div class="finding-detail-text" style="font-size:0.72rem; color:var(--text-secondary);">${escapeHtml(t('travel_no_advisory'))}</div>`}
                </div>
            </div>
        </div>
    `);
}

async function loadTravelCountryDetail(countryCode, forceRefresh = false) {
    const code = String(countryCode || '').toUpperCase();
    if (!code) return;
    const requestToken = ++state.travelDetailRequestToken;
    showTravelCountryBriefPlaceholder(code, t('travel_loading_detail'));

    const detail = await fetchTravelCountryDetail(code, forceRefresh);
    if (requestToken !== state.travelDetailRequestToken || state.selectedCountryCode !== code || state.mapMode !== 'travel') {
        return;
    }

    if (!detail) {
        showTravelCountryBriefPlaceholder(code, t('travel_no_advisory'));
        return;
    }

    showTravelCountryBrief(detail);
}

