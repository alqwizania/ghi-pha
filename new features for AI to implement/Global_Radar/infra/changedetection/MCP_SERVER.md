# ChangeDetection MCP Server (STDIO)

This MCP server exposes safe ChangeDetection.io API operations through the Python MCP SDK.

## Location

- Compose: `infra/changedetection/docker-compose.yml`
- MCP code: `infra/changedetection/mcp/server.py`
- Service name: `changedetection-mcp`

## Scope (Safe Core)

- Included: list/get/search watches, create/update watch, pause/mute state, recheck, history/snapshot/diff, system info.
- Excluded: delete watch/tag and notification-admin endpoints.

## Start / Restart

```bash
cd /srv/docker/changedetection
docker compose up -d changedetection-mcp
docker compose restart changedetection-mcp
```

## Verify

```bash
docker ps --filter name=changedetection-mcp
docker logs changedetection-mcp --tail 50
```

## Environment Variables

The service reuses the ChangeDetection `.env` used by the packaged compose file.

- `CHANGEDETECTION_URL` (default: `http://changedetection:5000`)
- `CHANGEDETECTION_API_KEY` (optional)
- `SALTED_PASS` (fallback API key if `CHANGEDETECTION_API_KEY` is unset)
- `CHANGEDETECTION_TIMEOUT` (default: `30` seconds)

## OpenCode Client Configuration (workstation)

Add this MCP server entry in your local OpenCode config:

```json
{
  "mcpServers": {
    "changedetection": {
      "command": "ssh",
      "args": [
        "fayaalink",
        "docker",
        "exec",
        "-i",
        "changedetection-mcp",
        "sh",
        "-c",
        "cd /app && python server.py"
      ],
      "disabled": false
    }
  }
}
```

## Troubleshooting

- If the MCP service is restarting, check logs:
  - `docker logs changedetection-mcp --tail 100`
- If API calls fail with auth errors, verify API key env values in the ChangeDetection `.env`.
- If hostname resolution fails, confirm both containers are on `caddy_default` network.
