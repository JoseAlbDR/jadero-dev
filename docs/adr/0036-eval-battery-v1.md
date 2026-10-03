---
id: ADR-036
title: "Eval battery v1"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-64]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-036: Eval battery v1 (new 2026-10-02; extends ADR-019)")
---

# ADR-036: Eval battery v1

**Status:** Accepted (owner review 2026-10-03, D-64).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-64). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

About 30 questions with expected answers, stored as a LangSmith dataset, covering direct questions, drill-down from a CV line, out-of-scope questions that must get "I do not know", adversarial injection and prompt-leak attempts, and es, en and de. It can only be built once Layer B entries exist. The owner also wants a learning WP on LangSmith datasets, evaluators and experiments.

## Considered options

- *A. Owner-approved battery seeded from the entries' "Questions this answers":* an LLM drafts candidate items with reference answers and expected entry ids from approved entries; the owner edits and approves each item; adversarial and out-of-scope items are written by hand. Pros: fast to build, grounded in real entries, every item vetted. Cons: drafts may mirror the entries' wording (mitigated by paraphrasing in es and de).
- *B. Fully hand-written.* Pros: the most independent. Cons: slow; harder to keep in sync with entries.
- *C. Fully generated.* Pros: zero effort. Cons: the agent and the eval share the same blind spots.

## Decision

A. Mix: 8 direct, 6 drill-down, 5 out-of-scope, 6 adversarial (injection and prompt leak), 5 multilingual paraphrases (es and de), tagged so results can be sliced. Evaluators: deterministic first (cited entry ids within the expected set, answer language, exact refusal behavior on out-of-scope and adversarial items, no canary token), then an LLM judge for correctness against the reference answer and for groundedness. Every prompt or model change runs as a LangSmith experiment compared with the baseline; gates as in ADR-019.

## Learning WP (WP-40)

datasets and splits, example schemas, evaluator types (heuristic, LLM-as-judge, pairwise), experiments and comparisons, annotation queues, and how not to fool yourself (judge bias, leakage between dataset and prompt), built on a toy dataset before the real battery.

## Consequences

the battery is versioned with the content: when entries change, affected items are re-reviewed; the battery runs in CI with the budget gate.

## Pattern names

golden dataset, reference-based and reference-free evaluation, LLM-as-judge, experiment baselines, data leakage.
