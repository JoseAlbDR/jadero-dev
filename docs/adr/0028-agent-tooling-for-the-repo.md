---
id: ADR-028
title: "Agent tooling for the repo"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-34]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-028: Agent tooling for the repo")
---

# ADR-028: Agent tooling for the repo

**Status:** Accepted (owner review 2026-10-03, D-34).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-34). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The owner has a mature Claude Code framework (flow `ticket, plan, approve, per-WP implement, branch review gate, MR`; guard hooks; commit, learn, retro and design-options skills). A split into a self-contained core plugin plus a company pack is planned but not done: today the framework describes itself as one cohesive bundle (`PUBLISHING.md:45`: splitting into multiple plugins "not recommended; the components are cohesive"; `PUBLISHING.md:93`: 9 agents, 28 skills, 17 hooks). jadero.dev needs a learning gate the framework does not have.

## Fit assessment of the current framework for this repo

- *Fits:* plan, approve and per-WP discipline; mechanical guards (plan-approval enforcement, deny-guard, agent-spawn caps); the commit skill; design-options as the shape of an ADR conversation; learn and retro as habits.
- *Does not fit:* many skills assume the company's ticket tracker, GitLab merge requests and its review channel, serverless boot checks and the company's ORM migrations (for example `skills/ticket/SKILL.md:3`, `skills/mr/SKILL.md:3`, `skills/verify-boot/SKILL.md:3`, `skills/migration/SKILL.md:4`); rules are written for the company stack; design-options records ADRs **untracked** in `.claudedoc/decisions/` (`skills/design-options/SKILL.md:3,74,109`) while this project wants tracked, public ADRs in `docs/adr/`; delivery assumes GitLab, this repo is GitHub with release-please.
- *Structural tension with the learning requirement:* the framework's delegation contract keeps implementation inside subagents and the coordinator out of the work. That is right for throughput, but the owner wants to watch and understand every backend and agent step. A learning WP therefore needs a different execution mode (explain, decide, build in small visible steps, explain back), which the framework would have to grow as a new profile.
- *Ownership:* a personal, soon-public repo should not depend on a toolchain that carries company-specific content; that is the same isolation principle as the content rules.

## Considered options

- *A. Plain repo-local setup (12.1).* Pros: self-contained, public-safe, exactly fitted (learning gate, GitHub, ADRs in repo), works for any agent that reads AGENTS.md. Cons: re-creates some guards the framework already has.
- *B. Install the current framework as is.* Pros: everything at once, battle-tested. Cons: the mismatches above, company content in a personal repo, heavy flow for a solo learning project.
- *C. Framework core plugin + a small jadero-dev pack* (learning gate, ADR-in-repo, GitHub delivery, this stack's standards). Pros: reuses the governance engine; jadero-dev becomes the first external consumer and a real test of the split (a good story for the framework case study too). Cons: blocked until the split exists; the core would still need a learning execution profile.
- *D. A now, designed to map onto C (same concepts and names: plan, approve, WP, review gate, ADR), and adopt C when the core plugin exists and proves it adds mechanical value.*

## Decision

D.

## Consequences

the repo-local learning gate and ADR skill become the reference design for the future pack; nothing in jadero-dev references paths under `~/dev/mercanis/`.
