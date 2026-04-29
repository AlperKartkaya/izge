#!/usr/bin/env bash
set -Eeuo pipefail

HOST="${IZGE_EC2_HOST:-}"
USER_NAME="${IZGE_EC2_USER:-ubuntu}"
SSH_KEY="${IZGE_SSH_KEY:-}"
REMOTE_RELEASE="${IZGE_REMOTE_RELEASE:-/tmp/izge-release}"
REMOTE_APP_ROOT="${IZGE_REMOTE_APP_ROOT:-/srv/izge/current}"
SKIP_LOCAL_CHECKS=0
SKIP_PUBLIC_SMOKE=0
RUN_EVAL=0

usage() {
  cat <<'USAGE'
Usage: deploy/redeploy-ec2.sh [options]

Redeploy the current Izge repo to the MVP EC2 host.

Defaults:
  user: ubuntu

Options:
  --host HOST              EC2 host or public IP. Required unless IZGE_EC2_HOST is set.
  --user USER              SSH user. Default: ubuntu
  -i, --identity-file KEY  SSH private key path. Or set IZGE_SSH_KEY.
  --skip-local-checks      Skip local JS/static/git checks before upload.
  --skip-public-smoke      Skip public HTTPS smoke checks after deploy.
  --run-eval               Run isolated backend seed eval on EC2 after deploy.
  -h, --help               Show this help.

Examples:
  deploy/redeploy-ec2.sh --host EC2_PUBLIC_IP -i ~/.ssh/izge.pem
  IZGE_EC2_HOST=EC2_PUBLIC_IP IZGE_SSH_KEY=~/.ssh/izge.pem deploy/redeploy-ec2.sh
  deploy/redeploy-ec2.sh --host EC2_PUBLIC_IP --user ubuntu --run-eval
USAGE
}

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"; shift 2 ;;
    --user)
      USER_NAME="${2:-}"; shift 2 ;;
    -i|--identity-file)
      SSH_KEY="${2:-}"; shift 2 ;;
    --skip-local-checks)
      SKIP_LOCAL_CHECKS=1; shift ;;
    --skip-public-smoke)
      SKIP_PUBLIC_SMOKE=1; shift ;;
    --run-eval)
      RUN_EVAL=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      fail "Unknown option: $1" ;;
  esac
done

[[ -n "$HOST" ]] || fail "Host is required. Pass --host EC2_PUBLIC_IP or set IZGE_EC2_HOST."
[[ -n "$USER_NAME" ]] || fail "SSH user is required"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v ssh >/dev/null || fail "ssh is required"
command -v rsync >/dev/null || fail "rsync is required"

SSH_OPTS=(
  -o BatchMode=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=4
  -o StrictHostKeyChecking=accept-new
)
if [[ -n "$SSH_KEY" ]]; then
  [[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY"
  SSH_OPTS+=(-i "$SSH_KEY")
fi

SSH_TARGET="${USER_NAME}@${HOST}"
RSYNC_RSH="ssh ${SSH_OPTS[*]}"

if [[ "$SKIP_LOCAL_CHECKS" -eq 0 ]]; then
  log "Running local preflight checks"
  node --check website/i18n.js
  node --check website/memory-field.js
  python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
HTMLParser().feed(Path('website/index.html').read_text())
css = Path('website/styles.css').read_text()
assert css.count('{') == css.count('}'), 'unbalanced CSS braces in website/styles.css'
print('local static sanity ok')
PY
  python3 -m compileall -q backend/app backend/manual_eval
  (cd frontend && npm run build && npm run lint)
  git diff --check
else
  warn "Skipping local checks"
fi

log "Checking SSH access to ${SSH_TARGET}"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" 'printf "connected to %s\n" "$(hostname)"'

log "Uploading repo to ${SSH_TARGET}:${REMOTE_RELEASE}"
rsync -az --delete \
  -e "$RSYNC_RSH" \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.omx' \
  --exclude '.sisyphus' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'backend/.venv' \
  --exclude 'backend/data' \
  --exclude 'backend/dist' \
  --exclude 'backend/*.egg-info' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  ./ "$SSH_TARGET:$REMOTE_RELEASE/"

log "Running remote deploy"
REMOTE_RUN_EVAL="$RUN_EVAL" ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "REMOTE_RELEASE='$REMOTE_RELEASE' REMOTE_APP_ROOT='$REMOTE_APP_ROOT' RUN_EVAL='$RUN_EVAL' bash -s" <<'REMOTE'
set -Eeuo pipefail

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33mWARN: %s\033[0m\n' "$*" >&2; }
show_backend_logs() {
  warn "Backend did not become healthy. Recent systemd status/logs follow."
  sudo systemctl status izge-backend --no-pager -l || true
  sudo journalctl -u izge-backend -n 120 --no-pager || true
}
wait_for_url() {
  url="$1"
  label="$2"
  attempts="${3:-30}"
  delay="${4:-2}"

  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf '%s healthy after %s attempt(s)\n' "$label" "$attempt"
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

: "${REMOTE_RELEASE:=/tmp/izge-release}"
: "${REMOTE_APP_ROOT:=/srv/izge/current}"
: "${RUN_EVAL:=0}"

log "Syncing release into ${REMOTE_APP_ROOT}"
sudo mkdir -p "$REMOTE_APP_ROOT" /srv/izge/data /var/www/izge/website /var/www/izge/app
sudo rsync -a --delete "$REMOTE_RELEASE/" "$REMOTE_APP_ROOT/"
sudo chown -R izge:izge "$REMOTE_APP_ROOT" /srv/izge/data

log "Refreshing backend package"
if [[ ! -x /srv/izge/venv/bin/pip ]]; then
  sudo -u izge python3 -m venv /srv/izge/venv
fi
sudo -u izge /srv/izge/venv/bin/pip install --upgrade pip
sudo -u izge /srv/izge/venv/bin/pip install -e "$REMOTE_APP_ROOT/backend"

log "Restarting backend"
sudo systemctl daemon-reload
sudo systemctl restart izge-backend
if ! sudo systemctl is-active --quiet izge-backend; then
  show_backend_logs
  exit 1
fi
if ! wait_for_url http://127.0.0.1:8000/health "backend" 45 2; then
  show_backend_logs
  exit 1
fi

log "Publishing marketing website"
sudo rsync -a --delete "$REMOTE_APP_ROOT/website/" /var/www/izge/website/

log "Building frontend"
if sudo -u izge bash -lc "cd '$REMOTE_APP_ROOT/frontend' && npm ci && npm run build"; then
  printf 'frontend built as izge user\n'
else
  warn "izge-user npm build failed; falling back to root npm install/build and repairing ownership"
  sudo bash -lc "cd '$REMOTE_APP_ROOT/frontend' && npm install && npm run build"
  sudo chown -R izge:izge "$REMOTE_APP_ROOT/frontend"
fi

log "Publishing frontend app"
sudo rsync -a --delete "$REMOTE_APP_ROOT/frontend/dist/" /var/www/izge/app/
sudo chown -R www-data:www-data /var/www/izge

log "Reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

log "Remote smoke checks"
curl -fsSI --retry 10 --retry-connrefused --retry-delay 2 -H 'Host: izge.dev' http://127.0.0.1/ >/dev/null
curl -fsSI --retry 10 --retry-connrefused --retry-delay 2 -H 'Host: app.izge.dev' http://127.0.0.1/ >/dev/null
curl -fsS --retry 10 --retry-connrefused --retry-delay 2 -H 'Host: app.izge.dev' http://127.0.0.1/health >/dev/null

if [[ "$RUN_EVAL" == "1" ]]; then
  log "Running isolated backend seed eval"
  if ! sudo -u izge bash -lc "cd '$REMOTE_APP_ROOT/backend' && /srv/izge/venv/bin/python -m manual_eval.run_isolated_seed_eval"; then
    warn "Seed eval failed. Deploy is still published; inspect backend logs before demo."
    exit 1
  fi
fi

log "Remote deploy complete"
REMOTE

if [[ "$SKIP_PUBLIC_SMOKE" -eq 0 ]]; then
  log "Public smoke checks"
  curl -fsSI --retry 10 --retry-connrefused --retry-delay 2 https://izge.dev >/dev/null
  curl -fsSI --retry 10 --retry-connrefused --retry-delay 2 https://app.izge.dev >/dev/null
  curl -fsS --retry 10 --retry-connrefused --retry-delay 2 https://app.izge.dev/health >/dev/null
else
  warn "Skipping public smoke checks"
fi

log "Deploy finished"
printf 'Marketing: https://izge.dev\nApp:       https://app.izge.dev\nAPI:       https://app.izge.dev/api\n'
