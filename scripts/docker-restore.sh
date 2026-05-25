#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/docker-restore.sh <backup.tar.gz> --force

Restores the Izge Docker /data volume from a backup created by scripts/docker-backup.sh.
This overwrites /data/izge.db, /data/storage, /data/pasted, and bootstrap credentials.
Stop running services first: docker compose down
USAGE
}

if [[ $# -ne 2 || "${2:-}" != "--force" ]]; then
  usage
  exit 2
fi

ARCHIVE="$1"
if [[ ! -f "$ARCHIVE" ]]; then
  echo "Backup archive not found: $ARCHIVE" >&2
  exit 2
fi
ARCHIVE_ABS="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
ARCHIVE_DIR="$(dirname "$ARCHIVE_ABS")"
ARCHIVE_NAME="$(basename "$ARCHIVE_ABS")"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNNING_SERVICES="$(docker compose ps --services --filter status=running 2>/dev/null || true)"
if [[ -n "$RUNNING_SERVICES" && "${IZGE_RESTORE_ALLOW_RUNNING:-}" != "1" ]]; then
  echo "Refusing to restore while Compose services are running:" >&2
  echo "$RUNNING_SERVICES" >&2
  echo "Run 'docker compose down' first, or set IZGE_RESTORE_ALLOW_RUNNING=1 if you know the risk." >&2
  exit 3
fi

docker compose run --rm --no-deps -T \
  -v "$ARCHIVE_DIR:/restore-input:ro" \
  -e IZGE_RESTORE_ARCHIVE="/restore-input/$ARCHIVE_NAME" \
  backend sh -s <<'CONTAINER_SCRIPT'
set -eu
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

tar -xzf "$IZGE_RESTORE_ARCHIVE" -C "$TMP_DIR"

if [ ! -f "$TMP_DIR/manifest.json" ]; then
  echo "Archive is missing manifest.json; refusing restore." >&2
  exit 4
fi

python - "$TMP_DIR/manifest.json" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
if manifest.get('schema_version') != 'izge_backup.v1':
    raise SystemExit(f"Unsupported backup schema: {manifest.get('schema_version')!r}")
PY

rm -f /data/izge.db /data/izge.db-shm /data/izge.db-wal
rm -rf /data/storage /data/pasted
rm -f /data/bootstrap_admin_credentials.json

if [ -f "$TMP_DIR/izge.db" ]; then
  cp "$TMP_DIR/izge.db" /data/izge.db
fi
if [ -d "$TMP_DIR/storage" ]; then
  cp -a "$TMP_DIR/storage" /data/storage
else
  mkdir -p /data/storage
fi
if [ -d "$TMP_DIR/pasted" ]; then
  cp -a "$TMP_DIR/pasted" /data/pasted
else
  mkdir -p /data/pasted
fi
if [ -f "$TMP_DIR/bootstrap_admin_credentials.json" ]; then
  cp "$TMP_DIR/bootstrap_admin_credentials.json" /data/bootstrap_admin_credentials.json
fi
CONTAINER_SCRIPT

printf 'Restored Izge Docker volume from: %s\n' "$ARCHIVE" >&2
