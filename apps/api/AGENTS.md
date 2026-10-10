# apps/api

The content, auth, media and CV service (ADR-001). It is the boot skeleton every Nest service copies (WP-3: fail-fast config, structured logs, problem details, health checks and OpenTelemetry from `@jadero/platform-nest`, its own Postgres readiness check) plus, since WP-5, the producer side of messaging: the outbox in `content_dev` and the `api-worker` process type that relays it to RabbitMQ, and since WP-10 the data layer: Drizzle over `platform-nest`'s `DatabaseModule`, its tables as schema files and generated SQL migrations. Since WP-12 it holds its first feature module, `content`: the owner's content as aggregates with revisions and per-locale publishing, and the public read API under `/v1/content`.

## Run it

```sh
pnpm dev:up                              # from the repo root: Postgres and RabbitMQ
cp apps/api/.env.example apps/api/.env   # once; dev values only
pnpm dev                                 # from the root: tsc --watch plus node --watch, restarts on change
```

`pnpm --filter @jadero/api db:migrate` (after a build) applies the pending migrations in `drizzle/` to `content_dev`; run it after each pull that adds one. After a schema file changes, `pnpm --filter @jadero/api db:generate` writes the next migration; review its SQL in the PR. `pnpm dev` also starts `api-worker` (`dev:worker`, port 3011, health only). `pnpm --filter @jadero/api db:seed` (after `db:migrate`) loads placeholder content through the content use cases; it is idempotent (an item already stored is skipped, never changed), prints counts per type and never content, and no deploy runs it.

`pnpm --filter @jadero/api start` runs the built `dist/` the way production does: `node --env-file-if-exists=.env --import @jadero/platform-nest/instrumentation dist/main.js`. Port 3001. `GET /health/live`, `GET /health/ready` (checks `database` and `content-reader`). The public reads: `GET /v1/content/:locale/{profile,experience,projects,projects/:slug,posts,posts/:slug,skills}` (`:locale` is `es`, `en` or `de`; `projects?kind=`, `posts?cursor=`) and `GET /v1/content/work`, `/v1/content/work/:entryId` (approved knowledge entries, English). `start:worker` runs `dist/worker.js` the same way. In development, `POST /dev/ping` writes a `system.ping.v1` event to the outbox and answers 202 with its id.

## Layout

- `src/main.ts`: `loadConfig(apiEnv)` before anything else, then `NestFactory.create(AppModule.forRoot(config), { bufferLogs: true })`, `configureApp`, `listen`.
- `src/config/api-config.ts`: `apiEnv` (the platform variables, among them `HTTP_JSON_BODY_LIMIT`, plus `DATABASE_URL`, `DATABASE_POOL_MAX` and `DATABASE_READ_URL`; `apiWorkerEnv` has no `DATABASE_READ_URL`) and `ApiConfig`, the abstract class providers inject (ADR-043, decision B2).
- `src/app.module.ts`: imports `LoggingModule`, `DatabaseModule`, `HealthModule` (checks `database` and `content-reader`), `TelemetryModule` and `PublicContentModule` (one instance shared with `HealthModule`, so one reader pool); provides `ApiConfig` globally.
- `DatabaseModule.forRoot` (from `@jadero/platform-nest`, imported once in `AppModule` and `WorkerModule`): the global `pg` pool (`PG_POOL`, closed on shutdown) and Drizzle (`DRIZZLE`); `PostgresReadinessCheck` comes from the same package.
- `src/modules/ping/`: `PingService` writes `system.ping.v1` to the outbox inside `withTransaction` (a layered module, no unit of work port); `DevPingModule` adds `POST /dev/ping` in development only.
- `src/modules/content/` (hexagonal, ADR-003; ADR-011, ADR-031), the write side: `domain/` holds the aggregates (profile, experience items, projects, posts, skills, CV bullets, knowledge entries) with their revisions and state machines: per locale `missing`, `draft`, `published`, `changed` (es and en required to publish, de optional), and for entries `draft`, `in_review`, `approved`, `withdrawn`, the approval bound to one revision and its checklist. A revision is immutable, records `origin: owner | machine` (Q3 A) and is stored as a Zod-validated `jsonb` document in one `*_revisions` table per type (Q1 B). `application/` holds the use cases (create, save a revision, publish, archive; submit, approve, withdraw, delete an entry; seed) and the ports; every write runs in `ContentUnitOfWork.run` and saves with `expectedVersion` (compare-and-set: a stale version throws `ConcurrentModification` and rolls back the whole run). `ContentModule` wires the Drizzle adapters on the owner pool; it has no controller (admin writes arrive with WP-13).
- `src/modules/content/public-content.module.ts`, the read side (CQRS, no domain): the `/v1/content` controllers, the `ContentQueries` port and `DrizzleContentQueries`, on its own pool (`CONTENT_READER_POOL`) logged in as the read-only `content_reader` role (`DATABASE_READ_URL`), which can read the published tables only, never `knowledge_entry_provenance`. Routes are versioned in the URI (`@Version`, `/v1`; `/health` and `/dev/ping` are `VERSION_NEUTRAL`). `PublicCacheInterceptor` sets `Cache-Control: public, max-age=60, stale-while-revalidate=300, stale-if-error=86400` and `Content-Language`; Express adds the weak `ETag` and answers a matching `If-None-Match` with 304; every error is `no-store`. A German item without a published German version falls back to English, labelled `Content-Language: en`. Response schemas strip any private field a query returns by mistake.
- `src/seed.ts`, `src/seed/`: the `db:seed` command, `SeedModule` (the content use cases on the owner pool, no HTTP) and the placeholder data.
- `src/worker.ts`, `src/worker.module.ts`, `src/modules/relay/`: `api-worker` (report section 3.2): the RabbitMQ bus as `MessageBus`, the `OutboxRelay`, the heartbeat ping every `HEARTBEAT_INTERVAL_MS`, readiness on Postgres and the broker.
- `src/modules/<name>/infrastructure/<name>.schema.ts`: a module's tables, in a Postgres schema named after the module; never exported from its `index.ts`. `src/db/messaging.schema.ts` re-exports the outbox table from `@jadero/messaging/schema` for drizzle-kit.
- `drizzle.config.ts`, `drizzle/`: drizzle-kit's config and the generated migrations (SQL plus `meta/`); `src/migrate.ts` is the one-off `db:migrate` step, never run at boot.
- `src/modules/<name>/`: feature modules, copied from `templates/nest-module/` (layered or hexagonal).
- `test/`: unit and end-to-end tests (`pnpm test`; HTTP tests boot the app with `test/setup/boot.ts` and call it with supertest, `request(app.getHttpServer())`; `migrations.test.ts` fails when the schema files drift from the last migration); `*.int.test.ts` run against a real Postgres with `pnpm test:int` (needs Docker; `test/setup/` starts one container per run and a database owned by an ordinary role per file).

## Rules that bite here

- New environment variables go in `apiEnv`, `.env.example` and a test; never read `process.env` elsewhere. Connection URLs are never logged.
- Public reads go through `ContentQueries` on the reader pool, never through a repository or the owner pool; a new public table needs its `GRANT SELECT` to `content_reader` in a migration. Public DTOs come from `packages/contracts`, and a private field (entry provenance, unpublished revisions) never reaches them.
- A content write changes its aggregate through a use case inside the unit of work, with the version the caller loaded; never update content tables directly.
- Classes Nest injects are imported as values, not `import type` (`.claude/rules/nest.md`).
- `api` owns `content_dev` only; it never reads another service's database and never calls `agent` or `contact` over HTTP (ADR-029).
- Writes that belong together share one transaction: a layered module calls `withTransaction(pool, ({ db, executor }) => ...)`, a hexagonal module goes through its unit of work port (`templates/nest-module/`, widgets). Never edit a migration that is already on `main`; write a new one.
- A state change other services must see writes its event with `addToOutbox(executor, ...)` on that transaction's executor, never on the pool (a pool connection commits on its own, so a rolled back change would still publish its event); `api` never publishes to RabbitMQ itself, so the broker stays out of its readiness and its request path (ADR-012).
- Every error leaves as RFC 9457 problem details; validate bodies with `@Body({ schema })`.
- The interactive map of this service is `docs/architecture/code-map.html`; update it when modules, providers or the request path change.
