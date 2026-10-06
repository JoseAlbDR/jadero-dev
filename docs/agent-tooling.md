# Agent tooling in this repo

What Claude Code (or any agent that reads `AGENTS.md`) finds here and why each piece exists. Decided in ADR-028 (option D: a repo-local setup). On 2026-10-04 the owner chose to run every work package in Claude Code sessions from this repo, cloud or local, and not to adopt their framework (firstmate); how a session runs is in `docs/sessions.md`.

## Files

| Path | What it is | Loaded when |
|---|---|---|
| `AGENTS.md` | The canonical, tool-neutral instructions: where the truth lives, map, commands, architecture rules, the learning protocol, conventions, hard rules, how-tos. Kept short on purpose. | Always (imported by `CLAUDE.md`; read natively by agents that support AGENTS.md) |
| `CLAUDE.md` | `@AGENTS.md` plus a few Claude-specific notes (plan mode, subagents, where overrides go). | Always, by Claude Code |
| `CLAUDE.local.md`, `.claude/settings.local.json` | Personal overrides, gitignored. | Always, by the person who has them |
| `.claude/rules/*.md` | Path-scoped rules with a `paths:` front matter: services, Nest, AI and agent, testing, infra, frontend, docs. Each restates the ADRs that apply to those files. | Only when the agent reads or edits a matching file |
| `.claude/rules/orchestration.md` | The orchestrator pattern: the "situation, use" table for every agent and skill, the context rule, parallel agents in worktrees, verifying reports. No `paths:`, so it applies everywhere. | Always |
| `.claude/settings.json` | Permissions (the usual dev commands pre-approved; `.env` files denied), fake providers as default env, three hooks. | Session start |
| `.claude/hooks/learning-gate.sh` | PreToolUse on Edit/Write: on a `wp/NN-*` branch, a file under a learning path may change only when `docs/learning/wp-N.md` says `decision: recorded` (or `fast_path: known`, D-38). Exit 2 denies with the reason. The one mechanism that enforces the learning requirement. | Every edit |
| `.claude/hooks/format.sh` | PostToolUse on Edit/Write: Biome format of the touched file once the repo has Biome (WP-1). Never fails. | Every edit |
| `.claude/hooks/session-start.sh` | SessionStart: prints branch, where the decisions are, and the WP's gate status. | Session start |
| `.claude/skills/adr` | `/adr <title>`: new ADR from the template, or supersede one; regenerates the index. | On demand |
| `.claude/skills/wp` | `/wp NN`: checks dependencies and the gate, creates `wp/NN-slug`, proposes the step list, stops for the go. | On demand |
| `.claude/skills/learn-step` | `/learn-step NN [step]`: the `explainer-writer` agent drafts the explainer; the main session checks it, presents it and stops. The gate opens when the owner's decision is recorded in it. | On demand, or by the orchestration rule |
| `.claude/skills/step` | `/step NN M`: one implementation step. The main session explains it, the `implementer` agent builds it, the main session re-runs `pnpm verify`, presents demo, privacy check and step log, and asks one check question. A step that changes a process ends with a real `pnpm dev` run. | Every step after the decision |
| `.claude/skills/map` | `/map`: launches the `cartographer` agent for the current branch. | After a step that changes the shape of the code; last step of a WP |
| `.claude/skills/wrap-wp` | `/wrap-wp NN`: the closing checklist (steps logged, map, docs, artifacts, PR, review, Docker demo, explain-back, journal draft, merge order, kit sync, `/clear` and the next start prompt). | When the last step is committed |
| `.claude/skills/explain` | `/explain <topic>`: first principles plus a concrete trace with file:line and the ADR. | On demand |
| `.claude/agents/reviewer.md` | Subagent with the review checklist: boundaries, messaging, AI and guards, OWASP LLM Top 10, testing gates, secrets, content rules, delivery, learning gate, docs. Reports, never fixes, never approves. | Mid-WP (size M or larger) and on every PR |
| `.claude/agents/implementer.md` | Builds one step under the step contract on the current `wp/` branch: code, tests, `pnpm verify`, demo, step log from the diff, privacy check, one commit, push. Stops on any departure from an ADR or a recorded decision. Never talks to the owner. | From `/step` |
| `.claude/agents/explainer-writer.md` | Drafts `docs/learning/wp-N.md` to the `/learn-step` specification, checks facts, commits, returns the chat version. | From `/learn-step` |
| `.claude/agents/cartographer.md` | Syncs the code map's JSON block with the code, renders it in Chromium, republishes changed artifacts and updates `docs/artifacts.md`. | From `/map` and `/wrap-wp` |
| `.claude/agents/researcher.md` | Answers fact questions with a source and date (`npm view`, `npm pack` and grep, raw docs on GitHub), or marks **verify**. Read-only on the repo. | Whenever a step or answer depends on a fact |
| `docs/learning/` | Explainer template and the written explainers. | By the skills and the gate |
| `docs/local-playbook.md` | The hands-on version of this flow for the owner's machine: setup, what a session looks like, daily loop, what to do when something blocks. | By the owner and every session |
| `.github/ISSUE_TEMPLATE`, `PULL_REQUEST_TEMPLATE.md`, `scripts/github/seed.mjs` | The tracking structure of ADR-041 (WP-49). | By people and by `gh` |

Security guardrails (no pushes to the default branch, no deploys, no ssh, no real providers in tests) are stated as rules in `AGENTS.md` section 7 and backed by Claude Code's permission settings (the `.env` deny in `.claude/settings.json`), the learning gate and the owner's review, plus a sandbox when the session runs in one (cloud sessions do; a local one may not). This repo adds no guard hooks.

## How a learning WP runs with this tooling

1. `/wp 11`: dependencies checked, branch `wp/11-contact-service`, step list proposed.
2. `/learn-step 11`: `docs/learning/wp-11.md` written; the agent stops. The gate is closed: an edit under `apps/contact/` is denied with "run /learn-step first".
3. The owner reads, asks (`/explain outbox`), decides. The agent records the decision, sets `decision: recorded`. The gate opens.
4. `/step 11 1`, `/step 11 2`, ...: the session explains each step, the `implementer` agent builds it (two lines in the step log, `pnpm verify` green, commit), the session asks one check question.
5. `/wrap-wp 11`: `/map`, docs, `@agent-reviewer` on the PR, explain-back, the journal draft for the owner to correct, the kit backlog check; the owner reviews; squash merge closes the issue.
A step the owner already knows: `fast_path: known` in the explainer, no full explainer, no explain-back (D-38).

## Sessions

Every work package runs in a Claude Code session started in this repo. `docs/sessions.md` has what a session reads, the differences between a cloud and a local session, and the prompts to start the next WP, run a frontend WP, resume one or do a chore.

## The delivery flow, end to end

One work package moves through ten stages. The owner moves cards to Ready and In progress; the Project workflows move them to In review (PR with `Closes #`) and Done (merge).

| # | Stage | Who | Output |
|---|---|---|---|
| 1 | Ready on the board: dependencies closed, acceptance written, ADRs accepted | Owner | Card in Ready |
| 2 | `/wp NN` | Agent | Branch `wp/NN-slug`, step list, definition of done; stops for the go |
| 3 | `/learn-step NN` (learning WPs) | Agent writes, owner reads | `docs/learning/wp-N.md`, self-contained, all questions in one message, `decision: pending`; the gate is closed |
| 4 | Decision | Owner | `decision: recorded` with the ADR link; `/adr` first if an ADR changes |
| 5 | Implement one step at a time with `/step` (step contract, `AGENTS.md` section 5) | Main session explains and asks; `implementer` agent builds | Per step: ADR lines named first, green `pnpm verify`, privacy check, step log from the diff, one check question on learning steps, one scoped commit; a mid-WP review for size M or larger |
| 6 | Map and docs (last step), then `/wrap-wp` | `cartographer` agent via `/map` | `docs/architecture/code-map.html` data and the docs the WP changed; artifacts republished when the session can |
| 7 | PR | Agent | Title = conventional commit; body `Closes #N`; CI; card moves to In review |
| 8 | Review, explain back, journal draft | `@agent-reviewer`, then the owner, then an agent | Findings fixed and pushed; the owner explains the design back in their own words (not the decision questions); answers and gaps in the Recap; `docs/journal/wp-N.md` drafted from the Recap and corrected by the owner |
| 9 | Merge | Owner | Squash (remove any tool footer from the body); issue closes; card to Done; release-please PR per service |
| 10 | Ship | Owner present | Staging, production; the journal post is published from the admin once WP-39 exists |

Model and effort: Opus 5.5 at high effort for learning WPs and the reviewer, medium for frontend and chores. Since 2026-10-04 the orchestrator pattern applies (next section): the owner still sees each step, because the main session explains it before the build and presents the report after it.

## The orchestrator pattern (2026-10-04)

Why: the WP-5 session reached about 700k tokens of context, because the main session read library sources and large HTML files and ran every implementation step itself. In the same session three background agents in one working directory switched branches under each other.

What: the main session keeps what needs its context (teaching, decisions, challenging the owner's answers, check questions, explain-back, recap) and delegates the rest: drafting explainers (`explainer-writer`), building steps (`implementer`), the code map and artifacts (`cartographer`), facts (`researcher`), reviews (`reviewer`), wide searches (`Explore`). Each agent returns a report under 300 words in a fixed shape; the main session checks the claims that matter (re-runs `pnpm verify`, looks at the commit) before telling the owner. Independent agents run in parallel in the background; any that touch git run with `isolation: "worktree"`, never two on the same files. The table of which to use when is `.claude/rules/orchestration.md`, which loads in every session, so the main session picks the agent without the owner asking.

Compact after the decision is recorded (the reasoning is in the explainer) and after the reviewer has reported (keep the PR number, open findings and the step log).

## What the two trials changed (2026-10-03)

The flow ran end to end on WP-1 from a cloud session (`/wp`, `/learn-step`, seven implementation steps delegated to subagents on Opus 5.5, PR #66, the reviewer agent, fixes) and `/wp 3` plus `/learn-step 3` ran on the first service WP. Everything below was fixed in #65 and in the PR that carries this note; the rest is listed as open.

Fixed:

- `/wp` works without a logged-in `gh` (GitHub MCP tools, or ask), names the source of the definition of done, marks n/a items, and has a rule for stacking a branch on an unmerged dependency (branch from its PR, rebase after the merge).
- `/learn-step` may query the npm registry, Docker Hub and nodejs.org through Bash (documentation sites can be unreachable), marks unverified behavior as **verify**, asks for two traces on a service WP (success and failure), and the template gained a Facts checked table and a Proposed steps section. Spike results go under Options; a changed answer is an amendment under Decision.
- The learning gate also covers the repo tooling files, `packages/platform-nest` and `templates/`.
- Explainer names take the WP number as is (`wp-1.md`).
- The seed marks staging and changelog items n/a for R0 work packages.
- Commit identity: a cloud session commits as the tool, and a squash merge would then add a co-author trailer to `main`. The branch authors were reset to the owner before the PR; `git config user.name` and `user.email` in the checkout are set to the owner. Local sessions never see this.
- Turborepo 2.11 writes an agent-rules block into `AGENTS.md` when it detects an agent; `turbo.json` sets `agentGuidance: false` so a dependency does not author agent instructions.
- Turborepo's `.turbo/` metadata matched the root lint inputs, so the cache never hit; the inputs now exclude it.

Open, for the owner:

- The `@nestjs/observe` question of ADR-010 is settled by WP-3 decision F1 (`NodeSDK` with an explicit list, no new ADR). Whether the broker belongs in `api`'s readiness check was settled by WP-5: `api` checks Postgres only, `api-worker` and the agent consumer check Postgres and the broker.
- Closed in WP-10 step 8: `docs/plan/report.md` named the databases `jadero_content`, `jadero_agent` and `jadero_contact`; it now uses the ADR-027 pattern `<context>_<env>` (`content_dev`), like the dev init script and `.env.example`.
- A learning WP run without the owner present is the exception, not the pattern. WP-1 ran in the cloud; its explain-back and the first `pnpm dev:up` were done afterwards on the owner's machine and are recorded in `docs/learning/wp-1.md`.

## Model and effort

The project does not pin a model in `.claude/settings.json`; the owner's own settings decide (Opus-class for the main session is the owner's choice). Learning WPs and the reviewer run at high effort; frontend WPs can run lower.

## Maintenance

- A new rule goes into the matching `.claude/rules/*.md`, not into `AGENTS.md`, unless it applies everywhere.
- When a command changes, update `AGENTS.md` section 3 in the same PR.
- `AGENTS.md` stays short: if it grows past about 150 lines, move detail into a rule or a skill.
