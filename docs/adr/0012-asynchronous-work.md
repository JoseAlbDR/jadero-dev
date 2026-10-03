---
id: ADR-012
title: "Asynchronous work (outbox, broker, jobs)"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-12]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-012: Asynchronous work (outbox, broker, jobs) (amended 2026-10-02)")
---

# ADR-012: Asynchronous work (outbox, broker, jobs)

**Status:** Accepted with a change (owner review 2026-10-03, D-12): dead-letter archive, events page and replay added (WP-50). Amended: the previous recommendation (outbox + pg-boss inside one app) changes to outbox + RabbitMQ between services (ADR-029).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-12). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Publishing must reliably trigger re-indexing in another service, the PDF CV and cache revalidation; a contact submission must reliably produce a notification. If a service writes its state and then crashes before telling anyone, the other services silently drift (the dual-write problem). With services, "telling someone" means a message on a broker, and a database transaction cannot include the broker.

## Considered options

- *A. Publish to the broker right after commit, in the request.* Pros: trivial. Cons: a crash between commit and publish loses the event; a broker outage fails or slows user requests.
- *B. Transactional outbox + pg-boss* (the previous recommendation). Pros: no broker; exactly-once enqueue inside one database. Cons: only works when producer and consumers share that database, which ADR-029 rule 1 forbids between services.
- *C. Transactional outbox in each producer's database + a relay into RabbitMQ + idempotent consumers.* The outbox row commits with the state change; a relay process claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`, publishes with publisher confirms, marks them sent; consumers record processed event ids in an `inbox` table in the same transaction as their effects. Pros: no lost events, no broker in the request path, at-least-once delivery made safe by idempotency. Cons: more moving parts (relay, inbox, retry topology); a second or two of latency.
- *D. BullMQ + Valkey as the bus.* Pros: rich job features. Cons: a job queue, not a pub/sub broker; another stateful service; weaker cross-service routing.

## Decision

C, implemented once in `packages/messaging` and used by every service. Relays: `api-worker` for `api`, an in-process relay for `contact` (tiny volume). Retry and dead-letter topology per ADR-029.

## Scheduled jobs

`@nestjs/schedule` cron in the process type that owns the data: thread purge and the daily budget rollover in `agent`, submission retention purge in `contact`, outbox and inbox cleanup in each relay. One replica per process type, so a cron runs once; if a process is ever scaled out, a Postgres advisory lock elects one runner (leader election).

## Consequences

every consumer handler must be idempotent; every queue has a dead-letter queue, an alert and an admin replay action. The learning WP traces one publish end to end (section 3.4).

## Pattern names

dual-write problem, transactional outbox, message relay, publisher confirms, at-least-once delivery, idempotent consumer (inbox), atomic claim, retry with exponential backoff, dead-letter queue, leader election via advisory lock.

## Change (owner review 2026-10-03, D-12)

dead letters are archived and operable, not just alerted. Each service's consumer process reads its dead-letter queues into a `dead_letters` table in that service's own database (generic code in `packages/messaging`; no shared database, to keep database per service). The admin gets an Events page (outbox rows pending and published per event type, consumed and duplicate counts from the inbox, retries, dead letters with the original message, error and attempt count) and a Replay action that republishes to the original exchange with a `replayed-by` header, safe because consumers are idempotent. This is WP-50. The owner's question about atomicity with a try/catch and rollback is answered with a concrete trace in `owner-review-followups.md`.
