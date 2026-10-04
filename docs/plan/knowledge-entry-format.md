# Layer B knowledge entry format (for main's catalog output)

Goal: entries that ingest cleanly into the jadero.dev agent's RAG (structure-aware chunking with contextual headers, hybrid lexical + semantic search, reranking, citations). One Markdown file per entry. Same headings in every file, in this order, so every chunk carries a predictable section name.

## Frontmatter (YAML, required)
```yaml
id: kb-invoice-approval-workflow      # stable, kebab-case, never reused
title: Invoice approval workflow
type: feature | improvement | tech-debt | integration | performance | tooling | workshop
domain: billing | contracts | integrations | platform | ai-tooling | ...
period: 2025-03 to 2025-05           # month precision
role: sole author | lead | contributor   # his real role
stack: [NestJS, PostgreSQL, DynamoDB, AWS CDK]
patterns: [partial unique index, event-driven, feature flag, soft delete]
cv_bullet: backend-10                 # id of the approved CV line it details, or none
related: [kb-configurable-statuses]   # other entry ids
public_names: [Acme Payments]             # third-party names used; each must be publicly presented by the company
sources: [merged MRs, ADR, spec, Confluence page]   # kinds only, no links or ids
confidence: high | medium            # medium when only docs, not code, support a detail
conflicts: none | "<doc said X, shipped code does Y; text follows the code>"
approved: false                      # the captain flips this; unapproved entries are never indexed
```

## Body (required headings, plain prose, 300 to 900 words total)
- `## Summary`: 2 to 3 sentences, self-contained (a chunk retrieved alone must still make sense).
- `## Problem`: what was wrong or missing, who it hurt, constraints.
- `## What he built`: concrete behavior, components, his part.
- `## How it works`: the mechanism, step by step, named patterns.
- `## Trade-offs and alternatives`: what was considered and why rejected.
- `## Testing and rollout`: tests, flags, migrations, staged rollout.
- `## Outcome`: qualitative result; numbers only if the captain cleared them.
- `## Lessons`: what he would repeat or change.
- `## Questions this answers`: 3 to 6 natural questions a visitor might ask, in English (they become retrieval anchors and eval seeds).

## Rules
- Write in English, third person ("he"), no em dashes, no hype words.
- Code that shipped is the source of truth; a document adds context only when it agrees; otherwise record it under `conflicts`.
- Public-level only: no customer names, internal repo or package names, ticket keys, URLs, hashes or uncleared numbers.
- One entry per distinct piece of work; split a big initiative into entries linked through `related`.
