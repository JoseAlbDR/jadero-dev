---
id: ADR-013
title: "Provider-agnostic AI layer (ports and adapters)"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-13]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-013: Provider-agnostic AI layer (ports and adapters)")
---

# ADR-013: Provider-agnostic AI layer (ports and adapters)

**Status:** Accepted with a change (owner review 2026-10-03, D-13): embeddings fixed per index version, chat model movable per role. Requested by the owner in steering 001.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-13). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The owner wants to switch providers per role (chat model, embeddings, reranker) by configuration, and believes ports and adapters is the right shape. LangChain.js already ships provider abstractions: `BaseChatModel` (with `bindTools`, streaming, `usage_metadata`), `Embeddings` (`embedDocuments`, `embedQuery`), `VectorStore`, and document compressors for reranking.

## Considered options

- *A. Own ports for everything:* `LlmPort`, `EmbeddingsPort`, `RerankerPort`, `VectorStorePort`, one adapter per provider over the vendor SDKs. Pros: zero framework leakage into the core; the purest form of the pattern; every adapter is ours to test. Cons: you re-implement tool-calling normalization and token streaming per provider (Anthropic content blocks vs OpenAI tool calls vs others), which LangGraph's `messages` streaming and tool nodes then cannot use directly. A lot of code whose lesson (vendor message formats) is not the lesson the owner is after.
- *B. LangChain's abstractions as the ports:* the core depends on `BaseChatModel`, `Embeddings`, `VectorStore`; adapters are LangChain integration packages (`@langchain/anthropic`, `@langchain/openai`, a Voyage integration). Pros: least code; everything in LangGraph plugs in. Cons: the domain's invariants are not in those interfaces: `Embeddings` has no notion of model identity or dimension, so nothing stops mixing vectors from two models in one index; LangChain's `VectorStore` hides the SQL we want to own (hybrid search, index versions); rerankers are not a first-class port; the core becomes coupled to LangChain's release cadence everywhere.
- *C. Hybrid:* own ports where the domain has invariants, LangChain's `BaseChatModel` as the chat port.
  - `EmbeddingsPort { modelId; dimension; embed(texts, inputType: "query" | "document") }`: carries identity and dimension so the index can enforce them.
  - `RerankerPort { modelId; rerank(query, docs, topK) }` with a `none` adapter (pass-through) for A/B evaluation.
  - `KnowledgeIndexPort` (our vector store): `upsertChunks`, `deleteBySource`, `hybridSearch(query, filters)`, implemented with Drizzle over pgvector + full-text.
  - `GuardClassifierPort { classify(text): Verdict }`, with LLM, local ONNX and fake adapters (ADR-020).
  - Chat model: the core depends on `BaseChatModel` (LangChain core types only), created by our factory from config through `initChatModel` or the provider package; adapters are thin wrappers that pin provider-specific settings (max tokens, caching headers).
- Pros of C: invariants enforced where they matter, all LangGraph features available for the chat path, provider swap is a config change for every role. Cons: two styles of port to explain (that contrast is part of the lesson: "own the port when you own the invariant").

## Decision

C.

## Config-driven selection

- Env, validated by a Zod schema at boot: `AI_CHAT_PROVIDER=anthropic|openai|fake`, `AI_CHAT_MODEL=claude-haiku-4-5`, `AI_GUARD_PROVIDER=anthropic|openai|onnx|fake`, `AI_GUARD_MODEL=...`, `AI_EMBEDDINGS_PROVIDER=voyage|openai|fake`, `AI_EMBEDDINGS_MODEL=voyage-4-lite`, `AI_EMBEDDINGS_DIM=1024`, `AI_RERANK_PROVIDER=voyage|cohere|none|fake`, `AI_RERANK_MODEL=rerank-2.5-lite`.
- A Nest dynamic module `AiModule.forRootAsync()` calls a pure `createAiProviders(config)` factory from `packages/ai` (Factory + Strategy patterns) and binds each port to an injection token. The factory refuses invalid combinations at boot (for example an embeddings model whose dimension does not equal `AI_EMBEDDINGS_DIM` and cannot be truncated to it).
- Because the factory is a plain function, eval scripts and the MCP server reuse it without Nest.

## Switching embedding providers: what really happens

Vectors from two different models live in different spaces; comparing a voyage vector with an OpenAI vector is meaningless even at the same dimension. So a switch always means re-embedding everything. The design makes that safe:
  1. Fixed column `embedding vector(1024)`. Both voyage-4 models (1024 default, Matryoshka 256/512/2048) and OpenAI `text-embedding-3-*` (with the `dimensions` parameter) produce 1024 dimensions, so a switch between them needs no schema change. A model that cannot produce 1024 needs a new column and index: a normal expand/contract migration.
  2. Every chunk row carries `index_version`; a table `knowledge.index_versions(id, embeddings_model, dimension, status: building|active|retired, created_at)` records what produced each version.
  3. A switch is a **blue-green re-index**: create version N+1 as `building`, a job re-embeds every published chunk into new rows, verification compares counts and runs the retrieval eval, then one transaction flips N+1 to `active` and N to `retired`; queries always filter `index_version = active`. Rollback is flipping back. Old rows are deleted later.
  4. One partial HNSW index per active version (`WHERE index_version = N`).
  5. Cost of a full re-index for this corpus (about 150k to 250k tokens across three locales): free inside Voyage's 200M free tokens, a few cents on OpenAI.

## Tests with fake adapters

`FakeEmbeddings` hashes word n-grams into 1024 buckets and normalizes, so texts sharing words are near each other (retrieval tests become meaningful and deterministic); `FakeReranker` scores by keyword overlap; LangChain's `fakeModel` scripts chat responses and tool calls and records what the model received; `InMemoryKnowledgeIndex` for unit tests, the real Drizzle adapter in Testcontainers integration tests. All adapters, fake and real, pass the same contract suites (ADR-009).

## Discarded

A (too much non-transferable plumbing, blocks LangGraph features), B (domain invariants unprotected, core coupled to LangChain everywhere).

## Pattern names

ports and adapters, anti-corruption layer, abstract factory, strategy, blue-green deployment applied to data, expand/contract migration, contract testing.

## Fixed and movable parts (owner review 2026-10-03, D-13)

the embedding model, the vector dimension and the chunking rules are fixed per index version and change only through a planned blue-green re-index; the chat model per graph role, the reranker and the guard classifier are movable by config, because no stored data depends on them. Config: `AI_CHAT_MODEL` is the default for every role, and optional per-role overrides (`AI_CHAT_MODEL_<ROLE>`, for example `AI_CHAT_MODEL_ANSWER`) are adopted only after an eval experiment shows they pay for their price.
