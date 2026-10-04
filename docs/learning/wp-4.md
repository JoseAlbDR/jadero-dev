---
wp: 4
decision: recorded
fast_path: known
adr: [ADR-022, ADR-023, ADR-026]
---

# WP-4: Web skeleton

WP-4 is a frontend work package (tag `frontend`): result-only, no explainer and no explain-back (AGENTS.md section 5). This file exists only because the learning gate also covers the repo tooling files, and the web app needs new entries in the `pnpm-workspace.yaml` catalog (Next.js, next-intl, Tailwind, shadcn base, next-themes, Playwright).

## Decision

The owner chose the D-38 fast path on 2026-10-04: nothing new to learn in the tooling changes of this WP. They are catalog entries and `allowBuilds` decisions in `pnpm-workspace.yaml`, the lint and depcruise inputs in the root `turbo.json` (CSS added, `.next/` and Playwright output excluded), the Next.js entry files exempted from `no-orphans` in `.dependency-cruiser.cjs`, and per-package config in `apps/web` and `packages/ui`. No service code is touched.
