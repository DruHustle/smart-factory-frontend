#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export E2E_DATABASE_PORT="${E2E_DATABASE_PORT:-0}" E2E_REDIS_PORT="${E2E_REDIS_PORT:-0}" PORT="${PUBLIC_DEMO_E2E_PORT:-3126}"
compose=(docker compose --env-file /dev/null -p "${PUBLIC_DEMO_COMPOSE_PROJECT:-smart-factory-public-demo-e2e}" -f docker-compose.e2e.yml)
server_pid=""
cleanup(){ if [[ -n "$server_pid" ]]; then kill "$server_pid" >/dev/null 2>&1 || true; wait "$server_pid" 2>/dev/null || true; fi; "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
unset ONESA_ENABLED ONESA_INSTALLATION_ID ONESA_WORKSPACE_ID ONESA_CONTRACT_ID ONESA_INGESTION_URL ONESA_APPROVED_ORIGIN ONESA_SERVICE_TOKEN ONESA_ALLOW_LOCAL_HTTP ONESA_RECEIVER_DATABASE_URL ASSISTANT_GEMINI_API_KEY ASSISTANT_GROQ_API_KEY ASSISTANT_GROK_AI_API_KEY
export DOTENV_CONFIG_PATH=/dev/null NODE_ENV=development DATABASE_SSL_MODE=disable
export JWT_SECRET=isolated-workspace-fixture-session-secret-32-bytes ENABLE_DEMO_ACCOUNTS=true ENABLE_DEMO_DATA=true ASSISTANT_PROVIDER=disabled BACKEND_DEPLOYMENT_MODE=standalone VITE_API_URL=/api
export SECURITY_NATIVE_MODE=simulated SECURITY_SCENARIO_RUN_ID=isolated-workspace-http PUBLIC_DEMO_E2E=true PUBLIC_DEMO_E2E_BASE_URL="http://127.0.0.1:$PORT"
export INGESTION_API_TOKEN=isolated-workspace-ingestion-token
"${compose[@]}" up -d --wait database redis
# Let Docker reserve free loopback ports atomically. Fixed ports can collide with
# another disposable runner or a host's ephemeral connections.
database_endpoint="$("${compose[@]}" port database 5432)"
redis_endpoint="$("${compose[@]}" port redis 6379)"
export DATABASE_URL="postgres://postgres:postgres@$database_endpoint/smart_factory_e2e" REDIS_URL="redis://$redis_endpoint"
pnpm exec drizzle-kit migrate
node --import tsx scripts/security/seed-test-accounts.ts
node --import tsx scripts/workspace/seed.ts
node --import tsx --input-type=module -e 'const {initializeDemoAccounts}=await import("./server/initDemoAccounts.ts");await initializeDemoAccounts();const {closeDatabase}=await import("./server/db.ts");await closeDatabase();'
SHOWCASE_SEED=true SHOWCASE_COMPLETE=true node --import tsx scripts/showcase/seed.ts
SHOWCASE_SEED=true node --import tsx scripts/showcase/verify.ts
node --import tsx server/_core/index.ts > "${TMPDIR:-/tmp}/public-demo-e2e-server.log" 2>&1 &
server_pid=$!
node --input-type=module -e 'const end=Date.now()+60000;while(true){try{if((await fetch(process.env.PUBLIC_DEMO_E2E_BASE_URL+"/health/ready")).ok)break;}catch{}if(Date.now()>end)throw new Error("Workspace fixture app not ready");await new Promise(r=>setTimeout(r,250));}'
pnpm exec playwright test --config="${PUBLIC_DEMO_PLAYWRIGHT_CONFIG:-playwright.public-demo.config.ts}" "$@"
