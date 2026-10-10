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
- Which invariants belong in the database (keys, FKs, single-row checks, anything racy as check-then-act) and which stay in the domain (state-dependent, cross-table, inside a document), and what a trigger would cost; the owner wanted a constraint for a rule a CHECK cannot read. WP-12, weak (step 5a check question). `docs/learning/wp-12.md`, Step log.
- One aggregate per transaction: the unit of work is the use case's consistency boundary; independent aggregates get their own run, the aggregate and its outbox row share one, batches commit per item and report failures. WP-12, interesting (owner asked after the step 5b check question). `docs/learning/wp-12.md`, Step log.
- How a unique index serializes concurrent inserts (the second waits on the first's uncommitted row) and what `ON CONFLICT` absorbs with and without a target; the owner thought two singleton creates with different ids both succeed. WP-12, weak (step 5c check question). `docs/learning/wp-12.md`, Step log.
- The version as a concurrency token: it guards what the caller saw, not who else wrote, so a caller that reuses a stale `expectedVersion` after its own write is refused like another tab; reload and retry, `If-Match` and `412` over HTTP. WP-12, weak on the why (step 6 check question). `docs/learning/wp-12.md`, Step log.
- Database roles as a security boundary: grants table by table, a separate login role versus `SET ROLE` (undoable from inside the session), session settings such as `default_transaction_read_only` as bug guards rather than barriers, views or row-level security to hide rows. WP-12, weak on the scope of the grant (step 7a check question). `docs/learning/wp-12.md`, Step log.
- Extracting a module into its own service: no cross-module foreign keys, no transaction across databases, events and read models instead, eventual consistency and sagas. WP-10, weak (explain-back Q3). Recap.

### Theme: migrations as append-only history
- An edited applied migration is skipped silently; schema drift between environments. WP-10, weak (step 3 check question). Step log.
- `drizzle-kit generate` diffs schema files against the last snapshot and never reads the database; the runtime migrator keeps `drizzle.__drizzle_migrations`. WP-10, weak (step 4 check question). Step log.

- Untrusted Postgres extensions: who creates them (provisioning as superuser) versus who asserts them (the service's migration as owner); environment parity between the test harness and provisioning; least privilege for migration roles. WP-12, weak (step 1 check question). `docs/learning/wp-12.md`, Step log.

### Theme: ordering and pagination
- Keyset (cursor) pagination with `(created_at, id)` and a composite index; why time-ordered ids are a storage optimization, not a meaningful order; `now()` is the transaction start, so `created_at` order is not commit order. WP-10, interesting (step 8 check question). Step log.

### Theme: process health and startup
- Liveness versus readiness probes (the owner had them swapped). WP-10, weak (step 2 check question). Step log.
- Fail fast at boot versus lazy connection plus readiness, and when each wins. WP-10, recommended. Step log.
- A lazy pool boots without its database, so readiness must check every dependency a request needs, or a broken one passes the deploy and fails every request (the owner thought the deploy would fail before the reader check existed). WP-12, weak (step 7b check question). `docs/learning/wp-12.md`, Step log.

### Theme: state machines and approval
- Approval bound to a revision: the state describes the latest revision, the pointer what is live, and a withdraw acts on the entry (pointer cleared), not on the newest draft; undoing an edit is a new revision, never a withdraw (the owner thought withdraw discarded the draft and the visitor would see it). WP-12, weak (step 4 check question). Step log.

### Theme: domain modeling and architecture styles
- DDD strategic versus tactical: bounded contexts, ubiquitous language and context map (services, `GLOSSARY.md`, events and read models) versus aggregates, value objects, repositories and domain events (the `content` module); rich versus anemic domain model, transaction script and active record, and when each wins; how DDD, hexagonal, light CQRS and event-driven coexist, and why trivial modules stay layered (ADR-003). WP-12, interesting (owner asked after step 4). Step log.
