# SehaRadar Quick Reference

## 🎯 Production URLs

| Service | URL |
|---------|-----|
| **Primary Domain** | https://seha-radar.fayaa92.sa |
| **Live Dashboard** | https://seha-radar.fayaa92.sa/dashboard |
| **Logs Monitor** | https://seha-radar.fayaa92.sa/logs |
| **API Documentation** | https://seha-radar.fayaa92.sa/docs |
| **System Status** | https://seha-radar.fayaa92.sa/status |

### Legacy Domains (Preserved for Compatibility)
- https://phn-agents.fayaa92.sa (for webhooks)
- https://health-agents.fayaa92.sa (for integrations)

---

## 🐳 Docker Commands

```bash
# View logs
docker logs seha-radar -f --tail 100

# Restart service
cd /srv/docker/health-agents && docker compose restart

# Rebuild and restart
cd /srv/docker/health-agents && docker compose down && docker compose up -d --build

# Check container status
docker ps | grep seha-radar

# View container health
docker inspect seha-radar | grep -A 5 Health
```

---

## 📡 API Endpoints (v1.0)

### Webhook Triggers
```bash
# Unified scan (ChangeDetection.io sources)
curl -X POST https://seha-radar.fayaa92.sa/api/scan-unified

# RSS scan
curl -X POST https://seha-radar.fayaa92.sa/api/scan-rss

# Google search scan
curl -X POST https://seha-radar.fayaa92.sa/api/scan-google

# Full scan (RSS + Google)
curl -X POST https://seha-radar.fayaa92.sa/api/scan-all
```

### Email Digest
```bash
# Trigger email digest
curl -X POST https://seha-radar.fayaa92.sa/api/trigger-digest \
  -H "Content-Type: application/json" \
  -d '{"interval": "daily"}'

# Preview digest without sending
curl https://seha-radar.fayaa92.sa/api/digest-preview
```

### Data Queries
```bash
# Get system statistics
curl https://seha-radar.fayaa92.sa/api/statistics

# Get all findings
curl https://seha-radar.fayaa92.sa/api/findings?limit=50

# Get findings by disease
curl "https://seha-radar.fayaa92.sa/api/findings?disease=Mpox&limit=20"

# Get findings by source
curl "https://seha-radar.fayaa92.sa/api/findings?source=WHO&limit=20"

# Get findings by priority
curl "https://seha-radar.fayaa92.sa/api/findings?priority=critical&limit=10"

# Get specific finding by ID
curl https://seha-radar.fayaa92.sa/api/findings/123

# Get configured diseases
curl https://seha-radar.fayaa92.sa/api/diseases

# Get configured sources
curl https://seha-radar.fayaa92.sa/api/sources

# Get enabled sources only
curl https://seha-radar.fayaa92.sa/api/sources?enabled_only=true

# Filter sources by type
curl "https://seha-radar.fayaa92.sa/api/sources?source_type=changedetection"
```

### Configuration Management
```bash
# Reload source configuration (hot-reload)
curl -X POST https://seha-radar.fayaa92.sa/api/sources/reload

# Get specific source details
curl https://seha-radar.fayaa92.sa/api/sources/WHO
```

---

## 📂 File Locations

### Application Files
```
/srv/docker/health-agents/
├── server.py                 # FastAPI server (main entrypoint)
├── docker-compose.yml        # Container configuration
├── .env                      # Environment variables (secrets)
├── AGENTS.md                 # Codebase guidelines
├── REBRANDING_SUMMARY.md     # Rebranding documentation
│
├── health_agents/            # Agent definitions
│   ├── master_agent.py       # Orchestration agent
│   ├── fetcher_agent.py      # Data fetching
│   ├── translator_agent.py   # Arabic translation
│   └── shared/
│       ├── models.py         # Pydantic models
│       └── source_registry.py # Source configuration
│
├── tools/                    # Function tools
│   ├── nocodb_client.py      # Database client
│   ├── email_digest.py       # Email service
│   ├── deduplication.py      # Content deduplication
│   └── rss_parser.py         # RSS feed parsing
│
├── workflows/                # Multi-step workflows
│   ├── unified_scan_workflow.py
│   └── email_digest_workflow.py
│
└── config/                   # JSON configuration
    ├── diseases.json         # Disease keywords
    └── sources.json          # Source registry
```

### Reverse Proxy Configuration
```
/srv/docker/caddy/Caddyfile   # Reverse proxy config
```

### Logs
```
/tmp/seha-radar-trace.log     # Agent trace logs (inside container)
```

---

## 🔧 Common Operations

### View Live Logs
```bash
docker logs seha-radar -f --tail 100
```

### Restart Service (No Rebuild)
```bash
cd /srv/docker/health-agents && docker compose restart
```

### Full Rebuild (After Code Changes)
```bash
cd /srv/docker/health-agents
docker compose down
docker compose up -d --build
```

### Check Service Health
```bash
# Internal health check
curl http://seha-radar:8080/status

# Via reverse proxy
curl -H "Host: seha-radar.fayaa92.sa" http://localhost/status

# Production URL (from anywhere)
curl https://seha-radar.fayaa92.sa/status
```

### Reload Configuration Without Restart
```bash
# Reload source configuration
curl -X POST https://seha-radar.fayaa92.sa/api/sources/reload
```

---

## 🛠️ Troubleshooting

### Container Not Starting
```bash
# Check logs for errors
docker logs seha-radar --tail 50

# Check if port 8080 is available
docker ps | grep 8080

# Verify .env file exists
ls -la /srv/docker/health-agents/.env
```

### API Not Responding
```bash
# Check container status
docker ps --filter name=seha-radar

# Check Caddy reverse proxy
docker logs caddy --tail 50

# Test internal connectivity
docker exec seha-radar curl -s http://localhost:8080/status
```

### Database Connection Issues
```bash
# Check NocoDB container
docker ps | grep nocodb

# Test database connection
curl https://nocodb.fayaa92.sa

# View database statistics from SehaRadar
curl https://seha-radar.fayaa92.sa/api/statistics
```

### Webhook Not Triggering
```bash
# Test webhook endpoint manually
curl -X POST https://seha-radar.fayaa92.sa/webhook/WHO \
  -H "Content-Type: application/json" \
  -d '{"change_detected": true, "message": "test"}'

# Check ChangeDetection.io webhook configuration
# Should point to: https://phn-agents.fayaa92.sa/webhook/{SOURCE_NAME}
# (legacy domain preserved for webhook compatibility)
```

---

## 🔄 Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| **Daily Report** | 19:00 (7 PM) | Generate daily disease outbreak report |
| **Email Digest** | 19:00 (7 PM) | Send email digest to recipients |
| **RSS Scan** | Every 6 hours | Scan WHO/CDC RSS feeds |
| **Google Scan** | 08:00 (8 AM) | Search Google for disease news |
| **Unified Scan** | Every 6 hours | Poll ChangeDetection.io sources |

Configure schedules via `.env`:
```bash
REPORT_SCHEDULE_HOUR=19
DIGEST_SCHEDULE_HOUR=19
RSS_SCAN_INTERVAL_HOURS=6
GOOGLE_SCAN_HOUR=8
```

---

## 📊 Key Statistics

View comprehensive statistics at:
- **Dashboard**: https://seha-radar.fayaa92.sa/dashboard
- **API**: https://seha-radar.fayaa92.sa/api/statistics

Statistics include:
- Total findings stored in database
- Findings by priority (Critical, High, Medium, Low)
- Webhooks processed/failed
- Scans completed (RSS, Google)
- Email digests sent
- System uptime

---

## 🌐 Integrations

### NocoDB (Database UI)
- **URL**: https://nocodb.fayaa92.sa
- **Table**: `Health Surveillance Findings`
- **API**: Fully integrated via `nocodb_client.py`

### ChangeDetection.io (Website Monitoring)
- **URL**: https://changedetection.fayaa92.sa
- **Webhooks**: https://phn-agents.fayaa92.sa/webhook/{SOURCE_NAME}
- **Sources**: WHO, CDC, ProMED, BlueDot, NIH

### n8n (Workflow Automation)
- **URL**: https://n8n.fayaa92.sa
- **Digest Webhook**: https://n8n.fayaa92.sa/webhook/disease-digest
- **Alert Webhook**: https://n8n.fayaa92.sa/webhook/urgent-alert

---

## 📝 Version Information

- **Current Version**: SehaRadar v1.0.0
- **Previous Version**: DabDar v4.0 (Phase 1)
- **Release Date**: February 8, 2026
- **Stack**: Python 3.11+, FastAPI, OpenAI Agents SDK, Docker

---

## 🔐 Security Notes

- All secrets stored in `/srv/docker/health-agents/.env` (600 permissions)
- API accessed via HTTPS only (Cloudflare tunnel + Caddy)
- No direct port exposure (reverse proxy only)
- Container runs with minimal privileges
- Database credentials secured via environment variables

---

**Last Updated**: February 8, 2026  
**Maintained By**: MiniDabbirni (Infrastructure Operator)
