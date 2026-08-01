# SehaRadar Quick Reference - New Sources

## 🚀 Quick Start

### Check System Status
```bash
# Service status
docker logs seha-radar --tail 20

# Loaded sources
docker exec seha-radar python3 -c "
from health_agents.shared.source_registry import source_registry
print(f'Total: {len(source_registry.list_all())} sources')
print(f'Active: {len(source_registry.list_enabled())} sources')
"

# API health
curl http://localhost:8080/status
```

### View All Sources
```bash
docker exec seha-radar python3 -c "
from health_agents.shared.source_registry import source_registry
for s in source_registry.list_enabled():
    print(f'{s.id:25s} {s.name}')
"
```

## 📊 Source Categories

### Global Primary (5)
- **WHO** - Disease Outbreak News
- **CDC** - Outbreaks
- **PROMED** - Emerging Diseases
- **ECDC** - European CDC News
- **CIDRAP** - Research & Policy

### COVID-19 Specific (7)
- **WHO_COVID_SITREP** - WHO Situation Reports
- **WHO_COVID_DASHBOARD** - WHO Data Dashboard
- **WHO_VARIANTS** - Variant Tracking
- **CDC_COVID_SURVEILLANCE** - US Surveillance
- **ITALY_HEALTH** - Italy Weekly Reports
- **NEWS_MEDICAL_COVID** - Medical News
- **REUTERS_COVID** - Reuters 24h

### Respiratory/Influenza (6)
- **WHO_RESPIRATORY** - WHO Influenza Programme
- **CDC_FLUVIEW** - US Influenza
- **CDC_AUSTRALIA** - Australia Respiratory
- **GERMANY_RKI** - Germany Influenza
- **CANADA_HEALTH** - Canada Respiratory
- **REUTERS_FLU** - Reuters 24h

### Regional Surveillance (5)
- **CHINA_CDC** - China CDC
- **HONG_KONG_CHP** - Hong Kong
- **JAPAN_MHLW** - Japan Health
- **UK_UKHSA** - UK Health Security
- **ECDC_CDTR** - ECDC Weekly Report

### Middle East (1)
- **WHO_EMRO_MERS** - MERS Outbreaks (High Priority)

## 🔧 Management Commands

### Add New Source
```bash
# 1. Add to config/sources.json
# 2. Create watch in ChangeDetection.io
# 3. Update UUID in sources.json
# 4. Rebuild container
cd /srv/docker/SehaRadar
docker compose down && docker compose up -d --build
```

### Batch Add Sources
```bash
# Use the script
cd /srv/docker/SehaRadar
./scripts/add_new_sources.sh

# Update UUIDs
python3 scripts/update_source_uuids.py

# Rebuild
docker compose down && docker compose up -d --build
```

### Check ChangeDetection.io
```bash
# List all watches
curl -s "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" | \
  jq -r 'to_entries[] | "\(.value.title): \(.key)"'

# Check specific watch
curl -s "https://changedetection.fayaa92.sa/api/v1/watch/UUID" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" | jq
```

## 📍 Key Files

| File | Purpose |
|------|---------|
| `config/sources.json` | Source configuration (v2.0) |
| `health_agents/shared/source_registry.py` | Source loading & lookup |
| `scripts/add_new_sources.sh` | Batch watch creation |
| `scripts/update_source_uuids.py` | UUID synchronization |
| `docs/SOURCE_EXPANSION_2026-02-08.md` | Full documentation |

## 🔑 Important UUIDs

### ChangeDetection.io
- **API Key**: `89f66e053569a71fb78a5cb7b328c9a5`
- **API URL**: `https://changedetection.fayaa92.sa/api/v1`
- **Tag UUID**: `37342b3f-4f96-4a74-a166-3de7e070b885` (health-surveillance)

## 📈 Check Intervals

| Interval | Sources | Count |
|----------|---------|-------|
| 6 hours | CIDRAP | 1 |
| 12 hours | News aggregators | 3 |
| Daily | Surveillance dashboards | 9 |
| Weekly | Reports/summaries | 7 |

## 🎯 High Priority Sources

1. **WHO_EMRO_MERS** - Daily, MERS-specific for Middle East
2. **WHO** - Hourly, primary outbreak alerts
3. **CDC** - Hourly, US & global outbreaks
4. **PROMED** - Every 5 min, emerging diseases

## ⚠️ Known Issues

1. **OPENAI_API_KEY not set** - AI analysis disabled
   - Solution: Add to `/srv/docker/SehaRadar/.env`

2. **Google Search disabled** - Missing API credentials
   - Solution: Set `GOOGLE_SEARCH_API_KEY` and `GOOGLE_CX_ID`

3. **Config changes require rebuild** - Not mounted as volume
   - Solution: Always rebuild after config changes

## 📚 Documentation

- Full details: `/srv/docker/SehaRadar/docs/SOURCE_EXPANSION_2026-02-08.md`
- Agent guidelines: `/srv/docker/SehaRadar/AGENTS.md`
- Source registry: `/srv/docker/SehaRadar/health_agents/shared/source_registry.py`

---

**Last Updated**: 2026-02-08  
**Status**: ✅ 28 sources active  
**Agent**: DarDab
