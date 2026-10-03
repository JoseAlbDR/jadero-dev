---
id: ADR-042
title: "NestJS 12 on Node 24 LTS"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-4]
supersedes: [ADR-004]
superseded_by: null
source: docs/learning/wp-1.md (option D)
---

# ADR-042: NestJS 12 on Node 24 LTS

**Status:** Accepted (WP-1 decision, 2026-10-03). Supersedes ADR-004 on the Node line only; the NestJS, ESM and Vitest parts of ADR-004 are restated here unchanged.

## Context

ADR-004 chose Nest 12, ESM and Vitest on Node 22 LTS. On 2026-10-03 Node 22 is in maintenance with end of life on 2027-04-30, about seven months away and before release R2 is expected. Node 24 is the active LTS (24.21.0) with support into 2028. Nest 12 requires Node 20.19+ or 22.12+, so 24 qualifies. The WP-1 explainer (`docs/learning/wp-1.md`, option D) raised the question before the first `package.json` was written, which is the cheapest moment to change a runtime line.

## Considered options

- *Keep Node 22 (ADR-004 as written).* Pros: no ADR change; every Nest 12 guide assumes 22. Cons: an upgrade WP within the first year, during the agent releases; a runtime that stops receiving security fixes in April 2027.
- *Node 24 LTS now.* Pros: support into 2028; stable type stripping and newer V8; the same major in dev, CI, images and production from day one. Cons: a few native modules may lag on 24 (verify in the WP-3 compatibility spike, the same spike ADR-004 already requires).

## Decision

Nest 12, ESM and Vitest, as in ADR-004, on Node 24 LTS. The line is pinned in the repo (`.nvmrc` or `.node-version`, the `engines` field, the CI matrix and the base image) and moves only by a new ADR. The fallback rule of ADR-004 stands: an integration that fails on this stack is wrapped, never a reason to downgrade.

## Consequences

- WP-1 pins Node 24 in the version file, `engines` and the pnpm catalog; WP-6 uses the same line in CI; WP-7 builds images from a `node:24` base.
- WP-3's compatibility spike includes native modules on Node 24.
- ADR-027's memory budget was measured with Node 22 assumptions; re-check RSS per service once the first services run (no change expected).

## Pattern names

Runtime pinning; a decision record that supersedes rather than edits.
