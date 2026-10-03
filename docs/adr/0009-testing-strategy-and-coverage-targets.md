---
id: ADR-009
title: "Testing strategy and coverage targets"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-9]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-009: Testing strategy and coverage targets (amended 2026-10-02)")
---

# ADR-009: Testing strategy and coverage targets

**Status:** Accepted (owner review 2026-10-03, D-9).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-9). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

"Good coverage" is required, and the owner's rigor rule is verification over trust. LLM behavior is non-deterministic, so it needs its own layer (evals, ADR-019).

## Strategy (test pyramid plus evals)

- *Unit (Vitest):* domain and application layers with fake adapters; pure agent logic (chunking, RRF, citation mapping, guards' deterministic rules) in `packages/agent`; graph nodes with LangChain's `fakeModel` (scripted responses including tool calls).
- *Contract tests:* one shared suite per port (for example `embeddingsPortContract(adapter)`: returns the configured dimension, normalized vectors, stable output for identical input, query vs document input types). Every adapter must pass it: fakes on every run, real providers only in an opt-in nightly job with tiny inputs.
- *Integration (Vitest + Testcontainers):* Drizzle repositories, migrations up from zero, vector + full-text queries, outbox claim under concurrency, throttler storage, all against a real `pgvector/pgvector` container; and (amended 2026-10-02) the messaging path against a real RabbitMQ container: relay with publisher confirms, consumer idempotency when the same event arrives twice, retry tiers and dead-lettering.
- *Service end-to-end (Vitest + supertest):* each Nest service booted with fake AI and mail adapters, a Testcontainers database and broker: auth flow, publish flow (event observed by an `agent-ingest` instance), chat SSE flow, contact flow.
- *Contract tests between services (new 2026-10-02):* every consumer parses the producer's example event fixtures from `packages/contracts` with its own schema version; a breaking schema change fails CI before it can reach a deploy.
- *Frontend:* Playwright smoke tests per locale, axe accessibility checks on key pages, no coverage percentage (result-only area).
- *Agent quality:* LangSmith evals (ADR-019), not counted in coverage.

## Coverage targets

domain + application layers 90% lines and 85% branches; `packages/agent` and `packages/ai` 90% lines; API overall 80%; adapters covered by their contract suites. Coverage is reported per package in CI and gates the PR. Optional later: mutation testing (Stryker) on the domain layer, to show that coverage measures execution, not correctness.

## Machine-load rule

test scripts read `VITEST_MAX_WORKERS` (default: half the cores). The repo's AGENTS.md tells agents to size it from live load before running suites on the owner's machine (jobs = 12 minus the 1-minute load average minus 3, at least 1, at most 6).

## Consequences

Fakes are first-class code, not test-only hacks: `AI_*_PROVIDER=fake` also powers local development and the walking skeleton.
