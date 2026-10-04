# apps/api

The content, auth, media and CV service (ADR-001). It is the boot skeleton every Nest service copies (WP-3: fail-fast config, structured logs, problem details, health checks and OpenTelemetry from `@jadero/platform-nest`, its own Postgres readiness check) plus, since WP-5, the producer side of messaging: the outbox in `content_dev` and the `api-worker` process type that relays it to RabbitMQ. Feature modules start in WP-10 (data layer) and WP-12 (content).

## Run it

```sh
pnpm dev:up                              # from the repo root: Postgres and RabbitMQ
cp apps/api/.env.example apps/api/.env   # once; dev values only
pnpm dev                                 # from the root: tsc --watch plus node --watch, restarts on change
```

`pnpm --filter @jadero/api migrate` once creates the `messaging` schema (outbox and inbox) in `content_dev`. `pnpm dev` also starts `api-worker` (`dev:worker`, port 3011, health only).

`pnpm --filter @jadero/api start` runs the built `dist/` the way production does: `node --env-file-if-exists=.env --import @jadero/platform-nest/instrumentation dist/main.js`. Port 3001. `GET /health/live`, `GET /health/ready`. `start:worker` runs `dist/worker.js` the same way. In development, `POST /dev/ping` writes a `system.ping.v1` event to the outbox and answers 202 with its id.

## Layout

- `src/main.ts`: `loadConfig(apiEnv)` before anything else, then `NestFactory.create(AppModule.forRoot(config), { bufferLogs: true })`, `configureApp`, `listen`.
- `src/config/api-config.ts`: `apiEnv` (the platform variables plus `DATABASE_URL`) and `ApiConfig`, the abstract class providers inject (ADR-043, decision B2).
- `src/app.module.ts`: imports `LoggingModule`, `HealthModule` (with the Postgres check) and `TelemetryModule`; provides `ApiConfig` globally.
- `src/modules/platform/`: the `pg` pool (`PG_POOL`, closed on shutdown) and `PostgresReadinessCheck`.
- `src/modules/ping/`: `PingService` writes `system.ping.v1` to the outbox in one transaction; `DevPingModule` adds `POST /dev/ping` in development only.
- `src/worker.ts`, `src/worker.module.ts`, `src/modules/relay/`: `api-worker` (report section 3.2): the RabbitMQ bus as `MessageBus`, the `OutboxRelay`, the heartbeat ping every `HEARTBEAT_INTERVAL_MS`, readiness on Postgres and the broker.
- `src/migrate.ts`: applies `packages/messaging/sql/0001_messaging.sql` (WP-10 replaces it).
- `src/modules/<name>/`: feature modules, copied from `templates/nest-module/` (layered or hexagonal).
- `test/`: unit and end-to-end tests (`pnpm test`); `*.int.test.ts` run against a real Postgres with `pnpm test:int` (needs Docker; `test/setup/` starts one container per run and a database per file).

## Rules that bite here

- New environment variables go in `apiEnv`, `.env.example` and a test; never read `process.env` elsewhere.
- Classes Nest injects are imported as values, not `import type` (`.claude/rules/nest.md`).
- `api` owns `content_dev` only; it never reads another service's database and never calls `agent` or `contact` over HTTP (ADR-029).
- A state change other services must see writes its event with `addToOutbox(tx, ...)` in the same transaction; `api` never publishes to RabbitMQ itself, so the broker stays out of its readiness and its request path (ADR-012).
- Every error leaves as RFC 9457 problem details; validate bodies with `@Body({ schema })`.
- The interactive map of this service is `docs/architecture/code-map.html`; update it when modules, providers or the request path change.
