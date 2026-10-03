---
id: ADR-004
title: "NestJS major version and module system"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-4]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-004: NestJS major version and module system")
---

# ADR-004: NestJS major version and module system

**Status:** Accepted (owner review 2026-10-03, D-4).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-4). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

NestJS 12.0.0 shipped on 2026-08-27 (12.1.1 on 2026-09-28): ESM packages, Standard Schema validation, `@nestjs/observe`, rebuilt CLI, Vitest as default test runner for ESM projects, Node 20.19+ or 22.12+ required. NestJS 11 is the mature line.

## Considered options

- *Nest 12, ESM, Vitest.* Pros: current, aligned with Next and the LangChain packages (ESM-first), Zod validation without extra libraries, faster tests, five years of runway. Cons: one month old; third-party Nest modules (Better Auth integration, `@rekog/mcp-nest`, pino module) may not have declared v12 support yet **(verify at WP time)**.
- *Nest 11, CommonJS, Jest.* Pros: everything in the ecosystem works today. Cons: starts the project on the previous major; a migration WP later; CJS/ESM interop friction with ESM-only AI packages.

## Decision

Nest 12 on Node 22 LTS, ESM, Vitest. Fallback rule written into the ADR: if a needed integration fails on 12 in the skeleton WP, pin that integration to a thin own wrapper rather than downgrading Nest.

## Consequences

WP-3 includes a compatibility spike (auth library, pino, MCP module, LangChain packages) before features build on it.
