---
id: ADR-040
title: "Chaos test"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-71]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-040: Chaos test (new 2026-10-02, steering 007; extends WP-27)")
---

# ADR-040: Chaos test

**Status:** Accepted (owner review 2026-10-03, D-71).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-71). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The owner wants proof, not a claim, that the site stays up and messages are not lost when the agent service or the broker stops. WP-27 is a manual game day; this adds a scripted, repeatable chaos test with documented results.

## Steady-state hypothesis (what "fine" means)

every public page answers 200 (from `web` or nginx's stale cache); the chat answers with the resting state, never a 5xx; every contact submission is stored and notified exactly once after recovery; every publish reaches the agent's index after recovery; the outboxes drain to zero; no message ends in a dead-letter queue.

## Considered options

- *A. Manual game day only* (WP-27). Pros: cheap, good for learning. Cons: not repeatable, easy to skip.
- *B. Scripted chaos test in staging.* A script starts synthetic traffic (page loads in three locales, chat turns, contact submissions with the fake mail adapter counting deliveries, one content publish), stops `agent` for two minutes, then RabbitMQ for two minutes, restarts both, waits for recovery, and checks every point of the hypothesis; it writes a report. Pros: repeatable before every release that touches messaging; turns resilience into a test. Cons: a script and fixtures to maintain.
- *C. Continuous chaos in production.* Pros: the strongest signal. Cons: real visitors pay for it; out of proportion for a portfolio.
- *D. Network faults with Toxiproxy* (latency, dropped connections). Pros: tests timeouts and circuit breakers. Cons: more setup; better as an extension of B.

## Decision

B, with D as a later extension. Run before launch and before releases that touch messaging. The result is documented as a journal post and shown on the "Under the hood" page ("last chaos test passed on <date>").

## Pattern names

chaos engineering, steady-state hypothesis, blast radius, game day, failure injection.
