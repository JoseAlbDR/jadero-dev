---
id: ADR-052
title: "Client addresses in the edge logs"
status: proposed
date: 2026-10-18
deciders: [owner]
decisions: [D-82]
supersedes: []
superseded_by: null
source: docs/learning/wp-8.md (Step log, the PR review of the wrap, 2026-10-18)
---

# ADR-052: Client addresses in the edge logs

**Status:** proposed

## Context

ADR-010 and `AGENTS.md` say to hash IPs in logs. That rule is written for the services, which control every line they log. The host nginx of WP-8 is different:

- The access log uses the `jadero` format, which keeps only the network part of the address (the /24 for IPv4, the /48 for IPv6) and drops the query string.
- The error log has no format. nginx writes the client address and the request line, query string included, of the request that caused an entry: an upstream that refuses or times out, a rate limit, a body over the limit.
- Ubuntu's shared logrotate rule (`/etc/logrotate.d/nginx`, all of `/var/log/nginx/*.log`) keeps 14 daily files, for every project on the host.

The WP-8 PR review flagged that the error log keeps addresses in clear for 14 days with no written exception. Those upstream errors are the first thing to read when a service is down.

## Considered options

- *A. Log level `crit` on the jadero sites.* Pros: no client address is written. Cons: the upstream errors (`connect() failed`, `upstream timed out`) are at `error` and are lost, so an outage is debugged blind.
- *B. Keep `error`, keep three days, write it down.* The jadero sites write their error logs under `/var/log/nginx/jadero/` with their own logrotate rule: daily, three files, compressed. Pros: the outage diagnostics stay; the exception is bounded and recorded. Cons: addresses in clear for up to three days, in files only root and the `adm` group read.
- *C. Send the error log to syslog and mask the address there.* Pros: no address in clear. Cons: a syslog rule and its tests for a small site; a mistake in the rule loses the log.

## Decision

**B.** The jadero sites keep `error_log` at `error`, written to `/var/log/nginx/jadero/<host>.error.log`, rotated by `infra/logrotate/jadero-nginx` (daily, three files, compressed, nginx reopens its logs after a rotation). The subfolder keeps Ubuntu's rule and ours apart: its glob does not enter subfolders, and logrotate refuses two rules for one file. The access log keeps the `jadero` format (network part only, no query string), which this ADR records as the edge's form of ADR-010's rule, since nginx cannot hash with a salt without a module.

A was discarded because it removes the log needed most in an outage. C was discarded as more machinery than a three-day bound needs.

ADR-010 stays accepted: its hashing rule still holds for every service. This ADR narrows it for the host nginx only. The global `error_log` in `nginx.conf` keeps Ubuntu's rule, since only sites without their own `error_log` write there, and those are not this repo's.

## Consequences

- WP-8: the sites' `error_log` paths move, `infra/logrotate/jadero-nginx` is added and installed to `/etc/logrotate.d/`, `scripts/nginx-hardening.test.mjs` checks the paths and the rule, and the owner creates the folder on the server and reloads nginx.
- A site added later writes its error log to the same folder, or the hardening test fails.
- Revisit if the edge moves to a proxy that can format its error log, or if a legal request asks for a shorter bound.

## Pattern names

Data minimization, storage limitation, accepted risk with compensating controls, privacy by default.
