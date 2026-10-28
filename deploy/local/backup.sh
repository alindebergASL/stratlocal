#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Use the base project's service identities explicitly. `start` resumes existing
# containers with their original mounts, including any optional overrides.
compose() { docker compose -p strategylocal -f compose.yaml --env-file .env "$@"; }
mkdir -p ../../local-backups
name="snapshot-$(date -u +%Y%m%dT%H%M%SZ)"
running=$(compose ps --status running --services)
resume=''
for service in $running; do
  case "$service" in app|worker) resume="$resume $service" ;; esac
done
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$resume" ]; then
    # Service names above are a fixed allowlist, not paths or user input.
    compose start $resume || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
compose stop app worker
compose run --rm --no-deps --user 0 --entrypoint node \
  -v "$(cd ../../local-backups && pwd):/backups" app \
  /app/snapshot.mjs backup /app/data "/backups/$name"
printf 'Backup saved: local-backups/%s\n' "$name"
