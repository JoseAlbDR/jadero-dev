# apps/api

The content, auth, media and CV service (ADR-001). It is the boot skeleton every Nest service copies (WP-3: fail-fast config, structured logs, problem details, health checks and OpenTelemetry from `@jadero/platform-nest`, its own Postgres readiness check) plus, since WP-5, the producer side of messaging: the outbox in `content_dev` and the `api-worker` process type that relays it to RabbitMQ, and since WP-10 the data layer: Drizzle over `platform-nest`'s `DatabaseModule`, its tables as schema files and generated SQL migrations. Feature modules start in WP-12 (content).

## Run it

```sh
pnpm dev:up                              # from the repo root: Postgres and RabbitMQ
cp apps/api/.env.example apps/api/.env   # once; dev values only
pnpm dev                                 # from the root: tsc --watch plus node --watch, restarts on change
```

`pnpm --filter @jadero/api db:migrate` (after a build) applies the pending migrations in `drizzle/` to `content_dev`; run it after each pull that adds one. After a schema file changes, `pnpm --filter @jadero/api db:generate` writes the next migration; review its SQL in the PR. `pnpm dev` also starts `api-worker` (`dev:worker`, port 3011, health only).

`pnpm --filter @jadero/api start` runs the built `dist/` the way production does: `node --env-file-if-exists=.env --import @jadero/platform-nest/instrumentation dist/main.js`. Port 3001. `GET /health/live`, `GET /health/ready`. `start:worker` runs `dist/worker.js` the same way. In development, `POST /dev/ping` writes a `system.ping.v1` event to the outbox and answers 202 with its id.

## Layout

- `src/main.ts`: `loadConfig(apiEnv)` before anything else, then `NestFactory.create(AppModule.forRoot(config), { bufferLogs: true })`, `configureApp`, `listen`.
- `src/config/api-config.ts`: `apiEnv` (the platform variables plus `DATABASE_URL`) and `ApiConfig`, the abstract class providers inject (ADR-043, decision B2).
- `src/app.module.ts`: imports `LoggingModule`, `HealthModule` (with the Postgres check) and `TelemetryModule`; provides `ApiConfig` globally.
- `DatabaseModule.forRoot` (from `@jadero/platform-nest`, imported once in `AppModule` and `WorkerModule`): the global `pg` pool (`PG_POOL`, closed on shutdown) and Drizzle (`DRIZZLE`); `PostgresReadinessCheck` comes from the same package.
- `src/modules/ping/`: `PingService` writes `system.ping.v1` to the outbox inside `withTransaction` (a layered module, no unit of work port); `DevPingModule` adds `POST /dev/ping` in development only.
- `src/worker.ts`, `src/worker.module.ts`, `src/modules/relay/`: `api-worker` (report section 3.2): the RabbitMQ bus as `MessageBus`, the `OutboxRelay`, the heartbeat ping every `HEARTBEAT_INTERVAL_MS`, readiness on Postgres and the broker.
- `src/modules/<name>/infrastructure/<name>.schema.ts`: a module's tables, in a Postgres schema named after the module; never exported from its `index.ts`. `src/db/messaging.schema.ts` re-exports the outbox table from `@jadero/messaging/schema` for drizzle-kit.
- `drizzle.config.ts`, `drizzle/`: drizzle-kit's config and the generated migrations (SQL plus `meta/`); `src/migrate.ts` is the one-off `db:migrate` step, never run at boot.
- `src/modules/<name>/`: feature modules, copied from `templates/nest-module/` (layered or hexagonal).
- `test/`: unit and end-to-end tests (`pnpm test`; `migrations.test.ts` fails when the schema files drift from the last migration); `*.int.test.ts` run against a real Postgres with `pnpm test:int` (needs Docker; `test/setup/` starts one container per run and a database owned by an ordinary role per file).

## Rules that bite here

- New environment variables go in `apiEnv`, `.env.example` and a test; never read `process.env` elsewhere.
- Classes Nest injects are imported as values, not `import type` (`.claude/rules/nest.md`).
- `api` owns `content_dev` only; it never reads another service's database and never calls `agent` or `contact` over HTTP (ADR-029).
- Writes that belong together share one transaction: a layered module calls `withTransaction(pool, ({ db, executor }) => ...)`, a hexagonal module goes through its unit of work port (`templates/nest-module/`, widgets). Never edit a migration that is already on `main`; write a new one.
- A state change other services must see writes its event with `addToOutbox(executor, ...)` on that transaction's executor, never on the pool (a pool connection commits on its own, so a rolled back change would still publish its event); `api` never publishes to RabbitMQ itself, so the broker stays out of its readiness and its request path (ADR-012).
- Every error leaves as RFC 9457 problem details; validate bodies with `@Body({ schema })`.
- The interactive map of this service is `docs/architecture/code-map.html`; update it when modules, providers or the request path change.
