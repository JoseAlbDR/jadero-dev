# nginx edge

The host nginx in front of everything on the server (ADR-002; ADR-050 restating ADR-027's host
nginx and certbot; ADR-047's edge part; ADR-051's first-party analytics path; WP-8 D6 and the
2026-10-18 amendments in `docs/learning/wp-8.md`; ADR-052's error log retention). The repo owns the generic `nginx.conf`, the shared snippets and one file
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
| `../logrotate/jadero-nginx` | `/etc/logrotate.d/jadero-nginx` | the sites' error logs in `/var/log/nginx/jadero/`: daily, three files kept, compressed, nginx reopens its logs after a rotation (ADR-052) |

`scripts/nginx-hardening.test.mjs` (in `pnpm verify`) checks the rules statically; the `nginx` job
of `ci.yml` and `pnpm nginx:check` install everything into Ubuntu 26.04 with the distro nginx, run
`nginx -t`, `logrotate -d` on the rotation rules (ours rotates every site's error log, and no file
is claimed by both ours and Ubuntu's) and then `infra/scripts/smoke-edge.sh` against it.

## Hosts and routes

Every upstream is a port published on `127.0.0.1` (ADR-027). Allowlist routing: a host proxies only
its public paths, and everything else answers 404 at the edge.

| Host | Proxied | Everything else |
|---|---|---|
| `new.jadero.dev` (staging) | `/` to `web` on 127.0.0.1:3120; `/api/v1/content/` to `api` on 127.0.0.1:3121 as `/v1/content/`; Umami's tracker on 127.0.0.1:3100: `/s/script.js` as `/script.js` and `/s/api/send` as `/api/send` (POST only, 403 for any other method, with the API limits) | every other `/api/` path 404 (health, revalidation, internal routes); every other `/s/` path 404 (Umami's login, dashboards, API and session recorder) |
| `admin.jadero.dev` | nothing yet: the static placeholder, under a static CSP with `frame-ancestors 'none'` | `/api/` 404 until WP-17 |
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
- Each host has its own `/var/log/nginx/<host>.access.log`, rotated by Ubuntu's rule
  (`/etc/logrotate.d/nginx`: daily, 14 files kept).
- `error_log` always writes the client address and the request line, query string included, of the
  request behind an entry (an upstream that refuses, a rate limit hit), and nginx has no format for
  it. So each host writes it to `/var/log/nginx/jadero/<host>.error.log` (the catch-all to
  `default.error.log`), level `error`, and `/etc/logrotate.d/jadero-nginx` keeps three files there
  (ADR-052). Ubuntu's glob does not enter the subfolder, so no file has two rules. The files are
  `0640 www-data adm`: only root and the `adm` group read them.
- The global `error_log` in `nginx.conf` stays on Ubuntu's rule: only sites without their own write
  there, and those are the owner's older sites, not this repo's.
- The client address does reach the upstream (`X-Real-IP`, `X-Forwarded-For`): the services hash it
  before they log it, Umami uses it for its daily visitor hash and does not store it.

## Add a host

1. Copy the closest `sites/<host>.conf` to `sites/<new-host>.conf`: a port 80 server that
   redirects from `location /`, and a 443 server with `http2 on`, the certificate lines, its own
   `access_log ... jadero` and `error_log /var/log/nginx/jadero/<new-host>.error.log` (the
   hardening test fails on any other folder), and `include snippets/jadero-security-headers.conf;`
   (plus `jadero-proxy.conf` when it proxies).
2. One location per public path; `include snippets/jadero-api-limits.conf;` in each API location;
   end with `location /api/ { return 404; }` (or `location / { return 404; }`).
3. Never `add_header`, `proxy_set_header` or `proxy_hide_header` inside a location: it drops every
   inherited one. A host-specific header goes at the server level, next to the snippet.
4. `pnpm verify` (the static rules) and `pnpm nginx:check` (`nginx -t` and the smoke run; add the
   host to `infra/scripts/nginx-check.sh` and its paths to `smoke-edge.sh`). The smoke run starts a
   stub Umami on 127.0.0.1:3100 that echoes the method and path it receives and sends
   `Access-Control-Allow-Origin: *`, so it proves where each `/s/` path lands and that the edge
   hides the header; every other upstream is absent and answers 502.

## Install on the server (owner)

In this order; every step after the backup can be undone by restoring it.

1. **DNS** at the registrar: `A` and `AAAA` records for `new`, `admin` and `status` pointing
   at the server; on the apex, `CAA 0 issue "letsencrypt.org"` and `CAA 0 issuewild ";"` (an
   `accounturi` parameter is added later, from certbot's account file). Check with
   `dig +short CAA jadero.dev` and `dig +short A new.jadero.dev`.
2. **Back up** the current config: `sudo tar -C /etc -czf ~/nginx-backup-$(date +%F).tgz nginx`.
   Then the error log folder, owned like its parent `/var/log/nginx`, and its rotation:
   `sudo install -d -o root -g adm -m 755 /var/log/nginx/jadero`;
   `sudo install -m 644 infra/logrotate/jadero-nginx /etc/logrotate.d/jadero-nginx`. Create each
   error log before nginx does, or it starts as `root 0644` (readable by every local user) until
   its first rotation: `sudo install -o www-data -g adm -m 640 /dev/null
   /var/log/nginx/jadero/<name>.error.log` for `default` and each host (new files only: `install`
   empties an existing one).
3. **Shared files:** copy `nginx.conf` to `/etc/nginx/nginx.conf` and the three snippets to
   `/etc/nginx/snippets/`; copy `sites/00-default.conf` to `sites-available/` and link it into
   `sites-enabled/`. Remove `sites-enabled/default` if it is there, and drop `default_server` from
   any older site that has it (only one default per address and port). In the older sites, remove
   any `ssl_protocols`, `ssl_ciphers` or `include /etc/letsencrypt/options-ssl-nginx.conf` (the TLS
   policy lives in `nginx.conf` only) and the old `stub_status` location; give each its
   `access_log ... jadero` and include the snippets where they fit.
4. `sudo nginx -t`, then `sudo systemctl reload nginx`; check that every older site still answers.
5. **Certificates**, one per host: `sudo certbot certonly --nginx -d new.jadero.dev`, and the same
   for `admin` and `status`. `certonly` never edits a site file. Add a deploy hook so a
   renewal reloads nginx with the new certificate (the authenticator's own reload happens before
   the new files are saved): `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx` holding
   `#!/bin/sh` and `systemctl reload nginx`, mode 755. Check the renewal timer
   (`systemctl list-timers | grep certbot`) and `sudo certbot renew --dry-run`.
6. **Sites:** copy the three host files to `sites-available/` and link them into `sites-enabled/`;
   `sudo install -D -m 644 www/admin/index.html /srv/jadero/www/admin/index.html`.
7. `sudo nginx -t`, then `sudo systemctl reload nginx`.
8. **Smoke** from the laptop: `infra/scripts/smoke-edge.sh`. Every check should pass; the
   `new.jadero.dev` routes to `web` and `api` answer 502 until WP-9 deploys staging (502 counts as
   routed), while `/s/script.js` and `/s/api/send` already reach Umami in the ops stack.
9. After a week with no problem: HSTS to `max-age=31536000; includeSubDomains` in the headers
   snippet (ADR-047), never `preload` until every subdomain is confirmed HTTPS only.

## Move the error logs on an installed server (ADR-052)

For a server installed before ADR-052, from the updated repo files copied to the server
(`scp infra/logrotate/jadero-nginx infra/nginx/nginx.conf infra/nginx/sites/*.conf <profile>:~/`):

1. `sudo install -d -o root -g adm -m 755 /var/log/nginx/jadero`, then for `default` and each host
   `sudo install -o www-data -g adm -m 640 /dev/null /var/log/nginx/jadero/<name>.error.log`.
2. `sudo install -m 644 ~/jadero-nginx /etc/logrotate.d/jadero-nginx`, then
   `sudo logrotate -d /etc/logrotate.conf 2>&1 | grep -E 'error|jadero'`: the pattern
   `/var/log/nginx/jadero/*.log` with 3 rotations, and no `duplicate log entry`.
3. `sudo install -m 644 ~/nginx.conf /etc/nginx/nginx.conf` and each site file to
   `/etc/nginx/sites-available/`; `sudo nginx -t`, then `sudo systemctl reload nginx`.
4. Check that the new files grow (`sudo ls -l /var/log/nginx/jadero/`) and the old
   `/var/log/nginx/<host>.error.log` files do not; then remove the old ones and their rotated
   copies, which Ubuntu's rule no longer rotates away once nothing writes to them.

## Notes for the WP that adds the tracker to web

- Load it as `<script defer src="/s/script.js" data-website-id="<id>">` with the page's CSP nonce.
  The pinned Umami 3.4.0 tracker builds its collect URL from `data-host-url` when set, else from
  its own `src` minus the file name, plus `/api/send`: loaded from `/s/script.js` it posts to
  `/s/api/send` on the same origin, which is the route above. So set no `data-host-url`.
- Leave Umami's `TRACKER_SCRIPT_NAME` and `COLLECT_API_ENDPOINT` unset (`compose.ops.yml` sets
  neither): the edge does the renaming. With `COLLECT_API_ENDPOINT` set, the container's start
  script rewrites `/api/send` inside `public/script.js` (`scripts/update-tracker.js`), so the
  script would post to a path the edge does not route; and on the read-only root `compose.ops.yml`
  gives Umami that write fails and the start script stops before the server runs.
- Same origin, so no CORS and no CSP change: `'self'` covers both the script and the collect call
  (ADR-051). There is no `stats.jadero.dev`.
- At the cutover (WP-29) the two `/s/` locations move to the `jadero.dev` host file with the rest
  of the site.
