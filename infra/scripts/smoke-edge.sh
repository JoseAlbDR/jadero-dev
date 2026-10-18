#!/bin/bash
#
# smoke-edge.sh: checks the nginx edge from outside, per host (WP-8 step 5; ADR-047's edge part,
# D6 in docs/learning/wp-8.md). Read-only: it sends GET, HEAD and OPTIONS requests and TLS
# handshakes, nothing else.
#
# Usage: smoke-edge.sh [--resolve ADDR] [--https-port N] [--http-port N] [--insecure]
#                      [--min-days N] [host ...]
#
#   host           the hosts to check; default: new., admin., stats. and status.jadero.dev
#   --resolve ADDR connect to ADDR for every host instead of asking DNS (a local run, or one
#                  host before its DNS record exists); the names still go in SNI and Host
#   --https-port   default 443; --http-port: default 80
#   --insecure     accept a certificate that does not verify (self-signed, in a local run)
#   --min-days     fail when a certificate expires in fewer days; default 14
#
# Per host: the edge headers on a response (HSTS, nosniff, Referrer-Policy, Permissions-Policy),
# a Server header without a version, HTTP/2, no Access-Control-* header (also on a preflight
# OPTIONS with an Origin), 404 on internal paths, the allowlisted paths routed (anything but 404),
# a 301 to https on port 80, TLS 1.1 refused, TLS 1.2 and 1.3 accepted, and the days left on the
# certificate. Once: a name no server claims gets no TLS handshake on 443 and no response on 80.
# Local run against a container with no upstreams: the proxied paths answer 502, which counts as
# routed. Exit 0 when every check passed, 1 otherwise, 2 on a usage error.
#
# Needs bash, curl and openssl 3. LC_ALL=C, like the other scripts: the header and output matches
# below compare ASCII bytes whatever locale the caller has.

set -uo pipefail
export LC_ALL=C

readonly DEFAULT_HOSTS="new.jadero.dev admin.jadero.dev stats.jadero.dev status.jadero.dev"
# A name nobody serves (RFC 2606), for the catch-all default server.
readonly UNKNOWN_HOST="unknown.invalid"

resolve=""
https_port=443
http_port=80
insecure=0
min_days=14
hosts=()

# Prints the usage to stderr and exits 2.
usage() {
  sed -n '7,8p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resolve) [[ $# -ge 2 ]] || usage; resolve="$2"; shift 2 ;;
    --https-port) [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || usage; https_port="$2"; shift 2 ;;
    --http-port) [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || usage; http_port="$2"; shift 2 ;;
    --insecure) insecure=1; shift ;;
    --min-days) [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || usage; min_days="$2"; shift 2 ;;
    -h | --help) usage ;;
    -*) usage ;;
    *) hosts+=("$1"); shift ;;
  esac
done
if [[ ${#hosts[@]} -eq 0 ]]; then
  read -ra hosts <<<"$DEFAULT_HOSTS"
fi

failures=0

# Prints one passed check: pass <host> <check>.
pass() {
  printf 'ok    %-20s %s\n' "$1" "$2"
}

# Prints one failed check and counts it: fail <host> <check> [detail].
fail() {
  printf 'FAIL  %-20s %s%s\n' "$1" "$2" "${3:+ ($3)}"
  failures=$((failures + 1))
}

# Prints the curl options that send <host> to the --resolve address, if one is set.
curl_target() {
  local host="$1"
  local addr="$resolve"
  [[ -n "$addr" ]] || return 0
  [[ "$addr" == *:* ]] && addr="[$addr]"
  printf '%s\n' --resolve "$host:$https_port:$addr" --resolve "$host:$http_port:$addr"
}

# Runs curl with the common options for <host>; the remaining arguments go to curl.
fetch() {
  local host="$1"
  shift
  # --path-as-is sends dot segments as written, so nginx, not curl, resolves them.
  local -a opts=(-sS --max-time 10 --proto '=https,http' --path-as-is)
  [[ "$insecure" -eq 1 ]] && opts+=(-k)
  local line
  while IFS= read -r line; do opts+=("$line"); done < <(curl_target "$host")
  curl "${opts[@]}" "$@"
}

# Prints the HTTP status of <method> <url> for <host>, or 000 when no response came.
status_of() {
  local host="$1" method="$2" url="$3"
  fetch "$host" -X "$method" -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true
}

# Prints the address and port openssl connects to for <host>.
tls_target() {
  local host="$1"
  local addr="${resolve:-$host}"
  [[ "$addr" == *:* ]] && addr="[$addr]"
  printf '%s:%s' "$addr" "$https_port"
}

# Runs one TLS handshake to <host> with SNI <name> and the extra openssl options; prints openssl's
# brief output and returns its exit status.
handshake() {
  local host="$1" name="$2"
  shift 2
  openssl s_client -brief -connect "$(tls_target "$host")" -servername "$name" "$@" </dev/null 2>&1
}

# The internal paths that must answer 404 on <host>.
internal_paths() {
  case "$1" in
    new.jadero.dev)
      echo /api/health/ready /api/health/live /api/revalidate /api/internal/ping \
        /api/v1/content/%2e%2e/%2e%2e/health/ready /api/v1/content/../../health/ready ;;
    admin.jadero.dev) echo /api/health/ready /api/v1/content/ ;;
    stats.jadero.dev)
      echo /login /dashboard /api/auth/login /api/websites /api/heartbeat /api/record \
        /recorder.js /api/send/../auth/login ;;
    status.jadero.dev)
      echo /dashboard /setup /metrics /socket.io/ /api/push/x /api/badge/1/status \
        /api/entry-page /status/other /api/status-page/other /manifest.json ;;
    *) echo /api/health/ready ;;
  esac
}

# The allowlisted paths that must be routed (anything but 404) on <host>.
routed_paths() {
  case "$1" in
    new.jadero.dev) echo / /api/v1/content/pages ;;
    admin.jadero.dev) echo / ;;
    stats.jadero.dev) echo /script.js ;;
    status.jadero.dev)
      echo /status/jadero /api/status-page/jadero /api/status-page/heartbeat/jadero \
        /assets/x.js /icon.svg ;;
    *) echo / ;;
  esac
}

# The path a browser would send a cross-origin preflight to on <host>.
preflight_path() {
  case "$1" in
    new.jadero.dev) echo /api/v1/content/pages ;;
    stats.jadero.dev) echo /api/send ;;
    status.jadero.dev) echo /api/status-page/jadero ;;
    *) echo / ;;
  esac
}

# Prints the days until <host>'s certificate expires, or nothing when it cannot be read.
cert_days_left() {
  local host="$1" end end_s now_s
  end="$(openssl s_client -connect "$(tls_target "$host")" -servername "$host" </dev/null 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | sed -n 's/^notAfter=//p')"
  [[ -n "$end" ]] || return 0
  # GNU date first, then BSD date (macOS).
  end_s="$(date -u -d "$end" +%s 2>/dev/null || date -u -j -f '%b %e %T %Y %Z' "$end" +%s 2>/dev/null)"
  [[ -n "$end_s" ]] || return 0
  now_s="$(date -u +%s)"
  echo $(((end_s - now_s) / 86400))
}

# Runs every check for one host.
check_host() {
  local host="$1"
  local base="https://$host:$https_port"
  local headers code path out days

  # Edge headers, on whatever / answers (200, 302, 404 or a local 502: `always` covers them all).
  headers="$(fetch "$host" -o /dev/null -D - "$base/" 2>&1 | tr -d '\r')"
  if [[ -z "$headers" || "$headers" != HTTP/* ]]; then
    fail "$host" "HTTPS response" "$(head -n 1 <<<"$headers")"
    return
  fi
  local first_line
  first_line="$(head -n 1 <<<"$headers")"
  if [[ "$first_line" == HTTP/2* ]]; then
    pass "$host" "HTTP/2"
  else
    fail "$host" "HTTP/2" "$first_line"
  fi

  local name
  for name in strict-transport-security x-content-type-options referrer-policy permissions-policy; do
    if grep -qi "^$name:" <<<"$headers"; then
      pass "$host" "header $name"
    else
      fail "$host" "header $name" "missing"
    fi
  done
  grep -qi '^x-content-type-options: nosniff$' <<<"$headers" \
    || fail "$host" "nosniff value" "$(grep -i '^x-content-type-options:' <<<"$headers")"

  local server
  server="$(grep -i '^server:' <<<"$headers" | head -n 1 | sed 's/^[^:]*: *//')"
  if [[ "$server" == "nginx" ]]; then
    pass "$host" "Server without a version"
  else
    fail "$host" "Server without a version" "server: ${server:-none}"
  fi

  if grep -qi '^access-control-' <<<"$headers"; then
    fail "$host" "no Access-Control-* header" "$(grep -i '^access-control-' <<<"$headers" | head -n 1)"
  else
    pass "$host" "no Access-Control-* header"
  fi

  # A browser's CORS preflight from another origin gets no Access-Control-* header either.
  path="$(preflight_path "$host")"
  out="$(fetch "$host" -X OPTIONS -o /dev/null -D - -H 'Origin: https://example.com' \
    -H 'Access-Control-Request-Method: POST' "$base$path" 2>&1 | tr -d '\r')"
  if grep -qi '^access-control-' <<<"$out"; then
    fail "$host" "no CORS on preflight $path" "$(grep -i '^access-control-' <<<"$out" | head -n 1)"
  else
    pass "$host" "no CORS on preflight $path"
  fi

  for path in $(internal_paths "$host"); do
    code="$(status_of "$host" GET "$base$path")"
    if [[ "$code" == 404 ]]; then
      pass "$host" "404 $path"
    else
      fail "$host" "404 $path" "got $code"
    fi
  done

  for path in $(routed_paths "$host"); do
    code="$(status_of "$host" GET "$base$path")"
    if [[ "$code" != 404 && "$code" != 000 ]]; then
      pass "$host" "routed $path ($code)"
    else
      fail "$host" "routed $path" "got $code"
    fi
  done

  # Port 80: a permanent redirect to the same path on https.
  out="$(fetch "$host" -o /dev/null -w '%{http_code} %{redirect_url}' "http://$host:$http_port/x?y=1" 2>&1)"
  if [[ "$out" == "301 https://$host/x?y=1" ]]; then
    pass "$host" "port 80 redirects to https"
  else
    fail "$host" "port 80 redirects to https" "$out"
  fi

  # TLS 1.1 offered at security level 0, so a refusal is the server's, not this client's.
  out="$(handshake "$host" "$host" -tls1_1 -cipher 'DEFAULT:@SECLEVEL=0')"
  if grep -q 'no protocols available' <<<"$out"; then
    fail "$host" "TLS 1.1 refused" "this openssl cannot offer TLS 1.1, inconclusive"
  elif grep -q 'Protocol version: TLSv1.1' <<<"$out"; then
    fail "$host" "TLS 1.1 refused" "accepted"
  else
    pass "$host" "TLS 1.1 refused"
  fi
  local version
  for version in 1.2 1.3; do
    out="$(handshake "$host" "$host" "-tls${version/./_}")"
    if grep -q "Protocol version: TLSv$version" <<<"$out"; then
      pass "$host" "TLS $version accepted"
    else
      fail "$host" "TLS $version accepted" "$(grep -m 1 -iE 'error|alert' <<<"$out")"
    fi
  done

  days="$(cert_days_left "$host")"
  if [[ -z "$days" ]]; then
    fail "$host" "certificate" "could not read its expiry"
  elif [[ "$days" -lt "$min_days" ]]; then
    fail "$host" "certificate days left: $days" "under $min_days"
  else
    pass "$host" "certificate days left: $days"
  fi
}

# The catch-all default server, reached at the first host's address with a name nobody serves.
check_default_server() {
  local first="$1" out code
  out="$(handshake "$first" "$UNKNOWN_HOST" -tls1_3)"
  if grep -q 'Protocol version:' <<<"$out"; then
    fail "$UNKNOWN_HOST" "TLS handshake refused on 443" "completed"
  else
    pass "$UNKNOWN_HOST" "TLS handshake refused on 443"
  fi
  # 444: nginx closes the connection without a response; curl reports an empty reply (exit 52).
  fetch "$first" -o /dev/null -H "Host: $UNKNOWN_HOST" "http://$first:$http_port/" 2>/dev/null
  code=$?
  if [[ "$code" -eq 52 ]]; then
    pass "$UNKNOWN_HOST" "no response on 80"
  else
    fail "$UNKNOWN_HOST" "no response on 80" "curl exit $code"
  fi
}

for host in "${hosts[@]}"; do
  check_host "$host"
done
check_default_server "${hosts[0]}"

if [[ "$failures" -eq 0 ]]; then
  echo "smoke-edge: every check passed"
  exit 0
fi
echo "smoke-edge: $failures check(s) failed"
exit 1
