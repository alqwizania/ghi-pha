# API Integrations Documentation

> **DabDar v4.0** - Health Surveillance System  
> **Last Updated**: February 7, 2026

This document describes all external APIs consumed by the DabDar health surveillance system.

---

## Table of Contents

1. [Overview](#overview)
2. [OpenAI API](#1-openai-api)
3. [NocoDB API](#2-nocodb-api)
4. [ChangeDetection.io API](#3-changedetectionio-api)
5. [Google Custom Search API](#4-google-custom-search-api)
6. [n8n Webhook](#5-n8n-webhook)
7. [RSS Feeds](#6-rss-feeds)
8. [Cost Estimation](#cost-estimation)
9. [Rate Limits & Quotas](#rate-limits--quotas)

---

## Overview

| API | Type | Hosting | Status | Monthly Cost |
|-----|------|---------|--------|--------------|
| OpenAI API | REST | Cloud (OpenAI) | ✅ Active | ~$15-50 |
| NocoDB API | REST | Self-hosted | ✅ Active | $0 |
| ChangeDetection.io | REST | Self-hosted | ✅ Active | $0 |
| Google Custom Search | REST | Cloud (Google) | ⚠️ Disabled | $0-5 |
| n8n Webhook | HTTP | Self-hosted | ⚠️ Not configured | $0 |
| RSS Feeds | HTTP/XML | Public | ✅ Active | $0 |

**Estimated Total Monthly Cost**: **$15-55** (primarily OpenAI)

---

## 1. OpenAI API

### Purpose
- Epidemiological analysis and description generation
- Arabic medical translation
- Content summarization and structuring

### Configuration

```bash
# .env
OPENAI_API_KEY=sk-...
```

### Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | Generate descriptions & translations |

### Models Used

| Model | Use Case | Cost (per 1M tokens) |
|-------|----------|----------------------|
| `gpt-4o` | Primary analysis | $2.50 input / $10.00 output |
| `gpt-4o-mini` | Translation (fallback) | $0.15 input / $0.60 output |

### Request Example

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

response = await client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are an epidemiologist..."},
        {"role": "user", "content": f"Analyze this outbreak: {content}"}
    ],
    temperature=0.3,
    max_tokens=1000
)
```

### Files Using This API

- `tools/epi_triad_analyzer.py` - Description generation
- `tools/arabic_translator.py` - English→Arabic translation
- `workflows/unified_scan_workflow.py` - Orchestration

### Error Handling

```python
try:
    response = await client.chat.completions.create(...)
except openai.RateLimitError:
    # Wait and retry with exponential backoff
except openai.APIError as e:
    print(f"❌ OpenAI API error: {e}")
```

---

## 2. NocoDB API

### Purpose
- Store outbreak findings
- Query for deduplication
- Retrieve findings for email digests

### Configuration

```bash
# .env
NOCODB_API_URL=http://nocodb:8080/api/v1
NOCODB_API_TOKEN=nc_...
NOCODB_TABLE_ID=m0s3bmpa8qzp4eh
```

### Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/tables/{tableId}/records` | GET | Query findings |
| `/api/v2/tables/{tableId}/records` | POST | Create findings |
| `/api/v2/tables/{tableId}/records` | PATCH | Update findings |
| `/api/v2/tables/{tableId}/records/{id}` | GET | Get single finding |

### Request Headers

```python
headers = {
    "xc-token": os.getenv("NOCODB_API_TOKEN"),
    "Content-Type": "application/json"
}
```

### Request Example

```python
# Create a new finding
async with httpx.AsyncClient(timeout=30.0) as client:
    response = await client.post(
        f"{base_url}/api/v2/tables/{table_id}/records",
        headers=headers,
        json={"records": [finding_data]}
    )
```

### Query Syntax

```python
# Filter by disease and source
params = {
    "where": "(disease,eq,Mpox)~and(source,eq,WHO)",
    "limit": 100,
    "sort": "-CreatedAt"
}
```

### Files Using This API

- `tools/nocodb_client.py` - CRUD operations
- `tools/deduplication.py` - Duplicate checking
- `workflows/unified_scan_workflow.py` - Storage

---

## 3. ChangeDetection.io API

### Purpose
- Monitor websites for content changes
- Fetch latest snapshots and diffs
- Trigger manual rechecks

### Configuration

```bash
# .env
CHANGEDETECTION_URL=https://changedetection.fayaa92.sa
CHANGEDETECTION_API_KEY=<CHANGEDETECTION_API_KEY>
```

### Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/watch` | GET | List all watches |
| `/api/v1/watch/{uuid}` | GET | Get watch details |
| `/api/v1/watch/{uuid}` | PUT | Update watch settings |
| `/api/v1/watch/{uuid}/history/latest` | GET | Get latest snapshot |
| `/api/v1/watch/{uuid}/history` | GET | List snapshot history |
| `/api/v1/watch/{uuid}?recheck=1` | GET | Force recheck |

### Request Headers

```python
headers = {
    "x-api-key": os.getenv("CHANGEDETECTION_API_KEY")
}
```

### Request Example

```python
# Get latest snapshot
async with httpx.AsyncClient(timeout=30.0) as client:
    response = await client.get(
        f"{base_url}/api/v1/watch/{uuid}/history/latest",
        headers=headers
    )
    content = response.text
```

### Webhook Configuration

Watches send notifications to DabDar via webhooks:
```
json://phn-agents:8080/webhook/{AGENCY}
```

### Current Watches

| Watch | UUID | URL Monitored | Check Interval |
|-------|------|---------------|----------------|
| WHO | `4125358c-e214-432b-a534-417be9664cca` | who.int/emergencies/disease-outbreak-news | 1 hour |
| CDC | `097d6524-4761-45ac-b4a7-ba377745a368` | cdc.gov/outbreaks/ | 1 hour 10 min |
| WHOClone | `e8e67f93-1741-4ea6-b61a-b514855b6b5c` | who.fayaa92.sa/ | Default (varies) |
| ProMed | `ee064572-cd0c-4e42-b512-43b7f7300684` | promedmail.org/ | 5 minutes |

### Files Using This API

- `tools/changedetection_client.py` - Full API client
- `workflows/unified_scan_workflow.py` - Fetch content

---

## 4. Google Custom Search API

### Purpose
- Search Google for health outbreak news
- Supplement ChangeDetection.io monitoring

### Configuration

```bash
# .env
GOOGLE_SEARCH_API_KEY=<GOOGLE_SEARCH_API_KEY>  # Currently optional
GOOGLE_SEARCH_ENGINE_ID=<GOOGLE_SEARCH_ENGINE_ID>
```

### Status: ⚠️ Currently Disabled

The system detects placeholder API keys and disables this feature automatically.

### Endpoint

```
https://www.googleapis.com/customsearch/v1
```

### Request Parameters

```python
params = {
    "key": api_key,
    "cx": search_engine_id,
    "q": "disease outbreak site:who.int OR site:cdc.gov",
    "num": 10,
    "dateRestrict": "d7"  # Last 7 days
}
```

### Setup Instructions

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable Custom Search API
3. Create API credentials
4. Set up a Programmable Search Engine at [cse.google.com](https://cse.google.com/)
5. Update `.env` with real credentials

### Files Using This API

- `tools/google_search.py` - Search implementation

---

## 5. n8n Webhook

### Purpose
- Send compiled email digests for delivery
- Trigger notification workflows

### Configuration

```bash
# .env
N8N_DIGEST_WEBHOOK_URL=https://n8n.fayaa92.sa/webhook/...
```

### Status: ⚠️ Not Fully Configured

Email digest functionality is pending configuration (BUG-002).

### Request Format

```python
payload = {
    "digest_date": "2026-02-07",
    "total_findings": 15,
    "critical_count": 2,
    "high_count": 5,
    "findings": [...],
    "html_content": "...",
    "text_content": "..."
}

async with httpx.AsyncClient() as client:
    await client.post(webhook_url, json=payload)
```

### Files Using This API

- `tools/email_digest.py` - Digest compilation and sending

---

## 6. RSS Feeds

### Purpose
- Fetch latest news from health organizations
- Supplement website monitoring

### Feeds Configured

| Feed | URL | Update Frequency |
|------|-----|------------------|
| WHO RSS | `https://www.who.int/rss-feeds/news-english.xml` | ~Daily |
| CDC RSS | `https://tools.cdc.gov/podcasts/feed.asp?feedid=183` | ~Daily |

### Request Example

```python
import feedparser

async with httpx.AsyncClient(timeout=30.0) as client:
    response = await client.get(feed_url)
    feed = feedparser.parse(response.text)
    
    for entry in feed.entries:
        title = entry.title
        link = entry.link
        published = entry.published
```

### Files Using This API

- `tools/rss_parser.py` - RSS parsing

---

## Cost Estimation

### Monthly Cost Breakdown

#### OpenAI API (Primary Cost Driver)

| Operation | Frequency | Tokens/Op | Monthly Tokens | Cost |
|-----------|-----------|-----------|----------------|------|
| Description Generation | ~300 findings/mo | ~800 | 240,000 | ~$2.40 |
| Arabic Translation | ~300 findings/mo | ~600 | 180,000 | ~$1.80 |
| Analysis Prompts | ~300 findings/mo | ~500 input | 150,000 | ~$0.38 |

**Estimated OpenAI Cost**: **$5-15/month** (normal usage)

> **Note**: Costs can spike during outbreak events with high finding volumes.

#### Scaling Scenarios

| Scenario | Findings/Month | Est. OpenAI Cost |
|----------|----------------|------------------|
| Low activity | 100 | $3-5 |
| Normal | 300 | $10-15 |
| Outbreak event | 1,000 | $30-50 |
| Major pandemic | 5,000+ | $150+ |

#### Other APIs

| API | Cost |
|-----|------|
| NocoDB | $0 (self-hosted) |
| ChangeDetection.io | $0 (self-hosted) |
| n8n | $0 (self-hosted) |
| Google Custom Search | $0 (100 free/day) or $5/1000 queries |
| RSS Feeds | $0 (public) |

### Total Monthly Cost Estimate

| Usage Level | Monthly Cost |
|-------------|--------------|
| **Low** | $5-10 |
| **Normal** | $15-25 |
| **High** | $40-60 |
| **Outbreak** | $100+ |

---

## Rate Limits & Quotas

| API | Rate Limit | Quota |
|-----|------------|-------|
| OpenAI | 500 RPM (tier 1) | Based on account tier |
| NocoDB | None (self-hosted) | Disk space |
| ChangeDetection.io | None (self-hosted) | Memory/CPU |
| Google Custom Search | 100/day free | 10,000/day paid |
| RSS Feeds | None | None |

### Handling Rate Limits

```python
import asyncio
from tenacity import retry, wait_exponential, stop_after_attempt

@retry(wait=wait_exponential(min=1, max=60), stop=stop_after_attempt(5))
async def call_api_with_retry():
    # API call here
    pass
```

---

## Environment Variables Summary

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# NocoDB
NOCODB_API_URL=http://nocodb:8080/api/v1
NOCODB_API_TOKEN=nc_...
NOCODB_TABLE_ID=m0s3bmpa8qzp4eh

# ChangeDetection.io
CHANGEDETECTION_URL=https://changedetection.fayaa92.sa
CHANGEDETECTION_API_KEY=<CHANGEDETECTION_API_KEY>

# Google (optional)
GOOGLE_SEARCH_API_KEY=your_key_here
GOOGLE_SEARCH_ENGINE_ID=your_cx_here

# n8n (optional)
N8N_DIGEST_WEBHOOK_URL=https://n8n.fayaa92.sa/webhook/...

# RSS Feeds
WHO_RSS_URL=https://www.who.int/rss-feeds/news-english.xml
CDC_RSS_URL=https://tools.cdc.gov/podcasts/feed.asp?feedid=183
```

---

## Security Considerations

1. **API Key Storage**: All keys stored in `.env` file, not in code
2. **Docker Secrets**: Consider using Docker secrets for production
3. **Network Isolation**: Internal services (NocoDB, n8n) accessed via Docker network
4. **HTTPS**: All external APIs accessed via HTTPS
5. **Token Rotation**: Rotate API keys periodically

---

## Troubleshooting

### OpenAI API Errors

```bash
# Check API key validity
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### NocoDB Connection Issues

```bash
# Test NocoDB connectivity
curl -H "xc-token: $NOCODB_API_TOKEN" \
  http://nocodb:8080/api/v2/meta/bases
```

### ChangeDetection.io Issues

```bash
# Test API connectivity
curl -H "x-api-key: $CHANGEDETECTION_API_KEY" \
  https://changedetection.fayaa92.sa/api/v1/watch
```

---

*Documentation maintained by DarDab - Health Surveillance Specialist*
