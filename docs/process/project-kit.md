# Project kit: start a new project the jadero.dev way

Approved by the owner on 2026-10-04. A template repository, `project-kit`, that the owner creates on GitHub and uses to start any new project with the same process as jadero.dev: decisions first, learning gate, small steps, an orchestrating main session. Built on 2026-10-04 by firstmate from `docs/process/project-kit-handover.md` (kit PRs #1, #6 and #7); this file is the plan and the sync rule. Where the kit's contents differ from the list below, the kit's README is the current inventory.

## What the kit holds

- **`AGENTS.md` skeleton**: the sections of this repo's `AGENTS.md` with the project-specific parts left as placeholders (where the truth lives, map, commands, architecture rules), and the generic parts kept whole: the learning protocol, the step contract and "How the owner learns".
- **`.claude/`**: the agents (`implementer`, `explainer-writer`, `cartographer`, `researcher`, `reviewer` with a checklist to fill per project), the skills (`/wp`, `/learn-step`, `/step`, `/map`, `/wrap-wp`, `/explain`, `/adr`, `/kickoff`), the rules (`orchestration.md` and `docs.md` as they are, path-scoped rules as examples), and the hooks, including the learning gate with its list of learning paths as configuration.
- **The decision catalog schema**: the shape of `docs/plan/decisions.json` (decisions, options, work packages with tag, size, release, dependsOn, deliverable, learns), with an empty example.
- **`scripts/github/seed.mjs`, generalized**: reads the catalog and creates the epic, one sub-issue per work package, labels, milestones per release and the Project board with its fields and views.
- **Templates**: the ADR template and index script, the learning explainer template.
- **The code map renderer**: the HTML page with an empty JSON data block, so each project fills only data.
- **The process pages**: the local guide and the delivery flow, with project names as placeholders.
- **Examples**: archived copies of jadero.dev artifacts (an explainer, a code map, the plan review page), marked as examples.

## `/kickoff`: phase 0 as a skill

`/kickoff` walks the owner through phase 0 before any code, one stage at a time, stopping after each:

1. **Discovery**: what the project is for, who uses it, constraints (budget, hosting, deadlines).
2. **Brainstorm**: features and quality goals, then cut to a first release.
3. **Owner intent**: what the owner wants to learn or prove, which areas are learning and which are result-only.
4. **Decision catalog**: every open decision with options, pros, cons and a recommendation; the owner chooses; written to `decisions.json`.
5. **Report**: the narrative plan with architecture and traces through the main flows.
6. **ADRs**: one per accepted decision, through `/adr`.
7. **Work packages and releases**: sized, tagged, with dependencies, in the catalog.
8. **GitHub seed**: `seed.mjs` creates the epic, issues, milestones and board.
9. **Walking skeleton**: the first work package, run with `/wp`, `/learn-step` and `/step` like any other.

## How it stays in sync

Process changes land in jadero-dev first, where they are tried on a real work package. Once they work, a `chore/` PR in `project-kit` ports them, with project specifics replaced by placeholders. jadero-dev stays the reference, because it is where the flow runs live; the kit never leads until the owner names it the source of truth.

Generic process files are the ones the kit copies: `AGENTS.md` sections 5 to 8, `CLAUDE.md`, `.claude/` (agents, skills, rules, hooks, settings), `docs/sessions.md`, `docs/agent-tooling.md`, `docs/local-playbook.md`, `docs/learning/wp-template.md`, `docs/adr/0000-template.md`, `docs/process/`, `scripts/github/` and the repo tooling configs. Project content (ADRs, the plan, explainers, code) is never ported.

The rule, so the two never drift silently:
- Every jadero-dev PR that touches a generic file opens its port PR in `project-kit` at the same time (owner, 2026-10-10): one `chore/` PR there that names the jadero-dev PR, and the two merge together. When `project-kit` is not attached, the session (or an agent) clones it into the scratchpad; the owner owns both repositories.
- `docs/process/kit-backlog.md` holds only a port that cannot be done at once (a conflict, a question for the owner): the PR, the files, what to port.
- `/wrap-wp` checks the backlog at the end of every WP and ports what is waiting.
- A change made in `project-kit` first (from a new project) comes back to jadero-dev the same way, through a `chore/` PR, and is listed in the backlog until it lands.
- Phase 0 tooling (`/kickoff`, the `grilling` and `domain-modeling` skills, the kickoff playbook) lives only in the kit: jadero-dev is past phase 0, so it is tried on the first new project, not here.
- Porting the ADR template, `/adr` or `scripts/adr/` includes re-checking the kit's `.claude/skills/domain-modeling/ADR-FORMAT.md`, the bridge that tells the domain-modeling skill how an ADR is laid out.

## History

How jadero-dev itself went through phase 0 (the decisions, the plan review, the first work packages) is `docs/process/genesis.md` in project-kit, the worked example `/kickoff` follows.
