# apps/agent

The knowledge, chat, guards and usage service (ADR-001). Today it is the skeleton: the same boot as `api` (fail-fast config, logs, problem details, health, OpenTelemetry from `@jadero/platform-nest`) with its own database, `agent_dev`, a consumer process that applies `system.ping.v1` through the inbox (WP-5), and the data layer of WP-10 (Drizzle over `platform-nest`'s `DatabaseModule`, schema files and generated SQL migrations). Retrieval and ingestion arrive in WP-20 and WP-21, the chat in WP-22.

## Run it

```sh
pnpm dev:up                                  # from the repo root: Postgres and RabbitMQ
cp apps/agent/.env.example apps/agent/.env   # once; dev values only
pnpm build && pnpm --filter @jadero/agent db:migrate   # after each pull that adds a migration
pnpm dev                                     # from the root: the HTTP process and the consumer
```

Two process types from one codebase (report section 3.2):

- `dist/main.js` (`start`): HTTP on port 3002; `/health/ready` checks `agent_dev` only.
- `dist/consumer.js` (`start:consumer`, `dev:worker`): port 3012 for health only; ready when Postgres and RabbitMQ answer. It becomes `agent-ingest` in WP-20.

## Layout

- `src/config/agent-config.ts`: `agentEnv`, `agentConsumerEnv` (adds `RABBITMQ_URL`) and the abstract classes `AgentConfig`, `AgentConsumerConfig`.
- `src/app.module.ts`, `src/consumer.module.ts`: the root modules of the two processes.
- `DatabaseModule.forRoot` (from `@jadero/platform-nest`, imported once in each root module): the global `pg` pool (`PG_POOL`) and Drizzle (`DRIZZLE`); `PostgresReadinessCheck` comes from the same package.
- `src/modules/heartbeat/`: `HeartbeatConsumer` reads `agent.system.ping` and, inside `withTransaction` (a layered module, no unit of work port), records the inbox with `recordInInbox` and upserts `heartbeat.broker_heartbeat`, so both writes commit or roll back together; `BrokerReadinessCheck`.
- `src/modules/<name>/infrastructure/<name>.schema.ts`: a module's tables, in a Postgres schema named after the module; never exported from its `index.ts`. `src/db/messaging.schema.ts` re-exports the inbox table from `@jadero/messaging/schema` for drizzle-kit.
- `drizzle.config.ts`, `drizzle/`: drizzle-kit's config and the generated migrations; `0000_enable_vector.sql` is a custom one that only checks `vector` exists (provisioning creates it as superuser). `pnpm --filter @jadero/agent db:generate` writes the next one; `src/migrate.ts` is the one-off `db:migrate` step, never run at boot.
- `test/`: unit tests (`pnpm test`; `migrations.test.ts` fails when the schema files drift from the last migration); `*.int.test.ts` against a real Postgres with `pnpm test:int` (Docker), each file in a database owned by an ordinary role.

## Rules that bite here

- `agent` owns `agent_dev` only and never calls `api` (ADR-029 rule 3): what it needs from other services arrives as events into its own read model.
- Every consumer handler records the event in the inbox inside the same transaction as its writes (`withTransaction` plus `recordInInbox` on its executor, or the module's unit of work port): delivery is at least once (ADR-012). Writes go on the transaction's executor or `db`, never on the pool.
- Never edit a migration that is already on `main`; write a new one. No `CREATE INDEX CONCURRENTLY`: Drizzle runs all pending migrations in one transaction, where Postgres forbids it, so indexes (WP-20's HNSW too) are built plainly.
- A new queue is a line in `packages/messaging/src/topology/jadero.ts`, then `pnpm --filter @jadero/messaging topology`; the broker user `agent` cannot declare queues.
- Handlers return `done`, `retry` or `dead` and never ack; log ids and types, never message bodies at info.
