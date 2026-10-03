---
id: ADR-038
title: "Semantic cache"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-69]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-038: Semantic cache (new 2026-10-02, steering 007)")
---

# ADR-038: Semantic cache

**Status:** Accepted (owner review 2026-10-03, D-69).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-69). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Many visitors ask the same few questions ("which stack does José use?", "tell me about the framework"). A semantic cache answers a new question with a stored answer when it means the same as one already answered, saving cost and latency. This differs from provider prompt caching (ADR-014), which only makes a repeated prompt prefix cheaper while the model still generates a fresh answer.

## Considered options

- *A. Exact-match cache* (normalized question text). Pros: no false hits. Cons: misses paraphrases, so few hits.
- *B. Semantic cache in pgvector with precise invalidation* (below). Pros: catches paraphrases; no new service; invalidation tied to the sources each answer cited. Cons: a similarity threshold to tune; risk of serving a near-miss.
- *C. A cache service* (Redis semantic cache libraries). Pros: off-the-shelf. Cons: a new stateful service for a modest hit rate.
- *D. No semantic cache* (prompt caching only). Pros: nothing to get wrong. Cons: no savings on repeated questions.

## Decision

B.

## What gets cached

only first-turn questions with no conversation history, in the CV-agent mode (never recruiter mode, whose input is a private job description), answers that passed every guard and carry at least one valid citation, and never anything from an input the guard classified as adversarial. The cache stores the question embedding, locale, `index_version`, prompt version, model, the answer, the cited source ids, and a hit count.

## Lookup

exact normalized-hash match first, then vector similarity at or above a tuned threshold (start at 0.95), always within the same locale, index version and prompt version.

## Invalidation

(1) a new index version or prompt version misses the whole old cache by construction (both are part of the key); (2) `content.published`, `knowledge.entry.approved` and `knowledge.entry.withdrawn` events delete every cached answer that cited an affected source (a source-id index makes this precise); (3) a 7-day TTL; (4) an admin purge.

## Safety against cache poisoning

an answer becomes servable only after the same question (exact or above threshold) has been asked by two different sessions (a popularity threshold), so one attacker cannot plant an answer for everyone; the deterministic output checks re-run on every hit; a hit still counts toward rate limits and is traced as a hit. The eval battery's paraphrase pairs measure the hit rate, and a set of different-but-similar questions measures the false-hit rate; the threshold is tuned on both.

## Pattern names

cache-aside, semantic caching, tag-based (source-id) invalidation, TTL, cache poisoning defense.
