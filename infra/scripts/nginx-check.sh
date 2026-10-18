#!/bin/bash
#
# nginx-check.sh: installs the repo's nginx edge into a throwaway Ubuntu 26.04 container with the
# distro nginx (the server's release, ADR-050) and runs `nginx -t` on it; with --smoke it also
# starts nginx and runs smoke-edge.sh against it (WP-8 step 5). Run by the `nginx` job of ci.yml
# and by `pnpm nginx:check`, never on the server: it overwrites /etc/nginx.
#
# Usage (from the repo root, the infra folder mounted read-only at /infra):
#   docker run --rm -v "$PWD/infra:/infra:ro" <ubuntu:26.04 by digest> bash /infra/scripts/nginx-check.sh [--smoke]
#
# The certificates are throwaway self-signed ones at the paths certbot uses on the server
# (/etc/letsencrypt/live/<host>/), valid 30 days. No upstream runs, so the proxied paths answer
# 502 in the smoke run, which smoke-edge.sh counts as routed.

set -euo pipefail
export LC_ALL=C
export DEBIAN_FRONTEND=noninteractive

readonly SRC=/infra
readonly HOSTS=(new.jadero.dev admin.jadero.dev stats.jadero.dev status.jadero.dev)

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
apt-get install -y -qq --no-install-recommends nginx openssl curl ca-certificates >/dev/null
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

for host in "${HOSTS[@]}"; do
  dir="/etc/letsencrypt/live/$host"
  install -d -m 700 "$dir"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 \
    -subj "/CN=$host" -addext "subjectAltName=DNS:$host" \
    -keyout "$dir/privkey.pem" -out "$dir/fullchain.pem" 2>/dev/null
done

nginx -t

if [[ "$smoke" -eq 1 ]]; then
  nginx
  bash "$SRC/scripts/smoke-edge.sh" --resolve 127.0.0.1 --insecure "${HOSTS[@]}"
fi
