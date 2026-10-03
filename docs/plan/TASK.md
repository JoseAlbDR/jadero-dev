# Task: start the build of jadero.dev v2 (R0)

You are continuing jadero.dev v2 with the owner. Everything you need is in `docs/plan/`.

## Where things stand (2026-10-03, second pass)

- All 76 decisions are recorded in `decisions.json` and `report.md` (55 `decided`, 21 `decided-with-change`, 0 `open`). The 14 follow-ups were answered by the owner in conversation; `owner-review-followups.md` carries each resolution and, in section 6, the audit (H-1 to H-7) that preceded them.
- The build ships as releases R0 to R7 without dates (`report.md` section 14.1, `decisions.json` `tracking.milestones`). R0 is the walking skeleton; R1 puts the site in production without the agent; R2 is the agent core.
- New work packages WP-52 to WP-56; manual actions M-38 to M-41.
- The owner's pace rules: learning is the goal, no deadline; the fast path of D-38 (`known`) speeds up a step the owner already understands.

## What to do next

1. WP-0 is done in substance. Create the ADR files in `docs/adr/` from the decided ADRs in `report.md` (MADR template, index generated), one PR.
2. WP-49: create the GitHub epic, the WP sub-issues (WP-0 to WP-56), labels, the Project and the milestones R0 to R7 (no due dates) from `decisions.json`, with the `gh` CLI, after the owner confirms the repo settings (M-1).
3. WP-1: repo foundation, as a learning WP (explainer first, decision recorded, small visible steps, explain-back; see `report.md` section 12.3).
4. In parallel, the owner and firstmate start WP-52 (content track, M-40).

## Rules

- Planning files in English, plain and concise, no hype words, no em dashes. Chat with the owner in Spanish.
- `decisions.json` keeps its schema and ids; new items get the next free id; validate before each commit.
- Every change goes through a PR against `main` (squash merge), with conventional one-line commits.
- Do not act on the "For firstmate" items in `owner-review-followups.md`.
