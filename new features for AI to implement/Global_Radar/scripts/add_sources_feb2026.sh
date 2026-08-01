#!/bin/bash
# Script to add new surveillance sources - February 2026 Expansion
# SehaRadar v1.0 - 15 new WHO regional + specialized sources

set -e

API_URL="${CHANGEDETECTION_API_URL:-https://changedetection.fayaa92.sa/api/v1}"
API_KEY="${CHANGEDETECTION_API_KEY:-}"
TAG_UUID="${CHANGEDETECTION_TAG_UUID:-37342b3f-4f96-4a74-a166-3de7e070b885}"

if [ -z "$API_KEY" ]; then
    echo "CHANGEDETECTION_API_KEY is required" >&2
    exit 1
fi

echo "🚀 SehaRadar Source Expansion - February 2026"
echo "=============================================="
echo "Adding 15 new surveillance sources"
echo ""

# Function to create a watch
create_watch() {
    local url="$1"
    local title="$2"
    local check_time="$3"
    local source_id="$4"
    
    echo "📝 Creating: $title"
    echo "   URL: $url"
    echo "   Interval: ${check_time}s"
    
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
    
    # Extract UUID from response
    if command -v jq &> /dev/null; then
        uuid=$(echo "$response" | jq -r '.uuid // empty' 2>/dev/null || echo "")
    else
        uuid=$(echo "$response" | grep -oP '"uuid":\s*"\K[^"]+' || echo "")
    fi
    
    if [ -n "$uuid" ] && [ "$uuid" != "null" ]; then
        echo "   ✅ Created - UUID: $uuid"
        echo "$source_id|$uuid|$url|$title" >> /tmp/seharadar_feb2026_watches.txt
    else
        echo "   ❌ Failed"
        echo "   Response: $response"
        echo "$source_id|FAILED|$url|$title" >> /tmp/seharadar_feb2026_watches.txt
    fi
    echo ""
}

# Clear output file
> /tmp/seharadar_feb2026_watches.txt

echo "=================================================="
echo "📊 WHO REGIONAL OFFICES (6 sources)"
echo "=================================================="

# WHO Global Situation Reports (12 hours)
create_watch \
    "https://www.who.int/emergencies/situation-reports" \
    "WHO - Global Situation Reports" \
    43200 \
    "WHO_SITREP"

# WHO AFRO - Africa (6 hours)
create_watch \
    "https://www.afro.who.int/health-topics/disease-outbreaks" \
    "WHO AFRO - Africa Disease Outbreaks" \
    21600 \
    "WHO_AFRO"

# WHO EMRO - Middle East/Eastern Mediterranean (6 hours)
create_watch \
    "https://www.emro.who.int/health-topics/disease-outbreaks/index.html" \
    "WHO EMRO - Eastern Mediterranean Outbreaks" \
    21600 \
    "WHO_EMRO_OUTBREAKS"

# WHO EURO - Europe (6 hours)
create_watch \
    "https://www.who.int/europe/emergencies" \
    "WHO EURO - Europe Emergencies" \
    21600 \
    "WHO_EURO"

# WHO SEARO - Southeast Asia (6 hours)
create_watch \
    "https://www.who.int/southeastasia/emergencies" \
    "WHO SEARO - Southeast Asia Emergencies" \
    21600 \
    "WHO_SEARO"

# WHO WPRO - Western Pacific (6 hours)
create_watch \
    "https://www.who.int/westernpacific/emergencies" \
    "WHO WPRO - Western Pacific Emergencies" \
    21600 \
    "WHO_WPRO"

echo "=================================================="
echo "🌎 REGIONAL HEALTH AUTHORITIES (3 sources)"
echo "=================================================="

# PAHO - Americas (6 hours)
create_watch \
    "https://www.paho.org/en/outbreaks" \
    "PAHO - Pan American Health Organization Outbreaks" \
    21600 \
    "PAHO"

# ECDC - Threats & Outbreaks (6 hours)
create_watch \
    "https://www.ecdc.europa.eu/en/threats-and-outbreaks" \
    "ECDC - Threats and Outbreaks" \
    21600 \
    "ECDC_OUTBREAKS"

# UK Health Protection Reports (daily)
create_watch \
    "https://www.gov.uk/government/collections/health-protection-reports" \
    "UK Gov - Health Protection Reports" \
    86400 \
    "UK_HPR"

echo "=================================================="
echo "✈️ TRAVEL & HUMANITARIAN (3 sources)"
echo "=================================================="

# CDC Travel Notices (6 hours)
create_watch \
    "https://wwwnc.cdc.gov/travel/notices" \
    "CDC - Travel Health Notices" \
    21600 \
    "CDC_TRAVEL"

# ReliefWeb Disasters (6 hours)
create_watch \
    "https://reliefweb.int/disasters" \
    "ReliefWeb - Global Disasters" \
    21600 \
    "RELIEFWEB_DISASTERS"

# ReliefWeb Health Topic (6 hours)
create_watch \
    "https://reliefweb.int/topics/health" \
    "ReliefWeb - Health Topics" \
    21600 \
    "RELIEFWEB_HEALTH"

echo "=================================================="
echo "🦠 DISEASE-SPECIFIC DASHBOARDS (3 sources)"
echo "=================================================="

# Polio Eradication Initiative (daily)
create_watch \
    "https://polioeradication.org/about-polio/polio-this-week/" \
    "GPEI - Polio This Week" \
    86400 \
    "GPEI_POLIO"

# WHO Mpox Global Dashboard (daily)
create_watch \
    "https://worldhealthorg.shinyapps.io/mpx_global/#2_Global_situation_update" \
    "WHO - Mpox Global Dashboard" \
    86400 \
    "WHO_MPX"

# GTFCC Cholera Trends (daily)
create_watch \
    "https://www.gtfcc.org/about-cholera/cholera-trends/" \
    "GTFCC - Global Cholera Trends" \
    86400 \
    "GTFCC_CHOLERA"

echo "=================================================="
echo "✅ Watch creation complete!"
echo ""
echo "📋 Results saved to: /tmp/seharadar_feb2026_watches.txt"
echo ""
echo "Summary:"
grep -c "✅" /tmp/seharadar_feb2026_watches.txt 2>/dev/null && echo " watches created successfully" || echo "Check output file for details"
echo ""
echo "Next steps:"
echo "1. Review the UUIDs below"
echo "2. Run: python /srv/docker/SehaRadar/scripts/update_sources_feb2026.py"
echo "3. Restart SehaRadar: cd /srv/docker/SehaRadar && docker compose restart"
echo ""
echo "=================================================="
echo "📋 CREATED WATCHES:"
echo "=================================================="
cat /tmp/seharadar_feb2026_watches.txt
