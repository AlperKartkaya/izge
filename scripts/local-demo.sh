#!/usr/bin/env bash
# Generic local Compose only. Never delete volumes or assume a hosted control plane.
set -euo pipefail
cd "$(dirname "$0")/.."
docker info >/dev/null
docker compose up -d --build
printf 'İzge: http://localhost:8080 | Website: http://localhost:8081\n'
