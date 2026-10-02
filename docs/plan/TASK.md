# Task: fold the owner's review into the jadero.dev v2 plan

You are continuing the planning of jadero.dev v2.
Everything you need is in `docs/plan/`.
This is planning work only: do not write application code, scaffold the app, or change anything outside `docs/plan/`.

## Inputs

- `report.md`: the full plan (ADRs, decisions D-1..D-76, work packages WP-*, milestones M0-M6, manual actions M-*).
- `decisions.json`: the same decisions in a structured form; it feeds a review web page, so its schema must stay valid and existing ids must never change.
- `owner-marks.json`: the owner's review of every decision, keyed by decision id. `choice` = the option id he picked, `note` = his free text (mostly Spanish), `detail` = he wants more detail.
- `owner-intent.md`: what the owner asked for. The last paragraph of its Intent section is the newest instruction: the site must not be tightly coupled to a move to an agentic AI team; it must prove broad engineering skills.
- `brainstorm.md` and `knowledge-entry-format.md`: earlier binding decisions.

## What to do

1. Read every note in `owner-marks.json`. Never treat the picked option alone as final: many notes qualify or change the choice.
2. Record each decision, append-only, in both `report.md` and `decisions.json`, with a status:
   - `decided`: the note agrees with or does not change the picked option.
   - `decided-with-change`: the note adjusts the picked option in a way that is clear and safe to apply; record exactly what changed.
   - `open`: the note contradicts or materially changes the pick, there is only a note (D-16, D-49, D-50, D-52, D-67), or the owner left it open on purpose (D-73).
3. Do not decide `open` items for the owner. Write `docs/plan/owner-review-followups.md` with one item per open decision: what he picked, what his note says (quote it), the conflict, and your concrete recommendation with the reason.
4. Answer every question the owner asks in a note in that same file, under the decision it belongs to.
5. Some notes ask "firstmate" (his separate agent orchestrator, not available here) to do something, such as preparing documentation in a given pattern. Do not act on those; list them in a section "For firstmate" in the follow-ups file.
6. The note on D-76 suggests showing his professional work at his current employer, not only personal projects. Treat it as a follow-up with options and a recommendation; any such content must stay public-level, with no proprietary details.
7. Propagate every `decided` and `decided-with-change` item into the affected ADRs, work packages and milestones in `report.md` and `decisions.json`.
8. Keep `decisions.json` valid JSON with the same schema and ids; validate it before committing.

## Style

English, plain and concise, no hype words, no em dashes.

## Delivery

Commit to a branch named `plan/owner-review` with conventional one-line commits (for example `docs(plan): fold owner review into decisions`), push it, and open a pull request against `main`.
End with a short summary: counts per status, the number of follow-ups, and the decision ids whose outcome changed because of a note.
