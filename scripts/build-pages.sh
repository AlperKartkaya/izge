#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${ROOT_DIR}/_site}"
BASE_PATH="${PAGES_BASE_PATH:-}"
BASE_PATH="${BASE_PATH%/}"
DEMO_BASE="${BASE_PATH}/demo/"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/demo"

cp "${ROOT_DIR}/website/index.html" \
   "${ROOT_DIR}/website/styles.css" \
   "${ROOT_DIR}/website/hero-motion.css" \
   "${ROOT_DIR}"/website/*.js \
   "${OUT_DIR}/"
cp -R "${ROOT_DIR}/website/assets" "${OUT_DIR}/assets"

VITE_BASE_PATH="${DEMO_BASE}" VITE_STATIC_DEMO="true" npm --prefix "${ROOT_DIR}/frontend" run build
cp -R "${ROOT_DIR}/frontend/dist/." "${OUT_DIR}/demo/"

for route in \
  sign-in query team-chat memory artifacts tasks automations notifications \
  ingestion graph memory-filesystem orchestration readiness operations \
  admin admin/users admin/data audit
do
  mkdir -p "${OUT_DIR}/demo/${route}"
  cp "${OUT_DIR}/demo/index.html" "${OUT_DIR}/demo/${route}/index.html"
done

node -e '
const fs = require("node:fs");
const path = require("node:path");
const outDir = process.argv[1];
const snap = JSON.parse(fs.readFileSync(path.join(outDir, "demo/demo-snapshot.json"), "utf8"));
const html = fs.readFileSync(path.join(outDir, "demo/index.html"), "utf8");
for (const sig of snap.signals || []) {
  const dir = path.join(outDir, "demo/signals", sig.signal_id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}
' "${OUT_DIR}"

cp "${OUT_DIR}/demo/index.html" "${OUT_DIR}/404.html"
touch "${OUT_DIR}/.nojekyll"
