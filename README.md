# jadero.dev

Personal site v2: a multilingual portfolio (es, en, de) with an ask-me AI agent. Backend in NestJS (modular monolith plus services over RabbitMQ), frontend in Next.js, agent in LangGraph.js, hosted on the owner's Hetzner server.

Work in progress. Where things live:

- `docs/adr/`: the architecture decision records (ADR-001 to ADR-042), with an index in `docs/adr/README.md`. Start there.
- `docs/plan/`: the build plan (`report.md`), the decisions as data (`decisions.json`), the owner review and its follow-ups, and the task for the next step (`TASK.md`).
- Releases R0 to R7 and the work packages are in `docs/plan/report.md`, section 14; tracking is GitHub Issues, a Project and milestones (ADR-041).

## Development

Prerequisites: Node 24 (the version in `.nvmrc`, for example `nvm use`), pnpm 11 (`corepack enable` picks the version pinned in `package.json`, or use the pnpm installer), and Docker with Compose.

```sh
pnpm install   # also installs the git hooks (lefthook)
pnpm dev:up    # Postgres 18 and RabbitMQ 4 on 127.0.0.1, see infra/compose/README.md
pnpm verify    # lint, architecture check, typecheck and tests: run before every commit
```

`AGENTS.md` lists every command.
