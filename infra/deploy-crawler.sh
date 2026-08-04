#!/usr/bin/env bash
#
# Provisions the GHI crawler box: crawl4ai behind a bearer token, firewalled.
#
# This exists because six sources — Germany RKI, Japan MHLW, Hong Kong CHP, the
# WHO Mpox ShinyApps dashboard, China CDC and Italy's health ministry — render
# their content with JavaScript. A Cloudflare Worker cannot run a browser, so
# those sources have been reporting "requires JavaScript rendering" since the
# registry was built. This box runs the browser the Worker cannot.
#
# crawl4ai ships an official image with the FastAPI server built in, so nothing
# here installs Python, Playwright, or Chromium's forty-odd shared libraries by
# hand. That dependency chain drifting is the usual reason a self-built crawler
# stops working three months later.
#
# Run as root on a fresh Hetzner box:
#   scp infra/deploy-crawler.sh root@<IP>:/root/
#   ssh root@<IP> 'bash /root/deploy-crawler.sh'
#
set -euo pipefail

TOKEN_FILE=/root/.crawler-token
COMPOSE_DIR=/opt/ghi-crawler

echo "==> GHI crawler provisioning"

# ---------------------------------------------------------------- memory check
# Chromium holds 300-600MB per rendered page, and the JS-heavy sources on the
# blocked list are the worst offenders. Rather than assume the box is big
# enough, size the browser pool to what is actually here: running out of memory
# mid-render returns an empty page, which this system reads as "source is quiet"
# rather than "source failed" — the ambiguity worth avoiding above all others.
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if   [ "$MEM_MB" -ge 7000 ]; then POOL=4
elif [ "$MEM_MB" -ge 3500 ]; then POOL=2
else                              POOL=1
fi
echo "    memory: ${MEM_MB}MB -> browser pool ${POOL}"

# ------------------------------------------------------------------ prep
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ufw curl ca-certificates >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi

# ------------------------------------------------------------------ token
# Generated on the box and never transmitted: the operator reads it out at the
# end and puts it into the Worker's secrets themselves.
if [ ! -f "$TOKEN_FILE" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "==> generated a new API token"
else
  echo "==> reusing the existing API token"
fi
TOKEN=$(cat "$TOKEN_FILE")

# ------------------------------------------------------------------ compose
mkdir -p "$COMPOSE_DIR"
cat > "$COMPOSE_DIR/docker-compose.yml" <<COMPOSE
services:
  crawl4ai:
    image: unclecode/crawl4ai:latest
    container_name: ghi-crawl4ai
    restart: unless-stopped
    ports:
      - "11235:11235"
    environment:
      # Every request must present this as a bearer token.
      CRAWL4AI_API_TOKEN: "${TOKEN}"
      MAX_CONCURRENT_BROWSERS: "${POOL}"
    # Chromium needs more than Docker's 64MB default shared memory or it
    # crashes on pages with large DOMs — which is most dashboards.
    shm_size: 1gb
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:11235/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
COMPOSE

# ------------------------------------------------------------------ firewall
# Only SSH and the crawler port. The crawler is reachable from anywhere but
# useless without the token; restricting it further by source IP is unreliable
# because Cloudflare Workers egress from a large and changing pool.
echo "==> firewall"
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp    >/dev/null
ufw allow 11235/tcp >/dev/null
ufw --force enable  >/dev/null

# ------------------------------------------------------------------ start
echo "==> pulling image (this takes a few minutes)"
cd "$COMPOSE_DIR"
docker compose pull -q
docker compose up -d

echo "==> waiting for health"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:11235/health >/dev/null 2>&1; then
    echo "    healthy after ${i}0s"
    break
  fi
  sleep 10
done

IP=$(curl -fsS -4 ifconfig.me 2>/dev/null || echo "<this-server-ip>")

cat <<DONE

================================================================
 GHI crawler is up.

   URL     http://${IP}:11235
   Token   ${TOKEN}

 Set these as Worker secrets on your own machine:

   cd backend
   npx wrangler secret put CRAWLER_URL      # http://${IP}:11235
   npx wrangler secret put CRAWLER_TOKEN    # the token above

 And add the same two lines to backend/.dev.vars for local runs.

 Useful later:
   docker compose -f ${COMPOSE_DIR}/docker-compose.yml logs -f
   docker compose -f ${COMPOSE_DIR}/docker-compose.yml restart
================================================================
DONE
