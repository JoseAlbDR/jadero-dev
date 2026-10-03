# GitHub tracking seed (WP-49)

Creates the tracking structure decided in ADR-041 and planned in `docs/plan/report.md` 14.1, from `docs/plan/decisions.json`: labels, milestones R0 to R7 (no due dates), the epic `jadero.dev v2`, one sub-issue per work package with its deliverable, acceptance criteria, learning gate and definition of done, "blocked by" links from `dependsOn`, the closed-as-superseded WP-30 and WP-34, and the Project with its custom fields.

Run it from a machine where `gh` is logged in as the owner:

```bash
gh auth refresh -s project,repo     # once; the project scope is needed for gh project
node scripts/github/seed.mjs --dry-run
node scripts/github/seed.mjs
```

It is idempotent: labels, milestones, issues, fields and items are looked up by name or title and created only if missing, so it can be re-run after adding a WP to `decisions.json`.

What the CLI cannot do (done by hand once, in the Project UI): rename the Status options to Backlog, Ready, In progress, In review, Done; create the four views (Board by Status, Roadmap by Release, Table grouped by Tag, Learning filtered to `tag:learning`); enable the built-in workflows (item added to Backlog, PR opened to In review, issue closed to Done).

Rules that make the board work: the branch is `wp/NN-slug`; the PR title is a conventional commit scoped to the service; the PR body says `Closes #<issue>`; squash merge. When a learning WP starts, its explainer's step list becomes sub-issues of that WP (`type:task`).
