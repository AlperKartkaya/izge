#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose build backend

docker compose run --rm --no-deps -T \
  -e IZGE_DEFAULT_ADMIN_PASSWORD=change-me-admin \
  -e IZGE_SYNC_DEFAULT_ADMIN_PASSWORD=true \
  backend python -m manual_eval.run_isolated_seed_eval
