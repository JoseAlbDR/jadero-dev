# Project kit: handover to firstmate

Historical: delivered on 2026-10-04 (project-kit PRs #1, #6 and #7; the stacked #2 to #5 were closed and recovered as #6). Kept as the record of what the kit was built from; the kit's `docs/process/coverage.md` maps every item below.

Written on 2026-10-04 at the end of WP-5. The owner asked firstmate to build the `project-kit` repository (https://github.com/JoseAlbDR/project-kit) because firstmate has what this repo does not: the owner's local files and the conversation where jadero.dev v2 was planned. This file is everything the Claude Code sessions of jadero-dev know that the kit needs, plus the prompt the owner gives firstmate. The plan for the kit itself is `docs/process/project-kit.md`.

## What jadero-dev already holds (copy, then replace project specifics with placeholders)

| Kit part | Source in jadero-dev |
|---|---|
| Agent instructions | `AGENTS.md` (sections 5 to 8 are generic; section 5 "How the owner learns" whole), `CLAUDE.md` |
| Agents | `.claude/agents/` (`implementer`, `explainer-writer`, `cartographer`, `researcher`, `reviewer`) |
| Skills | `.claude/skills/` (`wp`, `learn-step`, `step`, `map`, `wrap-wp`, `explain`, `adr`) |
| Rules | `.claude/rules/orchestration.md` and `docs.md` as they are; `services.md`, `testing.md` and the others as examples |
| Hooks | `.claude/hooks/` (the learning gate; its learning paths become configuration), `.claude/settings.json` (the `.env` deny) |
| Session flow and prompts | `docs/sessions.md`, `docs/agent-tooling.md`, `docs/local-playbook.md` |
| Decision catalog | the shape of `docs/plan/decisions.json`, and `docs/plan/owner-review-followups.md` as an example of a review pass |
| ADRs | `docs/adr/0000-template.md`, the index script (`pnpm adr:new`, `pnpm adr:index`), ADR-028 (repo-local tooling) and ADR-041 (GitHub as the task tracker) as examples |
| Explainers | `docs/learning/wp-template.md`, `docs/learning/README.md`, `docs/learning/wp-5.md` as the worked example |
| GitHub seed | `scripts/github/` (epic, sub-issues, milestones, Project board) |
| Code map | `docs/architecture/code-map.html` (renderer plus a JSON data block) |
| Process pages | `docs/process/local-guide.html`, `docs/process/delivery-flow.html` |
| Artifacts | `docs/artifacts.md` (registry), `docs/artifacts/` (archived plan review page and design gallery, ADR-046) |
| Repo tooling | `biome.json`, `lefthook.yml`, `commitlint.config.mjs`, `turbo.json`, `.dependency-cruiser.cjs`, `pnpm-workspace.yaml` (catalog) |

## What only the sessions learned (put it in the kit, it is not written elsewhere as a list)

- **Decisions first.** Every design choice is taught as problem, concrete example, decision, alternatives (why discarded, when each would win) and pattern names, all in the chat before any question. The owner answers before reading the recommendation; the agent challenges an answer it disagrees with. Questions only for architecture no ADR decides.
- **Persist the process.** Feedback that changes how sessions work goes into the repo in its own `chore/` PR the same day, because the owner works from several machines and sessions share no memory.
- **Check before pushing.** Before pushing to a branch, check its PR is not merged; follow-up work after a merge goes to a new branch from `main`. Say "ready to merge" only after the last push, naming the head commit.
- **Orchestrator.** The main session teaches and decides; subagents build, research, write explainers and maintain artifacts. Parallel agents that touch git run in worktrees. The learning gate reads the WP from the branch name, so learning code is built in the main checkout, never in a worktree (decision of 2026-10-04).
- **Cloud versus local.** Cloud sessions have no Docker: the owner runs Docker steps and pastes the output. Cloud sessions may need Node from `~/.local/node24/bin`. The GitHub integration of a cloud session reaches only the repositories where the Claude GitHub App is installed.
- **Tooling traps seen.** commitlint rejects scopes not in its list (add the scope or use an existing one); a generated file must be run through the formatter by its generator, or lint fails; Turborepo's default concurrency of 10 is too low once each app has a second process (`--concurrency=20`); RabbitMQ queue arguments cannot change after declaration, so use policies.
- **Content rules.** Naming the owner's employer and the owner's work there is fine. Never proprietary code or configuration, client names, internal system names beyond what is public, personal data or secrets.
- **Context budget.** One WP per session; `/clear` after the PR is merged and the next session's prompt is copied. The WP-5 session reached about 700k tokens before the orchestrator existed.

## What firstmate must add (only firstmate has the sources)

1. `docs/process/genesis.md`: how jadero.dev v2 went through phase 0, from the planning conversation and the owner's local files. Discovery, brainstorm, owner intent, how the 76 decisions were collected and marked on the plan review page, the steering passes, how ADRs were extracted from `report.md`, how WPs and releases were cut, and what the owner would do differently.
2. `docs/process/kickoff-playbook.md`: the same phases as a reusable playbook, the script `/kickoff` follows (stages in `docs/process/project-kit.md`).
3. The `/kickoff` skill itself, built from the playbook.
4. Any local file that shaped the plan and is not in jadero-dev, copied in if it passes the content rules, or summarized if it does not.

## Prompt for firstmate

```
Build the template repository https://github.com/JoseAlbDR/project-kit so I can start any new project
(the next one: a WhatsApp or Telegram bot for a psychology practice) with the same process as jadero.dev v2.

Sources:
- jadero-dev main (after PRs #89, #92, #93 and #94 merge). Read docs/process/project-kit.md (the plan)
  and docs/process/project-kit-handover.md (what to copy, what the sessions learned, what only you can add).
- My local files from the planning of jadero.dev v2 and our planning conversation. These are the only
  source for the genesis.

Do, in this order, one PR per item in project-kit, each small enough for me to review:
1. Skeleton: README (what the kit is, how to start a project from it), AGENTS.md and CLAUDE.md with the
   project parts as placeholders, .claude/ (agents, skills, rules, hooks with the learning paths as
   configuration), templates (ADR, explainer), the decision catalog schema with an empty example, the
   GitHub seed script generalized, the code map renderer with empty data, the process pages.
2. docs/process/genesis.md: how jadero.dev v2 was planned, from our conversation and my files.
3. docs/process/kickoff-playbook.md and the /kickoff skill that follows it.
4. examples/: the archived jadero.dev artifacts and wp-5.md, marked as examples.
Then list for me anything you found in my files or our conversation that jadero-dev should also have,
so I can bring it back there.

Rules: plain English, no em dashes, no attribution lines in commits or PRs. Content: naming my employer
and my work there is fine; never proprietary code or configuration, client names, personal data or
secrets. jadero-dev stays the reference: where the kit and jadero-dev differ, jadero-dev wins unless I say so.
```
