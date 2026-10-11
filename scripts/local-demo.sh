#!/usr/bin/env bash
# Restart/redeploy the already provisioned local Coolify demo without touching data.
set -euo pipefail
cd "$(dirname "$0")/.."
RUNTIME="$HOME/.local/share/izge/coolify"
test -f "$RUNTIME/resource.json" || { echo "Local Coolify setup is missing. See docs/LOCAL_DEMO.md." >&2; exit 1; }
docker info >/dev/null
docker compose --project-name izge-coolify --env-file "$RUNTIME/.env" -f deploy/coolify-local.compose.yml up -d
docker build -t izge-backend:local backend
docker build -t izge-frontend:local frontend
docker build -t izge-website:local -f deploy/website.Dockerfile .
python3 scripts/setup-codex-bridge.py
backend/.venv/bin/python scripts/configure-local-agent.py
python3 - <<'PY'
import json
import subprocess
import time
import urllib.request
from pathlib import Path

root = Path.home() / '.local/share/izge/coolify'
resource = json.loads((root / 'resource.json').read_text())
token = (root / 'ssh/local_api_token').read_text().strip()
service = resource['service_uuid']
request = urllib.request.Request(
    f'http://127.0.0.1:8000/api/v1/services/{service}/restart',
    data=b'{}', method='POST',
    headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
)
with urllib.request.urlopen(request, timeout=15) as response:
    assert response.status == 200
expected = {name: subprocess.check_output(['docker', 'image', 'inspect', f'izge-{name}:local', '--format', '{{.Id}}'], text=True).strip() for name in ['backend', 'frontend', 'website']}
expected['colleague'] = expected['backend']
for _ in range(180):
    try:
        current = {name: subprocess.check_output(['docker', 'inspect', f'{name}-{service}', '--format', '{{.Image}} {{.State.Health.Status}}'], text=True, stderr=subprocess.DEVNULL).strip() for name in expected}
        if all(current[name] == f'{image} healthy' for name, image in expected.items()):
            with urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3) as response:
                assert response.status == 200
            print('İzge: http://localhost:8080 | Website: http://localhost:8081 | Coolify: http://localhost:8000')
            break
    except (OSError, subprocess.CalledProcessError):
        pass
    time.sleep(1)
else:
    raise SystemExit('Deployment did not become healthy; inspect the Coolify deployment log.')
PY
