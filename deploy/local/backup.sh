#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p ../../local-backups
name="snapshot-$(date -u +%Y%m%dT%H%M%SZ)"
docker compose stop app worker
trap 'docker compose start app worker' EXIT HUP INT TERM
docker compose run --rm --no-deps --user 0 --entrypoint node \
  -v "$(cd ../../local-backups && pwd):/backups" app \
  /app/snapshot.mjs backup /app/data "/backups/$name"
printf 'Backup saved: local-backups/%s\n' "$name"
