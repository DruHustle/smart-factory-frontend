#!/usr/bin/env bash
# Opt-in test of Smart Factory's own companion repositories, no peer consumer.
set -euo pipefail
cd "$(dirname "$0")/../.."
compose=(docker compose --env-file /dev/null -p smart-factory-v4-provenance -f docker-compose.e2e.yml -f docker-compose.onesa.yml)
server_pid=""
cleanup(){ if [[ -n "$server_pid" ]];then kill "$server_pid" >/dev/null 2>&1 || true;wait "$server_pid" 2>/dev/null || true;fi;"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
unset ONESA_ENABLED ONESA_INSTALLATION_ID ONESA_WORKSPACE_ID ONESA_CONTRACT_ID ONESA_INGESTION_URL ONESA_APPROVED_ORIGIN ONESA_SERVICE_TOKEN ONESA_ALLOW_LOCAL_HTTP
export DOTENV_CONFIG_PATH=/dev/null NODE_ENV=development DATABASE_SSL_MODE=disable
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/smart_factory_iot_e2e REDIS_URL=redis://127.0.0.1:56379
export JWT_SECRET=isolated-provenance-proof-session-secret-32-bytes INGESTION_API_TOKEN=isolated-onesa-dashboard-bridge PORT=3108
export ENABLE_DEMO_ACCOUNTS=false ENABLE_DEMO_DATA=false ASSISTANT_PROVIDER=disabled BACKEND_DEPLOYMENT_MODE=standalone VITE_API_URL=/api
DOTNET_ROLL_FORWARD=Major dotnet build ../smart-factory-iot-backend/src/Services/TelemetryService/TelemetryService.csproj -c Release -m:1 -nr:false
"${compose[@]}" up -d --wait database redis onesa-broker onesa-telemetry-database
pnpm exec drizzle-kit migrate
node --import tsx scripts/equipment/provenance-path.ts seed
"${compose[@]}" up -d onesa-telemetry
# Keep the receiver absent initially; source acceptance must remain durable.
node --input-type=module -e 'const end=Date.now()+90000;while(true){try{if((await fetch("http://127.0.0.1:51885/health/ready")).ok)break;}catch{}if(Date.now()>end)throw Error("MQTT subscriber not ready");await new Promise(r=>setTimeout(r,500));}'
../smart-factory-iot-edge/raspberry-pi/.venv/bin/python scripts/onesa/scenario.py v4-simulated-path simulated
../smart-factory-iot-edge/raspberry-pi/.venv/bin/python scripts/onesa/scenario.py v4-replay-path replay
sleep 8
node --import tsx scripts/equipment/provenance-path.ts outage
"${compose[@]}" exec -T onesa-telemetry-database psql -U postgres -d telemetry_onesa_test -c 'select count(*) as persisted,count(*) filter(where "DashboardForwardedAt" is null) as pending,max("DeliveryAttempts") as attempts from "TelemetryRecords";'
node --import tsx server/_core/index.ts > /private/tmp/smart-factory-provenance-node.log 2>&1 &
server_pid=$!
for attempt in {1..50};do
 if node --import tsx scripts/equipment/provenance-path.ts verify;then break;fi
 if [[ "$attempt" == 50 ]];then exit 1;fi
 sleep 1
done
"${compose[@]}" exec -T onesa-telemetry-database psql -U postgres -d telemetry_onesa_test -c 'select count(*) as persisted,count(*) filter(where "DashboardForwardedAt" is not null) as acknowledged,count(*) filter(where "DeliveryQuarantinedAt" is not null) as quarantined from "TelemetryRecords";'
