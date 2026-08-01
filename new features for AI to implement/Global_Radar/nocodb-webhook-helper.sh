#!/bin/bash

# NocoDB Webhook Configuration Helper
# Helps troubleshoot and verify webhook setup

set -e

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  NocoDB Webhook Configuration Helper${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}📋 Configuration Reference${NC}"
echo ""
echo "Step-by-step guide to configure NocoDB webhook:"
echo ""
echo "1. Navigate to Webhook Settings:"
echo "   ${GREEN}https://nocodb.fayaa92.sa${NC}"
echo "   → Open base: ${GREEN}PHN${NC}"
echo "   → Click table: ${GREEN}findings${NC}"
echo "   → Click: ${GREEN}Details${NC} (top-right)"
echo "   → Click: ${GREEN}Webhooks${NC} tab"
echo "   → Click: ${GREEN}+ Add New Webhook${NC}"
echo ""

echo "2. Basic Configuration:"
echo "   Name: ${GREEN}Email Notification on New Finding${NC}"
echo "   Trigger Source: ${GREEN}Record${NC}"
echo "   Trigger Event: ${GREEN}After Insert${NC}"
echo ""

echo "3. HTTP Configuration:"
echo "   Method: ${GREEN}POST${NC}"
echo "   URL: ${GREEN}https://n8n.fayaa92.sa/webhook/health-finding-notification${NC}"
echo ""

echo -e "${YELLOW}4. Headers Configuration (THE TRICKY PART):${NC}"
echo ""
echo "   ${YELLOW}Look for tabs near the URL field:${NC}"
echo "   ┌─────────────────────────────────────────┐"
echo "   │ [Headers] [Parameters] [Body]           │ ← Click 'Headers' tab"
echo "   └─────────────────────────────────────────┘"
echo ""
echo "   ${YELLOW}Then click '+ Add Header' button:${NC}"
echo "   ┌─────────────────────────────────────────┐"
echo "   │ [+ Add Header]                          │ ← Click this"
echo "   └─────────────────────────────────────────┘"
echo ""
echo "   ${YELLOW}Two input fields will appear:${NC}"
echo "   ┌──────────────┬────────────────────────┐"
echo "   │ Key          │ Value                  │"
echo "   ├──────────────┼────────────────────────┤"
echo "   │ Content-Type │ application/json       │"
echo "   └──────────────┴────────────────────────┘"
echo ""
echo "   ${GREEN}Copy-paste exactly:${NC}"
echo "   Left field (Key):   ${GREEN}Content-Type${NC}"
echo "   Right field (Value): ${GREEN}application/json${NC}"
echo ""

echo "5. Body Configuration:"
echo "   ${YELLOW}Click 'Body' tab, then enter:${NC}"
echo "   ${GREEN}{{ json event }}${NC}"
echo ""
echo "   ${RED}Important: Use double curly braces with spaces${NC}"
echo ""

echo "6. Save:"
echo "   Click ${GREEN}[Test Webhook]${NC} (optional)"
echo "   Click ${GREEN}[Save]${NC}"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Menu
while true; do
    echo -e "${YELLOW}What would you like to do?${NC}"
    echo ""
    echo "  1) Test n8n webhook endpoint (check if active)"
    echo "  2) Show example curl command for testing"
    echo "  3) Check NocoDB base info"
    echo "  4) View complete webhook configuration guide"
    echo "  5) Exit"
    echo ""
    read -p "Enter choice [1-5]: " choice
    echo ""

    case $choice in
        1)
            echo -e "${YELLOW}Testing n8n webhook endpoint...${NC}"
            echo ""
            
            HTTP_CODE=$(curl -s -o /tmp/webhook-test.txt -w "%{http_code}" \
                -X POST https://n8n.fayaa92.sa/webhook/health-finding-notification \
                -H "Content-Type: application/json" \
                -d '{"test": "connectivity"}')
            
            if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
                echo -e "${GREEN}✅ SUCCESS${NC} - Webhook endpoint is active (HTTP $HTTP_CODE)"
                echo ""
                echo "Response:"
                cat /tmp/webhook-test.txt
                echo ""
            elif [ "$HTTP_CODE" -eq 404 ]; then
                echo -e "${RED}❌ FAILED${NC} - Webhook not found (HTTP 404)"
                echo ""
                echo "This means the n8n workflow is NOT ACTIVE yet."
                echo ""
                echo "Fix:"
                echo "  1. Go to: ${GREEN}https://n8n.fayaa92.sa/workflow/TKJ32vVmiDgG026N${NC}"
                echo "  2. Click the ${GREEN}toggle switch${NC} in top-right corner"
                echo "  3. Make sure it says ${GREEN}'Active'${NC} (should turn green/blue)"
                echo ""
            else
                echo -e "${YELLOW}⚠️  UNEXPECTED${NC} - HTTP $HTTP_CODE"
                echo ""
                echo "Response:"
                cat /tmp/webhook-test.txt
                echo ""
            fi
            
            rm -f /tmp/webhook-test.txt
            echo ""
            ;;
            
        2)
            echo -e "${YELLOW}Example curl command for testing:${NC}"
            echo ""
            echo -e "${GREEN}# Test with minimal payload${NC}"
            cat << 'EOF'
curl -X POST https://n8n.fayaa92.sa/webhook/health-finding-notification \
  -H "Content-Type: application/json" \
  -d '{"test": "ping"}' \
  -w "\nHTTP Status: %{http_code}\n"
EOF
            echo ""
            echo -e "${GREEN}# Test with full NocoDB event payload${NC}"
            cat << 'EOF'
curl -X POST https://n8n.fayaa92.sa/webhook/health-finding-notification \
  -H "Content-Type: application/json" \
  -d '{
    "type": "records.after.insert",
    "data": {
      "rows": [{
        "Id": 999,
        "date": "2026-01-31",
        "agency": "TEST",
        "headline": "Test Email Notification",
        "summary": "This is a test of the automated email notification system",
        "url": "https://example.com"
      }]
    }
  }' \
  -w "\nHTTP Status: %{http_code}\n"
EOF
            echo ""
            ;;
            
        3)
            echo -e "${YELLOW}Checking NocoDB base info...${NC}"
            echo ""
            echo "Base: PHN"
            echo "Table: findings"
            echo "URL: https://nocodb.fayaa92.sa"
            echo ""
            echo "Webhook configuration location:"
            echo "  PHN → findings → Details → Webhooks"
            echo ""
            ;;
            
        4)
            echo -e "${YELLOW}Opening complete webhook configuration guide...${NC}"
            echo ""
            if [ -f "/srv/docker/health-agents/NOCODB_WEBHOOK_CORRECT_CONFIG.md" ]; then
                less /srv/docker/health-agents/NOCODB_WEBHOOK_CORRECT_CONFIG.md
            else
                echo -e "${RED}Error: Guide not found${NC}"
                echo "Expected location: /srv/docker/health-agents/NOCODB_WEBHOOK_CORRECT_CONFIG.md"
            fi
            echo ""
            ;;
            
        5)
            echo "Exiting. Good luck with your webhook setup! 🚀"
            exit 0
            ;;
            
        *)
            echo -e "${RED}Invalid choice. Please enter 1-5.${NC}"
            echo ""
            ;;
    esac
done
