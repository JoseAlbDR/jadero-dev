# jadero.dev

Personal site v2: a multilingual portfolio (es, en, de) with an ask-me AI agent. Backend in NestJS (modular monolith plus services over RabbitMQ), frontend in Next.js, agent in LangGraph.js, hosted on the owner's Hetzner server.

Work in progress. Where things live:

- `docs/adr/`: the architecture decision records (ADR-001 to ADR-046), with an index in `docs/adr/README.md`. Start there.
- `docs/plan/`: the build plan (`report.md`), the decisions as data (`decisions.json`), the owner review and its follow-ups, and the planner's original task (`TASK.md`, historical).
- Releases R0 to R7 and the work packages are in `docs/plan/report.md`, section 14; tracking is GitHub Issues, a Project and milestones (ADR-041).

## Development

Prerequisites: Node 24 (the version in `.nvmrc`, for example `nvm use`), pnpm 11 (`corepack enable` picks the version pinned in `package.json`, or use the pnpm installer), and Docker with Compose.

```sh
pnpm install   # also installs the git hooks (lefthook)
pnpm dev:up    # Postgres 18 and RabbitMQ 4 on 127.0.0.1, see infra/compose/README.md
pnpm verify    # lint, architecture check, typecheck and tests on changed packages: run before every commit
pnpm verify:all  # the same on every package, for main and CI
pnpm build     # compile every package (dist/)
pnpm dev       # apps in watch mode (copy apps/<app>/.env.example to .env first)
pnpm test:int  # integration tests against real containers (needs Docker)
pnpm test:e2e  # web smoke and accessibility tests in Chrome against the built site
```

`AGENTS.md` lists every command. The first `pnpm dev:up` on a machine also proves the database-per-service setup: see `infra/compose/README.md`.

## How work is done

Every change starts from a GitHub issue. The plan's work packages (WP-0 to WP-56) are sub-issues of the epic `jadero.dev v2`, grouped in milestones R0 to R7 and tracked on the Project board (ADR-041).

1. A work package moves to Ready on the board when its dependencies are closed and its decisions are made.
2. A branch `wp/<number>-<slug>` is cut from `main` (work outside a work package uses `chore/`, `fix/` or `docs/`).
3. Learning work packages open with an explainer in `docs/learning/wp-<number>.md`. The owner decides before code is written under the learning paths; a hook enforces it.
4. Small steps, each with a green `pnpm verify` and one conventional commit (`feat(api): ...`).
5. A pull request with `Closes #<issue>`; CI and the reviewer agent check it; the owner explains the design back and records gaps in the explainer's Recap.
6. Squash merge. The pull request title becomes the commit on `main` and the changelog line; release-please reads its type (`feat`, `fix`) to version each service. Branch names play no part in versioning.

Hands-on guide for a local machine: `docs/local-playbook.md`. Tooling and the flow in detail: `docs/agent-tooling.md`.

## Status

Release R0 (walking skeleton) in progress. Done: the plan, the ADRs, GitHub tracking, the agent tooling, the repo foundation (WP-1), the service platform with the API skeleton (WP-3), the web skeleton (WP-4), the design directions (WP-15) and the messaging foundation with the agent skeleton (WP-5). Next: the data layer (WP-10), then CI (WP-6). The map of the code is `docs/architecture/code-map.html`.
