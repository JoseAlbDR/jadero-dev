---
wp: 8
decision: recorded
adr: [ADR-050, ADR-027, ADR-043, ADR-047, ADR-049, ADR-029, ADR-002, ADR-010]
---

# WP-8: Server preparation

Issue #16, branch `wp/8-server-preparation`, release R0, size M, tag ops (owner present). Depends on WP-0 (done); unblocks WP-9 (the deploy pipeline to `new.jadero.dev`).

Deliverable (report section 14, decisions.json, issue #16 with its comments): the Hetzner Cloud Firewall, Tailscale, a `deploy` user with a forced command, the ops Compose project (Postgres with a database and role per service and environment, RabbitMQ with the `/prod` and `/staging` vhosts, Umami, Uptime Kuma), nginx vhosts and certificates for `new.`, `admin.`, `stats.` and `status.`, and nightly encrypted backups with a passed restore drill. Second pass (D-7 d): the `op` CLI and the read-only 1Password service-account token on the server, mode 600. Hardening from the 2026-10-09 audit: the nginx part of ADR-047, TLS 1.2 and 1.3 only with modern ciphers and OCSP stapling where supported, CAA records, the Umami and Uptime Kuma admin accounts set from secrets, RabbitMQ's `guest` removed, a written decision on TLS for internal traffic (Q1), and smoke checks for all of it. From the WP-12 comments on the issue: provisioning is convergent and runs on every deploy, and the list of superuser extensions has one source.

What the owner learns (decisions.json): Docker networking versus the host firewall, least-privilege SSH, backup versus restore.

**ADRs in the front matter.** The brief named ADR-007 and ADR-026; both are superseded. Their live text is ADR-043 (secrets through 1Password and `op inject`, restated unchanged) and ADR-049 (deploy mechanics, SSH over Tailscale with the forced command, restated from ADR-048, which restated ADR-026). ADR-029 adds the database per service and the vhosts per environment, ADR-002 the host nginx as the edge, ADR-010 the health checks Uptime Kuma reads.

**Server rules** (agreed in planning, issue #16 first comment, and `AGENTS.md` section 7 since commit 9c87775):
- Only fully safe actions on the server. Other projects share the host: their nginx sites, containers, ports and files are never read, stopped, restarted or changed.
- One Hetzner snapshot at a time, replaced after launch.
- SSH with keys only, no password login.
- An agent uses SSH only when the owner allows it for the task, through the owner's profile for this host, narrating each command and preferring read-only ones; anything that needs `sudo` is handed to the owner as a command. Agents never run deploy scripts and never operate the production or staging Compose files.

**What the server looks like today** (read-only inventory, step 0, 2026-10-16):
- Ubuntu 24.04, 4 vCPU, 7.6 GiB RAM, 61 GB free disk. Hetzner CX33 per ADR-027.
- Public listeners: host nginx on 80 and 443; `sshd` on a non-default port; one container of another project published on `0.0.0.0:<other-port>`; Node processes of another project, run by PM2, listening on all interfaces.
- `ufw` is active with the default input policy DROP. The container port above is reachable anyway (D1 explains why).
- `sshd`: `PermitRootLogin no`, `PasswordAuthentication no` in the main file; a cloud-init drop-in is not readable without `sudo`.
- Tailscale installed and running, but logged out. `certbot` installed. `restic` and `op` missing. No Postgres or RabbitMQ on the host.
- The login user is in the `sudo` and `docker` groups.

**What you already know, and what is new.** Defense in depth and least privilege come back from WP-7 D4 (four layers around a container), WP-10 D4 (one role per database) and WP-12 step 7 (the read-only `content_reader` role). Secure by default comes from WP-12 Q2 and from PR #139 last week: the services now listen on `127.0.0.1` unless `LISTEN_HOST` says otherwise, and the image sets `LISTEN_HOST=0.0.0.0` only inside its own container. Convergent provisioning comes from the WP-12 step 1b check question (the init script runs once; a server needs a script that can run every time). Liveness and readiness come from WP-3, short-lived and narrow credentials from WP-7 D7 and D11. This file spends its words on what is new: where a packet is filtered on a Linux host running Docker, how to let a machine in without letting it do anything else, how one database server is shared safely by two environments, and why a backup is only a promise until a restore proves it.

**What checking the facts found (2026-10-16).** Each fact is used below; sources in Facts checked.
1. Docker's own docs say Docker and ufw are incompatible: published ports are diverted in the `nat` table before ufw's `INPUT` chain sees them (D1).
2. In `sshd_config`, "for each keyword, the first obtained value will be used", and Ubuntu includes the drop-in folder at the top of the main file, so a drop-in can silently override the main file. Only `sshd -T` shows the effective value (D2).
3. Tailscale SSH replaces key authentication for tailnet connections, so it would not apply `authorized_keys` and its forced command. The deploy path must be OpenSSH over the tailnet, with Tailscale SSH left off (D3).
4. Let's Encrypt removed OCSP URLs from its certificates on 2025-05-07 and turned its OCSP responders off on 2025-08-06. "OCSP stapling where supported" is not supported for our certificates; the item closes as not applicable (D6).
5. nginx's `ssl_protocols` set on a `server` level may be taken from the default server of that address and port, which on this host belongs to another project (D6, **verify** in step 5).
6. Umami creates the account `admin` with password `umami` on first start; Uptime Kuma lets the first visitor of its setup page create the admin. Neither reads an initial admin password from the environment (Q2, implementation choices).
7. A 1Password service account cannot be given the built-in Personal, Private or Employee vault, its permissions are fixed at creation, and `read_items` alone is read-only (D5).
8. Ubuntu 24.04 ships restic 0.16.4; `backup --stdin-from-command`, which refuses to save a snapshot when the dump command fails, arrived in 0.17.0. The current release is 0.19.1 (D7).
9. RabbitMQ does not create `guest` when a blank node imports definitions at boot (implementation choices).
10. `pgvector/pgvector:0.8.7-pg18` is the Debian 12 (bookworm) build; `0.8.7-pg18-trixie` is Debian 13. WP-7 found Debian 12's regular security support ended on 2026-07-11 (implementation choices).
11. Tailscale node keys expire after 180 days by default; a server with an expired key drops off the tailnet until someone logs it in again (D2).
12. Uptime Kuma 2 stores its data in SQLite (or MariaDB), not Postgres, so its volume needs its own line in the backup (D7).

## Decisions explained

### D1. Why a cloud firewall in front of the server, and not ufw alone?

**Problem.** A host firewall like ufw filters packets addressed to the host itself. Docker, to publish a container port, rewrites the packet's destination to the container's private address before the host's input rules ever look at it. The packet is then forwarded to the container, not delivered to the host, so it goes through a different chain that ufw does not manage. A port published by Docker is open to the internet whatever ufw says.

**Example.** On this server today, ufw drops every unexpected inbound packet, and yet another project's container published on `0.0.0.0:<other-port>` answers from outside. Follow one packet from a laptop to that port:

```mermaid
flowchart LR
  I[packet from the internet to other-port] --> CF{Hetzner Cloud Firewall<br/>before the VM}
  CF -->|today: none attached| P[PREROUTING, nat table:<br/>Docker DNAT to the container address]
  P --> R{routing decision}
  R -->|destination is a container| F[FORWARD chain: Docker's rules accept]
  F --> C[container answers]
  R -->|destination is the host| IN[INPUT chain: ufw rules, policy DROP]
  CF -->|with the WP-8 firewall: only 80 and 443| X[dropped before the VM]
```

ufw sits on the `INPUT` branch; Docker's published ports take the `FORWARD` branch. The same holds for any port our own Compose files would publish on `0.0.0.0` by mistake.

**Decision (ADR-027 "Firewall").** Two layers that do not depend on each other:
1. The **Hetzner Cloud Firewall**, attached to the server in the Hetzner console, allows TCP 80 and 443 from anywhere and nothing else. It filters on Hetzner's side, before the packet reaches the VM, so nothing on the host (Docker, a stray process, a bad rule) can open a hole in it. It is stateful (replies to the server's own outgoing connections pass), free, and drops anything inbound that matches no rule.
2. **Every published port binds to `127.0.0.1`** (`"127.0.0.1:3001:3001"` in Compose), so even with no cloud firewall the port exists only on the loopback interface. `scripts/compose-hardening.test.mjs` already fails a Compose file that publishes without `127.0.0.1`; WP-8 extends it to the ops file.

Two different "binds" meet here, and PR #139 is the reason they no longer look contradictory. Inside a container, the service listens on `0.0.0.0` (`LISTEN_HOST=0.0.0.0` in the image): that is all interfaces of the container's own network namespace, which only the Docker network and the published port can reach. On the host, the published port binds `127.0.0.1`: that decides who outside the container can reach it. Outside a container (`pnpm dev`), the default `127.0.0.1` keeps a laptop's service off the café Wi-Fi. Secure by default at each level.

ufw stays on (it protects host processes, such as the other project's PM2 listeners, from the public interface), but it is not the control we rely on.

*Correction (2026-10-17, step 2 finding).* This line first said ufw also protects those listeners from inside the tailnet. It does not. `tailscaled` installs its own `ts-input` chain at the top of `INPUT`, before ufw's chains, and that chain accepts every packet arriving on `tailscale0`, so a ufw rule on `tailscale0` is never evaluated. Over the tailnet the owner's laptop reached host processes on all-interface ports and a Docker-published port (Docker's DNAT matches any host address, the `100.x` one included, and goes through `FORWARD`). The control for tailnet traffic is the Tailscale policy (ACL grants), which Tailscale enforces on the destination node before the packet reaches the kernel's chains, so it covers host processes and Docker ports alike (Implementation choices, step 2).

**The shared-host catch.** The Cloud Firewall is per server, so it applies to every project on the host. Attaching "80 and 443 only" also closes `<other-port>` and the PM2 ports to the internet, and the current public SSH port. Before step 2 the owner confirms which of those another project needs from outside; a needed port becomes an explicit, commented rule, and that departs from ADR-027's "nothing else" (a superseding ADR line, see Departures in the report). Everything else being reachable today is an accident the firewall fixes.

**Alternatives.**
- *ufw alone, plus Docker's `DOCKER-USER` chain or `ufw-docker` rules.* Discarded: it works only if every rule is right on the host, and Docker's docs warn against touching its rules; one mistake reopens the port. Wins when the provider has no network firewall (a bare-metal box), and then you add it with care.
- *Turn off Docker's iptables management (`"iptables": false`).* Discarded: Docker's docs say it is not appropriate for most users and breaks container networking, and other projects' containers depend on it. Wins nowhere on a shared host.
- *Only `127.0.0.1` binds, no network firewall.* Discarded: one forgotten bind, or another project's container, is public at once. Wins on a laptop.
- *A reverse-proxy-only host network (`network_mode: host`, services bind loopback).* Discarded: loses the per-environment Docker networks of D4. Wins for one tiny service with no isolation needs.

**Patterns:** defense in depth, network perimeter (filter before the host), secure by default, blast radius of a shared control, make before break (step order in D2).

### D2. Why SSH only over Tailscale, and not a public port with keys only?

**Problem.** A public SSH port, even on a non-default number and with keys only, is scanned all day and depends on the one daemon having no bug and no misconfiguration. GitHub's runners, which will deploy in WP-9, change addresses all the time, so a public port could not be limited to them.

**Example.** Today `sshd` listens on a non-default public port with `PasswordAuthentication no` in the main file. A cloud-init drop-in, unreadable without `sudo`, is included first; if it says `PasswordAuthentication yes`, that is the value in force, because sshd keeps the first value it reads. Reading `/etc/ssh/sshd_config` would tell you the wrong thing.

**Decision (ADR-049 restating ADR-048 and ADR-026, deploy mechanics option B; manual action M-9).** SSH is reachable only through Tailscale, a WireGuard mesh: the server, the owner's machines and, in WP-9, an ephemeral GitHub runner join one private network (the tailnet) and reach each other on `100.x` addresses. The Cloud Firewall drops the public SSH port. Tailscale needs no inbound port: it connects outwards and falls back to Tailscale's relays when a direct path is blocked.

```mermaid
flowchart LR
  L[owner laptop on the tailnet] -->|WireGuard, outbound only| S[server tailscale0]
  G[GitHub runner, ephemeral node, WP-9] -->|WireGuard| S
  S --> D[OpenSSH sshd: keys only, effective config checked with sshd -T]
  X[anyone on the internet] -->|SSH port| CF[Cloud Firewall: dropped]
```

Make before break, in this order: log Tailscale in and disable key expiry for the server node (keys expire after 180 days by default, and an expired server falls off the tailnet with every deploy); prove `ssh` over the tailnet name works in a second terminal; write the break-glass path (Hetzner console, and the rescue system with a temporary firewall rule) and check it once; only then attach the firewall that drops the public port. The `sshd` settings that matter (`PasswordAuthentication no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`, `AllowUsers` for the login user and `deploy`) go in a drop-in that sorts before cloud-init's, and the proof is `sshd -T`, never the file.

**Alternatives.**
- *Public port, keys only, fail2ban.* Discarded: the port stays scanned and runners need it open to the world. Wins for a box with no VPN option and only human users on fixed addresses (then limit the port to those addresses).
- *Public port limited to the owner's address in the Cloud Firewall.* Discarded: home addresses change and runners cannot be listed. Wins in an office with a fixed address.
- *Tailscale SSH (Tailscale answers port 22 on the tailnet, authenticated by the tailnet's identity).* Discarded for the deploy path: it does not use `authorized_keys`, so the forced command of D3 would not apply. Could win for the owner's own login later; not needed now.
- *A bastion host.* Discarded: one more server to patch. Wins with many servers.

**Patterns:** zero trust network access (identity-based private network instead of an open port), attack surface reduction, make before break, break-glass access, verify the effective configuration (not the file).

### D3. Why a deploy user with a forced command and one sudo rule, and not the login user or the docker group?

**Problem.** WP-9's deploy job needs to start containers on the server. Whatever key it holds sits in GitHub's secrets, so a leak of that key must not mean a leak of the server. The login user is in the `docker` group, and Docker's docs say that group "grants root-level privileges": anyone who can talk to the Docker socket can start a container that mounts `/` from the host and edit anything.

**Example.** If the deploy job logged in as the login user, a stolen deploy key could run `docker run -v /:/host alpine chroot /host` and own the host, including the other projects' data. Same result for a `deploy` user added to the `docker` group.

**Decision (ADR-049 restating ADR-048's deploy mechanics).**

```mermaid
sequenceDiagram
  participant R as GitHub runner (tailnet)
  participant S as sshd
  participant W as forced command wrapper (as deploy)
  participant D as deploy.sh (as root, via one sudo rule)
  R->>S: ssh deploy@server "deploy staging api 0.4.1"
  S->>W: key matched: run command= from authorized_keys, ignore the requested command
  W->>W: read SSH_ORIGINAL_COMMAND, validate env, service, version against an allowlist
  W->>D: sudo /srv/jadero/bin/deploy.sh staging api 0.4.1
  D-->>R: pull, migrate, up, health (WP-9)
  R->>S: ssh deploy@server "bash"
  S->>W: same forced command
  W-->>R: refused: not a deploy command, exit 1
```

- A `deploy` user with no password, no shell use, not in `docker` or `sudo`.
- Its single key in `authorized_keys` carries `restrict` (no port, agent or X11 forwarding, no terminal), `from="100.64.0.0/10"` (only tailnet addresses) and `command="..."`: whatever the client asks, sshd runs the wrapper, and the client's words arrive only as the `SSH_ORIGINAL_COMMAND` variable.
- The wrapper validates three words against allowlists (environment `staging` or `prod`, a known service, a semver version) and calls `sudo` on one root-owned script with those words. The sudoers line names that path only.
- WP-8 ships the user, the key line, the wrapper and a stub `deploy.sh` that validates and prints what it would do; WP-9 fills in the real steps.

**Alternatives.**
- *`deploy` in the `docker` group, no sudo.* Discarded: root-equivalent, as above. Wins nowhere where the key leaves your hands.
- *Rootless Docker for the deploy user.* Discarded for now: a second Docker daemon next to the one other projects use, and the ops stack would have to move into it. Wins on a host you own alone, from the start.
- *Pull-based deploys (an agent on the server watches the registry).* Discarded in ADR-026: weaker control of migrations and rollbacks. Wins with many servers and GitOps tooling.
- *A deploy API on the server.* Discarded: a new public or tailnet service to secure, for what SSH already does. Wins when deploys come from many systems.

**Patterns:** least privilege, capability-style access (the key can do one thing), input validation at a trust boundary (allowlists, not blocklists), privilege separation, confused deputy (what the wrapper must avoid by never passing raw input to a shell).

### D4. Why one Postgres and one RabbitMQ for staging and production, split by database, role, vhost and user, and provisioned convergently?

**Recap (WP-10 D4, ADR-029).** One database and one login role per service, `REVOKE CONNECT ... FROM PUBLIC`, so `agent` cannot open `content_dev`. WP-12 step 7 added a read-only `content_reader` role.

**What is new here: two environments on one instance.** Memory decides it (ADR-027's table: Postgres 1,024 MB, RabbitMQ 256 MB; a second pair for staging would cost about 1.3 GB of an 8 GB box that other projects also use). So staging and production share the servers, and isolation moves into them:
- **Postgres:** role and database names carry the environment, because roles are cluster-wide: `content_prod`, `content_reader_prod`, `agent_prod`, `contact_prod`, the same with `_staging`, plus `umami`. Only `agent_*` gets `vector`.
- **RabbitMQ:** vhosts `/prod` and `/staging` (separate exchanges, queues and permissions), users per service and vhost (`api_prod`, `agent_staging`, ...) because user names are global too; no service user may configure anything (WP-5 T4).
- **Networks:** one Docker network per environment; Postgres and RabbitMQ join both, services join only their own. A staging container cannot open a TCP connection to a production container at all, and `pg_hba.conf` accepts `content_prod` only from the production network's subnet (Q1 builds on this).

**Convergent provisioning (issue #16, WP-12 step 1b).** The dev init script runs once, on an empty volume, and `CREATE ROLE` has no `IF NOT EXISTS`. A server needs a script that can run on every deploy and always lands in the same state: create a role or database only if missing (a `DO` block on `pg_roles`, `\gexec` for databases), set the password every time (so a rotation is a re-run), re-apply `REVOKE` and `GRANT`, `CREATE EXTENSION IF NOT EXISTS` as superuser. It is one script for dev, tests and servers, so the extension list has one source: `provisionedExtensions` in `@jadero/testing` reads it, and the service's guard migration still fails loudly if provisioning forgot an extension. RabbitMQ gets the same shape: the topology from the generated definitions, users and permissions converged by a script that reads the same generator's permission list.

*Amended 2026-10-17 (step 4a, owner chose option A).* The applied migration `0002_content_reader` asserts and grants to a role named exactly `content_reader`, and an applied migration is never edited. So `content_reader` is a cluster-wide `NOLOGIN` group role that holds the grants, and the login roles `content_reader_prod` and `content_reader_staging` are members with `INHERIT`, read-only by default, each with `CONNECT` on its own environment's database only. Accepted cost: `content_reader_staging` inherits `SELECT` on `content_prod`'s tables but cannot reach them, because `CONNECT` and `pg_hba.conf` both stop it (two of the three layers instead of three). Discarded: a per-environment migration deriving the role from `current_database()` (environment logic in migrations, and the group role is still needed for 0002), and one instance per environment (the 1.3 GB above). Pattern: role-based access control with group roles.

**Example.** Staging's `agent` is compromised and reads its own `.env`. With `agent_staging`'s password it tries `content_prod`: refused by `pg_hba.conf` (wrong network), and refused again by `REVOKE CONNECT` (wrong role). With RabbitMQ, `agent_staging` has no permission at all on `/prod`. What it can still do: load the shared Postgres CPU and disk. That is the accepted cost; staging is stopped by default after cutover (D-30).

**Alternatives.**
- *One Postgres and one RabbitMQ per environment.* Discarded: about 1.3 GB more for an environment that is mostly stopped. Wins as soon as staging runs load tests or the box grows.
- *Managed Postgres.* Discarded: cost and a network hop off the box, which also brings Q1's TLS back. Wins when uptime matters more than cost, or with a team.
- *One database per environment with a schema per service.* Discarded: breaks ADR-029's database per service. Wins in a modular monolith.
- *Run-once provisioning (the dev init script on the server).* Discarded by the WP-12 finding: a new extension or role would need a manual step on a live database. Wins for throwaway containers.

**Patterns:** shared infrastructure with isolated tenants, database per service, least privilege, network segmentation, convergent (idempotent) provisioning, single source of truth, guard migration (assert, do not create).

### D5. Why secrets come from 1Password at deploy, and why the token is a file only root can read?

**Recap (ADR-043, restating D-7 d; WP-7 D4).** Secrets never enter the repo or an image. Each service's `.env` is rendered on the server at deploy from `infra/env/<service>.env.tpl`, which holds only `op://vault/item/field` references, by `op inject` (WP-9). WP-8 installs `op` and stores the token.

**What is new here.** The token is the key to every runtime secret, so where it lives matters:
- A dedicated vault for jadero.dev, never the built-in Personal vault (service accounts cannot use it), and a service account with `read_items` on that vault only. Its permissions are fixed at creation: widening them means a new account and a new token, which is a feature.
- The token in `/etc/jadero/op-token`, owner `root`, mode 600. The deploy script runs as root (D3), reads it into `OP_SERVICE_ACCOUNT_TOKEN` for the one `op inject` call, and the rendered `.env` files are root-owned, mode 600, read by Docker Compose. The `deploy` user cannot read the token.
- The honest note from the owner review (2026-10-03): root on the server can read the token, the same blast radius as `.env` files kept there by hand. The gain is rotation in one place, an audit trail and documented secrets, not more secrecy.

**Example.** A leaked GitHub deploy key (D3) gets the wrapper, not a shell, so it cannot read the token. A root compromise reads everything, token included; the response is to revoke the service account in 1Password and rotate the items it could read.

**Alternatives.**
- *`.env` files edited by hand on the server.* Discarded in D-7: rotation is a manual edit with no record. Wins for one secret on one box.
- *SOPS-encrypted files in the repo (WP-34).* Superseded by D-7 d. Wins when secrets must be versioned with the code.
- *GitHub environment secrets passed at deploy.* Discarded: GitHub would hold production keys. Wins when the CI provider is your trust anchor anyway.
- *1Password Connect server.* Discarded: one more container for one server. Wins with many consumers.

**Patterns:** secrets manager with references (templates hold pointers, not values), least privilege, rotation, blast radius, root of trust.

### D6. Why nginx owns the headers, the TLS policy and the blocked routes for our hosts, and how does CAA fit?

**Recap (ADR-047, WP-12 step 7, WP-16).** One owner per control: `platform-nest` already sets the JSON API headers and body limit in every service, `web` its nonce CSP. WP-8 adds the edge part, on our vhosts only: `server_tokens off` (no nginx version), `proxy_hide_header X-Powered-By`, HSTS after a short trial, `nosniff`, `Referrer-Policy`, a deny-all `Permissions-Policy`, the admin SPA's static CSP with `frame-ancestors 'none'`, no `Access-Control-*` header, `client_max_body_size` per location, and internal routes denied.

**What is new here.**
- **Allowlist routing.** A public host proxies only the paths that are public (for `new.jadero.dev` today: the site, and `/api/v1/content/` to `api`); everything else under `/api/` answers 404 at the edge. Deny by default means a new internal route (revalidation in WP-14, the MCP edge's internal calls in WP-36, `/health/*`) is closed until someone opens it on purpose.
- **Headers on errors too.** `add_header ... always`, or nginx drops them on 4xx and 5xx. And a classic trap: an `add_header` inside a `location` discards every header inherited from the `server` block, so the headers live in one snippet included in every location, and the smoke check catches a missing one.
- **TLS.** `ssl_protocols TLSv1.2 TLSv1.3` and the Mozilla "intermediate" ciphers (guidelines 6.0). nginx may take the protocol list from the default server of the address and port, which belongs to another project here; step 5 proves our hosts refuse TLS 1.1 with `openssl s_client` before closing the item (**verify**). Changing the shared default would touch other projects, so it is the owner's call if needed.
- **OCSP stapling: not applicable.** Let's Encrypt stopped putting OCSP URLs in certificates in May 2025 and shut its responders in August 2025; revocation is published only through CRLs. The audit said "where supported"; it is not, and `ssl_stapling on` would only log warnings.
- **CAA.** A DNS record saying which certificate authority may issue for `jadero.dev`: `0 issue "letsencrypt.org"`. It applies to every subdomain. Optionally `accounturi` pins it to our ACME account and `validationmethods` to the challenge certbot uses, so another Let's Encrypt account cannot get a certificate for our names either.

**Example.** Today nothing stops anyone calling `https://new.jadero.dev/api/health/ready` once nginx proxies `/api/` wholesale: it would answer with the names of every dependency. With allowlist routing it answers 404, and Uptime Kuma and the deploy script ask the service on `127.0.0.1` instead.

**Alternatives** (ADR-047 discussed the split; these are about the edge itself):
- *Proxy `/api/` wholesale and deny the known internal paths.* Discarded: a blocklist misses the route nobody remembered. Wins when the public API surface is large and changes daily.
- *Change the shared nginx defaults (`http` block) for every site.* Discarded: touches other projects. Wins on a host you own alone.
- *Keep OCSP stapling on "just in case".* Discarded: nothing to staple. Wins with a CA that still runs OCSP.
- *No CAA.* Discarded: one DNS record closes mis-issuance by any other CA. Wins nowhere.

**Patterns:** gateway offloading, deny by default (allowlist), single owner per control, information disclosure minimization, defense in depth, fail-safe defaults.

### D7. Why encrypted off-site backups with restic, and why is the restore drill the acceptance test?

**Problem.** A backup job can succeed every night and still be useless: the dump was empty because `pg_dump` failed half way, the encryption password lived only on the server that burned, nobody knows the restore steps, or the restore takes six hours you did not plan for. You find out on the worst day.

**Example.** A nightly `pg_dump content_prod | restic backup --stdin` where `pg_dump` loses its connection after 10 MB: the pipe closes, restic sees a normal end of input and saves a 10 MB snapshot that looks fine. With `restic backup --stdin-from-command -- pg_dump ...` (restic 0.17.0 and later), restic runs the command itself, sees the non-zero exit and saves no snapshot at all. Ubuntu's packaged restic (0.16.4) is too old for this, which is why the release binary (0.19.1) is used.

**Decision (ADR-027 "Backups"; "an untested backup is a hope").**

```mermaid
flowchart LR
  T[systemd timer, nightly, as root] --> PD[pg_dump per database, custom format,<br/>via docker exec]
  T --> RQ[rabbitmqctl export_definitions]
  T --> V[media volume WP-17, Uptime Kuma data]
  PD --> RS[restic: encrypt on the server, dedupe]
  RQ --> RS
  V --> RS
  RS -->|SFTP| SB[(Hetzner Storage Box, off the server)]
  RS --> HB[heartbeat to Uptime Kuma push monitor]
  SB -.restore drill.-> SC[throwaway Postgres container:<br/>pg_restore, row counts, time measured]
```

- What: each database (custom format, so a single table can be restored), the RabbitMQ definitions, the media volume when WP-17 adds it, and Uptime Kuma's SQLite volume. Not the queued messages: producers keep their outbox and consumers are idempotent (WP-5), and the daily `knowledge.snapshot.v1` of WP-14 reconciles the agent's index.
- Where: a Hetzner Storage Box over SFTP, encrypted by restic before it leaves. *Superseded 2026-10-17 by ADR-050: Backblaze B2 free tier in EU Central over the S3 backend, and no Hetzner server backups.* Hetzner's server backups (paid add-on) are a second layer for the whole disk.
- Retention: 7 daily and 4 weekly (`restic forget --keep-daily 7 --keep-weekly 4 --prune`), and `restic check` weekly with a small `--read-data-subset`, so corrupt packs are found before they are needed.
- The restic password and the Storage Box key live in 1Password, not only on the server: the restore must work from a laptop if the server is gone.
- Each successful run pings an Uptime Kuma push monitor; no ping by morning means an alert (a dead man's switch: silence is the failure signal).
- **The drill:** restore the latest snapshot into a throwaway Postgres container (never the live one), compare row counts with the live database, run `pg_restore --list`, and write down the time it took. That time is the real recovery time; the timer's period (24 hours) is the most data you can lose.

**Backup versus restore, in two numbers.** Recovery point objective (RPO): how much data you may lose, here up to a day of edits, fine for a site edited a few times a week. Recovery time objective (RTO): how long until it works again, measured by the drill, not guessed.

**A restore is not neutral.** Restoring one service's database to last night puts it behind the others: `api` may have published an event after 02:00 that `agent` had consumed, and now `agent`'s copy of that knowledge is gone while `api` has marked the event as sent. The outbox will not resend it. Recovery then needs a replay or a reconciliation (the daily snapshot event of WP-14 is one), which is why the runbook restores all service databases from the same night unless there is a reason not to.

**Alternatives.**
- *Hetzner server backups only.* Discarded as the only layer: same provider, whole-disk images, and a live Postgres copied at block level may need crash recovery. Wins as the quick "roll the whole box back" option, next to restic.
- *Continuous archiving (WAL shipping with pgBackRest or WAL-G).* Discarded for now: minutes of RPO for a site that does not need them, and more to operate. Wins when losing a day of writes is not acceptable (orders, payments).
- *BorgBackup.* Comparable; restic was named in ADR-027 and writes to SFTP and object storage alike. Borg wins if you already run it.
- *Hetzner Object Storage instead of a Storage Box.* Equivalent for restic. Wins when other tools already use S3.

**Patterns:** 3-2-1 backup (three copies, two media, one off-site), restore drill (backups verified by restoring), RPO and RTO, client-side encryption, dead man's switch, retention policy, fail loudly (no snapshot on a failed dump), point-in-time consistency across services.

### D8. Who watches the watcher?

**Recap (ADR-027 "Monitoring", ADR-010).** Uptime Kuma checks the site per locale, each service's `/health/ready`, TLS expiry, the SSE endpoint later, the RabbitMQ dead-letter queues, and the backup heartbeat (D7), and serves `status.jadero.dev`.

**What is new here.** Uptime Kuma runs on the same box, so it cannot report the box being down, nor its own death. ADR-027 adds one external free check (a hosted uptime ping on `new.jadero.dev`, later `jadero.dev`) as the backstop. Two alert paths that fail differently.

**Alternatives.** Everything external (a hosted monitor for all checks): it cannot read `127.0.0.1` health endpoints or the broker. Everything on the box: blind exactly when it matters. Wins: external only for a static site; internal only on a laptop.

**Patterns:** independent failure domains for monitoring, heartbeat (push) versus probe (pull) checks.

## Open questions

Two choices no ADR decides. The original second candidate, the Postgres image tag, is not architecture: WP-1 decision F already chose Postgres 18 and "production uses the same major", so the tag is an implementation choice below.

### Q1. Does internal traffic stay plain on the private Docker networks, or use TLS?

**What you need to know first.** Internal traffic here is: services to Postgres (port 5432), services to RabbitMQ (AMQP, 5672), nginx to the services (over `127.0.0.1` published ports), Uptime Kuma to the health endpoints. None of it leaves the server: Docker networks are virtual bridges inside the kernel, and the packets travel between network namespaces on one machine. Everything that does leave the server is already encrypted: visitors over HTTPS, SSH and admin access over Tailscale (WireGuard), backups by restic before upload.

Who could read plain internal traffic? Someone with root on the host (who can read the `.env` files, the 1Password token and the database files anyway), or code inside a container attached to the same Docker network (which, for Postgres traffic, already holds that service's own password). A compromised container on another network, including another project's, cannot see our bridges.

What TLS would cost: for Postgres, `ssl = on` with a certificate, and `sslmode=require` in every `DATABASE_URL`. `require` encrypts but does not check who answers; `verify-full`, which stops an impostor, needs a private certificate authority, a certificate per server name and a rotation process. The same again for RabbitMQ (AMQPS). CPU cost is negligible; the cost is certificates to issue, rotate and debug.

The shared-host angle: other projects' processes run on this host. If one of them runs as a user in the `docker` group (to check read-only with `ps -o user`), a remote code bug in that project is root on the host, and from root no internal TLS helps. That risk is handled by D1, D3 and, at cutover, by the other projects' own hardening, not by TLS.

**Options.**
- *A. Plain traffic on per-environment Docker networks, as a written accepted risk* with compensating controls: no Postgres or RabbitMQ port published to the host's network, `scram-sha-256` passwords, `pg_hba.conf` by environment subnet, one role and one RabbitMQ user per service and environment, and a list of triggers that reopen the decision. Wins on a single host where everything that crosses a boundary is already encrypted.
- *B. `sslmode=require` and AMQPS with self-signed certificates.* Encrypts against passive sniffing on the bridge, not against an active impostor. Wins as a compliance tick-box ("encryption in transit everywhere") when an auditor asks.
- *C. `verify-full` and AMQPS with a private CA.* Real protection against an impostor on the network. Wins when the database or broker is on another host, a managed service, or a network you do not control; it is the default answer the day Postgres moves off this box.
- *D. A service mesh with mutual TLS.* Wins with many services across many hosts and a platform team; here it would cost more memory than the services.

**Patterns:** threat modelling (who can see what, from where), accepted risk with revisit triggers, encrypt at trust boundaries, compensating controls, defense in depth.

Question: **which option, and what would make you revisit it?**

### Q2. Are the Umami and Uptime Kuma admin screens on the public internet, or only on the tailnet?

**What you need to know first.** Both tools have a public part and an admin part on the same port.
- Umami: the public part is the tracker script and the endpoint browsers post page views to (`/script.js` and `/api/send` by default, both renameable). Everything else is the admin app: the login page and the dashboards. It ships with the account `admin` / `umami`, to be changed at first login. Umami has a `DISABLE_LOGIN` setting.
- Uptime Kuma: the public part is the status page on `status.jadero.dev` and the few API paths and assets it loads. The admin dashboard runs over a WebSocket. Until an admin exists, its setup page lets the first visitor create one.

ADR-027 puts both on public hosts (`stats.` and `status.`) but says nothing about where the admin screens are reached. It does set the precedent for RabbitMQ: management bound to localhost, reached over Tailscale.

The audit item "first-run admin accounts set from secrets" works the same way under both options: the containers start with no public vhost, the owner creates the accounts over a tunnel with passwords stored in 1Password, and only then do the vhosts go live. Neither tool can read the admin password from the environment.

**Options.**
- *A. Public as a whole, behind strong passwords* (and two-factor where the tool supports it; **verify** for Umami 3.4). Pros: reachable from any browser; no path list to maintain. Cons: two login pages on the internet for tools the owner opens a few times a month; any auth bug in either is exposed. Wins when several people use the dashboards from devices you do not manage.
- *B. Public paths only, admin over the tailnet.* nginx proxies only Umami's tracker paths on `stats.` and only Uptime Kuma's status page paths on `status.`; the admin screens are reached through an SSH tunnel or a tailnet-only listener. Pros: no admin login on the internet, the same rule as RabbitMQ. Cons: a path allowlist that an upgrade may change (the smoke check catches a broken status page); admin only from a device on the tailnet. Wins for a single operator who already uses Tailscale.
- *C. Serve the tracker through `jadero.dev` itself (first-party path) and keep both tools tailnet-only.* Pros: no `stats.` host at all; fewer ad-blocker misses. Cons: departs from ADR-027 (superseding ADR); the site's nginx carries analytics routes. Wins if ad blockers turn out to hide most visits.

**Patterns:** attack surface reduction, admin plane versus data plane separation, deny by default (path allowlist), zero trust network access.

Question: **A, B or C, and why?**

### Recommendations

Read after answering.

- **Q1: A, written down as a short ADR** (accepted risk, single host) with these revisit triggers: Postgres or RabbitMQ moves to another host or a managed service (then C, `verify-full`), a second server joins, a compliance requirement appears, or the gateway of WP-53 starts calling services over a network. Everything that leaves the box is already encrypted; inside it, the attacker who could read the traffic can already read the secrets. B adds certificates without stopping an impostor, which is cost without the protection people assume.
- **Q2: B.** One operator, already on Tailscale, opening the dashboards a few times a month: the admin screens do not need to be on the internet, and it matches how ADR-027 treats RabbitMQ's management UI. If keeping Uptime Kuma's status page paths right turns out fragile after an upgrade, fall back to A for Uptime Kuma only, with a long password and its two-factor turned on.

## Implementation choices

What WP-8 builds, assuming the recommendations. Object to any line.

**Perimeter (step 2)**
- Hetzner snapshot before any change, the only one kept (server rules): the rollback point for steps 2 to 6.
- Cloud Firewall: inbound TCP 80 and 443 from `0.0.0.0/0` and `::/0`; no outbound rules (all allowed); exceptions only for ports another project confirms it needs (D1).
- Tailscale: `tailscale up` by the owner, key expiry disabled for the server node; Tailscale SSH stays off.
- Tailscale policy (admin console, the tailnet control, D1 correction): `tagOwners` gives `tag:server` to `autogroup:admin`; grants `autogroup:member` to `tag:server` on `tcp:<ssh-port>` only, and `autogroup:member` to `autogroup:self` on everything; a `tests` block asserts the owner reaches `tag:server:<ssh-port>` and is denied other ports, and Tailscale refuses to save a policy that breaks a test. The server node is then tagged `tag:server` (tagged nodes are owned by the tag and have key expiry disabled by default). Make before break: save the policy first (the untagged server is still covered by `autogroup:self`), then tag. WP-9 adds a grant from `tag:ci` to `tag:server:<ssh-port>`.
- `sshd` drop-in `/etc/ssh/sshd_config.d/00-jadero.conf` (sorts before cloud-init's): `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `AllowUsers <login-user> deploy`; proof with `sudo sshd -T | grep -E 'passwordauth|permitroot|allowusers|kbdinteractive'`.
- ufw stays on for the public interface; the rule `ufw allow in on tailscale0 to any port <ssh-port> proto tcp` is kept as harmless, but it is not the control: Tailscale's `ts-input` chain accepts tailnet traffic before ufw sees it (D1 correction).
- Break-glass written in `docs/runbooks/server-access.md` and checked once: Hetzner web console, and the rescue system with a temporary firewall rule.

**Deploy user (step 3)**
- `deploy` user, locked password, home `/home/deploy`, not in `docker` or `sudo`; `authorized_keys` line `restrict,from="100.64.0.0/10",command="/srv/jadero/bin/deploy-entry" <key>`. *Amended 2026-10-17 (step 3):* `from=` also lists Tailscale's IPv6 range `fd7a:115c:a1e0::/48`, since a client may reach the node over either address; the login shell is `/bin/bash` (sshd runs the forced command through it, so `nologin` would block it); `.ssh` and `authorized_keys` are owned by root, so the key holder cannot add a key.
- `/srv/jadero/bin/deploy-entry` (root-owned, 755): parses `SSH_ORIGINAL_COMMAND` into exactly three words, checks them against allowlists (`staging|prod`, the service list, a strict semver regex), never passes input to a shell, logs one line per call (who, what, no secrets), then `sudo /srv/jadero/bin/deploy.sh <env> <service> <version>`.
- sudoers drop-in `/etc/sudoers.d/jadero-deploy`, checked with `visudo -c`: `deploy ALL=(root) NOPASSWD: /srv/jadero/bin/deploy.sh`; the script re-validates its arguments.
- `deploy.sh` is a stub in WP-8 (validates, prints the plan, exits 0); the test key is a throwaway on the owner's laptop, replaced by WP-9's CI key.
- *Added 2026-10-17 (step 3 check question), for WP-9:* the wrapper checks only the form of the words, so a stolen key can still deploy an old, vulnerable version (a downgrade). WP-9's `deploy.sh` keeps the current version per environment and service and refuses a version equal to or lower than it (anti-rollback guard); going back is a separate `rollback <env> <service>` command that returns only to the last recorded good version, never to one the client names.
- *Added 2026-10-17 (step 4a check question), for WP-9:* Postgres checks a password only when a connection opens, and a service reads its `.env` only at boot, so a `provision.sql` run that rotates a password breaks every new pool connection of the running service until it is recreated (open connections keep working). `deploy.sh` runs provisioning and recreates the affected containers in the same run, and a rotation is always a deploy, never a standalone `provision.sql`; alternating two users per service (make before break with zero window) is the upgrade if a credential ever has consumers that cannot restart together.
- Sources in `infra/scripts/` (`deploy-entry`, `deploy.sh`), copied to `/srv/jadero/bin` by the owner; unit-tested with a shell test runner on the allowlists (bad env, extra word, `;`, `$(...)`).

**Ops stack and secrets (step 4)**
- `infra/compose/compose.ops.yml`, project `jadero-ops`: Postgres, RabbitMQ, Umami, Uptime Kuma; `mem_limit` from ADR-027; healthchecks; `restart: unless-stopped`; no port published except `127.0.0.1` ones the owner needs (RabbitMQ management, Umami and Uptime Kuma for nginx).
- Postgres image `pgvector/pgvector:0.8.7-pg18-trixie` pinned by digest (Debian 13, same Postgres major as dev, WP-1 F); dev moves to the same tag in the same step for parity (a fresh dev volume is enough; no data migration). *Amended 2026-10-17:* done in step 4c, with the ops compose file; versions rechecked that day, all still the latest.
- Networks: `jadero_prod` and `jadero_staging` (fixed subnets, for example `172.30.1.0/24` and `172.30.2.0/24`), `jadero_ops` for Umami and its database; Postgres and RabbitMQ on all three; Uptime Kuma on prod and staging (it reads `/health/ready`).
- Postgres `pg_hba.conf` mounted from `infra/postgres/pg_hba.conf`: `local` for the superuser inside the container, `host <db> <role> <env-subnet> scram-sha-256` per role, everything else rejected.
- One convergent `infra/postgres/provision.sql` (psql, passwords read with `\getenv`, available since psql 15), run with the environment as a variable; it replaces `infra/compose/init/01-databases.sql` for dev, and `provisionedExtensions` in `@jadero/testing` reads the new file. *Amended 2026-10-17 (step 4a):* the test harness runs `provision.sql` with `env=dev` in its global setup and reads the roles and extensions back from the catalog, instead of parsing the SQL; Umami's role and database are provisioned as their own `env=ops`, so each environment's run needs only its own passwords; the session turns statement logging off so a failed `ALTER ROLE ... PASSWORD` never reaches the server log.
- RabbitMQ: `rabbitmq:4.3.6-management-alpine` pinned by digest; per-vhost definitions (`/prod`, `/staging`) generated by `packages/messaging` without users and loaded at boot, so `guest` is never created; a convergent `infra/rabbitmq/provision-users.sh` (via `rabbitmqctl`) creates or re-passwords `api_prod`, `agent_prod`, `api_staging`, `agent_staging` with the generator's permissions, plus one `ops_admin` for the management UI over the tunnel, and deletes `guest` if it exists.
- Umami `ghcr.io/umami-software/umami:3.4.0` (since 3.0 the tags carry no `postgresql-` prefix) on its own `umami` database; Uptime Kuma `louislam/uptime-kuma:2.5.6-slim-rootless` (non-root, SQLite in a volume); both pinned by digest.
- `op` CLI 2.41.0 from 1Password's apt repository (owner, sudo); token in `/etc/jadero/op-token`, root, 600; `infra/env/ops.env.tpl` with `op://` references rendered by the owner for the ops stack (WP-9 automates the service ones).
- Admin accounts: created over the tunnel before any vhost is enabled, passwords generated and stored in 1Password; Umami's `admin`/`umami` renamed or replaced on first login.
- Memory check before `up`: `free -m` and the other projects' current use against ADR-027's ops rows (about 1.8 GB); if it does not fit, stop and ask (**verify**).
- `scripts/compose-hardening.test.mjs` extended to `compose.ops.yml` (127.0.0.1 binds, `mem_limit`, no privileged, no `docker.sock`).
- `@agent-reviewer` on the branch after step 4.

**Edge (step 5)**
- `infra/nginx/` with one file per host (`new.`, `admin.`, `stats.`, `status.`) and snippets (`security-headers.conf`, `tls.conf`, `proxy.conf`), symlinked by the owner into `sites-enabled`; nothing in the shared `nginx.conf` changes.
- Upstreams on `127.0.0.1`: production and staging on different host ports (for example `api` 3001 and 4001); `new.jadero.dev` points at staging and answers 502 until WP-9 deploys.
- Allowlist routing; `/api/health/*`, revalidation and internal paths 404 at the edge.
- HSTS `max-age=300` for the first week, then `31536000; includeSubDomains`, no `preload` (ADR-047); apex `jadero.dev` waits for the cutover (WP-29).
- `client_max_body_size 64k` on JSON API locations (below `HTTP_JSON_BODY_LIMIT`'s 100kb, so the edge refuses first), `1m` elsewhere; the media upload location arrives with WP-17.
- `admin.jadero.dev`: a placeholder page under the static CSP until WP-17.
- Certificates with the installed certbot (`--nginx` plugin or webroot), one per host; renewal already runs on the host's timer (**verify** which).
- CAA on the apex: `0 issue "letsencrypt.org"` plus `0 issuewild ";"`; `accounturi` added once the account URI is read from certbot's account file.
- `nginx -t` in CI inside `ubuntu:26.04` with the distro nginx (1.28.3, as on the server after step 2a), on `infra/nginx/` changes. *Amended 2026-10-17.*
- Smoke script `infra/scripts/smoke-edge.sh`: per host, the headers present, no version in `Server`, no `Access-Control-*`, 404 on the internal paths, TLS 1.1 refused, TLS 1.2 and 1.3 accepted, certificate days left.

**Backups (step 6)**
- restic 0.19.1 release binary, checksum and signature checked, in `/usr/local/bin` (owner, sudo; Ubuntu 26.04 packages 0.18.1); *amended 2026-10-17 per ADR-050:* a Backblaze B2 bucket in EU Central through restic's S3 backend (`s3:https://s3.<region>.backblazeb2.com/<bucket>`, the region code read from the bucket details in the console), with its application key; repository password and B2 key in 1Password.
- `infra/scripts/backup.sh` run by a systemd timer (02:30) as root: `restic backup --stdin-from-command --stdin-filename <db>.dump -- docker exec <postgres> pg_dump -Fc <db>` per database, the RabbitMQ definitions export, the Uptime Kuma volume, then `forget --keep-daily 7 --keep-weekly 4 --prune`, then the push heartbeat.
- Weekly `restic check --read-data-subset=5%`.
- `infra/scripts/restore.sh` and `docs/runbooks/restore.md`; the drill into a throwaway container, timed, logged in the step log.

## One concrete trace

Placeholders stand for values that stay out of a public repo: `<server-ip>`, `<ssh-port>`, `<other-port>`, `<tailnet-host>`. Outputs are **expected**, not yet run; each step's log records the real ones.

### Trace 1: from the outside in, before and after the perimeter

1. **Before, from a laptop not on the tailnet.** `nc -vz -w 5 <server-ip> <other-port>` prints `succeeded` (a TCP connect only, nothing read from the other project). The owner confirms why on the server: `sudo iptables -t nat -S DOCKER | grep <other-port>` shows a `DNAT` rule to a `172.x` container address, and `sudo ufw status verbose` shows `Default: deny (incoming)`. Both are true at once (D1).
2. **Tailscale first.** `sudo tailscale up` (owner), key expiry disabled in the admin console; from the laptop `ssh <login-user>@<tailnet-host>` opens a shell. `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'` prints `passwordauthentication no` and `permitrootlogin no`.
3. **Firewall attached** in the Hetzner console (owner): inbound TCP 80, 443.
4. **After.** `nc -vz -w 5 <server-ip> <other-port>` times out; `nc -vz -w 5 <server-ip> <ssh-port>` times out; `ssh <login-user>@<tailnet-host>` still works; `curl -sI https://<an existing site on the host>` still answers (80 and 443 open).
5. **Deploy key.** `ssh deploy@<tailnet-host> bash` prints `refused: expected "deploy <env> <service> <version>"` and exits 1. `ssh deploy@<tailnet-host> deploy staging api 0.4.1` prints `would deploy api 0.4.1 to staging` (the stub). `ssh -L 5432:127.0.0.1:5432 deploy@<tailnet-host>` fails: `restrict` disables port forwarding.
6. **Ops stack.** `docker compose -p jadero-ops ps` lists four healthy containers. From a container on `jadero_staging`, `psql "postgres://agent_staging:...@postgres/content_prod"` fails with `FATAL: no pg_hba.conf entry for host "172.30.2.x", user "agent_staging", database "content_prod", no encryption`; from `jadero_prod` as `agent_prod` it fails one layer later with `FATAL: permission denied for database "content_prod"` and `DETAIL: User does not have CONNECT privilege.`. `docker exec <rabbitmq> rabbitmqctl list_users` lists `ops_admin`, `api_prod`, `agent_prod`, `api_staging`, `agent_staging`, and no `guest`.
7. **Edge.** `curl -sI https://new.jadero.dev/` returns `HTTP/2 502` (no staging deploy yet) with `server: nginx` (no version), `strict-transport-security: max-age=300`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: ...`, and no `access-control-*`. `curl -s -o /dev/null -w '%{http_code}' https://new.jadero.dev/api/health/ready` prints `404`. `openssl s_client -connect new.jadero.dev:443 -servername new.jadero.dev -tls1_1 </dev/null` ends in a handshake failure; with `-tls1_3` it prints `Protocol  : TLSv1.3`.
8. **DNS.** `dig +short CAA jadero.dev` prints `0 issue "letsencrypt.org"` and `0 issuewild ";"`.

### Trace 2: a nightly backup and the restore drill

1. 02:30, `jadero-backup.timer` starts `backup.sh` as root. It reads the restic password and the Storage Box key from root-only files rendered from 1Password.
2. `restic backup --stdin-from-command --stdin-filename content_prod.dump -- docker exec jadero-ops-postgres-1 pg_dump -U postgres -Fc content_prod` prints `snapshot 4f2a9c1e saved`; the same for `agent_prod`, `contact_prod`, `umami` and the staging databases, then `rabbitmqctl export_definitions` and the Uptime Kuma volume.
3. `restic forget --keep-daily 7 --keep-weekly 4 --prune` removes older snapshots; `curl -fsS <kuma-push-url>` marks the push monitor up.
4. **Drill (owner, step 6).** `restic snapshots --path /content_prod.dump --latest 1` shows last night's snapshot. `docker run -d --name restore-check --network none pgvector/pgvector:0.8.7-pg18-trixie@sha256:9d9c9302...` starts an empty Postgres; `restic dump latest /content_prod.dump | docker exec -i restore-check pg_restore -U postgres --create -d postgres` restores it (the `vector` extension and roles come from `provision.sql` run first).
5. `SELECT count(*) FROM content.posts;` (and the other content tables) on `restore-check` matches the live database; the time from step 4's first command to here is written in the step log as the measured RTO. `docker rm -f restore-check`.
6. From the owner's laptop, `restic -r sftp:<storage-box> snapshots` with the password from 1Password lists the same snapshots: the restore does not depend on the server.

### Trace 3: four failures

**3a. A dump fails half way.** Postgres restarts during `pg_dump agent_prod`. `pg_dump` exits 1; restic prints that the command failed and saves no snapshot; `backup.sh` exits non-zero and does not send the heartbeat. By morning Uptime Kuma's push monitor is down and alerts. With a plain `| restic backup --stdin`, a truncated snapshot would have been saved and the heartbeat sent.

**3b. Tailscale key expiry forgotten.** 180 days after login the server's node key expires. SSH over the tailnet and every WP-9 deploy stop; the public port is closed. Recovery: Hetzner web console, `sudo tailscale up`, then disable expiry. Avoided by disabling expiry in step 2.

**3c. A Compose file publishes `5432:5432` by mistake.** `compose-hardening.test.mjs` fails the pull request. If it slipped through, Docker would open 5432 on every interface, past ufw, and the Cloud Firewall would still drop it from outside: the second layer holds while the first is fixed.

**3d. The deploy key leaks.** The attacker is on the internet, not on the tailnet: the key is useless there (port closed, `from=` limits it to `100.64.0.0/10`). If they also get onto the tailnet, the key runs only the wrapper, which accepts only a known service and version already in the registry. Response: remove the key line, rotate in GitHub (WP-9).

## Patterns

| Pattern | Where it appears |
|---|---|
| Defense in depth | D1 (cloud firewall and loopback binds), D3 (`restrict`, `from=`, wrapper, sudo rule), D4 (`pg_hba` and `REVOKE CONNECT`), D6; from WP-7 D4 and WP-12 |
| Network perimeter, filter before the host | D1 |
| Secure by default, fail-safe defaults | D1 (`LISTEN_HOST`, from PR #139), D6 (`always` headers), RabbitMQ without `guest` |
| Blast radius of a shared control | D1 (the firewall covers other projects), D5 |
| Make before break, break-glass access | D2, Trace 1 steps 2 to 4 |
| Zero trust network access | D2, Q2 B |
| Policy as code with tests | the Tailscale policy (Implementation choices, step 2): saved only when its `tests` pass |
| Verify the effective configuration | D2 (`sshd -T`), D6 (`openssl s_client`) |
| Least privilege, capability-style access | D3, D4, D5; from WP-7 D4, WP-10 D4, WP-12 step 7 |
| Input validation at a trust boundary, confused deputy | D3 (the wrapper) |
| Shared infrastructure with isolated tenants, network segmentation | D4, Q1 A |
| Convergent (idempotent) provisioning, single source of truth | D4; from the WP-12 step 1b check question |
| Guard migration | D4; from WP-10 and WP-12 step 1b |
| Secrets manager with references, rotation, root of trust | D5; from ADR-043 and WP-7 |
| Deny by default (allowlist) | D6 (routing), Q2 B (paths), D3 (wrapper) |
| Gateway offloading, single owner per control | D6; from ADR-047 and WP-12 step 7 |
| Information disclosure minimization | D6 (`server_tokens off`, health 404) |
| 3-2-1 backup, restore drill, RPO and RTO | D7, Trace 2 |
| Fail loudly | D7 (`--stdin-from-command`), Trace 3a |
| Dead man's switch, heartbeat versus probe | D7, D8, Trace 3a |
| Point-in-time consistency across services | D7 (restore all databases from the same night) |
| Independent failure domains for monitoring | D8 |
| Threat modelling, accepted risk with revisit triggers, encrypt at trust boundaries | Q1 |
| Admin plane versus data plane | Q2 |
| Fitness function | the Compose hardening test extended to the ops file (from WP-7) |

## Proposed steps

The explainer is the gate, not a step. **Owner** marks what only the owner can do (Hetzner console, Tailscale login, DNS, 1Password, `sudo` on the server); the agent prepares the files and the exact commands, and may run narrated read-only checks over SSH when allowed. Each step ends with a green `pnpm verify` for the repo files it adds, one scoped commit and two lines in the step log.

0. *Done:* the SSH rule (9c87775), the read-only inventory, issue #16 updated.
1. *Explainer* (this file); after your answers, the short ADR for Q1 and any superseding line (a firewall exception, Q2 C).
2a. *Host upgrade* (owner, amendment of 2026-10-16): snapshot, Ubuntu 26.04.1, re-enable third-party repos, PM2 startup, remove `openclaw`, other projects checked.
2. *Perimeter* (learning). **Owner:** Hetzner snapshot; `tailscale up` and key expiry off; `sshd` drop-in and `sshd -T`; ufw rule on `tailscale0`; confirm other projects' public ports; attach the Cloud Firewall. Agent: runbook `docs/runbooks/server-access.md`, Trace 1 steps 1 to 4 checks.
3. *Deploy user and forced command* (learning). Agent: `infra/scripts/deploy-entry`, stub `deploy.sh`, tests. **Owner:** create the user, key line, sudoers drop-in (`visudo -c`), copy the scripts. Trace 1 step 5.
4. *Ops stack, provisioning, op CLI* (learning). Agent: `compose.ops.yml`, `provision.sql`, `pg_hba.conf`, `provision-users.sh`, the generator change for per-vhost definitions without users, `ops.env.tpl`, the dev switch to the new provisioning, the hardening test extension. **Owner:** 1Password vault and service account (M-38), `op` install and token file, memory check, `docker compose up`, admin accounts over the tunnel. Trace 1 step 6.
   - Mid-WP `reviewer` on the branch.
5. *Edge* (learning). Agent: `infra/nginx/`, the CI `nginx -t` job, `smoke-edge.sh`. **Owner:** DNS records for `new.`, `admin.`, `stats.`, `status.` (M-11) and CAA, certbot, symlinks, `nginx -t`, reload. Trace 1 steps 7 and 8.
6. *Backups and the restore drill* (learning). Agent: `backup.sh`, `restore.sh`, the systemd units, `docs/runbooks/restore.md`. **Owner:** Backblaze B2 bucket and application key in EU Central (ADR-050), restic install and `init`, password in 1Password, enable the timer, run the drill with the agent narrating. Trace 2.
7. *Map and wrap*: `/map` (the code map's deploy view gains the server, networks and the edge), `/wrap-wp 8`. The issue's "Deployed to staging" box is WP-9's.

## Decision

Recorded 2026-10-17 with the owner.

- D1 to D8: accepted as explained. D1: before the Cloud Firewall changes, the agent lists what the other projects on the host need from outside and the owner confirms; the owner says nothing else deploys to the server over SSH (they pull and rebuild on the host).
- D2: SSH only over Tailscale, option A. The owner first worried about depending on Tailscale; the answer is break-glass: the Cloud Firewall lives in the Hetzner panel, so the public SSH rule can be added back in a minute, and the Hetzner web console (tested by the owner on 2026-10-16, it logs in) works with no network path at all. Tailscale SSH stays off.
- D5: a new dedicated vault in the owner's personal 1Password account (never the employer's account). The owner first proposed the Personal vault; service accounts cannot read Personal or Private vaults, and a dedicated vault limits a leaked token to this project.
- Q1: A, plain traffic on the private Docker networks as a written accepted risk, revisited later (triggers in the Recommendations). Written as a short ADR in step 1.
- Q2: B, only the public paths of Umami and Uptime Kuma are proxied; admin screens over Tailscale. If Kuma's path list proves fragile, fall back to A for Kuma only.
- Amendment (owner, 2026-10-16): no Hetzner server backups (ADR-027 lists them as a second layer), and no spending beyond the server for now. The restic destination is open until step 6: a free object storage tier (recommended) or a pull from the owner's laptop over Tailscale. Either way it goes in the same short ADR as Q1.
- Amendment (owner, 2026-10-16): upgrade the host to Ubuntu 26.04.1 LTS before building anything on it, as a new step 2a: a fresh Hetzner snapshot first, `apt full-upgrade` and reboot, `do-release-upgrade` and reboot, re-enable the Docker and Tailscale apt repos on `resolute`, `pm2 unstartup`, `pm2 startup` and `pm2 save` for the other project, then check every other project answers. Consequences for this file: nginx becomes 1.28 (the CI `nginx -t` job runs on `ubuntu:26.04`), `sudo` is sudo-rs, cgroup v1 is gone. The restic version shipped by 26.04 is checked at step 6; the pinned upstream release stays the plan.
- Amendment (owner, 2026-10-16): delete the unused `openclaw` user in step 2a, after the snapshot and after listing what its home, crontab and processes hold.

## Step log

- Step 0 (server access rule, inventory, issue): `AGENTS.md` section 7, `.claude/rules/infra.md`, `docs/agent-tooling.md` and the delivery flow now allow narrated, read-only-first SSH to the server when the owner allows it, with `sudo` handed to the owner and other projects off limits (9c87775, artifact republished in 72e36c9); a read-only inventory found the listeners, the `sshd` state, Tailscale logged out, no `restic` or `op`, and the login user in `docker`. / Why: WP-8 is server work, and the old "agents never ssh" rule would have made the agent guess the server's state; the inventory turned D1 from theory into a port that answers today despite ufw.
- Step 2a (host upgrade, owner on the server, agent checking read-only): snapshot, then 24.04.5 with kernel 6.8.0-147 and reboot, then `do-release-upgrade` to 26.04.1 (kernel 7.0, nginx 1.28.3, sudo-rs, the other project's PM2 apps moved from Node 18 to the distro's Node 22.22.1 and came back online, PM2 startup needed no change); the dead NodeSource repo removed, the Docker repo moved off the wrong release, the Docker and Tailscale repos rewritten as `.sources` on `resolute`; the retired NGINX Amplify agent purged; `openclaw` deleted (no crontab, no processes, one authorized key); and a drop-in from 2026-10-02 that gave the login user passwordless `apt`, `systemctl`, `tee` and more removed, verified with `sudo -n -l`. / Why: build WP-8 on the release it will live on, and close what the upgrade surfaced: passwordless `apt` or `systemctl` is root, so any code running as the login user (the PM2 apps) was one bug away from root; sudo-rs rejecting the wildcard lines is how it came to light.
- Step 2 (perimeter, make before break, owner on the server and the Hetzner console, agent checking from outside): Tailscale logged in on the server (DNS left off, Tailscale SSH off, node key expiry disabled), ufw allows the SSH port on `tailscale0` only, the `00-jadero.conf` drop-in proven with `sshd -T` (`passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin no`, `allowusers` for the login user and `deploy`), the console login checked as break-glass, the public SSH rules removed from ufw with the old session held open, and the Cloud Firewall reduced to inbound TCP 80 and 443 (the public SSH port and ICMP removed); the journal showed only the login user logging in by SSH in 60 days. From outside, every port bound on all interfaces except 80 and 443 times out, SSH works only over the tailnet and the sites answer 200; runbook `docs/runbooks/server-access.md` (4d73a91, committed as `docs(infra)` because `runbooks` is not an allowed scope). Why: the new path was opened and proven before the old one closed, so access never depended on a step that had not been tested.
- Step 2 check question and follow-up (2b): asked whether a Compose file publishing Postgres on `0.0.0.0` by mistake is reachable from the internet and from the tailnet. The internet half was right (the Cloud Firewall drops it before the VM); the tailnet half was wrong (answered that the laptop reaches only SSH). Shown live: from the laptop over the tailnet a Docker-published port and two host-process ports answered, because Docker's DNAT applies to the `100.x` address too and goes through FORWARD, and tailscaled's `ts-input` chain sits first in INPUT and accepts everything on `tailscale0` before ufw, so the ufw rule there was never evaluated. Fix in 2b: a Tailscale policy (grants: members to `tag:server` on the SSH port only, members to their own devices; a `tests` block that denies the other ports) saved first, then the server tagged `tag:server` (key expiry still off); after it the SSH port answers over the tailnet and the other ports time out; D1, the implementation choices and the runbook corrected (168c407). Why: the control for a path has to sit on that path; tailnet traffic never passes the Cloud Firewall or ufw, so its filter is the Tailscale policy, with the `127.0.0.1` binds as the layer under it.
- Step 3 (deploy user and forced command; agent built the scripts, owner installed them, demo from the laptop over the tailnet): `infra/scripts/deploy-entry` caps the input at 128 characters, allows only letters, digits, space, dot and hyphen, splits with `read -ra`, requires exactly `deploy <env> <service> <version>` (`staging|prod`, `api|agent|web`, strict semver), logs a fixed reason or the accepted values under `jadero-deploy` and execs `sudo -n` on the stub `deploy.sh`, which checks the same values again; 45 tests through `node --test` (no env overrides in production: the test copies the script and rewrites its `readonly` paths), shellcheck clean, `infra/scripts/**` added to the script tests' Turbo inputs (1901637). On the server: scripts root-owned 755 in `/srv/jadero/bin`, `deploy` with a locked password and `/bin/bash`, a root-owned key line with `restrict`, `from=` for the tailnet's IPv4 and IPv6 ranges and the forced command, one sudoers line checked by `visudo -c` and `sudo -l -U deploy`. Demo: `deploy staging api 0.4.1` prints `would deploy api 0.4.1 to staging` (exit 0), `bash` and `deploy staging api 0.4.1; id` are refused (exit 1), `-L` gets `administratively prohibited`, the journal shows one `accepted` and two `refused reason=` lines. / Why: the CI key will live in GitHub's secrets, so it must be able to do one thing only; the restrictions ride on the key and are enforced by sshd, the client's words never reach a shell, and the root script re-validates because a sudoers rule with no arguments allows any.
- Step 3 check question: a stolen CI key plus tailnet access sends `deploy prod api 0.1.0`, an old release with a known flaw. Parts 2 and 3 right (the key can only deploy; deploying an older version makes no sense except a rollback, which should take another path); part 1 wrong (answered that the flaw stops it). Real behavior: the request passes, because the allowlists check the form of the words, not whether the version makes sense, and nothing in the chain checks advisories at deploy time; production goes back to the flawed release, maybe also broken by an older code on a newer schema. Pattern: capability blast radius, anti-rollback (downgrade) protection. Follow-up: the guard and a separate `rollback` command recorded as a WP-9 requirement in the implementation choices and on the WP-9 issue. / Why: a forced command narrows what a key can do, not whether each allowed call is wise; checks that need state (the current version) belong on the root side the client does not control.
- Step 4a (convergent Postgres provisioning; the owner split step 4 into 4a Postgres, 4b RabbitMQ, 4c the ops stack): `infra/postgres/provision.sql` runs as superuser with `-v env=dev|staging|prod|ops`, creates each `<service>_<env>` role and database only if missing, sets every password on every run from `\getenv` (rotation is a re-run), re-applies `REVOKE CONNECT ... FROM PUBLIC`, creates `vector` only in `agent_<env>`, and turns statement logging off for its session; `content_reader` is now a `NOLOGIN` group role (owner's option A, because the applied migration 0002 grants to that exact name) with `content_reader_<env>` as its read-only login member; `infra/postgres/pg_hba.conf` accepts each role only from its environment's subnet with `scram-sha-256` and rejects the rest; dev runs the same script through `init/01-provision.sh` (roles renamed to `content_dev`, `agent_dev`, ...), and `@jadero/testing` runs it in global setup and reads the catalog back instead of parsing SQL (6cad024). Demo: a second run exits 0 with the catalog unchanged, `agent_dev` is refused on `content_dev`, the reader session reports `read_only on`, `pg_hba.conf` loads with 0 errors; verify green, `test:int` green (testing 10, api 127, agent 7, messaging 22). / Why: a run-once init cannot add a role or an extension to a live database; one convergent script for dev, tests and servers keeps one source of truth, and the guard migrations still fail loudly when provisioning forgot something.
- Step 4a check question: after a password rotation by `provision.sql` with the api not restarted for 15 minutes, which requests fail. The fact was right (Postgres checks the password only when a connection opens), the effect inverted (answered that the open connections fail). Real behavior: open connections keep working; every new pool connection (a burst, or replacing one closed after 10 idle minutes) fails with `password authentication failed`, because the api holds the old password from boot, so failures grow until nearly all requests fail. Pattern: credential rotation, make before break, alternating users. Follow-up: the ordering recorded as a WP-9 requirement in the implementation choices and on the WP-9 issue. / Why: rotation is safe only when the new secret reaches the consumers in the same step that changes it at the source.
- Step 4b (convergent RabbitMQ provisioning): the topology generator in `packages/messaging` now also writes `infra/rabbitmq/server/definitions/{prod,staging}.json` with no users and no permissions, loaded at boot from that folder by `infra/rabbitmq/server/rabbitmq.conf`, and `infra/rabbitmq/server/permissions.tsv` from the same `buildPermissions` that dev's file uses; `infra/rabbitmq/provision-users.sh` converges `api_<env>`, `agent_<env>` and `ops_admin` (add or re-password with the password on stdin, tags, `set_permissions` per vhost, rights cleared on vhosts the file no longer lists), deletes `guest` and only warns about users not in the file (owner's choice); dev keeps its users in its own file (owner's choice) (b18f272). Demo: a second run converges with exit 0, a missing password names only the env variable and changes nothing, `agent_prod` gets 403 on declare and is refused on `/staging`, users survive a restart, no password in any output; verify green, messaging `test:int` 27 green. / Why: the topology is code and lives in a file, the identities are secrets and are converged by a script that never writes them to disk or argv, so a rotation is a re-run, like `provision.sql`.
- Step 4b findings: the boot import is additive and runs on every boot, so users created by the script survive restarts; with definitions to load, RabbitMQ seeds neither `/` nor `guest`; RabbitMQ imports every file in a `load_definitions` directory whatever its extension, so only the vhost files live in `server/definitions/` (step 4c mounts only that folder); `rabbitmqctl --quiet add_user` hangs with the password on stdin, so the script leaves out `--quiet` there.

## Recap

## Named here

| Name | What it is, in one line | When |
|---|---|---|
| WP-1 decision F | Postgres 18 with pgvector in dev; production uses the same major | R0, done |
| WP-3 | Health endpoints (liveness, readiness) Uptime Kuma reads | R0, done |
| WP-5 | Messaging: outbox, inbox, topology generator (T4), users without `configure` | R0, done |
| WP-7 | Images, hardened Compose, the Compose hardening test | R0, done |
| WP-9 | Deploy pipeline: `deploy.yml`, the real `deploy.sh`, `op inject` of service `.env` files | R0, next |
| WP-10 | Database per service, guard migration | R1, done |
| WP-12 | Read-only reader role, the provisioning findings on issue #16 | R1, done |
| WP-14 | Content events and the daily `knowledge.snapshot.v1` | R1 |
| WP-17 | Admin SPA, media upload (larger body limit, media volume in backups) | R1 |
| WP-29 | Cutover of `jadero.dev` | R1 |
| WP-36 | MCP edge, internal endpoints | R4 |
| WP-53 | Gateway for `/api/*` | R7 |
| ADR-027 | Hosting layout: firewall, Compose projects, Postgres, RabbitMQ, backups, monitoring | accepted |
| ADR-043 | Config loaded before Nest; secrets from 1Password with `op inject` (restates ADR-007) | accepted |
| ADR-047 | HTTP hardening split between nginx, `web` and `platform-nest` | accepted |
| ADR-049 | Images and release; restates the deploy mechanics of ADR-048 and ADR-026 | accepted |
| ADR-029 | Service boundaries, database per service, vhosts per environment | accepted |
| ADR-002 | Host nginx as the edge, same origin per audience | accepted |
| ADR-010 | Observability, health checks, Uptime Kuma | accepted |
| Hetzner Cloud Firewall | Stateful network firewall in front of a Hetzner VM, free | step 2 |
| Tailscale | WireGuard mesh VPN with identity, NAT traversal and relays | step 2 |
| OpenSSH forced command | `command=` in `authorized_keys`, client's request in `SSH_ORIGINAL_COMMAND` | step 3 |
| 1Password service account, `op inject` | Token-based read access to one vault; renders `op://` references into files | step 4 |
| Umami | Cookieless self-hosted analytics, Postgres only since v3 | step 4 |
| Uptime Kuma | Self-hosted uptime monitor and status page | step 4 |
| certbot | Let's Encrypt client, already on the host | step 5 |
| CAA | DNS record naming the CAs allowed to issue for a domain (RFC 8659, 8657) | step 5 |
| restic | Encrypted, deduplicating backup client | step 6 |
| Hetzner Storage Box | Off-server storage reachable over SFTP | step 6 |

## Facts checked

| Tool | Version on 2026-10-16 | Source | Note |
|---|---|---|---|
| `pgvector/pgvector` | `0.8.7-pg18-trixie`, digest `sha256:9d9c930220cb9bf2f956d10a8f909cf9973d9672ca0278aef2c1e6facccad2e0`, pushed 2026-10-01 | Docker Hub tags API | `0.8.7-pg18` is the bookworm build (`sha256:2358fcba...`, the dev pin) |
| `rabbitmq` | `4.3.6-management-alpine`, digest `sha256:3505b6096cdbc083bcc363e74366f575ecd0c1a55be4dadcbc60fa08e34647e1`, rebuilt 2026-10-16 | Docker Hub tags API | Same version as dev; the dev pin is an earlier build of the tag |
| Umami | v3.4.0, 2026-09-17; GHCR tags `3.4.0`, `postgresql-latest` | GitHub releases, GHCR tag list | Default account `admin` / `umami`; no env var for the first admin; `DISABLE_LOGIN`, `TRACKER_SCRIPT_NAME`, `COLLECT_API_ENDPOINT` exist (docs.umami.is) |
| Uptime Kuma | 2.5.6, 2026-10-09; `2.5.6-slim-rootless` digest `sha256:6eb4e96a7cbdb8a5d6779aa26dce2cb97dcea65b486856b9b2280f73a1d0adf4` | GitHub releases, Docker Hub | `server/server.js` at 2.5.6: the `setup` socket event creates the first user while none exists; no env var for it |
| restic | 0.19.1, 2026-07-05; Ubuntu 24.04 ships 0.16.4 | GitHub releases, packages.ubuntu.com | `--stdin-from-command` added in 0.17.0 (CHANGELOG); a non-zero exit saves no snapshot (`doc/040_backup.rst`); `forget --keep-daily/--keep-weekly --prune`, `check --read-data-subset` |
| Tailscale | 1.104.1, 2026-10-07 | GitHub releases | No inbound port needed, relays as fallback (kb 1082); node keys expire after 180 days, expiry can be disabled per device (kb 1028); Tailscale SSH authenticates with node keys, not `authorized_keys` (kb 1193) |
| 1Password CLI | 2.41.0 | app-updates.agilebits.com | Service accounts: not the built-in Personal, Private, Employee or default Shared vault; `read_items` per vault; permissions immutable; `op inject` supported with `OP_SERVICE_ACCOUNT_TOKEN` (1password.dev) |
| nginx (Ubuntu 24.04) | 1.24.0-2ubuntu7.18 | packages.ubuntu.com | `ssl_protocols` default `TLSv1.2 TLSv1.3` since 1.23.4; at `server` level the default server's value may apply (nginx docs, "Virtual server selection") |
| Recheck 2026-10-17 (step 4) | pgvector 0.8.7, RabbitMQ 4.3.6, Umami 3.4.0, Uptime Kuma 2.5.6, `op` 2.41.0 and restic 0.19.1 still the latest; nginx 1.28.3-2ubuntu1.11 on 26.04 and the `ubuntu:26.04` image exists; restic in 26.04 is 0.18.1; B2: first 10 GB free, no card; `rabbitmqctl add_user` and `change_password` read the password from stdin when it is omitted | Docker Hub and GHCR tag APIs, GitHub releases, Launchpad, backblaze.com, rabbitmq-server v4.3.6 CLI sources | B2's EU Central region code **verify** in the console (step 6) |
| OpenSSH server (Ubuntu 24.04) | 1:9.6p1-3ubuntu13.x | packages.ubuntu.com | `sshd_config(5)`: first obtained value wins; `sshd(8)`: `command=`, `restrict`, `from=`, `SSH_ORIGINAL_COMMAND`; `sshd -T` prints the effective config (openssh-portable master man pages); the Debian and Ubuntu `sshd_config` includes `/etc/ssh/sshd_config.d/*.conf` at line 13, before every other setting (salsa.debian.org) |
| Docker Engine docs | `main` branch | docker/docs `packet-filtering-firewalls.md`, `port-publishing.md`, `linux-postinstall.md`, `security/_index.md` | Docker and ufw incompatible (nat table before INPUT); publishing is insecure by default, `127.0.0.1` limits it; before 28.0.0 L2 neighbours could reach loopback-published ports; `docker` group grants root-level privileges |
| Hetzner Cloud Firewall | n/a | docs.hetzner.com firewalls overview and FAQ | Free; stateful; unmatched inbound dropped; outbound all allowed with no outbound rules; private networks not filtered |
| Hetzner Storage Box | BX11, 1 TB | hetzner.com, docs.hetzner.com | SFTP, rsync, BorgBackup, restic listed; port 23 for SFTP with OpenSSH keys; price **verify** |
| Let's Encrypt | n/a | letsencrypt.org posts 2024-12-05 and 2025-08-06; docs/caa | OCSP URLs dropped 2025-05-07, responders off 2025-08-06, CRLs only; CAA identifier `letsencrypt.org`, `accounturi` and `validationmethods` supported, apex record covers subdomains |
| Mozilla SSL guidelines | 6.0 | ssl-config.mozilla.org/guidelines/latest.json | Intermediate: TLS 1.2 and 1.3, ECDHE with AES-GCM and ChaCha20 for 1.2 |
| RabbitMQ access control | 4.x docs | rabbitmq.com/docs/access-control | `guest` is loopback-only by default; not created when a blank node imports definitions at boot |
| `postgres` image entrypoint | `master`, 18/trixie | docker-library/postgres | Appends `host all all all <password_encryption>` (scram-sha-256 on 14+) unless overridden |
| psql `\getenv` | Postgres 15+ | postgres/postgres `psql-ref.sgml` on REL_15 and REL_18 (absent on REL_14) | Reads an environment variable into a psql variable |

**Verify** (no primary source confirmed, or only the server can tell):
- That nginx 1.24 with Ubuntu's OpenSSL applies our `server`-level `ssl_protocols` on the shared 443 socket, and what Ubuntu's `nginx.conf` sets globally (step 5, `openssl s_client`).
- Which non-80/443 public ports other projects need (owner, before step 2).
- The content of the cloud-init `sshd` drop-in (`sudo sshd -T`, step 2).
- The break-glass path: whether the web console login needs a local password, and the rescue system's firewall needs (step 2).
- The memory the other projects use today against ADR-027's budget (step 4).
- Which user runs the other project's PM2 processes (read-only `ps`, Q1 context).
- Uptime Kuma's status page path list for Q2 B, and whether Umami 3.4 offers two-factor login for Q2 A.
- A file-level restic copy of Uptime Kuma's live SQLite database restores cleanly (the drill checks it; else stop the container for the copy).
- Storage Box and Hetzner backup add-on prices; certbot's renewal timer on the host; the server's Docker version.

## Delegated details

- `sshd_config` drop-in naming: files in `/etc/ssh/sshd_config.d/*.conf` are read in lexical order at the `Include` line near the top of the main file; `00-` sorts before `50-cloud-init.conf`.
- `authorized_keys` options are comma-separated before the key type, no spaces outside quotes; `restrict` turns every forwarding and the terminal off, and `from=` and `command=` add limits on top.
- sudoers: a command path with no arguments listed allows any arguments; `visudo -cf <file>` checks syntax before install; a broken sudoers file can lock out `sudo`.
- Convergent role creation: `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'content_prod') THEN CREATE ROLE content_prod LOGIN; END IF; END $$;` then `ALTER ROLE content_prod PASSWORD :'content_prod_password';`; databases with `SELECT 'CREATE DATABASE content_prod OWNER content_prod' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'content_prod')\gexec`.
- `pg_hba.conf` lines are matched top to bottom, first match wins; `reject` at the end closes everything else; reload with `SELECT pg_reload_conf();`.
- `rabbitmqctl add_user` errors when the user exists; the convergent script checks `list_users` first, then `change_password`; `set_permissions -p /prod api_prod '^$' '<write>' '<read>'`.
- nginx: `add_header` in a `location` replaces all inherited `add_header`s; `always` adds them to error responses; `server_tokens off` also hides the version on nginx's own error pages; `proxy_hide_header` per upstream header.
- certbot `--nginx` edits the vhost file it finds; with vhosts kept in the repo, `certonly --webroot` plus `ssl_certificate` lines in our files keeps the repo the source of truth.
- restic over SFTP to a Storage Box: `sftp:<user>@<user>.your-storagebox.de:/jadero` with an `~/.ssh/config` entry for port 23; `RESTIC_PASSWORD_FILE` and `RESTIC_REPOSITORY` in a root-only env file.
- systemd: a `.service` of `Type=oneshot` plus a `.timer` with `OnCalendar=*-*-* 02:30` and `Persistent=true` (runs after a missed night).
- Uptime Kuma push monitor: a URL with a token that the job calls; no call within the interval marks it down.
- Tailscale ACLs: `tagOwners` for `tag:ci` and `tag:server`, a rule allowing the owner and `tag:ci` to `tag:server:<ssh-port>`.
