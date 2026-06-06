#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OLLAMA_BASE_URL="${IZGE_LOCAL_LLM_BASE_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${IZGE_LOCAL_LLM_MODEL:-qwen3.5:4b}"

python3 - "$OLLAMA_BASE_URL" "$OLLAMA_MODEL" <<'PY'
import json
import sys
import urllib.request

base_url = sys.argv[1].rstrip("/")
model = sys.argv[2]
with urllib.request.urlopen(f"{base_url}/api/tags", timeout=5) as response:
    payload = json.loads(response.read().decode("utf-8"))
models = sorted(item.get("name") for item in payload.get("models", []) if isinstance(item, dict))
if model not in models:
    raise SystemExit(f"Ollama model {model!r} is not available at {base_url}. Available: {models}")
print(f"Ollama gateway ready at {base_url}; model {model} is available.")
PY

cd "$ROOT_DIR/backend"
PYTHON_BIN="${PYTHON:-python}"
if [[ -z "${PYTHON:-}" && -x "$ROOT_DIR/backend/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/backend/.venv/bin/python"
fi
env \
  IZGE_LOCAL_LLM_BASE_URL="$OLLAMA_BASE_URL" \
  IZGE_LOCAL_LLM_MODEL="$OLLAMA_MODEL" \
  IZGE_LOCAL_LLM_TIMEOUT_SECONDS="${IZGE_LOCAL_LLM_TIMEOUT_SECONDS:-90}" \
  IZGE_LLM_QUERY_ROUTING_ENABLED="${IZGE_LLM_QUERY_ROUTING_ENABLED:-true}" \
  IZGE_LLM_ANSWER_SYNTHESIS_ENABLED="${IZGE_LLM_ANSWER_SYNTHESIS_ENABLED:-false}" \
  IZGE_LLM_SIGNAL_EXPLANATION_ENABLED="${IZGE_LLM_SIGNAL_EXPLANATION_ENABLED:-false}" \
  "$PYTHON_BIN" -m manual_eval.run_isolated_seed_eval
