---
id: ADR-041
title: "Work tracking from roadmap to tickets"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-72]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-041: Work tracking from roadmap to tickets (new 2026-10-02, steering 007; decided 2026-10-02, steering 008)")
---

# ADR-041: Work tracking from roadmap to tickets

**Status:** Accepted. Decided by the owner on 2026-10-02 (steering 008): option A, GitHub Issues with sub-issues, a GitHub Project board and milestones. It also shows the owner working with those tools. The structure is planned in section 14.1; WP-49 creates it.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-72). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

The roadmap (WP-0 to WP-49) should become one epic split into tickets that follow the full software lifecycle: idea, ready (acceptance criteria written, ADR decided), in progress (branch `wp/NN-slug`), in review (PR with CI and the reviewer agent), done (merge closes the ticket), released (release-please), deployed (staging then production), written up (journal post).

## Considered options

- *A. GitHub Issues with sub-issues + a GitHub Project board + milestones, in the repo.* One epic issue with one sub-issue per WP; an issue template per WP (goal, deliverable, acceptance criteria, ADR links, learning-gate checklist, definition of done: tests and coverage, docs, journal post, deployed to staging); labels for tag, size and area; milestones per phase (walking skeleton, backend core, site, agent, launch, after launch); a Project with custom fields (WP id, tag, size, phase) and board and roadmap views; PRs say `Closes #123`, so merging closes the ticket; release-please's changelog links each PR, which links its issue; agents work it through the `gh` CLI. Pros: lives next to the code; free for private repos; native sub-issues and projects; the lifecycle is visible to reviewers once the repo is public. Cons: GitHub Projects is less polished than Linear.
- *B. Linear.* Pros: the best planning UX, cycles, GitHub integration that links and closes on merge. Cons: another tool and account; the history lives outside the repo, so reviewers of a public repo do not see it; agents need its API.
- *C. Local backlog* (a Markdown file or the firstmate task tool). Pros: offline, agent-friendly. Cons: no board, no automatic PR linking, not a recognizable lifecycle for reviewers.

## Decision

A (matches the recommendation). Why the others were discarded: Linear has the better planning experience, but it adds a tool and keeps the history outside the repo, where reviewers of the public repo will not see it; a local backlog is agent-friendly but has no board, no automatic PR linking and no recognizable lifecycle to show. The same content rules apply to issues as to the site (public-level only, no employer details), because issues become public with the repo. Creating the epic and tickets is WP-49, right after WP-0.

## Pattern names

epic and sub-issues, definition of ready and definition of done, traceability from ticket to PR to release, milestones.
