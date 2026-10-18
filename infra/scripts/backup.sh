#!/bin/bash
#
# backup.sh: the nightly encrypted, off-site backup of the server (WP-8 D7 and Trace 2; ADR-051
# restating ADR-050 "Backup destination" and ADR-027's scope; ADR-017 for the chat checkpoints).
# Installed root-owned, mode 755, as /srv/jadero/bin/backup.sh, run as root by
# jadero-backup.service (infra/systemd/). The restore side is infra/scripts/restore.sh; the drill
# and the one-time setup are in docs/runbooks/restore.md.
#
# Usage:
#   backup.sh           back up every item, then forget and prune, then send the heartbeat
#   backup.sh --check   read back 5% of the repository's data (jadero-backup-check.service)
#
# What one run saves, each item its own restic snapshot read from a command's output
# (`--stdin-from-command`), all tagged with the same `run-<UTC time>` tag:
#   - uptime-kuma-data.tar         Uptime Kuma's data folder, copied while Kuma is stopped
#   - <database>.dump              every database of the ops Postgres, found at run time in
#                                  pg_database (not the templates, not `postgres`), pg_dump -Fc
#   - rabbitmq-definitions.json    the broker's definitions export (users, vhosts, queues);
#                                  queued messages are not backed up (ADR-027: the outbox resends)
#   - backup-run.complete          written last, only when every item above was saved: the
#                                  list of the run's items, so a restore can pick a whole night
#
# Fail loudly: restic runs each dump command itself and saves no snapshot when the command exits
# non-zero (a plain `pg_dump | restic backup --stdin` would save a truncated dump). A failed
# item does not stop the others, but the run then exits 1, skips forget and prune and sends no
# heartbeat: the Uptime Kuma push monitor (a dead man's switch) alerts when no heartbeat came.
#
# Configuration: the root-only env file (default /etc/jadero/backup.env, rendered from
# infra/env/backup.env.tpl, BACKUP_ENV_FILE to change it). The container names default to the
# jadero-ops Compose project (infra/compose/compose.ops.yml); the env file may override them,
# which infra/scripts/backup-check.sh does to run this script against throwaway containers.
# Logs one line per item to stdout (the journal): names, sizes and snapshot ids, never a value
# from the env file, never data.

set -euo pipefail
export LC_ALL=C

readonly ENV_FILE="${BACKUP_ENV_FILE:-/etc/jadero/backup.env}"

# Data of the LangGraph checkpoint tables is never backed up (ADR-017: conversations live 24
# hours and stay on the server); their structure is, so a restored agent database still boots.
# The schema is `checkpoints` (ADR-017); the table names are PostgresSaver's, confirmed by WP-22.
# A pattern that matches nothing is not an error. restore.sh keeps the same list.
readonly EXCLUDED_TABLE_DATA=(checkpoints.checkpoints checkpoints.checkpoint_blobs checkpoints.checkpoint_writes)

log() { printf 'backup: %s\n' "$*"; }
die() {
  printf 'backup: %s\n' "$*" >&2
  exit 1
}

mode=backup
case "${1:-}" in
  "") ;;
  --check) mode=check ;;
  *)
    echo "usage: backup.sh [--check]" >&2
    exit 2
    ;;
esac

# The env file holds the repository password and the storage key: it must be root's and closed
# to everyone else before it is read.
[[ -f "$ENV_FILE" ]] || die "no env file at $ENV_FILE"
read -r file_owner file_mode < <(stat -c '%u %a' "$ENV_FILE")
if [[ "$file_owner" != 0 || ! "$file_mode" =~ ^[0-7]00$ ]]; then
  die "$ENV_FILE must be owned by root with no group or other access (owner uid $file_owner, mode $file_mode)"
fi
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

# Names only, never values.
require() {
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || die "$name is not set in $ENV_FILE"
  done
}
require RESTIC_REPOSITORY
[[ -n "${RESTIC_PASSWORD:-}" || -n "${RESTIC_PASSWORD_FILE:-}" ]] ||
  die "RESTIC_PASSWORD (or RESTIC_PASSWORD_FILE) is not set in $ENV_FILE"
if [[ "$RESTIC_REPOSITORY" == s3:* ]]; then
  require AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
fi

readonly POSTGRES_CONTAINER="${BACKUP_POSTGRES_CONTAINER:-jadero-ops-postgres-1}"
readonly RABBITMQ_CONTAINER="${BACKUP_RABBITMQ_CONTAINER:-jadero-ops-rabbitmq-1}"
readonly KUMA_CONTAINER="${BACKUP_KUMA_CONTAINER:-jadero-ops-uptime-kuma-1}"
# The volume's mount point in compose.ops.yml.
readonly KUMA_DATA=/app/data
# A fixed host name for the snapshots, so their history does not split if the machine's changes.
readonly SNAPSHOT_HOST="${BACKUP_HOST:-jadero-ops}"
# Another run or the weekly check may hold the repository lock; wait for it instead of failing.
readonly RETRY_LOCK=1h

# Sends a GET to a push URL. The URL carries the monitor's token, so it goes to curl through its
# config on stdin (never in argv, which other users can read in the process list) and is never
# printed; curl's own messages are silenced for the same reason.
send_heartbeat() {
  local url="$1" status=0
  curl -fs --max-time 20 --retry 3 --retry-delay 10 --retry-connrefused --config - >/dev/null \
    <<<"url = \"$url\"" || status=$?
  if [[ "$status" -eq 0 ]]; then
    log "heartbeat sent"
  else
    log "FAILED to send the heartbeat (curl exit $status)"
    return 1
  fi
}

if [[ "$mode" == check ]]; then
  log "checking the repository structure and reading back 5% of its data"
  restic check --retry-lock "$RETRY_LOCK" --read-data-subset=5%
  if [[ -n "${BACKUP_CHECK_HEARTBEAT_URL:-}" ]]; then
    send_heartbeat "$BACKUP_CHECK_HEARTBEAT_URL"
  fi
  exit 0
fi

require BACKUP_HEARTBEAT_URL

RUN_TAG="run-$(date -u +%Y%m%dT%H%M%SZ)"
readonly RUN_TAG
start=$SECONDS
saved=()
failed=()

# Saves one item: restic runs the command and stores its stdout as /<name>. On success logs the
# snapshot id and size; on failure records the item and lets the run go on.
#   backup_item <name> <tag> <command> [args...]
backup_item() {
  local name="$1" tag="$2" out id bytes
  shift 2
  if out=$(restic backup --retry-lock "$RETRY_LOCK" --json --quiet --host "$SNAPSHOT_HOST" \
    --tag "jadero,$tag,$RUN_TAG" --stdin-from-command --stdin-filename "$name" -- "$@"); then
    id=$(grep -o '"snapshot_id":"[0-9a-f]*"' <<<"$out" | cut -c16-23 || true)
    bytes=$(grep -o '"total_bytes_processed":[0-9]*' <<<"$out" | cut -d: -f2 || true)
    log "saved $name (snapshot ${id:-unknown}, ${bytes:-?} bytes)"
    saved+=("$name")
  else
    [[ -z "$out" ]] || printf '%s\n' "$out" >&2
    log "FAILED $name: no snapshot saved"
    failed+=("$name")
  fi
}

log "run $RUN_TAG to the restic repository"

# Uptime Kuma (owner's choice, option A): its SQLite database is copied only while Kuma is
# stopped, so the copy is consistent; Kuma is down for those seconds. The trap starts it again
# however this script ends (an error, a signal, systemd's stop timeout).
kuma_stopped=0
start_kuma() {
  if [[ "$kuma_stopped" -eq 1 ]]; then
    if docker start "$KUMA_CONTAINER" >/dev/null; then
      kuma_stopped=0
      log "started $KUMA_CONTAINER again"
    else
      log "FAILED to start $KUMA_CONTAINER again"
      return 1
    fi
  fi
}
trap start_kuma EXIT
trap 'log "stopped by a signal"; exit 1' TERM INT HUP

if docker stop --time 30 "$KUMA_CONTAINER" >/dev/null; then
  kuma_stopped=1
  log "stopped $KUMA_CONTAINER for a consistent copy of its data"
  # `docker cp` of a stopped container streams the folder, volume included, as a tar.
  backup_item uptime-kuma-data.tar uptime-kuma docker cp "$KUMA_CONTAINER:$KUMA_DATA" -
  start_kuma || failed+=("start $KUMA_CONTAINER")
else
  log "FAILED to stop $KUMA_CONTAINER: its data is not backed up in this run"
  failed+=(uptime-kuma-data.tar)
fi

# Every database, found at run time so a new one is never forgotten. A database that exists but
# cannot be dumped (no connections allowed, a bad name) is a failure, not a skip.
if databases=$(docker exec "$POSTGRES_CONTAINER" psql -U postgres -d postgres -AtX -v ON_ERROR_STOP=1 \
  -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname") &&
  [[ -n "$databases" ]]; then
  exclude_args=()
  for pattern in "${EXCLUDED_TABLE_DATA[@]}"; do
    exclude_args+=("--exclude-table-data=$pattern")
  done
  while IFS= read -r db; do
    if [[ ! "$db" =~ ^[a-z0-9_]+$ ]]; then
      log "FAILED a database whose name is not lowercase letters, digits and underscores"
      failed+=("a database with an unexpected name")
      continue
    fi
    backup_item "$db.dump" postgres docker exec "$POSTGRES_CONTAINER" pg_dump -U postgres -Fc "${exclude_args[@]}" "$db"
  done <<<"$databases"
else
  log "FAILED to list the databases in $POSTGRES_CONTAINER"
  failed+=("database list")
fi

backup_item rabbitmq-definitions.json rabbitmq \
  docker exec "$RABBITMQ_CONTAINER" rabbitmqctl --quiet export_definitions - --format json

if [[ "${#failed[@]}" -gt 0 ]]; then
  log "FAILED after $((SECONDS - start))s: ${failed[*]}; saved: ${saved[*]:-nothing}; no forget, no heartbeat"
  exit 1
fi

# The marker that makes this run a complete night for restore.sh.
backup_item backup-run.complete run printf '%s\n' "$RUN_TAG" "${saved[@]}"
if [[ "${#failed[@]}" -gt 0 ]]; then
  log "FAILED to write the run marker; no forget, no heartbeat"
  exit 1
fi

# Retention per item (host and path): 7 daily and 4 weekly, then the unreferenced data goes.
if restic forget --retry-lock "$RETRY_LOCK" --quiet --host "$SNAPSHOT_HOST" --tag jadero \
  --group-by host,paths --keep-daily 7 --keep-weekly 4 --prune >/dev/null; then
  log "forget and prune done (7 daily, 4 weekly per item)"
else
  log "FAILED forget and prune; no heartbeat"
  exit 1
fi

# Kuma restarted at the start of the run; give it time to be ready before pushing to it.
for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$KUMA_CONTAINER" 2>/dev/null || true)" =~ ^(healthy|running)$ ]] && break
  sleep 5
done

send_heartbeat "$BACKUP_HEARTBEAT_URL"
log "done in $((SECONDS - start))s: ${#saved[@]} items"
