#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d "backend/.venv" ]; then
  python3 -m venv backend/.venv
fi
backend/.venv/bin/pip install -q -e backend
(cd backend && .venv/bin/python -m app.migration_tools upgrade)

if [ ! -d "frontend/node_modules" ]; then
  npm --prefix frontend install
fi

trap 'kill 0' EXIT INT TERM
(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
npm --prefix frontend run dev
