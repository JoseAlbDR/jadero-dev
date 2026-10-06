# Nest module template

Two module shapes for the Nest services (ADR-003, WP-3 decision G3). The files are real TypeScript: `pnpm verify` type-checks them, runs their tests and checks them against the architecture rules, so the template cannot drift from what the rules accept.

## Which shape

- **Layered** (`src/modules/notes/`): controller, application service, repository, `index.ts`. For modules with no rules worth protecting: health, revalidation, cv.
- **Hexagonal** (`src/modules/widgets/`): `domain/`, `application/` (use cases and ports), `infrastructure/` (adapters), `presentation/` (controllers), the module file and `index.ts`. For modules with rules: content, auth, knowledge, chat, usage, submissions.

## How to use it

1. Copy the folder of the shape you need into `apps/<service>/src/modules/<name>/`.
2. Rename `Note`/`Widget` and their files; keep the folder names and the `index.ts`.
3. Move request schemas to `packages/contracts` (ADR-006); bind the Drizzle adapters in the module file (below).
4. Import the module in the service's `AppModule`; other modules import only from its `index.ts`.
5. Keep the tests next to the code: domain rules and use cases with fakes at the ports (ADR-009); Testcontainers for adapters that touch SQL.

## Data access (WP-10)

### Hexagonal: repository and unit of work

`application/` holds two ports, both abstract classes and DI tokens (ADR-003): `WidgetRepository` (`findById`, `save`) and `WidgetsUnitOfWork` (`run(work)`). `infrastructure/` holds two adapters for each: Drizzle (`DrizzleWidgetRepository`, `DrizzleWidgetsUnitOfWork`) and in-memory fakes (`InMemoryWidgetRepository`, `InMemoryWidgetsUnitOfWork`). The table is `infrastructure/widget.schema.ts`, in a Postgres schema named after the module; the service's `drizzle.config.ts` glob picks it up and `db:generate` writes the migration. Ids come from the `IdGenerator` port; its adapter `UuidV7IdGenerator` gives UUIDv7 (`uuidv7` from `@jadero/messaging`, the generator of the event ids), so new rows land at the end of the primary key index.

The unit of work rule (ADR-012, WP-10 Decision):

- Every write runs inside `uow.run(async ({ widgets }) => ...)`, through the scope's repositories. `run` commits when the work resolves and rolls everything back when it throws. A write outside `run` is a review finding.
- A read that feeds a write of the same aggregate (load, change, save) also runs inside `run`.
- A read that only displays data (a list, a page) uses the constructor-injected `WidgetRepository`, outside any transaction, so it never holds one open.
- A second write in the same use case joins the same `run`: when a module publishes an event, its outbox row (`addToOutbox` from `@jadero/messaging` on the transaction's `executor`) goes into the scope next to `widgets`, so the change and the event commit together.

### Bind the Drizzle adapters in a service

The template binds the in-memory adapters so it boots without a database. In a service, the root module already imports `DatabaseModule.forRoot(...)` from `@jadero/platform-nest` (global: it provides `DRIZZLE` and `PG_POOL`), and the module file binds:

```ts
{ provide: WidgetRepository, useClass: DrizzleWidgetRepository },
{ provide: WidgetsUnitOfWork, useClass: DrizzleWidgetsUnitOfWork },
```

`test/wiring.test.ts` resolves exactly that binding without a database (the pool connects lazily).

### Contract suites

`application/widget.repository.contract.ts` and `application/widgets.unit-of-work.contract.ts` export `widgetRepositoryContract(name, make)` and `widgetsUnitOfWorkContract(name, make)`. Every adapter runs them: the in-memory fakes and the use-case test's own fakes in `pnpm verify`, the Drizzle adapters on real Postgres in `pnpm test:int` (`test/widgets.int.test.ts`: the table is generated from the schema file by drizzle-kit's diff, in a database owned by an ordinary role, as in production). A fake that passes the same suite as the real adapter can be trusted in use-case tests (ADR-009).

### Layered: no port

A layered module (health, the ping, the heartbeat) has no unit of work port: it calls platform-nest's `withTransaction(pool, ({ db, executor }) => ...)` directly, and its repository takes the transaction's `db` as an argument. Never `BEGIN` by hand.

## What the rules enforce here

| Rule (`.dependency-cruiser.cjs`) | What breaks it |
|---|---|
| `domain-imports-only-domain` | a `domain/` file importing Nest, Zod, any npm package or another layer |
| `application-never-imports-infrastructure` | a use case importing an adapter instead of its port |
| `modules-import-through-index` | another module importing a file inside this one |
| `no-circular` | two files importing each other, directly or not |

Nest specifics (`.claude/rules/nest.md`): classes that Nest injects are imported as values, never `import type`; relative imports end in `.js`.
