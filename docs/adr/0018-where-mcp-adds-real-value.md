---
id: ADR-018
title: "Where MCP adds real value"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-18]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-018: Where MCP adds real value (amended 2026-10-02; timing superseded by ADR-035; reframed 2026-10-03)")
---

# ADR-018: Where MCP adds real value

**Status:** Accepted (owner review 2026-10-03, D-18); its timing is superseded by ADR-035 (D-58).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-18). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Considered options

- *A. No MCP.*
- *B. The site agent consumes its own tools through MCP* (expose tools from an MCP server, load them with `MultiServerMCPClient` from `@langchain/mcp-adapters`). Pros: exercises the MCP client side. Cons: a network hop and new failure modes for zero user value; MCP exists to cross process and vendor boundaries, and in-process tools are just functions. Note also that the TypeScript adapter surfaces tool failures as `ToolException` that the caller must handle.
- *C. A public, read-only MCP server at mcp.jadero.dev* exposing `searchKnowledge`, `getProject`, `listProjects`, `getExperience` and the CV as a resource, so anyone can connect "ask about the owner" to Claude Desktop, Claude Code or any MCP client. Built with `@rekog/mcp-nest` (Streamable HTTP, Zod-validated tools, Nest guards and interceptors apply; v2.0.2 recently published) or the official MCP TypeScript SDK. Pros: a concrete, demonstrable integration any AI client can use; reuses the same application services (one more driving adapter, which is exactly what hexagonal promises). Cons: one more public surface to rate-limit.
- *D. MCP during development* (for example a Postgres MCP server for Claude Code against the dev database). Pros: handy. Cons: unrelated to the product.

## Decision

C as a later WP (WP-30), running as an `mcp` process type of the `agent` service on its read model (amended 2026-10-02), A until then; D at the owner's discretion for local work only, never against production.

## Consequences

The MCP server runs no LLM on our side, so the LLM guard layer does not apply; it gets rate limits, response size caps and the same public-only data.
