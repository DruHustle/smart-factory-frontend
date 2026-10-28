#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'Production uses the Oracle ARM64 API and singleton worker, with the Vercel UI.' 'Follow deploy/oracle/README.md to qualify and promote the immutable API image first.' 'The deploy-vercel-oracle.yml workflow promotes the UI after successful main CI and runtime compatibility checks.' 'The legacy Render release workflow stays gated off.'
