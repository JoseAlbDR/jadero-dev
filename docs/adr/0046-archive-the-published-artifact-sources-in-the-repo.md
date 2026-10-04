---
id: ADR-046
title: "Archive the published artifact sources in the repo"
status: accepted
date: 2026-10-04
deciders: [owner]
decisions: []
supersedes: [ADR-044]
superseded_by: null
source: PR #92 (artifact registry, docs/artifacts.md)
---

# ADR-046: Archive the published artifact sources in the repo

**Status:** Accepted (owner, 2026-10-04). Supersedes only one point of ADR-044: its consequence "Screenshots of the decision live in a private artifact linked from PR #84, never in the repo". Everything else in ADR-044 was already superseded by ADR-045 and stays as ADR-045 decides; ADR-044 itself is not edited.

## Context

`docs/artifacts.md` lists every claude.ai artifact published for jadero.dev and the repo file it is built from. Two artifacts had no source in the repo:

- **jadero.dev v2 Plan**: the review page the owner used to mark the 76 decisions. Its `data.json` is generated from `docs/plan/decisions.json`, but the page itself (`index.html`) and the owner's marks (stored in the artifact's database) existed only on claude.ai.
- **jadero.dev Design Directions**: the gallery of WP-15 mockup screenshots (five directions, light and dark, desktop and phone). ADR-044 kept the screenshots out of the repo on purpose: binary files in a code repo, and the mockups were throwaway.

An artifact can be deleted, lose access, or change with the platform. If either one disappears, the page code, the record of how the visual direction was chosen and the owner's raw review marks are lost. The owner also wants both pages to seed a future template repo, which needs their source.

## Considered options

- *A. Archive each artifact's published files in the repo, under `docs/artifacts/<name>/`.* Pros: nothing lives only on claude.ai; any session can republish from the repo; the template repo can copy them. Cons: about 5.9 MB of PNG screenshots in git history, forever.
- *B. Keep them only as artifacts (ADR-044's rule).* Pros: a lean repo. Cons: a single point of loss, and the page code cannot be reused.
- *C. Archive the page code and data, but not the screenshots.* Pros: small. Cons: the gallery is the screenshots; without them the decision record of ADR-045 loses its evidence.
- *D. Store the screenshots with Git LFS or in a release asset.* Pros: keeps the clone small. Cons: an extra tool and setup for 6 MB that will not grow; LFS bandwidth limits on a public repo.

## Decision

Option A. Each artifact without a repo source gets a folder under `docs/artifacts/` with its published files as they are served (page as `index.html`, data and images at their published paths), plus the artifact's database rows exported as JSON when it has any. The folder is the source; the artifact is a copy, the same rule as the other entries in `docs/artifacts.md`.

The screenshots are kept as PNG in plain git. 6 MB is a one-time cost: the mockups are deleted in WP-16, so the set will not grow. Archived files pass the content rules (ADR-031) before they land: no proprietary code or configuration from the employer, no client names, no personal data, no secrets. Naming the employer and the owner's work there is allowed (owner, 2026-10-04), so the owner's marks are archived as written.

Discarded: B for the risk of loss, C because the screenshots are the point of the gallery, D as tooling the size does not justify.

## Consequences

- `docs/artifacts/v2-plan/` holds `index.html`, `data.json` and `owner-marks.json` (the database rows); `docs/artifacts/design-directions/` holds `index.html` and `shots/`. `docs/artifacts.md` points both entries at these folders and says how to republish them.
- A session that republishes one of these artifacts publishes from its folder, and a session that changes the artifact updates its folder in the same PR.
- The repo grows by about 6 MB once. A future artifact with large binaries reopens this choice (option D).
- The v2 Plan page is not republished just to refresh its `data.json`: its marks live in the artifact's database, and the owner asks for a republish when wanted.

## Pattern names

Single source of truth (the repo holds the source, the artifact is a derived copy), backup by archiving (no data lives in only one place), docs as code.
