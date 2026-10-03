---
id: ADR-020
title: "Guard architecture and guardrail libraries"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-25]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-020: Guard architecture and guardrail libraries")
---

# ADR-020: Guard architecture and guardrail libraries

**Status:** Accepted with a change (second pass 2026-10-03, D-25 option e): the TypeScript guard module with the Haiku classifier ships in R2 (WP-23); WP-55 (R7) adds a small Python service (FastAPI + Prompt Guard 2 86M, multilingual, CPU) as a second adapter behind `GuardClassifierPort`, called with a timeout and a cockatiel circuit breaker that falls back to Haiku, and the adversarial and false-positive evals decide which adapter stays. Recorded as a deliberate exception to the brainstorm's TypeScript-everywhere rule: Python enters where it is strongest (running a model), and the chat never depends on it. It replaces the Prompt Guard 2 ONNX-in-Node experiment. LLM Guard was archived in July 2026.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-25). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The captain asked for every harness possible against injection, leakage and jailbreaks, and to research existing guardrail projects. The ecosystem is uneven: the mature general-purpose scanners are Python, TypeScript options are younger.

## What exists (2026-10)

- *LangChain.js v1 middleware:* built-in `piiRedactionMiddleware` (redact, mask, hash or block per PII type, custom regex detectors), `modelCallLimitMiddleware`, `toolCallLimitMiddleware`, `humanInTheLoopMiddleware`, and `createMiddleware` with `beforeModel`/`afterModel` hooks for custom guards. The most mature TS guard surface, and native to our stack.
- *Local classifiers:* Meta's Llama Prompt Guard 2 (BENIGN/MALICIOUS, 512-token window) has community ONNX builds runnable in Node through `@huggingface/transformers` on CPU, no API calls. The 86M variant is the multilingual one; the 22M variant is smaller **(verify language coverage and license terms at WP time)**.
- *TS libraries:* `llm-prompt-guard` (zero-dependency heuristics, normalization against encoding bypasses, canary validation, output exfiltration scan; young, single maintainer); Superagent (TypeScript support updated in 2026; check whether it needs a hosted service); OpenAI Guardrails for JS (checks run on OpenAI models, so provider-coupled).
- *Hosted:* Lakera Guard (API, free community tier). *Python-only:* LLM Guard (archived on 2026-07-09, no longer maintained), NVIDIA NeMo Guardrails, Guardrails AI, and Meta's Prompt Guard 2 used directly or through LlamaFirewall; usable only as a sidecar container.

## Considered options

- *A. Own guard module (deterministic rules + classifier behind `GuardClassifierPort`) + LangChain middleware.* Pros: teaches each layer; provider-agnostic; every rule tested; the classifier is swappable (LLM, ONNX, hosted). Cons: we maintain the rules.
- *B. Adopt a TS guard library as the main layer.* Pros: faster start. Cons: young projects on a security-critical path; still need our own output rules for citations and canaries.
- *C. Python sidecar (NeMo Guardrails or Prompt Guard 2; LLM Guard is archived).* Pros: richest scanners. Cons: a Python service and its models on an 8 GB box, a second language in a TypeScript-everywhere project.
- *D. Hosted guard API.* Pros: maintained detectors. Cons: sends every visitor message to another processor; another account and limit.

## Decision

A. Mine `llm-prompt-guard` and public jailbreak datasets for rules and test cases rather than depending on them. Classifier adapters: Haiku 4.5 with structured output first; Prompt Guard 2 ONNX second, as an experiment decided by the adversarial and false-positive evals (it adds about 100 to 300 MB RAM).

## Layers in order

  1. Edge: nginx `limit_req`, request body size limit.
  2. App preflight: Turnstile once per session, throttler windows, per-thread cap, daily budget check.
  3. Input rules: length cap, Unicode normalization (NFKC), strip zero-width and bidi control characters, reject known injection signatures, repeat-offender escalation (a session that triggers several blocks is throttled harder, per Anthropic's "respond to repeat offenders" guidance).
  4. Input classifier: one structured call returning verdict, intent and language.
  5. Context hygiene: retrieved chunks as JSON-encoded tool results described as untrusted data; system prompt with an explicit untrusted-content policy.
  6. Bounded agent: read-only tools, call limits, `max_tokens`.
  7. Output checks: canary token, system-prompt overlap (n-gram), link allowlist, PII redaction middleware, citation validation, length.
  8. Monitoring: every block recorded in `usage.guard_events` (agent database), weekly review of samples, new attacks added to the adversarial dataset.

## Consequences

the guard module is one of the strongest pieces of the cover-letter story: each layer maps to an OWASP id and has tests and eval cases.

## Owner review (2026-10-03, F-7; decided e in the second pass, WP-55)

the owner is open to Python, which the agentic team uses. Proposed option E: build A for launch, then add a small Python `guard-classifier` service (FastAPI + Prompt Guard 2, multilingual including es and de) after launch as a second `GuardClassifierPort` adapter, behind a timeout and a circuit breaker that falls back to the Haiku classifier; the adversarial and false-positive evals pick the winner. It replaces the Prompt Guard 2 ONNX-in-Node experiment, and the chat never depends on Python.
