#!/usr/bin/env bash
# Native viewer qualification uses ONLY this repository, PostgreSQL and Redis.
set -euo pipefail
cd "$(dirname "$0")/../.."
export E2E_DATABASE_PORT="${E2E_DATABASE_PORT:-55436}"
export E2E_REDIS_PORT="${E2E_REDIS_PORT:-56383}"
export PORT="${NATIVE_E2E_PORT:-3113}"
compose=(docker compose --env-file /dev/null -p smart-factory-native-e2e -f docker-compose.e2e.yml)
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" 2>/dev/null || true; fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
unset ONESA_ENABLED ONESA_INSTALLATION_ID ONESA_WORKSPACE_ID ONESA_CONTRACT_ID ONESA_INGESTION_URL ONESA_APPROVED_ORIGIN ONESA_SERVICE_TOKEN ONESA_ALLOW_LOCAL_HTTP ONESA_RECEIVER_DATABASE_URL
export DOTENV_CONFIG_PATH=/dev/null NODE_ENV=development DATABASE_SSL_MODE=disable
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$E2E_DATABASE_PORT/smart_factory_e2e"
export REDIS_URL="redis://127.0.0.1:$E2E_REDIS_PORT"
export JWT_SECRET=isolated-native-equipment-session-secret-32-bytes
export ENABLE_DEMO_ACCOUNTS=false ENABLE_DEMO_DATA=true ASSISTANT_PROVIDER=disabled BACKEND_DEPLOYMENT_MODE=standalone
export VITE_API_URL=/api
export NATIVE_E2E_BASE_URL="http://127.0.0.1:$PORT"
"${compose[@]}" up -d --wait database redis
pnpm exec drizzle-kit migrate
node --import tsx scripts/equipment/seed-test-account.ts
node --import tsx server/_core/index.ts &
server_pid=$!
node --input-type=module -e 'const end=Date.now()+60000;while(true){try{if((await fetch(process.env.NATIVE_E2E_BASE_URL+"/health/ready")).ok)break;}catch{}if(Date.now()>end)throw new Error("Standalone app did not become ready");await new Promise(r=>setTimeout(r,250));}'
E2E_EQUIPMENT_STANDALONE=true pnpm exec playwright test --config=playwright.equipment.config.ts "$@"
