#!/bin/bash
#
# deploy.sh: the one script the deploy user may run as root (sudoers drop-in
# /etc/sudoers.d/jadero-deploy). Installed root-owned, mode 755, as /srv/jadero/bin/deploy.sh, by
# hand: the code that does the checks never updates itself from what it checks (ADR-053).
#
# Usage:
#   deploy.sh deploy <env> <service> <version>   through deploy-entry (CI) or the owner's shell
#   deploy.sh rollback <env> <service>           through deploy-entry or the owner's shell
#   deploy.sh redeploy <env> <service>           the owner's root shell only: the current version
#                                                again with freshly rendered secrets (rotation)
#
# A deploy is a finite state machine (WP-9 D1, ADR-053 restating ADR-049 and ADR-048's deploy
# script steps). Each state is written to the journal, /srv/jadero/<env>/deploy.log, the moment it
# is reached and before the next transition starts, and printed on stdout, which carries nothing
# else:
#
#   checked      the lock is held, the words are valid, the version is newer than the current one
#   fetched      infra/ and packages/messaging/package.json at the release tag are on disk in
#                releases/<service>-<version>/
#   rendered     op inject wrote <service>.env.new: exit 0, no {{ left, every credential parsed
#   pulled       the image by tag; its digest and revision label checked
#   provisioned  the release's topology imported (or skipped as older), then this service's
#                Postgres roles and broker user converged
#   migrated     <service>.env.new renamed into place, then the one-off migrate exited 0
#   started      up --wait on the service's process types, healthy
#   verified     the release's smoke script passed (smoke-passed-partial-<checks> when a check was
#                skipped because a service on its path is not deployed yet)
#   recorded     versions.env and previous.env written, older images pruned
#
# Two zones. Before `provisioned` nothing shared has changed: a failure is `aborted`, the files
# this run wrote are removed, the running services never noticed. The provisioning transition is
# the point of no return (the topology import, a role password set, then a migration, a
# container): from there a failure is `rolling_back` to the release that was current, with that
# release's files and its image by digest, then the health gate again: `rolled_back` (exit 1) or
# `failed` (exit 1, no retry loop). For a redeploy the release that was current is the same one,
# so rolling back is one more start of it.
#
# The env file a rollback starts with follows the first provisioning write, not the `provisioned`
# line (WP-9 Decision, amendment of 2026-10-23): once provision_postgres has started, Postgres may
# hold the passwords of this run's render (provision.sql can fail after an ALTER ROLE, or the
# broker step after it), so roll_back moves <service>.env.new into place before it starts the
# previous release. Compose sees a changed env and recreates the containers with the matching
# passwords; with the old file it would keep them, their pooled connections would pass the health
# gate, and the next restart would fail authentication. A failure before that write (the topology
# import) leaves the old env file in place and removes the .new file, which holds secrets.
#
# The journal holds the time, environment, service, version, state and a fixed reason token. Never
# a secret: the output of docker, op, git, psql and rabbitmqctl is discarded (a `docker compose
# config` would print the rendered secrets), and the run's credentials live only in variables.
#
# The topology (ADR-053, "Topology per service deploy"): an api or agent deploy imports its
# release's infra/rabbitmq/server/definitions/<env>.json into the running broker first, through the
# release's import-definitions.sh, which waits until every queue is listed. The import overwrites
# policies, so a monotonic guard runs here, on the trusted side: versions.env records, as
# MESSAGING_VERSION, the newest messaging version whose definitions were imported in this
# environment, and a release whose messaging version is older is not imported (the journal says
# `provisioned topology-skipped-older`). The record is written before the import, not at
# `recorded`: the import moves the shared broker even when the deploy then rolls back, so the record
# must describe the broker, not the release that is current (write-ahead, like the journal). A
# record ahead of the broker (an import that failed before it changed anything) only skips older
# imports, whose definitions the broker already holds. previous.env never carries it: shared state
# moves forward only.
#
# Standard input of a deploy: line 1 the registry user, line 2 its token (the job's GITHUB_TOKEN,
# packages: read), line 3 the expected image digest (sha256:...), required for prod. The login
# uses a temporary DOCKER_CONFIG from mktemp -d, removed right after the pull and again on exit.
#
# Exit codes: 0 recorded; 1 refused, aborted, rolled_back or failed; 75 another run holds the
# environment's lock (nothing was touched).
#
# The words were already checked by deploy-entry. They are checked again here because the sudoers
# rule names this path with no arguments, which lets the deploy user pass any: this script is the
# last gate before root acts on them (defense in depth). The checks are a copy of deploy-entry's on
# purpose, so the server holds no shared file that both scripts trust.
#
# sudo keeps LANG and LC_* from the caller, and under a UTF-8 locale the bracket ranges below
# match non-ASCII letters: LC_ALL=C, set before the first match, pins the checks to ASCII bytes.
# Nothing here reads a path from the environment: the paths below are fixed constants, and the
# tests run a copy with those lines (and PATH) rewritten.

set -euo pipefail
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
export LC_ALL=C
umask 077
# A lost SSH session sends SIGHUP and closes stdout: neither stops a deploy half way (D1). Ignored
# signals stay ignored in every child, so docker and op survive it too.
trap '' HUP PIPE
# Variables a root shell may carry that would steer Compose or op elsewhere: every value they
# would give is set explicitly below instead.
unset JADERO_ENV COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES DOCKER_CONFIG
# The same for the release's broker scripts, whose defaults read the release's own files.
unset RABBITMQ_DEFINITIONS RABBITMQ_PERMISSIONS RABBITMQ_IMPORT_TIMEOUT SMOKE_PING_TIMEOUT \
  SMOKE_PING_INTERVAL

readonly STATE_ROOT=/srv/jadero
readonly OP_TOKEN_FILE=/etc/jadero/op-token
readonly REPO_URL=https://github.com/JoseAlbDR/jadero-dev.git
readonly REGISTRY=ghcr.io
readonly IMAGE_PREFIX=ghcr.io/josealbdr/jadero-dev-
readonly DEPLOY_USER=deploy
readonly PG_CONTAINER=jadero-ops-postgres-1
readonly RABBITMQ_CONTAINER=jadero-ops-rabbitmq-1
# An image reference for a service versions.env does not hold yet: Compose interpolates every
# image variable, even of an inactive profile. A reserved domain, so it can never be pulled.
readonly INERT_IMAGE=jadero.invalid/not-deployed
readonly WAIT_TIMEOUT=120

# The services release-please publishes today. `contact` joins when it ships.
readonly SERVICES="api agent web"
readonly USAGE='refused: expected "deploy.sh deploy <env> <service> <version>", "deploy.sh rollback <env> <service>" or "deploy.sh redeploy <env> <service>"'
readonly VERSION_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
readonly DIGEST_RE='^sha256:[0-9a-f]{64}$'
readonly COMMIT_RE='^[0-9a-f]{40}$'
# Every generated secret is letters and digits only (infra/env/ops.env.tpl); anything else fails
# closed before the point of no return.
readonly SECRET_RE='^[A-Za-z0-9]+$'

# Prints the usage to stderr and exits 1. Used before the lock, when the words are not valid yet.
usage() {
  echo "$USAGE" >&2
  exit 1
}

# ---------------------------------------------------------------------------------------------
# The words
# ---------------------------------------------------------------------------------------------

[[ $# -ge 1 ]] || usage
verb="$1"
case "$verb" in
  deploy) [[ $# -eq 4 ]] || usage ;;
  rollback | redeploy) [[ $# -eq 3 ]] || usage ;;
  *) usage ;;
esac

# The environment: ONE value from which the folder, the Compose overlay, the project name and
# JADERO_ENV are all derived (compose_in), so they cannot disagree.
case "$2" in
  staging | prod) ;;
  *) usage ;;
esac
readonly ENV_NAME="$2"

case "$3" in
  "" | *" "*) usage ;;
esac
case " $SERVICES " in
  *" $3 "*) ;;
  *) usage ;;
esac
readonly SERVICE="$3"

requested_version=""
if [[ "$verb" == deploy ]]; then
  [[ "$4" =~ $VERSION_RE ]] || usage
  requested_version="$4"
fi

readonly ENV_DIR="$STATE_ROOT/$ENV_NAME"
readonly JOURNAL="$ENV_DIR/deploy.log"
# The environment's lock, in the root-owned state folder: a world-writable /run/lock would let any
# local user pre-create it (holding every deploy at exit 75) or plant a symlink root then opens.
readonly LOCK_FILE="$ENV_DIR/deploy.lock"
readonly VERSIONS="$ENV_DIR/versions.env"
readonly PREVIOUS="$ENV_DIR/previous.env"
readonly RELEASES="$ENV_DIR/releases"
readonly ENV_FILE="$ENV_DIR/$SERVICE.env"
readonly ENV_NEW="$ENV_DIR/$SERVICE.env.new"
KEY="$(printf '%s' "$SERVICE" | tr '[:lower:]' '[:upper:]')"
readonly KEY
readonly IMAGE_REPO="$IMAGE_PREFIX$SERVICE"
# The process types `up` starts, and the one-off migrate step (web has none).
case "$SERVICE" in
  api) readonly PROCESS_TYPES="api api-worker" MIGRATE=api-migrate ;;
  agent) readonly PROCESS_TYPES="agent agent-consumer" MIGRATE=agent-migrate ;;
  web) readonly PROCESS_TYPES="web" MIGRATE="" ;;
esac

# ---------------------------------------------------------------------------------------------
# The journal and the run's state
# ---------------------------------------------------------------------------------------------

journal_version="${requested_version:--}"
zone=before       # before: nothing shared changed yet; shared: past the point of no return
terminal=0        # 1 once a final state (or a refusal) is journaled
work_dir=""       # the run's scratch folder (git, docker config), removed on exit
docker_config=""  # the temporary DOCKER_CONFIG, removed right after the pull and on exit
new_release=""    # the release folder this run fetched, removed when the run aborts
registry_token="" # never printed, never journaled; cleared after the pull
credentials_written=0 # 1 from the first provisioning write: Postgres may hold this run's passwords

# Appends one line to the journal and prints it. A closed stdout (the runner went away) never
# stops the run: the write to the journal comes first and the print is best effort, from a
# subshell, because bash keeps a failed write in its own buffer and would flush it into the next
# redirected one (the journal).
# Arguments: the state, a fixed reason token (never input from the client, never a secret).
journal() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $ENV_NAME $SERVICE $journal_version $1 reason=$2"
  printf '%s\n' "$line" >>"$JOURNAL"
  (printf '%s\n' "$line") 2>/dev/null || true
}

# Removes what the run keeps only for itself. Runs on every exit.
cleanup() {
  [[ -n "$docker_config" ]] && rm -rf "$docker_config"
  [[ -n "$work_dir" ]] && rm -rf "$work_dir"
  registry_token=""
}

# The exit trap's safety net: a command that fails outside the handled paths still leaves a final
# line in the journal, in the zone's terms. Rolling back from here is not attempted.
on_exit() {
  local status=$?
  if [[ $status -ne 0 && $terminal -eq 0 && -f "$JOURNAL" ]]; then
    if [[ "$zone" == before ]]; then
      rm -f "$ENV_NEW"
      [[ -n "$new_release" ]] && rm -rf "$new_release"
      journal aborted unexpected-error
    else
      settle_env
      journal failed unexpected-error
    fi
  fi
  cleanup
}

# Settles the rendered env after a failure past the point of no return. From the first
# provisioning write on, <service>.env.new holds the passwords Postgres may already have, so it
# moves into place (shared state, forward only) and the next start uses it; before that write it
# matches nothing that moved and is removed, since it holds secrets. No-op once it was renamed.
settle_env() {
  [[ -f "$ENV_NEW" ]] || return 0
  if [[ $credentials_written -eq 1 ]]; then
    mv -f "$ENV_NEW" "$ENV_FILE"
  else
    rm -f "$ENV_NEW"
  fi
}

# Journals a refusal (nothing was touched) and exits 1.
# Arguments: the reason token.
refuse() {
  journal refused "$1"
  terminal=1
  echo "refused: $1" >&2
  exit 1
}

# Journals `aborted` (before the point of no return), removes the files this run wrote and exits 1.
# Arguments: the reason token.
abort() {
  rm -f "$ENV_NEW"
  [[ -n "$new_release" ]] && rm -rf "$new_release"
  journal aborted "$1"
  terminal=1
  exit 1
}

# ---------------------------------------------------------------------------------------------
# Manifests: versions.env (current, the environment's release manifest, ADR-025) and previous.env
# (the last good release before it, per service). KEY=VALUE lines, parsed, never sourced.
# ---------------------------------------------------------------------------------------------

# Prints the value of one key of a manifest, or nothing when the file or the key is missing.
# Arguments: the file, the key.
manifest_get() {
  local file="$1" key="$2" name value
  [[ -f "$file" ]] || return 0
  while IFS='=' read -r name value; do
    if [[ "$name" == "$key" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done <"$file"
}

# Writes a manifest with the given keys set (an empty value removes the key), keeping every other
# line, through a temporary file and a rename, so a reader never sees half a file.
# Arguments: the file, then pairs of key and value.
manifest_set() {
  local file="$1" tmp name value i found
  shift
  local -a keys=() values=()
  while [[ $# -gt 0 ]]; do
    keys+=("$1") values+=("$2")
    shift 2
  done
  tmp="$(mktemp "$file.XXXXXX")"
  if [[ -f "$file" ]]; then
    while IFS='=' read -r name value; do
      [[ -n "$name" ]] || continue
      found=0
      for i in "${!keys[@]}"; do
        [[ "${keys[$i]}" == "$name" ]] && found=1
      done
      [[ $found -eq 1 ]] || printf '%s=%s\n' "$name" "$value" >>"$tmp"
    done <"$file"
  fi
  for i in "${!keys[@]}"; do
    [[ -z "${values[$i]}" ]] || printf '%s=%s\n' "${keys[$i]}" "${values[$i]}" >>"$tmp"
  done
  mv -f "$tmp" "$file"
}

# Whether a string is this service's image by digest.
# Arguments: the reference.
is_service_image() {
  [[ "$1" =~ ^${IMAGE_REPO//./\\.}@sha256:[0-9a-f]{64}$ ]]
}

# ---------------------------------------------------------------------------------------------
# Semantic version precedence (semver.org, item 11), for the anti-rollback guard (D3)
# ---------------------------------------------------------------------------------------------

# Compares two numeric identifiers of any length: prints -1, 0 or 1. No leading zeros (the
# version pattern forbids them), so the longer one is the larger.
compare_numbers() {
  if [[ ${#1} -ne ${#2} ]]; then
    [[ ${#1} -lt ${#2} ]] && echo -1 || echo 1
  elif [[ "$1" == "$2" ]]; then
    echo 0
  else
    [[ "$1" < "$2" ]] && echo -1 || echo 1
  fi
}

# Compares two versions by semver precedence: prints -1, 0 or 1. 0.10.0 is newer than 0.9.0, and
# a pre-release is older than its release (1.0.0-rc.1 before 1.0.0).
# Arguments: two versions that match VERSION_RE.
semver_compare() {
  local a_core="${1%%-*}" b_core="${2%%-*}" a_pre="" b_pre="" result i
  [[ "$1" == *-* ]] && a_pre="${1#*-}"
  [[ "$2" == *-* ]] && b_pre="${2#*-}"
  local -a a_parts b_parts
  IFS=. read -r -a a_parts <<<"$a_core"
  IFS=. read -r -a b_parts <<<"$b_core"
  for i in 0 1 2; do
    result="$(compare_numbers "${a_parts[$i]}" "${b_parts[$i]}")"
    if [[ "$result" != 0 ]]; then
      echo "$result"
      return
    fi
  done
  if [[ -z "$a_pre" && -z "$b_pre" ]]; then echo 0; return; fi
  if [[ -z "$a_pre" ]]; then echo 1; return; fi
  if [[ -z "$b_pre" ]]; then echo -1; return; fi
  local -a a_ids b_ids
  IFS=. read -r -a a_ids <<<"$a_pre"
  IFS=. read -r -a b_ids <<<"$b_pre"
  for ((i = 0; i < ${#a_ids[@]} && i < ${#b_ids[@]}; i++)); do
    local x="${a_ids[$i]}" y="${b_ids[$i]}"
    if [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]]; then
      result="$(compare_numbers "$x" "$y")"
    elif [[ "$x" =~ ^[0-9]+$ ]]; then
      result=-1
    elif [[ "$y" =~ ^[0-9]+$ ]]; then
      result=1
    elif [[ "$x" == "$y" ]]; then
      result=0
    elif [[ "$x" < "$y" ]]; then
      result=-1
    else
      result=1
    fi
    if [[ "$result" != 0 ]]; then
      echo "$result"
      return
    fi
  done
  if [[ ${#a_ids[@]} -eq ${#b_ids[@]} ]]; then
    echo 0
  elif [[ ${#a_ids[@]} -lt ${#b_ids[@]} ]]; then
    echo -1
  else
    echo 1
  fi
}

# ---------------------------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------------------------

# Checks that a release's overlay names the project this environment runs, so a release whose
# files disagree with the environment word is refused before it is used.
# Arguments: the release folder.
overlay_matches() {
  local overlay="$1/infra/compose/compose.$ENV_NAME.yml" line
  [[ -f "$overlay" && -f "$1/infra/compose/compose.services.yml" ]] || return 1
  line="$(grep -m 1 -E '^name:' "$overlay" || true)"
  [[ "$line" == "name: jadero-$ENV_NAME" ]]
}

# Runs docker compose on the environment's project with one release's files. JADERO_ENV, the
# overlay file and the project name all come from ENV_NAME, never from the caller's environment.
# Only the deployed service's profile is active; its image variable is the given digest, the
# others come from versions.env or are the inert reference. Output discarded (a `config` would
# print the rendered secrets; `up` errors are summarised by the journal's reason).
# Arguments: the release folder, this service's image reference, then the compose arguments.
compose_in() {
  local files="$1" image="$2" name value
  shift 2
  local -a images=()
  for name in $SERVICES; do
    local upper
    upper="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')"
    if [[ "$name" == "$SERVICE" ]]; then
      value="$image"
    else
      value="$(manifest_get "$VERSIONS" "${upper}_IMAGE")"
      [[ -n "$value" ]] || value="$INERT_IMAGE"
    fi
    images+=("${upper}_IMAGE=$value")
  done
  env JADERO_ENV="$ENV_NAME" "${images[@]}" \
    docker compose --project-name "jadero-$ENV_NAME" --profile "$SERVICE" \
    -f "$files/infra/compose/compose.services.yml" \
    -f "$files/infra/compose/compose.$ENV_NAME.yml" \
    "$@" >/dev/null 2>&1
}

# Starts the service's process types and waits until they are healthy (the health gate).
# Arguments: the release folder, the image reference.
start_service() {
  # shellcheck disable=SC2086 # the process types are separate words on purpose
  compose_in "$1" "$2" up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps $PROCESS_TYPES
}

smoke_skipped="" # the checks the smoke skipped, joined by `-`, for the `verified` reason

# The smoke checks of D7, from the release's own files (infra/scripts/smoke-deploy.sh). A release
# without the script fails closed: no smoke, no `verified`. It gets the time `up --wait` returned
# healthy (its ping window opens then: only new containers exist) and the services deployed in
# the environment, so it skips a check whose path is not whole yet. Its stdout is read for the
# skipped checks only, each name matched against the fixed list, never journaled as given.
# Arguments: the release folder, the Unix seconds `up --wait` returned at.
run_smoke() {
  local smoke="$1/infra/scripts/smoke-deploy.sh" deployed="$SERVICE" name output line
  [[ -f "$smoke" ]] || return 1
  for name in $SERVICES; do
    [[ "$name" == "$SERVICE" ]] && continue
    local upper
    upper="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')"
    [[ -z "$(manifest_get "$VERSIONS" "${upper}_VERSION")" ]] || deployed="$deployed,$name"
  done
  output="$(bash "$smoke" "$ENV_NAME" "$SERVICE" "$2" "$deployed" 2>/dev/null)" || return 1
  smoke_skipped=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^check=(ready|pages|content|ping)\ result=skipped$ ]]; then
      smoke_skipped="${smoke_skipped:+$smoke_skipped-}${BASH_REMATCH[1]}"
    fi
  done <<<"$output"
}

# The `verified` reason: smoke-passed, or smoke-passed-partial-<skipped checks>.
smoke_reason() {
  if [[ -n "$smoke_skipped" ]]; then echo "smoke-passed-partial-$smoke_skipped"; else echo smoke-passed; fi
}

# ---------------------------------------------------------------------------------------------
# Provisioning: only this service's roles and broker user (D4, rotation ordering)
# ---------------------------------------------------------------------------------------------

db_password="" db_read_password="" broker_password=""

# Prints the password of one connection URL variable of the rendered env file, or nothing when
# the line is missing or the value is not letters and digits only.
# Arguments: the file, the variable name.
url_password() {
  local line value password
  line="$(grep -m 1 -E "^$2=" "$1" || true)"
  value="${line#*=}"
  [[ "$value" =~ ^[a-z]+://[^:/@]+:([^@]*)@ ]] || return 0
  password="${BASH_REMATCH[1]}"
  [[ "$password" =~ $SECRET_RE ]] && printf '%s' "$password"
  return 0
}

# Reads the credentials this service's provisioning needs from the env file this run rendered, so
# the password set in Postgres and RabbitMQ is the one the service will use, by construction.
# Returns 1 when one is missing or not letters and digits only (fail closed).
parse_credentials() {
  case "$SERVICE" in
    api)
      db_password="$(url_password "$ENV_NEW" DATABASE_URL)"
      db_read_password="$(url_password "$ENV_NEW" DATABASE_READ_URL)"
      broker_password="$(url_password "$ENV_NEW" RABBITMQ_URL)"
      [[ -n "$db_password" && -n "$db_read_password" && -n "$broker_password" ]]
      ;;
    agent)
      db_password="$(url_password "$ENV_NEW" DATABASE_URL)"
      broker_password="$(url_password "$ENV_NEW" RABBITMQ_URL)"
      [[ -n "$db_password" && -n "$broker_password" ]]
      ;;
    web) return 0 ;;
  esac
}

release_messaging="" # the release's messaging version, read before the point of no return
topology_result=""   # imported or skipped-older, for the `provisioned` line

# Reads the release's messaging version and checks that its topology files are there, so a release
# without them aborts before anything shared moves. web imports no topology.
# Arguments: the release folder. Returns 1 when a file is missing or the version is not semver.
read_topology_inputs() {
  local folder="$1" line version=""
  [[ "$SERVICE" != web ]] || return 0
  [[ -f "$folder/infra/rabbitmq/server/definitions/$ENV_NAME.json" ]] || return 1
  [[ -f "$folder/infra/rabbitmq/import-definitions.sh" ]] || return 1
  [[ -f "$folder/packages/messaging/package.json" ]] || return 1
  # The package's own top-level "version" (two spaces of indent; Biome formats the file).
  local pattern='^  "version": "([^"]+)",?$'
  line="$(grep -m 1 -E '^  "version": ' "$folder/packages/messaging/package.json" || true)"
  [[ "$line" =~ $pattern ]] && version="${BASH_REMATCH[1]}"
  [[ "$version" =~ $VERSION_RE ]] || return 1
  release_messaging="$version"
}

# The topology transition (ADR-053): the monotonic guard, the write-ahead record, then the import of
# the release's definitions with the wait until every queue is listed (import-definitions.sh).
# Arguments: the release folder. Returns 1 when the import or the wait fails.
apply_topology() {
  local recorded order
  topology_result=""
  [[ "$SERVICE" != web ]] || return 0
  recorded="$(manifest_get "$VERSIONS" MESSAGING_VERSION)"
  order=1
  [[ -z "$recorded" ]] || order="$(semver_compare "$release_messaging" "$recorded")"
  if [[ "$order" == -1 ]]; then
    topology_result=skipped-older
    return 0
  fi
  [[ "$order" == 0 ]] || manifest_set "$VERSIONS" MESSAGING_VERSION "$release_messaging"
  (
    export RABBITMQ_CONTAINER
    bash "$1/infra/rabbitmq/import-definitions.sh" "$ENV_NAME" >/dev/null 2>&1
  ) || return 1
  topology_result=imported
}

# Converges this service's Postgres roles with provision.sql -v service=<service>. The passwords
# reach psql only through its environment (`docker exec -e NAME` copies NAME from this process),
# never an argument list.
# Arguments: the release folder.
provision_postgres() {
  local sql="$1/infra/postgres/provision.sql"
  [[ -f "$sql" ]] || return 1
  case "$SERVICE" in
    api)
      CONTENT_DB_PASSWORD="$db_password" CONTENT_READER_DB_PASSWORD="$db_read_password" \
        docker exec -i -u postgres -e CONTENT_DB_PASSWORD -e CONTENT_READER_DB_PASSWORD \
        "$PG_CONTAINER" psql --no-psqlrc --quiet -v env="$ENV_NAME" -v service=api -d postgres \
        <"$sql" >/dev/null 2>&1
      ;;
    agent)
      AGENT_DB_PASSWORD="$db_password" \
        docker exec -i -u postgres -e AGENT_DB_PASSWORD \
        "$PG_CONTAINER" psql --no-psqlrc --quiet -v env="$ENV_NAME" -v service=agent -d postgres \
        <"$sql" >/dev/null 2>&1
      ;;
  esac
}

# Converges this service's broker user with provision-users.sh and its user filter; the password
# is in the script's environment, which hands it to rabbitmqctl on standard input.
# Arguments: the release folder.
provision_broker() {
  local script="$1/infra/rabbitmq/provision-users.sh" user="${SERVICE}_$ENV_NAME"
  local variable
  [[ -f "$script" ]] || return 1
  variable="RABBITMQ_$(printf '%s' "$user" | tr '[:lower:]' '[:upper:]')_PASSWORD"
  # Exported in a subshell, never `env NAME=value`: that would put the password in argv.
  (
    export RABBITMQ_CONTAINER "$variable=$broker_password"
    bash "$script" "$ENV_NAME" "$user" >/dev/null 2>&1
  )
}

# ---------------------------------------------------------------------------------------------
# The steps
# ---------------------------------------------------------------------------------------------

# Takes the environment's lock, or exits 75 without touching anything.
take_lock() {
  # Under the root-owned /srv/jadero, so only root can create the folder; umask 077 makes it 700.
  mkdir -p "$ENV_DIR"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "busy: another deploy runs on $ENV_NAME" >&2
    exit 75
  fi
  mkdir -p "$RELEASES"
  trap on_exit EXIT
}

# Reads the registry user, its token and the expected digest from standard input.
read_input() {
  local user="" token="" digest=""
  IFS= read -r -t 10 user || true
  IFS= read -r -t 10 token || true
  IFS= read -r -t 10 digest || true
  [[ "$user" =~ ^[A-Za-z0-9-]{1,39}$ ]] || refuse bad-input
  # Printable ASCII, no space; the length apart (a bound over 255 is not portable ERE).
  [[ "$token" =~ ^[!-~]+$ && ${#token} -le 512 ]] || refuse bad-input
  if [[ -n "$digest" ]]; then
    [[ "$digest" =~ $DIGEST_RE ]] || refuse bad-input
  elif [[ "$ENV_NAME" == prod ]]; then
    refuse no-digest
  fi
  registry_user="$user" registry_token="$token" expected_digest="$digest"
}

# Fetches infra/ at the release tag into releases/<service>-<version>/ (ADR-053) and prints the
# tag's commit. The folder cannot be the current or the previous release: the version is newer.
fetch_release() {
  local tag="$SERVICE-v$version" commit
  work_dir="$(mktemp -d "$ENV_DIR/.deploy.XXXXXX")"
  GIT_TERMINAL_PROMPT=0 git -C "$work_dir" init -q >/dev/null 2>&1 || abort git-failed
  GIT_TERMINAL_PROMPT=0 git -C "$work_dir" fetch -q --depth 1 --no-tags "$REPO_URL" \
    "refs/tags/$tag" >/dev/null 2>&1 || abort fetch-failed
  commit="$(git -C "$work_dir" rev-parse -q --verify 'FETCH_HEAD^{commit}' 2>/dev/null || true)"
  [[ "$commit" =~ $COMMIT_RE ]] || abort fetch-failed
  release="$RELEASES/$SERVICE-$version"
  rm -rf "$release"
  new_release="$release"
  mkdir -p "$release"
  # The messaging version travels with the definitions it generated (the topology guard).
  git -C "$work_dir" archive --format=tar "$commit" infra packages/messaging/package.json \
    2>/dev/null | tar -x -C "$release" 2>/dev/null || abort fetch-failed
  overlay_matches "$release" || abort env-mismatch
  [[ -f "$release/infra/env/$SERVICE.env.tpl" ]] || abort fetch-failed
  tag_commit="$commit"
}

# Renders the release's env template into <service>.env.new. Passes only on op's exit 0, no {{
# left and every credential parsed (D4); otherwise aborts, and the .new file is removed.
# Arguments: the release folder.
render_env() {
  local template="$1/infra/env/$SERVICE.env.tpl" status=0
  [[ -r "$OP_TOKEN_FILE" ]] || abort op-token
  rm -f "$ENV_NEW"
  JADERO_ENV="$ENV_NAME" OP_SERVICE_ACCOUNT_TOKEN="$(cat "$OP_TOKEN_FILE")" \
    op inject --force -i "$template" -o "$ENV_NEW" >/dev/null 2>&1 || status=$?
  [[ $status -eq 0 ]] || abort "op-exit-$status"
  [[ -f "$ENV_NEW" ]] || abort op-no-output
  chmod 600 "$ENV_NEW"
  if grep -q '{{' "$ENV_NEW"; then abort unresolved-reference; fi
  parse_credentials || abort bad-credential
}

# Logs in with a temporary DOCKER_CONFIG, pulls the image by tag, removes the config, then checks
# the digest (against stdin's line 3 when given) and the revision label against the tag's commit.
pull_image() {
  local ref="$IMAGE_REPO:$version" digests revision line
  docker_config="$(mktemp -d "$ENV_DIR/.docker.XXXXXX")"
  printf '%s' "$registry_token" | DOCKER_CONFIG="$docker_config" \
    docker login "$REGISTRY" --username "$registry_user" --password-stdin >/dev/null 2>&1 ||
    abort login-failed
  DOCKER_CONFIG="$docker_config" docker pull "$ref" >/dev/null 2>&1 || abort pull-failed
  rm -rf "$docker_config"
  docker_config="" registry_token=""
  digests="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" 2>/dev/null || true)"
  new_image=""
  while IFS= read -r line; do
    if is_service_image "$line"; then new_image="$line"; fi
  done <<<"$digests"
  [[ -n "$new_image" ]] || abort no-digest
  if [[ -n "$expected_digest" && "${new_image#*@}" != "$expected_digest" ]]; then
    abort digest-mismatch
  fi
  revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref" 2>/dev/null || true)"
  [[ "$revision" == "$tag_commit" ]] || abort revision-mismatch
}

# Keeps the current and previous image and release folder of this service, removes the rest.
# Best effort: a failure to prune never undoes a recorded deploy.
prune() {
  local keep_current keep_previous line folder
  keep_current="$(manifest_get "$VERSIONS" "${KEY}_IMAGE")"
  keep_previous="$(manifest_get "$PREVIOUS" "${KEY}_IMAGE")"
  while IFS= read -r line; do
    is_service_image "$line" || continue
    [[ "$line" == "$keep_current" || "$line" == "$keep_previous" ]] && continue
    docker image rm "$line" >/dev/null 2>&1 || true
  done < <(docker image ls --digests --format '{{.Repository}}@{{.Digest}}' "$IMAGE_REPO" 2>/dev/null || true)
  local current_version previous_version
  current_version="$(manifest_get "$VERSIONS" "${KEY}_VERSION")"
  previous_version="$(manifest_get "$PREVIOUS" "${KEY}_VERSION")"
  for folder in "$RELEASES/$SERVICE"-*; do
    [[ -d "$folder" ]] || continue
    case "${folder##*/}" in
      "$SERVICE-$current_version" | "$SERVICE-$previous_version") ;;
      *) rm -rf "$folder" ;;
    esac
  done
}

# The compensating action: the release that was current, its files and its image by digest, with
# the env file that matches what provisioning wrote (settle_env), then the health gate again.
# Exits 1 either way.
# Arguments: the reason token of the failure.
roll_back() {
  journal rolling_back "$1"
  settle_env
  if [[ -z "$current_version" || -z "$current_image" ]]; then
    # A first deploy runs whole or not at all: the containers it created are stopped, not removed,
    # so their logs stay readable (`docker compose logs`, `docker logs`).
    # shellcheck disable=SC2086 # the process types are separate words on purpose
    if [[ $containers_created -eq 1 ]] && ! compose_in "$release" "$new_image" stop $PROCESS_TYPES; then
      journal failed stop-failed
    else
      journal failed nothing-to-roll-back-to
    fi
    terminal=1
    exit 1
  fi
  local previous_release="$RELEASES/$SERVICE-$current_version"
  if overlay_matches "$previous_release" && start_service "$previous_release" "$current_image"; then
    journal rolled_back previous-healthy
  else
    journal failed previous-unhealthy
  fi
  terminal=1
  exit 1
}

# The forward path of `deploy` and `redeploy`, from `checked` to `recorded`.
# Arguments: 1 for redeploy (the current release again, its files and image already on disk).
forward() {
  local again="$1"
  local checked_reason=newer
  [[ -n "$current_version" ]] || checked_reason=first-deploy
  [[ $again -eq 0 ]] || checked_reason=same-version
  journal checked "$checked_reason"

  local fetched_reason=tag-commit
  if [[ $again -eq 1 ]]; then
    release="$RELEASES/$SERVICE-$version"
    fetched_reason=on-disk
  else
    fetch_release
  fi
  read_topology_inputs "$release" || abort no-topology-files
  journal fetched "$fetched_reason"

  render_env "$release"
  journal rendered ok

  if [[ $again -eq 1 ]]; then
    new_image="$current_image"
    journal pulled on-disk
  else
    pull_image
    journal pulled digest-and-revision
  fi

  # The point of no return: the first transition that writes shared state.
  zone=shared
  apply_topology "$release" || roll_back topology-failed
  if [[ "$SERVICE" != web ]]; then
    # The first write that can change a password: from here a rollback keeps this run's env.
    credentials_written=1
    provision_postgres "$release" || roll_back provision-failed
    provision_broker "$release" || roll_back provision-failed
  fi
  db_password="" db_read_password="" broker_password=""
  if [[ -n "$topology_result" ]]; then
    journal provisioned "topology-$topology_result"
  else
    journal provisioned this-service
  fi

  # The rendered env is shared state from here on: in place before the first compose command,
  # because Compose reads the env file on every command (amendment of step 3).
  mv -f "$ENV_NEW" "$ENV_FILE"
  if [[ -n "$MIGRATE" ]]; then
    compose_in "$release" "$new_image" run --rm --no-deps "$MIGRATE" || roll_back migrate-failed
    journal migrated ok
  else
    journal migrated no-migrations
  fi

  containers_created=1
  start_service "$release" "$new_image" || roll_back unhealthy
  healthy_at="$(date -u +%s)"
  journal started healthy

  run_smoke "$release" "$healthy_at" || roll_back smoke-failed
  journal verified "$(smoke_reason)"

  if [[ $again -eq 0 ]]; then
    if [[ -n "$current_version" ]]; then
      manifest_set "$PREVIOUS" "${KEY}_VERSION" "$current_version" "${KEY}_IMAGE" "$current_image"
    fi
    manifest_set "$VERSIONS" "${KEY}_VERSION" "$version" "${KEY}_IMAGE" "$new_image"
  fi
  new_release=""
  prune
  journal recorded "$([[ $again -eq 1 ]] && echo unchanged || echo current)"
  terminal=1
}

# `rollback`: once back to the release previous.env records, with the env file on disk (nothing
# remote is needed: static stability). The entry is removed, so a second rollback refuses.
backward() {
  local target_version target_image target_release
  target_version="$(manifest_get "$PREVIOUS" "${KEY}_VERSION")"
  target_image="$(manifest_get "$PREVIOUS" "${KEY}_IMAGE")"
  [[ -n "$target_version" ]] || refuse no-previous
  if ! [[ "$target_version" =~ $VERSION_RE ]] || ! is_service_image "$target_image"; then
    refuse bad-manifest
  fi
  journal_version="$target_version"
  target_release="$RELEASES/$SERVICE-$target_version"
  overlay_matches "$target_release" || refuse no-release-files
  [[ -f "$ENV_FILE" ]] || refuse no-env-file
  docker image inspect "$target_image" >/dev/null 2>&1 || refuse no-image
  journal checked previous-recorded

  zone=shared
  if ! start_service "$target_release" "$target_image"; then
    journal failed unhealthy
    terminal=1
    exit 1
  fi
  healthy_at="$(date -u +%s)"
  journal started healthy
  if ! run_smoke "$target_release" "$healthy_at"; then
    journal failed smoke-failed
    terminal=1
    exit 1
  fi
  journal verified "$(smoke_reason)"
  manifest_set "$VERSIONS" "${KEY}_VERSION" "$target_version" "${KEY}_IMAGE" "$target_image"
  manifest_set "$PREVIOUS" "${KEY}_VERSION" "" "${KEY}_IMAGE" ""
  journal recorded rolled-back-once
  terminal=1
}

# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------

# redeploy re-renders secrets with no new version: the owner's root shell only, never the deploy
# user's key (deploy-entry does not accept the verb either). Checked before the lock: a refusal
# here touches nothing.
if [[ "$verb" == redeploy && "${SUDO_USER-}" == "$DEPLOY_USER" ]]; then
  echo "refused: redeploy runs from the owner's root shell only" >&2
  exit 1
fi

take_lock

current_version="$(manifest_get "$VERSIONS" "${KEY}_VERSION")"
current_image="$(manifest_get "$VERSIONS" "${KEY}_IMAGE")"
if [[ -n "$current_version" ]]; then
  if ! [[ "$current_version" =~ $VERSION_RE ]] || ! is_service_image "$current_image"; then
    refuse bad-manifest
  fi
fi
recorded_messaging="$(manifest_get "$VERSIONS" MESSAGING_VERSION)"
if [[ -n "$recorded_messaging" && ! "$recorded_messaging" =~ $VERSION_RE ]]; then
  refuse bad-manifest
fi

registry_user="" expected_digest="" tag_commit="" new_image="" release="" containers_created=0
case "$verb" in
  deploy)
    version="$requested_version"
    # Anti-rollback (D3): only a strictly newer version, compared on the trusted side.
    if [[ -n "$current_version" && "$(semver_compare "$version" "$current_version")" != 1 ]]; then
      refuse not-newer
    fi
    read_input
    forward 0
    ;;
  redeploy)
    [[ -n "$current_version" ]] || refuse nothing-deployed
    version="$current_version"
    journal_version="$version"
    overlay_matches "$RELEASES/$SERVICE-$version" || refuse no-release-files
    docker image inspect "$current_image" >/dev/null 2>&1 || refuse no-image
    forward 1
    ;;
  rollback)
    backward
    ;;
esac
