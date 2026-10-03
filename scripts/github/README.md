# GitHub tracking seed (WP-49)

Creates the tracking structure decided in ADR-041 and planned in `docs/plan/report.md` 14.1, from `docs/plan/decisions.json`: labels, milestones R0 to R7 (no due dates), the epic `jadero.dev v2`, one sub-issue per work package with its deliverable, acceptance criteria, learning gate and definition of done, "blocked by" links from `dependsOn`, the closed-as-superseded WP-30 and WP-34, and the Project with its custom fields, Status options and field values per item.

Run it from a machine where `gh` is logged in as the owner:

```bash
gh auth refresh -s project,repo     # once; the project scope is needed for gh project
node scripts/github/seed.mjs --dry-run
node scripts/github/seed.mjs
```

It is idempotent: labels, milestones, issues, fields, items and field values are looked up by name or title and created only if missing, so it can be re-run after adding a WP to `decisions.json`. Issues go through the REST API (`gh api`) because it returns the numeric ids that the sub-issue and dependency endpoints need and because search indexing lags behind creation. A full first run makes about 400 `gh` calls and takes a few minutes.

## What the script cannot do: the Project UI steps

Views and built-in workflows have no API. Do these once, in the Project (`https://github.com/users/JoseAlbDR/projects/<n>`, linked from the repo's Projects tab).

Views (the `+ New view` tab at the top of the Project; the three dots on a tab rename it, set its layout and its grouping):

| View | Layout | Settings |
|---|---|---|
| Board | Board | Column field: Status. Shows the five Status columns. |
| Roadmap | Roadmap | Group by: Release. Date fields: Start date and Target date. Zoom: month. |
| Table | Table | Group by: Tag. Sort: WP id. Show fields WP id, Status, Size, Release, Learning gate. |
| Learning | Table | Filter `label:tag:learning -status:Done`. Group by: Release. Show Learning gate. |

Workflows (Project menu, the three dots top right, `Workflows`; each one has a toggle and an edit button):

| Workflow | Set to |
|---|---|
| Item added to project | Status: Backlog |
| Item reopened | Status: Backlog |
| Pull request merged | Status: Done |
| Item closed | Status: Done |
| Auto-add to project | Filter `is:issue is:open label:type:wp,type:task,type:bug,type:chore`; so new issues land in the Project without a manual add |
| Code changes requested | Leave off |
| Code review approved | Leave off |
| Auto-archive items | Optional: `is:issue is:closed updated:<@today-30d` |

"Pull request opened" moves an issue to In review only when the PR body says `Closes #<issue>`; GitHub links the two through that line, so the `wp` skill and the PR template always include it.

If the Status rename in the script fails (it uses a GraphQL mutation that `gh` has no subcommand for), rename the options by hand: Project settings, field Status, options Backlog, Ready, In progress, In review, Done. The script sets WP id, Tag, Size and Release per item; Area and Learning gate are set during the WP by whoever works it.

## Rules that make the board work

The branch is `wp/NN-slug`; the PR title is a conventional commit scoped to the service; the PR body says `Closes #<issue>`; squash merge. When a learning WP starts, its explainer's step list becomes sub-issues of that WP (`type:task`). Status moves: Ready when the acceptance criteria are written and the ADRs are decided; In progress when the branch exists; In review when the PR is open; Done on merge.
