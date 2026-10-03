---
id: ADR-011
title: "Content management approach"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-11, D-20]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-011: Content management approach (amended 2026-10-02)")
---

# ADR-011: Content management approach

**Status:** Accepted (owner review 2026-10-03, D-11).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-11, D-20). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Content: profile, experience items, projects/case studies, posts, skills, media, all in three locales, plus the PDF CV derived from them. The content also feeds the RAG index. The owner built El Refugio on Payload, so Payload is known territory.

## Considered options

- *A. MDX files in the repo (git as CMS).* Pros: zero backend, versioned for free, great authoring in an editor. Cons: every edit is a commit and a deploy; no admin; nothing to showcase on the backend; translations are three files to keep in sync by hand.
- *B. Payload CMS 3 inside the Next app.* Pros: admin UI, localization, drafts and versions out of the box; Postgres adapter. Cons: hides the backend the owner wants to show; Next and the CMS share a process; the owner already knows it (low learning); a second data model next to Nest.
- *C. Own NestJS content module + admin app* (a Next admin panel in the original plan; a static SPA since the amendment, ADR-002). Pros: the showcase (domain modeling, translations, revisions, publish workflow, events, cache invalidation, auth); the content is shaped exactly for the agent (structured fields, not just pages). Cons: the most work; admin UI built by hand (shadcn/ui forms help).
- *D. Hybrid: structured data in C, long-form posts as MDX in the repo.* Pros: less admin UI for posts. Cons: two content paths, two ingestion sources for the agent.

## Decision

C, as the brainstorm leaned (line 34). Post and case-study bodies are stored as **Markdown**, not MDX: MDX compiles to JavaScript, so MDX stored in a database and compiled at request or build time is code execution from data. Markdown goes through remark/rehype with `rehype-sanitize` and a small set of allowed directives (for example `:::callout`, `::figure{src=... caption=...}`) that map to fixed React components. That keeps the expressiveness that made MDX attractive without executing content.

## Domain model (first cut)

- `Profile` (singleton): name, headline, summary, contact links; translations.
- `ExperienceItem`: organization (public name), role, period, location type, stack tags, highlights; translations; ordering.
- `Project`: slug, kind (`case_study` | `project` | `early`), repo URL, demo URL (optional), media gallery, stack tags, featured flag; translations (title, summary, body Markdown, localized slug).
- `Post`: slug, status, publishedAt, tags; translations (title, excerpt, body Markdown, localized slug).
- `Skill`: category (including "applied AI"), name, optional evidence links to projects.
- `Media`: file on a local volume served by nginx, alt text per locale.
- `Revision`: every save creates a revision; publish marks one revision per locale as published (draft vs published is a state of the aggregate, not two tables).

## CV bullets and knowledge entries (new 2026-10-02)

the two-layer model with its approval gate is specified in ADR-031.

## Translation model

a base table per aggregate plus a `*_translations` table keyed by `(id, locale)`, with a completeness check per locale shown in the admin (es and en required for publish, de warned until complete; D-20).

## Consequences

Publishing emits `content.published.v1` through the outbox (ADR-012). Only published revisions are ever indexed for the agent, and only the owner can publish: this is the main control against data poisoning (LLM04). Any text about the current role enters only through this publish step, which is where the owner's public-level approval happens.

## Pattern names

aggregate, value object, translation table (entity-attribute per locale), revision/versioning, publish workflow as a state machine, domain events.
