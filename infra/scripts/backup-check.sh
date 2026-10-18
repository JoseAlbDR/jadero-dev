#!/bin/bash
#
# backup-check.sh: runs infra/scripts/backup.sh and restore.sh against throwaway containers and
# checks what they promise (WP-8 step 6; D7 and Trace 3a): every database is found and saved,
# a dump that fails saves no snapshot and sends no heartbeat, a failed run's other items are
# forgotten so retention keeps the complete run of the same day, Uptime Kuma is always started
# again, a whole night restores into a container with no network and its row counts match the
# live ones (the checkpoint tables' data excepted, ADR-017), and no secret reaches the output.
# Run by the `backup` job of ci.yml and by `pnpm backup:check`, on a machine with Docker; never
# on the server.
#
# The containers: Postgres, RabbitMQ and Uptime Kuma with the images of
# infra/compose/compose.ops.yml (read from it, so they cannot drift), and a runner built from
# the pinned docker CLI image with restic 0.19.1 copied from its official image. The runner
# reaches the others through the Docker socket only (`docker exec`, as on the server); every
# container runs with no network. The restic repository is a local folder in the runner (the
# server's is S3 on Backblaze B2: the backend changes, the scripts do not), and the heartbeat
# goes to a stub listener on the runner's loopback that records each request.

set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."

readonly RESTIC_IMAGE=docker.io/restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510
readonly DOCKER_CLI_IMAGE=docker.io/library/docker:29.4.0-cli@sha256:2efe7c8e806b35050def6ba1ba0ddad67b521a0a6d37f4910b3d88f11b495d03

# The image of a compose.ops.yml service, by the start of its reference.
compose_image() {
  sed -n "s|^ *image: *\($1:[^ ]*@sha256:[0-9a-f]\{64\}\)$|\1|p" infra/compose/compose.ops.yml | head -n 1
}
POSTGRES_IMAGE=$(compose_image pgvector/pgvector)
RABBITMQ_IMAGE=$(compose_image rabbitmq)
KUMA_IMAGE=$(compose_image louislam/uptime-kuma)
for image in "$POSTGRES_IMAGE" "$RABBITMQ_IMAGE" "$KUMA_IMAGE"; do
  [[ -n "$image" ]] || { echo "backup-check: an image is missing from compose.ops.yml" >&2; exit 1; }
done

readonly P=jadero-backup-check
readonly PG="$P-postgres" MQ="$P-rabbitmq" KUMA="$P-uptime-kuma" RUNNER="$P-runner"
readonly KUMA_VOLUME="$P-uptime-kuma-data" RUNNER_IMAGE="$P-runner:local"
# Fake secrets: if either shows up in any output, the check fails. The password carries a space,
# `$`, `;`, a backtick and `&`: unless the template quotes it, sourcing the env file breaks or runs
# `id`, and restic opens the repository with another password than the one it was created with.
# shellcheck disable=SC2016 # the `$HOME` and the backtick must stay literal
readonly SECRET_PASSWORD='check restic $HOME;`id`&5d1f'
readonly SECRET_TOKEN=check-push-token-8b2e

cleanup() {
  docker rm -f -v "$PG" "$MQ" "$KUMA" "$RUNNER" >/dev/null 2>&1 || true
  docker volume rm "$KUMA_VOLUME" >/dev/null 2>&1 || true
  if [[ -n "${restored_container:-}" ]]; then
    docker rm -f -v "$restored_container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
cleanup

status=0
started=$SECONDS
outputs=$(mktemp)
pass() { printf 'ok    %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  status=1
}
check() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$2', got '${3:-nothing}')"; fi; }
show() { sed 's/^/      | /'; }

# Runs a command in the runner, keeps its output for the privacy check, sets `rc` and `out`.
run() {
  rc=0
  out=$(docker exec -i "$RUNNER" "$@" 2>&1) || rc=$?
  printf '%s\n' "$out" >>"$outputs"
}
in_runner() { docker exec -i "$RUNNER" "$@"; }
restic_json() { in_runner bash -c 'set -a; . /etc/jadero/backup.env; set +a; restic snapshots --json "$@"' _ "$@"; }
count() { grep -c "$1" || true; }
pg() { docker exec -i "$PG" psql -U postgres -d "${1:-postgres}" -qAtX -v ON_ERROR_STOP=1; }

echo "backup-check: building the runner (docker CLI, restic 0.19.1, bash, curl)"
docker build -q -t "$RUNNER_IMAGE" - >/dev/null <<DOCKERFILE
FROM $RESTIC_IMAGE AS restic
FROM $DOCKER_CLI_IMAGE
RUN apk add --no-cache bash curl
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
DOCKERFILE

echo "backup-check: starting Postgres, RabbitMQ and Uptime Kuma as compose.ops.yml runs them"
# Postgres as its own user with the repo's pg_hba.conf: the superuser only over the socket (peer),
# so backup.sh's `docker exec ... -U postgres` works here exactly as it must on the server.
docker run -d --name "$PG" --network none --user postgres -e POSTGRES_PASSWORD=unused-in-the-check \
  -v "$PWD/infra/postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro" \
  "$POSTGRES_IMAGE" postgres -c hba_file=/etc/postgresql/pg_hba.conf >/dev/null
docker run -d --name "$MQ" --network none --hostname rabbitmq --user rabbitmq "$RABBITMQ_IMAGE" >/dev/null
docker run -d --name "$KUMA" --network none -e UPTIME_KUMA_DB_TYPE=sqlite \
  -v "$KUMA_VOLUME:/app/data" --health-cmd extra/healthcheck --health-interval 3s \
  "$KUMA_IMAGE" >/dev/null
docker run -d --name "$RUNNER" --network none -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD/infra:/infra:ro" --entrypoint sleep "$RUNNER_IMAGE" 3600 >/dev/null

wait_for() {
  local what="$1"
  shift
  for _ in $(seq 1 90); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "backup-check: $what did not become ready" >&2
  exit 1
}
wait_for Postgres docker exec "$PG" pg_isready -q -h 127.0.0.1
wait_for RabbitMQ docker exec "$MQ" rabbitmq-diagnostics -q check_running
kuma_health() { docker inspect -f '{{.State.Health.Status}}' "$KUMA"; }
wait_for "Uptime Kuma" test "$(kuma_health)" = healthy

# Two service databases: tables owned by a role the restore container does not have, a grant,
# the vector extension and the LangGraph checkpoint schema of ADR-017.
pg <<'SQL'
CREATE ROLE content_check LOGIN;
CREATE DATABASE content_check;
CREATE DATABASE agent_check;
\c content_check
CREATE SCHEMA content;
CREATE TABLE content.posts (id int PRIMARY KEY, title text NOT NULL);
INSERT INTO content.posts SELECT g, 'post ' || g FROM generate_series(1, 3) g;
CREATE TABLE content.revisions (id int PRIMARY KEY, post_id int REFERENCES content.posts (id));
INSERT INTO content.revisions SELECT g, 1 + g % 3 FROM generate_series(1, 5) g;
ALTER TABLE content.posts OWNER TO content_check;
GRANT SELECT ON content.revisions TO content_check;
\c agent_check
CREATE EXTENSION vector;
CREATE TABLE public.chunks (id int PRIMARY KEY, embedding vector(3));
INSERT INTO public.chunks SELECT g, '[1,2,3]' FROM generate_series(1, 4) g;
CREATE SCHEMA checkpoints;
CREATE TABLE checkpoints.checkpoints (thread_id text, payload text);
CREATE TABLE checkpoints.checkpoint_blobs (thread_id text, blob bytea);
CREATE TABLE checkpoints.checkpoint_writes (thread_id text, payload text);
CREATE TABLE checkpoints.checkpoint_migrations (v int PRIMARY KEY);
INSERT INTO checkpoints.checkpoints VALUES ('t1', 'a visitor question'), ('t2', 'another');
INSERT INTO checkpoints.checkpoint_blobs VALUES ('t1', '\x01'), ('t2', '\x02');
INSERT INTO checkpoints.checkpoint_writes VALUES ('t1', 'w'), ('t2', 'w');
INSERT INTO checkpoints.checkpoint_migrations VALUES (1);
SQL
docker exec "$MQ" rabbitmqctl -q add_vhost /check >/dev/null

# The env file is the real template with each 1Password reference replaced by a test value, so a
# value the template cannot carry through `set -a; . file` (the push URL's `&`, the password's
# symbols) fails here first. sed_text escapes a value for a sed replacement (`\`, `|` and `&`).
# shellcheck disable=SC2001 # `${v//&/...}` treats `&` differently across bash versions
sed_text() { sed 's/[\\|&]/\\&/g' <<<"$1"; }
in_runner sh -c 'install -d -m 700 /etc/jadero && umask 077 && cat >/etc/jadero/backup.env' <<ENV
$(sed -e "s|^RESTIC_REPOSITORY=.*|RESTIC_REPOSITORY='/repo'|" \
  -e "s|{{ op://jadero-ops/backup-restic/password }}|$(sed_text "$SECRET_PASSWORD")|" \
  -e "s|{{ op://jadero-ops/uptime-kuma-backup-push-url/password }}|http://127.0.0.1:8080/api/push/$SECRET_TOKEN?status=up\&msg=OK\&ping=|" \
  -e 's|{{ op://jadero-ops/\([a-z0-9-]*\)/\([a-z]*\) }}|check-\1-\2|' infra/env/backup.env.tpl)
BACKUP_POSTGRES_CONTAINER=$PG
BACKUP_RABBITMQ_CONTAINER=$MQ
BACKUP_KUMA_CONTAINER=$KUMA
ENV
in_runner bash -c 'set -a; . /etc/jadero/backup.env; set +a; restic init -q'
# The heartbeat stub: one request per accepted connection, appended to a file.
docker exec -d "$RUNNER" bash -c 'while true; do printf "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok" | nc -l -s 127.0.0.1 -p 8080 >>/tmp/heartbeat-requests; done'
heartbeats() { in_runner sh -c 'grep -c "^GET /api/push/" /tmp/heartbeat-requests 2>/dev/null || true'; }

echo
echo "== the env file is checked before anything runs"
in_runner sh -c 'grep -v "^RESTIC_PASSWORD=" /etc/jadero/backup.env >/tmp/missing.env; chmod 600 /tmp/missing.env'
run env BACKUP_ENV_FILE=/tmp/missing.env bash /infra/scripts/backup.sh
check "a missing variable stops the run, named" "1 RESTIC_PASSWORD (or RESTIC_PASSWORD_FILE) is not set" \
  "$rc $(sed -n 's/^backup: \(RESTIC_PASSWORD.*\) in .*/\1/p' <<<"$out")"
in_runner sh -c 'cp /etc/jadero/backup.env /tmp/open.env; chmod 644 /tmp/open.env'
run env BACKUP_ENV_FILE=/tmp/open.env bash /infra/scripts/backup.sh
check "an env file others can read is refused" "1 1" "$rc $(count 'no group or other access' <<<"$out")"

echo
echo "== a nightly run that succeeds"
run bash /infra/scripts/backup.sh
show <<<"$out"
first_run=$(sed -n 's/^backup: run \(run-[0-9TZ]*\) .*/\1/p' <<<"$out")
check "the run exits 0" 0 "$rc"
check "the run saves one snapshot per item, the marker last" \
  "/agent_check.dump /backup-run.complete /content_check.dump /rabbitmq-definitions.json /uptime-kuma-data.tar" \
  "$(restic_json --tag "$first_run" | grep -o '"paths":\["[^"]*"\]' | cut -d'"' -f4 | sort | xargs)"
check "the heartbeat reached the push monitor once" 1 "$(heartbeats)"
check "Uptime Kuma is up again" healthy "$(kuma_health)"

echo
echo "== a run where one dump fails (a database that refuses connections)"
pg <<<"CREATE DATABASE broken_check; ALTER DATABASE broken_check ALLOW_CONNECTIONS false;"
run bash /infra/scripts/backup.sh
show <<<"$out"
second_run=$(sed -n 's/^backup: run \(run-[0-9TZ]*\) .*/\1/p' <<<"$out")
check "the run exits 1" 1 "$rc"
check "no snapshot of the failed dump" 0 "$(restic_json --path /broken_check.dump | count '"id"')"
check "the other items of that run are saved, then forgotten with the run" "4 4" \
  "$(count '^backup: saved ' <<<"$out") $(sed -n "s/^backup: forgot this run's \([0-9]*\) saved snapshots$/\1/p" <<<"$out")"
check "no snapshot of that run is left, marker included" 0 "$(restic_json --tag "$second_run" | grep -o '"id":"' | count id)"
check "no heartbeat for that run" 1 "$(heartbeats)"
check "Uptime Kuma was started again" running "$(docker inspect -f '{{.State.Status}}' "$KUMA")"
pg <<<"DROP DATABASE broken_check;"
# Eight older nights of each data item, as the server holds after a week: with less history,
# restic keeps the oldest snapshots to fill the policy and a dropped item would not show.
# shellcheck disable=SC2016 # expanded by the runner's bash, not here
in_runner bash -c 'set -a; . /etc/jadero/backup.env; set +a
  for day in 01 02 03 04 05 06 07 08; do
    for item in uptime-kuma-data.tar agent_check.dump content_check.dump rabbitmq-definitions.json; do
      restic backup --quiet --host jadero-ops --tag jadero,seed --time "2026-01-$day 02:30:00" \
        --stdin-from-command --stdin-filename "$item" -- echo seed >/dev/null
    done
  done'
# The retention policy of backup.sh, read from it. The failed run came after the complete one on
# the same day: had its items stayed, keep-daily would keep them and drop the complete run's.
read -r -a retention <<<"$(sed -n "s/^readonly RETENTION=(\(.*\))$/\1/p" infra/scripts/backup.sh | tr -d "'")"
[[ "${#retention[@]}" -gt 0 ]] || { echo "backup-check: no RETENTION line in backup.sh" >&2; exit 1; }
run bash -c 'set -a; . /etc/jadero/backup.env; set +a; restic forget --quiet --host jadero-ops --tag jadero "$@" --prune' _ "${retention[@]}"
check "retention after the failed run keeps every item of the complete run" "0 5" \
  "$rc $(restic_json --tag "$first_run" | grep -o '"id":"' | count id)"

echo
echo "== the restore drill: the last complete night into a container with no network"
run bash /infra/scripts/restore.sh --env-file /etc/jadero/backup.env snapshots
check "snapshots lists the first run as the only complete one" "$first_run" \
  "$(sed -n '/complete runs/,$p' <<<"$out" | grep -o 'run-[0-9TZ]*' | xargs)"
run bash /infra/scripts/restore.sh --env-file /etc/jadero/backup.env all --compare "$PG" --strict --keep
show <<<"$out"
restored_container=$(sed -n 's/^restore: kept \([a-z0-9-]*\);.*/\1/p' <<<"$out")
check "every database of the night restores and every count matches" 0 "$rc"
check "the run picked is the last complete one" 1 "$(count "run $first_run: agent_check content_check" <<<"$out")"
check "the checkpoint tables come back empty, marked" 3 "$(count 'data not backed up' <<<"$out")"
check "the throwaway container had no network" none \
  "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$restored_container" 2>/dev/null || true)"
docker rm -f -v "$restored_container" >/dev/null && restored_container=""

pg content_check <<<"INSERT INTO content.posts VALUES (4, 'written after the backup');"
run bash /infra/scripts/restore.sh --env-file /etc/jadero/backup.env db content_check --compare "$PG" --strict
check "a live row written after the backup shows as a difference" "3 1" \
  "$rc $(count 'content.posts  *4  *3  DIFFERS' <<<"$out")"

run bash -c 'bash /infra/scripts/restore.sh --env-file /etc/jadero/backup.env dump rabbitmq-definitions.json /tmp/defs.json && grep -o "\"name\":\"/check\"" /tmp/defs.json'
check "the RabbitMQ definitions restore, the test vhost in them" '"name":"/check"' "$(tail -n 1 <<<"$out")"
run bash -c 'bash /infra/scripts/restore.sh --env-file /etc/jadero/backup.env dump uptime-kuma-data.tar /tmp/kuma.tar && tar -tf /tmp/kuma.tar | grep -c "^data/kuma.db$"'
check "the Uptime Kuma data restores with its SQLite database" 1 "$(tail -n 1 <<<"$out")"

echo
echo "== privacy"
check "no secret value in any output" 0 "$(grep -cF -e "$SECRET_PASSWORD" -e "$SECRET_TOKEN" "$outputs" || true)"
rm -f "$outputs"

echo
if [[ "$status" -eq 0 ]]; then
  echo "backup-check: all checks passed in $((SECONDS - started))s"
else
  echo "backup-check: some checks failed" >&2
fi
exit "$status"
