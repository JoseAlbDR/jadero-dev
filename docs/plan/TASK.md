# Task: close the open follow-ups of the jadero.dev v2 plan

You are continuing the planning of jadero.dev v2 with the owner, in conversation.
Everything you need is in `docs/plan/`.
This is planning work only: do not write application code, scaffold the app, or change anything outside `docs/plan/`.

## Where things stand (2026-10-03)

The owner reviewed all 76 decisions; his marks are in `owner-marks.json` and are already applied:

- `decisions.json` and `report.md` record every decision with a `status`: 53 `decided`, 9 `decided-with-change`, 14 `open`.
- `owner-review-followups.md` holds one item per open decision (F-1..F-14): his pick, his note quoted, the conflict and a recommendation.
  It also answers the questions in his notes, lists the 9 changes applied from his notes, and has a "For firstmate" section.
- Plan changes already made: new WP-50 (dead-letter archive, admin events page, replay) and WP-51 (generated OpenAPI); WP-45 moved out of launch (D-68 c); D-25 notes that LLM Guard was archived on 2026-07-09.

Do not redo the review. Steps 1-8 of the earlier task are done.

## What to do

1. Start by giving the owner a short summary of the 14 open items (F-1..F-14), one line each with your recommendation, and ask for his answers. He answers in Spanish; reply in Spanish in chat.
   F-1 (D-45) also settles F-2 (D-2) and F-3 (D-47), so take it first.
2. When he answers an item, record it append-only in `decisions.json` and `report.md`: set `status` to `decided` (or `decided-with-change` with `change` filled), set `decidedOption`, `decidedAt`, `decidedBy: "owner"`, keep `ownerPick`, `ownerNote`, `previousRecommendation` as history. Mark the F-n item in `owner-review-followups.md` as resolved with his answer.
   If he picks a new option that does not exist yet (several recommendations are new options d or e described in the follow-ups file), add it to that decision's `options` with the same shape as the others.
3. Propagate each answer into the affected ADRs, work packages and milestones in `report.md` and `decisions.json`.
4. Leave D-73 open unless he decides it.
5. Do not act on the "For firstmate" items; they belong to his separate agent orchestrator.
6. Keep `decisions.json` valid JSON with the same schema and ids (ids are never renumbered; new items get the next free id). Validate before each commit.

## Style

Files in English, plain and concise, no hype words, no em dashes.

## Delivery

Commit to a branch named `plan/followups` with conventional one-line commits (for example `docs(plan): record owner answers to F-1..F-4`), push it, and open a pull request against `main`.
End with a short summary: which F items are resolved, which remain, and which decisions changed outcome.
