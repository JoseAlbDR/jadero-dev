# nginx edge

The host nginx in front of everything on the server (ADR-002; ADR-050 restating ADR-027's host
nginx and certbot; ADR-047's edge part; WP-8 D6 and the 2026-10-18 amendment in
`docs/learning/wp-8.md`). The repo owns the generic `nginx.conf`, the shared snippets and one file
per jadero.dev host. The owner's older sites on the same host keep their own files on the host,
outside this public repo, and use the same `nginx.conf` and snippets.

## Layout

| Path | Installed as | What it holds |
|---|---|---|
| `nginx.conf` | `/etc/nginx/nginx.conf` | Ubuntu 26.04's packaged file plus `server_tokens off`, the TLS policy (TLS 1.2 and 1.3, Mozilla intermediate ciphers, shared session cache, no session tickets), the `jadero` access log format, the `jadero_api` rate limit zone (429) and a 1 MiB body limit |
| `snippets/jadero-security-headers.conf` | `/etc/nginx/snippets/` | HSTS (trial `max-age=300`), `nosniff`, `Referrer-Policy`, a deny-all `Permissions-Policy`, all with `always`; included once per HTTPS server |
| `snippets/jadero-proxy.conf` | `/etc/nginx/snippets/` | proxy headers to the upstream; hides `X-Powered-By`, the upstream copies of the edge headers and every `Access-Control-*` header; included once per proxying server |
| `snippets/jadero-api-limits.conf` | `/etc/nginx/snippets/` | `limit_req` (about 10 r/s per client, burst 20) and a 64 KiB body limit; included in each API location |
| `sites/00-default.conf` | `sites-available/`, linked in `sites-enabled/` | the catch-all default server: TLS handshake refused on 443, connection closed on 80 |
| `sites/<host>.conf` | `sites-available/`, linked in `sites-enabled/` | one file per host, below |
| `www/admin/index.html` | `/srv/jadero/www/admin/index.html` | the admin placeholder page until WP-17 |

`scripts/nginx-hardening.test.mjs` (in `pnpm verify`) checks the rules statically; the `nginx` job
of `ci.yml` and `pnpm nginx:check` install everything into Ubuntu 26.04 with the distro nginx, run
`nginx -t` and then `infra/scripts/smoke-edge.sh` against it.

## Hosts and routes

Every upstream is a port published on `127.0.0.1` (ADR-027). Allowlist routing: a host proxies only
its public paths, and everything else answers 404 at the edge.

| Host | Proxied | Everything else |
|---|---|---|
| `new.jadero.dev` (staging) | `/` to `web` on 127.0.0.1:3120; `/api/v1/content/` to `api` on 127.0.0.1:3121 as `/v1/content/` | every other `/api/` path 404 (health, revalidation, internal routes) |
| `admin.jadero.dev` | nothing yet: the static placeholder, under a static CSP with `frame-ancestors 'none'` | `/api/` 404 until WP-17 |
| `stats.jadero.dev` | Umami on 127.0.0.1:3100: `/script.js` and `/api/send` | 404, the login page and dashboards included |
| `status.jadero.dev` | Uptime Kuma on 127.0.0.1:3101: `/status/jadero` (and `/rss`), its `/api/status-page/...` calls, `/assets/`, `/upload/`, the icons, `serviceWorker.js`, `robots.txt`; `/` redirects to `/status/jadero` | 404, the dashboard, socket.io, setup, `/metrics`, push and badge URLs included |

Production ports for the cutover (WP-29, when the `jadero.dev` host file arrives): `web` on
127.0.0.1:3110, `api` on 127.0.0.1:3111. Umami's and Uptime Kuma's admin screens are reached over
the tailnet through an SSH tunnel (WP-8 Q2 option B).

Every host on port 80 answers 301 to https, from `location /`, so the exact-match location that
certbot's nginx authenticator adds for a renewal still wins.

## Logs and privacy

- Access logs use the `jadero` format: time, the client's network (`/24` for IPv4, `/48` for IPv6),
  host, method, the path without its query string, protocol, status, bytes, request time and the
  upstream's status. Never the address in clear, the request line, the query string or a header.
- Each host has its own `/var/log/nginx/<host>.access.log` and `<host>.error.log`.
- `error_log` always writes the client address and the request line, query string included, of the
  request behind an entry (an upstream that refuses, a rate limit hit). nginx has no format for it,
  so those files rely on Ubuntu's logrotate (`/etc/logrotate.d/nginx`: daily, 14 files kept).
- The client address does reach the upstream (`X-Real-IP`, `X-Forwarded-For`): the services hash it
  before they log it, Umami uses it for its daily visitor hash and does not store it.

## Add a host

1. Copy the closest `sites/<host>.conf` to `sites/<new-host>.conf`: a port 80 server that
   redirects from `location /`, and a 443 server with `http2 on`, the certificate lines, its own
   `access_log ... jadero` and `error_log`, and `include snippets/jadero-security-headers.conf;`
   (plus `jadero-proxy.conf` when it proxies).
2. One location per public path; `include snippets/jadero-api-limits.conf;` in each API location;
   end with `location /api/ { return 404; }` (or `location / { return 404; }`).
3. Never `add_header`, `proxy_set_header` or `proxy_hide_header` inside a location: it drops every
   inherited one. A host-specific header goes at the server level, next to the snippet.
4. `pnpm verify` (the static rules) and `pnpm nginx:check` (`nginx -t` and the smoke run; add the
   host to `infra/scripts/nginx-check.sh` and its paths to `smoke-edge.sh`).

## Install on the server (owner)

In this order; every step after the backup can be undone by restoring it.

1. **DNS** at the registrar: `A` and `AAAA` records for `new`, `admin`, `stats` and `status` pointing
   at the server; on the apex, `CAA 0 issue "letsencrypt.org"` and `CAA 0 issuewild ";"` (an
   `accounturi` parameter is added later, from certbot's account file). Check with
   `dig +short CAA jadero.dev` and `dig +short A new.jadero.dev`.
2. **Back up** the current config: `sudo tar -C /etc -czf ~/nginx-backup-$(date +%F).tgz nginx`.
3. **Shared files:** copy `nginx.conf` to `/etc/nginx/nginx.conf` and the three snippets to
   `/etc/nginx/snippets/`; copy `sites/00-default.conf` to `sites-available/` and link it into
   `sites-enabled/`. Remove `sites-enabled/default` if it is there, and drop `default_server` from
   any older site that has it (only one default per address and port). In the older sites, remove
   any `ssl_protocols`, `ssl_ciphers` or `include /etc/letsencrypt/options-ssl-nginx.conf` (the TLS
   policy lives in `nginx.conf` only) and the old `stub_status` location; give each its
   `access_log ... jadero` and include the snippets where they fit.
4. `sudo nginx -t`, then `sudo systemctl reload nginx`; check that every older site still answers.
5. **Certificates**, one per host: `sudo certbot certonly --nginx -d new.jadero.dev`, and the same
   for `admin`, `stats` and `status`. `certonly` never edits a site file. Add a deploy hook so a
   renewal reloads nginx with the new certificate (the authenticator's own reload happens before
   the new files are saved): `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx` holding
   `#!/bin/sh` and `systemctl reload nginx`, mode 755. Check the renewal timer
   (`systemctl list-timers | grep certbot`) and `sudo certbot renew --dry-run`.
6. **Sites:** copy the four host files to `sites-available/` and link them into `sites-enabled/`;
   `sudo install -D -m 644 www/admin/index.html /srv/jadero/www/admin/index.html`.
7. `sudo nginx -t`, then `sudo systemctl reload nginx`.
8. **Smoke** from the laptop: `infra/scripts/smoke-edge.sh`. Every check should pass except the
   `new.jadero.dev` routes, which answer 502 until WP-9 deploys staging (502 counts as routed).
9. After a week with no problem: HSTS to `max-age=31536000; includeSubDomains` in the headers
   snippet (ADR-047), never `preload` until every subdomain is confirmed HTTPS only.

## Open points

- Umami's tracker posts from the site's origin to `stats.jadero.dev/api/send`, a cross-origin call
  that needs a CORS answer. Umami sends `Access-Control-Allow-Origin: *` there, and the proxy
  snippet hides it (ADR-047: no CORS on any host), so the tracker cannot report until a decision
  opens CORS for that one route and origin, or serves the collect path first-party. No page loads
  the tracker yet.
