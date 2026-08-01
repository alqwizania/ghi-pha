#!/bin/bash
# Quick webhook test script
# Tests the n8n webhook endpoint

echo "════════════════════════════════════════════════════════════"
echo "  Testing Email Notification Webhook"
echo "════════════════════════════════════════════════════════════"
echo ""

WEBHOOK_URL="https://n8n.fayaa92.sa/webhook/health-finding-notification"

echo "Webhook URL: ${WEBHOOK_URL}"
echo ""
echo "Sending test payload..."
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "records.after.insert",
    "version": "v3",
    "data": {
      "table_name": "findings",
      "rows": [{
        "Id": 999,
        "date": "2026-01-31",
        "agency": "TEST",
        "headline": "Test Email Notification",
        "summary": "This is a test notification from the webhook test script.",
        "url": "https://example.com/test"
      }]
    }
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "Response:"
echo "─────────────────────────────────────────────────────────"
echo "HTTP Status Code: ${HTTP_CODE}"
echo ""
echo "Body:"
echo "${BODY}"
echo "─────────────────────────────────────────────────────────"
echo ""

if [ "$HTTP_CODE" == "200" ]; then
    echo "✅ SUCCESS! Webhook accepted the request."
    echo ""
    echo "Check your email inbox for the notification."
    echo "It should arrive within 5 seconds."
elif [ "$HTTP_CODE" == "404" ]; then
    echo "❌ ERROR: Webhook not found (404)"
    echo ""
    echo "Possible causes:"
    echo "  1. n8n workflow is not active"
    echo "  2. Webhook path is incorrect"
    echo ""
    echo "Fix:"
    echo "  1. Open: https://n8n.fayaa92.sa/workflow/TKJ32vVmiDgG026N"
    echo "  2. Click the 'Active' toggle (top-right)"
    echo "  3. Verify 'Webhook Trigger' node shows production URL"
elif [ "$HTTP_CODE" == "000" ]; then
    echo "❌ ERROR: Cannot connect to n8n"
    echo ""
    echo "Possible causes:"
    echo "  1. n8n is not running"
    echo "  2. Network issue"
    echo ""
    echo "Fix:"
    echo "  docker ps | grep n8n"
    echo "  docker logs n8n --tail 20"
else
    echo "⚠️  Unexpected HTTP code: ${HTTP_CODE}"
    echo ""
    echo "Check n8n execution logs for details:"
    echo "  https://n8n.fayaa92.sa/executions"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
