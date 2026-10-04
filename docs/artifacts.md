# Published artifacts

Every claude.ai artifact published for jadero.dev, the repo file it is built from, and who republishes it. The repo file is the source; the artifact is a copy. A session that changes a source republishes its artifact (with the Artifact tool, `url` set to the link below). A session that cannot publish edits the source, and the next session that can publishes it.

Artifacts are private to the owner unless the table says otherwise. Artifacts unrelated to jadero.dev are not listed here.

| Title | URL | Source in the repo | Republished by, and when | Last version checked (2026-10-04) |
| --- | --- | --- | --- | --- |
| jadero.dev Code Map | https://claude.ai/artifact/AxDWmeC3LMZ79huAp6wwkr | `docs/architecture/code-map.html` | The session running a WP, as its last step, whenever the WP changes an app, package, module, provider, request path or event (`/map`) | Version 11 (id 1791133405-1e15), published from `chore/code-map-explorer` (#94: focus, layers, event explorer) |
| jadero.dev Local Playbook | https://claude.ai/artifact/ArdjUbSuV9avUbWqgxjUcW | `docs/process/local-guide.html` (mirrors `docs/local-playbook.md`) | Any session that changes `docs/process/local-guide.html` or `docs/local-playbook.md` | Version 15 (id 1791144717-6b98), published from `chore/consistency-pass` (journal draft at `/wrap-wp`, four blocker rows) |
| jadero.dev Delivery Flow | https://claude.ai/artifact/JNgPoM5AAndhX7GSn6i8HB | `docs/process/delivery-flow.html` (mirrors `docs/agent-tooling.md`) | Any session that changes `docs/process/delivery-flow.html` or `docs/agent-tooling.md` | Version 11 (id 1791144718-069f), published from `chore/consistency-pass` (journal drafted at `/wrap-wp` before the merge) |
| jadero.dev Design Directions | https://claude.ai/artifact/ErzLXenCce16K8PfGXTg75 | `docs/artifacts/design-directions/` (`index.html` and `shots/`, the screenshots of the mockups under `apps/web/src/app/[locale]/mockups/`; archived per ADR-046). Shared with anyone with the link, linked from PR #84 | The frontend session that adds or changes a mockup, with fresh screenshots in the folder first; after WP-16 deletes the mockups, nobody: the page is a record | Version id 1791126672-7c47 (option 5, bento glass with agent terminal, marked chosen per ADR-045), matches the folder |
| jadero.dev v2 Plan | https://claude.ai/artifact/HJZzB1Bkafy3t22kcUnHVA | `docs/artifacts/v2-plan/` (`index.html`, `data.json` generated from `docs/plan/decisions.json`, `owner-marks.json` exported from the artifact database; archived per ADR-046, see its README) | A session that changes `docs/plan/decisions.json` and wants the review page current; only on the owner's request, since the page holds the owner's marks | Version id 1790988459-6bab, matches the folder; stale against `docs/plan/decisions.json`: its `data.json` predates D-23's change to the bento direction (#88, #90) |

## Republishing the archived pages

The two pages under `docs/artifacts/` are copies of what the artifact serves, including the document skeleton the service adds at publish time, so they can be published as they are.

- **Design Directions:** publish `docs/artifacts/design-directions/index.html` with the Artifact tool, `url` set to its link, and `files` mapping each `shots/<name>.png` to the file in the folder. A new or changed screenshot goes into `shots/` first, in the same PR.
- **v2 Plan:** only when the owner asks. Copy `docs/plan/decisions.json` to `docs/artifacts/v2-plan/data.json`, then publish `docs/artifacts/v2-plan/index.html` with `url` set to its link and `files` mapping `data.json`. Leave `capabilities` out so the page keeps `db` and `user`, and never write to its `marks` collection. After the owner marks more decisions, export the collection again (ArtifactData `list` on `marks`) into both `docs/artifacts/v2-plan/owner-marks.json` and `docs/plan/owner-marks.json` (`docs/artifacts/v2-plan/README.md`).
