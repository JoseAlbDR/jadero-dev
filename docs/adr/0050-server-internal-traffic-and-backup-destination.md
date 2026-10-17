---
id: ADR-050
title: "Server internal traffic and backup destination"
status: accepted
date: 2026-10-17
deciders: [owner]
decisions: [D-80]
supersedes: [ADR-027]
superseded_by: null
source: docs/learning/wp-8.md (Q1 and the Decision amendments, 2026-10-16 and 2026-10-17)
---

# ADR-050: Server internal traffic and backup destination

**Status:** accepted

## Context

WP-8 prepares the server ADR-027 describes. Three points of ADR-027 needed a decision at WP time or changed with the owner:

1. The 2026-10-09 hardening audit asks for a written decision on whether service-to-service and service-to-Postgres traffic stays on the private Docker networks without TLS or uses `sslmode`. ADR-027 says only that services reach Postgres and RabbitMQ on a private Docker network.
2. ADR-027 sends the nightly restic backup "to a Hetzner Storage Box or object storage" and keeps Hetzner server backups as a paid second layer. The owner does not want to spend beyond the server for now.
3. The owner plans a home NAS, mostly as a media server for the household's phone photos, with part of it for project backups. The backup destination should be able to move there later without starting over.

Everything on the box is one kernel: Postgres, RabbitMQ, the services and nginx talk over virtual bridges that never leave the host. The traffic that leaves the host (HTTPS, Tailscale, the backup upload) is already encrypted.

## Considered options

Internal traffic:

- *A. Plain on the private Docker networks, written down as an accepted risk with compensating controls.* Pros: no certificates, no CA, nothing to rotate; the only parties that could read the traffic (root on the host, a container on the same network) already hold the secrets that protect it. Cons: the day a database or broker leaves the box, the gap is real and must be closed before the move.
- *B. `sslmode=require` with self-signed certificates (and AMQPS).* Pros: encrypted on the wire. Cons: `require` does not check who answers, so an impostor on the network still gets the password; certificates to issue and renew for no attacker this stops.
- *C. `verify-full` with a private CA.* Pros: encrypts and authenticates the peer. Cons: a CA, distribution and rotation on a single host; the right answer once traffic crosses machines.
- *D. A service mesh with mutual TLS.* Pros: identity per workload. Cons: far more machinery than one host needs.

Backup destination:

- *E. Hetzner Storage Box.* Pros: same provider, SFTP. Cons: a monthly cost.
- *F. Backblaze B2 free tier.* Pros: 10 GB free with no minimum storage duration; an EU region (Amsterdam) chosen at account creation; S3-compatible, which the restic documentation recommends for B2. Cons: one more account; usage above 10 GB is billed, not blocked.
- *G. Cloudflare R2 free tier.* Pros: 10 GB free, free egress. Cons: an EU location and the free-tier card rule were not confirmed in the official pages checked.
- *H. A pull from the owner's laptop over Tailscale.* Pros: free, data stays with the owner. Cons: no backup on a night the laptop is closed, and the copy lives on a device that travels.

## Decision

**Internal traffic: A.** Traffic between services, Postgres, RabbitMQ and nginx stays plain on the private Docker networks. Compensating controls: one Docker network per environment, `pg_hba.conf` accepting each role only from its environment's subnet with `scram-sha-256`, one role per service and environment, no published database or broker port, every published port bound to `127.0.0.1`, and the Cloud Firewall allowing 80 and 443 only. B was discarded because it encrypts without authenticating the peer; C and D cost a CA or a mesh for a threat a single host does not have. Revisit when any of these happens: the database or the broker leaves the box (then C), a second server joins, a compliance requirement asks for encryption in transit, or the WP-53 gateway calls services over a network.

**Backup destination: F.** restic writes to a Backblaze B2 bucket in the EU Central region through the S3 backend (`s3:https://s3.<region>.backblazeb2.com/<bucket>`), with the keys rendered from 1Password. Retention stays 7 daily and 4 weekly, and the restore drill stays an acceptance criterion of WP-8. The data is a few MB, far below the free 10 GB. E was discarded for cost, G because its EU location and card rule were not confirmed, H because it fails on the nights the laptop is closed.

**No Hetzner server backups.** The paid second layer of ADR-027 is dropped. Before a risky host change (a release upgrade, a firewall change) the owner takes a Hetzner snapshot by hand and deletes it once the change is verified.

**Planned move to a home NAS.** When the owner sets up a home NAS reached over Tailscale, it becomes a restic destination: `restic copy` moves the snapshots into a repository there without starting over, and B2 can stay as the off-site copy (3-2-1: three copies, two media, one off-site). The trigger is the NAS being in place; nothing in WP-8 waits for it.

**Restated from ADR-027 without change:** the server (Hetzner CX33), the layout (host nginx and certbot, one vhost per name, the `jadero-prod`, `jadero-staging` and `jadero-ops` Compose projects, published ports on `127.0.0.1`, Postgres with one database and role per service and environment and `vector` only in `agent_*`, RabbitMQ 4 with `/prod` and `/staging`), the memory budget and its conditional rows and rule, the firewall (Hetzner Cloud Firewall allowing 80 and 443 only, SSH through Tailscale, `127.0.0.1` binds as the second layer), health and restarts, what the backup covers (every database, the media volume, the RabbitMQ definitions export; queued messages are not backed up), monitoring with Uptime Kuma and the external check (D-31), Umami, `lab.jadero.dev`, staging after cutover (D-30) and the cutover steps (WP-29). The Postgres image tag is the one WP-1 fixed (Postgres 18 with pgvector).

## Consequences

- WP-8 step 1 adds the B2 account, bucket and application key to the owner's steps of step 6, and the key names to the ops secrets template; the key itself only lives in 1Password.
- WP-8 step 6 verifies whether Backblaze asks for a card on the free tier and which daily transaction limits apply, and sets an alert if usage approaches 10 GB.
- Uptime Kuma's data volume joins the backup set (it holds the monitors and the push monitor of the backup heartbeat).
- A restore restores every database from the same night, because each service's outbox marks events as sent; mixing nights can leave a consumer without events its producer believes it delivered.
- The host was upgraded to Ubuntu 26.04 LTS before WP-8 built on it, so the edge runs nginx 1.28; the CI `nginx -t` check uses the same release.
- Any later move of a database or broker off the box reopens the internal traffic decision first.

## Pattern names

Accepted risk with compensating controls, defense in depth, network segmentation, threat modeling by trust boundary, 3-2-1 backup, restore drill, RPO and RTO, client-side encryption, make before break.
