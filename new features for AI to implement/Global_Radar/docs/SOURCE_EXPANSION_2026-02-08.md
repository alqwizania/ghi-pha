# SehaRadar v1.0 - Source Expansion Summary

**Date**: 2026-02-08  
**Operation**: Added 20 new global surveillance sources  
**Status**: ✅ Complete

---

## Summary

Successfully expanded SehaRadar surveillance coverage from **8 sources** to **29 sources** (28 active).

### New Coverage

- **Regions**: Global, USA, Europe, Asia-Pacific, Middle East, Australia, Canada
- **Diseases**: COVID-19, Influenza, MERS, Mpox, Marburg, Cholera, Measles, H5N1, Dengue, Ebola
- **Source Types**: 26 ChangeDetection.io watches, 2 RSS feeds, 1 Google Search

---

## Sources Added

### 🌍 Regional Surveillance (16 sources)

1. **ECDC_CDTR** - ECDC Communicable Disease Threats Report (Weekly)
   - URL: https://www.ecdc.europa.eu/en/publications-data/communicable-disease-threats-report-24-30-january-2026-week-5
   - Check: Weekly (604800s)
   - UUID: `e70d9414-f1cf-494e-bfba-6f022e9488bf`

2. **WHO_COVID_SITREP** - WHO COVID-19 Situation Reports
   - URL: https://www.who.int/emergencies/diseases/novel-coronavirus-2019/situation-reports
   - Check: Daily (86400s)
   - UUID: `ca9badf7-a92d-418e-a4d3-18a3d9b599b4`

3. **WHO_COVID_DASHBOARD** - WHO COVID-19 Global Data Dashboard
   - URL: https://data.who.int/dashboards/covid19/cases
   - Check: Daily (86400s)
   - UUID: `3e633331-8a48-4ada-80c7-92927a44f351`

4. **WHO_RESPIRATORY** - WHO Global Influenza Programme Surveillance
   - URL: https://www.who.int/teams/global-influenza-programme/surveillance-and-monitoring/respiratory-viruses
   - Check: Weekly (604800s)
   - UUID: `94b2c05b-5f39-451f-bb9c-6e8a266fce48`

5. **WHO_VARIANTS** - WHO SARS-CoV-2 Variants Tracking
   - URL: https://www.who.int/activities/tracking-SARS-CoV-2-variants
   - Check: Weekly (604800s)
   - UUID: `35bd3c60-903c-4f2c-a95a-2d2d4337582f`

6. **WHO_EMRO_MERS** - WHO EMRO MERS Outbreaks (High Priority)
   - URL: https://www.emro.who.int/health-topics/mers-cov/mers-outbreaks.html
   - Check: Daily (86400s)
   - UUID: `091d2941-9115-4fa6-aa74-bb86f51c2f38`

7. **CDC_COVID_SURVEILLANCE** - CDC COVID-19 Surveillance (USA)
   - URL: https://www.cdc.gov/covid/php/surveillance/index.html
   - Check: Daily (86400s)
   - UUID: `90e58e0b-7e2f-4fd5-b1e4-34ac2e5d736d`

8. **CDC_FLUVIEW** - CDC FluView Influenza Surveillance (USA)
   - URL: https://www.cdc.gov/fluview/index.html
   - Check: Weekly (604800s)
   - UUID: `052f6873-c706-4687-9a25-e6a4a6f16a9a`

9. **CDC_AUSTRALIA** - Australia CDC Respiratory Surveillance
   - URL: https://www.cdc.gov.au/resources/collections/australian-respiratory-surveillance-reports?language=en
   - Check: Weekly (604800s)
   - UUID: `780c5f46-71df-4e7c-acad-8bc306315208`

10. **CHINA_CDC** - China CDC Disease Data
    - URL: https://www.chinacdc.cn/jksj/xgbdyq/
    - Check: Daily (86400s)
    - UUID: `b14df63f-e575-4a91-9087-4e99a1f592a3`

11. **ITALY_HEALTH** - Italy Ministry of Health COVID-19 Weekly Reports
    - URL: https://www.salute.gov.it/new/it/tema/covid-19/report-settimanali-covid-19/
    - Check: Weekly (604800s)
    - UUID: `6f274bb7-3137-46d8-b6e9-5d44e6cf434c`

12. **HONG_KONG_CHP** - Hong Kong Centre for Health Protection
    - URL: https://www.chp.gov.hk/en/index.html
    - Check: Daily (86400s)
    - UUID: `cf00e9e1-795d-4510-9ee5-b3dd80aea245`

13. **UK_UKHSA** - UK Health Security Agency Dashboard
    - URL: https://ukhsa-dashboard.data.gov.uk/
    - Check: Daily (86400s)
    - UUID: `f887a989-e735-4b1e-9d14-1f946bf10ec6`

14. **GERMANY_RKI** - Germany RKI Influenza Weekly Reports
    - URL: https://influenza.rki.de/Wochenberichte.aspx
    - Check: Weekly (604800s)
    - UUID: `6c14c7ea-d773-4bd5-b85c-9cb7d298dddd`

15. **JAPAN_MHLW** - Japan Ministry of Health Infectious Disease Data
    - URL: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000121431_00485.html
    - Check: Daily (86400s)
    - UUID: `aadd89c5-c83d-476b-a7cd-96b20ae41854`

16. **CANADA_HEALTH** - Canada Health Infobase Respiratory Virus Surveillance
    - URL: https://health-infobase.canada.ca/respiratory-virus-surveillance/?source=rvdss
    - Check: Weekly (604800s)
    - UUID: `41b35ab4-a832-409b-a723-640a1b481162`

### 📰 News Aggregators (4 sources)

17. **NEWS_MEDICAL_COVID** - News-Medical.net COVID-19 News
    - URL: https://www.news-medical.net/condition/Coronavirus-Disease-COVID-19
    - Check: 12 hours (43200s)
    - UUID: `2ca9e106-ef4d-450e-a389-527dd91e73ff`

18. **REUTERS_COVID** - Reuters COVID-19 Search (24h)
    - URL: https://www.reuters.com/site-search/?query=covid&date=past_24_hours
    - Check: 12 hours (43200s)
    - UUID: `d1b07905-e4c2-41ca-955d-af2803f98555`

19. **REUTERS_FLU** - Reuters Flu Search (24h)
    - URL: https://www.reuters.com/site-search/?query=flu&date=past_24_hours&offset=0
    - Check: 12 hours (43200s)
    - UUID: `5daf5d30-a6e1-4fcc-9c60-e332d4b4c9bb`

20. **CIDRAP** - Center for Infectious Disease Research and Policy
    - URL: https://www.cidrap.umn.edu/
    - Check: 6 hours (21600s)
    - UUID: `18aad26e-cbdb-46e4-aee3-b7e38f8a9df0`

---

## Configuration Files Updated

1. **`/srv/docker/SehaRadar/config/sources.json`**
   - Version: 2.0
   - Total sources: 29
   - Active sources: 28
   - Metadata: Updated with region and disease coverage

2. **ChangeDetection.io**
   - Total watches: 26 (25 active surveillance + 1 test)
   - Tag: `health-surveillance` (`37342b3f-4f96-4a74-a166-3de7e070b885`)
   - All watches successfully created and operational

---

## Scripts Created

1. **`scripts/add_new_sources.sh`**
   - Batch creates ChangeDetection.io watches
   - Maps titles to UUIDs
   - Outputs to `/tmp/seharadar_new_watches.txt`

2. **`scripts/update_source_uuids.py`**
   - Reads watch UUIDs from mapping file
   - Updates `config/sources.json` with actual UUIDs
   - Validates all sources have valid UUIDs

---

## Deployment

✅ **Docker image rebuilt** with new configuration  
✅ **Service restarted** and operational  
✅ **All 28 sources loaded** successfully  
✅ **ChangeDetection.io watches active** and checking  

### Verification Commands

```bash
# Check loaded sources
docker exec seha-radar python3 -c "
from health_agents.shared.source_registry import source_registry
print(f'Total: {len(source_registry.list_all())}')
"

# Check service status
curl http://localhost:8080/status

# View logs
docker logs seha-radar --tail 50

# List ChangeDetection watches
curl -s "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" | \
  jq -r 'to_entries[] | .value.title'
```

---

## Next Steps

### Immediate
- [ ] Configure OPENAI_API_KEY in `/srv/docker/SehaRadar/.env` to enable AI analysis
- [ ] Monitor logs for first 24 hours to ensure all sources are accessible
- [ ] Review findings from new sources in NocoDB

### Short-term (1 week)
- [ ] Adjust check intervals based on actual update patterns
- [ ] Add region-specific filters for higher relevance
- [ ] Configure webhooks for high-priority sources (WHO_EMRO_MERS)

### Long-term (1 month)
- [ ] Add more regional sources (Africa CDC, Asia-Pacific)
- [ ] Implement source-specific parsers for structured data
- [ ] Create source performance dashboard

---

## Coverage Map

| Region | Sources | Diseases Covered |
|--------|---------|------------------|
| **Global** | 5 | All diseases (WHO, CDC, PROMED, ECDC, CIDRAP) |
| **North America** | 3 | COVID-19, Influenza (CDC USA, Canada) |
| **Europe** | 4 | COVID-19, Influenza (ECDC, UK, Germany, Italy) |
| **Asia-Pacific** | 4 | All diseases (China, Hong Kong, Japan, Australia) |
| **Middle East** | 1 | MERS (WHO EMRO) |

---

## Technical Details

### Source Registry Architecture

- **Singleton pattern** ensures single source of truth
- **Dynamic loading** from `config/sources.json`
- **Type-safe** with Pydantic models
- **Backward compatible** with legacy configs

### ChangeDetection.io Integration

- **API-driven** watch creation and management
- **Tagged grouping** for organizational clarity
- **Configurable intervals** from minutes to weeks
- **Webhook support** for real-time notifications

### Docker Build Process

```bash
# Configuration baked into image (not mounted)
COPY config/ ./config/

# Rebuild required after config changes
docker compose down && docker compose up -d --build
```

---

**Completed by**: DarDab (SehaRadar Health Surveillance Agent)  
**Date**: 2026-02-08 15:30 UTC  
**Status**: ✅ Operational
