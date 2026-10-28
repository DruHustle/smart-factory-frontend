#!/usr/bin/env bash
# Exercise existing private integration UI/artifacts with external exchange disabled.
set -euo pipefail
cd "$(dirname "$0")/../.."
export E2E_ONESA_PRIVATE=true E2E_ONESA_STATE=disabled
# The existing registration seed explicitly requires this disposable local target.
export E2E_DATABASE_PORT=55432
export WORKSPACE_E2E_PORT="${ONESA_E2E_PORT:-3108}"
bash scripts/workspace/e2e.sh --config=playwright.onesa.config.ts "$@"
