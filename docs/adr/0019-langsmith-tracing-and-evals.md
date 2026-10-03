---
id: ADR-019
title: "LangSmith tracing and evals"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-21, D-22]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-019: LangSmith tracing and evals (extended by ADR-036 and ADR-037)")
---

# ADR-019: LangSmith tracing and evals

**Status:** Accepted (owner review 2026-10-03, D-21 and D-22).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-21, D-22). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Tracing

enabled in staging and production with `LANGSMITH_TRACING=true`, project per environment, EU data residency (offered on all plans at no extra cost). The free Developer plan includes 5k base traces per month (14-day retention); one chat turn is one trace, so it covers about 160 turns a day. Visitor messages are personal data: mention tracing in the privacy notice, and use the LangSmith JS client's `hideInputs` and `hideOutputs` options and `createAnonymizer` to strip emails, phone numbers and raw job-description text before a trace leaves the server (checked 2026-10-03). Alternative considered: Langfuse (open source, self-hostable); discarded because the owner chose LangSmith and self-hosting it costs RAM on the box (owner review 2026-10-03: self-hosted Langfuse v3 needs Postgres, ClickHouse, Redis or Valkey and S3-compatible storage, and its guide plans 4 CPUs and 16 GB of RAM for one VM, twice the CX33).

## Datasets

`golden-qa` (about 40 questions per locale with reference answers and expected sources), `adversarial` (direct injection, indirect injection planted in a test-only document, system-prompt extraction, jailbreak role-play, off-topic, PII fishing, cost attacks; each tagged with its OWASP id), `retrieval` (question to expected chunk ids, used without an LLM).

## Evaluators

deterministic first (citation validity, answer language equals request language, refusal on adversarial items, no canary token, length bounds); LLM-as-judge with `openevals` for groundedness (every claim supported by a cited source) and answer relevance, using a stronger model than the one under test.

## When they run

PRs that touch `packages/agent/**`, `packages/ai/**` or prompt files (path filter), with a hard budget per run and a dedicated low-limit API key; nightly on `main`; the Vitest integration (`langsmith>=0.3.1`) for assertion-style checks that fail CI.

## Gates

adversarial pass rate 100% (any regression blocks); groundedness and retrieval recall@5 must not drop more than a set margin vs the last baseline experiment.

## Complement

promptfoo's red-teaming presets for the OWASP LLM Top 10 as a one-off audit before launch **(verify current preset names at WP time)**.
