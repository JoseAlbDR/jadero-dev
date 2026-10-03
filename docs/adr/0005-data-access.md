---
id: ADR-005
title: "Data access (ORM)"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-5]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-005: Data access (ORM) (amended 2026-10-02)")
---

# ADR-005: Data access (ORM)

**Status:** Accepted (owner review 2026-10-03, D-5).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-5). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Postgres with pgvector for the RAG index, plus relational content with translations and revisions. The owner should learn SQL, migrations and transactions, not hide them.

## Considered options

- *Drizzle ORM + drizzle-kit.* Pros: schema is plain TypeScript, queries read like SQL, no runtime engine or codegen; native `vector` column type, HNSW/IVFFlat index definitions and `cosineDistance`/`l2Distance` helpers since drizzle-orm 0.31.0 / drizzle-kit 0.22.0; migrations are generated SQL files you review and commit; full-text search via `sql` template. Cons: fewer guard rails than Prisma (you can write a bad join); no official Nest module, so a ~20-line provider (which teaches DI).
- *Prisma.* Pros: polished DX, strong typing, migrations. Cons: Prisma 7 represents `vector` as `Unsupported`, so every vector query is raw SQL; Prisma 8 is in release candidate (8.0.0-rc.19 on 2026-09-30, GA expected October 2026) with breaking package moves, so starting now means starting on a moving target; the DSL hides the SQL the owner wants to learn.
- *TypeORM.* Pros: the owner already uses it professionally (least new). Cons: decorator-heavy entities, weaker type inference, no first-class pgvector; teaches the least.
- *Kysely or raw `pg`.* Pros: maximal SQL control. Cons: you hand-roll migrations and schema typing.

## Decision

Drizzle. Repositories in `infrastructure/` wrap Drizzle so use cases never see it.

## Consequences

Migration workflow: `drizzle-kit generate` produces SQL, reviewed in the PR, applied by a one-off `migrate` container before the service starts (ADR-026); each service owns its migrations and runs them only against its own database (amended 2026-10-02). Extensions (`vector`, `pg_trgm` if needed) enabled in the first migration.
