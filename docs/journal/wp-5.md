---
wp: 5
title: "Two processes talk: the outbox, the inbox and one trace across RabbitMQ"
status: draft
date: 2026-10-04
locale: en
---

# Two processes talk: the outbox, the inbox and one trace across RabbitMQ

WP-5 is the first work package where two services of this site talk to each other. I work with NestJS and messaging every day, but I built this part to understand every piece myself, not to copy a setup I already use. <!-- owner: check -->

## What I built

A transactional outbox. When `api` changes something another service must know about, it writes the event as a row in an `outbox` table in the same transaction as the change. Both commit or neither does.

A relay in its own process, `api-worker`. Every second it claims due rows with `FOR UPDATE SKIP LOCKED`, publishes them to RabbitMQ, waits for the broker's confirm and marks them sent. A failed publish backs off per row, from 1 second up to 60.

An inbox on the consumer side. The consumer records `(consumer, event_id)` in the same transaction as its work, so a second delivery of the same event changes nothing.

A RabbitMQ topology written in TypeScript that generates the broker's definitions file. Each consumer queue has three wait queues (10 s, 1 min, 10 min) and a dead-letter queue. Services cannot create or delete queues.

One event, `system.ping.v1`, that travels from `api` through the broker to `agent` with one trace id from the HTTP request to the consumer's insert. A heartbeat sends it every 5 minutes, so the whole path keeps proving itself after this work package.

The `agent` skeleton: an HTTP process and a consumer process, each with its own database connection, health and readiness.

## What I learned

**At-least-once plus an idempotent consumer is the real guarantee.** There is no exactly once between a broker and a database. If the relay dies after the confirm and before its commit, the row stays unsent and gets published again. The consumer's inbox absorbs the duplicate. Exactly-once effects, not exactly-once delivery.

**The gap I had: `api` never publishes.** In my explain-back I said `api` saves the event and publishes it, and the relay only catches what was missed. Wrong. `api` only inserts the row. The relay is the only process that publishes for it. So with `api-worker` down for an hour, nothing reaches RabbitMQ, `api` keeps answering, and the backlog goes out in order when the relay is back. Walking the trace again on the code map, step by step, closed it.

**Policies, not queue arguments.** RabbitMQ never changes a declared queue's arguments. I found this when my dev broker kept old TTLs after a restart. Now queues declare only their type, and TTLs, dead-lettering and the delivery limit live in policies that change in place.

**Never trust a default to stop a poison message.** On RabbitMQ 4.3 a `nack` does not count toward the delivery limit, so a library default that requeues on failure loops forever. The version detail is not the point. The point is that handlers return `done`, `retry` or `dead`, and one adapter owns the retry policy.

**Why the relay restores the `traceparent`.** The request's trace context is stored in the envelope at the outbox insert. The relay runs later, in another process, so without restoring that context every publish would start a new trace. Restoring it gives one tree from request to consumer. Tracing the relay's one-second poll was noise, so that is now suppressed.

## What I would change

The review found slow failures the happy path never shows: cleanup jobs that existed but nothing called, a relay that could hold row locks for minutes while the broker was down, and a consumer that allowed more concurrent transactions than its connection pool had. All fixed, but next time I want to write the failure paths as tests before the happy path. <!-- owner: check -->

I would also start with policies from the first queue instead of moving to them halfway. <!-- owner: check -->

And I would draw how an event travels before writing code, not after. The flow graph in the code map came from my own request during the recap. <!-- owner: check -->

**Next:** WP-10, Drizzle migrations for every service, replacing the hand-written outbox and inbox SQL.
