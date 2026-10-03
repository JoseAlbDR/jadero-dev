---
id: ADR-033
title: ""Under the hood" page"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-56]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-033: "Under the hood" page (new 2026-10-02; reframed 2026-10-03)")
---

# ADR-033: "Under the hood" page

**Status:** Accepted (owner review 2026-10-03, D-56).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-56). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

A page that shows how the site itself is built: a live diagram of the services with their health, and the public ADR log. It is the most direct proof of several pillars at once (architecture, reliability, CI/CD, infrastructure): the architecture is visible, not just claimed.

## Considered options

- *A. Server-rendered page: architecture diagram (SVG generated from the mermaid source) with a status dot per service, fed by a small cached endpoint that reads Uptime Kuma's public status-page data; the ADR log rendered from `docs/adr/` at build time.* Pros: live and honest; no internal hostnames or ports exposed (only up, degraded or down per named service); if Uptime Kuma is down the page says "status unavailable" and still renders. Cons: one more small integration.
- *B. Embed the Uptime Kuma status page.* Pros: no code. Cons: a different look, no diagram, an iframe on the main site.
- *C. Static diagram only.* Pros: zero moving parts. Cons: not live, so it loses the point.

## Decision

A. The `web` server fetches Uptime Kuma on localhost and caches for 30 seconds, so visitors never hit Kuma directly and no service gains a dependency on it. The ADR log shows status, date and title per ADR with a link to the file in the public repo (after D-29). A short "how a chat message travels" walkthrough (section 3.3) can sit beside the diagram.

## Consequences

a public page must never reveal what an attacker could use: no versions with known CVEs, no ports, no queue names; show service names and health only.

## Pattern names

observability as a product surface, caching with a stale fallback, information-disclosure minimization, architecture decision log.
