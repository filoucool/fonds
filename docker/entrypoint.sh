#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/app/backups /data/pool-1/archives /data/exports
  chown -R fonds:fonds /data
  exec runuser -u fonds -- "$@"
fi
exec "$@"
