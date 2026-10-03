---
id: ADR-034
title: "Build journal and the /now page"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-57]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-034: Build journal and the /now page (new 2026-10-02)")
---

# ADR-034: Build journal and the /now page

**Status:** Accepted (owner review 2026-10-03, D-57).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-57). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

A short journal post per learning work package ("what I built, what I learned, what I would change") documents the learning publicly, and a /now page (approved earlier) says what the owner is focused on now. Both are content and both can feed the agent.

## Considered options

- *A. Journal as a `Post` kind (`journal`) in the content module, each linked to a WP id; /now as a singleton `Now` entry plus the current WP and the latest three journal posts; an optional draft assistant turns the WP's learning explainer recap into a post draft through the chat port, and the owner edits and publishes.* Pros: one content system; published posts are indexed for the agent; the learning gate already produces the raw material. Cons: the owner still has to edit every post.
- *B. Journal as Markdown files in the repo.* Pros: written in the editor next to the code. Cons: a second content path; every post is a deploy.
- *C. Auto-published posts generated from commits or changelogs.* Pros: zero effort. Cons: reads like a changelog, not like the owner, and may publish things the owner would not.

## Decision

A. Journal posts follow the same rules as all content (public-level, owner voice, no em dashes) and go through publish, not auto-publish.

## Consequences

WP-39 adds the post kind, the Now singleton and the two pages; each learning WP's definition of done gains "journal post drafted".

## Pattern names

learning in public, content reuse, human in the loop for generated drafts.
