---
id: ADR-035
title: "MCP servers"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-58, D-59, D-60, D-61, D-62, D-63]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-035: MCP servers (new 2026-10-02; supersedes the timing in ADR-018)")
---

# ADR-035: MCP servers

**Status:** Accepted with a change (second pass 2026-10-03): scope and rollout (D-58), public access (D-60), human proof (D-61), admin authorization (D-62) and the catalog source (D-63) decided; where the servers run decided as D-59 option b: a **stateless MCP edge service** `apps/mcp` hosts both servers on `mcp.jadero.dev`, owns no database and keeps no copy of data, and translates MCP calls into HTTP calls to internal endpoints of the owning services (`agent`: search; `api`: CV, entries, admin actions; `contact`: intros). Consequences: (1) **D-61 adjusted:** `request_intro` calls `contact`'s internal endpoint, `contact` stores the pending intro and writes its own outbox and the confirmation link; the earlier "through the agent's outbox" wording below is superseded. (2) `api` is the OAuth 2.1 **authorization server** (Better Auth) and `mcp` is the **protected resource server**, the standard split, which is a better lesson than hosting both in one process. (3) One internal endpoint set per owning service, about 150 MB, about 2 to 3 days (WP-36 in R4, WP-42 in R6). (4) If `agent` is down, `search_experience` fails cleanly while `get_cv` still works. The owner approved all five MCP pieces; ADR-018's reasoning (MCP where it crosses a boundary, never inside the agent) stands, its "after launch" timing does not.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-58, D-59, D-60, D-61, D-62, D-63). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## The five pieces

- *5a. Public read-only profile MCP:* tools `search_experience` (over the RAG), `get_entry`, `list_projects`, `list_skills`, `get_cv` (per locale); resources: the CV and the ADRs.
- *5b. `match_job_description` tool + an MCP prompt "evaluate fit for this role"*, backed by the recruiter-mode branch (ADR-032).
- *5c. `request_intro` tool* that turns a request into a pending intro for the contact service through RabbitMQ.
- *5d. Private admin MCP* with OAuth 2.1 per the MCP authorization spec: draft posts, review translations, approve knowledge entries, view agent spend and blocked attacks.
- *5e. Read-only catalog of the owner's Claude Code framework:* agents, skills and hooks with descriptions; no company material.

## Rollout (D-58)

5a and 5c at launch (WP-36), 5d as the next learning WP after launch (WP-42), 5b and 5e after (WP-43, WP-44).

## Where they run (D-59)

the public MCP (5a, 5b, 5c, 5e) is the `mcp` process type of `agent`, answering from the agent's own read model (no calls to `api`). The admin MCP (5d) is an `admin-mcp` process type of `api`, because most admin actions are content actions; agent spend and blocked-attack counts reach `api` as hourly `usage.summary.v1` events (event-carried state), so the admin MCP never calls `agent` synchronously. Both use the official MCP TypeScript SDK (v2) or `@rekog/mcp-nest` over Streamable HTTP **(verify Nest 12 and SDK v2 support at WP time)**.

## Public MCP access (D-60)

open (no sign-in) because the data is already public; every tool is annotated read-only except `request_intro`; limits per IP and per MCP session; response size caps; tool errors returned as structured results, never stack traces; request logs without bodies.

## Human proof for `request_intro` (D-61)

an MCP client cannot render a Turnstile widget, and the model calling the tool is not proof of a human. Flow: the tool validates input, publishes `contact.intro.requested.v1` with status `pending_confirmation` and a random one-time token (second pass 2026-10-03, D-59 b: the `mcp` service calls `contact`'s internal endpoint and `contact` writes the outbox row), and returns a confirmation link; the person opens it in a browser, passes Turnstile and confirms; only then does `contact` notify the owner. Unconfirmed requests expire after 48 hours. Limit: 3 requests per IP per day.

## Admin MCP authorization (D-62)

the admin MCP is an OAuth 2.1 protected resource per the MCP authorization spec (the 2026-07-28 profile): it publishes Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource` and answers 401 with a `WWW-Authenticate` pointer to it; clients use authorization code + PKCE; clients identify with Client ID Metadata Documents (dynamic client registration is deprecated in that profile); tokens are short-lived and bound to the admin-MCP resource; scopes per capability (`content:write`, `translations:review`, `knowledge:approve`, `usage:read`) with step-up (`insufficient_scope`) for approvals. Authorization server: Better Auth's `@better-auth/mcp` package (built on its OAuth 2.1 provider, supports that profile and the MCP TypeScript SDK v2) on top of the same GitHub allow-list as the admin login. Approvals over MCP are two-step (`preview_approval` returns the revision diff and check results, then `approve_entry(revisionId, checklist)`), and the importer's automated checks still block. Optional defense in depth: expose the admin MCP only over Tailscale.

## Framework catalog (D-63)

an owner-curated content type (`framework_component`: kind, name, one-paragraph generic description, links to public docs if any) with the same approval gate and denylist pre-check as knowledge entries; optionally seeded by a script the owner runs locally that lists component names, which the owner then rewrites; never generated in CI and never read from the framework repository by any jadero.dev code, because that repository contains company material.

## Options considered for placement

a separate `mcp` service (more isolation, but it would need its own copy of the read model or synchronous calls); MCP endpoints added to every service (no single endpoint for clients, auth duplicated); the recommended process types of the owning services.

## Consequences

two more public surfaces (public MCP, admin MCP) to rate-limit, monitor and red-team; MCP-specific eval cases (tool misuse, injection through tool arguments); the admin MCP is the main learning vehicle for OAuth 2.1 beyond the admin login.

## Pattern names

driving adapter, protected resource, authorization code + PKCE, resource indicators, step-up authorization, out-of-band human confirmation, least privilege per tool.

## Owner review (2026-10-03, F-4; decided b in the second pass, see Status)

the owner prefers MCP in its own service. Proposed: option B reworded as a stateless MCP edge service (`apps/mcp`, both servers on mcp.jadero.dev) that owns no data and calls the owning services' internal endpoints (`agent` for search, `api` for the CV, entries and admin actions, `contact` for intros), so it needs neither a copy of the data nor events; it costs about 150 MB and 1 to 2 days, and gives OAuth 2.1 one home. The rest of this ADR is decided (D-58, D-60 to D-63).
