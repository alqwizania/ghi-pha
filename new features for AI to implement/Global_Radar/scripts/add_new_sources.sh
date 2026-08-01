#!/bin/bash
# Script to add new surveillance sources to ChangeDetection.io
# SehaRadar v1.0 - Source Expansion

set -e

API_URL="${CHANGEDETECTION_API_URL:-https://changedetection.fayaa92.sa/api/v1}"
API_KEY="${CHANGEDETECTION_API_KEY:-}"
WEBHOOK_BASE="${SEHARADAR_WEBHOOK_BASE:-https://seha-radar.fayaa92.sa/webhook}"
TAG_UUID="${CHANGEDETECTION_TAG_UUID:-37342b3f-4f96-4a74-a166-3de7e070b885}"

if [ -z "$API_KEY" ]; then
    echo "CHANGEDETECTION_API_KEY is required" >&2
    exit 1
fi

echo "🚀 Adding new surveillance sources to ChangeDetection.io"
echo "=================================================="

# Function to create a watch
create_watch() {
    local url="$1"
    local title="$2"
    local check_time="$3"
    
    echo ""
    echo "📝 Creating watch: $title"
    echo "   URL: $url"
    
    response=$(curl -s -X POST "$API_URL/watch" \
        -H "x-api-key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{
            "url": "'"$url"'",
            "title": "'"$title"'",
            "tag": "'"$TAG_UUID"'",
            "time_between_check": {
                "seconds": '"$check_time"'
            }
        }')
    
    # Extract UUID from response (use grep/cut as fallback if jq fails)
    if command -v jq &> /dev/null; then
        uuid=$(echo "$response" | jq -r '.uuid // empty' 2>/dev/null || echo "")
    else
        uuid=$(echo "$response" | grep -oP '"uuid":\s*"\K[^"]+' || echo "")
    fi
    
    if [ -n "$uuid" ] && [ "$uuid" != "null" ]; then
        echo "   ✅ Created successfully - UUID: $uuid"
        echo "$title|$uuid|$url" >> /tmp/seharadar_new_watches.txt
    else
        echo "   ❌ Failed to create watch"
        echo "   Response: $response"
    fi
}

# Clear output file
> /tmp/seharadar_new_watches.txt

# ==============================================
# SURVEILLANCE & REPORTING SOURCES
# ==============================================

echo ""
echo "📊 SURVEILLANCE & REPORTING SOURCES"
echo "-----------------------------------"

# ECDC Weekly Report (updates weekly)
create_watch \
    "https://www.ecdc.europa.eu/en/publications-data/communicable-disease-threats-report-24-30-january-2026-week-5" \
    "ECDC CDTR Weekly" \
    604800

# WHO COVID-19 Situation Reports (daily)
create_watch \
    "https://www.who.int/emergencies/diseases/novel-coronavirus-2019/situation-reports" \
    "WHO COVID-19 SitReps" \
    86400

# WHO COVID-19 Dashboard (daily)
create_watch \
    "https://data.who.int/dashboards/covid19/cases" \
    "WHO COVID-19 Dashboard" \
    86400

# WHO Respiratory Viruses (weekly)
create_watch \
    "https://www.who.int/teams/global-influenza-programme/surveillance-and-monitoring/respiratory-viruses" \
    "WHO Respiratory Surveillance" \
    604800

# WHO SARS-CoV-2 Variants (weekly)
create_watch \
    "https://www.who.int/activities/tracking-SARS-CoV-2-variants" \
    "WHO Variants Tracking" \
    604800

# WHO EMRO MERS (daily - high priority)
create_watch \
    "https://www.emro.who.int/health-topics/mers-cov/mers-outbreaks.html" \
    "WHO EMRO MERS" \
    86400

# CDC COVID Surveillance (daily)
create_watch \
    "https://www.cdc.gov/covid/php/surveillance/index.html" \
    "CDC COVID Surveillance" \
    86400

# CDC FluView (weekly)
create_watch \
    "https://www.cdc.gov/fluview/index.html" \
    "CDC FluView" \
    604800

# Australia CDC Respiratory (weekly)
create_watch \
    "https://www.cdc.gov.au/resources/collections/australian-respiratory-surveillance-reports?language=en" \
    "Australia CDC Respiratory" \
    604800

# China CDC (daily)
create_watch \
    "https://www.chinacdc.cn/jksj/xgbdyq/" \
    "China CDC" \
    86400

# Italy Health Reports (weekly)
create_watch \
    "https://www.salute.gov.it/new/it/tema/covid-19/report-settimanali-covid-19/" \
    "Italy Health COVID Reports" \
    604800

# Hong Kong CHP (daily)
create_watch \
    "https://www.chp.gov.hk/en/index.html" \
    "Hong Kong CHP" \
    86400

# UK UKHSA Dashboard (daily)
create_watch \
    "https://ukhsa-dashboard.data.gov.uk/" \
    "UK UKHSA Dashboard" \
    86400

# Germany RKI Influenza (weekly)
create_watch \
    "https://influenza.rki.de/Wochenberichte.aspx" \
    "Germany RKI Influenza" \
    604800

# Japan MHLW (daily)
create_watch \
    "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000121431_00485.html" \
    "Japan MHLW" \
    86400

# Canada Health Infobase (weekly)
create_watch \
    "https://health-infobase.canada.ca/respiratory-virus-surveillance/?source=rvdss" \
    "Canada Respiratory Surveillance" \
    604800

# ==============================================
# NEWS AGGREGATORS
# ==============================================

echo ""
echo "📰 NEWS AGGREGATOR SOURCES"
echo "--------------------------"

# News-Medical.net COVID (12 hours)
create_watch \
    "https://www.news-medical.net/condition/Coronavirus-Disease-COVID-19" \
    "News-Medical COVID" \
    43200

# Reuters COVID Search (12 hours)
create_watch \
    "https://www.reuters.com/site-search/?query=covid&date=past_24_hours" \
    "Reuters COVID 24h" \
    43200

# Reuters Flu Search (12 hours)
create_watch \
    "https://www.reuters.com/site-search/?query=flu&date=past_24_hours&offset=0" \
    "Reuters Flu 24h" \
    43200

# CIDRAP (6 hours)
create_watch \
    "https://www.cidrap.umn.edu/" \
    "CIDRAP" \
    21600

echo ""
echo "=================================================="
echo "✅ Watch creation complete!"
echo ""
echo "📋 Summary saved to: /tmp/seharadar_new_watches.txt"
echo ""
echo "Next steps:"
echo "1. Review the UUIDs in the output file"
echo "2. Update /srv/docker/SehaRadar/config/sources.json with actual UUIDs"
echo "3. Run: python /srv/docker/SehaRadar/scripts/update_source_uuids.py"
echo "4. Restart SehaRadar: cd /srv/docker/SehaRadar && docker compose restart"
echo ""
cat /tmp/seharadar_new_watches.txt
