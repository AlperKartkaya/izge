#!/bin/sh
set -eu

case "${PORT:-}" in
  ''|*[!0-9]*) echo "PORT must be a number." >&2; exit 1 ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "PORT must be between 1 and 65535." >&2
  exit 1
fi

export IZGE_TRUST_RAILWAY_PROXY="${IZGE_TRUST_RAILWAY_PROXY:-false}"
case "$IZGE_TRUST_RAILWAY_PROXY" in
  true|false) ;;
  *) echo "IZGE_TRUST_RAILWAY_PROXY must be true or false." >&2; exit 1 ;;
esac
envsubst '${PORT} ${IZGE_TRUST_RAILWAY_PROXY}' < /etc/nginx/templates/izge.conf.template > /etc/nginx/conf.d/default.conf
umask 077
mkdir -p "$IZGE_STORAGE_ROOT" "$IZGE_PASTED_TEXT_ROOT"
python -m app.migration_tools upgrade
chown -R www-data:www-data /data

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf

