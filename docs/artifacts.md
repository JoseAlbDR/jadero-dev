# Published artifacts

Every claude.ai artifact published for jadero.dev, the repo file it is built from, and who republishes it. The repo file is the source; the artifact is a copy. A session that changes a source republishes its artifact (with the Artifact tool, `url` set to the link below). A session that cannot publish edits the source, and the next session that can publishes it.

Artifacts are private to the owner unless the table says otherwise. Artifacts unrelated to jadero.dev are not listed here.

| Title | URL | Source in the repo | Republished by, and when | Last version checked (2026-10-04) |
| --- | --- | --- | --- | --- |
| jadero.dev Code Map | https://claude.ai/artifact/AxDWmeC3LMZ79huAp6wwkr | `docs/architecture/code-map.html` | The session running a WP, as its last step, whenever the WP changes an app, package, module, provider, request path or event (`/wp`) | Version 10, published from `wp/5-messaging-foundation` (WP-5's section 8 is not on `main` yet) |
| jadero.dev Local Playbook | https://claude.ai/artifact/ArdjUbSuV9avUbWqgxjUcW | `docs/process/local-guide.html` (mirrors `docs/local-playbook.md`) | Any session that changes `docs/process/local-guide.html` or `docs/local-playbook.md` | Version 14, matches `main` |
| jadero.dev Delivery Flow | https://claude.ai/artifact/JNgPoM5AAndhX7GSn6i8HB | `docs/process/delivery-flow.html` (mirrors `docs/agent-tooling.md`) | Any session that changes `docs/process/delivery-flow.html` or `docs/agent-tooling.md` | Version 10, matches `main` |
| jadero.dev Design Directions | https://claude.ai/artifact/ErzLXenCce16K8PfGXTg75 | none: lives only as an artifact (gallery page and screenshots of the mockups under `apps/web/src/app/[locale]/mockups/`; ADR-044 keeps the screenshots out of the repo). Shared with anyone with the link, linked from PR #84 | The frontend session that adds or changes a mockup, with fresh screenshots | Version id 1791126672-7c47 (option 5, bento glass with agent terminal, marked chosen per ADR-045) |
| jadero.dev v2 Plan | https://claude.ai/artifact/HJZzB1Bkafy3t22kcUnHVA | `data.json` is `docs/plan/decisions.json`; the page itself is none: lives only as an artifact. The owner's marks live in the artifact's database (exported to `docs/plan/owner-marks.json`) | A session that changes `docs/plan/decisions.json` and wants the review page current; only on the owner's request, since the page holds the owner's marks | Version id 1790988459-6bab, stale: its `data.json` predates D-23's change to the bento direction (#88, #90) |
