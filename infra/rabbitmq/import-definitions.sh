#!/usr/bin/env bash
#
# Live import of one environment's RabbitMQ topology into the running broker (WP-9 step 4; ADR-053,
# "Topology per service deploy"). Run by deploy.sh from the files of the release being deployed,
# for every api and agent deploy, in the `provisioned` state and before migrate: the service that
# needs a queue brings the file that declares it, so the queue exists before its consumer starts
# (services have no configure right, WP-5 T4).
#
#   RABBITMQ_CONTAINER=<container> import-definitions.sh <prod|staging>
#
# Steps, each one stopping the run on failure:
#   1. the file server/definitions/<env>.json is read with python3: every vhost, exchange, queue,
#      binding and policy must be on /<env>, and it must hold no user and no permission (users
#      are provision-users.sh's), so a staging file can never touch production;
#   2. `rabbitmqctl import_definitions` reads it on standard input. The import adds and updates,
#      never deletes; a policy with the same name is overwritten, which is why deploy.sh imports
#      only a messaging version equal to or newer than the one recorded (the monotonic guard);
#   3. the import is asynchronous (its own output says so), so the run polls `list_queues` until
#      every queue of the file is listed, at most RABBITMQ_IMPORT_TIMEOUT seconds (default 60).
#      A listed queue whose type differs from the file's fails the run at once: RabbitMQ 4.3.6
#      accepts such an import with exit 0 and silently keeps the old type (pinned by
#      packages/messaging/test/topology-import.int.test.ts), so this check is what refuses it. A
#      queue that needs another type is a new name (expand/contract for topology).
#
# Optional: RABBITMQ_DEFINITIONS, the folder of the per-vhost files (default: server/definitions
# next to this script); RABBITMQ_IMPORT_TIMEOUT, whole seconds from 1 to 600.
#
# Output: names of queues and of the vhost only, never a message, never a credential (the file
# holds none). Exit 0 when every queue is listed with its type, 1 otherwise, 2 on a usage error.

set -euo pipefail
export LC_ALL=C

usage() {
  echo "usage: RABBITMQ_CONTAINER=<container> $0 prod|staging" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
case "$1" in
  prod | staging) ;;
  *) usage ;;
esac
readonly ENV_NAME="$1" VHOST="/$1"

container="${RABBITMQ_CONTAINER:-}"
if [[ -z "$container" ]]; then
  echo "import-definitions: RABBITMQ_CONTAINER is not set" >&2
  exit 2
fi
timeout="${RABBITMQ_IMPORT_TIMEOUT:-60}"
if ! [[ "$timeout" =~ ^[1-9][0-9]{0,2}$ && "$timeout" -le 600 ]]; then
  echo "import-definitions: RABBITMQ_IMPORT_TIMEOUT must be whole seconds from 1 to 600" >&2
  exit 2
fi
file="${RABBITMQ_DEFINITIONS:-$(dirname "$0")/server/definitions}/$ENV_NAME.json"
if [[ ! -r "$file" ]]; then
  echo "import-definitions: cannot read $file" >&2
  exit 1
fi
if ! command -v python3 >/dev/null; then
  echo "import-definitions: python3 not found (it parses the definitions)" >&2
  exit 1
fi

# Step 1. The file's queues as `name<TAB>type` lines, after checking that everything in it lives on
# the run's vhost and that it carries no user or permission. JSON is parsed by python3, never by
# pattern matching (as in provision-users.sh).
if ! declared="$(
  python3 -I -c '
import json, sys
path, vhost = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as file:
    document = json.load(file)
problems = []
if document.get("users") or document.get("permissions"):
    problems.append("holds users or permissions")
if [v.get("name") for v in document.get("vhosts", [])] != [vhost]:
    problems.append("declares a vhost other than " + vhost)
for kind in ("exchanges", "queues", "bindings", "policies"):
    for item in document.get(kind, []):
        if item.get("vhost") != vhost:
            problems.append(kind + " entry outside " + vhost)
if problems:
    sys.exit("; ".join(sorted(set(problems))))
for queue in document.get("queues", []):
    kind = (queue.get("arguments") or {}).get("x-queue-type", "classic")
    print(queue["name"] + "\t" + kind)
' "$file" "$VHOST"
)"; then
  echo "import-definitions: $file is not a definitions file for $VHOST alone" >&2
  exit 1
fi
if [[ -z "$declared" ]]; then
  echo "import-definitions: $file declares no queue" >&2
  exit 1
fi

# Step 2. The import, on standard input: no copy of the file inside the container.
if ! output="$(docker exec -i "$container" rabbitmqctl import_definitions <"$file" 2>&1)"; then
  printf '%s\n' "$output" >&2
  echo "import-definitions: rabbitmqctl import_definitions failed for $VHOST" >&2
  exit 1
fi

# Step 3. Wait until every declared queue is listed, with the declared type. Plain arrays, no
# associative ones: the tests run this under macOS's bash 3.2 too.
want_names=() want_types=()
while IFS=$'\t' read -r name kind; do
  if [[ -n "$name" ]]; then want_names+=("$name") want_types+=("$kind"); fi
done <<<"$declared"

deadline=$((SECONDS + timeout))
while true; do
  listing="$(docker exec "$container" rabbitmqctl --quiet list_queues -p "$VHOST" \
    --no-table-headers name type 2>/dev/null || true)"
  missing=0
  for i in "${!want_names[@]}"; do
    listed=""
    while IFS=$'\t' read -r name kind; do
      if [[ "$name" == "${want_names[$i]}" ]]; then listed="${kind:-unknown}"; fi
    done <<<"$listing"
    if [[ -z "$listed" ]]; then
      missing=$((missing + 1))
    elif [[ "$listed" != "${want_types[$i]}" ]]; then
      echo "import-definitions: queue ${want_names[$i]} on $VHOST is $listed, the definitions" \
        "say ${want_types[$i]}: a queue's type never changes in place, give it a new name" >&2
      exit 1
    fi
  done
  if [[ $missing -eq 0 ]]; then
    echo "import-definitions: ${#want_names[@]} queues on $VHOST listed"
    exit 0
  fi
  if [[ $SECONDS -ge $deadline ]]; then
    echo "import-definitions: $missing of ${#want_names[@]} queues on $VHOST not listed after ${timeout}s" >&2
    exit 1
  fi
  sleep 1
done
