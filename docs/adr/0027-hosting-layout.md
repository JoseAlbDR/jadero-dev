---
id: ADR-027
title: "Hosting layout"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-30, D-31, D-48]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-027: Hosting layout (amended 2026-10-02)")
---

# ADR-027: Hosting layout

**Status:** Accepted (owner review 2026-10-03, D-30, D-31 and D-48). Amended for the service split (ADR-029): more containers, RabbitMQ, one database per service, the admin vhost and an edge cache.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-30, D-31, D-48). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Server

Hetzner CX33, 4 shared vCPU, 8 GB RAM, 80 GB NVMe, 20 TB traffic, EUR 6.49 per month since the April 2026 price change.

## Layout

- Host nginx + certbot stay (they exist and work). One vhost per name: `jadero.dev` (and `www` redirect), `admin.jadero.dev` (static SPA + admin API routes), `new.jadero.dev` (staging during the build), `stats.jadero.dev` (Umami), `status.jadero.dev` (Uptime Kuma), later `mcp.jadero.dev` and `lab.jadero.dev`. `proxy_buffering off` on the SSE route. `proxy_cache` with `proxy_cache_use_stale error timeout updating http_502 http_503` for public pages, so a `web` outage serves the last good HTML.
- Docker Compose projects: `jadero-prod`, `jadero-staging` (services) and `jadero-ops` (Postgres, RabbitMQ, Umami, Uptime Kuma). Every published port binds to `127.0.0.1` only; only nginx listens publicly. Services reach Postgres and RabbitMQ on a private Docker network.
- Postgres (`pgvector/pgvector`, Postgres 17 or 18 **(pick the image tag at WP time)**): one database and one role per service and environment (`content_prod`, `agent_prod`, `contact_prod`, the same for staging) plus `umami`; each role can connect only to its own database. Only `agent_*` enables the `vector` extension.
- RabbitMQ 4 (with the management plugin bound to localhost, reached over Tailscale): virtual hosts `/prod` and `/staging`, one user per service per vhost limited to its own queues, topology loaded from `infra/rabbitmq/definitions.json`.

## Memory budget (set as compose `mem_limit`; Node processes get `--max-old-space-size` at about 75% of their limit)

| Process | Limit | Notes |
|---|---|---|
| OS, nginx, Docker | 600 MB | host |
| Postgres | 1,024 MB | all databases, shared buffers about 256 MB |
| RabbitMQ | 256 MB | idle about 150 MB; memory alarm watermark set below the limit |
| `web` | 320 MB | Next standalone |
| `admin` | 0 | static files on nginx |
| `api` | 300 MB | HTTP |
| `api-worker` | 300 MB | relay, react-pdf, revalidation |
| `agent` | 512 MB | graph, guards; add 300 MB if the local Prompt Guard 2 classifier is adopted |
| `agent-ingest` | 256 MB | consumer |
| `contact` | 192 MB | HTTP + mailer |
| Umami | 300 MB | |
| Uptime Kuma | 200 MB | |
| **Production total** | **about 4.3 GB** | about 4.6 GB with the local classifier |
| Staging (`web`, `api`, `agent`, `contact`, workers), when started | about 1.6 GB | stopped by default after cutover (D-30) |

  Peak with staging running: about 6.2 GB of 8 GB, leaving headroom for page cache and spikes. The previous single-API plan needed about 3.7 GB, so the split costs roughly 1 GB in production.

  **Conditional rows (second pass 2026-10-03, H-2).** The follow-ups each added memory and nobody summed it. If every R4 to R7 item ran at once in production, the budget would be about 5.6 GB, and about 7.2 GB with staging: no headroom on an 8 GB box.

| Process (release) | Limit | Notes |
|---|---|---|
| `mcp` (R4, WP-36) | 150 MB | stateless edge service |
| `gateway` (R7, WP-53) | 150 MB | stateless; `/api/*` only |
| `guard-classifier` (R7, WP-55) | 500 MB | Python + Prompt Guard 2 86M on CPU; image about 1 GB |
| Qdrant (R7, WP-54) | 512 MB | only while the comparison runs, or if adopted |

  **Rule:** at most two of {`gateway`, `guard-classifier`, Qdrant} run in production at the same time until real memory is measured; staging starts only the services under test (D-30); a learning item that loses its eval comparison is stopped, not kept "just in case". Every WP that adds a process updates this table before it merges.

## Firewall

the **Hetzner Cloud Firewall** (in front of the VM) allows 80 and 443 from anywhere and nothing else (SSH through Tailscale). Why not ufw alone: Docker publishes ports by writing NAT and FORWARD rules that ufw's INPUT chain never sees, so a container port can be reachable even with ufw denying it. The Cloud Firewall filters before traffic reaches the VM, so Docker cannot bypass it; binding to `127.0.0.1` is the second layer. RabbitMQ's ports (5672, 15672) are never published publicly.

## Health and restarts

every service has `healthcheck` on `/health/ready`, `restart: unless-stopped`, and `depends_on` with `condition: service_healthy` only for hard infrastructure (Postgres); services do **not** depend on each other at startup, so one failing service never blocks another from starting (ADR-029 smell list).

## Backups

nightly `pg_dump` of every database plus the media volume and the RabbitMQ definitions export, encrypted (restic) to a Hetzner Storage Box or object storage, retention 7 daily and 4 weekly; Hetzner server backups as a second layer (paid add-on); a **restore drill** is an acceptance criterion of WP-8, because an untested backup is a hope. Queued messages are not backed up: every producer can re-emit from its outbox and every consumer is idempotent.

## Monitoring

Uptime Kuma monitors the site per locale, each service's `/health/ready`, TLS expiry, the SSE endpoint, and the RabbitMQ management API (alert when a dead-letter queue is non-empty); it serves status.jadero.dev. It runs on the same box, so it cannot report the box itself being down; add one external free check (for example a hosted uptime ping) as the backstop (D-31).

## Umami

cookieless analytics, self-hosted v3 (PostgreSQL-only since v3), script served from `stats.jadero.dev`; consistent with a privacy notice that needs no cookie banner for analytics.

## lab.jadero.dev

a sandbox for experiments (for example an agent playground showing the graph, node timings and trace links, or eval dashboards), behind basic auth until something there is meant to be public.

## Staging after cutover

keep `staging` as `new.jadero.dev` renamed to `staging.jadero.dev`, stopped by default and started by the deploy workflow when a release goes to staging (D-30).

## Cutover (WP-29)

switch the `jadero.dev` vhost to the new upstreams, 301 redirects for any old URLs worth keeping, verify, then stop and remove the pm2 processes (`jadero-backend`, recaptcha), remove pm2 startup, revoke the old reCAPTCHA keys, archive the old build and its nginx config.
