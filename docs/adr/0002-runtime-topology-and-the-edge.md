---
id: ADR-002
title: "Runtime topology and the edge"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-2, D-44, D-45]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-002: Runtime topology and the edge (amended 2026-10-02)")
---

# ADR-002: Runtime topology and the edge

**Status:** Accepted with a change (second pass 2026-10-03): admin delivery decided (D-44, static SPA); topology and same origin per audience decided (D-2, a; the card now covers only that); the edge decided as D-45 option d **phased**: host nginx alone is the edge through R0 and R1, and a thin NestJS gateway for `/api/*` is built as learning WP-53 in R7, after the site is in production, with the entry rule that it takes on only what nginx cannot do (admin session check in tested TypeScript, merged OpenAPI document, an admin backend-for-frontend); per-route API limits then move to it, nginx keeps TLS, static files, the stale page cache and coarse limits, and pages never pass through the gateway. The "why not a gateway in the request path from day one" reasoning below stays true and becomes part of the case study. Amended after steering 003: the original recommendation (a single NestJS app) is superseded by the service split in ADR-029; this ADR now covers the deployables, the edge and the admin delivery.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-2, D-44, D-45). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The brainstorm first said "NestJS only if the backend grows" (line 16), later chose NestJS as a showcase (line 29), and the owner then asked for services with independent failure (steering 003). Everything runs on one CX33 (4 shared vCPU, 8 GB RAM, 80 GB disk) behind the existing host nginx.

## Deployables (from ADR-029)

`web`, `admin`, `api` (+ `api-worker`), `agent` (+ `agent-ingest`), `contact`; infrastructure: RabbitMQ, Postgres, Umami, Uptime Kuma.

## Considered options: the edge

- *A. Host nginx as the gateway:* TLS, path routing per service, rate limits, `auth_request` for admin routes, `proxy_cache_use_stale` for public pages. Pros: already installed and proven; near-zero RAM; every concern is a few lines of reviewed config. Cons: config is not TypeScript (mitigated by `nginx -t` in CI); `auth_request` adds one internal hop per admin request.
- *B. A dedicated gateway* (Traefik, Kong, or a NestJS "gateway" service that proxies every call). Pros: dynamic routing from Docker labels (Traefik), plugins (Kong), request aggregation (a Nest backend-for-frontend). Cons: one more process in every request's path; a Nest gateway that every call crosses becomes exactly the shared point of failure and coupling the split is meant to remove.

## Considered options: the admin

- *A. Static single-page app on `admin.jadero.dev`* (Vite + React + shadcn/ui), files served by nginx. Pros: no runtime process (no memory, nothing to crash or patch at runtime); its own origin and Content Security Policy; the public site ships no admin code. Cons: no server rendering, which a page behind a login does not need.
- *B. A second Next.js app on `admin.jadero.dev`.* Pros: same framework as `web`. Cons: about 250 MB RAM and a server process for a tool used a few times a week.
- *C. An `/admin` route group inside `web`* (the original plan). Pros: least code. Cons: admin code lives in the public app's server bundle; a `web` outage takes the admin down; one shared attack surface.

## Decision

edge A, admin A.

## Consequences

nginx config lives in `infra/nginx/` and is reviewed like code. Same origin per audience: public `jadero.dev/api/*`, admin `admin.jadero.dev/api/*`, each routed per service. The admin session cookie is scoped to `admin.jadero.dev`. The "why not a gateway service" reasoning belongs in the case study.

## Pattern names

API gateway (edge routing), gateway offloading (TLS, auth and rate limiting at the edge), process types, static hosting for authenticated SPAs.

## Owner review (2026-10-03, F-1 and F-2; decided in the second pass: D-2 a, D-45 d phased, see Status)

the owner noted that D-2 and D-45 repeat each other and wants to learn the gateway pattern. Proposed option D for the edge (D-45 d): nginx keeps TLS, static files, the stale page cache and coarse limits; a thin NestJS `gateway` behind it handles `/api/*` on both origins (routing, admin session check, correlation ids, per-route limits, merged OpenAPI docs, SSE pass-through), with no business logic, no database and no service-to-service traffic. Cost: one more hop, about 150 MB, about 3 to 4 build days, and a single point of failure for `/api/*`, mitigated by health checks and the page cache. D-2 now covers only the deployables and same origin per audience.
