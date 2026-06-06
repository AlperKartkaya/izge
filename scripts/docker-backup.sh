#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${IZGE_BACKUP_DIR:-$ROOT_DIR/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_PATH="${1:-$BACKUP_DIR/izge-data-$TIMESTAMP.tar.gz}"

mkdir -p "$(dirname "$OUT_PATH")"
TMP_OUT="$(mktemp "$(dirname "$OUT_PATH")/.izge-backup.tmp.XXXXXX")"
cleanup_host() {
  rm -f "$TMP_OUT"
}
trap cleanup_host EXIT

cd "$ROOT_DIR"

docker compose run --rm --no-deps -T backend sh -s <<'CONTAINER_SCRIPT' > "$TMP_OUT"
set -eu
TMP_DIR="$(mktemp -d)"
export TMP_DIR
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
mkdir -p "$TMP_DIR/storage" "$TMP_DIR/pasted"

python - <<'PY'
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sqlite3
from datetime import datetime, timezone

tmp_dir = Path(os.environ['TMP_DIR'])
src = Path('/data/izge.db')
dst = tmp_dir / 'izge.db'
if src.exists():
    source = sqlite3.connect(str(src))
    try:
        target = sqlite3.connect(str(dst))
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()

for name in ('storage', 'pasted'):
    source_dir = Path('/data') / name
    target_dir = tmp_dir / name
    if target_dir.exists():
        shutil.rmtree(target_dir)
    if source_dir.exists():
        shutil.copytree(source_dir, target_dir, symlinks=False)
    else:
        target_dir.mkdir(parents=True, exist_ok=True)

credentials = Path('/data/bootstrap_admin_credentials.json')
if credentials.exists():
    shutil.copy2(credentials, tmp_dir / 'bootstrap_admin_credentials.json')

manifest = {
    'schema_version': 'izge_backup.v1',
    'created_at': datetime.now(timezone.utc).isoformat(),
    'contents': {
        'sqlite': dst.exists(),
        'storage_dir': (tmp_dir / 'storage').exists(),
        'pasted_dir': (tmp_dir / 'pasted').exists(),
        'bootstrap_credentials': (tmp_dir / 'bootstrap_admin_credentials.json').exists(),
    },
    'restore_command': 'scripts/docker-restore.sh <archive> --force',
}
(tmp_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
PY

tar -C "$TMP_DIR" -czf - .
CONTAINER_SCRIPT

mv "$TMP_OUT" "$OUT_PATH"
trap - EXIT
printf 'Created Izge Docker volume backup: %s\n' "$OUT_PATH" >&2
