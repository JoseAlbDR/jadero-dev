# apps/agent

The knowledge, chat, guards and usage service (ADR-001). Today (WP-5) it is the skeleton: the same boot as `api` (fail-fast config, logs, problem details, health, OpenTelemetry from `@jadero/platform-nest`) with its own database, `agent_dev`, and a consumer process that applies `system.ping.v1` through the inbox. Retrieval and ingestion arrive in WP-20 and WP-21, the chat in WP-22.

## Run it

```sh
pnpm dev:up                                  # from the repo root: Postgres and RabbitMQ
cp apps/agent/.env.example apps/agent/.env   # once; dev values only
pnpm --filter @jadero/agent migrate          # once: messaging schema (inbox) and broker_heartbeat
pnpm dev                                     # from the root: the HTTP process and the consumer
```

Two process types from one codebase (report section 3.2):

- `dist/main.js` (`start`): HTTP on port 3002; `/health/ready` checks `agent_dev` only.
- `dist/consumer.js` (`start:consumer`, `dev:worker`): port 3012 for health only; ready when Postgres and RabbitMQ answer. It becomes `agent-ingest` in WP-20.

## Layout

- `src/config/agent-config.ts`: `agentEnv`, `agentConsumerEnv` (adds `RABBITMQ_URL`) and the abstract classes `AgentConfig`, `AgentConsumerConfig`.
- `src/app.module.ts`, `src/consumer.module.ts`: the root modules of the two processes.
- `src/modules/platform/`: the `pg` pool and `PostgresReadinessCheck`.
- `src/modules/heartbeat/`: `HeartbeatConsumer` reads `agent.system.ping` with `idempotent()` from `@jadero/messaging`, so the inbox insert and the `broker_heartbeat` upsert share one transaction; `BrokerReadinessCheck`.
- `sql/0001_broker_heartbeat.sql`, `src/migrate.ts`: agent's tables until WP-10's Drizzle migrations.
- `test/`: unit tests (`pnpm test`); `*.int.test.ts` against a real Postgres with `pnpm test:int` (Docker).

## Rules that bite here

- `agent` owns `agent_dev` only and never calls `api` (ADR-029 rule 3): what it needs from other services arrives as events into its own read model.
- Every consumer handler goes through `idempotent()`: delivery is at least once (ADR-012).
- A new queue is a line in `packages/messaging/src/topology/jadero.ts`, then `pnpm --filter @jadero/messaging topology`; the broker user `agent` cannot declare queues.
- Handlers return `done`, `retry` or `dead` and never ack; log ids and types, never message bodies at info.
