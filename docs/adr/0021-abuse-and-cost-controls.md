---
id: ADR-021
title: "Abuse and cost controls"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-26, D-27, D-28]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-021: Abuse and cost controls (amended 2026-10-02)")
---

# ADR-021: Abuse and cost controls

**Status:** Accepted (owner review 2026-10-03, D-26 to D-28).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-26, D-27, D-28). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Rate-limit algorithms (learning content)

fixed window (simple, bursty at window edges), sliding window log (exact, stores every timestamp), sliding window counter (approximation from two counters, cheap), token bucket (allows short bursts, smooth average). Recommended: token bucket at the edge (nginx `limit_req` is a leaky-bucket variant) and sliding window counter in the app.

## App limiter storage options

in-memory (`@nestjs/throttler` default; resets on deploy, fine for one instance), Postgres (an `UNLOGGED` counters table through a custom throttler storage, about 60 lines, no new service, a good learning exercise), Valkey/Redis (standard, but a new stateful service).

## Decision

`@nestjs/throttler` with named throttlers (6 per minute and 40 per day per IP on the chat endpoint) and a custom Postgres storage; Valkey only if caching needs appear later. IPs are stored as salted hashes with a salt rotated daily.

## Bot friction

Cloudflare Turnstile (free, works without proxying the site through Cloudflare) verified server-side before the first message of a session. It replaces the old site's reCAPTCHA service, which retires, and (amended 2026-10-02) the same site key also protects the contact form (ADR-030). Each service keeps its throttler counters in its own database.

## Spend cap, three layers

  1. Per request: input 500 characters, output `max_tokens` 600, history window of 6 messages, per-thread cap of 12 user messages.
  2. Per day in the app: every model response's `usage_metadata` is priced with the config price table and summed in `usage.llm_usage`; when today's total reaches the cap (proposal USD 1.50), the preflight node short-circuits to a friendly "the assistant is resting, here is how to reach me" message (circuit breaker), and the admin dashboard shows it.
  3. Per month at the provider: Anthropic Console workspace monthly spend limit (proposal USD 20) on a dedicated production workspace and key; when hit, the API returns 429 and the app shows the same resting message. A separate workspace with its own small limit for CI evals. Same for OpenAI if used (project-level budget, **verify current controls at WP time**). Note from field reports: the workspace limit cuts traffic without a warning, so the app-level cap must trip first.

## Consequences

a cost attack costs the attacker effort and the owner at most the daily cap.
