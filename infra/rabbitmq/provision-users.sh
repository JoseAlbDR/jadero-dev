#!/usr/bin/env bash
#
# Convergent RabbitMQ users and permissions for the servers (WP-8 D4, ADR-029, WP-5 decision T4).
#
# Run on every deploy and as often as you like: each run lands the broker in the same state,
# whatever state it starts from. The topology (vhosts, exchanges, queues, policies) is loaded at
# boot from infra/rabbitmq/server/definitions/; this script owns only what the definitions leave
# out on purpose, the users:
#
#   - each user of permissions.tsv is created when missing, and its password is set on every run
#     (a rotation is a re-run), then its tags are set;
#   - each of its permission rows is set (set_permissions overwrites), and its permissions on any
#     vhost the file does not list for it are cleared;
#   - `guest` is deleted if it exists;
#   - a user that is not in the file is reported by name and left in place.
#
#   RABBITMQ_CONTAINER=<container> provision-users.sh [prod|staging]
#
# rabbitmqctl runs inside the broker's container through `docker exec`. With an environment, the
# run touches only the users that have a row on that environment's vhost (its service users and
# ops_admin), so a deploy of one environment needs only that environment's passwords.
#
# Passwords come from this process's environment, one variable per user, named after it:
# api_prod -> RABBITMQ_API_PROD_PASSWORD, ops_admin -> RABBITMQ_OPS_ADMIN_PASSWORD. A missing or
# empty one stops the run before any change, naming the variable, never its value. A password
# reaches rabbitmqctl only on its standard input (it reads it from there when the argument is left
# out), never in an argument list, which `ps` shows to every user of the host.
#
# Optional: RABBITMQ_PERMISSIONS, the path of permissions.tsv (default: server/permissions.tsv
# next to this script).

set -euo pipefail

usage() {
  echo "usage: RABBITMQ_CONTAINER=<container> $0 [prod|staging]" >&2
  exit 2
}

if [[ $# -gt 1 ]]; then usage; fi
only_env="${1:-}"
case "$only_env" in
  "" | prod | staging) ;;
  *) usage ;;
esac

container="${RABBITMQ_CONTAINER:-}"
if [[ -z "$container" ]]; then
  echo "provision-users: RABBITMQ_CONTAINER is not set" >&2
  exit 2
fi
table="${RABBITMQ_PERMISSIONS:-$(dirname "$0")/server/permissions.tsv}"
if [[ ! -r "$table" ]]; then
  echo "provision-users: cannot read $table" >&2
  exit 2
fi

# rabbitmqctl in the broker's container; informational lines off.
ctl() {
  docker exec "$container" rabbitmqctl --quiet "$@"
}

# The same, with a password on standard input. Without --quiet: rabbitmqctl 4.3.6 waits forever
# for a password on stdin when --quiet is set. Its output (a prompt, never the password) is shown
# only when the command fails.
ctl_password() {
  local password="$1" output
  shift
  if ! output="$(printf '%s' "$password" | docker exec -i "$container" rabbitmqctl "$@" 2>&1)"; then
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

# The variable that holds a user's password: RABBITMQ_<NAME IN UPPER CASE>_PASSWORD.
password_variable() {
  printf 'RABBITMQ_%s_PASSWORD' "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
}

# Whether a word is in the rest of the arguments.
contains() {
  local needle="$1" item
  shift
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then return 0; fi
  done
  return 1
}

# Read the table: comment lines skipped; tags are `-` when empty, because `read` with a tab
# separator merges empty fields.
row_user=() row_vhost=() row_tags=() row_configure=() row_write=() row_read=()
while IFS=$'\t' read -r user vhost tags configure write read; do
  if [[ -z "$user" || "$user" == \#* ]]; then continue; fi
  if [[ -z "$read" ]]; then
    echo "provision-users: malformed row for user $user in $table" >&2
    exit 1
  fi
  row_user+=("$user") row_vhost+=("$vhost") row_tags+=("$tags")
  row_configure+=("$configure") row_write+=("$write") row_read+=("$read")
done <"$table"

# Every user of the file, and the ones this run converges.
all_users=() users=()
for i in "${!row_user[@]}"; do
  user="${row_user[$i]}"
  if ! contains "$user" ${all_users[@]+"${all_users[@]}"}; then all_users+=("$user"); fi
  if [[ -z "$only_env" || "${row_vhost[$i]}" == "/$only_env" ]]; then
    if ! contains "$user" ${users[@]+"${users[@]}"}; then users+=("$user"); fi
  fi
done
if [[ ${#users[@]} -eq 0 ]]; then
  echo "provision-users: no users in $table" >&2
  exit 1
fi

# Every password first, so a missing one stops the run before any change.
missing=0
for user in "${users[@]}"; do
  variable="$(password_variable "$user")"
  if [[ -z "${!variable:-}" ]]; then
    echo "provision-users: $variable is not set" >&2
    missing=1
  fi
done
if [[ $missing -ne 0 ]]; then exit 1; fi

existing=()
while IFS=$'\t' read -r user _; do
  if [[ -n "$user" ]]; then existing+=("$user"); fi
done < <(ctl list_users --no-table-headers)

for user in "${users[@]}"; do
  variable="$(password_variable "$user")"
  if contains "$user" ${existing[@]+"${existing[@]}"}; then
    ctl_password "${!variable}" change_password "$user"
    echo "provision-users: $user: password set"
  else
    ctl_password "${!variable}" add_user "$user"
    echo "provision-users: $user: created"
  fi

  vhosts=() tags=""
  for i in "${!row_user[@]}"; do
    if [[ "${row_user[$i]}" != "$user" ]]; then continue; fi
    tags="${row_tags[$i]}"
    vhosts+=("${row_vhost[$i]}")
    ctl set_permissions -p "${row_vhost[$i]}" "$user" \
      "${row_configure[$i]}" "${row_write[$i]}" "${row_read[$i]}" >/dev/null
    echo "provision-users: $user: permissions on ${row_vhost[$i]} set"
  done
  if [[ "$tags" == "-" ]]; then
    ctl set_user_tags "$user" >/dev/null
  else
    # shellcheck disable=SC2086 # comma-separated tags become separate arguments on purpose
    ctl set_user_tags "$user" ${tags//,/ } >/dev/null
  fi

  # Rights on a vhost the file no longer lists for this user are cleared.
  while IFS=$'\t' read -r vhost _; do
    if [[ -n "$vhost" ]] && ! contains "$vhost" "${vhosts[@]}"; then
      ctl clear_permissions -p "$vhost" "$user" >/dev/null
      echo "provision-users: $user: permissions on $vhost cleared"
    fi
  done < <(ctl list_user_permissions --no-table-headers "$user")
done

if contains guest ${existing[@]+"${existing[@]}"}; then
  ctl delete_user guest >/dev/null
  echo "provision-users: guest: deleted"
fi

# Users nobody declared are reported, never deleted: one may be an operator's on purpose.
for user in ${existing[@]+"${existing[@]}"}; do
  if [[ "$user" != guest ]] && ! contains "$user" "${all_users[@]}"; then
    echo "provision-users: WARN $user is not in $(basename "$table"); left in place" >&2
  fi
done
