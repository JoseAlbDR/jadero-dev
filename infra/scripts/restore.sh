#!/bin/bash
#
# restore.sh: the restore side of infra/scripts/backup.sh (WP-8 D7, Trace 2; ADR-051 restating
# ADR-050 "Backup destination": the restore drill is the acceptance test). Restores databases
# into a throwaway Postgres container with no network, never into the live one, prints the row
# count of every table (next to the live database's with --compare) and the time it took. The
# steps around it (the drill, a real restore, restoring from the laptop) are in
# docs/runbooks/restore.md.
#
# Runs on the server (as root, installed as /srv/jadero/bin/restore.sh) or on the owner's laptop:
# it needs only bash, restic, docker and the backup env (RESTIC_REPOSITORY, RESTIC_PASSWORD, and
# AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for the S3 backend), from the environment or from
# --env-file (on the laptop: --env-file <(op inject -i infra/env/backup.env.tpl), so nothing is
# written to disk).
#
# Usage:
#   restore.sh [--env-file FILE] snapshots
#       the snapshots and the complete runs (a run whose backup-run.complete marker exists)
#   restore.sh [--env-file FILE] all [--run RUN] [--compare CONTAINER] [--strict] [--keep]
#       every database of one complete run (default: the latest), all from the same night
#   restore.sh [--env-file FILE] db [--run RUN] [--compare CONTAINER] [--strict] [--keep] DB...
#       the named databases (default: the latest snapshot of each, whatever its run)
#   restore.sh [--env-file FILE] dump [--run RUN] ITEM OUTPUT
#       one item to a file, e.g. rabbitmq-definitions.json or uptime-kuma-data.tar
#
#   --run RUN            a run tag as `snapshots` prints it (run-20261018T023000Z)
#   --compare CONTAINER  also count the rows in that live Postgres container and mark differences
#   --strict             exit 3 when a count differs (tables excluded by design never count)
#   --keep               leave the throwaway container running, for a look inside
#
# Why all databases from the same night (ADR-050 consequences): each service's outbox marks an
# event as sent once the broker took it. Restoring only one database to last night leaves its
# consumers holding events it no longer has, or it holding events they never got; the outbox
# will not resend them.

set -euo pipefail
export LC_ALL=C

# The ops Postgres image of infra/compose/compose.ops.yml, so the restore runs the same server
# and extensions; scripts/backup-scripts.test.mjs keeps the two equal.
readonly POSTGRES_IMAGE=pgvector/pgvector:0.8.7-pg18-trixie@sha256:9d9c930220cb9bf2f956d10a8f909cf9973d9672ca0278aef2c1e6facccad2e0

# The tables whose data backup.sh never saves (ADR-017); their counts are shown, never compared.
readonly EXCLUDED_TABLE_DATA=(checkpoints.checkpoints checkpoints.checkpoint_blobs checkpoints.checkpoint_writes)

log() { printf 'restore: %s\n' "$*"; }
die() {
  printf 'restore: %s\n' "$*" >&2
  exit 1
}
usage() {
  sed -n '/^# Usage:/,/^#   --keep/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

env_file=""
if [[ "${1:-}" == --env-file ]]; then
  [[ -n "${2:-}" ]] || usage
  env_file="$2"
  shift 2
fi
command="${1:-}"
[[ -n "$command" ]] || usage
shift

run=""
compare=""
strict=0
keep=0
args=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run)
      run="${2:-}"
      shift 2 || usage
      ;;
    --compare)
      compare="${2:-}"
      shift 2 || usage
      ;;
    --strict)
      strict=1
      shift
      ;;
    --keep)
      keep=1
      shift
      ;;
    -*) usage ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done
[[ -z "$run" || "$run" =~ ^run-[0-9]{8}T[0-9]{6}Z$ ]] || die "--run takes a run tag like run-20261018T023000Z"

if [[ -n "$env_file" ]]; then
  [[ -r "$env_file" ]] || die "cannot read $env_file"
  # Read once, then evaluate: macOS's bash 3.2 sources an empty file from a pipe such as the
  # laptop's <(op inject ...), and a pipe cannot be read twice.
  env_text="$(cat "$env_file")"
  set -a
  eval "$env_text"
  set +a
  unset env_text
fi
[[ -n "${RESTIC_REPOSITORY:-}" ]] || die "RESTIC_REPOSITORY is not set"
[[ -n "${RESTIC_PASSWORD:-}" || -n "${RESTIC_PASSWORD_FILE:-}" ]] || die "RESTIC_PASSWORD (or RESTIC_PASSWORD_FILE) is not set"
if [[ "$RESTIC_REPOSITORY" == s3:* ]]; then
  for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    [[ -n "${!name:-}" ]] || die "$name is not set"
  done
fi

# The run tags of the complete runs, oldest first.
complete_runs() {
  restic snapshots --json --tag jadero --path /backup-run.complete |
    { grep -o '"run-[0-9]\{8\}T[0-9]\{6\}Z"' || true; } | tr -d '"' | sort -u
}

# restic's selector for the latest snapshot of an item, within a run when one is given.
#   select_args <item>  (sets the array `selector`)
select_args() {
  selector=(--path "/$1")
  [[ -z "$run" ]] || selector+=(--tag "$run")
}

workdir=$(mktemp -d)
container=""
cleanup() {
  if [[ -n "$container" && "$keep" -eq 0 ]]; then
    docker rm -f -v "$container" >/dev/null 2>&1 || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

# The row count of every table of a database: "schema.table count" lines, sorted.
#   count_rows <container> <database>
count_rows() {
  docker exec -i "$1" psql -U postgres -d "$2" -AtX -F ' ' -v ON_ERROR_STOP=1 <<'SQL' | sort
SELECT format('SELECT %L, count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1 \gexec
SQL
}

# Prints the counts of one restored database, next to the live ones with --compare.
# Returns 1 when a compared count differs on a table whose data is backed up.
#   report_counts <database>
report_counts() {
  local db="$1" restored="$workdir/$1.restored" live="$workdir/$1.live"
  count_rows "$container" "$db" >"$restored"
  if [[ -z "$compare" ]]; then
    printf '  %-56s %10s\n' table restored
    awk '{ printf "  %-56s %10s\n", $1, $2 }' "$restored"
    return 0
  fi
  count_rows "$compare" "$db" >"$live"
  printf '  %-56s %10s %10s\n' table live restored
  awk -v excluded="${EXCLUDED_TABLE_DATA[*]}" '
    BEGIN { n = split(excluded, list, " "); for (i = 1; i <= n; i++) skip[list[i]] = 1 }
    FNR == NR { live[$1] = $2; seen[$1] = 1; next }
    { restored[$1] = $2; seen[$1] = 1 }
    END {
      for (t in seen) print t, ((t in live) ? live[t] : "-"), ((t in restored) ? restored[t] : "-"), ((t in skip) ? 1 : 0)
    }' "$live" "$restored" | sort | awk '
    {
      note = ""
      if ($4 == 1) note = "  data not backed up (ADR-017)"
      else if ($2 != $3) { note = "  DIFFERS"; differs = 1 }
      printf "  %-56s %10s %10s%s\n", $1, $2, $3, note
    }
    END { exit differs }'
}

# Starts the throwaway Postgres: no network at all, trust inside (nothing can reach it), data in
# an anonymous volume removed with the container. Ready when it answers on TCP, which the image's
# temporary init server never listens on.
start_throwaway() {
  container="jadero-restore-$$"
  log "starting the throwaway container $container (no network)"
  docker run -d --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust \
    "$POSTGRES_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres && return 0
    sleep 1
  done
  die "the throwaway container did not become ready"
}

# Restores the databases given as arguments and reports each one's counts.
#   restore_databases <db>...
restore_databases() {
  local db status=0 start=$SECONDS
  for db in "$@"; do
    [[ "$db" =~ ^[a-z0-9_]+$ ]] || die "not a database name: $db"
  done
  start_throwaway
  for db in "$@"; do
    select_args "$db.dump"
    log "restoring $db"
    # --create makes the database under its own name; no owners or grants, since the throwaway
    # has none of the service roles (a real restore runs provision.sql first, see the runbook).
    restic dump "${selector[@]}" latest "/$db.dump" |
      docker exec -i "$container" pg_restore -U postgres --create --no-owner --no-privileges \
        --exit-on-error -d postgres
  done
  log "restored ${#} database(s) in $((SECONDS - start))s (the measured restore time)"
  for db in "$@"; do
    log "row counts of $db"
    report_counts "$db" || status=3
  done
  if [[ "$keep" -eq 1 ]]; then
    log "kept $container; remove it with: docker rm -f -v $container"
  fi
  if [[ "$status" -ne 0 ]]; then
    log "some counts differ from the live database (DIFFERS above)"
    [[ "$strict" -eq 0 ]] || exit 3
  fi
}

case "$command" in
  snapshots)
    [[ "${#args[@]}" -eq 0 ]] || usage
    restic snapshots --tag jadero
    log "complete runs (every item saved), oldest first:"
    complete_runs | sed 's/^/  /'
    ;;
  all)
    [[ "${#args[@]}" -eq 0 ]] || usage
    if [[ -z "$run" ]]; then
      run=$(complete_runs | tail -n 1)
      [[ -n "$run" ]] || die "no complete run in the repository"
    fi
    marker=$(restic dump --path /backup-run.complete --tag "$run" latest /backup-run.complete) ||
      die "$run has no backup-run.complete marker: not a complete run"
    databases=()
    while IFS= read -r item; do
      if [[ "$item" == *.dump ]]; then
        databases+=("${item%.dump}")
      fi
    done <<<"$marker"
    [[ "${#databases[@]}" -gt 0 ]] || die "$run holds no database"
    log "run $run: ${databases[*]}"
    restore_databases "${databases[@]}"
    ;;
  db)
    [[ "${#args[@]}" -gt 0 ]] || usage
    restore_databases "${args[@]}"
    ;;
  dump)
    [[ "${#args[@]}" -eq 2 ]] || usage
    [[ "${args[0]}" =~ ^[A-Za-z0-9_.-]+$ ]] || die "not an item name: ${args[0]}"
    [[ ! -e "${args[1]}" ]] || die "${args[1]} exists; pick a new file"
    select_args "${args[0]}"
    (umask 077 && restic dump "${selector[@]}" latest "/${args[0]}" >"${args[1]}")
    log "wrote ${args[0]} to ${args[1]} (mode 600)"
    ;;
  *) usage ;;
esac
