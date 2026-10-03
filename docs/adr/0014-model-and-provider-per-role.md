---
id: ADR-014
title: "Model and provider per role"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-14]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-014: Model and provider per role")
---

# ADR-014: Model and provider per role

**Status:** Accepted with a change (owner review 2026-10-03, D-14): Haiku 4.5 default for every role, with eval-gated per-role overrides. Prices verified 2026-10-02 (Anthropic from the bundled skill cached 2026-09-25; OpenAI, Voyage, Cohere from their pricing pages or search results); re-check at WP time.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-14). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Pay-per-use, Haiku-class budget, three languages, short answers grounded in a small corpus.

| Role | Candidates (price per 1M tokens) | Recommendation and why |
|---|---|---|
| Chat (answer) | Claude Haiku 4.5 `claude-haiku-4-5`: USD 1 in / 5 out, 200K context. OpenAI GPT-5.4-mini: 0.75 / 4.50. Claude Sonnet 5.5: 2 / 10 (quality ceiling). | **Haiku 4.5** as default: strong tool use and multilingual output at the target price, and Anthropic is the provider the owner already works with daily through Claude Code. GPT-5.4-mini kept as the tested alternative adapter; the choice is confirmed by an eval experiment (quality, latency, cost per turn) in WP-22, not by opinion. |
| Guard classifier | Haiku 4.5; GPT-5.4-nano (0.20 / 1.25); local Prompt Guard 2 (ONNX, free, CPU) | **Haiku 4.5 with structured output** first (Anthropic's own guidance uses a lightweight Claude model as a harmlessness screen); evaluate nano and Prompt Guard 2 against the adversarial dataset, keep whichever has the lowest false-positive rate in es/de at acceptable recall. |
| Embeddings | Voyage `voyage-4-lite`: 0.02, first 200M tokens free, multilingual, 1024 dims. `voyage-4`: 0.06. OpenAI `text-embedding-3-small`: 0.02 (1536 default, `dimensions` param). Local open-weight `voyage-4-nano` (Apache 2.0). | **voyage-4-lite**: multilingual quality for es/en/de, effectively free at this corpus size, Anthropic's documented recommendation, and the same vendor offers the reranker. OpenAI adapter as the alternative to prove the switch works. |
| Reranker | Voyage `rerank-2.5-lite`: 0.02, 200M free; `rerank-2.5`: 0.05. Cohere Rerank 4 Fast: about 0.002 per search; Rerank 4 Pro: 0.0025 per search. LLM listwise rerank with Haiku. None. | **rerank-2.5-lite**, and the `none` adapter kept for an eval A/B: on a corpus of a few hundred chunks reranking may add little; the WP measures it instead of assuming. |

## Cost model per chat turn (Haiku 4.5)

about 5,000 input tokens (system prompt and tools 2,300, history 1,000, five chunks 1,750) and 300 output tokens: 5,000 x 1/1M + 300 x 5/1M = USD 0.0065, plus the guard call (about 700 in, 30 out) USD 0.0009, so about USD 0.0075 per turn, worst case (a second tool round) about USD 0.015. 1,000 turns a month is roughly USD 8 to 15. Embeddings and reranking stay inside free tiers.

## Prompt caching note (learning point)

Haiku 4.5 only caches prefixes of at least 4,096 tokens. The stable prefix (system prompt + tools) is about 2,300 tokens, so it would not cache. Option: put a stable "owner brief" (profile summary, project index, skills list, about 2,000 tokens) into the system prompt, which both improves answers to common questions and crosses the threshold, making cache reads cost 0.1x. Decide by measuring `cache_read_input_tokens` in WP-22 (D-14).

## Consequences

a price table per model lives in config for cost accounting (ADR-021); updating it is part of switching a model.

## Change (owner review 2026-10-03, D-14)

Haiku 4.5 is the default for every role; switching any role to Sonnet 5.5 or an OpenAI model is a config change plus an eval run. Because the embedding model is the one fixed choice, WP-21 measures voyage-4-lite against OpenAI `text-embedding-3-small` at 1024 dimensions on the retrieval eval before the index fills up; at this corpus size, quality for Spanish and German questions decides, not cost.
