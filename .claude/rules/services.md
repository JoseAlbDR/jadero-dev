---
paths:
  - "apps/api/**"
  - "apps/agent/**"
  - "apps/contact/**"
  - "apps/mcp/**"
  - "packages/messaging/**"
  - "packages/contracts/**"
---
# Service rules (ADR-003, ADR-012, ADR-029)

- Hexagonal module layout where there are rules: `domain/` (no Nest, no Drizzle imports), `application/` (use cases, ports as abstract classes), `infrastructure/` (Drizzle repositories, provider adapters), `presentation/` (controllers, SSE, MCP tools). Trivial modules (health, revalidation, cv) stay layered: controller, application service, repository. Transactions (WP-10 Q2): a layered module calls `withTransaction` directly; a hexagonal module goes through a unit of work port (abstract class in `application/`, Drizzle adapter in `infrastructure/`).
- New modules start as a copy of `templates/nest-module/` (layered or hexagonal); `apps/<service>/AGENTS.md` describes the service.
- A module talks to another module only through its `index.ts`. A service never reads another service's tables.
- Every state change that must be seen by another service writes an outbox row in the same transaction, on that transaction's executor and never on the pool (a write on another pool connection autocommits and survives the rollback, so the relay would publish a phantom event); a relay publishes it with confirms. Every consumer records the event id in its `inbox` table in the same transaction as its effects, and tolerates duplicates.
- Migrations (ADR-027, WP-10): the schema files are the source; `db:generate` writes the SQL and `db:migrate` applies it, and unit tests fail when the schema drifts from the last snapshot. Never edit an applied migration (write a new one), never `drizzle-kit push`, no `CREATE INDEX CONCURRENTLY` (migrations run in one transaction), and a migration never needs a superuser (extensions are created outside it).
- Data (WP-10): each module keeps its tables in its own Postgres schema (`pgSchema("<module>")`), read only by its `infrastructure/`; columns are snake_case through Drizzle's `casing`. Ids are UUIDv7 from the `IdGenerator` port, not from a Postgres default: time-ordered for index locality, not a meaningful order (ids from the same millisecond come out in random order). `created_at` is `timestamptz` with `defaultNow()`, which is the transaction start, not the commit time. A list ordered or paginated by time uses keyset pagination on `(created_at, id)` with a composite index and `id` as the deterministic tiebreaker, never `OFFSET`.
- Events: CloudEvents envelope, type `dev.jadero.<context>.<event>.v<N>`, Zod schema in `packages/contracts`, example fixture next to it, backward-compatible changes only (expand/contract). A breaking change is a new version published alongside the old one. A new event also gets a card in the event catalog and its path in the event flow graph of `docs/architecture/code-map.html` (section 8: producer, exchange, consumer queues, tables), so the owner sees how every event travels.
- Every call to an external provider (AI, mail) goes through a port with a timeout, retry and circuit breaker (cockatiel) in the adapter, never in a use case (ADR-029). Broker calls get a timeout and no breaker: the outbox relay backs off per row and consumers retry through the wait queues, and no request waits on the broker (WP-5 decision, 2026-10-04).
- Errors leave a service as RFC 9457 problem details from one exception filter. Config is read through a Zod-validated config module; no `process.env` elsewhere.
- Internal endpoints called by edge adapters (`apps/mcp`, later the gateway) live under `/internal/*`, are reachable only on the Docker network, and verify the signed internal header (ADR-008).
