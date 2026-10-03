---
id: ADR-037
title: "Answer feedback loop"
status: rejected
date: 2026-10-03
deciders: [owner]
decisions: [D-68]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-037: Answer feedback loop (new 2026-10-02, steering 007)")
---

# ADR-037: Answer feedback loop

**Status:** Rejected for v1 (owner review 2026-10-03, D-68, option C): no feedback at launch, because visitor thumbs are easy to troll; the design below stays as a possible follow-up (WP-45, after launch).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-68). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Thumbs up or down on every agent answer, flowing into a LangSmith annotation queue, so real visitors' judgments turn into eval items: the human-feedback-to-evals loop (sometimes called the data flywheel).

## Flow

the SSE `final` event carries the LangSmith `runId` and an opaque `feedbackToken` (an HMAC of run id and session, so nobody can rate someone else's run); the UI posts `{runId, score, comment?, token}` to `/api/agent/feedback`; the agent validates the token, allows one rating per run per session, stores it (`usage.feedback`) and forwards it to LangSmith as feedback on that run; every thumbs-down and a 10% sample of thumbs-up land in an annotation queue; the owner reviews weekly; confirmed failures become eval-battery items with a reference answer (ADR-036), so the same failure can never silently return.

## Considered options

- *A. LangSmith feedback + annotation queue + promotion into the dataset* (above). Pros: closes the loop inside the tool already used for traces and evals; each rating is attached to its full trace. Cons: visitor comments are personal data in a third-party tool (comments optional, 500 characters, mentioned in the privacy notice).
- *B. Own feedback table and an admin review page only.* Pros: data stays on the server. Cons: rebuilds what LangSmith gives, without the trace next to the rating.
- *C. No feedback.* Pros: nothing to build. Cons: the evals only ever contain the owner's guesses about what visitors ask.

## Decision

A.

## Safety

feedback never changes behavior automatically (no online learning), so feedback bombing cannot steer the agent; rate limits apply; comments are treated as untrusted text and never fed to a model without review.

## Pattern names

human in the loop, annotation queue, data flywheel, regression set.
