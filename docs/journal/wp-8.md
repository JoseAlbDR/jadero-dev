---
wp: 8
title: "Server preparation: close the doors, then prove the backups come back"
status: approved
date: 2026-10-18
locale: en
---

# Server preparation: close the doors, then prove the backups come back

Until WP-8 the server was a box that also hosted my older projects, with SSH open to the internet and nothing of v2 on it. Now it has a perimeter, a deploy user that can do one thing, a shared data layer for staging and production, an edge, and nightly backups I have actually restored.

## What I built

First I upgraded the host to Ubuntu 26.04 from a fresh snapshot. The upgrade surfaced an old sudo rule that gave my login user passwordless `apt` and `systemctl`, which is root by another name, so it went.

The perimeter: a Hetzner Cloud Firewall that lets in only 80 and 443, and SSH only over Tailscale. I opened the tailnet path and proved it before closing the public one, with the Hetzner web console as break-glass. A Tailscale policy with its own tests limits tailnet devices to SSH on the server.

The `deploy` user has a forced command on its key. Whatever the client sends goes through a small wrapper that only accepts `deploy <env> <service> <version>`, then one sudo rule runs a root script that checks the same words again.

The ops stack is one Compose project: Postgres with a role and database per service and environment, RabbitMQ with one vhost per environment and no `guest`, Umami and Uptime Kuma. Provisioning is convergent: `provision.sql` and `provision-users.sh` run again and again and fix drift. Secrets come from a dedicated 1Password vault through a read-only service account.

nginx now owns the TLS policy, the security headers and allowlist routing, and the access logs keep only the client's network, never the query string. Umami's tracker moved under the site's own origin so I never had to open CORS.

Backups: restic to Backblaze B2 every night, a marker when every item saved, a heartbeat to Uptime Kuma only on success. The drill restored seven databases into a throwaway container in under half a minute.

## What I learned

**Docker published ports skip ufw.** I knew the Cloud Firewall stops a port published on every interface. I did not know that from the tailnet that same port answered anyway, because Docker's NAT runs before ufw and Tailscale accepts its own interface first. The filter for a path has to sit on that path.

**An additive import leaves orphans.** I thought retiring a consumer would make its queue disappear. RabbitMQ's boot import only creates and updates, so the queue keeps its messages and keeps growing. Now the script warns about it, and removal is a deliberate step.

**Rotation against a connection pool.** I had it backwards: after a password change the open connections keep working, and it is every new connection that fails. The new secret has to reach the service in the same step that changes it at the source.

**Point-in-time consistency with an outbox.** If one database restores to Tuesday and the other to Monday, an event already marked sent is never sent again, so the other service misses it for good. All databases come from the same complete night.

**A dead man's switch beats a failure alert.** A job that never starts never sends the failure mail. The alert has to fire on silence.

**The earliest guardrail is a test, not a firewall rule.** I answered "the Cloud Firewall" for a bad bind. The earlier answer is the hardening test that fails the pull request before anything reaches the server.

A forced command checks the form of the words, not whether a version is wise. A stolen CI key could still roll production back to an old release, so the downgrade guard goes into WP-9.

## What I would change

I would draw the network paths before writing a single firewall rule. The tailnet gap only showed up because a check question made me test it live.

I spent too long on the shared nginx before deciding the host was mine to change. Once I said that, the design got simpler.

I would also keep screenshots out of the chat when a page shows a token. The backup's push token showed up in two of them; nginx does not open the push path to the internet, so I left it as it is.

**Next:** WP-9 builds the deploy pipeline: the real `deploy.sh`, the downgrade guard, rotation in the right order, and the first real tables in the restore drill.
