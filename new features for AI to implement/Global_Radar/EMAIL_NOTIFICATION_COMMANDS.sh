#!/bin/bash
# Email Notification System - Command Reference
# Health Surveillance Agent System | FayaaLink
# Created: 2026-01-31

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  EMAIL NOTIFICATION SYSTEM - COMMAND REFERENCE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
N8N_WORKFLOW_ID="TKJ32vVmiDgG026N"
N8N_BASE_URL="https://n8n.fayaa92.sa"
NOCODB_BASE_URL="https://nocodb.fayaa92.sa"
WEBHOOK_PATH="/webhook/health-finding-notification"

# Function: Show menu
show_menu() {
    echo ""
    echo "Available Commands:"
    echo ""
    echo "  [1] Test webhook with curl"
    echo "  [2] Check n8n workflow status"
    echo "  [3] View n8n execution logs (last 5)"
    echo "  [4] Test end-to-end (health agent → email)"
    echo "  [5] Set notification email (n8n .env)"
    echo "  [6] Restart n8n (after config changes)"
    echo "  [7] Show documentation links"
    echo "  [8] Exit"
    echo ""
}

# Function: Test webhook
test_webhook() {
    echo -e "${YELLOW}Testing webhook with sample payload...${NC}"
    curl -X POST "${N8N_BASE_URL}${WEBHOOK_PATH}" \
      -H "Content-Type: application/json" \
      -d '{
        "data": {
          "rows": [{
            "id": 999,
            "date": "2026-01-31",
            "agency": "TEST",
            "headline": "Test Email Notification",
            "summary": "This is a test notification from the health surveillance system.",
            "url": "https://example.com/test"
          }]
        }
      }'
    echo ""
    echo -e "${GREEN}✓ Request sent. Check your email inbox!${NC}"
}

# Function: Check workflow status
check_workflow_status() {
    echo -e "${YELLOW}Checking n8n workflow status...${NC}"
    echo ""
    echo "Workflow ID: ${N8N_WORKFLOW_ID}"
    echo "Webhook URL: ${N8N_BASE_URL}${WEBHOOK_PATH}"
    echo ""
    echo "To check status in n8n UI:"
    echo "  1. Open: ${N8N_BASE_URL}/workflow/${N8N_WORKFLOW_ID}"
    echo "  2. Look for 'Active' toggle (should be ON)"
    echo ""
}

# Function: View execution logs
view_execution_logs() {
    echo -e "${YELLOW}Viewing recent n8n executions...${NC}"
    echo ""
    echo "To view logs in n8n UI:"
    echo "  1. Open: ${N8N_BASE_URL}/executions"
    echo "  2. Filter by workflow: 'Health Finding Email Notification'"
    echo "  3. Check for success/error status"
    echo ""
}

# Function: Test end-to-end
test_end_to_end() {
    echo -e "${YELLOW}Running end-to-end test (health agent webhook)...${NC}"
    cd /srv/docker/health-agents
    python main.py test-webhook WHO
    echo ""
    echo -e "${GREEN}✓ Test complete. Check your email inbox!${NC}"
}

# Function: Set notification email
set_notification_email() {
    echo -e "${YELLOW}Setting notification email in n8n .env...${NC}"
    echo ""
    read -p "Enter recipient email address: " email
    
    if [ -z "$email" ]; then
        echo -e "${RED}✗ Email address cannot be empty${NC}"
        return 1
    fi
    
    # Check if .env exists
    if [ ! -f /srv/docker/n8n/.env ]; then
        echo -e "${RED}✗ n8n .env file not found at /srv/docker/n8n/.env${NC}"
        return 1
    fi
    
    # Add or update NOTIFICATION_EMAIL
    if grep -q "NOTIFICATION_EMAIL" /srv/docker/n8n/.env; then
        sed -i "s/NOTIFICATION_EMAIL=.*/NOTIFICATION_EMAIL=${email}/" /srv/docker/n8n/.env
        echo -e "${GREEN}✓ Updated NOTIFICATION_EMAIL to: ${email}${NC}"
    else
        echo "NOTIFICATION_EMAIL=${email}" >> /srv/docker/n8n/.env
        echo -e "${GREEN}✓ Added NOTIFICATION_EMAIL: ${email}${NC}"
    fi
    
    echo ""
    echo "Remember to restart n8n for changes to take effect:"
    echo "  docker restart n8n"
}

# Function: Restart n8n
restart_n8n() {
    echo -e "${YELLOW}Restarting n8n...${NC}"
    docker restart n8n
    echo ""
    echo -e "${GREEN}✓ n8n restarted successfully${NC}"
    echo "Wait ~10 seconds for n8n to fully start"
}

# Function: Show documentation
show_documentation() {
    echo ""
    echo "Documentation Files:"
    echo ""
    echo "  📄 Quick Start (5 min setup):"
    echo "     /srv/docker/health-agents/EMAIL_NOTIFICATION_QUICKSTART.md"
    echo ""
    echo "  📄 Detailed Setup Guide:"
    echo "     /srv/docker/health-agents/EMAIL_NOTIFICATION_SETUP.md"
    echo ""
    echo "  📄 Implementation Summary:"
    echo "     /srv/docker/health-agents/IMPLEMENTATION_SUMMARY.md"
    echo ""
    echo "  📄 Architecture Diagrams:"
    echo "     /srv/docker/health-agents/EMAIL_NOTIFICATION_ARCHITECTURE.txt"
    echo ""
    echo "Web UIs:"
    echo ""
    echo "  🌐 n8n Workflow:"
    echo "     ${N8N_BASE_URL}/workflow/${N8N_WORKFLOW_ID}"
    echo ""
    echo "  🌐 NocoDB Webhooks:"
    echo "     ${NOCODB_BASE_URL} → PHN → findings → Details → Webhooks"
    echo ""
}

# Main menu loop
main() {
    while true; do
        show_menu
        read -p "Select option [1-8]: " choice
        
        case $choice in
            1) test_webhook ;;
            2) check_workflow_status ;;
            3) view_execution_logs ;;
            4) test_end_to_end ;;
            5) set_notification_email ;;
            6) restart_n8n ;;
            7) show_documentation ;;
            8) echo "Goodbye!"; exit 0 ;;
            *) echo -e "${RED}Invalid option. Please select 1-8.${NC}" ;;
        esac
        
        echo ""
        read -p "Press Enter to continue..."
    done
}

# Run main menu if script is executed directly
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main
fi
