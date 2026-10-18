#!/bin/bash
#
# nginx-check.sh: installs the repo's nginx edge into a throwaway Ubuntu 26.04 container with the
# distro nginx (the server's release, ADR-050) and runs `nginx -t` on it; with --smoke it also
# starts nginx and runs smoke-edge.sh against it (WP-8 step 5). It also installs the error log
# rotation of ADR-052 and runs `logrotate -d` on it. Run by the `nginx` job of ci.yml
# and by `pnpm nginx:check`, never on the server: it overwrites /etc/nginx.
#
# Usage (from the repo root, the infra folder mounted read-only at /infra):
#   docker run --rm -v "$PWD/infra:/infra:ro" <ubuntu:26.04 by digest> bash /infra/scripts/nginx-check.sh [--smoke]
#
# The certificates are throwaway self-signed ones at the paths certbot uses on the server
# (/etc/letsencrypt/live/<host>/), valid 30 days. Only a stub Umami runs (below), so the other
# proxied paths answer 502 in the smoke run, which smoke-edge.sh counts as routed.

set -euo pipefail
export LC_ALL=C
export DEBIAN_FRONTEND=noninteractive

readonly SRC=/infra
readonly HOSTS=(new.jadero.dev admin.jadero.dev status.jadero.dev)

smoke=0
case "${1:-}" in
  "") ;;
  --smoke) smoke=1 ;;
  *) echo "usage: nginx-check.sh [--smoke]" >&2; exit 2 ;;
esac

# shellcheck source=/dev/null
[[ -f /etc/os-release ]] && . /etc/os-release
if [[ "${VERSION_ID:-}" != "26.04" ]]; then
  echo "nginx-check: expected Ubuntu 26.04, found ${PRETTY_NAME:-unknown}" >&2
  exit 1
fi

apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends nginx logrotate openssl curl ca-certificates >/dev/null
nginx -v

# The repo's files, laid out as the README's install steps lay them out on the server.
install -m 644 "$SRC/nginx/nginx.conf" /etc/nginx/nginx.conf
install -m 644 "$SRC"/nginx/snippets/jadero-*.conf /etc/nginx/snippets/
rm -f /etc/nginx/sites-enabled/default
for site in "$SRC"/nginx/sites/*.conf; do
  install -m 644 "$site" /etc/nginx/sites-available/
  ln -sf "/etc/nginx/sites-available/$(basename "$site")" /etc/nginx/sites-enabled/
done
install -d -m 755 /srv/jadero/www/admin
install -m 644 "$SRC"/nginx/www/admin/* /srv/jadero/www/admin/
# The sites' error logs and their rotation (ADR-052); the folder owned like its parent.
install -d -o root -g adm -m 755 /var/log/nginx/jadero
install -m 644 "$SRC/logrotate/jadero-nginx" /etc/logrotate.d/jadero-nginx

for host in "${HOSTS[@]}"; do
  dir="/etc/letsencrypt/live/$host"
  install -d -m 700 "$dir"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 \
    -subj "/CN=$host" -addext "subjectAltName=DNS:$host" \
    -keyout "$dir/privkey.pem" -out "$dir/fullchain.pem" 2>/dev/null
done

nginx -t

# ADR-052: every site's error log is a file in /var/log/nginx/jadero/ (nginx -t opened them), our
# rule rotates them, and no file is claimed by both our rule and Ubuntu's: logrotate stops on a
# second rule for one file with "duplicate log entry", so the whole configuration must parse
# without an error. Debug mode (-d) rotates nothing and runs no script.
for name in default "${HOSTS[@]}"; do
  if [[ ! -f "/var/log/nginx/jadero/$name.error.log" ]]; then
    echo "nginx-check: no /var/log/nginx/jadero/$name.error.log after nginx -t" >&2
    exit 1
  fi
done
# Runs `logrotate -d` on a configuration; prints its errors and fails on any.
logrotate_debug() {
  local out
  out="$(logrotate -d "$1" 2>&1)" || { printf '%s\n' "$out" >&2; return 1; }
  if grep -q '^error:' <<<"$out"; then
    grep '^error:' <<<"$out" >&2
    return 1
  fi
  printf '%s\n' "$out"
}
lr="$(logrotate_debug /etc/logrotate.d/jadero-nginx)"
for name in default "${HOSTS[@]}"; do
  grep -qx "considering log /var/log/nginx/jadero/$name.error.log" <<<"$lr" || {
    echo "nginx-check: /etc/logrotate.d/jadero-nginx does not rotate $name.error.log" >&2
    exit 1
  }
done
grep -E '^(rotating pattern|considering log)' <<<"$lr"
logrotate_debug /etc/logrotate.conf >/dev/null
echo "logrotate: Ubuntu's rule and jadero-nginx claim no file twice"
# The check has teeth: the same rule twice is refused.
cat /etc/logrotate.d/jadero-nginx /etc/logrotate.d/jadero-nginx >/tmp/logrotate-twice.conf
if logrotate_debug /tmp/logrotate-twice.conf >/dev/null 2>&1; then
  echo "nginx-check: logrotate accepted a file claimed by two rules" >&2
  exit 1
fi

if [[ "$smoke" -eq 1 ]]; then
  # A stub Umami on its port (ADR-051): it answers with the method and path it received, and sends
  # `Access-Control-Allow-Origin: *` as Umami does, so the run proves which Umami path each /s/
  # path reaches and that the edge hides the header. Outside infra/nginx, never on the server.
  cat >/etc/nginx/sites-enabled/zz-umami-stub.conf <<'STUB'
server {
	listen 127.0.0.1:3100;
	access_log off;
	default_type text/plain;
	add_header Access-Control-Allow-Origin "*" always;
	location / {
		return 200 "umami $request_method $uri\n";
	}
}
STUB
  nginx
  status=0
  bash "$SRC/scripts/smoke-edge.sh" --resolve 127.0.0.1 --insecure "${HOSTS[@]}" || status=1

  # Each first-party path reaches Umami's own path, with the method it allows.
  umami() {
    curl -sS -k --max-time 10 --resolve new.jadero.dev:443:127.0.0.1 "$@" 2>/dev/null || true
  }
  expect() {
    if [[ "$2" == "$3" ]]; then
      printf 'ok    %-20s %s\n' new.jadero.dev "$1"
    else
      printf 'FAIL  %-20s %s (got %s)\n' new.jadero.dev "$1" "${3:-nothing}"
      status=1
    fi
  }
  expect "/s/script.js reaches Umami /script.js" "umami GET /script.js" \
    "$(umami https://new.jadero.dev/s/script.js)"
  expect "POST /s/api/send reaches Umami /api/send" "umami POST /api/send" \
    "$(umami -X POST -H 'Content-Type: application/json' -d '{}' https://new.jadero.dev/s/api/send)"
  expect "GET /s/api/send refused" 403 \
    "$(umami -o /dev/null -w '%{http_code}' https://new.jadero.dev/s/api/send)"
  expect "POST over 64k to /s/api/send refused" 413 \
    "$(head -c 70000 /dev/zero | tr '\0' a | umami -o /dev/null -w '%{http_code}' -X POST \
      --data-binary @- https://new.jadero.dev/s/api/send)"
  exit "$status"
fi
