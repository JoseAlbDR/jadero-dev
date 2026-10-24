#!/bin/bash
#
# smoke-edge.sh: checks the nginx edge from outside, per host (WP-8 step 5; ADR-047's edge part,
# D6 in docs/learning/wp-8.md). Read-only: it sends GET, HEAD and OPTIONS requests and TLS
# handshakes, nothing else.
#
# Usage: smoke-edge.sh [--resolve ADDR] [--https-port N] [--http-port N] [--insecure]
#                      [--min-days N] [host ...]
#
#   host           the hosts to check; default: new., admin. and status.jadero.dev
#   --resolve ADDR connect to ADDR for every host instead of asking DNS (a local run, or one
#                  host before its DNS record exists); the names still go in SNI and Host
#   --https-port   default 443; --http-port: default 80
#   --insecure     accept a certificate that does not verify (self-signed, in a local run)
#   --min-days     fail when a certificate expires in fewer days; default 14
#
# Per host: the edge headers on a response (HSTS, nosniff, Referrer-Policy, Permissions-Policy),
# a Server header without a version, HTTP/2, no Access-Control-* header (also on a preflight
# OPTIONS with an Origin), 404 on internal paths, the allowlisted paths routed (anything but 404)
# with no Access-Control-* header, the POST-only paths routed for POST and refused (403) for GET,
# a 301 to https on port 80, TLS 1.1 refused, TLS 1.2 and 1.3 accepted, and the days left on the
# certificate. On new.jadero.dev, when / answers 502, 503 or 504 (an upstream down: a deploy's
# recreate, or a local run), the answer must be the maintenance page with no-store and its CSP,
# and when the content API answers 503 it must be problem details (application/problem+json,
# "status":503), never the page, and never 502 or 504; when the site is up that check says so and
# passes. Once: a name no server claims gets no TLS handshake on 443 and no response on 80.
# Local run against a container with no upstreams: the proxied paths answer 502, which counts as
# routed. Exit 0 when every check passed, 1 otherwise, 2 on a usage error.
#
# Needs bash, curl and openssl 3. LC_ALL=C, like the other scripts: the header and output matches
# below compare ASCII bytes whatever locale the caller has.

set -uo pipefail
export LC_ALL=C

readonly DEFAULT_HOSTS="new.jadero.dev admin.jadero.dev status.jadero.dev"
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
        /api/v1/content/%2e%2e/%2e%2e/health/ready /api/v1/content/../../health/ready \
        /api/send /s/ /s/login /s/dashboard /s/api/auth/login /s/api/websites /s/api/heartbeat \
        /s/api/record /s/recorder.js /s/api/send/../auth/login /s/script.js/x /maintenance.html \
        /maintenance.problem.json ;;
    admin.jadero.dev) echo /api/health/ready /api/v1/content/ ;;
    status.jadero.dev)
      echo /dashboard /setup /metrics /socket.io/ /api/push/x /api/badge/1/status \
        /api/entry-page /status/other /api/status-page/other /manifest.json ;;
    *) echo /api/health/ready ;;
  esac
}

# The allowlisted paths that must be routed (anything but 404) on <host>.
routed_paths() {
  case "$1" in
    new.jadero.dev) echo / /api/v1/content/pages /s/script.js ;;
    admin.jadero.dev) echo / ;;
    status.jadero.dev)
      echo /status/jadero /api/status-page/jadero /api/status-page/heartbeat/jadero \
        /assets/x.js /icon.svg ;;
    *) echo / ;;
  esac
}

# The paths that must be routed for POST and refused (403) for GET on <host>.
post_paths() {
  case "$1" in
    new.jadero.dev) echo /s/api/send ;;
    *) ;;
  esac
}

# The paths a browser would send a cross-origin preflight to on <host>.
preflight_paths() {
  case "$1" in
    new.jadero.dev) echo /api/v1/content/pages /s/api/send ;;
    status.jadero.dev) echo /api/status-page/jadero ;;
    *) echo / ;;
  esac
}

# Checks one response's headers on <host>: no Access-Control-* header. Args: host, check, headers.
no_cors() {
  if grep -qi '^access-control-' <<<"$3"; then
    fail "$1" "$2" "$(grep -i '^access-control-' <<<"$3" | head -n 1)"
  else
    pass "$1" "$2"
  fi
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

# The hosts whose upstream errors nginx answers with the maintenance page (WP-9 step 4).
has_maintenance_page() {
  [[ "$1" == new.jadero.dev ]]
}

# On a host with the maintenance page: when / answers 502, 503 or 504, the body is the page and
# the headers say no-store, with a CSP. Args: host, base URL.
check_maintenance() {
  local host="$1" base="$2" headers body code
  headers="$(fetch "$host" -o /dev/null -D - "$base/" 2>/dev/null | tr -d '\r')"
  code="$(head -n 1 <<<"$headers" | awk '{print $2}')"
  case "$code" in
    502 | 503 | 504) ;;
    *)
      pass "$host" "maintenance page not shown: / answers ${code:-nothing}"
      return
      ;;
  esac
  body="$(fetch "$host" "$base/" 2>/dev/null)"
  if grep -q '<title>jadero.dev is updating</title>' <<<"$body"; then
    pass "$host" "maintenance page on $code"
  else
    fail "$host" "maintenance page on $code" "another body"
  fi
  if grep -qi '^cache-control: no-store$' <<<"$headers"; then
    pass "$host" "maintenance page not cached"
  else
    fail "$host" "maintenance page not cached" "$(grep -i '^cache-control:' <<<"$headers" || echo none)"
  fi
  if grep -qi "^content-security-policy: default-src 'none';" <<<"$headers"; then
    pass "$host" "maintenance page CSP"
  else
    fail "$host" "maintenance page CSP" "missing"
  fi
}

# On a host with the maintenance page: while api is down, the content API answers 503 with RFC 9457
# problem details, never the HTML page and never a 502 or 504 (the edge maps them to 503). api's own
# 503 is problem details too, so the check holds whichever side answered. Args: host, base URL.
check_api_maintenance() {
  local host="$1" base="$2" headers body code
  headers="$(fetch "$host" -o /dev/null -D - "$base/api/v1/content/pages" 2>/dev/null | tr -d '\r')"
  code="$(head -n 1 <<<"$headers" | awk '{print $2}')"
  case "$code" in
    503) ;;
    502 | 504)
      fail "$host" "API maintenance answer is 503" "got $code"
      return
      ;;
    *)
      pass "$host" "API maintenance answer not shown: the API answers ${code:-nothing}"
      return
      ;;
  esac
  if grep -qi '^content-type: application/problem+json' <<<"$headers"; then
    pass "$host" "API maintenance answer is problem details"
  else
    fail "$host" "API maintenance answer is problem details" \
      "$(grep -i '^content-type:' <<<"$headers" || echo none)"
  fi
  body="$(fetch "$host" "$base/api/v1/content/pages" 2>/dev/null)"
  if grep -qE '"status": *503' <<<"$body" && ! grep -qi '<html' <<<"$body"; then
    pass "$host" "API maintenance body says 503"
  else
    fail "$host" "API maintenance body says 503" "another body"
  fi
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
  for path in $(preflight_paths "$host"); do
    out="$(fetch "$host" -X OPTIONS -o /dev/null -D - -H 'Origin: https://example.com' \
      -H 'Access-Control-Request-Method: POST' "$base$path" 2>&1 | tr -d '\r')"
    no_cors "$host" "no CORS on preflight $path" "$out"
  done

  for path in $(internal_paths "$host"); do
    code="$(status_of "$host" GET "$base$path")"
    if [[ "$code" == 404 ]]; then
      pass "$host" "404 $path"
    else
      fail "$host" "404 $path" "got $code"
    fi
  done

  for path in $(routed_paths "$host"); do
    out="$(fetch "$host" -o /dev/null -D - -H 'Origin: https://example.com' "$base$path" 2>&1 \
      | tr -d '\r')"
    code="$(head -n 1 <<<"$out" | awk '{print $2}')"
    if [[ "$out" == HTTP/* && "$code" != 404 ]]; then
      pass "$host" "routed $path ($code)"
    else
      fail "$host" "routed $path" "got ${code:-no response}"
    fi
    no_cors "$host" "no Access-Control-* on $path" "$out"
  done

  # POST-only paths (Umami's collect endpoint): routed for POST, refused for GET.
  for path in $(post_paths "$host"); do
    out="$(fetch "$host" -X POST -o /dev/null -D - -H 'Origin: https://example.com' \
      -H 'Content-Type: application/json' -d '{}' "$base$path" 2>&1 | tr -d '\r')"
    code="$(head -n 1 <<<"$out" | awk '{print $2}')"
    if [[ "$out" == HTTP/* && "$code" != 404 && "$code" != 403 ]]; then
      pass "$host" "routed POST $path ($code)"
    else
      fail "$host" "routed POST $path" "got ${code:-no response}"
    fi
    no_cors "$host" "no Access-Control-* on POST $path" "$out"
    code="$(status_of "$host" GET "$base$path")"
    if [[ "$code" == 403 ]]; then
      pass "$host" "GET $path refused (403)"
    else
      fail "$host" "GET $path refused (403)" "got $code"
    fi
  done

  if has_maintenance_page "$host"; then
    check_maintenance "$host" "$base"
    check_api_maintenance "$host" "$base"
  fi

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
