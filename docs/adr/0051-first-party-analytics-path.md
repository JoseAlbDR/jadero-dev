---
id: ADR-051
title: "First-party analytics path"
status: accepted
date: 2026-10-18
deciders: [owner]
decisions: [D-81]
supersedes: [ADR-050]
superseded_by: null
source: docs/learning/wp-8.md (step 5 Decision amendment, 2026-10-18)
---

# ADR-051: First-party analytics path

**Status:** accepted

## Context

ADR-027, restated by ADR-050, serves the Umami tracker from its own host, `stats.jadero.dev`. WP-8 step 5 built that vhost and found the cost: the tracker loads on the site's origin and posts page views to `stats.jadero.dev/api/send`, a cross-origin request the browser only allows when the response carries `Access-Control-Allow-Origin`. ADR-047 closes CORS on every host and asks for a new ADR naming the origin and the route before any is opened. A separate host also needs its own DNS records and certificate, and the site's CSP would have to allow that host in `script-src` and `connect-src`.

Umami's only public part is the tracker script and its collect endpoint; its admin app stays on the tailnet (WP-8 Q2 B).

## Considered options

- *A. Keep `stats.jadero.dev` and open CORS for `/api/send` to the site's origins only.* Pros: matches ADR-027; Umami stays on its own name. Cons: opens a CORS door ADR-047 keeps shut; one more host, DNS record and certificate; two more sources in the site's CSP; ad blockers match analytics hosts by name.
- *B. Serve the tracker first-party: two paths on the site's own host, proxied by nginx to Umami.* Pros: same origin, so no CORS at all and no CSP change (`'self'` covers the collect call); one host fewer; fewer ad-blocker misses. Cons: the site's vhost carries two analytics routes; the paths must avoid the site's and the API's prefixes.
- *C. Drop self-hosted analytics.* Pros: nothing to run. Cons: loses the cookieless traffic numbers the plan wants (ADR-027).

## Decision

**B.** nginx serves Umami's tracker script and collect endpoint under a short prefix on the site's host (`/s/` on `new.jadero.dev` today, on `jadero.dev` after the cutover), proxied to Umami on `127.0.0.1`; every other Umami path stays unreachable from the internet. There is no `stats.jadero.dev`. A was discarded because it opens CORS and adds a host for a call that can be same-origin; C because the analytics are wanted.

**Restated from ADR-050 without change:** internal traffic stays plain on the private Docker networks as an accepted risk with its compensating controls and revisit triggers; restic writes nightly to a Backblaze B2 bucket in EU Central through the S3 backend, 7 daily and 4 weekly, with a restore drill; no Hetzner server backups, a manual snapshot before risky host changes; the planned move to a home NAS with `restic copy`; and everything ADR-050 restated from ADR-027 (server, layout, memory budget, firewall, health and restarts, backup scope, monitoring with Uptime Kuma on `status.jadero.dev` and the external check, Umami as cookieless self-hosted v3, `lab.jadero.dev`, staging after cutover, the cutover steps), except the tracker host above.

## Consequences

- WP-8 step 5 drops the `stats.jadero.dev` vhost and adds the two `/s/` locations to the site's vhost, with the same body limit and rate limit as the other public API locations; the owner creates no DNS record or certificate for `stats.`.
- The WP that adds the tracker to `web` loads it from `/s/` with the page's CSP nonce and checks which path the script posts to (Umami derives it from the script's location or a `data-host-url` attribute; **verify** against the pinned image).
- The cutover (WP-29) moves the two locations to `jadero.dev` with the rest of the site.
- CORS stays closed on every host (ADR-047).

## Pattern names

Same-origin policy, first-party proxy, attack surface reduction, deny by default.
