# Study backlog

Topics to study in depth, outside the work packages, with Matt Pocock's `teach` skill (github.com/mattpocock/skills, run from the owner's local profile in a separate `study/` folder, since it writes its own files where it runs). The work packages keep their own flow; this file only collects what they surface.

## How it fills

- A line is added in the step where it shows up (`/step` step 6): a check question or explain-back answered wrong or partly (**weak**), something the owner found worth more time (**interesting**), or something the main session recommends studying in depth because it recurs in other projects and interviews (**recommended**).
- Lines go under a **theme**, not under a WP. A new topic close to an existing one joins that theme instead of opening a new one. `/wrap-wp` (step 8c) merges duplicates and marks what the explain-back showed is now solid.
- Each line: topic, WP, kind, link to the step log entry, optional resource.

## How it is used

- One `/teach` run per closed release, on that release's open themes, two to four themes per run: as few runs as possible for as much learning as possible. A theme with one small topic waits for the next release instead of getting its own run.
- Between runs, each `/step` opens with one warm-up recall question on an open line (`/step` step 2): a right answer marks it `solid <date> (warm-up)`, a wrong one `weak again <date>`, so the weakest lines show before the `/teach` run.
- After the run, the studied lines are marked `studied <date>`; what the run showed is still weak stays open.
- At the end of the project, one last run on whatever is left, plus a review pass of the themes marked weak more than once.

## R1 (open)

### Theme: transaction boundaries and atomicity
- Why the outbox cannot be a central service: the outbox row must commit in the same Postgres transaction as the business change; a network call is the dual write again. WP-10, weak (Q1 discussion). `docs/learning/wp-10.md`, Decision.
- Unit of work versus TypeORM's `EntityManager`; reads that feed a write inside the transaction, lost update, optimistic concurrency. WP-10, interesting (Q2 discussion). Decision.
- The inbox row and the consumer's effect commit or roll back together; a separate inbox commit turns a retry into a dropped duplicate (idempotency without atomicity loses messages). WP-10, weak (step 5 check question), solid 2026-10-07 (explain-back Q1). Step log.
- When a port pays for itself: layered versus hexagonal, speculative generality, fakes that drift without a contract suite. WP-10, interesting (step 5 layered decision). Decision.
- Fakes versus mocks, and test double drift: a fake is trustworthy only in what the shared contract suite checks; the rest belongs to integration tests (test pyramid). WP-10, weak on the remedy, the risk was right (step 6 check question). Step log.
- Extracting a module into its own service: no cross-module foreign keys, no transaction across databases, events and read models instead, eventual consistency and sagas. WP-10, weak (explain-back Q3). Recap.

### Theme: migrations as append-only history
- An edited applied migration is skipped silently; schema drift between environments. WP-10, weak (step 3 check question). Step log.
- `drizzle-kit generate` diffs schema files against the last snapshot and never reads the database; the runtime migrator keeps `drizzle.__drizzle_migrations`. WP-10, weak (step 4 check question). Step log.

### Theme: ordering and pagination
- Keyset (cursor) pagination with `(created_at, id)` and a composite index; why time-ordered ids are a storage optimization, not a meaningful order; `now()` is the transaction start, so `created_at` order is not commit order. WP-10, interesting (step 8 check question). Step log.

### Theme: process health and startup
- Liveness versus readiness probes (the owner had them swapped). WP-10, weak (step 2 check question). Step log.
- Fail fast at boot versus lazy connection plus readiness, and when each wins. WP-10, recommended. Step log.
