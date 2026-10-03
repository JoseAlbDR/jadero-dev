---
id: ADR-025
title: "Versioning and releases"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-36]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-025: Versioning and releases (amended 2026-10-02)")
---

# ADR-025: Versioning and releases

**Status:** Accepted (owner review 2026-10-03, D-36). Amended: one version line per service instead of one product version.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-36). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

With services (ADR-029), independent deployability is a core property: a prompt change in `agent` should ship without touching `api`. Conventional commits are the input. No npm packages are published.

## Considered options

- *semantic-release.* Pros: fully automatic from commits; mature. Cons: assumes one package per repo (monorepo support needs plugins); releases on every qualifying push with no checkpoint.
- *Changesets.* Pros: the default for pnpm monorepos that publish packages; per-package intent files. Cons: built around publishing packages and hand-written changeset files, not conventional commits; overhead for apps.
- *release-please, single product version.* Pros: simplest; one tag (`v1.4.0`) for everything. Cons: every release rebuilds and redeploys every service, which hides whether the services really are independent.
- *release-please, one component per service.* A manifest lists `apps/web`, `apps/admin`, `apps/api`, `apps/agent`, `apps/contact` (and the shared packages); commits are attributed by the paths they touch; each service gets its own version, `CHANGELOG.md` and tag (`agent-v1.3.0`); one combined Release PR shows every pending release, and merging it tags only the services that changed. The `node-workspace` plugin bumps services when a shared package they depend on is released **(verify the plugin's behavior at WP time; fallback: a CI check that fails a PR touching a shared package unless the affected services are bumped)**.

## Decision

release-please with one component per service.

## Consequences

images are tagged `<service>:<version>` plus `sha-<short>`; the server keeps a `versions.env` per environment recording which version of each service runs (the environment's release manifest); `feat:` bumps minor, `fix:` patch, `feat!:` or `BREAKING CHANGE:` major; message-schema changes follow expand/contract so services never need to be released together (ADR-029 rule 4). The per-service changelogs become part of the case study.
