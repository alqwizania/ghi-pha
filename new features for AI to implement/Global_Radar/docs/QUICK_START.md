# DabDar Quick Start Guide

> **DabDar v4.0** - AI-Powered Health Surveillance System  
> Get up and running in 10 minutes

---

## Prerequisites

- Docker & Docker Compose installed
- OpenAI API key ([get one here](https://platform.openai.com/api-keys))
- Access to FayaaLink server (or your own infrastructure)

---

## 1. Clone & Configure (2 minutes)

```bash
# Navigate to project directory
cd /srv/docker/health-agents

# Copy environment template (if starting fresh)
cp .env.example .env

# Edit configuration
nano .env
```

### Required Environment Variables

```bash
# REQUIRED - OpenAI for AI analysis
OPENAI_API_KEY=sk-your-key-here

# REQUIRED - NocoDB for data storage (pre-configured on FayaaLink)
NOCODB_API_URL=http://nocodb:8080/api/v1
NOCODB_API_TOKEN=your-nocodb-token
NOCODB_TABLE_ID=m0s3bmpa8qzp4eh

# REQUIRED - ChangeDetection.io for website monitoring (pre-configured)
CHANGEDETECTION_URL=https://changedetection.fayaa92.sa
CHANGEDETECTION_API_KEY=<CHANGEDETECTION_API_KEY>

# OPTIONAL - Google Search (leave as placeholder to disable)
GOOGLE_SEARCH_API_KEY=<GOOGLE_SEARCH_API_KEY>
GOOGLE_SEARCH_ENGINE_ID=<GOOGLE_SEARCH_ENGINE_ID>

# OPTIONAL - Email digests via n8n
N8N_DIGEST_WEBHOOK_URL=https://n8n.fayaa92.sa/webhook/...
```

---

## 2. Start the System (1 minute)

```bash
# Build and start container
docker compose up -d --build

# Verify it's running
docker ps --filter "name=phn-agents"

# Check health status
curl http://localhost:8080/status
```

**Expected output:**
```json
{
  "status": "healthy",
  "version": "3.0.0",
  "timestamp": "2026-02-07T14:38:20.963540"
}
```

---

## 3. Verify Everything Works (2 minutes)

### Check the Dashboard

Open in browser: **https://phn-agents.fayaa92.sa/dashboard**

### Run a Test Scan

```bash
# Trigger unified scan (ChangeDetection.io sources)
curl -X POST http://localhost:8080/api/scan-unified

# Trigger RSS scan
curl -X POST http://localhost:8080/api/scan-rss

# Check recent findings
curl http://localhost:8080/api/findings?limit=5 | jq
```

### View Logs

```bash
# Follow logs in real-time
docker logs phn-agents -f --tail 50
```

---

## 4. Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Health check |
| `/dashboard` | GET | Live dashboard (browser) |
| `/api/scan-unified` | POST | Scan ChangeDetection.io sources |
| `/api/scan-rss` | POST | Scan RSS feeds |
| `/api/scan-all` | POST | Full scan (RSS + Google) |
| `/api/findings` | GET | Query findings |
| `/api/findings?limit=10` | GET | Get latest 10 findings |
| `/api/trigger-digest` | POST | Send email digest |
| `/webhook/{agency}` | POST | Receive ChangeDetection.io webhooks |

---

## 5. Common Operations

### Restart the System

```bash
docker compose restart
```

### Rebuild After Code Changes

```bash
docker compose down && docker compose up -d --build
```

### Check Container Health

```bash
docker ps --filter "name=phn-agents" --format "{{.Names}}: {{.Status}}"
```

### View Recent Errors

```bash
docker logs phn-agents 2>&1 | grep -i error | tail -20
```

### Force ChangeDetection.io Recheck

```bash
# Recheck WHO watch
curl -X GET "https://changedetection.fayaa92.sa/api/v1/watch/4125358c-e214-432b-a534-417be9664cca?recheck=1" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"
```

---

## 6. Monitoring Sources

### Current ChangeDetection.io Watches

| Source | URL Monitored | Check Interval |
|--------|---------------|----------------|
| WHO | who.int/emergencies/disease-outbreak-news | 1 hour |
| CDC | cdc.gov/outbreaks/ | 1 hour 10 min |
| ProMED | promedmail.org/ | 5 minutes |
| WHOClone | who.fayaa92.sa/ | Default (varies) |

### RSS Feeds

| Source | Feed URL |
|--------|----------|
| WHO | www.who.int/rss-feeds/news-english.xml |
| CDC | tools.cdc.gov/podcasts/feed.asp?feedid=183 |

---

## 7. Add a New Monitored Source

### Option A: Add via ChangeDetection.io UI

1. Go to https://changedetection.fayaa92.sa
2. Click "Add new watch"
3. Enter URL to monitor
4. Set webhook: `json://phn-agents:8080/webhook/NEW_SOURCE`
5. Add `NEW_SOURCE` to `VALID_SOURCES` in `health_agents/shared/models.py`
6. Rebuild: `docker compose down && docker compose up -d --build`

### Option B: Add via API

```bash
curl -X POST "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/health-news",
    "title": "Example Health News",
    "notification_urls": ["json://phn-agents:8080/webhook/EXAMPLE"]
  }'
```

---

## 8. Add a New Monitored Disease

Edit `config/diseases.json`:

```json
{
  "name": "Tuberculosis",
  "aliases": ["TB", "Mycobacterium tuberculosis"],
  "arabic_name": "السل",
  "keywords_en": ["tuberculosis", "TB", "mycobacterium"],
  "keywords_ar": ["السل", "الدرن"],
  "priority": "medium",
  "who_classification": "Endemic"
}
```

Then restart:
```bash
docker compose restart
```

---

## 9. Troubleshooting

### Container Won't Start

```bash
# Check for errors
docker logs phn-agents 2>&1 | head -50

# Common fixes:
# - Check .env file exists and has required variables
# - Ensure port 8080 is not in use
# - Verify Docker network exists
```

### No Findings Being Stored

```bash
# Check NocoDB connectivity
docker exec phn-agents curl -s http://nocodb:8080/api/v2/health

# Check API token
docker exec phn-agents env | grep NOCODB
```

### OpenAI API Errors

```bash
# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | head -5

# Check for rate limiting in logs
docker logs phn-agents 2>&1 | grep -i "rate\|limit\|openai"
```

### Scans Not Detecting Changes

```bash
# Check ChangeDetection.io watch status
curl -s "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" | jq '.[].last_error'

# Force recheck all watches
for uuid in 4125358c-e214-432b-a534-417be9664cca 097d6524-4761-45ac-b4a7-ba377745a368; do
  curl -s "https://changedetection.fayaa92.sa/api/v1/watch/$uuid?recheck=1" \
    -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"
done
```

---

## 10. Scheduled Operations

The system runs automated scans on a schedule:

| Operation | Schedule | Triggered By |
|-----------|----------|--------------|
| ChangeDetection.io Checks | 5 min - 1 hour (varies by watch) | ChangeDetection.io service |
| RSS Scan | Every 6 hours (default) | Internal scheduler |
| Google Scan | Daily 8:00 AM (default) | Internal scheduler |
| Digest Email | Daily 8:00 AM | Internal scheduler (when configured) |

**Note**: ChangeDetection.io check intervals are configured per watch. WHO checks every hour, ProMED every 5 minutes.

### Manual Trigger

```bash
# Trigger immediate scan
curl -X POST http://localhost:8080/api/scan-unified

# Trigger immediate digest
curl -X POST http://localhost:8080/api/trigger-digest
```

---

## 11. Useful Commands Cheatsheet

```bash
# === Container Management ===
docker compose up -d --build     # Start/rebuild
docker compose restart           # Restart
docker compose down              # Stop
docker logs phn-agents -f        # Follow logs

# === Health Checks ===
curl localhost:8080/status       # API health
curl localhost:8080/api/findings?limit=1  # Test DB

# === Scans ===
curl -X POST localhost:8080/api/scan-unified  # ChangeDetection scan
curl -X POST localhost:8080/api/scan-rss      # RSS scan
curl -X POST localhost:8080/api/scan-all      # Full scan

# === Query Findings ===
curl "localhost:8080/api/findings?limit=10" | jq
curl "localhost:8080/api/findings?disease=Mpox" | jq
curl "localhost:8080/api/findings?source=WHO" | jq

# === ChangeDetection.io ===
# List watches
curl -s "https://changedetection.fayaa92.sa/api/v1/watch" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5" | jq 'keys'

# Force recheck
curl "https://changedetection.fayaa92.sa/api/v1/watch/{UUID}?recheck=1" \
  -H "x-api-key: 89f66e053569a71fb78a5cb7b328c9a5"
```

---

## Next Steps

1. **Configure Email Digests**: Set up `N8N_DIGEST_WEBHOOK_URL` in `.env`
2. **Add Google Search**: Get API keys from Google Cloud Console
3. **Expand Disease List**: Add more diseases to `config/diseases.json`
4. **Add More Sources**: Create new ChangeDetection.io watches
5. **Set Up Alerts**: Configure n8n workflows for real-time notifications

---

## Getting Help

- **Logs**: `docker logs phn-agents -f`
- **Dashboard**: https://phn-agents.fayaa92.sa/dashboard
- **API Docs**: https://phn-agents.fayaa92.sa/docs (Swagger UI)
- **Project Docs**: `/srv/docker/health-agents/docs/`

---

*Quick Start Guide maintained by DarDab - Health Surveillance Specialist*
