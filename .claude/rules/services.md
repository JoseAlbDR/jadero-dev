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

- Hexagonal module layout where there are rules: `domain/` (no Nest, no Drizzle imports), `application/` (use cases, ports as abstract classes), `infrastructure/` (Drizzle repositories, provider adapters), `presentation/` (controllers, SSE, MCP tools). Trivial modules (health, revalidation, cv) stay layered: controller, application service, repository.
- New modules start as a copy of `templates/nest-module/` (layered or hexagonal); `apps/<service>/AGENTS.md` describes the service.
- A module talks to another module only through its `index.ts`. A service never reads another service's tables.
- Every state change that must be seen by another service writes an outbox row in the same transaction; a relay publishes it with confirms. Every consumer records the event id in its `inbox` table in the same transaction as its effects, and tolerates duplicates.
- Events: CloudEvents envelope, type `dev.jadero.<context>.<event>.v<N>`, Zod schema in `packages/contracts`, example fixture next to it, backward-compatible changes only (expand/contract). A breaking change is a new version published alongside the old one.
- Every call to an external provider (AI, mail) goes through a port with a timeout, retry and circuit breaker (cockatiel) in the adapter, never in a use case (ADR-029). Broker calls get a timeout and no breaker: the outbox relay backs off per row and consumers retry through the wait queues, and no request waits on the broker (WP-5 decision, 2026-10-04).
- Errors leave a service as RFC 9457 problem details from one exception filter. Config is read through a Zod-validated config module; no `process.env` elsewhere.
- Internal endpoints called by edge adapters (`apps/mcp`, later the gateway) live under `/internal/*`, are reachable only on the Docker network, and verify the signed internal header (ADR-008).
