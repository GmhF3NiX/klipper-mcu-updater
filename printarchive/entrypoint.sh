#!/bin/sh
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"

if ! getent group appgroup >/dev/null 2>&1; then
  addgroup -g "$PGID" appgroup 2>/dev/null || addgroup appgroup
fi
if ! id appuser >/dev/null 2>&1; then
  adduser -D -H -u "$PUID" -G appgroup appuser 2>/dev/null || adduser -D -H -G appgroup appuser
fi

mkdir -p "$CONFIG_DIR"
chown -R appuser:appgroup "$CONFIG_DIR" || true

echo "Starte als PUID=$PUID PGID=$PGID"
exec su-exec appuser:appgroup node server/index.js
