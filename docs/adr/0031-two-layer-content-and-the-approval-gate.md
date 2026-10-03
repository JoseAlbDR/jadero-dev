---
id: ADR-031
title: "Two-layer content and the approval gate"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-11, D-16, D-50, D-51, D-52, D-53, D-65, D-66, D-67]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-031: Two-layer content and the approval gate (new 2026-10-02)")
---

# ADR-031: Two-layer content and the approval gate

**Status:** Accepted with changes (second pass 2026-10-03): the layer model (D-50, a; approval is per entry because entries are English only, the "per-locale" wording in option A below is superseded by the alignment bullet), entry visibility (D-52, a, with the owner's condition that nothing proprietary from the employer appears, enforced by D-53, plus a per-entry `indexable` flag for search engines) and the metadata policy (D-67, a, with the tolerant importer described in the owner-review bullet) are decided. From the owner's input in steering 005.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-11, D-16, D-50, D-51, D-52, D-53, D-65, D-66, D-67). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Content has two layers. **Layer A is the CV:** short, curated, ordered by importance. **Layer B is the agent's knowledge base:** many detailed entries, one per feature, improvement or tech-debt item, each telling problem, context, what the owner built, patterns, trade-offs, testing and rollout, and outcome, so a visitor can drill into any CV claim. Each CV bullet links to its knowledge entries by stable id. Only owner-approved entries are indexed. Many entries describe work for the current employer, so approval is also the moment the owner confirms an entry is public-level.

## Model (in `api`'s content module)

- `CvBullet` (Layer A): stable id (`cvb_<ulid>`), parent `ExperienceItem` or `Project`, order, importance 1 to 3 (decides what fits the PDF CV's page limit), per-locale text, `entryIds[]` linking to Layer B.
- `KnowledgeEntry` (Layer B): stable id (`kbe_<ulid>`, never changes) plus a human slug per locale, parent experience item or project, kind (`feature`, `improvement`, `tech_debt`, `incident`, `learning`), period, tags (stack, patterns), and structured sections per locale: `problem`, `context`, `built`, `patterns`, `tradeoffs`, `testingRollout`, `outcome`. Revisions like every aggregate.
- **Approval state per entry and locale:** `draft`, `in_review`, `approved`, `withdrawn`. Approval points at exactly one revision (`approvedRevisionId`) and records `approvedAt` and the checklist answers. Editing an approved entry creates a new draft revision; the approved revision stays live until the new one is approved.

## The approval gate, three independent checks (defense in depth)

  1. *Producer:* `api` emits `knowledge.entry.approved.v1` (carrying the full approved revision) only from the approve use case, and `knowledge.entry.withdrawn.v1` on withdrawal or deletion. Drafts never produce events.
  2. *Consumer:* `agent-ingest` validates `approval.state == "approved"` and the revision id in every payload and sends anything else to the dead-letter queue with an alert, so a producer bug cannot leak a draft into the index.
  3. *Reconciliation:* `api-worker` publishes a daily `knowledge.snapshot.v1` listing approved `(entryId, locale, revisionId)` triples; `agent-ingest` deletes anything indexed that is not on the list (anti-entropy, without any synchronous call between services).
  Withdrawal deletes the entry's chunks and read-model rows at once (a tombstone event); chat threads that quoted it expire within 24 hours.

## Approval checklist (admin, every box required)

no client or customer names; no internal system, service or repository names beyond what is already public; no non-public numbers; no employer code or configuration; wording the owner would use in an interview. Automated pre-check that warns but never decides: a **private denylist** of internal terms that the owner maintains in the admin (stored in `api`'s database, never in the repo, because a denylist in a public repo would itself leak the names) and an optional LLM review through the chat port that flags risky sentences.

## Ingestion and chunking for two layers

- Layer A: one chunk per CV bullet, header `CV > Role at Organization (2024 to now) > bullet 3 of 6`, metadata `layer=cv`, `bulletId`, `entryIds`.
- Layer B: one chunk per entry section (short sections merged with the next), header `Knowledge entry kbe_...: <title> | Role: ... | Section: Trade-offs | Tags: outbox, idempotency`, metadata `layer=kb`, `entryId`, `section`, `revisionId`.
- **Parent-document ("small-to-big") retrieval:** search matches small section chunks (precise), then the answer node receives the whole parent entry, all sections, bounded to about 1,500 tokens, for the top 1 to 3 entries. Retrieval stays sharp and answers get the full story.
- **Deterministic drill-down:** every CV bullet on the site has an "Ask about this" action that sends its `bulletId`; the retrieve node then fetches the linked entries by id (no vector search) and answers from them. Tools `getEntriesForCvBullet(bulletId)` and `getKnowledgeEntry(entryId, section?)` let the model drill down mid-conversation.
- **Layer-aware ranking:** general questions search both layers; a CV hit expands to its linked entries; knowledge-entry sections are preferred as citation sources because they hold the evidence.

## Citations

at entry-section level (`[S2]` resolves to `/en/work/<slug>#tradeoffs`); a CV bullet cites its entries. Anything the agent can read, a visitor can extract, so **approved means public**: each approved entry also gets a public "work log" page on the site, which gives every citation a real target and makes the evidence browsable (D-52).

## Coverage tooling (admin)

CV bullets without an approved linked entry are flagged as unsupported claims; approved entries linked from no bullet are flagged as orphans; approval status is shown per locale. If the visitor's locale has no approved translation, the agent answers in that language from the approved translation it has and cites it.

## Evals

every CV bullet becomes a golden item ("Tell me more about <bullet>") whose expected sources are its linked entries (a deterministic recall check, no LLM needed); an approval-gate eval plants a canary sentence in a draft-only test entry and asserts it never appears in the index or any answer.

## Alignment with the agreed entry format (amended 2026-10-02, steering 006)

Entries arrive as one Markdown file each, in the format of `data/jadero-dev-v2/knowledge-entry-format.md` (YAML front matter + nine fixed headings). Where it differs from the model above, the format wins:
- *Ids:* the entry id is the front-matter `id` (kebab-case, `kb-...`, never reused), replacing `kbe_<ulid>`; CV bullet ids are human-readable (for example `backend-10`), replacing `cvb_<ulid>`.
- *Links:* each entry names at most one CV line in `cv_bullet`; a bullet's list of entries is the reverse lookup, not a field the owner maintains. `related` links entries to each other and feeds a one-hop "related work" expansion in drill-down.
- *Sections:* `Summary`, `Problem`, `What he built`, `How it works`, `Trade-offs and alternatives`, `Testing and rollout`, `Outcome`, `Lessons`, `Questions this answers`, always in this order. One chunk per section; the self-contained `Summary` also leads every parent expansion. A whole entry is 300 to 900 words (about 400 to 1,200 tokens), so parent-document expansion fits the 1,500-token budget.
- *Question anchors:* each line under `Questions this answers` is indexed as its own small chunk that points to the entry (the doc2query or "hypothetical questions" technique: a visitor's question matches a question better than it matches prose). The same questions seed the eval battery (ADR-036).
- *Language:* entries are English only, so approval is per entry, not per locale. Spanish and German visitors are served by multilingual embeddings, a multilingual reranker and translated question anchors generated at ingestion (D-66); full translations stay optional (WP-32).
- *Contextual header* built from front matter: `[kb-...] <title> | <type> | <domain> | <period> | role: <role> | stack: ... | patterns: ... | section: How it works`.
- *Metadata policy (D-67):* indexed and shown: title, type, domain, period, role, stack, patterns. Private, never indexed: `sources`, `conflicts`, `public_names`, `confidence`. `confidence: medium` makes the agent hedge ("according to the design notes") when it uses that entry.
- *Approval source (D-65):* the owner flips `approved: true` in the file. The importer (admin upload or a CLI on the admin API) validates the file, runs the automated checks, creates a revision, and records the approval bound to that revision only when the flag is true and every check passes; otherwise the entry stays a draft and is never indexed. Withdrawal is an admin action (or a re-import with `approved: false`). Entry files are stored in `api`'s database only, never in the repo.
- *Automated checks in the importer:* required front-matter fields and heading order; 300 to 900 words; no em dashes; no URLs, ticket-like keys (`ABC-123`), commit hashes or long numbers; every capitalized third-party name must be listed in `public_names` (an allowlist) and must not be on the owner's private denylist. Checks warn in the admin and block an approval recorded by import.

## Considered options

- *A. Two layers, structured entries, per-locale approval, approval-gated indexing* (above). Pros: every CV claim can be drilled into with evidence; structure feeds better chunks and answers about patterns and trade-offs; approval tied to a revision is hard to get wrong. Cons: the owner has many entries to write; a structured editor to build.
- *B. Single layer* (projects, posts and experience items only). Pros: far less writing. Cons: CV claims cannot be drilled into; the agent has thin evidence and generic answers.
- *C. Entries as free-form Markdown posts with a private flag.* Pros: easiest authoring. Cons: no structure for patterns and trade-offs; weaker retrieval; a boolean flag is easier to flip by mistake than an approval bound to a revision.

## Decision

A.

## Consequences

writing and approving entries is the owner's largest content task (WP-28); the admin needs a structured entry editor with the checklist (WP-17); the index lags an approval by seconds, and a withdrawal removes the entry from the index at once.

## Pattern names

summary and evidence layers, approval workflow as a state machine bound to a revision, tombstone events, defense in depth, anti-entropy reconciliation, parent-document (small-to-big) retrieval, deterministic drill-down, citations to stable ids.

## Owner review (2026-10-03)

decided: the sensitivity check (D-53), multilingual handling (D-66), chunking and drill-down (D-51), and the import and approval source with a change (D-65): the admin manages the whole entry lifecycle (list with status, upload, edit as a new draft revision, re-import with the same id to extend, withdraw, delete, export back to the file format); once imported, `api`'s database is the source of truth and files are the interchange format. Decided in the second pass (2026-10-03): the layer model (D-50; the owner's description of the knowledge base matches option A; topics such as tech debt or performance are filters on `type`, `domain` and `patterns`, not separate documents; a big feature becomes several entries linked through `related`), entry visibility (D-52; the owner agrees provided no proprietary employer information appears) and the metadata policy (D-67) with a tolerant importer: `id`, `title`, `type`, `period`, `role`, `approved` and the headings Summary, Problem, What he built and Questions this answers are required; everything else is optional with defaults (a missing `confidence` means medium); empty sections produce no chunk; the word-count rule warns instead of blocking (F-10 to F-12).
