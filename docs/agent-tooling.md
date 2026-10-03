# Agent tooling in this repo

What Claude Code (or any agent that reads `AGENTS.md`) finds here, why each piece exists, and how the owner's framework (firstmate) can integrate it. Decided in ADR-028 (option D: a repo-local setup now, designed to map onto the framework's concepts; the framework's core plugin later if it adds value).

## Files

| Path | What it is | Loaded when |
|---|---|---|
| `AGENTS.md` | The canonical, tool-neutral instructions: where the truth lives, map, commands, architecture rules, the learning protocol, conventions, hard rules, how-tos. Kept short on purpose. | Always (imported by `CLAUDE.md`; read natively by agents that support AGENTS.md) |
| `CLAUDE.md` | `@AGENTS.md` plus a few Claude-specific notes (plan mode, subagents, where overrides go). | Always, by Claude Code |
| `CLAUDE.local.md`, `.claude/settings.local.json` | Personal overrides, gitignored. | Always, by the person who has them |
| `.claude/rules/*.md` | Path-scoped rules with a `paths:` front matter: services, AI and agent, testing, infra, frontend, docs. Each restates the ADRs that apply to those files. | Only when the agent reads or edits a matching file |
| `.claude/settings.json` | Permissions (the usual dev commands pre-approved; `.env` files denied), fake providers as default env, three hooks. | Session start |
| `.claude/hooks/learning-gate.sh` | PreToolUse on Edit/Write: on a `wp/NN-*` branch, a file under a learning path may change only when `docs/learning/wp-NN.md` says `decision: recorded` (or `fast_path: known`, D-38). Exit 2 denies with the reason. The one mechanism that enforces the learning requirement. | Every edit |
| `.claude/hooks/format.sh` | PostToolUse on Edit/Write: Biome format of the touched file once the repo has Biome (WP-1). Never fails. | Every edit |
| `.claude/hooks/session-start.sh` | SessionStart: prints branch, where the decisions are, and the WP's gate status. | Session start |
| `.claude/skills/adr` | `/adr <title>`: new ADR from the template, or supersede one; regenerates the index. | On demand |
| `.claude/skills/wp` | `/wp NN`: checks dependencies and the gate, creates `wp/NN-slug`, proposes the step list, stops for the go. | On demand |
| `.claude/skills/learn-step` | `/learn-step NN [step]`: writes the explainer and stops. The gate opens when the owner's decision is recorded in it. | On demand |
| `.claude/skills/explain` | `/explain <topic>`: first principles plus a concrete trace with file:line and the ADR. | On demand |
| `.claude/agents/reviewer.md` | Subagent with the review checklist: boundaries, messaging, AI and guards, OWASP LLM Top 10, testing gates, secrets, content rules, delivery, learning gate, docs. Reports, never fixes, never approves. | `@agent-reviewer`, or delegated by Claude before a PR review |
| `docs/learning/` | Explainer template and the written explainers. | By the skills and the gate |
| `.github/ISSUE_TEMPLATE`, `PULL_REQUEST_TEMPLATE.md`, `scripts/github/seed.mjs` | The tracking structure of ADR-041 (WP-49). | By people and by `gh` |

Security guardrails (no pushes to the default branch, no deploys, no ssh, no real providers in tests) are stated as rules in `AGENTS.md` section 7 and enforced by the owner's framework and sandbox; this repo does not duplicate them as hooks.

## How a learning WP runs with this tooling

1. `/wp 11`: dependencies checked, branch `wp/11-contact-service`, step list proposed.
2. `/learn-step 11`: `docs/learning/wp-11.md` written; the agent stops. The gate is closed: an edit under `apps/contact/` is denied with "run /learn-step first".
3. The owner reads, asks (`/explain outbox`), decides. The agent records the decision, sets `decision: recorded`. The gate opens.
4. Small steps in the session; after each, two lines in the step log; `pnpm verify` green; commit.
5. `@agent-reviewer` on the PR; the owner reviews; squash merge closes the issue.
A step the owner already knows: `fast_path: known` in the explainer, no full explainer, no explain-back (D-38).

## Integration with the owner's framework (for firstmate)

Concepts map one to one by design (ADR-028 D): plan = `/wp` step list; approve = the owner's recorded decision; per-WP implement = the step log; review gate = `@agent-reviewer`; MR = PR with `Closes #`. What the framework adds if its core plugin is adopted later: its guard hooks and sandbox, its commit skill, retro and learn habits. What stays repo-local regardless: the learning gate (the framework has no equivalent), ADRs tracked in `docs/adr/` (the framework records decisions untracked), GitHub delivery (the framework assumes GitLab). Nothing here references the framework's paths or company material, so the repo can go public as is.

If the framework runs the implementers, point them at `AGENTS.md`; it is tool-neutral and the rules files are plain Markdown. If the framework prefers its own skills, the four here can be dropped and only `learning-gate.sh` and `docs/learning/` need to stay.

## The delivery flow, end to end

One work package moves through nine stages. The owner moves cards to Ready and In progress; the Project workflows move them to In review (PR with `Closes #`) and Done (merge).

| # | Stage | Who | Output |
|---|---|---|---|
| 1 | Ready on the board: dependencies closed, acceptance written, ADRs accepted | Owner | Card in Ready |
| 2 | `/wp NN` | Agent | Branch `wp/NN-slug`, step list, definition of done; stops for the go |
| 3 | `/learn-step NN` (learning WPs) | Agent writes, owner reads | `docs/learning/wp-NN.md`, `decision: pending`; the gate is closed |
| 4 | Decision | Owner | `decision: recorded` with the ADR link; `/adr` first if an ADR changes |
| 5 | Implement one step at a time | Agent in the main session | Green `pnpm verify`, one scoped commit, two lines in the step log, per step |
| 6 | PR | Agent | Title = conventional commit; body `Closes #N`; CI; card moves to In review |
| 7 | Review | `@agent-reviewer`, then the owner | Findings fixed and pushed; the owner explains the design back (Recap) |
| 8 | Merge | Owner | Squash; issue closes; card to Done; release-please PR per service |
| 9 | Ship and write up | Owner present | Staging, production, journal post |

Model and effort: Opus 5.5 at high effort for learning WPs and the reviewer, medium for frontend and chores. When the main session runs on a heavier model than the task needs, `/wp` and `/learn-step` can be delegated to a subagent on Opus; implementation stays in the main session so the owner sees each step.

Compact after the decision is recorded (the reasoning is in the explainer) and after the reviewer has reported (keep the PR number, open findings and the step log).

## What the WP-1 trial changed (2026-10-03)

The first run of the flow (`/wp 1` and `/learn-step 1`, delegated to a subagent on Opus 5.5 from a cloud session) worked end to end and surfaced these gaps, fixed in the same PR as this note:

- `/wp` depended on a logged-in `gh` for the dependency check and the definition of done. It now accepts the GitHub MCP tools, says which source it used, and asks instead of guessing when neither is available.
- `/learn-step` could not reach turborepo.com or pnpm.io through the cloud proxy. It may now query the npm registry, Docker Hub and nodejs.org through Bash, and must mark unverified behavior as **verify**.
- The learning gate did not cover WP-1's own content (`turbo.json`, `pnpm-workspace.yaml`, `packages/config`, the dependency-cruiser, lefthook and commitlint configs). Those paths are now gated too.
- Explainer file names take the WP number as is (`wp-1.md`); the README said `wp-NN.md`, which invited zero padding.
- A "trace" for a tooling WP is a command run with real output; the skill says so now.
- Issues created by the seed carry "Deployed to staging" and "Changelog entry" in every definition of done; for WPs before WP-6 to WP-9 they are n/a, and `/wp` marks them so.

## Model and effort

The project does not pin a model in `.claude/settings.json`; the owner's own settings decide (Opus-class for the main session is the owner's choice). Learning WPs and the reviewer run at high effort; frontend WPs can run lower.

## Maintenance

- A new rule goes into the matching `.claude/rules/*.md`, not into `AGENTS.md`, unless it applies everywhere.
- When a command changes (WP-1 introduces the real `pnpm` scripts), update `AGENTS.md` section 3 in the same PR.
- `AGENTS.md` stays short: if it grows past about 150 lines, move detail into a rule or a skill.
