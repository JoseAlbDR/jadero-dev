---
id: ADR-024
title: "Lint, format and architecture fitness functions"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-35]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-024: Lint, format and architecture fitness functions")
---

# ADR-024: Lint, format and architecture fitness functions

**Status:** Accepted (owner review 2026-10-03, D-35).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-35). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Considered options

ESLint (flat config) + Prettier (richest plugin ecosystem); Biome (one fast tool for format and lint, fewer plugins); either combined with dependency-cruiser for architecture rules. Next.js 16 no longer wraps the linter, so either works for the web app.

## Decision

Biome for format and lint everywhere, plus dependency-cruiser rules as **architecture fitness functions** (domain imports nothing outside domain; application never imports infrastructure; modules import each other only through their `index.ts`; `packages/agent` and `packages/ai` never import Nest). commitlint with the conventional-commits config, run locally through lefthook and on the PR title in CI (squash merges make the PR title the commit).

## Consequences

the architecture in ADR-003 is checked by a machine on every PR, which is also what makes agent-written code safe to accept.
