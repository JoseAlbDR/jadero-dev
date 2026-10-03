---
id: ADR-001
title: "Monorepo tooling"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-1]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-001: Monorepo tooling (amended 2026-10-02)")
---

# ADR-001: Monorepo tooling

**Status:** Accepted (owner review 2026-10-03, D-1).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-1). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context (amended 2026-10-02)

Five deployables (web, admin, api, agent, contact) share contracts, event schemas, UI tokens, messaging code and agent logic; a monorepo keeps a contract change and all its consumers in one PR. The owner wants a codebase agents can work in safely and that builds fast in CI.

## Considered options

- *Turborepo + pnpm workspaces.* Pros: small config (`turbo.json`), task graph with local and remote caching, `--filter` and affected runs, pnpm catalogs to pin shared versions once, Turborepo's docs and the Next ecosystem assume it. Cons: no code generators, no built-in module-boundary lint (handled by dependency-cruiser, ADR-024).
- *Nx.* Pros: generators, project graph, module-boundary lint, good Nest plugin. Cons: many more concepts and config surface; its Nest plugin lags new Nest majors; heavier for two apps.
- *pnpm workspaces only.* Pros: zero extra tool. Cons: no caching, no affected-only CI; you rebuild everything on every change.
- *Two repos (web, api).* Pros: independent lifecycles. Cons: contracts drift, two CIs, two release flows, worse for agents that need to see both sides of an API change.

## Decision

Turborepo + pnpm, with pnpm catalogs and Turborepo "compiled packages" for anything the API consumes (Node needs built JS; Next can transpile internal packages directly).

## Consequences

Packages need a build step and correct `exports` maps (ESM). CI caches `.turbo` and the pnpm store. Remote cache optional later.
