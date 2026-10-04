<!-- Title: a conventional commit scoped to the service, e.g. feat(agent): add hybrid retrieval. It becomes the squash commit and the changelog line. -->

Closes #<issue>

## What

One paragraph: what changed and why, in terms of the WP and the ADRs it implements.

## How to verify

- `pnpm verify` green (lint, architecture check, typecheck, unit tests, affected only)
- Integration tests touched: 
- Manual check, if any: 

## Checklist

- [ ] No employer details, secrets or visitor data in code, tests, fixtures or this PR (the repo becomes public)
- [ ] ADRs: none affected / new ADR added / ADR-NNN superseded (never edited)
- [ ] AGENTS.md updated if a rule or command changed
- [ ] Learning WP: explainer linked and decision recorded before the code was written
