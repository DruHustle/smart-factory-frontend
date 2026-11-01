#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$SCRIPT_DIR"
while [[ "$WORKSPACE" != / && ! -f "$WORKSPACE/AGENTS.md" ]]; do
  WORKSPACE="$(dirname -- "$WORKSPACE")"
done
MANUAL="$WORKSPACE/local-tools/manual deployment/deploy.py"
if [[ -f "$MANUAL" ]]; then
  exec python3 "$MANUAL" all --source-root "$(dirname -- "$SCRIPT_DIR")" "$@"
fi
printf '%s\n' 'Production uses the Oracle ARM64 API and singleton worker, with the Vercel UI.' 'The workspace entry point is "local-tools/manual deployment/deploy.py"; it defaults to an offline plan.' 'For standalone checkouts, follow deploy/oracle/README.md and docs/manual-vm-deployment.md.'
