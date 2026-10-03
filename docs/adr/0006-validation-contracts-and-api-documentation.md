---
id: ADR-006
title: "Validation, contracts and API documentation"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-6]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-006: Validation, contracts and API documentation")
---

# ADR-006: Validation, contracts and API documentation

**Status:** Accepted with a change (owner review 2026-10-03, D-6): OpenAPI generation automated (WP-51).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-6). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Nest 12 accepts Standard Schema validators (Zod, Valibot, ArkType) through a `schema` option on `@Body()`, `@Query()`, `@Param()`, activated by registering `StandardSchemaValidationPipe`; responses can be validated and shaped by `StandardSchemaSerializerInterceptor`. class-validator remains supported. LangGraph's `StateSchema` and LangChain tool inputs also take Zod.

## Considered options

- *Zod via Standard Schema, schemas in `packages/contracts`.* Pros: one schema language from the admin forms, through the API, to agent tool inputs and env config; types inferred once. Cons: OpenAPI generation from Zod needs a bridge (for example zod-to-openapi) unless `@nestjs/swagger` gained Standard Schema support in v12 **(verify at WP time)**.
- *class-validator + class-transformer DTOs.* Pros: Nest's classic path, Swagger decorators integrate. Cons: classes cannot be shared with the browser cleanly; duplicate schemas for forms and tools.
- *nestjs-zod (community).* Pros: worked before v12. Cons: superseded by the native support.

## Decision

Zod via Standard Schema, contracts package as the single source, OpenAPI document generated from the same schemas and published at `/api/docs` (non-production) for the showcase.

## Consequences

Errors returned as RFC 9457 problem details (`application/problem+json`) from one exception filter.

## Change (owner review 2026-10-03, D-6)

OpenAPI is generated, never hand-written: `@nestjs/swagger` 12 reflects the Standard Schemas passed to Nest 12's decorators into the document through a `standardSchemaConverter`, with `zod-openapi` for Zod **(verify option names at WP time)**. Each service builds `openapi.json` in CI; a docs UI is served outside production; a breaking-change check (for example oasdiff) compares the document against `main` and fails the PR on a breaking change; AsyncAPI keeps covering events. This is WP-51.
