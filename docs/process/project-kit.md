# Project kit: start a new project the jadero.dev way

Approved by the owner on 2026-10-04. A template repository, `project-kit`, that the owner creates on GitHub and uses to start any new project with the same process as jadero.dev: decisions first, learning gate, small steps, an orchestrating main session. Nothing here is built yet; this file is the plan.

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

Process changes land in jadero-dev first, where they are tried on a real work package. Once they work, a `chore/` PR in `project-kit` ports them, with project specifics replaced by placeholders. jadero-dev stays the reference; the kit never leads.

## History

How jadero-dev itself went through phase 0 (the decisions, the plan review, the first work packages) will be written down in `docs/process/genesis.md`, as the worked example `/kickoff` follows.
