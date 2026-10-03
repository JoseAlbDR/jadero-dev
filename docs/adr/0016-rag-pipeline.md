---
id: ADR-016
title: "RAG pipeline"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-16]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-016: RAG pipeline (amended 2026-10-02)")
---

# ADR-016: RAG pipeline

**Status:** Accepted with a change (second pass 2026-10-03): two-layer chunking and retrieval (D-51) decided; the pipeline card decided as D-16 option d: pgvector is the index for R2, and WP-54 (R7) adds a Qdrant adapter behind `KnowledgeIndexPort` (capped at 512 MB), measured with the same retrieval evals (recall@5, MRR, latency) and adopted only if it wins. The "why pgvector and not a vector database" paragraph below stays the reasoning for R2; the port is what makes the later comparison cheap.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-16). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Ingestion

- Source (amended 2026-10-02): published revisions only, per locale, carried in full by `content.published.v1` events into the agent's own read model; the agent never queries `api`.
- Normalization: render structured entities to short Markdown cards (an experience item becomes "Role at Organization, 2024 to now. Stack: ... Highlights: ..."); long bodies stay Markdown.
- Chunking (options: fixed-size tokens; recursive character splitting; structure-aware by headings; semantic chunking by embedding drift): **structure-aware**: one chunk per structured entity; long bodies split by heading, then by paragraph to 200 to 400 tokens with about 15% overlap. Each chunk gets a deterministic **contextual header** prepended before embedding ("Project: jobs-hub > Architecture (de)"), the cheap version of Anthropic's contextual retrieval. LLM-generated chunk context or Voyage's `voyage-context-4` contextualized embeddings are an eval-driven experiment, not the default.
- Idempotency: `content_hash` per chunk; unchanged chunks are not re-embedded.

## Storage (schema `knowledge` in the agent's database)

`chunks(id, source_type, source_id, locale, title, url, anchor, header, content, content_hash, token_count, index_version, embedding vector(1024), tsv tsvector)`; `tsv` is generated with the locale's text-search configuration (`spanish`, `english`, `german`); GIN index on `tsv`; partial HNSW index (`vector_cosine_ops`) per active version.

## Why pgvector and not a vector database

a few hundred to a few thousand chunks; pgvector keeps one database, transactions with the content, one backup. Qdrant or Weaviate would add a service and RAM for no gain at this scale; they earn their place at millions of vectors, heavy filtered search or multi-tenant isolation. Learning note: at under about 10k rows an exact scan is both exact and fast; WP-20 adds HNSW anyway and compares both with `EXPLAIN ANALYZE`, which shows what an approximate index buys and costs (recall vs speed, `ef_search`).

## Retrieval

query embedding (`input_type: query`); vector top 20 and full-text top 20, both filtered by `index_version` and locale (visitor locale first, then `en`, then `es` as fallback; embeddings are multilingual so cross-language matches still work); **Reciprocal Rank Fusion** (k = 60) because cosine scores and full-text ranks are not on comparable scales; rerank top 20; keep the top 5 above a threshold tuned on the eval set.

## Citations (provider-agnostic)

chunks go to the model as JSON objects with ids `S1..S5`; the system prompt requires `[S#]` markers after factual sentences; `citationCheck` resolves markers to URLs and anchors, drops unknown ids, and if the answer states facts with no valid citation, it is replaced by the no-info reply. The UI renders citations as source chips linking to the exact section. Provider-native citation features (for example Anthropic's search-result blocks) are discarded as the primary mechanism because they would tie the core to one provider; they could become an adapter-level enhancement later.

## Re-index

triggered per document by `content.published.v1`; full re-index by an admin action or by an embeddings switch (ADR-013).

## Evaluation of retrieval itself

a labeled set of about 40 questions with the chunk ids that should be found; metrics recall@5 and MRR, computed deterministically without any LLM (cheap, runs in CI).

## Two-layer corpus (new 2026-10-02)

CV bullets and approved knowledge-entry sections are chunked, retrieved (parent-document expansion, deterministic drill-down by bullet id) and cited as specified in ADR-031; only approved revisions are ever indexed.

## Owner review (2026-10-03, F-6; decided d in the second pass, WP-54)

the owner is interested in Qdrant for learning. Proposed option D: pgvector at launch, then a Qdrant adapter behind `KnowledgeIndexPort` as an after-launch learning WP (native hybrid search with RRF in the Query API, collection aliases for the blue-green re-index), adopted only if it beats pgvector on recall@5, MRR and latency on the same evals; about 3 days and a 512 MB memory cap while both run.
