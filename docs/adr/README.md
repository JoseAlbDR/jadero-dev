# Architecture decision records

One file per decision, MADR-style, numbered and immutable once accepted. The index below is generated from each file's front matter by `pnpm adr:index`; never edit the table by hand. `pnpm adr:index --check` fails when it is stale.

Rules (ADR-028, section 12.1 of the plan):

- An accepted ADR is never edited. A change of mind is a new ADR with `supersedes: [ADR-NNN]`; the old one gets `status: superseded` and `superseded_by`.
- Every ADR names the owner decisions it records (`decisions: [D-n]`), which link back to `docs/plan/decisions.json`.
- `docs/plan/report.md` keeps the narrative, the traces and the sources; on a conflict, the ADR file wins.
- Status values: `proposed`, `accepted`, `rejected`, `superseded`. "Accepted with a change" in the status line means the owner accepted the recommendation and a note of theirs changed part of it; the change is in the text.
- New ADRs are created from `0000-template.md` with `pnpm adr:new "Title"` or the `adr` skill.

<!-- adr-index:start -->
| ADR | Title | Status | Decisions | File |
|---|---|---|---|---|
| ADR-001 | Monorepo tooling | accepted | D-1 | [0001-monorepo-tooling.md](0001-monorepo-tooling.md) |
| ADR-002 | Runtime topology and the edge | accepted | D-2, D-44, D-45 | [0002-runtime-topology-and-the-edge.md](0002-runtime-topology-and-the-edge.md) |
| ADR-003 | Internal architecture of each service | accepted | D-3 | [0003-internal-architecture-of-each-service.md](0003-internal-architecture-of-each-service.md) |
| ADR-004 | NestJS major version and module system | superseded by ADR-042 | D-4 | [0004-nestjs-major-version-and-module-system.md](0004-nestjs-major-version-and-module-system.md) |
| ADR-005 | Data access (ORM) | accepted | D-5 | [0005-data-access.md](0005-data-access.md) |
| ADR-006 | Validation, contracts and API documentation | accepted | D-6 | [0006-validation-contracts-and-api-documentation.md](0006-validation-contracts-and-api-documentation.md) |
| ADR-007 | Configuration and secrets | superseded by ADR-043 | D-7 | [0007-configuration-and-secrets.md](0007-configuration-and-secrets.md) |
| ADR-008 | Admin authentication | accepted | D-8, D-47 | [0008-admin-authentication.md](0008-admin-authentication.md) |
| ADR-009 | Testing strategy and coverage targets | accepted | D-9 | [0009-testing-strategy-and-coverage-targets.md](0009-testing-strategy-and-coverage-targets.md) |
| ADR-010 | Observability | accepted | D-10 | [0010-observability.md](0010-observability.md) |
| ADR-011 | Content management approach | accepted | D-11, D-20 | [0011-content-management-approach.md](0011-content-management-approach.md) |
| ADR-012 | Asynchronous work (outbox, broker, jobs) | accepted | D-12 | [0012-asynchronous-work.md](0012-asynchronous-work.md) |
| ADR-013 | Provider-agnostic AI layer (ports and adapters) | accepted | D-13 | [0013-provider-agnostic-ai-layer.md](0013-provider-agnostic-ai-layer.md) |
| ADR-014 | Model and provider per role | accepted | D-14 | [0014-model-and-provider-per-role.md](0014-model-and-provider-per-role.md) |
| ADR-015 | Agent graph shape | accepted | D-15 | [0015-agent-graph-shape.md](0015-agent-graph-shape.md) |
| ADR-016 | RAG pipeline | accepted | D-16 | [0016-rag-pipeline.md](0016-rag-pipeline.md) |
| ADR-017 | Conversation state and streaming | accepted | D-17 | [0017-conversation-state-and-streaming.md](0017-conversation-state-and-streaming.md) |
| ADR-018 | Where MCP adds real value | accepted | D-18 | [0018-where-mcp-adds-real-value.md](0018-where-mcp-adds-real-value.md) |
| ADR-019 | LangSmith tracing and evals | accepted | D-21, D-22 | [0019-langsmith-tracing-and-evals.md](0019-langsmith-tracing-and-evals.md) |
| ADR-020 | Guard architecture and guardrail libraries | accepted | D-25 | [0020-guard-architecture-and-guardrail-libraries.md](0020-guard-architecture-and-guardrail-libraries.md) |
| ADR-021 | Abuse and cost controls | accepted | D-26, D-27, D-28 | [0021-abuse-and-cost-controls.md](0021-abuse-and-cost-controls.md) |
| ADR-022 | Internationalization | accepted | D-19, D-20 | [0022-internationalization.md](0022-internationalization.md) |
| ADR-023 | Design system and visual direction | accepted | D-23, D-74 | [0023-design-system-and-visual-direction.md](0023-design-system-and-visual-direction.md) |
| ADR-024 | Lint, format and architecture fitness functions | accepted | D-35 | [0024-lint-format-and-architecture-fitness-functions.md](0024-lint-format-and-architecture-fitness-functions.md) |
| ADR-025 | Versioning and releases | accepted | D-36 | [0025-versioning-and-releases.md](0025-versioning-and-releases.md) |
| ADR-026 | Pipeline, environments, images and deploy | accepted | D-29, D-32 | [0026-pipeline-environments-images-and-deploy.md](0026-pipeline-environments-images-and-deploy.md) |
| ADR-027 | Hosting layout | accepted | D-30, D-31, D-48 | [0027-hosting-layout.md](0027-hosting-layout.md) |
| ADR-028 | Agent tooling for the repo | accepted | D-34 | [0028-agent-tooling-for-the-repo.md](0028-agent-tooling-for-the-repo.md) |
| ADR-029 | Service boundaries and messaging | accepted | D-39, D-40, D-41, D-42, D-43, D-49 | [0029-service-boundaries-and-messaging.md](0029-service-boundaries-and-messaging.md) |
| ADR-030 | Contact service | accepted | D-28, D-37, D-46 | [0030-contact-service.md](0030-contact-service.md) |
| ADR-031 | Two-layer content and the approval gate | accepted | D-11, D-16, D-50, D-51, D-52, D-53, D-65, D-66, D-67 | [0031-two-layer-content-and-the-approval-gate.md](0031-two-layer-content-and-the-approval-gate.md) |
| ADR-032 | Recruiter mode | accepted | D-54, D-55 | [0032-recruiter-mode.md](0032-recruiter-mode.md) |
| ADR-033 | "Under the hood" page | accepted | D-56 | [0033-under-the-hood-page.md](0033-under-the-hood-page.md) |
| ADR-034 | Build journal and the /now page | accepted | D-57 | [0034-build-journal-and-the-now-page.md](0034-build-journal-and-the-now-page.md) |
| ADR-035 | MCP servers | accepted | D-58, D-59, D-60, D-61, D-62, D-63 | [0035-mcp-servers.md](0035-mcp-servers.md) |
| ADR-036 | Eval battery v1 | accepted | D-64 | [0036-eval-battery-v1.md](0036-eval-battery-v1.md) |
| ADR-037 | Answer feedback loop | rejected | D-68 | [0037-answer-feedback-loop.md](0037-answer-feedback-loop.md) |
| ADR-038 | Semantic cache | accepted | D-69 | [0038-semantic-cache.md](0038-semantic-cache.md) |
| ADR-039 | Multi-agent supervisor | accepted | D-70 | [0039-multi-agent-supervisor.md](0039-multi-agent-supervisor.md) |
| ADR-040 | Chaos test | accepted | D-71 | [0040-chaos-test.md](0040-chaos-test.md) |
| ADR-041 | Work tracking from roadmap to tickets | accepted | D-72 | [0041-work-tracking-from-roadmap-to-tickets.md](0041-work-tracking-from-roadmap-to-tickets.md) |
| ADR-042 | NestJS 12 on Node 24 LTS | accepted | D-4 | [0042-node-24-lts-runtime.md](0042-node-24-lts-runtime.md) |
| ADR-043 | Configuration loaded before Nest, and secrets | accepted | D-7 | [0043-configuration-loaded-before-nest-and-secrets.md](0043-configuration-loaded-before-nest-and-secrets.md) |
<!-- adr-index:end -->

Read in this order for a first pass: 029 (service boundaries), 002 (topology and edge), 003 (inside a service), 012 (async work), 031 (content layers), 013 to 016 (AI layer and RAG), 020 and 021 (security), 025 to 027 (delivery and hosting), 041 (work tracking).
