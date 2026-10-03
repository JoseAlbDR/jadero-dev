---
id: ADR-003
title: "Internal architecture of each service"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-3]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-003: Internal architecture of each service (amended 2026-10-02)")
---

# ADR-003: Internal architecture of each service

**Status:** Accepted with a change (owner review 2026-10-03, D-3): layer conventions added below. Amended: these rules now apply inside each NestJS service (`api`, `agent`, `contact`); the split between services is ADR-029. Module placement: `content`, `media`, `cv`, `auth` in `api`; `knowledge`, `chat`, `guards`, `usage` in `agent`; `submissions`, `notifications` in `contact`.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-3). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The owner wants "modern architecture, best practices" and believes ports and adapters fits (steering 001). Some modules are thin (health), others have rich rules (content publishing, translations) or many external dependencies (knowledge, agent).

## First principles

Three ideas often get mixed up:
- *Layered* (controller, service, repository) organizes code by technical role. Dependencies point down; the service usually imports the ORM directly.
- *Hexagonal / ports and adapters* (Cockburn) puts the application core in the middle. The core defines **ports** (interfaces such as `EmbeddingsPort`, `ProjectRepository`); **adapters** implement them (Voyage, Drizzle) or drive them (HTTP controller, job handler, MCP tool). Dependencies point inward, so the core compiles and tests with zero infrastructure. Clean Architecture is the same rule with more named rings (entities, use cases).
- *Modular monolith* is about how **modules relate to each other**: each module owns its data and exposes a small public API; others may not reach into its tables. It is orthogonal to the two above: you can have a modular monolith whose modules are internally layered or hexagonal.

## Considered options

- *Layered everywhere.* Pros: least ceremony, what Nest scaffolds. Cons: services couple to Drizzle and to provider SDKs; tests need a DB or heavy mocks; switching providers touches business code.
- *Hexagonal/clean everywhere.* Pros: uniform, very testable. Cons: ceremony on modules that only proxy data (health, revalidation), which teaches the wrong lesson that patterns are free.
- *Modular monolith, hexagonal inside the modules that earn it, plain layered for the trivial ones.* Pros: each pattern used where its benefit is visible; the contrast itself is a lesson. Cons: two styles to recognize (documented per module in its `AGENTS.md`).

## Decision

the third option. Hexagonal modules: `content` and `auth` (session store port) in `api`; `knowledge`, `chat`, `usage` in `agent`; `submissions` in `contact`. Layered: `platform/health`, `revalidation`, `cv`. A module inside a service and a whole service follow the same idea at two scales: a small public surface, private data. Folder shape for hexagonal modules: `domain/` (entities, value objects, domain events; no imports from Nest or Drizzle), `application/` (use cases, ports), `infrastructure/` (Drizzle repositories, provider adapters), `presentation/` (controllers, SSE, MCP tools).

## Consequences

Nest DI binds ports to adapters with injection tokens (`{ provide: EMBEDDINGS_PORT, useFactory: ... }`). Use cases are plain classes testable with fake adapters. dependency-cruiser rules: `domain` imports nothing outside `domain`; `application` never imports `infrastructure`; modules import each other only through `index.ts`.

## Pattern names

ports and adapters, dependency inversion, use case (application service), repository, domain event, anti-corruption layer (provider adapters translate vendor shapes into our types).

## Conventions (owner review 2026-10-03, D-3)

layers inside a module: controller (presentation), then an application service as the orchestrator (a use case in hexagonal modules), then a repository for data access (a Drizzle repository class, the "DAO" layer), then the database. Hexagonal modules add ports between the application service and its repositories and providers, plus a domain layer with no framework imports. Ports are abstract classes, which in Nest serve as both the contract and the DI token (`{ provide: EmbeddingsPort, useClass: VoyageEmbeddings }`); shared adapter behavior may live in a thin abstract base class. No generic `utils/` folder: a helper lives in the module that owns its concept, and code shared across services lives only in named infrastructure packages. WP-3 ships a module template with these conventions.
