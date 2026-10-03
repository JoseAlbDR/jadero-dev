---
id: ADR-010
title: "Observability"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-10]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-010: Observability (amended 2026-10-02)")
---

# ADR-010: Observability

**Status:** Accepted (owner review 2026-10-03, D-10).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-10). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Across services (new 2026-10-02)

a request now crosses processes and a broker, so tracing becomes essential rather than nice. W3C `traceparent` travels in HTTP headers (OTel HTTP instrumentation) and in RabbitMQ message headers (OTel's amqplib instrumentation injects it on publish and continues the trace on consume); the outbox stores the `traceparent` of the request that wrote it, so a trace runs browser, nginx, `api`, outbox, relay, RabbitMQ, `agent-ingest` without gaps. Every log line carries `service`, `trace_id` and `event_id`. Per service: `/health/live` (process up) and `/health/ready` (database and broker reachable) through `@nestjs/terminus`, used by compose health checks and Uptime Kuma. Broker signals: queue depth and dead-letter counts from the RabbitMQ management API, with an alert when any dead-letter queue is non-empty.

## Context

One server, one owner, a small budget of RAM. Agent traces go to LangSmith anyway. The owner should learn the three signals (logs, metrics, traces) without operating a heavy stack.

## Considered options

- *A. Minimal:* JSON logs (pino) with request ids + Uptime Kuma + LangSmith. Pros: almost free. Cons: no traces across Next to Nest; metrics only through ad-hoc queries.
- *B. A + OpenTelemetry instrumentation exported over OTLP to a free hosted tier (for example Grafana Cloud free).* Pros: real distributed traces and metrics, nothing heavy on the box; NestJS 12's `@nestjs/observe` or the OTel SDK does the instrumentation **(verify `@nestjs/observe` exporter options at WP time)**. Cons: telemetry leaves the server (no visitor PII in spans by design).
- *C. Self-hosted Grafana + Loki + Tempo + Prometheus.* Pros: full control. Cons: well over 1 GB RAM and real operations work on an 8 GB box shared with everything else.
- *D. Error tracking (Sentry SaaS or self-hosted GlitchTip).* Pros: grouped exceptions with context. Cons: another account or container.

## Decision

B, with the exporter switchable to console in dev. Business metrics that matter most (tokens, cost, blocked requests, guard verdicts per day) live in the agent's database (`usage.llm_usage`, `usage.guard_events`) and show on an admin dashboard page. Correlation: the LangSmith trace id and the OTel trace id are both stored on the usage row.

## Consequences

Logging rules in AGENTS.md: never log message bodies at info level, never log secrets, hash IPs (salted, daily-rotated salt).
