---
id: ADR-008
title: "Admin authentication"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-8, D-47]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-008: Admin authentication (amended 2026-10-02)")
---

# ADR-008: Admin authentication

**Status:** Accepted with a change (second pass 2026-10-03): admin authentication decided (D-8, option A); cross-service authorization decided as D-47 option a now and d later: nginx `auth_request` to `api` through R6, with the identity header signed as an HMAC with an internal key **and a timestamp** from the start, so a captured header expires; when the gateway lands (WP-53, R7) the session check moves into it and nginx stops running `auth_request`, while the services verify the header exactly as before.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-8, D-47). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context (amended 2026-10-02)

Exactly one user (the owner) edits content. The admin UI is a static SPA on `admin.jadero.dev` (ADR-002) that calls the admin endpoints of `api`, `agent` and `contact` through nginx on the same origin. A compromise would let an attacker publish content that also feeds the RAG index (a data-poisoning path, LLM04).

## Cross-service authorization (new 2026-10-02)

sessions live in `api`. For admin routes of the other services, nginx runs `auth_request` against `api`'s `/auth/verify` and forwards a signed `X-Admin-Id` header only when the session is valid; `agent` and `contact` accept admin routes only from nginx on the internal network and verify that header's signature with a shared internal key. Alternatives: each service validating sessions by calling `api` (a synchronous dependency on every admin call), or short-lived JWTs issued by `api` and verified locally by each service (stateless, but revocation needs care). Recommended: `auth_request` (one decision point, no auth code in the other services; D-47).

## Considered options

- *A. Better Auth (server library) with GitHub OAuth restricted to one allow-listed GitHub user id, database sessions, passkey plugin as second factor later.* Pros: modern, maintained, sessions in our Postgres, passkeys and 2FA available as plugins, a NestJS integration exists (`@thallesp/nestjs-better-auth`, actively published) **(verify Nest 12 support at WP time)**; nothing to store about passwords. Cons: a library's model to learn; OAuth depends on GitHub availability.
- *B. Hand-rolled: argon2id password + TOTP + server-side session table + httpOnly cookie.* Pros: teaches every mechanism. Cons: the classic place to make a subtle mistake; more security surface to own.
- *C. Passport + JWT access/refresh tokens.* Pros: common tutorial path. Cons: JWT in browser storage is XSS-exfiltratable, revocation needs a denylist; the wrong tool for a same-origin, single-user, session-shaped app.
- *D. Network-only protection (admin reachable only over Tailscale) with no app auth.* Pros: strongest exposure reduction. Cons: teaches nothing about auth; one misconfigured proxy exposes an unauthenticated admin.
- *E. Hosted identity (Clerk, Auth0).* Pros: fast. Cons: third-party dependency and data processor for one user; little learning.

## Decision

A, plus defense in depth: `SameSite=Strict`, `HttpOnly`, `Secure` session cookie; CSRF token on state-changing requests; auth endpoints rate-limited; an audit log of admin actions; optional layer D later for `admin.jadero.dev` if the owner wants it.

## Consequences

The learning WP explains sessions vs tokens with a concrete cookie trace, the OAuth authorization-code flow with PKCE step by step, and why an allow-list check must use the immutable GitHub user id, not the username.

## Owner review (2026-10-03)

option A is decided (D-8). Cross-service authorization (D-47) is open and follows D-45: with the NestJS gateway (D-45 d), the gateway validates the session against `api` (cached about 30 seconds), strips identity headers that arrive from outside and forwards a signed, timestamped identity header that the services verify (D-47 d); with nginx alone, `auth_request` stays.
