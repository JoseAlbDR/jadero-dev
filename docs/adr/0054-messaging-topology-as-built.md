---
id: ADR-054
title: "Messaging topology as built"
status: accepted
date: 2026-10-19
deciders: [owner]
decisions: [D-85]
supersedes: [ADR-029]
superseded_by: null
source: WP-5 (docs/learning/wp-5.md, Decision and Step log, the PR #89 review fixes); drift found by the events guide check of 2026-10-19
---

# ADR-054: Messaging topology as built

**Status:** Accepted (owner, 2026-10-19). Supersedes ADR-029 as a whole. It restates four details of the broker recommendation as WP-5 built them: two contradicted ADR-029's wording (prefetch, dead-letter exchange) and two were left unsaid (how a retry is routed, what the delivery limit counts). Everything else in ADR-029 is restated unchanged (section "Unchanged"); read ADR-029 for its full text.

## Context

ADR-029's broker recommendation says "a dead-letter exchange per queue" and "consumer prefetch of 10". WP-5 built one shared dead-letter exchange and, after the PR #89 review, a prefetch of 4 on the agent consumer with a database pool of 6. Those choices were recorded only in the WP-5 explainer's step log, so the ADR, which is the canonical record, no longer matched the code. The retry routing and the meaning of the delivery limit were never written in an ADR at all.

## Considered options

For each detail: *A. Change the code back to ADR-029's wording.* *B. Record the code as the decision.*
- Prefetch 10 against a pool of 6: four delivered messages would wait for a connection, holding their delivery and risking timeouts and redeliveries. B.
- One dead-letter exchange per queue: the same result (one dead-letter queue per queue) with one exchange per queue more to declare and permit. B.

## Decision

B for all four.

- **Prefetch per consumer, below its database pool.** Each consumer sets its own prefetch, smaller than the database pool it uses, because prefetch is the consumer's backpressure and the pool is the resource that limits it. The `agent` heartbeat consumer uses 4 with a pool of 6. The adapter's default stays 10 for a consumer that does not set one.
- **One shared dead-letter exchange.** `jadero.dlx` is one direct exchange; a per-queue policy dead-letters each queue to it with the queue's name as routing key, and a binding routes that key to `<queue>.dlq`. Every queue still has its own dead-letter queue.
- **Retry by a confirmed copy, then ack.** A failed handling publishes a copy of the message to the consumer's `<service>.retry` direct exchange, which routes it to the next wait queue (`.retry.10s`, `.retry.1m`, `.retry.10m`, ADR-029's tiers); each wait queue dead-letters back to the work queue when its TTL expires. The original is acked only after the broker confirms the copy; if the copy is not confirmed, the original is nacked with requeue, so a message is never lost between the two. After the last tier the message goes to `<queue>.dlq`.
- **The delivery limit counts redeliveries the consumer did not settle.** `delivery-limit: 20` is a policy. On RabbitMQ 4.3 a quorum queue's delivery count goes up on `basic.reject` and when a consumer crashes or loses its connection holding the message; it does not go up on `basic.nack`. The adapter never rejects, so in practice the limit stops a message that crashes its consumer again and again (poison message).

## Unchanged

Restated from ADR-029 without change: the boundary analysis and its verdicts, option B (modular monolith plus extracted services), the communication rules 1 to 6, the broker options and the choice of RabbitMQ 4, the rest of the topology (one topic exchange `jadero.events`, routing keys `<context>.<event>.v<N>`, one durable quorum queue per consumer and purpose, the retry tiers, publisher confirms on every relay, `infra/rabbitmq/definitions.json` as the reviewed source of the topology, vhosts `/prod` and `/staging` with one user per service and vhost), the library and adapter choice, the reliability patterns, the contracts, the consequences, the edge-adapter rule and the owner review of 2026-10-03. ADR-053 (on the WP-9 branch) changes who imports the topology, not its shape.

## Consequences

- No code change: this record catches up with the code.
- The events guide (owner's learning notes) drops its "under review" marks.
- The process gains a check so a value or mechanism that contradicts an ADR line cannot close a work package without a superseding ADR (the reviewer agent and `/wrap-wp`).

## Pattern names

backpressure (prefetch below the limiting resource), dead-letter queue, retry with tiered backoff, publish then ack (no loss between two broker operations), poison message, documentation drift.
