---
id: ADR-056
title: "The /now page shows the last finished work package"
status: proposed
date: 2026-10-24
deciders: [owner]
decisions: [D-87]
supersedes: [ADR-034]
superseded_by: null
source: null
---

# ADR-056: The /now page shows the last finished work package

**Status:** proposed

## Context

ADR-034 (D-57, option A) made the journal a `Post` kind linked to a WP id and described /now as "a singleton `Now` entry plus the current WP and the latest three journal posts". Building it in WP-39 showed that nothing in the content model knows the current WP. A WP gets its journal post when it closes, so the newest journal post names the last finished WP, not the one in progress. Everything else in ADR-034 holds; this record restates it with that one point changed, because an accepted ADR is superseded, never edited.

## Considered options

- *A. Derive the WP from the newest published journal post and label it "last finished work package"; what is in progress goes in the Now text.* Pros: no extra field, never stale, the label says what the data is. Cons: the page does not name the WP in progress unless the owner writes it in the Now text.
- *B. A `currentWp` field on the `Now` singleton, edited by hand.* Pros: matches ADR-034's wording. Cons: one more thing to remember on every WP start; it goes stale silently.
- *C. Read the current WP from GitHub (the open WP issue).* Pros: always right. Cons: a call from the content service to an external API at the edge of the read path, for one label.

## Decision

A. Journal posts stay a `Post` kind (`journal`) with a `wp` id, go through publish, never auto-publish, and follow the content rules (public-level, owner voice, no em dashes), as ADR-034 decided. /now shows the `Now` singleton's text, the last finished WP derived from the newest published journal post, and the latest journal posts after it. B was discarded because a hand-kept field goes stale; C because it adds an external dependency to a public read for one label. The optional draft assistant through the chat port moves to R2.

## Consequences

WP-39 implements this (`apps/web/src/content/now.ts`, D2 of `docs/learning/wp-39.md`). Each learning WP's definition of done keeps "journal post drafted". If the owner later wants the WP in progress on the page, option B is the change, as a new ADR.

## Pattern names

learning in public, content reuse, human in the loop for generated drafts, derived state over stored state.
