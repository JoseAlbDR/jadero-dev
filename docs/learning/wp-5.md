---
wp: 5
decision: pending
adr: [ADR-003, ADR-009, ADR-010, ADR-012, ADR-029]
---

# WP-5: Messaging foundation and agent skeleton

Issue #13, branch `wp/5-messaging-foundation`, release R0, size M, tag learning. Depends on WP-3 (issue #11, closed).

Deliverable (report section 14): `packages/messaging` (the `MessageBus` port, RabbitMQ and in-memory adapters, CloudEvents envelope, outbox relay, inbox, retry and dead-letter topology), `infra/rabbitmq/definitions.json`, an AsyncAPI stub, the `apps/agent` skeleton; a `system.ping.v1` event travels `api` to RabbitMQ to `agent` with one trace.

What the owner learns (decisions.json): exchanges, bindings, queues, acks and prefetch; at-least-once delivery; the outbox and inbox patterns. This is the first WP where two processes talk, so most of the words go to what can fail between them: a crash between two writes, a message delivered twice, a message that never stops failing, a message that routes nowhere, a trace that breaks at the broker.

**Running in parallel with WP-4.** WP-4 (web skeleton) is being built at the same time on the owner's machine. Both touch `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.dependency-cruiser.cjs`, `AGENTS.md` and `docs/architecture/code-map.html`. Whichever merges second brings `main` in with a merge commit and regenerates the lockfile with `pnpm install`.

## How to read this file

This file is the only thing you need to read. ADR and WP numbers appear as sources, and every one of them is summarized in one line in the "Named here" table below, so you never have to open them to answer. Nothing here is to memorize: each question asks you to choose, and each explain-back asks you to describe what you saw in the code.

Before each question, read only these parts (about 5 to 10 minutes each):

| Question | Read first | Then |
|---|---|---|
| 1. Port shape | First principles: "Ports and adapters for a broker", "Acknowledgements and prefetch" | Options P |
| 2. Who declares the topology | First principles: "Exchanges, bindings, queues", "Unroutable messages" | Options T |
| 3. Retry routing | First principles: "Retries, dead letters and poison messages"; Trace 2, steps 1 to 6 | Options R |
| 4. Outbox and inbox storage before WP-10 | First principles: "The dual-write problem and the transactional outbox"; Trace 1, step 2 | Options S |
| 5. Relay trigger and claim | First principles: "The relay and the atomic claim"; Trace 1, step 3; Trace 2, "Broker down" | Options L |
| 6. Inbox key and retention | First principles: "At-least-once delivery and the idempotent consumer"; Trace 1, steps 5 and 7 | Options I |
| 7. Envelope and the trace across the broker | First principles: "The CloudEvents envelope", "One trace across an asynchronous hop"; Trace 1, steps 2, 3 and 5 | Options E |
| 8. Process types, readiness and the ping | First principles: "Process types", "Readiness with a broker" | Options W |

The session presents all questions in one message with this pointer; a question that depends on another gets a recommendation per possible answer of the first. Ask about anything before answering; "I don't know" on an explain-back means the explainer missed something, and it gets fixed here.

## Named here

| Name | What it is, in one line | When |
|---|---|---|
| WP-3 | Service platform: `platform-nest` (config, logging, problem+json, health, OpenTelemetry) and the `api` skeleton | done (PR merged) |
| WP-4 | Web skeleton (`apps/web`, Next.js) | in progress in parallel |
| WP-5 | This WP | now |
| WP-6 | CI pipeline: GitHub Actions with Postgres and RabbitMQ service containers, coverage gates, contract tests | R0, after WP-4 and WP-5 |
| WP-7 to WP-9 | Images, per-service release, server and deploy to new.jadero.dev (staging and the vhost `/staging` live there) | R0 |
| WP-10 | Data layer: Drizzle, migrations, repositories per service | R1, next backend candidate |
| WP-11 | Contact service: the second real producer and consumer (mail through the outbox) | R1 |
| WP-14 | Content events: `content.published.v1` and friends through the outbox from `api-worker` | R1 |
| WP-20 | Agent read model and ingestion: `agent-ingest` consumes content events | R2 |
| WP-26 | Observability across services: the hosted trace backend, queue depth and dead-letter alerts | R1 (after WP-23) |
| WP-50 | Event operations: dead-letter archive table, admin Events page, Replay action | R1 |
| ADR-003 | Inside a service: hexagonal modules where there are rules, layered where trivial; ports are abstract classes | accepted |
| ADR-005 | Drizzle is the data access library; repositories wrap it | accepted, lands in WP-10 |
| ADR-009 | Testing strategy: contract suites for adapters, Testcontainers for SQL and the broker, coverage gates | accepted |
| ADR-010 | Observability: OTLP traces, `traceparent` through HTTP and RabbitMQ headers, the outbox stores the request's `traceparent`; `/health/ready` covers "database and broker" | accepted |
| ADR-012 | Async work: transactional outbox per producer, relay with publisher confirms, inbox in the consumer's transaction; `api-worker` relays for `api` | accepted |
| ADR-029 | Service boundaries and messaging: RabbitMQ 4, topic exchange `jadero.events`, quorum queues, DLX per queue, retry tiers 10 s / 1 min / 10 min, prefetch 10, `definitions.json` as source of truth, `@golevelup/nestjs-rabbitmq` behind our `MessageBus` port, CloudEvents 1.0, Zod contracts, AsyncAPI 3 | accepted |
| ADR-042 | NestJS 12 on Node 24 LTS | accepted |
| ADR-043 | Own config loader before Nest (`loadConfig`), secrets rules | accepted |
| RabbitMQ | The AMQP 0.9.1 message broker, 4.3.6 in compose | infra |
| `@golevelup/nestjs-rabbitmq` | Nest module over `amqplib` + `amqp-connection-manager`: topic exchanges, routing keys, subscribe handlers | adapter in step 4 |
| `amqplib` | The Node AMQP 0.9.1 client everything above sits on | transitive |
| `@opentelemetry/instrumentation-amqplib` | Patches `amqplib` so publish injects `traceparent` into headers and consume continues the trace | step 6 |
| Testcontainers | Starts real Postgres and RabbitMQ containers for integration tests (`pnpm test:int`, needs Docker) | WP-3 harness, extended |
| CloudEvents 1.0 | CNCF spec for event metadata (`id`, `source`, `type`, `time`, ...) | step 2 |
| AsyncAPI 3 | The OpenAPI equivalent for message channels: a catalog of events | step 7 |
| Drizzle | TypeScript SQL query builder chosen by ADR-005 | WP-10 |

## Facts checked

| Tool | Version on 2026-10-04 | Source | Note |
|---|---|---|---|
| `@golevelup/nestjs-rabbitmq` | 9.1.0 (2026-09-28) | npm registry | peer `@nestjs/core ^11.1.24 \|\| ^12.0.0`; depends on `amqplib ^0.10.9` and `amqp-connection-manager ^5.0.0`; CommonJS. WP-3 spike row 3: go |
| `amqplib` | 2.2.0 (2026-09-28) | npm registry | golevelup still pins the 0.10 line, so we get 0.10.x transitively |
| `amqp-connection-manager` | 5.0.0 (2025-09-29) | npm registry, `dist/cjs/ChannelWrapper.js` | confirm channels on by default; while disconnected it buffers publishes in memory and has no publish timeout unless one is passed |
| `@opentelemetry/instrumentation-amqplib` | 0.69.0 (2026-08-31) | npm registry, `build/src/amqplib.js` | patches `amqplib >=0.5.5 <3`; consume continues the producer's trace by default, `useLinksForConsume` switches to span links |
| `@testcontainers/rabbitmq` | 12.2.0 (2026-09-28) | npm registry | same line as the WP-3 harness |
| `@asyncapi/parser` | 3.6.3 (2026-08-08) | npm registry | validates an AsyncAPI 3 document in a unit test |
| `cloudevents` (SDK) | 10.0.0 (2025-06-10) | npm registry | not needed: the envelope is a 10-line Zod schema |
| `zod` | 4.6.5 (catalog) | ran `z.toJSONSchema` locally | native JSON Schema output, used to put the schemas into AsyncAPI |
| RabbitMQ image | `4.3.6-management-alpine` (2026-09-29) | Docker Hub | already in `compose.dev.yml` |
| RabbitMQ quorum queues | 4.3 docs | rabbitmq-website `docs/quorum-queues` | delivery limit defaults to 20 since 4.0; since 4.3 it counts `basic.reject` and crashes, **not** `basic.nack`; dead-lettering is at-most-once unless `dead-letter-strategy: at-least-once` with `overflow: reject-publish`; queue and per-message TTL supported |
| RabbitMQ confirms | docs `confirms` | rabbitmq-website | an unroutable message is still confirmed (`basic.ack`); only with `mandatory` does the client also get a `basic.return` |
| RabbitMQ delayed message plugin | README | rabbitmq-delayed-message-exchange | its own README warns of "serious limitations", single-node, built on the Mnesia store removed in 4.3 |
| golevelup error behavior | 9.1.0 `lib/amqp/errorBehaviors.js` | package source | default `REQUEUE` calls `channel.nack(msg, false, true)` |
| PostgreSQL `uuidv7()` | 18 | `doc/src/sgml/func.sgml` on `REL_18_STABLE` | time-ordered UUIDs generated in SQL |
| CloudEvents distributed tracing extension | spec main | cloudevents/spec | `traceparent` and `tracestate` as event attributes; "not intended to replace the protocol specific headers" |

## First principles

**Exchanges, bindings, queues (Own).** In RabbitMQ a producer never writes to a queue. It publishes a message to an *exchange* with a *routing key* (a string like `system.ping.v1`). A *binding* is a rule "queue Q wants messages from exchange X whose key matches pattern P". A *topic* exchange matches dotted keys with wildcards: `*` is exactly one word, `#` is zero or more, so `content.#` catches `content.published.v1` and `content.withdrawn.v1`, and `system.ping.*` catches every version of the ping. A *queue* is where messages wait for a consumer; it is the unit of buffering, ordering and acknowledgement. The consequence that shapes everything: the producer does not know who listens. `api` publishes `system.ping.v1` to `jadero.events`; whether zero, one or five queues receive a copy depends only on bindings. That is publish-subscribe, and it is what lets a new consumer appear later (WP-20) without touching `api`. Each consumer gets its own queue (one per consumer and purpose, ADR-029), so two services each receive their own copy; two instances of the *same* consumer reading one queue share the work instead (competing consumers).

**Durable, persistent, quorum (Own).** Three separate things keep a message alive across a broker restart: the queue must be durable, the message must be published as persistent (`delivery_mode: 2`), and the queue type decides how it is stored. A *quorum queue* replicates through Raft and writes to disk before confirming; on one node it is simply a durable, disk-backed queue with extra features we want: a delivery limit against poison messages and at-least-once dead-lettering. A *classic* queue is lighter but has neither. ADR-029 chose quorum queues for every consumer queue.

**Unroutable messages (Own).** If no binding matches, the exchange drops the message, and with publisher confirms on, the broker still answers `basic.ack` (RabbitMQ docs, "When will published messages be confirmed"). So a typo in a routing key, or a consumer queue that does not exist yet, loses events while the relay believes they were delivered. Two defenses: publish with `mandatory: true`, which makes the broker send a `basic.return` before the ack so the relay can tell; or give the exchange an *alternate exchange*, which receives everything nobody else wanted, bound to a queue `jadero.unrouted` that we can watch. The alternate exchange works for every publisher without code; `mandatory` needs return handling in the client.

**Acknowledgements and prefetch (Own).** A consumer gets a delivery and must later say what happened: `ack` (done, delete it), `nack` or `reject` with `requeue=true` (put it back at the head of the queue, usually redelivered at once), or with `requeue=false` (drop it, or dead-letter it if the queue has a dead-letter exchange). Until it answers, the message is *unacknowledged*: invisible to others and redelivered if the consumer's connection dies. *Prefetch* (QoS) caps how many unacknowledged messages one consumer may hold; ADR-029 sets 10. Low prefetch spreads work and limits what is redelivered after a crash; high prefetch hides network latency. The key point for design: the ack is the commit point of the consumer. Ack too early and a crash loses the message; ack after the effects commit and a crash means the message comes again. There is no third option, which is why the next concept exists.

**At-least-once delivery and the idempotent consumer (Own).** Between a consumer committing its database transaction and RabbitMQ receiving the ack there is a gap. If the process dies in that gap, the broker redelivers a message whose effects are already committed. The same happens on the producer side (Trace 1, step 3). So every message may arrive more than once: *at-least-once delivery*. "Exactly once" between a broker and a database is not available; what we can build is *exactly-once effects*: the consumer records the event id in an `inbox` table in the same transaction as its effects, with a unique key. The second delivery's insert hits the key, the consumer knows the work is done, acks and stops. The inbox only works if the insert and the effects share one transaction; an inbox row written in a separate transaction brings the gap back. Some effects are idempotent by nature (an upsert of "revision 7 of project X" that ignores older revisions), and that is a second line of defense, not a replacement: not every handler can be written that way.

**Ordering (Own).** One queue with one consumer and prefetch 1 delivers in order. Retries, prefetch above 1, more consumers, and the relay's batches all break that. We do not promise order. Consumers that care compare a version carried in the event (the content revision in WP-14) and ignore older ones. The ping does not care.

**The dual-write problem and the transactional outbox (Own).** A use case that writes its database and then publishes to the broker does two writes into two systems with no shared transaction. Crash after the commit and before the publish: the state changed and nobody hears about it. Publish first and the commit fails: everyone hears about something that never happened. A try/catch with rollback does not help, because the broker publish cannot be rolled back and the crash may be a killed process (this was the owner's D-12 question). The *transactional outbox* turns two writes into one: the use case inserts the event as a row in an `outbox` table in the same database transaction as the state change. Either both commit or neither does. A separate *relay* later reads the row, publishes it, and marks it sent. The broker leaves the request path entirely: `api` keeps accepting writes while RabbitMQ is down, and the relay catches up (report section 3.5).

**The relay and the atomic claim (Own).** The relay is a loop: find unsent rows, publish each, wait for the broker's *publisher confirm* (the broker's "I have it, on disk"), mark the row sent. Two relays (or two loop iterations that overlap) must not publish the same row at once. `SELECT ... FOR UPDATE SKIP LOCKED` locks the rows it reads and makes a concurrent reader skip them instead of waiting: an atomic claim. The lock lives until the transaction ends, so the relay keeps the transaction open while it publishes the batch, then marks and commits. If it dies after the confirm and before the commit, the rows unlock unmarked and get published again: at-least-once, handled by the inbox. If RabbitMQ is down, the publish never confirms; the relay must give up after a timeout, record the attempt and back off, or it hangs forever (`amqp-connection-manager` has no publish timeout by default, Facts checked). How the relay learns there is work is a choice (Options L): poll on a timer, or let Postgres wake it with `LISTEN/NOTIFY`.

**Retries, dead letters and poison messages (Own).** A handler can fail for two kinds of reasons: *transient* (database blip, provider timeout: try later) and *permanent* (the payload does not parse, a bug: trying again changes nothing). Requeueing at once turns a transient failure into a hot loop that burns CPU and logs; a permanent failure requeued forever is a *poison message* that blocks nothing in theory but floods everything in practice. RabbitMQ's tools: a *dead-letter exchange* (DLX) per queue receives messages that are rejected without requeue, expire by TTL, or exceed the delivery limit; a *TTL* on a queue makes messages expire after a fixed time. Combined, they give delayed retry without any timer in our code: put the message in a "wait 10 s" queue that has no consumer, a TTL of 10 s, and a DLX that sends it back to the work queue. Three such queues give ADR-029's tiers (10 s, 1 min, 10 min); after the last, the message goes to the *dead-letter queue* (DLQ), where a human (WP-50) decides. Two traps verified for RabbitMQ 4.3: (1) the quorum delivery limit of 20 counts `basic.reject` and consumer crashes, but **not** `basic.nack`, and golevelup's default error behavior is `nack` with requeue, so a failing handler on defaults loops forever and the delivery limit never fires; (2) dead-lettering out of a quorum queue is *at-most-once* by default (a message can be lost in transfer), unless the queue sets `dead-letter-strategy: at-least-once` and `overflow: reject-publish`. A third trap, structural: a wait queue that dead-letters back to `jadero.events` with the original routing key re-publishes to *every* bound queue, so one consumer's retry becomes a duplicate for all the others. A retry must return to the one queue that failed (Options R).

**The CloudEvents envelope (Recognize, with one Own part).** CloudEvents 1.0 is a standard set of metadata around an event: `specversion`, `id` (unique per event, our idempotency key), `source` (who emitted it, `jadero/api`), `type` (what happened, `dev.jadero.system.ping.v1`, versioned), `time`, `datacontenttype`, and `data` (the payload). Extensions add attributes; the distributed tracing extension adds `traceparent`. On AMQP there are two *content modes*: *structured* (the whole envelope is the JSON body, content type `application/cloudevents+json`) and *binary* (metadata goes into AMQP headers prefixed `cloudEvents:`, the body is just `data`). The Own part is versioning: a consumer may be older or newer than the producer, so a type's schema only gains optional fields (expand), and a breaking change is a new type `...v2` published next to `v1` until every consumer moved (contract). The routing key is the type without the reverse-DNS prefix: `system.ping.v1`. Schemas live in `packages/contracts` as Zod, and a contract test has every consumer parse the producer's example fixture.

**One trace across an asynchronous hop (Own).** A trace is a tree of spans joined by a trace id; context crosses a process boundary in the W3C `traceparent` string (`00-<trace id>-<parent span id>-<flags>`). Over HTTP the OTel instrumentation puts it in a header. Over RabbitMQ, `instrumentation-amqplib` injects it into the message headers at publish and continues the trace at consume. The outbox breaks this chain unless we act: the relay publishes seconds later, from another process (`api-worker`), inside its own poll loop, so the context active at publish time is the relay's, not the request's. ADR-010 says the outbox row stores the request's `traceparent`; the relay must make that the active context (as parent or as a link) before it publishes, and then the amqplib instrumentation carries it on. A second consideration is privacy: spans and log lines carry ids and types, never the event body.

**Ports and adapters for a broker (Own).** ADR-003's rule: the application depends on an abstract class (the port), and an adapter in `infrastructure/` implements it. For messaging the port answers "publish this envelope" and "deliver envelopes of this type to this handler", and the handler returns an outcome (done, retry later, dead) instead of calling `ack` itself. What this buys: use cases and handlers are tested with the in-memory adapter, no broker; a contract suite proves the in-memory and RabbitMQ adapters behave alike; the retry and dead-letter policy lives in one adapter, not in every handler. What it costs: one more layer, and some broker features (headers, priorities) stay out unless the port names them. The owner's D-41 doubt ("an adapter would allow swapping RabbitMQ; unsure it is worth it beyond learning") is fair: the main payoff is testability and one place for the failure policy, not swapping brokers.

**Process types (Own).** One codebase and one image per service, started with different commands (report section 3.2). `api` serves HTTP; `api-worker` runs the relay (and later the PDF CV and revalidation). Background work gets its own process, memory limit and restart policy, so a stuck relay cannot slow a request, and an HTTP crash does not stop event delivery. It is not a new service: same database, same code, same deploy. The same applies to `agent` (HTTP chat) and `agent-ingest` (event consumer, WP-20).

**Readiness with a broker (Own).** From WP-3: liveness asks "restart me?", readiness asks "send me work?". Thanks to the outbox, `api` does not need the broker to do its job, so the broker does not belong in `api`'s readiness (if it did, a broker outage would take the site's API out of rotation for no reason). `api-worker` cannot do its job without both Postgres and RabbitMQ, so its readiness checks both. A consumer process likewise. A process with no HTTP server still needs a way to answer the probe (a small health server on its own port is the simplest).

## One concrete trace

The trace uses the shapes the questions propose as defaults; where an answer changes a step, the step says so. Values are realistic and consistent: trace id `4bf92f3577b34da6a3ce929d0e0e4736`, event id `0199b1c4-7e2a-7c3d-9f10-3a5b7c9d1e2f` (a UUIDv7: the first 48 bits are the time).

### Trace 1: a ping crosses the broker, and arrives twice

1. **Trigger** (depends on Q8). `curl -X POST http://127.0.0.1:3001/dev/ping` on `api` in development. The HTTP instrumentation opens span `POST /dev/ping`, span id `00f067aa0ba902b7`.
2. **Outbox write.** The `SendPing` use case builds the envelope with `traceparent` = the current context and inserts it in one transaction (here the ping changes no other state; in WP-14 the content update joins the same transaction):

   ```sql
   BEGIN;
   INSERT INTO messaging.outbox (id, type, routing_key, envelope, created_at)
   VALUES ('0199b1c4-7e2a-7c3d-9f10-3a5b7c9d1e2f', 'dev.jadero.system.ping.v1', 'system.ping.v1', $1, now());
   COMMIT;
   ```

   with `$1`:

   ```json
   {"specversion":"1.0","id":"0199b1c4-7e2a-7c3d-9f10-3a5b7c9d1e2f","source":"jadero/api","type":"dev.jadero.system.ping.v1","time":"2026-10-04T10:15:02.114Z","datacontenttype":"application/json","traceparent":"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01","data":{"trigger":"manual"}}
   ```

   `api` answers `202 {"eventId":"0199b1c4-..."}` in about 5 ms. RabbitMQ has not been touched. The `pg` instrumentation adds an `INSERT` span under `POST /dev/ping`.
3. **Relay** in `api-worker` (depends on Q5; here: poll every 1 s, batch 50):

   ```sql
   BEGIN;
   SELECT id, routing_key, envelope FROM messaging.outbox
    WHERE published_at IS NULL AND next_attempt_at <= now()
    ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED;
   -- for each row: restore the stored traceparent as context, publish, await confirm (timeout 5 s)
   UPDATE messaging.outbox SET published_at = now() WHERE id = ANY($1);
   COMMIT;
   ```

   The publish: exchange `jadero.events`, routing key `system.ping.v1`, properties `content_type: application/cloudevents+json`, `message_id: 0199b1c4-...`, `delivery_mode: 2`, header `traceparent: 00-4bf9...4736-<publish span id>-01` (injected by `instrumentation-amqplib` because the stored context was made active, Q7). The broker confirms once the quorum queue has written the message.
4. **Routing.** `jadero.events` (topic) matches the binding `system.ping.*` of queue `agent.system.ping` (quorum, DLX `jadero.dlx`, `dead-letter-strategy: at-least-once`, `overflow: reject-publish`). Had nothing matched, the alternate exchange would put it in `jadero.unrouted` (Q2).
5. **Consume** in `agent`'s consumer process (prefetch 10). `instrumentation-amqplib` reads `traceparent` and opens span `agent.system.ping process` in the same trace. The adapter parses the body with `cloudEventEnvelope` and then `systemPingV1Data` from `@jadero/contracts`. The handler runs in one transaction:

   ```sql
   BEGIN;
   INSERT INTO messaging.inbox (consumer, event_id, type, received_at)
   VALUES ('agent.system.ping', '0199b1c4-7e2a-7c3d-9f10-3a5b7c9d1e2f', 'dev.jadero.system.ping.v1', now())
   ON CONFLICT DO NOTHING RETURNING event_id;   -- 1 row: first time
   INSERT INTO broker_heartbeat (source, last_event_id, last_seen_at) VALUES ('jadero/api', $1, now())
   ON CONFLICT (source) DO UPDATE SET last_event_id = EXCLUDED.last_event_id, last_seen_at = EXCLUDED.last_seen_at;
   COMMIT;
   ```

   Then the adapter acks. Log line (no body): `{"level":30,"service":"agent","msg":"event handled","consumer":"agent.system.ping","type":"dev.jadero.system.ping.v1","event_id":"0199b1c4-...","attempt":1,"duration_ms":6,"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"}`.
6. **What the trace shows** (console exporter in dev): `POST /dev/ping` (api) > `INSERT messaging.outbox` (api) > `system.ping.v1 publish` (api-worker) > `agent.system.ping process` (agent) > two `INSERT` spans (agent). One trace id across three processes, with a gap of up to 1 s (the poll) between the insert and the publish, which is the outbox's latency made visible.
7. **The same event again.** Suppose `api-worker` was killed after the confirm and before `COMMIT`. The row unlocks with `published_at` still null, the next tick publishes it again with the same `id`. In `agent` the inbox insert returns **0 rows**: the handler skips the effects, commits, acks, and logs at `debug` `"duplicate ignored"`. The heartbeat row is unchanged. This is at-least-once delivery with exactly-once effects.

### Trace 2: the consumer fails, and the broker goes away

**The consumer's database is down.**

1. `agent`'s Postgres stops. A ping arrives; the inbox `INSERT` fails with `ECONNREFUSED 127.0.0.1:5432`. The transaction never started, nothing was written.
2. The handler throws; the adapter classifies it as transient (any error that is not a schema failure) and, with Q3's default, publishes a copy to queue `agent.system.ping.retry.10s` through the default exchange with header `x-jadero-attempt: 2`, waits for the confirm, then acks the original. Log at `warn`: `"event retry scheduled"`, `attempt: 1`, `delay_ms: 10000`, the error class and message, no body.
3. `agent.system.ping.retry.10s` has no consumer, `x-message-ttl: 10000`, and dead-letters to the default exchange with routing key `agent.system.ping`. After 10 s the message is back in the work queue, and only there: the other queues bound to `jadero.events` never see it.
4. Attempt 2 fails: the copy goes to `.retry.1m`. Attempt 3 fails: `.retry.10m`. Total waiting before attempt 4: 10 s + 60 s + 600 s = 11 min 10 s.
5. Attempt 4 fails: the adapter `reject`s without requeue; the queue's DLX `jadero.dlx` routes it to `agent.system.ping.dlq`. Log at `error`. From WP-26 an alert fires on a non-empty DLQ; from WP-50 the message is archived to a `dead_letters` table and can be replayed.
6. A payload that does not parse (a producer bug) skips the tiers: retrying cannot fix it, so it goes straight to the DLQ on attempt 1.
7. The counterexample, what the defaults would do: golevelup's `REQUEUE` behavior calls `nack(requeue=true)`; the message returns to the head of the queue and is redelivered within milliseconds, thousands of times a minute, and on RabbitMQ 4.3 a `nack` does not count toward the delivery limit of 20, so nothing stops it.

**The broker is down.**

1. `docker compose stop rabbitmq`. `api` still answers `POST /dev/ping` with 202: the outbox insert does not need the broker. `api`'s `/health/ready` stays 200.
2. The relay claims the row, publishes; `amqp-connection-manager` buffers it in memory and the confirm never comes. After 5 s the relay's timeout fires, it records `attempts = attempts + 1`, `last_error = 'publish timeout'`, `next_attempt_at = now() + backoff` (1 s, 2 s, 4 s, capped at 60 s), commits, and logs at `warn`. `api-worker`'s `/health/ready` turns 503 with `{"broker":{"status":"down","message":"unavailable"}}`.
3. Rows pile up in `messaging.outbox` (`SELECT count(*) FROM messaging.outbox WHERE published_at IS NULL` shows them). Nothing is lost.
4. `docker compose start rabbitmq`. The connection manager reconnects. The buffered publish from step 2 may now be confirmed as well; the row is claimed again on the next tick and published a second time. The consumer's inbox absorbs the duplicate. Readiness returns to 200.

## Patterns

| Pattern | Where it appears |
|---|---|
| Publish-subscribe, topic routing | Trace 1, step 4: `jadero.events`, binding `system.ping.*` |
| Competing consumers | Two `agent` consumer instances reading `agent.system.ping` (not in WP-5, possible later) |
| Transactional outbox | Trace 1, step 2 |
| Message relay, publisher confirms | Trace 1, step 3 |
| Atomic claim (`FOR UPDATE SKIP LOCKED`) | Trace 1, step 3 |
| At-least-once delivery | Trace 1, step 7; Trace 2 "broker down", step 4 |
| Idempotent consumer (inbox) | Trace 1, steps 5 and 7 |
| Retry with backoff (delayed retry via TTL and DLX) | Trace 2, steps 2 to 4; the relay's backoff in "broker down", step 2 |
| Dead-letter queue, poison message | Trace 2, steps 5 to 7 |
| Alternate exchange | Trace 1, step 4 |
| Event envelope (CloudEvents), versioned event types, expand/contract | Trace 1, step 2 |
| Trace context propagation | Trace 1, steps 3, 5, 6 |
| Ports and adapters, contract test suite | The `MessageBus` port, in-memory and RabbitMQ adapters (Options P) |
| Process types | `api` and `api-worker`, `agent` HTTP and its consumer (Options W) |
| Infrastructure as code | `infra/rabbitmq/definitions.json` (Options T) |
| Synthetic heartbeat | The ping as a periodic end-to-end check (Options W) |

## Options and trade-offs

**P. Shape of the `MessageBus` port (ADR-029 decides: golevelup behind our port, an in-memory adapter for unit tests).**

Forces: handlers should be testable without a broker; the retry and dead-letter policy should live in one place; the port should not grow a copy of the whole AMQP API; less code is less to maintain.

- *P1. Thin port with outcome-returning handlers.* `MessageBus.publish(envelope)` and `MessageBus.subscribe(consumer, handler)`, where the handler receives a parsed envelope and returns `done`, `retry` or `dead` (a thrown error counts as `retry`, a schema failure as `dead`). The adapter owns ack, nack, retry routing and logging. Matches the ADR. Pros: handlers know nothing about AMQP; one contract suite runs against both adapters; the retry policy is written once. Cons: more code in `packages/messaging` (a registry of subscriptions, the outcome mapping); golevelup's decorators are not used. Wins when several services consume, which is the plan (agent, api-worker, contact).
- *P2. Port for publishing only; consumers use golevelup's `@RabbitSubscribe` directly in `presentation/`.* Pros: least code, golevelup's documented path. Cons: every handler chooses its own error behavior (and the default is the hot loop, Trace 2 step 7); unit tests of handlers need a fake for golevelup's types; the in-memory adapter covers half the story. Partly departs from the ADR's "behind our port" for consumers. Wins for a single consumer that will never grow.
- *P3. Nest microservices transport (`@EventPattern` with `Transport.RMQ`)* (not recommended). Pros: built into Nest. Cons: only the default exchange and a fixed `pattern`/`data` body, so no topic exchange and no CloudEvents (ADR-029 rejects it explicitly). Would need a superseding ADR. Wins only for request-reply between Nest apps, which this project forbids between services.
- *P4. Thin port (as P1) over our own `amqplib` adapter, no golevelup.* Pros: full control (timeouts, `reject` vs `nack`, startup that does not block); one less dependency, and golevelup pins the old `amqplib` 0.10 line. Cons: reconnection, channel recovery and confirm tracking become our code, about 200 lines that golevelup and `amqp-connection-manager` already handle. ADR-029 names it as the fallback, so choosing it now means a superseding ADR. Wins if golevelup's blocking `init` or its error handling fights the port.

What would make this wrong: if handlers keep needing AMQP details the port does not expose (priorities, per-message TTL, headers beyond trace context), the port is in the way; if only one consumer ever exists, P1's extra code is waste.

**T. Who declares exchanges, queues and bindings (ADR-029 decides: `infra/rabbitmq/definitions.json` is the reviewed source of truth; vhosts `/prod` and `/staging`, one user per service and vhost, each allowed only its own queues).**

Forces: one reviewed place for the topology; least privilege (a service user that can *configure* can also delete or redeclare); a mismatch between what code asserts and what exists breaks the channel (`PRECONDITION_FAILED` when arguments differ); developers want `pnpm dev:up` to just work; definitions with real passwords are a secret.

- *T1. `definitions.json` only.* The broker loads it at boot (`load_definitions`); services get `read` and `write` but no `configure` permission, and use `checkQueue` / `checkExchange` (golevelup's `createQueueIfNotExists: false`), so a missing queue fails readiness loudly. Matches the ADR. Pros: one source of truth, least privilege, drift is impossible because code cannot create anything. Cons: adding a consumer touches two files (code and definitions); the in-compose file holds dev users with fixed dev passwords, and staging and production need their users created at deploy with real secrets (WP-8, WP-9), so the committed file is topology plus dev users only.
- *T2. Code declares its own topology at startup (golevelup's default `assert*`).* `definitions.json` only for vhosts and users. Pros: one file per change, the queue is declared next to its handler. Cons: services need `configure`; the topology is spread across services and only visible at run time; two services asserting the same exchange with different arguments break each other at boot. Departs from the ADR (superseding ADR). Wins in a team where each service owns its broker setup and there is no central review.
- *T3. Both: `definitions.json` plus code asserting the same objects* (not recommended). Pros: works even if definitions were not loaded. Cons: two sources of truth that must match argument for argument, and a mismatch is a channel error at boot; still needs `configure`. Wins nowhere this project can see.
- *T4. Generate `definitions.json` from a TypeScript topology module* (one source in code, a script writes the JSON, a test fails when they differ). Pros: typed, reusable by the adapter (it knows queue names and tiers) and by the AsyncAPI stub. Cons: a generator to maintain. Compatible with the ADR (the JSON is still the reviewed artifact).

Also in T, with a clear default: an alternate exchange `jadero.unrouted` on `jadero.events`, with a queue of the same name, so an unroutable event is kept and visible instead of confirmed and dropped.

What would make this wrong: frequent topology changes that make the two-file edit painful (T4 then pays off); or a broker you do not control (a managed service that forbids definitions import).

**R. How a failed message reaches the right retry tier (ADR-029 decides: TTL retry queues of 10 s, 1 min and 10 min, then a DLQ per queue; ADR-012: every queue has a DLQ).**

Forces: a retry must go back only to the queue that failed (Trace 2, step 3); the tier must grow with the attempt; no message may be lost between queues; no hot loop; the topology should stay readable.

- *R1. Consumer-routed: the adapter publishes a copy to the right wait queue and acks the original.* Per consumer queue Q: `Q.retry.10s`, `Q.retry.1m`, `Q.retry.10m` (no consumers, `x-message-ttl`, DLX = default exchange with `x-dead-letter-routing-key: Q`), and `Q.dlq`. The adapter reads an attempt header, picks the tier, publishes with confirm, then acks. After the last tier it `reject`s without requeue into `jadero.dlx`, which routes to `Q.dlq`. Matches the ADR. Pros: exact tiers; retries never fan out; the attempt count is ours and visible. Cons: four extra queues per consumer (generated, T4 helps); a crash between the copy's confirm and the ack gives a duplicate, which the inbox absorbs.
- *R2. Broker-routed with dead-letter chains only (`reject` without requeue, DLX into a 10 s queue, back to Q).* Pros: no publish from the consumer. Cons: a DLX is fixed per queue, so the broker cannot pick a longer delay for a later attempt; you get one fixed delay unless you build a chain of queues per attempt; at-least-once dead-lettering needs the quorum settings above. Wins when one fixed delay is enough, which departs from the ADR's three tiers (superseding ADR).
- *R3. In-process retry first (a few quick attempts with backoff inside the handler, holding the message unacked), then R1.* Pros: a blip of 200 ms is absorbed without any broker round trip. Cons: holds a prefetch slot, so 10 slow retries stall the consumer; a crash during the wait redelivers anyway. Compatible with the ADR as an addition.
- *R4. The delayed message exchange plugin* (not recommended). Pros: one exchange, per-message delay. Cons: its own README warns of serious limitations, single node, built on the metadata store removed in RabbitMQ 4.3. Wins nowhere on 4.3.

What would make this wrong: if most failures turn out to be permanent (bugs), tiers only delay the DLQ by 11 minutes; if a consumer needs strict order, any retry that lets later messages pass breaks it.

**S. Where the outbox and inbox live before WP-10 brings Drizzle (ADR-012: outbox in each producer's database, inbox in each consumer's database, same transaction as the effects; ADR-005: Drizzle, repositories wrap it; WP-3 decision D1: `pg` is the driver).**

Forces: the outbox insert must join the caller's transaction, so the store has to accept a transaction handle from outside; `packages/messaging` must not depend on Drizzle or on any service's schema; WP-10 will add Drizzle and must not need to rewrite messaging; DDL must reach each service's database.

- *S1. A store port in `packages/messaging` over a minimal `SqlExecutor` (`query(text, values)`), implemented now with `pg`; SQL migration files shipped by the package.* `OutboxStore.add(tx, envelope)` and `InboxStore.tryRecord(tx, consumer, eventId)` take the caller's executor; a `pg.PoolClient` already fits `SqlExecutor`, and in WP-10 a three-line adapter wraps Drizzle's transaction. The tables live in a `messaging` schema in each service database; `packages/messaging/sql/0001_messaging.sql` is applied by a small migrate script per service until drizzle-kit adopts it as a custom migration (**verify** at WP-10). Within the ADRs. Pros: the SQL is visible (the claim query is the lesson), no Drizzle in a shared package, WP-10 adds rather than rewrites. Cons: a temporary migrate script; raw SQL in one package.
- *S2. Pull Drizzle forward into WP-5* (the schema for outbox and inbox in Drizzle, drizzle-kit migrations). Pros: one data layer from day one. Cons: WP-10's decisions (schema layout, migration flow, repository shape) would be made inside a messaging WP without their explainer; `packages/messaging` would depend on Drizzle. Within ADR-005, but changes WP order.
- *S3. In-memory outbox and inbox only in WP-5; Postgres versions in WP-10 or WP-14* (not recommended). Pros: smallest WP-5. Cons: the deliverable says "outbox relay, inbox" and ADR-009 wants the outbox claim tested under concurrency against real Postgres; the ping would prove nothing about the dual-write problem. Wins only if WP-10 had to come first anyway.
- *S4. The outbox store owned by each service* (each app writes its own outbox SQL; the package ships only the relay loop). Pros: each service controls its tables. Cons: three copies of the same claim query to keep in sync. Wins if services' needs diverged, which nothing suggests.

What would make this wrong: if WP-10 picks a different driver than `pg` (it inherits D1, so unlikely), or if Drizzle's transaction object cannot expose a raw query (then the adapter in WP-10 is more than three lines).

**L. How the relay finds work and claims it (ADR-012 decides: claim with `FOR UPDATE SKIP LOCKED`, publish with confirms, mark sent; `api-worker` relays for `api`).**

Forces: latency between commit and publish; load on Postgres when idle; behavior under a broker outage; simplicity.

- *L1. Poll every 1 s, batch 50, transaction held during the publish.* Pros: simplest, correct, the latency (up to 1 s) is invisible at this site's volume (a few events a day plus the ping). Cons: one cheap query per second per relay while idle (an index on unsent rows keeps it to microseconds).
- *L2. `LISTEN/NOTIFY` to wake the relay, plus a slow poll (every 30 s) as a safety net.* The insert path runs `NOTIFY messaging_outbox` (or a trigger does). Pros: latency in milliseconds, almost no idle load. Cons: notifications are lost while the relay is disconnected (hence the safety poll anyway); a dedicated connection that holds `LISTEN`; more moving parts. Wins when latency matters (a chat feature waiting on an event), which nothing here needs.
- *L3. Lease instead of a held lock: `UPDATE ... SET claimed_until = now() + interval '30 s' ... RETURNING`, commit, publish outside any transaction, then mark.* Pros: no transaction open during network I/O; works with many relays and slow publishes. Cons: one more column and a lease expiry to reason about. Wins with high volume or slow brokers.
- *L4. Change data capture (Debezium reading the write-ahead log)* (not recommended). Pros: no polling, no relay code. Cons: a JVM service and Kafka Connect or similar, far beyond one CX33; another component to fail. Wins in a large platform with many producers.

Also in L, with clear defaults: publish timeout 5 s; backoff per row 1 s doubling to 60 s; sent rows deleted by a daily cleanup after 7 days (ADR-012: outbox cleanup in each relay).

What would make this wrong: if a future feature needs sub-second propagation (L2), or volume grows to thousands of events a minute (L3).

**I. The inbox key and how long it remembers (ADR-012 decides: an `inbox` table of processed event ids in the consumer's transaction).**

Forces: one service may have several consumers of the same event (e.g. in `agent`, ingestion and a usage counter); a duplicate can arrive late (a replay from the DLQ days later, WP-50); the table must not grow forever.

- *I1. Primary key `(consumer, event_id)`.* Each consumer records its own processing. Pros: two consumers in one database are independent; the row says who processed what. Cons: one row per consumer per event.
- *I2. Primary key `event_id` only.* Pros: smallest. Cons: the second consumer in the same database sees the first one's row and skips its work, silently. Wins only with exactly one consumer per database forever.
- *I3. No inbox; every handler is naturally idempotent* (not recommended). Pros: no table. Cons: every handler author must get idempotency right; "send a notification mail" (WP-11) is not naturally idempotent. Departs from ADR-012 (superseding ADR).

Retention, with a clear default: keep inbox rows 30 days, deleted by a daily cleanup; a replay older than that is a human decision in WP-50 anyway. What would make this wrong: a replay policy that resends events older than the retention window as routine.

**E. Envelope details and the trace across the outbox (ADR-029 decides: CloudEvents 1.0 with `id`, `source`, versioned `type`, `time`, `traceparent`; ADR-010 decides: `traceparent` in RabbitMQ headers through `instrumentation-amqplib`, and the outbox stores the request's `traceparent`).**

Forces: the id must be unique and cheap to index; consumers should parse one shape; the trace should be one tree in the backend; OTel's messaging conventions prefer links for batches.

- *E1. Structured mode (envelope as the JSON body), UUIDv7 ids, the relay restores the stored `traceparent` as the parent context before publishing.* The trace is one tree from the HTTP request to the consumer (Trace 1, step 6). Pros: the outbox row is exactly the message (what you see in the table is what goes on the wire, and what WP-50 replays); UUIDv7 indexes well and sorts by time; one tree is easy to read. Cons: the relay's own work (the poll) is not in that tree; a batch of 50 rows produces 50 publish spans each under a different trace, which is correct but means the relay has no single span for its batch.
- *E2. Same, but with a span link instead of a parent* (the relay's batch span links to each stored context; consumer spans link to the producer with `useLinksForConsume`). Pros: follows the OTel messaging conventions to the letter; the relay batch is one span. Cons: most backends show linked traces as separate traces you click between; "one trace" from the deliverable becomes "linked traces". Wins when a batch carries many events from different requests and you care about the relay's own timing.
- *E3. Binary mode (CloudEvents attributes as `cloudEvents:*` AMQP headers, body = `data` only).* Pros: brokers and tools can route or filter on headers without parsing JSON. Cons: two places to read an event; the outbox row and the wire message differ. Wins with header-based routing, which topic keys already cover.
- *E4. No context restore; the event id in logs joins the two halves* (not recommended). Pros: no code. Cons: two unrelated traces per event; contradicts ADR-010's "a trace runs browser to `agent-ingest` without gaps".

Id generation, with a clear default: UUIDv7 created in code, because the envelope must hold its id before the insert (the `uuid` package, 14.0.2). Postgres 18's `uuidv7()` would only fit if the database generated the id, and `crypto.randomUUID()` gives v4, which indexes worse because it is random. What would make this wrong: many events per request (batches) make E2 more honest than E1.

**W. Process types, readiness and how the ping is triggered (report 3.2 decides: `api` and `api-worker` process types; ADR-012: `api-worker` relays; WP-3 forward question: the broker in `api-worker`'s readiness, not `api`'s).**

Forces: the deliverable needs `api` to `agent` with one trace; the skeleton should be the shape WP-11, WP-14 and WP-20 extend, not a shortcut they undo; the ping trigger must not become a public endpoint; a heartbeat would be useful later (the "Under the hood" page shows broker lag).

- *W1. Create the process types now: `apps/api/src/worker.ts` (`api-worker`: relay) and `apps/agent` with two entries, `main.ts` (HTTP, health) and `consumer.ts` (the ping consumer; becomes `agent-ingest` in WP-20); each worker has a small health server on its own port. Readiness: `api` = Postgres; `api-worker` = Postgres + broker; `agent` HTTP = Postgres; `agent` consumer = Postgres + broker.* Matches report 3.2 and ADR-012. Pros: the real shape from day one; failure isolation is demonstrable (stop `api-worker`, `api` keeps answering). Cons: four processes to run in dev (`pnpm dev` starts them all).
- *W2. Relay and consumer in-process for now (inside `api` and `agent`), split later.* Pros: two processes in dev. Cons: the broker joins `api`'s readiness or is silently unchecked; WP-14 has to move code. Departs from the process-type shape for a while, not from an ADR.
- *W3. A separate `worker` app that relays for every service* (not recommended). Pros: one process. Cons: it touches every service's database, which is the distributed monolith ADR-029 warns about. Departs from ADR-029.

The trigger, three options: (a) a heartbeat every 5 minutes from `api-worker` (writes the outbox row itself; `agent` records `last_seen_at`, a future lag signal for WP-26 and the Under the hood page); (b) `POST /dev/ping` on `api`, registered only when `NODE_ENV=development`; (c) both. A public trigger is out: anyone could fill the queues.

What would make this wrong: memory on the CX33 (each Node process is about 60 to 100 MB); if four processes do not fit with everything else, W2 for `agent` until WP-20 is the fallback.

**Defaults that need no question** (say so if you want one changed): the AsyncAPI 3 stub is written by hand in `packages/contracts/asyncapi.yaml` with payload schemas generated from Zod (`z.toJSONSchema`) and a unit test that parses it with `@asyncapi/parser` and checks every Zod event type appears (the CI check of ADR-029 runs this test in WP-6); `packages/contracts` and `packages/messaging` are compiled packages (like `platform-nest`), Nest a peer dependency of `messaging` only; `agent` on port 3002; the outbox and inbox tables in a `messaging` schema; the D-43 doubt (a separate "toolbox" repository publishing versioned packages): in one monorepo the workspace packages are that toolbox, without publishing; a separate repo would pay off only if another repository needed the contracts.

## The question for the owner

Answer each with a letter (or "your call") and one risk of your pick; you may propose an option not listed. Recommendations are in the next block: read them after answering.

1. **Port shape (P):** P1 thin port with outcome-returning handlers, P2 publish-only port with golevelup decorators, P3 Nest microservices, or P4 thin port over our own `amqplib` adapter? Depending on the answer, the retry policy lives in one adapter (P1, P4) or in every handler (P2).
2. **Topology ownership (T):** T1 `definitions.json` only, T2 code declares, T3 both, or T4 a TypeScript topology that generates `definitions.json`? This decides whether services get `configure` permission and how many files a new consumer touches.
3. **Retry routing (R):** R1 consumer-routed copies to per-queue wait queues, R2 DLX chains only, R3 in-process retries first then R1, or R4 the delayed message plugin? This decides how many queues each consumer has and whether a retry can ever reach another consumer.
4. **Outbox and inbox storage before WP-10 (S):** S1 store port over `SqlExecutor` with `pg` now, S2 Drizzle now, S3 in-memory only, or S4 per-service stores? This decides whether WP-10 adds to messaging or rewrites it.
5. **Relay trigger and claim (L):** L1 poll 1 s with the lock held during publish, L2 `LISTEN/NOTIFY` plus a safety poll, L3 lease, or L4 CDC? This decides latency and how the relay behaves with several instances.
6. **Inbox key (I):** I1 `(consumer, event_id)`, I2 `event_id`, or I3 no inbox? This decides whether two consumers in one database can process the same event independently.
7. **Envelope and trace (E):** E1 structured + parent context restored, E2 links, E3 binary mode, or E4 no restore? This decides whether the backend shows one tree or linked traces.
8. **Process types and the ping (W):** W1, W2 or W3; and the trigger (a) heartbeat, (b) dev-only endpoint, or (c) both? This decides how many processes `pnpm dev` runs and whether the ping keeps working after WP-5 as a health signal.

Also say which steps you already know (D-38 fast path); step 2 (contracts) is the candidate.

### Recommendations

Read after answering.

1. **P1.** Several consumers are coming (agent, api-worker, contact), and the hot-loop default (Trace 2, step 7) is exactly the kind of mistake one adapter should prevent once. P4 stays the named fallback if golevelup's blocking `init` gets in the way during step 4.
2. **T4**, a close second T1. One typed topology that the adapter reads (queue names, tiers) and a test that keeps `definitions.json` in sync; services without `configure`, with `check*` at startup. If you pick T1, the adapter keeps its own list of names and tiers, and a test compares them with the JSON instead. Either way: the alternate exchange.
3. **R1.** It is the only option that gives the ADR's three tiers without fan-out; R3's in-process retry can be added later for latency-sensitive handlers without changing R1. If P2 was your answer to question 1, R1 means every handler must call the same retry helper, which is the argument for P1.
4. **S1.** The SQL of the claim is the lesson, WP-10's decisions stay in WP-10, and the `SqlExecutor` seam is what lets Drizzle join without a rewrite.
5. **L1**, with the 5 s publish timeout and per-row backoff. One relay, a handful of events a day: L2 and L3 solve problems this site does not have, and switching from L1 to L3 later touches one file.
6. **I1** with 30 days of retention. I2's failure is silent, the worst kind.
7. **E1**: the deliverable asks for one trace, and one event per request is the common case here. If batches with many requests per relay span ever matter, E2 is a change inside the relay only.
8. **W1 with (c)**: the heartbeat every 5 minutes keeps proving the whole path in staging and production after WP-5 and feeds WP-26; the dev endpoint gives an instant trace for the demo. If memory turns out tight at WP-8, fold `agent`'s consumer into its HTTP process until WP-20.

## Proposed steps

Each step ends with a green `pnpm verify` and one scoped commit, and two lines in the step log. Steps that need Docker list the exact commands for the owner to run locally.

1. *Explainer and decision* (learning): this file; `decision: recorded`; an ADR only if an answer departs from an accepted ADR (P2 partly, P3, P4, T2, T3, R2, I3, E4, W3 would).
2. *Contracts* (learning; candidate for `known`): `packages/contracts` (compiled): `cloudEventEnvelope`, `systemPingV1` with `type` and routing key, example fixture, a contract test that parses the fixture; the AsyncAPI stub and its parser test.
3. *Port, in-memory adapter, contract suite* (learning): `packages/messaging`: `MessageBus` abstract class, handler outcomes, `InMemoryMessageBus`, a reusable contract suite (publish routes by key, retry outcome redelivers, dead outcome lands in the DLQ, unknown keys go to unrouted).
4. *RabbitMQ adapter and topology* (learning): the golevelup adapter passing the same suite, confirms, prefetch 10, the retry tiers per Q3, the topology per Q2 (`infra/rabbitmq/definitions.json`, vhosts, dev users, alternate exchange) loaded by `compose.dev.yml`; integration tests with `@testcontainers/rabbitmq` (Docker: owner runs `pnpm test:int`).
   - Mid-WP `@agent-reviewer` on the branch.
5. *Outbox, relay, inbox* (learning): the store per Q4, the SQL migration, the relay per Q5 with timeout and backoff, the inbox per Q6, cleanup jobs; integration tests: claim under concurrency (two relays, no row published twice by the same claim), the duplicate absorbed by the inbox, broker down then back (Docker).
6. *`api-worker`, `agent` skeleton, one trace* (learning): `apps/agent` from the template (config, logging, health, its database), the process types per Q8, the ping trigger, `instrumentation-amqplib` in `platform-nest`'s SDK, context restore in the relay per Q7; `pnpm dev` runs all processes; the demo: one trace id from `POST /dev/ping` to the consumer's insert (Docker: owner runs `pnpm dev:up` and `pnpm dev`, pastes the console spans).
7. *Docs and map*: `docs/architecture/code-map.html` (new packages, `agent`, `api-worker`, the injections and the event path), `AGENTS.md` (status, commands), `apps/agent/AGENTS.md`, `infra/compose/README.md`, `.claude/rules/` messaging rule if needed; republish the code map artifact.

## Decision

<!-- Filled with the owner's answers. -->

## Step log

## Recap

<!-- Interview form: why, alternatives, when to change, failure; the main trace drawn from memory. -->

## Delegated details

Reference only, never asked.

- golevelup: `RabbitMQModule.forRootAsync({ uri, exchanges, channels: { default: { prefetchCount: 10 } }, connectionInitOptions: { wait: false }, defaultSubscribeErrorBehavior })`; `createQueueIfNotExists: false` and `createExchangeIfNotExists: false` switch `assert*` to `check*`. The spike found that `app.init()` blocks while the broker is down even with `wait: false` (WP-3 step log); step 4 checks it again and decides between a workaround and P4.
- `amqp-connection-manager` `ChannelWrapper`: `confirm: true` by default, `publishTimeout` undefined by default (pass one), buffers publishes in memory while disconnected.
- AMQP properties used: `content_type`, `message_id` (= CloudEvents `id`), `delivery_mode: 2`, `headers.traceparent`, our `headers["x-jadero-attempt"]`. Quorum queue arguments: `x-queue-type: quorum`, `x-dead-letter-exchange`, `x-dead-letter-routing-key`, `x-dead-letter-strategy: at-least-once`, `x-overflow: reject-publish`, `x-message-ttl` on wait queues. RabbitMQ 4.3 headers on redelivery: `x-delivery-count`, `x-acquired-count`.
- `definitions.json` is loaded with `load_definitions = /etc/rabbitmq/definitions.json` in `rabbitmq.conf` (mounted in compose); passwords in it are `password_hash` values, dev only.
- `instrumentation-amqplib` options: `publishHook`, `consumeHook`, `useLinksForConsume` (default false).
- Postgres: `FOR UPDATE SKIP LOCKED` needs `READ COMMITTED` (the default); the partial index `CREATE INDEX ON messaging.outbox (next_attempt_at) WHERE published_at IS NULL` keeps the poll cheap; `uuidv7()` exists in Postgres 18.
- Zod 4: `z.toJSONSchema(schema)` emits draft 2020-12 JSON Schema, which AsyncAPI 3 accepts as a payload schema format.
