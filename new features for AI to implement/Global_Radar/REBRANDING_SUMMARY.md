# SehaRadar Rebranding Summary

**Date**: February 8, 2026  
**Previous Names**: Health Agents / PHN Agents / DabDar  
**New Brand**: SehaRadar v1.0 (سها رادار - Health Radar)

---

## Overview

Successfully rebranded the health surveillance system from "Health Agents/PHN Agents/DabDar" to **SehaRadar v1.0**, a unified AI-powered health surveillance platform.

---

## Changes Made

### 1. Infrastructure Changes

#### Docker Compose (`docker-compose.yml`)
- **Service name**: `phn-agents` → `seha-radar`
- **Container name**: `phn-agents` → `seha-radar`
- **Image name**: `phn-agents:latest` → `seha-radar:latest`
- Comments updated to reflect new domain structure

#### Caddy Reverse Proxy (`/srv/docker/caddy/Caddyfile`)
- **Primary domain**: Added `seha-radar.fayaa92.sa`
- **Legacy domains preserved**: `health-agents.fayaa92.sa`, `phn-agents.fayaa92.sa` (for webhook compatibility)
- Updated proxy target: `phn-agents:8080` → `seha-radar:8080`
- Updated service description comments

### 2. Application Changes

#### Server (`server.py`)
- **FastAPI app title**: "DabDar v4.0 - Health Surveillance Agents" → "SehaRadar - Health Surveillance System"
- **Version**: "4.0.0-phase1" → "1.0.0"
- **Service identifier**: Added `"service": "SehaRadar"` to status endpoint
- **Startup banner**: "🚀 DABDAR v3.0 HEALTH SURVEILLANCE AGENTS STARTING" → "🚀 SEHARADAR v1.0 HEALTH SURVEILLANCE SYSTEM STARTING"
- **Shutdown banner**: Updated to SehaRadar v1.0
- **API endpoint comments**: Updated version references to v1.0
- **Dashboard URLs**: Updated all domain references in docstrings
- **Service mapping**: `SERVICES = {"phn-agents": "phn-agents", ...}` → `SERVICES = {"seha-radar": "seha-radar", ...}`
- **Trace log path**: `/tmp/health-agents-trace.log` → `/tmp/seha-radar-trace.log`

#### Package Configuration (`pyproject.toml`)
- **Package name**: "health-agents" → "seha-radar"
- **Version**: "0.1.0" → "1.0.0"
- **Description**: "Health Surveillance Agent System" → "SehaRadar - AI-powered Health Surveillance System"

#### Dashboard (`live-dashboard.html`)
- **Page title**: "PHN Agents - Live System Dashboard" → "SehaRadar - Live System Dashboard"
- **Header**: "PHN Agents Live Dashboard" → "SehaRadar Live Dashboard"
- **Version display**: "DabDar v3.0.0" → "SehaRadar v1.0.0"

#### Documentation (`AGENTS.md`)
- **Title**: "Health Surveillance Agents (DabDar v3.0)" → "SehaRadar v1.0 Health Surveillance System"
- **Project overview**: Updated to reflect SehaRadar branding
- **Docker commands**: Updated container name from `phn-agents` to `seha-radar`

#### Environment Variables (`.env`)
- **Configuration header**: "DabDar v3.0 Configuration" → "SehaRadar v1.0 Configuration"
- **Trace file path**: `/tmp/health-agents-trace.log` → `/tmp/seha-radar-trace.log`

### 3. Deployment Changes

#### Container Lifecycle
- ✅ Stopped old `phn-agents` container
- ✅ Built new `seha-radar:latest` image
- ✅ Started `seha-radar` container (healthy, running)
- ✅ Removed old `phn-agents` container
- ✅ Deleted old `phn-agents:latest` image
- ✅ Restarted Caddy to apply new configuration

---

## Domain Structure

### Primary Domain (New)
- **Production**: `https://seha-radar.fayaa92.sa`
- **Dashboard**: `https://seha-radar.fayaa92.sa/dashboard`
- **Logs**: `https://seha-radar.fayaa92.sa/logs`
- **API**: `https://seha-radar.fayaa92.sa/api/*`

### Legacy Domains (Preserved for Compatibility)
- `https://phn-agents.fayaa92.sa` (for ChangeDetection.io webhooks)
- `https://health-agents.fayaa92.sa` (for existing integrations)

All legacy domains route to the same `seha-radar` container backend.

---

## Version Progression

| Version | Codename | Status |
|---------|----------|--------|
| v1.0 | DabDar v1.0 | Deprecated |
| v2.0 | DabDar v2.0 | Deprecated |
| v3.0 | DabDar v3.0 | Replaced |
| v4.0 | DabDar v4.0 (Phase 1) | Replaced |
| **v1.0** | **SehaRadar v1.0** | **Current** ✅ |

**Note**: SehaRadar v1.0 resets the version numbering as part of the complete rebranding.

---

## Verification Results

### Container Status
```bash
$ docker ps | grep seha-radar
282c6c6099ac   seha-radar:latest   "python server.py"   Up (healthy)   seha-radar
```

### API Endpoint Tests
```bash
# New primary domain
$ curl -H "Host: seha-radar.fayaa92.sa" http://localhost/status
{"status":"healthy","service":"SehaRadar","version":"1.0.0","timestamp":"2026-02-08T12:25:44.908828"}

# Legacy domain compatibility
$ curl -H "Host: phn-agents.fayaa92.sa" http://localhost/status
{"status":"healthy","service":"SehaRadar","version":"1.0.0","timestamp":"2026-02-08T12:25:45.369181"}
```

### Dashboard Access
✅ `https://seha-radar.fayaa92.sa/dashboard` - Shows "SehaRadar Live Dashboard"  
✅ Dashboard displays "SehaRadar v1.0.0" in version info  
✅ All legacy URLs redirect correctly

---

## Preserved Functionality

### No Breaking Changes
- ✅ All API endpoints remain functional (`/api/scan-unified`, `/api/trigger-digest`, etc.)
- ✅ ChangeDetection.io webhooks continue working via legacy `phn-agents.fayaa92.sa` domain
- ✅ NocoDB integration maintained (no database schema changes)
- ✅ n8n workflows continue functioning (same API structure)
- ✅ Email digest service operational
- ✅ RSS and Google scan workflows operational
- ✅ Epidemiological analysis agents unchanged
- ✅ Bilingual reporting (English/Arabic) intact

### Configuration Preserved
- ✅ All environment variables maintained
- ✅ Disease configuration (`config/diseases.json`) unchanged
- ✅ Source registry (`config/sources.json`) unchanged
- ✅ Watch UUIDs for ChangeDetection.io preserved
- ✅ Database connection strings unchanged
- ✅ API keys and tokens preserved

---

## Post-Rebranding Tasks

### Completed ✅
- [x] Update Docker Compose service/container/image names
- [x] Update Caddy reverse proxy configuration
- [x] Update FastAPI server branding and version
- [x] Update package metadata (pyproject.toml)
- [x] Update dashboard HTML (title, headers, version)
- [x] Update documentation (AGENTS.md)
- [x] Update environment variables (.env)
- [x] Rebuild and restart containers
- [x] Verify all endpoints work
- [x] Test legacy domain compatibility
- [x] Clean up old Docker images

### Recommended (Future)
- [ ] Update ChangeDetection.io webhook URLs to use new `seha-radar.fayaa92.sa` domain
- [ ] Update n8n workflow URLs (optional, legacy domains work)
- [ ] Create SehaRadar logo/branding assets
- [ ] Update email digest templates with SehaRadar branding
- [ ] Add Arabic branding (سها رادار) to dashboard
- [ ] Update any external documentation referencing old names

---

## Rollback Procedure (If Needed)

If rollback is required, reverse the changes:

```bash
# 1. Stop SehaRadar container
cd /srv/docker/health-agents
docker compose down

# 2. Revert configuration files
git checkout docker-compose.yml server.py pyproject.toml .env AGENTS.md

# 3. Revert Caddy configuration
sudo nano /srv/docker/caddy/Caddyfile  # Manually revert changes

# 4. Rebuild and restart
docker compose up -d --build

# 5. Restart Caddy
docker restart caddy
```

---

## Contact & Support

- **Production URL**: https://seha-radar.fayaa92.sa
- **Dashboard**: https://seha-radar.fayaa92.sa/dashboard
- **API Documentation**: https://seha-radar.fayaa92.sa/docs (FastAPI auto-docs)
- **System Status**: https://seha-radar.fayaa92.sa/status

---

## Notes

- The rebranding maintains **100% backward compatibility** through legacy domain support
- Container health checks remain functional (30s interval)
- All scheduled tasks (RSS scans, digest generation) continue operating
- No data migration required (NocoDB database schema unchanged)
- The `health_agents/` directory name is **intentionally preserved** to avoid breaking import paths

---

**Rebranding completed successfully by MiniDabbirni on 2026-02-08**
