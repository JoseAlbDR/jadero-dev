# jadero.dev v2: instructions for coding agents

Personal site of the owner: a multilingual (es, en, de) portfolio with an ask-me AI agent, built to prove broad engineering skills (backend architecture, messaging, testing, CI/CD, infrastructure, security, product delivery, applied AI, engineering process). Learning is a hard requirement: the owner decides every backend and agent pattern and must understand each step. The frontend is result-only.

## 1. Where the truth lives

- `docs/adr/`: the decision records (ADR-001 to ADR-042). Read `docs/adr/README.md` first. An accepted ADR is never edited; a change is a new ADR that supersedes it (`/adr`).
- `docs/plan/report.md`: the narrative plan (architecture, traces, work packages, releases R0 to R7). On a conflict, the ADR file wins.
- `docs/plan/decisions.json`: the 76 owner decisions as data; ids never change.
- `docs/learning/`: one explainer per learning WP (the learning gate, section 5).
- GitHub Issues: the epic `jadero.dev v2`, one sub-issue per WP, milestones R0 to R7, Project board (ADR-041). The issue is the task; the PR closes it.

Status today: the repo foundation (workspace, lint, architecture rules, git hooks, dev containers, ADR scripts) is in place; services land from WP-3 on.

## 2. Map (target layout, ADR-001)

`apps/web` Next.js 16 public site · `apps/admin` static SPA · `apps/api` NestJS content, auth, media, cv (+ `api-worker`) · `apps/agent` NestJS knowledge, chat, guards, usage (+ `agent-ingest`) · `apps/contact` NestJS form and mail · `apps/mcp` stateless MCP edge (R4) · `packages/contracts` Zod DTOs and events · `packages/messaging` bus port, RabbitMQ and in-memory adapters, outbox, inbox · `packages/platform-nest` bootstrap only · `packages/ai` AI ports and adapters · `packages/agent` LangGraph graph, no Nest · `packages/ui`, `packages/cv`, `packages/config` · `infra/` compose, nginx, rabbitmq, scripts · `.github/workflows/`.

## 3. Commands

- `pnpm verify` lint, architecture check, typecheck, unit tests, affected only and cached by Turborepo: the single "am I done" command. Run it before every commit and again after merging `main`, before pushing. `pnpm verify:all` runs the same on every package (on `main`, where nothing is affected, and in CI).
- `pnpm lint` Biome check, never writes · `pnpm lint:fix` format and safe fixes · `pnpm depcruise` architecture rules · `pnpm test` all unit tests
- `pnpm dev:up` / `pnpm dev:down` Postgres and RabbitMQ in Docker (`infra/compose/`, connection strings in `.env.example`) · `pnpm dev` apps in watch mode, once apps exist
- `pnpm adr:new "Title"` next ADR from the template · `pnpm adr:index` regenerate the index in `docs/adr/README.md` · `pnpm adr:index --check` fail when it is stale
- Arrive with their WP: `pnpm test:int` (Testcontainers, needs Docker), `pnpm db:generate` and `pnpm db:migrate` per service, `pnpm eval` (spends money: never without `EVAL_CONFIRMED=1` and the owner's yes).
- Size test workers from load: `VITEST_MAX_WORKERS` = 12 minus the 1-minute load average minus 3, at least 1, at most 6.

## 4. Architecture rules (import rules enforced by dependency-cruiser; `.claude/rules/` carries the detail)

1. Services own their database; no service reads another's tables; no shared ORM entities (ADR-029).
2. Between `api`, `agent` and `contact` only asynchronous messages through the outbox and RabbitMQ; synchronous HTTP only at the edge (nginx, the MCP edge service, later the gateway).
3. A service that needs another's data keeps its own read model fed by events; the agent never calls `api`.
4. Inside a service: hexagonal modules where there are rules (`domain/`, `application/`, `infrastructure/`, `presentation/`), layered where trivial (ADR-003). Ports are abstract classes. No `utils/` folders.
5. Shared packages hold infrastructure only, never domain code. Message and HTTP contracts live in `packages/contracts` as Zod; events use a CloudEvents envelope and are versioned (`<context>.<event>.v<N>`), changed expand/contract.
6. `packages/agent` and `packages/ai` never import Nest or a database driver.

## 5. Learning protocol (ADR-028, report 12.3)

Learning paths: `apps/api`, `apps/agent`, `apps/contact`, `apps/mcp`, `packages/messaging`, `packages/ai`, `packages/agent`, `packages/contracts`, `packages/platform-nest`, `templates/`, `infra/`, `.github/workflows/`, plus the repo tooling files (`turbo.json`, `pnpm-workspace.yaml`, `packages/config`). For a WP tagged learning:
1. `/wp NN` lists the WP's concepts and decisions and creates branch `wp/NN-slug`.
2. `/learn-step` writes `docs/learning/wp-NN.md`, self-contained (a reading pointer per question and a one-line summary of every WP or ADR it names): concepts from first principles, one concrete trace (real payload, real SQL), named patterns, options with trade-offs, the exact question for the owner. Then it stops.
3. The owner decides. The explainer's front matter gets `decision: recorded` (with the ADR link). Only then may code under the learning paths change (hook `learning-gate.sh` enforces it). Fast path (D-38): a step the owner already knows is marked `known` in the explainer and skips the full explainer and explain-back.
4. Implement in small steps in the main session; after each step append a two-line "what just happened" to the explainer.
5. Recap: the owner explains the design back; record gaps; `pnpm verify` green; commit.
Frontend WPs (`apps/web`, `apps/admin`, `packages/ui`) skip the gate: build to the design system, show screenshots.

## 6. Conventions

- Conventional one-line commits scoped to the service (`feat(agent): add hybrid retrieval`); the PR title is the squash commit and the changelog line. Branch `wp/NN-slug` for a work package (the learning gate reads the number from it), `chore/`, `fix/` or `docs/` for anything else; versions come from the squash commit's type, never from the branch name. PR body `Closes #<issue>`.
- Never add tool attribution footers, model names or session links to commits, PR bodies or code.
- Zod for every boundary; RFC 9457 problem details for errors; JSDoc on every new public method; no hard-coded UI strings (next-intl).
- Owner voice for any user-facing copy and docs: plain English, no hype words, no em dashes.
- Tests: fakes and contract suites first; Testcontainers for anything that touches SQL or the broker; coverage gates of ADR-009.

## 7. Security and content rules (hard)

- Never print or log secrets; list variable names only. Never log message bodies at info level. Hash IPs.
- Never point dev or tests at a real AI or mail provider unless the owner asks; `AI_*_PROVIDER=fake` is the default.
- Every agent tool is read-only and ships with adversarial eval cases; a prompt change requires an eval run (ADR-019, ADR-020).
- Agents never push to `main`, never run deploy scripts, never ssh to the server, never touch production data.
- Content rules (ADR-031): nothing about the owner's employer beyond approved, public-level text; no client names, internal systems, ticket keys, hashes or uncleared numbers, in code, fixtures, issues or PRs. The repo becomes public.

## 8. How-tos

- New ADR: `/adr` (template `docs/adr/0000-template.md`, index regenerated). Supersede, never edit.
- New provider adapter: implement the port's abstract class in `packages/ai`, register it in the factory, add it to the contract suite, add a `fake` if the port has none.
- New locale: `messages/<locale>.json`, routing config, text-search configuration for the locale, CI key check.
- New agent tool: read-only, Zod input in `packages/contracts`, output JSON-encoded and marked as data, adversarial eval case, limit check.
- Explain anything: `/explain <concept or file>`.
