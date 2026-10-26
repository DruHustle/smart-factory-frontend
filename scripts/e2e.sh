#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -p "${E2E_COMPOSE_PROJECT:-smart-factory-iot-e2e}" -f docker-compose.e2e.yml)
mock_aas_pid=""
cleanup() {
  if [[ -n "$mock_aas_pid" ]]; then
    kill "$mock_aas_pid" >/dev/null 2>&1 || true
    wait "$mock_aas_pid" 2>/dev/null || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" up -d --wait database redis

export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${E2E_DATABASE_PORT:-55432}/smart_factory_iot_e2e"
export TEST_DATABASE_URL="$DATABASE_URL"
export DATABASE_SSL_MODE=disable
export REDIS_URL=redis://127.0.0.1:${E2E_REDIS_PORT:-56379}
export TEST_REDIS_URL="$REDIS_URL"
export VITE_API_URL="http://127.0.0.1:${E2E_PORT:-3000}/api"
export JWT_SECRET="local-e2e-only-secret-that-is-at-least-32-bytes"
export NODE_ENV=development
export BACKEND_DEPLOYMENT_MODE=standalone
export PORT="${E2E_PORT:-3000}"
export ENABLE_DEMO_ACCOUNTS="${ENABLE_DEMO_ACCOUNTS:-true}"
export ENABLE_DEMO_DATA="${ENABLE_DEMO_DATA:-true}"
export ASSISTANT_PROVIDER=disabled
export ASSISTANT_GEMINI_API_KEY=
export ASSISTANT_GROQ_API_KEY=
export ASSISTANT_GROK_AI_API_KEY=
export INGESTION_API_TOKEN="local-e2e-ingestion-token"
export AAS_REPOSITORY_URL="http://127.0.0.1:18443/aas/"
export AAS_ALLOW_UNAUTHENTICATED_LOCAL=false
export AAS_OIDC_TOKEN_URL="http://127.0.0.1:18443/token"
export AAS_OIDC_CLIENT_ID="local-e2e-client"
export AAS_OIDC_CLIENT_SECRET="local-e2e-client-secret"
export AAS_PROVISIONING_API_URL="http://127.0.0.1:18443/api/assets"
export AAS_PROVISIONING_TOKEN="local-e2e-provisioning-secret-at-least-32-bytes"

node scripts/e2e-aas-upstream.mjs &
mock_aas_pid=$!

pnpm exec drizzle-kit migrate
pnpm test --maxWorkers="${E2E_TEST_WORKERS:-1}"

if [[ "${E2E_HEADED:-0}" == "1" ]]; then
  pnpm exec playwright test --headed "$@"
else
  pnpm exec playwright test "$@"
fi
