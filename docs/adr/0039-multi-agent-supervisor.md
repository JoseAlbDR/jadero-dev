---
id: ADR-039
title: "Multi-agent supervisor"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-70]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-039: Multi-agent supervisor (new 2026-10-02, steering 007)")
---

# ADR-039: Multi-agent supervisor

**Status:** Accepted (owner review 2026-10-03, D-70). Refines the structure of ADR-015 and ADR-032 without changing their nodes.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-70). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Two specialists now exist: the CV agent (answers about the owner with citations) and the recruiter agent (job-description fit analysis). They differ in prompt, tools, limits, output format and evals. A supervisor decides which one handles a turn.

## Considered options

- *A. Supervisor with explicit handoffs to two agent subgraphs.* The supervisor reuses the input guard's structured classification (`about_owner`, `job_fit`, `off_topic`, `contact`), so routing costs no extra model call; each agent is a subgraph with its own prompt, tools, call limits and eval slice; control returns to the supervisor after each agent turn. Pros: clear separation; each agent testable and evaluated on its own; adding a third agent later is a new subgraph. Cons: more graph structure to understand.
- *B. One graph with branches* (the earlier design). Pros: simplest. Cons: one prompt and tool set grows to serve both jobs; harder to evaluate separately.
- *C. Swarm or network:* agents hand off to each other directly. Pros: flexible. Cons: harder to reason about and to bound; nothing here needs peer-to-peer handoffs.
- *D. A prebuilt supervisor package.* Pros: less code. Cons: hides the routing the owner wants to learn **(check the current LangGraph.js supervisor helper at WP time; build it by hand first either way)**.

## Decision

A, built by hand. When the supervisor sees a pasted job description in the normal chat, it asks "Analyze this as a job description?" before handing off, so a casual message never triggers a costly analysis.

## Consequences

guard, retrieval and citation nodes stay shared; budgets and limits are enforced per agent and globally; the graph shown on the "Under the hood" page and in LangGraph Studio becomes a supervisor with two subgraphs. Following Anthropic's "start simple" guidance, the bar for a third agent is a genuinely different job, not a different topic.

## Pattern names

supervisor, handoff, router, specialization, subgraph.
