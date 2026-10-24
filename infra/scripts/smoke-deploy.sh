#!/bin/bash
#
# smoke-deploy.sh: the smoke checks of a deploy (WP-9 D7; ADR-049 restating ADR-026: "smoke test,
# on failure re-pin the previous version"). Run by deploy.sh in the `started` -> `verified`
# transition, from the files of the release being deployed, after `up --wait` returned healthy.
# Read-only: GET requests, a container's own health probe and one read-only SELECT.
#
# Usage: smoke-deploy.sh <env> <service> <since> <deployed>
#
#   env       staging or prod
#   service   api, agent or web: the service this deploy changed
#   since     Unix seconds taken right after `up --wait` returned healthy: from then on only the
#             new containers exist, so a heartbeat newer than this was sent and stored by them
#   deployed  the services versions.env holds plus this one, comma-separated (api,agent,web)
#
# The checks, each with its path (the services a request crosses). A check gates only the
# services on its path: it runs when the deployed service is on it, and it is skipped while
# another service on it is not deployed yet (the first round of an environment: agent deploys
# before api, api before web). Each path is still checked once in that round.
#
#   ready    path: the service itself. Published process types (api, web) from the host on
#            127.0.0.1 (the edge answers 404 on /api/health/*); the others (api-worker, agent,
#            agent-consumer publish nothing) with the image's own probe inside the container,
#            also on 127.0.0.1. web has no /health/ready: its probe is /robots.txt.
#   pages    path: web, api. GET /<locale> for es, en, de (no trailing slash: Next.js answers /es/
#            with a 308 to /es, and curl follows no redirect): staging through the edge
#            (https://new.jadero.dev, TLS and nginx's routing, connected to 127.0.0.1), production
#            on 127.0.0.1 (no public host until the cutover, WP-29).
#   content  path: api. GET the public content API, /api/v1/content/en/projects through the edge on
#            staging, /v1/content/en/projects on 127.0.0.1 in production.
#   ping     path: api, agent. The broker path: `jadero/api`'s last heartbeat in agent's database
#            is newer than <since>, polled for up to SMOKE_PING_TIMEOUT seconds (default 90: one
#            server heartbeat, HEARTBEAT_INTERVAL_MS=60000, plus margin, since the new
#            api-worker's boot ping may land before `up --wait` returns). Only the timestamp is
#            read, in a read-only transaction, never an event body.
#
# Output: one line per check, `check=<name> result=ok|skipped|failed`, and nothing else on stdout;
# deploy.sh journals the skipped ones as `verified smoke-passed-partial-<names>`. No URL with a
# query string, no response body, no credential. Exit 0 when no check failed, 1 when one did, 2 on
# a usage error. PATH is the caller's (deploy.sh pins it).

set -uo pipefail
export LC_ALL=C

readonly PG_CONTAINER=jadero-ops-postgres-1
readonly EDGE_HOST=new.jadero.dev
readonly LOCALES="es en de"

usage() {
  echo "usage: smoke-deploy.sh <staging|prod> <api|agent|web> <since> <deployed,...>" >&2
  exit 2
}

[[ $# -eq 4 ]] || usage
case "$1" in staging | prod) ;; *) usage ;; esac
case "$2" in api | agent | web) ;; *) usage ;; esac
[[ "$3" =~ ^[1-9][0-9]{0,11}$ ]] || usage
[[ "$4" =~ ^(api|agent|web)(,(api|agent|web))*$ ]] || usage
readonly ENV_NAME="$1" SERVICE="$2" SINCE="$3" DEPLOYED=",$4,"
[[ "$DEPLOYED" == *",$SERVICE,"* ]] || usage

ping_timeout="${SMOKE_PING_TIMEOUT:-90}"
ping_interval="${SMOKE_PING_INTERVAL:-5}"
[[ "$ping_timeout" =~ ^[0-9]{1,3}$ && "$ping_interval" =~ ^[1-9][0-9]?$ ]] || usage

# The published ports of the environment, as compose.<env>.yml binds them on 127.0.0.1
# (scripts/smoke-deploy.test.mjs keeps them equal to the overlays).
case "$ENV_NAME" in
  staging) readonly WEB_PORT=3120 API_PORT=3121 ;;
  prod) readonly WEB_PORT=3110 API_PORT=3111 ;;
esac

failed=0

# Prints a check's result line, and counts a failure. Args: check, result.
report() {
  printf 'check=%s result=%s\n' "$1" "$2"
  [[ "$2" != failed ]] || failed=1
}

# Whether a check runs for this deploy: the deployed service is on its path and every service
# on it is deployed. Prints `skip` when a service on the path is missing, `off` when the
# deployed service is not on it (the check is not this deploy's). Args: the path's services.
gate() {
  local on=0 name
  for name in "$@"; do [[ "$name" == "$SERVICE" ]] && on=1; done
  if [[ $on -eq 0 ]]; then echo off; return; fi
  for name in "$@"; do
    if [[ "$DEPLOYED" != *",$name,"* ]]; then echo skip; return; fi
  done
  echo run
}

# The HTTP status of a GET, or 000 when no response came. Args: URL, then curl options.
status_of() {
  local url="$1"
  shift
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --proto '=https,http' "$@" "$url" \
    2>/dev/null || true
}

# Whether a GET answers 200. Args: the path; through the edge on staging (pages and content),
# else straight to the given 127.0.0.1 port.
answers_200() {
  local path="$1" port="$2" code
  if [[ "$ENV_NAME" == staging ]]; then
    code="$(status_of "https://$EDGE_HOST$path" --resolve "$EDGE_HOST:443:127.0.0.1")"
  else
    code="$(status_of "http://127.0.0.1:$port${path#/api}")"
  fi
  [[ "$code" == 200 ]]
}

# The image's own health probe (the Dockerfile's HEALTHCHECK) inside one process type's container.
# Args: the process type.
probe_inside() {
  docker exec "jadero-$ENV_NAME-$1-1" node -e \
    "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
    >/dev/null 2>&1
}

check_ready() {
  local ok=1
  case "$SERVICE" in
    api)
      [[ "$(status_of "http://127.0.0.1:$API_PORT/health/ready")" == 200 ]] || ok=0
      probe_inside api-worker || ok=0
      ;;
    agent)
      probe_inside agent || ok=0
      probe_inside agent-consumer || ok=0
      ;;
    web) [[ "$(status_of "http://127.0.0.1:$WEB_PORT/robots.txt")" == 200 ]] || ok=0 ;;
  esac
  [[ $ok -eq 1 ]] && report ready ok || report ready failed
}

check_pages() {
  local locale ok=1
  for locale in $LOCALES; do
    answers_200 "/$locale" "$WEB_PORT" || ok=0
  done
  [[ $ok -eq 1 ]] && report pages ok || report pages failed
}

check_content() {
  answers_200 /api/v1/content/en/projects "$API_PORT" && report content ok || report content failed
}

# Unix seconds of jadero/api's last heartbeat in agent's database, or nothing.
last_ping() {
  docker exec -i -u postgres "$PG_CONTAINER" psql -X -q -At -v ON_ERROR_STOP=1 \
    -d "agent_$ENV_NAME" 2>/dev/null <<'SQL' | grep -E '^[0-9]+$' | head -n 1
BEGIN TRANSACTION READ ONLY;
SELECT floor(extract(epoch FROM last_seen_at))::bigint FROM heartbeat.broker_heartbeat WHERE source = 'jadero/api';
COMMIT;
SQL
}

check_ping() {
  local deadline=$((SECONDS + ping_timeout)) seen
  while true; do
    seen="$(last_ping)"
    if [[ -n "$seen" && "$seen" -gt "$SINCE" ]]; then
      report ping ok
      return
    fi
    if [[ $SECONDS -ge $deadline ]]; then
      report ping failed
      return
    fi
    sleep "$ping_interval"
  done
}

check_ready
for check in "pages web api" "content api" "ping api agent"; do
  # shellcheck disable=SC2086 # the check's name and path are separate words on purpose
  set -- $check
  name="$1"
  shift
  case "$(gate "$@")" in
    run) "check_$name" ;;
    skip) report "$name" skipped ;;
    off) ;;
  esac
done

exit "$failed"
