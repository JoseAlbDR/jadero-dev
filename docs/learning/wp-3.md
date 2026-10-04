---
wp: 3
decision: recorded
adr: [ADR-003, ADR-006, ADR-007, ADR-009, ADR-010, ADR-029, ADR-042]
---

# WP-3: Service platform and API skeleton

Issue #11, branch `wp/3-service-platform`, release R0, size M, tag learning. Depends on WP-1 (issue #9).

**Branch base.** Rebuilt from `main` on 2026-10-03 after WP-1 merged (PR #66): the branch carries only this explainer on top of `main`.

Deliverable (report section 14): `packages/platform-nest` (Zod config, pino, problem+json, `/health/live` and `/health/ready`, OTel bootstrap); `apps/api` skeleton; Vitest + Testcontainers harness; compatibility spike for auth, pino, RabbitMQ, MCP and LangChain packages on Nest 12; module template with the layer conventions of ADR-003 (D-3).

What the owner learns (decisions.json): Nest modules, providers, DI scopes and lifecycle; the request pipeline; fail-fast configuration. The owner knows NestJS well, so this explainer skips DI basics and spends its words on what is new: Nest 12 on ESM, Standard Schema validation, fail-fast config, pino with request ids, RFC 9457, liveness vs readiness, the OTel bootstrap order, the module template, the Testcontainers harness and the spike.

## How to read this file

This file is the only thing you need to read. ADR and WP numbers appear as sources, and every one of them is summarized in one line in the "Named here" table below, so you never have to open them to answer. Nothing here is to memorize: each question asks you to choose, and each explain-back asks you to describe what you saw in the code.

Before each question, read only these parts (about 5 to 10 minutes each):

| Question | Read first | Then |
|---|---|---|
| 1. HTTP adapter | Options A | |
| 2. Typed config | First principles: "Fail-fast configuration"; Trace 1, step 3 | Options B |
| 3. Database driver | First principles: "Liveness vs readiness"; Trace 1, steps 8 to 9 and "Postgres stopped" | Options D |
| 4. Health on failure | First principles: "RFC 9457 problem details" and "Liveness vs readiness"; Trace 1, "Postgres stopped"; Trace 2, step 4 | Options E |
| 5. OpenTelemetry | First principles: "OpenTelemetry bootstrap order"; Trace 1, steps 1, 2, 10 and 11 | Options F |
| 6. Module template | First principles: "The module template" and "Which tool checks what, and when" | Options G |
| 7. Spike | First principles: "The compatibility spike as a go/no-go" | Options I and its table |

The session presents all questions in one message with this pointer; a question that depends on another gets a recommendation per possible answer of the first. Ask about anything before answering; "I don't know" on an explain-back means the explainer missed something, and it gets fixed here.

## Named here

| Name | What it is, in one line | When |
|---|---|---|
| WP-1 | Repo foundation: workspace, Biome, dependency-cruiser, git hooks, dev containers (done) | R0 |
| WP-5 | Messaging: the RabbitMQ adapter, the outbox (events saved in the same transaction as the data, then relayed to the broker) and the first `agent` skeleton | R0, next after WP-3 |
| WP-6 | CI pipeline: GitHub Actions runs `pnpm verify:all`, the integration tests and the coverage gates on every pull request | R0 |
| WP-8 | Server preparation: firewall, nginx, the production Compose stack, backups | R0 |
| WP-10 | Data layer: Drizzle ORM, migrations per service, repositories | R1 |
| WP-11 | Contact service: the form, its outbox and the mailer | R1 |
| WP-12 | Content domain: posts, translations, publish states; the first hexagonal module | R1 |
| WP-13 | Admin login with Better Auth | R1 |
| WP-19 to WP-22 | The AI ports, the knowledge index, retrieval and the LangGraph agent | R2 |
| WP-36 | The public MCP server (lets Claude and other clients query the profile) | R4 |
| WP-51 | OpenAPI documents generated from the Zod contracts | R1 |
| ADR-003 | Inside a service: hexagonal modules where there are rules, layered where trivial; ports are abstract classes | |
| ADR-006 | Zod for every boundary, contracts in `packages/contracts`, errors as RFC 9457 | |
| ADR-007 | Config from the environment, validated at boot; secrets never printed (superseded by ADR-043 on the library) | |
| ADR-043 | Config validated by an own Zod loader before Nest starts, not `@nestjs/config`; secrets rules unchanged | WP-3 |
| ADR-009 | Test pyramid, Testcontainers, coverage gates | |
| ADR-010 | Logs with pino, traces with OpenTelemetry, `/health/live` and `/health/ready` | |
| ADR-029 | Each service owns its database; services talk only through RabbitMQ | |
| ADR-042 | NestJS 12 on Node 24 LTS; an integration that breaks gets a wrapper, Nest is never downgraded | |

Already decided by ADRs and not reopened here: Nest 12, ESM, Vitest on Node 24 (ADR-042, which restates ADR-004); Zod through Standard Schema, contracts in `packages/contracts`, one exception filter returning RFC 9457 (ADR-006); `@nestjs/config` with a Zod schema per module, validated at boot, no `process.env` outside the config module, the boot log lists variable names, never values (ADR-007); pino with request ids plus OpenTelemetry over OTLP to a free hosted tier, console exporter in dev, `/health/live` and `/health/ready` through `@nestjs/terminus` (ADR-010); the test pyramid, Testcontainers on `pgvector/pgvector`, supertest end-to-end, coverage gates (ADR-009); hexagonal where there are rules, layered where trivial, ports as abstract classes, no `utils/` (ADR-003); one database per service (ADR-029). Drizzle itself arrives in WP-10 and messaging in WP-5.

Facts checked on 2026-10-03 against the npm registry (`npm view <pkg> version time --json`, peer ranges with `npm view <pkg> peerDependencies`). Nothing Nest-related is installed in the repo yet, and documentation sites were not used, so behavior I could not read in a package README is marked **verify**. pnpm 11 refuses versions younger than 24 hours (`minimumReleaseAge`, 1440 minutes); those are flagged and will be old enough by the time step 3 installs anything, but re-check then.

| Package | Latest on 2026-10-03 | Published | Note |
|---|---|---|---|
| `@nestjs/core`, `@nestjs/common`, `@nestjs/testing` | 12.1.2 | 2026-09-30 | `"type": "module"`; `@nestjs/common` exports only ESM (`".": "./index.js"`); 12.0.0 was 2026-08-27 |
| `@nestjs/platform-express` | 12.1.2 | 2026-09-30 | the default adapter (an optional peer of `@nestjs/core`) |
| `@nestjs/platform-fastify` | 12.1.2 | 2026-09-30 | |
| `@nestjs/cli` | 12.0.8 | 2026-09-28 | depends on `typescript ~6.0.2` (catalog has 6.0.3) |
| `@nestjs/config` | 12.0.1 | 2026-09-22 | peer `@nestjs/common ^11 \|\| ^12` |
| `@nestjs/terminus` | 12.1.0 | 2026-09-20 | peer `@nestjs/core ^11 \|\| ^12`, engines include `>=24` |
| `@nestjs/swagger` | 12.0.2 | 2026-09-23 | WP-51, listed for completeness |
| `@nestjs/observe` | 0.3.6 | 2026-10-02 | **under 24 h** (0.3.5 is older); SaaS agent with its own wire format, see option F |
| `zod` | 4.6.5 | 2026-09-13 | implements Standard Schema |
| `pino` | 10.4.0 | 2026-10-02 | **under 24 h**; 10.3.1 (2026-02-09) is the installable one today |
| `pino-http` | 11.0.0 | 2025-10-04 | |
| `nestjs-pino` | 5.3.1 | 2026-10-02 | **under 24 h**; 5.3.0 (2026-10-02 06:33 UTC) and 5.2.1 also declare `@nestjs/core ^11.0.8 \|\| ^12.0.2`, pino `^10`, pino-http `^11` |
| `@opentelemetry/sdk-node` | 0.222.0 | 2026-08-31 | peer `@opentelemetry/api >=1.3.0 <1.10.0` (api is 1.9.1) |
| `@opentelemetry/auto-instrumentations-node` | 0.80.0 | 2026-08-31 | bundles http, express, pg, pino, amqplib, nestjs-core instrumentations |
| `@opentelemetry/instrumentation-nestjs-core` | 0.68.0 | 2026-08-31 | README: supports `@nestjs/core >=4.0.0 <12`. **Nest 12 is outside the declared range** |
| `@opentelemetry/instrumentation-pino` | 0.68.0 | 2026-08-31 | supports pino `>=5.14.0 <11`; adds `trace_id`, `span_id`, `trace_flags` to log lines |
| `@opentelemetry/instrumentation-express` | 0.70.0 (via the bundle) | 2026-08-31 | supports express `>=4 <6` |
| `@opentelemetry/instrumentation-fastify` | deprecated | | replaced by `@fastify/otel` 0.21.1, not in the bundle |
| `drizzle-orm`, `drizzle-kit` | 0.45.3, 0.31.11 | 2026-09-21 | WP-10; not installed in WP-3 |
| `pg`, `@types/pg` | 8.23.1, 8.23.1 | 2026-09-30, 2026-08-17 | candidate driver for the readiness check (option D) |
| `testcontainers`, `@testcontainers/postgresql`, `@testcontainers/rabbitmq` | 12.2.0 | 2026-09-28 | engines `node >= 22.22` |
| `@golevelup/nestjs-rabbitmq` | 9.1.0 | 2026-09-28 | peer `@nestjs/core ^11.1.24 \|\| ^12.0.0`; CommonJS package |
| `@rekog/mcp-nest` | 2.0.7 | 2026-09-21 | peers: `@nestjs/core >=9`, `express >=4` (required), `@nestjs/platform-fastify ^11.1.5 \|\| ^12` (optional), `@modelcontextprotocol/server ^2.0.0-beta.5` (latest 2.3.0, **under 24 h**), `zod ^4.3.5` |
| `better-auth` | 1.7.7 | 2026-09-30 | peers include `drizzle-orm ^0.45.2`, `pg ^8` |
| `@thallesp/nestjs-better-auth` | 2.8.0 | 2026-09-03 | peers `@nestjs/core ^11.1.6 \|\| ^12`, `better-auth >=1.5 <2`, `express ^5.1` (optional), `typescript ^5.9.2 \|\| ^6`; engines `node >=22.22.1`; README documents Express and Fastify |
| `@langchain/core` | 1.2.14 | 2026-10-01 | ESM |
| `@langchain/langgraph` | 1.4.18 | 2026-09-25 | peer `zod ^3.25.32 \|\| ^4.2.0`, `@langchain/core ^1.1.48` |
| `supertest` | 7.3.1 | 2026-10-02 | **under 24 h**; 7.3.0 (2026-09-22) installable today |
| `vitest` | 5.0.3 (catalog) | 2026-09-30 | runs on Vite 8.3 and Rolldown 1.2 (Oxc transformer) in this repo |
| `fastify`, `express` | 5.12.5, 5.2.1 | | |
| `@turbo/gen` | 2.11.7 | 2026-10-02 | **under 24 h**; only if option G2 |

## First principles

**Nest 12 on ESM, what actually changes.** Every `@nestjs/*` package is now an ES module (`"type": "module"`, ESM-only `exports`). Our code follows: `apps/api/package.json` has `"type": "module"`, the shared `node-service` tsconfig already uses `module: NodeNext`, so relative imports carry `.js` (`import { AppModule } from "./app.module.js"`), and `__dirname` becomes `import.meta.dirname`. Four consequences matter in practice. (1) *Load order is static.* In ESM every `import` is resolved and evaluated before the importing module's body runs, so "do X on the first line of `main.ts` before anything else loads" is impossible; anything that must run first (OpenTelemetry) goes in a separate file loaded with `node --import`. (2) *Circular imports fail louder.* A class used before its module finished evaluating throws `ReferenceError: Cannot access 'X' before initialization` instead of quietly being `undefined`; `forwardRef()` still exists, and the WP-1 `no-circular` rule keeps cycles out. (3) *CommonJS dependencies still work.* `pino`, `nestjs-pino` and `@golevelup/nestjs-rabbitmq` are CommonJS; ESM can import them, and when they `require("@nestjs/common")` (now ESM-only) Node loads it through `require(esm)`, stable since 20.19 and 22.12, which is my reading of why Nest 12 has exactly that Node floor (**verify** in the spike: `require(esm)` fails if the ESM graph uses top-level await). (4) *Decorator metadata needs care.* Nest still resolves constructor parameters from `design:paramtypes`, which TypeScript emits with `experimentalDecorators` and `emitDecoratorMetadata` (both already in `packages/config/tsconfig/node-service.json`). Our base tsconfig also sets `verbatimModuleSyntax`, which means an `import type { PgPool }` is erased, so the metadata for that parameter becomes `Object` and Nest fails at boot with `Nest can't resolve dependencies of PostgresHealthIndicator (?)`. Rule: classes you inject are imported as values. Vitest compiles with Oxc, not tsc; the Rolldown 1.2 bundled in this repo exposes `decorator.legacy` and `emitDecoratorMetadata` options and reads them from tsconfig (`rolldown/dist/shared/binding-*.d.mts`), so Vitest should not need the SWC plugin Nest 11 projects used (**verify** in step 3 with a DI test). Biome needs `javascript.parser.unsafeParameterDecoratorsEnabled: true` to parse `@Body()` and `@Inject()` on parameters (option present in the bundled Biome 2.5.15 schema).

**Workspace packages: compiled code, not path aliases.** `apps/api` will import `@jadero/platform-nest`. Two mechanisms can make that name resolve, and only one survives production. A *path alias* (`"paths": { "@jadero/platform-nest": ["../../packages/platform-nest/src"] }` in tsconfig) only tells the TypeScript compiler where to look. The compiled `dist/main.js` still says `import ... from "@jadero/platform-nest"`, and Node never reads tsconfig: it looks for that name in `node_modules`, finds nothing, and the container exits at boot with `ERR_MODULE_NOT_FOUND`. A *workspace package* is a real package. `pnpm install` creates the symlink `apps/api/node_modules/@jadero/platform-nest -> packages/platform-nest`, and Node reads that package's `package.json`, whose `exports` map (`".": "./dist/index.js"`) names the file to load. That file must be JavaScript: Node 24 strips types from your own `.ts` files but refuses inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), and type stripping cannot handle decorators at all. So `packages/platform-nest` has a `build` script (tsc to `dist/`), and `"dependsOn": ["^build"]` in `turbo.json` builds it before `api` typechecks, tests or builds. `@jadero/config` (WP-1) needed no build because it holds only JSON and plain JavaScript. Step 3 creates the first compiled package; you will see the symlink and the `exports` map there.

**Which tool checks what, and when.** Four tools, each with one job and a fixed place where it runs.

| Tool | Checks | Runs |
|---|---|---|
| Biome | formatting and smells inside one file (an unused variable, `==`) | on every agent edit, on staged files at `git commit`, in `pnpm verify` |
| TypeScript (`tsc --noEmit`) | types across files | in `pnpm verify` |
| dependency-cruiser | which file may import which: the architecture rules of ADR-003 and AGENTS.md section 4; it reads the import graph, not the code | in `pnpm verify` (`pnpm depcruise`) |
| commitlint | the commit message shape `type(scope): subject` | at `git commit` |

Example: a file in `apps/agent` that imports `../../api/src/modules/content/post.js` breaks the rule `no-cross-service-imports`; `pnpm verify` fails and prints the rule name and both paths. Today all four run only on your machine, so they can be skipped (`LEFTHOOK=0`, or not running `pnpm verify`). From WP-6 the same `pnpm verify:all` runs on GitHub for every pull request, so a skipped local check still blocks the merge. In this WP: step 3's DI test is caught by TypeScript and Vitest, and step 8 widens the dependency-cruiser rules to `templates/`.

**Standard Schema validation.** Standard Schema is a tiny shared interface: any validator exposes `schema["~standard"].validate(value)` returning `{ value }` or `{ issues: [{ message, path }] }` (possibly as a promise). Zod 4, Valibot and ArkType implement it, so Nest can validate without knowing which library made the schema. Nest 12 adds a `schema` option to `@Body()`, `@Query()` and `@Param()`, a `StandardSchemaValidationPipe` that runs it, and a `StandardSchemaSerializerInterceptor` that can validate and strip responses (report section 1, Nest 12 release notes). The input type comes from the schema (`z.infer<typeof ContactBody>`), so there is no DTO class and the same schema can live in `packages/contracts` for the admin form, the API and an agent tool. Exact option names and the exception the pipe throws (its body shape) are **verify**; our problem-details filter maps whatever it throws.

**Fail-fast configuration.** A service reads its environment once, at boot, through one Zod schema, and refuses to start if anything is missing or malformed. The cost of a bad deploy moves from "a 500 on the first request that touches that code path, an hour later" to "the container exits in 200 ms and the deploy script sees it". Each module contributes a slice (`platformEnv`, later `databaseEnv`, `aiEnv`), the service merges them, and the parsed, typed object is what providers get; `process.env` is read in exactly one place. Two Zod 4 details: `z.coerce.number()` turns `"3001"` into `3001`, but `z.coerce.boolean()` turns `"false"` into `true` (any non-empty string), so booleans use `z.stringbool()`. The error report prints the variable name and the issue, never the received value, because the value might be a secret (ADR-007, AGENTS.md section 7).

**pino and request ids.** pino writes one JSON object per line to stdout and leaves shipping to the platform; pretty printing (`pino-pretty`) is a dev-only transport. `nestjs-pino` wraps `pino-http`: a middleware that gives every request a logger child carrying `req_id`, and stores it in `AsyncLocalStorage`, so `this.logger.info()` in any singleton provider carries the request id without request-scoped providers (which would rebuild the provider graph per request). The request id comes from `x-request-id` when nginx sets it (WP-8), else a new UUID, and is echoed in the response header; an incoming value is validated (`^[A-Za-z0-9-]{8,128}$`) so a client cannot inject newlines or huge strings into logs. The default `pino-http` request serializer logs `remoteAddress`, which AGENTS.md forbids in clear: the serializer hashes it (salted, daily-rotated salt, ADR-010) or drops it. `redact` removes `authorization`, `cookie` and `set-cookie` headers. Nest's own logs (bootstrap, route mapping) go through the same pino instance via `bufferLogs: true` and `app.useLogger(app.get(Logger))`.

**RFC 9457 problem details.** RFC 9457 (2023, obsoletes RFC 7807) defines one JSON error shape with media type `application/problem+json`: `type` (a URI naming the problem kind; `about:blank` when the HTTP status says it all), `title` (short, stable per type), `status`, `detail` (this occurrence, human-readable), `instance` (this occurrence, a URI), plus extension members. The RFC's own example carries validation errors as an `errors` array of `{ detail, pointer }`, where `pointer` is a JSON Pointer into the request body (`#/email`). One global `@Catch()` filter in `platform-nest` maps: `HttpException` to its status, validation failures to 400 with `errors`, anything unknown to a generic 500 whose `detail` never contains a message or stack from inside (exception shielding), logged at `error` with the stack. It replaces Nest's default `{"statusCode":400,"message":[...],"error":"Bad Request"}`. Filters are chosen most-specific first (method, controller, then global), which matters for health (option E).

**Liveness vs readiness.** Two questions, two endpoints. *Liveness* (`/health/live`): can this process still make progress? It checks nothing outside the process; if it fails, the right action is a restart. It must never check the database, or a ten-second Postgres blip makes every service look dead at once. *Readiness* (`/health/ready`): can this instance serve traffic right now? It checks its dependencies (for `api` in WP-3, its Postgres database), each with a short timeout so the probe itself never hangs, and it is deliberately false while booting and while shutting down. Failing readiness means "send no traffic, wait", not "restart". In this project the consumers are Docker Compose healthchecks (the deploy script waits for `healthy`; plain Compose marks a container unhealthy but does not restart it, **verify** for the Compose version used in WP-8), Uptime Kuma, and later the Under the hood page. ADR-010 says readiness covers "database and broker". A forward question for WP-5, not for now: thanks to the outbox, `api` can keep accepting writes while RabbitMQ is down (the relay in `api-worker` catches up), so the broker probably belongs in `api-worker`'s readiness, not in `api`'s.

**Lifecycle and graceful shutdown.** With `app.enableShutdownHooks()`, SIGTERM runs `app.close()`, which (in Nest 11, **verify** unchanged in 12) calls `onModuleDestroy`, then `beforeApplicationShutdown`, then closes the HTTP server, then `onApplicationShutdown`. So readiness flips to 503 in `beforeApplicationShutdown`, in-flight requests finish while the server closes, and the Postgres pool closes in `onApplicationShutdown`, after the last request. Closing the pool in `onModuleDestroy` would fail requests still in flight. The OTel SDK flushes last, after Nest has closed.

**OpenTelemetry bootstrap order.** Auto-instrumentation works by patching libraries (`http`, `express`, `pg`, `pino`, `amqplib`) at the moment they are loaded. If `express` is loaded before the SDK starts, it is never patched and you get no spans, silently. With ESM, patching needs a loader hook: `@opentelemetry/instrumentation` depends on `import-in-the-middle` (ESM) and `require-in-the-middle` (CJS), and the hook must be registered with `module.register()` from a file passed to `node --import`, before the app's module graph loads (import-in-the-middle README). So the start command is `node --import @jadero/platform-nest/instrumentation dist/main.js`, where that entry registers the hook and starts `NodeSDK`. It runs before Nest exists, so it cannot use `ConfigService`; it parses its own small slice (`OTEL_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`) with the same Zod loader, which keeps ADR-007's "no stray `process.env`" true. Exporter: `console` in dev, `otlp` (HTTP, protobuf) in staging and production, `none` in unit tests. `instrumentation-pino` then adds `trace_id` and `span_id` to every log line, which is how logs and traces join (ADR-010 wants `service`, `trace_id`, `event_id` on every line). Two registry facts shape this: `instrumentation-nestjs-core` declares support only below Nest 12, so controller-level spans are a spike item (HTTP and Express spans do not depend on it); and the Fastify instrumentation in the bundle is deprecated in favor of `@fastify/otel`.

**The module template (ADR-003 layers).** Two shapes. Layered (health, revalidation, cv): `presentation/` controller, an application service, a repository, nothing else. Hexagonal (content, auth, knowledge, chat, usage, submissions): `domain/` (entities, value objects, domain events; plain TypeScript), `application/` (use cases and ports as abstract classes, which are also the DI tokens: `{ provide: PostRepository, useClass: DrizzlePostRepository }`), `infrastructure/` (adapters), `presentation/` (controllers, SSE, MCP tools), and `index.ts` as the only file other modules may import. WP-1 already enforces three of those rules in `.dependency-cruiser.cjs` (`domain-imports-only-domain`, `application-never-imports-infrastructure`, `modules-import-through-index`). The template's job is to make the right shape the cheapest one to copy, with one example per file kind and the test next to it.

**The Testcontainers harness.** Testcontainers starts real Docker containers from test code, waits until they are ready (a log line, a port, a command), hands back connection details, and removes them at the end; a small sidecar (Ryuk) removes them even if the test process crashes. With Vitest, a `globalSetup` file runs once in the main process: it starts one `pgvector/pgvector:0.8.7-pg18` container (the same tag as `infra/compose/compose.dev.yml`) and passes its URL to the test workers with `provide()`; each test file calls `inject()` and creates its own database, so files run in parallel without sharing rows. These tests live in `*.int.test.ts`, run with `pnpm test:int` (needs Docker), and stay out of `pnpm verify`, which must stay fast and Docker-free; CI runs them in WP-6. The end-to-end tests boot the real `AppModule` through `Test.createTestingModule()` and must apply exactly the same global pipe, filter and logger as `main.ts`, which is why `platform-nest` exposes one `configureApp(app)` used by both.

**The compatibility spike as a go/no-go.** A spike is a time-boxed experiment that answers a yes/no question with code you throw away. Its value comes from writing the pass criteria before running it, so the result is not rationalized afterwards. ADR-042 (and ADR-004 before it) already fixes the fallback: an integration that fails on Nest 12 gets a thin own wrapper, Nest is never downgraded. So each row of the spike ends in one of three verdicts: *go* (use the package), *go with wrapper* (use it behind our own small adapter, or apply a documented workaround), *no-go* (use the fallback named in advance). The spike covers what later WPs will build on: pino (WP-3), RabbitMQ (WP-5), Better Auth (WP-13), MCP (WP-36), LangChain and LangGraph (WP-19 to WP-22), OpenTelemetry (WP-3), plus native modules on Node 24 (ADR-042). Peer ranges from the registry already say all of them accept Nest 12 except `instrumentation-nestjs-core`; the spike checks behavior, which a peer range cannot prove.

## One concrete trace

File contents and names below are proposals so the trace is concrete; the step that creates each file can change them. Ports, ids, durations and timestamps are illustrative; shapes follow the libraries' documented output, and the ones I could not read are marked **verify**.

Proposed files at the end of WP-3 (assuming the recommendations below):

```
packages/platform-nest/
  package.json                       @jadero/platform-nest, compiled (tsc to dist/), exports "." and "./instrumentation"
  src/index.ts
  src/config/load-config.ts          loadConfig(schema, env): parse, print names and issues, exit 1
  src/config/platform-env.ts         NODE_ENV, PORT, LOG_LEVEL, SERVICE_NAME
  src/bootstrap/configure-app.ts     configureApp(app): pipe, filter, logger, shutdown hooks
  src/logging/logging.module.ts      nestjs-pino with genReqId, redact, hashed IP
  src/errors/problem-details.filter.ts
  src/health/health.module.ts        HealthModule.forRoot({ readiness: [...] })
  src/health/health.controller.ts    GET /health/live, GET /health/ready
  src/telemetry/instrumentation.ts   loaded with node --import
  test/problem-details.e2e.test.ts   uses test/fixtures/echo.controller.ts
apps/api/
  package.json                       @jadero/api, "type": "module"
  src/main.ts
  src/app.module.ts
  src/config/api-env.ts              platformEnv + DATABASE_URL
  src/modules/platform/postgres.health.ts   the readiness check for content_dev
  test/health.int.test.ts
  test/setup/postgres.global-setup.ts
  vitest.config.ts, vitest.int.config.ts
```

### Trace 1: `GET /health/ready`, healthy and then with Postgres stopped

**Boot.** `pnpm dev:up` is running. The `api` process starts as:

```
node --enable-source-maps --import @jadero/platform-nest/instrumentation apps/api/dist/main.js
```

1. Node evaluates `instrumentation.js` first. It parses `OTEL_EXPORTER=console` and `OTEL_SERVICE_NAME=api` with Zod, calls `module.register("@opentelemetry/instrumentation/hook.mjs", import.meta.url)` (export path **verify**), and starts `NodeSDK` with the http, express, pg and pino instrumentations and a console span exporter.
2. Node loads `main.js` and its import graph. `express`, `pg` and `pino` are patched as they load.
3. `main.ts` calls `loadConfig(apiEnv, process.env)` before `NestFactory.create`. With a correct environment the first log line is:

```json
{"level":30,"time":1791014400123,"service":"api","msg":"config loaded","set":["DATABASE_URL","LOG_LEVEL","NODE_ENV","PORT"],"defaulted":["SERVICE_NAME"]}
```

   With `DATABASE_URL` missing and `PORT=99999` the process prints to stderr and exits with code 1, before Nest creates a single provider:

```
config: invalid environment for api (2 problems)
  DATABASE_URL: Invalid input: expected string, received undefined
  PORT: Too big: expected number to be <=65535
```

   (Zod 4 default messages; exact wording **verify**. No value is printed.)

4. `NestFactory.create(AppModule, { bufferLogs: true })`, then `configureApp(app)`: `app.useLogger(app.get(Logger))`, the global `StandardSchemaValidationPipe`, the global `ProblemDetailsFilter`, `app.enableShutdownHooks()`. `PostgresHealthCheck` opens a `pg` pool of at most 2 connections to `postgres://content:...@127.0.0.1:5432/content_dev` (the role and database from `infra/compose/init/01-databases.sql`). `app.listen(3001)`.

**The request.**

```
curl -i http://127.0.0.1:3001/health/ready -H 'x-request-id: 3b0e6c1e-6a4f-4c51-9d2e-1f0a7c2b9e44'
```

5. The http instrumentation opens a SERVER span. There is no `traceparent` header, so a new trace starts: `trace_id 4bf92f3577b34da6a3ce929d0e0e4736`.
6. Express hands the request to the `pino-http` middleware registered by `nestjs-pino`. `genReqId` accepts the incoming header (it matches the pattern), stores it as `req.id`, sets the `x-request-id` response header and opens the `AsyncLocalStorage` context.
7. Nest's router matches `GET /health/ready` to `HealthController.ready()`. No guards or interceptors apply. No body, so the validation pipe does nothing.
8. `ready()` calls Terminus: `this.health.check([() => this.postgres.check("database")])`. The check runs `SELECT 1` on the pool with a 1000 ms timeout. The pg instrumentation opens a CLIENT span `pg.query:SELECT content_dev` as a child of the request span.
9. Terminus collects the result. Response:

```
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
x-request-id: 3b0e6c1e-6a4f-4c51-9d2e-1f0a7c2b9e44

{"status":"ok","info":{"database":{"status":"up"}},"error":{},"details":{"database":{"status":"up"}}}
```

   (The Terminus body shape has been stable since v7; **verify** for 12.1.0.)

10. On `finish`, `pino-http` writes one line. `trace_id` and `span_id` come from `instrumentation-pino`, `req_id` from step 6, `service` from the logger's base fields; the IP is hashed:

```json
{"level":20,"time":1791014460311,"service":"api","req_id":"3b0e6c1e-6a4f-4c51-9d2e-1f0a7c2b9e44","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","trace_flags":"01","req":{"method":"GET","url":"/health/ready","ip_hash":"9c1d42e7"},"res":{"statusCode":200},"responseTime":3,"msg":"request completed"}
```

   Level 20 (debug) on purpose: Compose probes every 10 s and Uptime Kuma every 60 s, which at info level would be about 9,000 lines a day of noise per service. `/health/live` is not logged at all (`autoLogging.ignore`).

11. The console exporter prints the finished spans: a SERVER span `GET /health/ready` (`http.request.method=GET`, `http.route=/health/ready`, `http.response.status_code=200`, about 3 ms) with the pg CLIENT span inside it. With `instrumentation-nestjs-core` working on 12 there would also be a `HealthController.ready` span; whether it does is spike row 6.

**Postgres stopped.** `docker compose -f infra/compose/compose.dev.yml stop postgres`, same request:

8'. `SELECT 1` fails at once with `ECONNREFUSED` (no wait for the 1000 ms timeout). The check reports `down` with a fixed message, never the driver's text, which would expose host and port.
9'. Terminus throws `ServiceUnavailableException` carrying its result. Here the filter question appears (option E): with the recommendation, the health controller has its own filter that returns the Terminus body unchanged:

```
HTTP/1.1 503 Service Unavailable
content-type: application/json; charset=utf-8

{"status":"error","info":{},"error":{"database":{"status":"down","message":"unreachable"}},"details":{"database":{"status":"down","message":"unreachable"}}}
```

10'. Logged at `warn` (5xx from health is expected during an outage; a 5xx elsewhere logs at `error`). `/health/live` still answers `200 {"status":"ok"}`, so nothing restarts the container, which is the point: the process is fine, its database is not. After `docker compose start postgres`, the pool reconnects on the next check and readiness returns 200 without a restart.

**SIGTERM.** `beforeApplicationShutdown` sets the readiness flag to false, so a probe during shutdown gets 503 with `{"status":"error",...,"error":{"shutdown":{"status":"down"}}}`; the HTTP server closes after in-flight requests; `onApplicationShutdown` ends the pool; the instrumentation entry's SIGTERM handler calls `sdk.shutdown()` to flush spans; exit code 0.

### Trace 2: a validation failure returns problem+json

As built (step 5): the body and log line match below except that `traceId`, `trace_id` and `span_id` arrive with OpenTelemetry in step 7, and there is no `ip_hash` (the client IP is not logged in WP-3, owner's choice).

There is no real endpoint with a body in `api` until WP-11 and WP-12, so the platform's own end-to-end test uses a fixture controller that exists only under `packages/platform-nest/test/fixtures/`:

```ts
// packages/platform-nest/test/fixtures/echo.controller.ts
const EchoBody = z.object({ email: z.email(), locale: z.enum(["es", "en", "de"]) });

@Controller("__fixtures")
export class EchoController {
  @Post("echo")
  echo(@Body({ schema: EchoBody }) body: z.infer<typeof EchoBody>) { return body; }
}
```

Request:

```
POST /__fixtures/echo
content-type: application/json

{"email":"not-an-email","locale":"fr"}
```

1. `pino-http` assigns a new `req_id` (`c7d1...`); the http span starts trace `0af7651916cd43dd8448eb211c80319c`.
2. Express parses the JSON body. Nest resolves the handler's parameters; the global `StandardSchemaValidationPipe` sees the `schema` option on `@Body()` and calls `EchoBody["~standard"].validate(body)`.
3. Zod returns two issues: `{ path: ["email"], message: "Invalid email address" }` and `{ path: ["locale"], message: "Invalid option: expected one of \"es\"|\"en\"|\"de\"" }` (Zod 4 default messages, **verify** wording). The pipe throws (exception class and body shape **verify**). The handler never runs.
4. `ProblemDetailsFilter` recognizes a validation failure, turns each path into a JSON Pointer and writes:

```
HTTP/1.1 400 Bad Request
content-type: application/problem+json
x-request-id: c7d1e8a2-0b6f-4b8e-a1f3-5d9c2e7b4a10

{
  "type": "https://jadero.dev/problems/validation-failed",
  "title": "Request validation failed",
  "status": 400,
  "detail": "2 fields are invalid.",
  "instance": "/__fixtures/echo",
  "errors": [
    { "pointer": "#/email", "detail": "Invalid email address" },
    { "pointer": "#/locale", "detail": "Invalid option: expected one of \"es\"|\"en\"|\"de\"" }
  ],
  "requestId": "c7d1e8a2-0b6f-4b8e-a1f3-5d9c2e7b4a10",
  "traceId": "0af7651916cd43dd8448eb211c80319c"
}
```

5. Log line at `warn` (4xx), with no request body, because AGENTS.md forbids message bodies at info level and a body may hold an email address:

```json
{"level":40,"time":1791014520877,"service":"api","req_id":"c7d1e8a2-0b6f-4b8e-a1f3-5d9c2e7b4a10","trace_id":"0af7651916cd43dd8448eb211c80319c","span_id":"b7ad6b7169203331","req":{"method":"POST","url":"/__fixtures/echo","ip_hash":"9c1d42e7"},"res":{"statusCode":400},"problem":"validation-failed","responseTime":2,"msg":"request completed"}
```

6. The same filter on an unexpected error (a `TypeError` thrown in a handler) returns `500`, `type: "about:blank"`, `title: "Internal Server Error"`, `detail: "An unexpected error occurred."` with `requestId` and `traceId` so the owner can find the stack in the `error` log line, which the client never sees.

## Patterns

- **Composition root** and **shared bootstrap for production and tests**: `configureApp(app)` used by `main.ts` and every end-to-end test (trace 1, step 4).
- **Fail fast** and **typed configuration** (twelve-factor config in the environment): `loadConfig` in trace 1, step 3.
- **Structured logging**, **correlation id**, **context propagation with AsyncLocalStorage**: trace 1, steps 6 and 10.
- **Log and trace correlation**: `trace_id` in the log line, trace 1 step 10.
- **Problem details (RFC 9457)**, **global exception handler**, **exception shielding**: trace 2, steps 4 and 6.
- **Schema-first validation at the boundary** (Standard Schema): trace 2, steps 2 and 3.
- **Health check API**, **liveness and readiness probes**, **bounded checks with timeouts**: trace 1, steps 8 to 10'.
- **Graceful shutdown** and **connection draining**: trace 1, SIGTERM.
- **Instrumentation before application load** (agent bootstrap through a loader hook): trace 1, steps 1 and 2.
- **Ports and adapters**, **layered module**, **module public surface** (`index.ts`): the module template.
- **Ephemeral test infrastructure** (Testcontainers), **test isolation by database per file**: the harness.
- **Spike**, **go/no-go criteria written in advance**, **anti-corruption wrapper** as the fallback (ADR-042): the spike.

## Options and trade-offs

**A. HTTP adapter (no ADR decides it).**
- *A1. Express 5 (`@nestjs/platform-express`).* Nest's default and what nearly every guide assumes. `@rekog/mcp-nest` declares `express` as a required peer and Fastify as optional; `@thallesp/nestjs-better-auth`'s README is written for Express first (its Fastify notes have caveats about CORS on auth routes); `instrumentation-express` is in the OTel bundle; supertest takes `app.getHttpServer()` directly. Cons: slower than Fastify in benchmarks, which does not matter at this site's traffic.
- *A2. Fastify 5 (`@nestjs/platform-fastify`).* Faster, and pino is its native logger. Cons: OTel needs `@fastify/otel` outside the bundle; two of the four spiked integrations treat it as the second path; supertest needs `await app.getHttpAdapter().getInstance().ready()` first; every later WP pays a small "how does this work on Fastify" tax.
- Recommendation: A1. The adapter is chosen once in `configureApp` and could change later in one place.

**B. Typed access to config (ADR-007 fixes `@nestjs/config` plus Zod).**
- *B1.* `ConfigModule.forRoot({ isGlobal: true, validate: (env) => loadConfig(apiEnv, env) })` and inject `ConfigService<ApiEnv, true>` (`config.get("PORT", { infer: true })`).
- *B2.* The same validation, plus an abstract class `ApiConfig` provided with the parsed object (`{ provide: ApiConfig, useValue: parsed }`), so providers inject `ApiConfig` and read `config.port`. Matches the "ports are abstract classes and DI tokens" convention of ADR-003 and keeps string keys out of code.
- Both parse before `NestFactory.create`, so a bad environment never builds a module. `.env` loading in dev uses Node's `--env-file-if-exists=.env` instead of `@nestjs/config`'s dotenv, so the same file feeds the instrumentation entry. Recommendation: B2.

**C. Where health lives.** ADR-003 lists `platform/health` as a layered module inside each service; the report puts health in `platform-nest`. *C1.* `platform-nest` ships `HealthModule.forRoot({ readiness: [...] })` with the controller and the shutdown flag; each service registers its own checks (`api` registers its Postgres check from `src/modules/platform/`). *C2.* Each service writes its own controller from a template. Recommendation: C1: the endpoints and status codes must be identical across services for Compose and Uptime Kuma, the checks are service-specific.

**D. The database check before WP-10 chooses the driver.** Readiness needs a connection now; Drizzle and the driver decision belong to WP-10.
- *D1. `pg` (node-postgres) 8.23.1.* OTel has `instrumentation-pg` in the bundle; Better Auth and LangGraph's Postgres checkpointer also use `pg`; Drizzle supports it. Picking it here effectively decides WP-10's driver.
- *D2. `postgres` (postgres.js) 3.4.9.* Fast and pleasant, but no instrumentation in the OTel bundle, and a second driver would appear once Better Auth or the checkpointer arrives.
- *D3. No database check in WP-3*: readiness returns 200 until WP-10. Honest about scope, but the trace and the Testcontainers harness would then have nothing real to test.
- Recommendation: D1, recorded as a WP-3 decision that WP-10 inherits.

**E. Health response on failure vs one error format.** *E1.* Health keeps the Terminus body (a controller-scoped filter wins over the global one), which is what Terminus users and Uptime Kuma keyword checks expect. *E2.* Everything, health included, is problem+json: `503` with `type .../dependency-unavailable` and the per-check result as an extension. Recommendation: E1: health is an operations contract, not an API error, and keeping it plain avoids surprising tools; RFC 9457 stays the rule for every other route.

**F. How OpenTelemetry is wired (ADR-010 chose OTLP to a hosted tier and left `@nestjs/observe` as a verify).**
- *F1. `NodeSDK` from `@opentelemetry/sdk-node` with an explicit list of instrumentations* (http, express, pg, pino; amqplib in WP-5), loaded with `--import`. Small and explicit: you can name every patch.
- *F2. `@opentelemetry/auto-instrumentations-node/register`.* One line, but it loads about forty instrumentations (and resource detectors) the services do not use, which costs startup time and memory on an 8 GB box.
- *F3. `@nestjs/observe` 0.3.x.* Per its README, a SaaS agent that ships its own wire format to `observe-api.nestjs.com` with an app key and secret, free up to 300,000 events a month. It names spans after Nest classes, which is attractive, but it does not export OTLP, so it does not satisfy ADR-010's decision, and it has no amqplib propagation, which ADR-010 needs across the broker. Using it would need a new ADR.
- Recommendation: F1. Controller-level spans depend on spike row 6; if `instrumentation-nestjs-core` does not patch Nest 12, HTTP and Express spans still carry `http.route`, which is enough for R0.

**G. Where the module template lives.**
- *G1. Documentation plus real modules.* `docs/architecture/module-template.md` with the two folder trees and a sample of each file kind, pointing at `platform/health` in `api` as the layered example; the first hexagonal module (`content`, WP-12) becomes the living example. Cheap; can drift until WP-12.
- *G2. A generator.* `turbo gen` (`@turbo/gen`, Plop templates under `turbo/generators/`) or a Nest CLI schematic writes a new module with names filled in. Consistent; one more tool and templates that are not type-checked.
- *G3. A copyable, checked folder.* `templates/nest-module/{layered,hexagonal}/` with real `.ts` files (a `Widget` entity, a `WidgetRepository` port, an in-memory adapter, a use case with its unit test, a controller), type-checked by a small tsconfig and covered by the dependency-cruiser rules (their path patterns must be widened from `^(apps|packages)/` to include `templates/`). Cannot rot, because `pnpm verify` checks it. Cost: the depcruise and Turborepo config grow a little; the learning gate should cover the folder.
- Recommendation: G3 with a short README; a generator later only if copying becomes a chore.

**H. Testcontainers harness shape.** *H1.* One container per `pnpm test:int` run (Vitest `globalSetup`), one database per test file, opt-in container reuse locally (`TESTCONTAINERS_REUSE_ENABLE=true`). *H2.* One container per test file: simplest isolation, but about 2 to 4 s of startup per file (illustrative). Recommendation: H1. The image tag is a constant in the harness, and a unit test asserts it equals the tag in `compose.dev.yml`, so dev and tests cannot drift.

**I. How the spike is run and recorded.**
- *I1. Throwaway branch and scratch app.* `spike/wp-3-nest12` with a scratch package, never merged; results go into this explainer's step log as a table with the verdict per row.
- *I2. Permanent compatibility tests.* Keep one boot test per integration in the repo so a future upgrade that breaks it fails CI. Cons: installs Better Auth, the MCP module and LangChain into the workspace months before their WPs, so their versions and peer warnings become everyone's problem early.
- *I3. Hybrid.* I1 for the code; the result table and verdicts recorded here; a *no-go* or *go with wrapper* that changes a decided library becomes an ADR (`/adr`) before step 3; permanent tests only for what WP-3 ships (config, pino, problem details, health, OTel).
- Recommendation: I3, time-boxed to one day. The rows, written before running anything:

| # | Integration (version) | Pass criteria | Fallback if no-go (named in advance) |
|---|---|---|---|
| 1 | Nest 12.1.x core on Node 24, ESM, Express 5, Vitest 5 | `pnpm install` with no peer warnings and no build-script prompt; app boots; a provider with a constructor dependency resolves under `tsc` output and under Vitest (Oxc) | SWC plugin for Vitest (`unplugin-swc`), or explicit `@Inject()` tokens |
| 2 | `nestjs-pino` 5.3.x, `pino` 10.3.x | logs carry `req_id` from `x-request-id`; `PinoLogger` in a singleton logs with the request id; Nest's bootstrap logs go through pino | a 40-line own module over `pino-http` with ALS |
| 3 | `@golevelup/nestjs-rabbitmq` 9.1.0 | publish to a topic exchange and consume with a manual ack against `@testcontainers/rabbitmq`; publisher confirms on | own adapter over `amqplib` behind the `MessageBus` port (ADR-029 already names it) |
| 4 | `better-auth` 1.7.x + `@thallesp/nestjs-better-auth` 2.8.0 | module mounts on Express with Nest's body parser disabled as its README says; Better Auth's health route answers 200 (route name **verify**); a guarded route returns 401 without a session | mount `toNodeHandler(auth)` on the Express instance directly and write a small own guard (**verify** helper name) |
| 5 | `@rekog/mcp-nest` 2.0.7 with `@modelcontextprotocol/server` 2.x | Streamable HTTP endpoint answers `initialize` and `tools/list` with one tool whose input is a Zod 4 schema | `@modelcontextprotocol/server` and `@modelcontextprotocol/node` directly in a thin Nest controller |
| 6 | OTel `sdk-node` 0.222 with http, express, pg, pino, nestjs-core instrumentations under ESM `--import` | spans for HTTP, Express and pg appear in the console exporter; log lines carry `trace_id`; note whether nestjs-core patches 12 | no controller spans until upstream support; HTTP and Express spans only |
| 7 | `@langchain/core` 1.2.x, `@langchain/langgraph` 1.4.x with Zod 4.6 | a two-node `StateGraph` with a Zod state runs inside a Nest provider and in a plain Node script (no Nest), with LangChain's fake chat model | none expected (no Nest coupling); otherwise pin Zod to a version both accept |
| 8 | Native modules on Node 24 | list every package with an install script in the spike's lockfile; each builds or ships a prebuilt binary for linux-x64 and Node 24; record which need `allowBuilds` in `pnpm-workspace.yaml` | a pure-JS alternative or a pinned prebuilt version |

**J. Dev runner.** *J1.* `nest start --watch` (Nest CLI 12, uses tsc). *J2.* `tsc --watch` plus `node --watch --import ... dist/main.js` in the `dev` script, so dev starts exactly like production. Recommendation: J2, one fewer tool and the same `--import` line everywhere; the owner may prefer J1 if they like the CLI.

### Spike results (step 2, 2026-10-03)

Code: branch `spike/wp-3-nest12`, folder `spike/nest12/` (a standalone pnpm root, never merged). A frozen install exits 0 with no peer warnings; `pnpm peers check` reports no issues.

| # | Installed | Verdict | Evidence |
|---|---|---|---|
| 1 | Nest 12.1.2, TypeScript 6.0.3, Vitest 5.0.3, zod 4.6.5 | go | the app boots from tsc output; a DI test passes under Vitest with no SWC plugin (with `emitDecoratorMetadata: false` the same test fails, so Oxc does read it) |
| 2 | nestjs-pino 5.3.1, pino 10.4.0, pino-http 11.0.0 | go | a singleton `PinoLogger` line carries the id from `x-request-id`; Nest bootstrap lines are pino JSON; an invalid header gets a new UUID |
| 3 | @golevelup/nestjs-rabbitmq 9.1.0, testcontainers 12.2.0 | go | run on the owner's machine (OrbStack): `Tests 2 passed (2)`, a publisher confirm plus ack, and a `Nack(false)` dead-lettered to the DLQ. Testcontainers needed the socket path (`DOCKER_HOST`, or `docker.host` in `~/.testcontainers.properties`) |
| 4 | better-auth 1.7.7, @thallesp/nestjs-better-auth 2.8.0 | go | `GET /api/auth/ok` 200; guarded route 401 without a session, 200 after sign-up; the fallback (`toNodeHandler` from `better-auth/node`) also works |
| 5 | @rekog/mcp-nest 2.0.7, @modelcontextprotocol/server 2.3.0 | go | `initialize`, `tools/list`, `tools/call` answer 200; the tool's input schema comes from Zod 4 |
| 6 | sdk-node 0.222.0, instrumentation-http, -express 0.70.0, -pg 0.74.0, -pino 0.68.0 | go | SERVER span with `http.route=/health/ready`, Express spans, pg error spans against a dead port; log lines carry `trace_id` and `span_id` |
| 6 | instrumentation-nestjs-core 0.68.0 | no-go as published | declares `>=4.0.0 <12`, so it patches nothing on Nest 12; with the range widened by hand it emits controller spans, so only the declared range blocks it |
| 6-pg | same, against `pnpm dev:up` | go | run on the owner's machine: `RESPONSE 200 {"database":"up"}` with spans `pg.connect`, `pg-pool.connect` and `pg.query:SELECT content_dev`. The parent link to the request span was not shown: the console exporter of sdk-node 0.222 prints `parentSpanContext`, not `parentId`, so the filter missed it; step 7 checks it in a test |
| 7 | @langchain/core 1.2.14, @langchain/langgraph 1.4.18 | go | the same two-node graph runs in a plain Node script and inside a Nest provider; one zod in the tree |
| 8 | install scripts | go | `protobufjs` (prints a warning), `ssh2` and `cpu-features` (optional native bindings for Docker over SSH) all set to `false` in `allowBuilds`; ssh2 works without its binding |

Answers to the **verify** items:
- The option is `@Body({ schema })` (also `@Query`, `@Param`), the pipe is `StandardSchemaValidationPipe` from `@nestjs/common`. On failure it throws `BadRequestException` with strings like `"email: Invalid email address"`, which loses the structured path. Its `exceptionFactory(issues)` receives the raw issues, so the problem-details filter gets them from there.
- The ESM hook is `module.register("@opentelemetry/instrumentation/hook.mjs", import.meta.url)`. Without it there are no Express spans.
- `app.close()` order is unchanged in Nest 12: `onModuleDestroy`, `beforeApplicationShutdown`, HTTP server closed, `onApplicationShutdown`.
- `require(esm)` works: CommonJS packages that require `@nestjs/common` load.
- Biome needs `javascript.parser.unsafeParameterDecoratorsEnabled: true` for `@Body()` and `@Inject()`.
- Not checked: the Terminus failure body in 12.1.0 (step 6).

Findings that touch step 3 and later:
- Biome's `style/useImportType` rewrites a class injected only through a constructor type into `import type`, as a "safe fix" that the pre-commit hook applies. `tsc` stays green and the app fails at boot with `Nest can't resolve dependencies of the Consumer (?)`. This is the `verbatimModuleSyntax` trap from First principles, made automatic by a tool. Biome has no decorator-aware option.
- `sdk-node` 0.222 also starts OTLP metric and log exporters to `127.0.0.1:4318` by default, failing silently; `instrumentation-pino` forwards every log record into that log pipeline. Fix, checked: `metricReaders: []`, `logRecordProcessors: []`, `new PinoInstrumentation({ disableLogSending: true })`.
- nestjs-pino puts the id in `req.id` (a top-level `req_id` needs `customProps`), and its default serializer logs `remoteAddress` and all headers in clear: step 4 replaces it.
- For later WPs: `@thallesp/nestjs-better-auth` installs a global guard, so health routes need `@AllowAnonymous()` (WP-13). `@rekog/mcp-nest` 2.x runs as a microservice transport and needs `@nestjs/microservices` (WP-36). golevelup's default subscribe error behavior is `REQUEUE`, which can loop forever, and `app.init()` blocks while the broker is down even with `wait: false` (WP-5).

## The question for the owner

Answer each with a letter (or "your call"); the recommendation is in brackets.

1. **HTTP adapter (A):** Express 5 or Fastify 5? [A1, Express.]
2. **Typed config (B):** `ConfigService<Env, true>` or an `ApiConfig` abstract class provided with the parsed object? [B2.]
3. **Database driver for readiness (D):** `pg` now (and WP-10 inherits it), postgres.js, or no database check until WP-10? [D1, `pg`.]
4. **Health on failure (E):** keep the Terminus body, or problem+json everywhere? [E1, Terminus body for `/health/*` only.]
5. **OpenTelemetry wiring (F):** `NodeSDK` with an explicit instrumentation list, the auto-instrumentation bundle, or `@nestjs/observe` with a new ADR? [F1.]
6. **Module template (G):** documentation only, a generator, or a checked `templates/nest-module/` folder? [G3.]
7. **Spike (I):** throwaway code with results recorded here and ADRs for any fallback, permanent compatibility tests, or both? Are the eight rows and their fallbacks the right ones? [I3, one day, rows as listed.]

C (health module in `platform-nest`, checks per service), H (one container per run, a database per test file) and J (tsc watch plus `node --watch`) have a clear default; say so if you want any changed. Proposed ports: `api` 3001 (web keeps 3000).

**Proposed steps.** Each step ends with a green `pnpm verify` and one scoped commit (`feat(platform-nest): ...`, `feat(api): ...`), and two lines in the step log.

1. *Explainer and decision* (learning): this file; `decision: recorded`; an ADR only if an answer changes an accepted ADR (F3 would).
2. *Compatibility spike* (learning): one day on `spike/wp-3-nest12`, never merged; the result table and verdicts appended to the step log; any no-go or wrapper becomes an ADR before step 3.
3. *Platform package and `api` boot* (learning): `packages/platform-nest` (compiled), `apps/api` on ESM Nest 12 with the chosen adapter, `loadConfig` with fail-fast and its unit tests, `configureApp`, Biome's parameter-decorator flag, a DI test under Vitest.
4. *Logging* (learning; the owner may mark it `known` if `pino-http` with ALS is familiar): `nestjs-pino`, request ids, redaction, hashed IPs, health log levels.
5. *Errors and validation* (learning): global `StandardSchemaValidationPipe`, `ProblemDetailsFilter`, the fixture controller and the end-to-end test of trace 2.
6. *Health and the Testcontainers harness* (learning): `/health/live`, `/health/ready` with the Postgres check, shutdown flag, `vitest.int.config.ts`, `globalSetup`, `pnpm test:int`, the tag-drift test, trace 1 as an integration test.
7. *OpenTelemetry bootstrap* (learning): the `instrumentation` entry, console and OTLP exporters, log correlation, the `--import` start line in `dev` and `start`.
8. *Module template and docs* (the owner may mark it `known`): the template per G, depcruise and gate paths widened, `apps/api/AGENTS.md`, AGENTS.md section 3 (`pnpm test:int`), coverage gates confirmed for `platform-nest` and `api`.

Say which steps you already know (D-38 fast path): step 4 and step 8 are the candidates.

## Decision

Answers as the owner gives them. `decision: recorded` is set after question 7.

1. HTTP adapter: **A1, Express 5** (2026-10-03). The owner also has more experience with Express.
2. Typed config: **B2, an `ApiConfig` abstract class provided with the parsed object** (2026-10-03).
3. Database driver for readiness: **D1, `pg`** (2026-10-03). WP-10 inherits it. The owner uses `pg` at work and wants to learn it in depth.
4. Health on failure: **E1, the Terminus body for `/health/*`**; problem+json for every other route (2026-10-03). Health is an operations contract, not an API error.
5. OpenTelemetry wiring: **F1, `NodeSDK` with an explicit list** (http, express, pg, pino; amqplib in WP-5) loaded with `node --import` (2026-10-03). Within ADR-010; no new ADR.
6. Module template: **G3, `templates/nest-module/{layered,hexagonal}/`**, type-checked and covered by dependency-cruiser (2026-10-03).
7. Spike: **I3, one day, the eight rows as listed** (2026-10-03). Throwaway code on `spike/wp-3-nest12`; results in the step log; a no-go or wrapper that changes a decided library becomes an ADR before step 3.

Defaults kept: C (health module in `platform-nest`, checks per service), H (one Postgres container per `pnpm test:int` run, one database per test file), J (`tsc --watch` plus `node --watch`), `api` on port 3001. No step marked known. No accepted ADR changes at decision time (ADR-043 came later, see the amendments).

`decision: recorded` on 2026-10-03.

Amendments after the spike (2026-10-03):

- S1, Biome on Nest code: **a**. A `biome.json` override for the Nest paths (`apps/api`, `apps/agent`, `apps/contact`, `apps/mcp`, `packages/platform-nest`, `templates/`) enables parameter decorators and turns `style/useImportType` off there, with a note in `.claude/rules/`. The rule stays on everywhere else.
- S2, Nest controller spans: **a**, the fallback named before the spike: HTTP and Express spans only (they carry `http.route`), no patch. Revisit when `instrumentation-nestjs-core` declares Nest 12.
- ADR-007 and `@nestjs/config` (2026-10-04): the code from step 3 uses an own `loadConfig`, not `@nestjs/config` as ADR-007 says, and the explainer had not raised it. The owner prefers the own loader (validation before `NestFactory.create`, one loader for the app and the OTel entry, typed `ApiConfig`): **ADR-043** supersedes ADR-007 on the config library and restates the secrets decision unchanged.
- Nest 11 instead of 12? The owner asked to move to Nest 11 if it is more stable, to avoid a pile of workarounds. Answer: stay on 12. Of the spike findings only one comes from Nest 12 (the controller spans range), and S2 a needs no code for it. The Biome `import type` trap, the decorator parser flag and the OTel exporters behave the same on Nest 11. Nest 11 has no Standard Schema support, so ADR-006's validation would need an own Zod pipe or another library, and ADR-042 would need a superseding ADR. Workarounds in the plan: none patched; two configuration lines (Biome override, OTel exporters off).

## Step log

- Step 2, spike: throwaway code on `spike/wp-3-nest12` tested the eight rows on Nest 12; results under Options, "Spike results". Rows 1, 2, 4, 5, 7, 8 go; row 6 go except Nest controller spans; rows 3 and 6-pg wait for Docker on the owner's machine.
- Why it matters: no library decided by an ADR fails, so no ADR changes. Row 3 passed later on the owner's machine. Two traps surfaced before any real code (Biome's `import type` fix breaks DI, the OTel SDK exports metrics and logs nobody asked for).

- Step 3, platform package and `api` boot: `packages/platform-nest` (compiled to `dist/`, Nest as peer dependencies so there is one copy of `@nestjs/core`) with `loadConfig`, `platformEnv` and `configureApp`; `apps/api` validates its environment before `NestFactory.create` and provides `ApiConfig` globally; the Biome override for Nest paths. A bad environment now exits in about 290 ms with `PORT: Invalid input: expected string, received undefined`, and the DI test proves an abstract-class token resolves under Vitest.
- Why: everything after this builds on one boot path, and a deploy with a missing variable fails at the container start, not on the first request. Found on the way: Nest exits the process when no HTTP adapter is installed (even in a test), `@nestjs/common` already imports `reflect-metadata`, and Biome's `noStaticOnlyClass` flags the `forRoot()` pattern.

- Step 4, logging: `LoggingModule.forRoot()` in `platform-nest` over nestjs-pino; one JSON line per request with `service`, `req_id` (a valid `x-request-id` is reused and echoed, anything else becomes a UUID), method, URL, status and time; Nest's boot lines go through pino; health probes log at `debug`, 4xx at `warn`, 5xx at `error`; pino-pretty only when `NODE_ENV=development`. Tests read the lines from an in-memory stream.
- Why: a request id ties every line of one request together, including lines from singleton providers (AsyncLocalStorage, no request-scoped providers). Headers, bodies and the client IP are not logged at all (owner's choice for WP-3; the hashed IP arrives with the per-IP limits of WP-11), and the auth headers are also redacted as a second guard.

- Step 5, errors and validation: `configureApp` adds the global `StandardSchemaValidationPipe` with an `exceptionFactory` that keeps Zod's issues as `RequestValidationException`, and the global `ProblemDetailsFilter`: 400 `validation-failed` with one JSON Pointer per field, 4xx HTTP exceptions as `about:blank` with their message, anything else a generic 500 whose stack goes only to the `error` log line with the request id. Trace 2 runs as an end-to-end test against a fixture controller; `api` answers an unknown route with a 404 problem.
- Why: one error shape for every route and every service, so clients and the admin parse one format; the pipe's default message (`"email: Invalid email address"`) lost the field path, which is why the factory hands the filter the raw issues. `type` URIs under `https://jadero.dev/problems/` are used now; their public pages come with the web (owner's choice).

- Step 6, health and the Testcontainers harness: `HealthModule.forRoot({ imports, checks })` in `platform-nest` (Terminus; `ReadinessCheck` is an abstract-class port; a shutdown flag flips readiness to 503 in `beforeApplicationShutdown`; each check has a 1 s timeout; the Terminus body kept by a controller-scoped filter, E1). `api` registers `PostgresReadinessCheck` (`SELECT 1` on a `pg` pool of 2, closed in `onApplicationShutdown`) and reads `DATABASE_URL`. `pnpm test:int` runs `*.int.test.ts` with one `pgvector/pgvector:0.8.7-pg18` container per run and one database per file; a unit test keeps that tag equal to `compose.dev.yml`. With Postgres down, `api` boots, `/health/live` is 200 and `/health/ready` is 503 with `{"database":{"status":"down","message":"unavailable"}}`.
- Why: liveness answers "restart me?" and must not depend on the database; readiness answers "send me traffic?" and must. The failure cause (`ECONNREFUSED 127.0.0.1:5432`) goes to a `warn` log line, never into the body, because the health endpoint may be reachable from outside. Passing probes log at `debug`, failing ones at `warn`. The integration test needs Docker, so it runs on the owner's machine.

## Recap
