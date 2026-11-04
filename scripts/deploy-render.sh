#!/bin/bash
# Render deploy driver for CartGuard (free plan, ephemeral SQLite).
# Reads RENDER_API_KEY from .tools/render_key and app secrets from .env.
# Never prints secret values; masks any accidental echo.
set -u
cd "$(dirname "$0")/.."   # repo root

if [ ! -f .tools/render_key ]; then
  echo "RENDER_API_KEY file missing (.tools/render_key)"; exit 1
fi
RENDER_API_KEY=$(cat .tools/render_key)

# Load app env values from .env (never displayed)
set -a; source .env; set +a

mask() { sed -E "s/(${PAYPAL_CLIENT_ID:0:6})[A-Za-z0-9._-]*/\1***/g; s/(EOI-)[A-Za-z0-9._-]*/\1***/g; s/(BAA-)[A-Za-z0-9._-]*/\1***/g; s/(AQ\.)[A-Za-z0-9._-]*/\1***/g; s/(${ADMIN_TOKEN:0:4})[A-Za-z0-9]*/\1***/g; s/(${GATE_API_KEY:0:4})[A-Za-z0-9]*/\1***/g"; }

auth() { curl -s -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "$@"; }

parse_status() { python3 -c "
import json
d = json.load(open('$1'))
detail = d.get('serviceDetails') or {}
status = (detail.get('deployStatus') or {}).get('status', '')
print(status or '')
" 2>/dev/null; }

echo "== Render owner =="
auth "https://api.render.com/v1/owners?limit=1" -o .tools/owners.json
OWNER_ID=$(python3 -c "
import json
d = json.load(open('.tools/owners.json'))
print(d[0]['owner']['id'] if isinstance(d, list) and d else '')
")
if [ -z "$OWNER_ID" ]; then echo "FAILED to resolve owner"; exit 1; fi
echo "owner: $OWNER_ID"

echo "== Creating service (free plan, ephemeral SQLite) =="
ENV_VARS=$(python3 - <<'PYEOF'
import json, os, sys
keys = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "CHANNEL3_API_KEY", "GEMINI_API_KEY", "ADMIN_TOKEN", "GATE_API_KEY"]
values = {
    "NODE_VERSION": "22",
    "PAYPAL_API_BASE": "https://api-m.sandbox.paypal.com",
    "LLM_BASE_URL": os.environ.get("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"),
    "LLM_MODEL": os.environ.get("LLM_MODEL", "gemini-3.5-flash-lite"),
    "DB_PATH": "/tmp/cartguard.sqlite",
    "PUBLIC_BASE_URL": "https://cartguard.onrender.com",
}
missing = [k for k in keys if os.environ.get(k, "") == ""]
if missing:
    print(f"missing env: {missing}", file=sys.stderr)
    sys.exit(1)
for key in keys:
    values[key] = os.environ[key]
print(json.dumps([{"key": k, "value": v} for k, v in values.items()]))
PYEOF
) || { echo "aborting: missing env values"; exit 1; }

BODY=$(ENV_VARS="$ENV_VARS" OWNER_ID="$OWNER_ID" python3 - <<'PYEOF'
import json, os
env = json.loads(os.environ["ENV_VARS"])
print(json.dumps({
  "type": "web_service",
  "name": "cartguard",
  "ownerId": os.environ["OWNER_ID"],
  "repo": "https://github.com/ShouryaSahai/cartguard",
  "branch": "main",
  "autoDeploy": "yes",
  "serviceDetails": {
    "runtime": "node",
    "plan": "free",
    "buildCommand": "npm ci && npm run build",
    "startCommand": "npm run start -w @cartguard/api",
    "healthCheckPath": "/health",
    "envVars": env,
  },
}))
PYEOF
) || { echo "body build failed"; exit 1; }
ENV_VARS=""

CREATE=$(curl -s -X POST "https://api.render.com/v1/services" \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -d "$BODY")
echo "$CREATE" > .tools/service.json
SERVICE_ID=$(python3 -c "import json;print(json.load(open('.tools/service.json')).get('id',''))")
SERVICE_URL=$(python3 -c "import json;d=json.load(open('.tools/service.json'));print((d.get('serviceDetails') or {}).get('url',''))")
if [ -z "$SERVICE_ID" ]; then echo "FAILED to create service:"; cat .tools/service.json | mask | head -c 400; exit 1; fi
echo "service: $SERVICE_ID"
echo "url: $SERVICE_URL"

echo "== Waiting for first deploy (free builds take ~5-10 min) =="
STATUS=""
for i in $(seq 1 40); do
  sleep 20
  auth "https://api.render.com/v1/services/$SERVICE_ID" -o .tools/service.json
  STATUS=$(parse_status .tools/service.json)
  echo "  [$i] status: $STATUS"
  case "$STATUS" in
    live) break ;;
    *failed|canceled) echo "DEPLOY FAILED:"; cat .tools/service.json | mask | head -c 400; exit 1 ;;
  esac
done
[ "$STATUS" = "live" ] || { echo "deploy did not reach live in time"; exit 1; }

echo "== Health check =="
curl -s "$SERVICE_URL/health" | head -c 200; echo

echo "== Setting PUBLIC_BASE_URL to the real URL (triggers a final deploy) =="
curl -s -X PATCH "https://api.render.com/v1/services/$SERVICE_ID" \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -d "{\"autoDeploy\":\"yes\",\"envVars\":[{\"key\":\"PUBLIC_BASE_URL\",\"value\":\"$SERVICE_URL\"}]}" \
  -o .tools/patch.json
for i in $(seq 1 20); do
  sleep 20
  auth "https://api.render.com/v1/services/$SERVICE_ID" -o .tools/service.json
  STATUS=$(parse_status .tools/service.json)
  echo "  [$i] status: $STATUS"
  case "$STATUS" in live) break ;; *failed|canceled) echo "FINAL DEPLOY FAILED"; exit 1 ;; esac
done

echo "== Final health check =="
curl -s "$SERVICE_URL/health" | head -c 200; echo
echo "$SERVICE_URL" > .tools/render_url
echo "DEPLOY COMPLETE: $SERVICE_URL"
