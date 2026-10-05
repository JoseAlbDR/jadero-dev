# Orchestration: the main session stays lean (applies everywhere)

No `paths:` front matter on purpose: this rule loads in every session. The owner approved the orchestrator pattern on 2026-10-04, at the end of WP-5.

Why: the WP-5 session reached about 700k tokens of context because the main session read library sources and large HTML files and ran every implementation step itself. In the same session three background agents in one working directory switched branches under each other.

The main session keeps only what needs its context: teaching, decisions, challenging the owner's answers, check questions, the explain-back and the recap. Everything context-heavy goes to a subagent. Use the table without waiting for the owner to ask.

| Situation | Use |
|---|---|
| Start a work package | `/wp N` |
| Write the explainer of a learning WP | `/learn-step N`: the `explainer-writer` agent drafts, the main session checks, presents and leads the dialogue |
| Build one step after the decision is recorded | `/step N M`: the main session explains, the `implementer` agent builds, the main session presents and asks one check question |
| A fact about a dependency, tool, version or standard | the `researcher` agent |
| A wide search of the repo | the `Explore` agent |
| A step changed an app, package, module, provider, injection, request path or event; or the last step of a WP | `/map` (the `cartographer` agent) |
| An artifact's source changed | the `cartographer` agent (it republishes and updates `docs/artifacts.md`) |
| About half the steps of a WP of size M or larger are done; a PR is open | the `reviewer` agent |
| The last step of a WP is committed | `/wrap-wp N` |
| The owner asks why or how something works | `/explain <topic>` in the main session |
| A design choice is made or changed | `/adr <title>` |
| A `chore/` PR changes a generic process file (`docs/process/project-kit.md`, "How it stays in sync") | port it to `project-kit`, or add a line to `docs/process/kit-backlog.md` |
| The last step of a learning WP | the journal draft in `/wrap-wp` (an agent writes `docs/journal/wp-N.md`, the owner corrects) |
| A step is closed (check question answered and logged, branch pushed) | print the ready-to-copy `/compact` line of `/step` step 7, so the main session does not carry finished steps |
| A release milestone is closed | the owner runs `/teach` once on that release's themes in `docs/learning/study-backlog.md` (`docs/sessions.md`, "Study a release") |

Context budget: a new WP starts in a fresh session (or after `/clear`); within a WP, compact after each closed step. WP-10 showed why: work from an earlier session carried into the WP pushed the main context past 400k tokens.

Context rule: the main session does not read library sources, files over about 300 lines (the code map, the process pages, `docs/plan/report.md` whole) or generated artifacts (`dist/`, lockfiles, `infra/rabbitmq/definitions.json`, the AsyncAPI output). It asks an agent and reads the report. Reading one ADR, one explainer section or a short source file to check a claim is fine.

Rules for every delegation:
- A subagent's report is under 300 words in the fixed shape its definition gives; never file dumps. The explainer-writer's chat version is the one exception, because the owner reads it.
- Independent agents run in parallel, in the background, while the conversation goes on.
- Parallel agents that touch git (commit, switch, push, write files) always run with `isolation: "worktree"`, and never two agents on the same files. An agent that works on the current branch (the implementer) runs alone in the foreground. Learning code is built in the main checkout, never in a worktree: the learning gate reads the WP number from the branch name.
- Claude Code's permission classifier blocks an agent that edits `.claude/hooks/`, `.claude/rules/`, `.claude/settings.json` or an agent definition under `.claude/agents/` as self-modification. Those edits are made in the main session with the owner present, never delegated.
- The main session verifies the claims that matter before telling the owner: re-run `pnpm verify` on the branch, check the commit with `git show --stat`, open the one line a claim rests on.
- Agents never talk to the owner and never record a decision; the main session does.
