---
wp: 4
decision: pending
fast_path: known
adr: [ADR-022, ADR-023, ADR-026]
---

# WP-4: Web skeleton

WP-4 is a frontend work package (tag `frontend`): result-only, no explainer and no explain-back (AGENTS.md section 5). This file exists only because the learning gate also covers the repo tooling files, and the web app needs new entries in the `pnpm-workspace.yaml` catalog (Next.js, next-intl, Tailwind, shadcn base, next-themes, Playwright).

## Decision

The owner chose the D-38 fast path on 2026-10-04: the tooling changes in this WP are catalog entries and per-package config, nothing new to learn. No other learning path is touched.
