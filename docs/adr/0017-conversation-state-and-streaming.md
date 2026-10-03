---
id: ADR-017
title: "Conversation state and streaming"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-17]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-017: Conversation state and streaming (amended 2026-10-02)")
---

# ADR-017: Conversation state and streaming

**Status:** Accepted with a change (owner review 2026-10-03, D-17): checkpoints encrypted at rest. **Second pass 2026-10-03:** the encryption moves out of WP-22 into optional WP-56 (R7): the key would live on the same server as the database, so it protects a disk dump and little else, while the real privacy controls (24-hour purge, checkpoint tables excluded from backups, LangSmith masking) are already in WP-22 and D-21. WP-22 stays focused on the graph.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-17). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## State

`PostgresSaver` checkpointer in schema `checkpoints` of the agent's database, keyed by `thread_id`. The thread id lives in a signed, httpOnly cookie for an anonymous session; no visitor account. Threads expire after 24 hours, a scheduled job purges them. No long-term memory about visitors (privacy, and nothing to gain).

## Transport options

Server-Sent Events (one-way stream over plain HTTP, works through nginx with buffering off); WebSockets (two-way, more moving parts, unnecessary for request/response chat); non-streaming JSON (simplest, slow perceived latency).

## Decision

SSE from a Nest endpoint, streaming LangGraph `streamMode: ["messages", "updates"]` mapped to typed events (`token`, `status`, `sources`, `final`, `error`).

## The streaming vs output-guard tension

a guard that runs after generation cannot un-show streamed tokens. Options: buffer the full answer (safe, slow), stream with incremental checks that can abort and replace the message, or stream only after a first-sentence check. Recommended: stream with incremental checks (canary token and system-prompt overlap scanned on a sliding window; on a hit, abort the stream and replace the message with the refusal), plus the full check before persisting. This is acceptable here because the context never contains secrets by design (the corpus is public, the system prompt is written to be harmless if leaked, section 8).

## Change (owner review 2026-10-03, D-17)

stored conversations are encrypted at rest. Checkpoint payloads go through a custom AES-256-GCM serializer passed to `PostgresSaver` (the JS constructor accepts a `serde`; LangGraph's Python package ships an encrypted serializer, the JS one is ours, about 40 lines, **verify at WP time**), with the key from the runtime secrets and a key id per row so it can rotate; threads are purged after 24 hours; checkpoint tables are left out of the off-site backup (ADR-027).
