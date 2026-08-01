#!/bin/bash
# Playwright Chrome Health Check Script
# Monitors zombie processes and connection health
# Usage: ./check-playwright-health.sh

set -e

echo "=== Playwright Chrome Health Check ==="
echo "Date: $(date)"
echo ""

# Check container status
echo "1. Container Status:"
docker ps --filter name=playwright-chrome --format "  Status: {{.Status}}"
echo ""

# Check zombie Chrome processes
echo "2. Zombie Chrome Processes:"
ZOMBIE_OUTPUT=$(docker exec playwright-chrome ps aux 2>/dev/null | grep '\[chromium\]' || true)
if [ -z "$ZOMBIE_OUTPUT" ]; then
    ZOMBIE_COUNT=0
else
    ZOMBIE_COUNT=$(echo "$ZOMBIE_OUTPUT" | wc -l)
fi
echo "  Count: $ZOMBIE_COUNT"
if [ "$ZOMBIE_COUNT" -eq 0 ]; then
    echo "  Status: ✅ Healthy (no zombies)"
elif [ "$ZOMBIE_COUNT" -le 3 ]; then
    echo "  Status: ⚠️  Warning (few zombies, monitor)"
else
    echo "  Status: ❌ Critical (many zombies, restart recommended)"
fi
echo ""

# Check connection stats via stats endpoint (using wget instead of curl)
echo "3. Connection Stats:"
STATS=$(docker exec playwright-chrome wget -qO- http://localhost:8080/stats 2>/dev/null || echo "Error")
if [ "$STATS" != "Error" ]; then
    echo "$STATS" | python3 -m json.tool 2>/dev/null || echo "  $STATS"
else
    echo "  ⚠️  Unable to fetch stats (endpoint may not be available)"
fi
echo ""

# Check for recent timeout errors in changedetection logs
echo "4. Recent Timeout Errors (last 50 lines):"
ERROR_OUTPUT=$(docker logs changedetection --tail 50 2>&1 | grep "BrowserType.connect_over_cdp.*Timeout" || true)
if [ -z "$ERROR_OUTPUT" ]; then
    ERROR_COUNT=0
else
    ERROR_COUNT=$(echo "$ERROR_OUTPUT" | wc -l)
fi
echo "  Count: $ERROR_COUNT"
if [ "$ERROR_COUNT" -eq 0 ]; then
    echo "  Status: ✅ No timeout errors"
else
    echo "  Status: ❌ Timeout errors detected!"
    echo ""
    echo "  Recent errors:"
    echo "$ERROR_OUTPUT" | tail -3
fi
echo ""

# Check current configuration
echo "5. Current Configuration:"
echo "  FETCH_WORKERS=$(docker exec changedetection printenv FETCH_WORKERS 2>/dev/null || echo 'Unknown')"
echo "  MAX_CONCURRENT_CHROME=$(docker exec playwright-chrome printenv MAX_CONCURRENT_CHROME_PROCESSES 2>/dev/null || echo 'Unknown')"
echo ""

# Recommendations
echo "=== Recommendations ==="
if [ "$ZOMBIE_COUNT" -gt 5 ] || [ "$ERROR_COUNT" -gt 0 ]; then
    echo "⚠️  Action Required:"
    echo "   docker restart playwright-chrome"
    echo ""
    echo "If errors persist after restart:"
    echo "   - Check logs: docker logs playwright-chrome --tail 50"
    echo "   - See full fix guide: /srv/docker/changedetection/PLAYWRIGHT_TIMEOUT_FIX.md"
else
    echo "✅ All systems healthy"
    echo ""
    echo "Current worker limits (applied 2026-02-01):"
    echo "  - FETCH_WORKERS: 5 (reduced from 10)"
    echo "  - MAX_CONCURRENT_CHROME_PROCESSES: 5 (reduced from 10)"
fi
