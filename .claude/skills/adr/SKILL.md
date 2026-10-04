---
name: adr
description: Create a new architecture decision record from docs/adr/0000-template.md, or supersede an accepted one, and regenerate the index. Use when a design choice is made or changed.
user-invocable: true
arguments: [title]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(pnpm adr:*), Bash(git status*), Bash(git diff*)
---
Create or supersede an ADR for: $title

1. Read `docs/adr/README.md` and find the next free number NNNN. If this decision changes an accepted ADR, note its id: you will supersede it, never edit it.
2. Copy `docs/adr/0000-template.md` to `docs/adr/NNNN-<kebab-title>.md`. Fill the front matter: `id`, `title`, `status: proposed`, today's date, `deciders: [owner]`, `decisions` (the D-n ids from `docs/plan/decisions.json` this records, or a new D-n if none fits: append it there with the next free id), `supersedes: [ADR-MMM]` when applicable.
3. Write Context, at least two Considered options with pros and cons, Decision (which and why, what was discarded and why), Consequences (follow-up WPs, what to verify at WP time), Pattern names.
4. If superseding: set `status: superseded` and `superseded_by: ADR-NNN` (the id has three digits, as in `ADR-042`; only the file name has four) in the old file's front matter and its status line. That is the only edit an accepted ADR ever receives.
5. Regenerate the index: `pnpm adr:index`. Never edit the table in `docs/adr/README.md` by hand.
6. Stop and show the owner the Decision section. The ADR stays `proposed` until the owner says accepted; then change `status` to `accepted` in the same PR.
Style: plain English, no hype words, no em dashes, no employer internals.
