---
id: ADR-029
title: "Service boundaries and messaging"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-39, D-40, D-41, D-42, D-43, D-49]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-029: Service boundaries and messaging (new 2026-10-02)")
---

# ADR-029: Service boundaries and messaging

**Status:** Accepted (second pass 2026-10-03): boundaries (D-39), broker (D-40), client (D-41), contracts (D-43), how the agent gets content (D-42, a: the content in `api` is the source of truth, the agent's index is a derived CQRS read model rebuildable from events, so nothing is stored twice in the sense the owner feared) and the resilience library (D-49, cockatiel) are decided. One edge rule is added: stateless **edge adapters** (the future gateway, WP-53, and the MCP service, WP-36) may call the owning services synchronously because they translate an outside protocol into calls and own no data; the no-synchronous-calls rule still holds between `api`, `agent` and `contact`.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-39, D-40, D-41, D-42, D-43, D-49). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The owner's request (steering 003): microservices "as far as possible, so that if one thing goes down it does not affect the others", naming the agent, the admin panel, a contact form and RabbitMQ. What services buy: independent failure, independent deploys, independent resource limits and scaling (team autonomy, the usual main reason, does not apply to one person). What they cost: calls over a network that can fail, eventual consistency, a contract at every boundary, more images, health checks, logs and traces, and a heavier local setup. So the real question is not "monolith or microservices" but **which boundaries are worth paying for**.

## First principles: when a boundary pays

A part deserves its own service when at least one holds: (1) it fails differently (external providers, memory or CPU spikes); (2) it changes on a different rhythm; (3) it has a different security exposure; (4) its slow work must not block the request path of something else. Checking each candidate:

| Candidate | (1) fails differently | (2) own rhythm | (3) own exposure | (4) blocking work | Verdict |
|---|---|---|---|---|---|
| agent (chat, retrieval, guards, usage) | yes: AI providers, memory, cost attacks | yes: prompts and models change weekly | yes: public, abused | yes | **own service** |
| contact (form, mail) | yes: mail provider | no | yes: public spam target | yes: sending mail | **own service** (small, the best first service to learn on) |
| ingestion (chunk, embed, index) | yes: embeddings provider | with the agent | no | yes | **process type of `agent`**: it writes the agent's data |
| PDF CV, cache revalidation | no | with content | no | yes | **process type of `api`**: derived from content |
| admin UI | no | yes | yes: privileged | no | **own deployable** (static files), no backend of its own |
| auth (admin session) | no | rarely | privileged, tiny | no | **stays in `api`**: a separate auth service would put a synchronous dependency in front of every admin call |
| content, media, translations | no | together | no | no | **stay together in `api`** (modular monolith) |

## Considered options

- *A. Pure modular monolith* (the previous recommendation). Pros: simplest, strongly consistent, least RAM and operations. Cons: an agent memory spike or crash takes content and admin down with it; a prompt change redeploys everything; teaches nothing about messaging, which the owner explicitly wants.
- *B. Modular monolith + extracted services where isolation pays:* `api`, `agent`, `contact`, process types for background work, RabbitMQ between them. Pros: isolation exactly where failures come from; every boundary justified by the table above; teaches outbox, idempotent consumers, dead-letter queues, contracts and cross-service tracing. Cons: about 10 more build days; about 1.5 GB more RAM; eventual consistency (the agent learns about a publish a few seconds later).
- *C. Full microservices:* one service per module (content, auth, media, cv, knowledge, chat, usage, contact, mcp, plus a gateway). Pros: maximum isolation on paper. Cons: modules that share data and change together would call each other synchronously all day, which is the **distributed monolith** anti-pattern (all the costs of distribution, none of the independence); about 4 GB more RAM; ten deployables for one person; it shows less engineering judgment, not more.

## Decision

B.

## Communication rules (the anti-distributed-monolith checklist, written into AGENTS.md)

  1. Each service owns its database; no service reads another's tables; no shared ORM entities.
  2. Between services only asynchronous messages: events for facts (`content.published.v1`, `contact.received.v1`) and commands for admin actions (`knowledge.reindex.requested.v1`). Synchronous HTTP only at the edge, from a browser through nginx.
  3. A service that needs another's data keeps its own read model fed by events (event-carried state transfer) instead of calling back: the agent never calls `api`.
  4. Services deploy independently: message schemas evolve backward-compatibly (add optional fields only; a breaking change is a new versioned type published alongside the old one until every consumer moved: expand/contract for messages).
  5. Shared packages are infrastructure only (`platform-nest`, `messaging`, `contracts`); never shared domain code.
  6. Smells we watch for: two services always deployed together; a service that cannot start without another; chains of synchronous calls; a "common" package that keeps gaining domain types.

## Broker options

| Option | What it is | Pros | Cons |
|---|---|---|---|
| RabbitMQ 4 | AMQP broker: producers publish to exchanges, bindings route to queues | Topic exchanges fit domain-event fan-out; durable quorum queues; dead-letter exchanges; a default delivery limit of 20 per message since 4.0 protects against poison loops; management UI; virtual hosts isolate staging and production on one broker; the owner meets it at work, so the learning transfers | An Erlang service (about 150 to 200 MB); more concepts (exchanges, bindings, acks, prefetch); Nest's built-in RabbitMQ transport only uses the default exchange and a fixed `pattern`/`data` message format, so use `@golevelup/nestjs-rabbitmq` (topic exchanges, routing keys) or a thin own adapter over amqplib |
| NATS + JetStream | lightweight messaging; JetStream adds persistence | Tiny (tens of MB), fast, simple subjects; Nest has a built-in NATS transport | That transport is core NATS, fire and forget: a disconnected consumer loses messages; JetStream needs its own client wiring; less transferable |
| Redis Streams (Valkey) | append-only log with consumer groups | Small; doubles as a cache and rate-limit store | Weaker routing; Nest's Redis transport is pub/sub (fire and forget), streams need custom code; retries and dead letters are do-it-yourself |
| pg-boss | job queue inside Postgres | No new infrastructure; enqueue in the same transaction | Not a broker: services sharing one queue schema share a database, which breaks rule 1; polling; does not teach messaging |
| Kafka / Redpanda | distributed log | Industry standard for event streaming | Heavy (Redpanda wants about 1 GB or more); overkill for a few events a day |

## Broker recommendation

RabbitMQ 4. Topology: one topic exchange `jadero.events`; routing keys `<context>.<event>.v<N>`; one durable quorum queue per consumer and purpose (`agent.ingest.content`, `api.worker.content`, `contact.mailer`); a dead-letter exchange per queue; explicit retry tiers (TTL retry queues of 10 s, 1 min and 10 min) before the dead-letter queue; publisher confirms on every relay; consumer prefetch of 10; `infra/rabbitmq/definitions.json` as the reviewed source of truth for the topology (infrastructure as code); virtual hosts `/prod` and `/staging` with one user per service and per vhost, each allowed only its own queues. Library: `@golevelup/nestjs-rabbitmq` behind our `MessageBus` port, an in-memory adapter for unit tests, Testcontainers RabbitMQ for integration tests **(verify Nest 12 support at WP time; fallback: own adapter over amqplib)**.

## Reliability patterns

transactional outbox on every producer (the outbox row commits with the state change; a relay publishes it with confirms); idempotent consumer with an `inbox` table of processed event ids, written in the same transaction as the consumer's effects; retry with exponential backoff, then a dead-letter queue with an alert and an admin "replay" action; poison-message protection through the delivery limit; circuit breaker, timeout and bulkhead around calls to external providers (AI, mail) with cockatiel, a TypeScript resilience-policy library **(verify at WP time)**; timeouts on every network call.

## Contracts

event payloads and HTTP DTOs are Zod schemas in `packages/contracts`; every message uses a CloudEvents 1.0 envelope (`id` for idempotency, `source`, `type` with version, `time`, `traceparent` for tracing); an AsyncAPI 3 document is the event catalog, checked against the schemas in CI; contract tests: every consumer parses the producer's example fixtures with its own schema version (schema compatibility checks, simpler than Pact inside one monorepo).

## Consequences

eventual consistency becomes visible (seconds between publish and the agent knowing), so the admin shows index lag; each service needs health checks, metrics, logs and traces (ADR-010); local development runs Postgres and RabbitMQ in compose and the services on the host (section 10); about 10 more days of build (section 14).

## Pattern names

bounded context, database per service, event-carried state transfer, transactional outbox, idempotent consumer (inbox), publish-subscribe, competing consumers, dead-letter queue, retry with exponential backoff, circuit breaker, bulkhead, expand/contract for messages, consumer-driven contracts, distributed monolith (anti-pattern).

## Owner review (2026-10-03)

D-42 is open because the owner asked why data is stored twice (F-8). `api` holds the source of truth (entries, revisions, approval state, everything the site and the admin need); `agent` holds a search index derived from it (chunks, vectors, full text), rebuildable from events. Option C (the agent owns knowledge entries end to end) was added for comparison. D-49 (cockatiel) is open only because no option was picked (F-9). If D-45 d and D-59 b are chosen, rule 2 reads: synchronous HTTP only at the edge, where the edge is nginx, the gateway and the MCP edge service; the owning services still never call each other synchronously.
