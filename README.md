# jadero.dev

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/JoseAlbDR/jadero-dev/badge)](https://scorecard.dev/viewer/?uri=github.com/JoseAlbDR/jadero-dev)

Personal site v2: a multilingual portfolio (es, en, de) with an ask-me AI agent. Backend in NestJS
(a modular monolith plus services over RabbitMQ), frontend in Next.js, agent in LangGraph.js, hosted
on the owner's Hetzner server. It is also a showcase of backend architecture, messaging, testing,
CI/CD, infrastructure and security, built in small, documented work packages.

**Status:** release R0 (walking skeleton) in progress. The repo foundation, the service platform,
the web skeleton, the messaging foundation, the data layer, the content domain, the site pages, the
CI pipeline and the service images with per-service releases are in place. The detailed status line
is in [`AGENTS.md`](AGENTS.md) (section 1), the plan of releases R0 to R7 in
[`docs/plan/report.md`](docs/plan/report.md) (section 14).

## Contents

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Services, ports and process types](#services-ports-and-process-types)
- [Running one service alone](#running-one-service-alone)
- [Production images on a laptop](#production-images-on-a-laptop)
- [Environment variables](#environment-variables)
- [Scripts reference](#scripts-reference)
- [Testing](#testing)
- [CI, releases and images](#ci-releases-and-images)
- [Troubleshooting](#troubleshooting)
- [How work is done](#how-work-is-done)
- [Contributing conventions](#contributing-conventions)
- [Security and license](#security-and-license)

## Tech stack

| Area | Choice |
|---|---|
| Language and runtime | TypeScript on Node.js 24 |
| Monorepo | pnpm 11 workspaces, Turborepo, Biome (lint and format), dependency-cruiser (architecture rules), lefthook (git hooks), commitlint |
| Services | NestJS, Zod for every boundary, RFC 9457 problem details, Pino logs, OpenTelemetry traces |
| Data | Postgres 18 with pgvector, one database and role per service, Drizzle ORM with generated SQL migrations |
| Messaging | RabbitMQ 4, transactional outbox and inbox, CloudEvents envelopes, AsyncAPI catalog |
| Web | Next.js 16, next-intl, Tailwind and shadcn/ui, a nonce-based Content-Security-Policy |
| Tests | Vitest (unit, coverage gates), Testcontainers (integration), Playwright with axe (web smoke and accessibility) |
| Delivery | GitHub Actions, release-please, Docker images on GHCR with build provenance attestations, Trivy, Renovate |

The reasons behind each choice are the ADRs in [`docs/adr/`](docs/adr/README.md).

## Repository layout

| Path | What it holds |
|---|---|
| `apps/api` | NestJS service: content (later auth, media, cv); second process type `api-worker` |
| `apps/agent` | NestJS service: the ask-me agent (knowledge, chat, guards, usage); second process type, the consumer |
| `apps/web` | Next.js public site |
| `packages/contracts` | Zod DTOs and versioned event schemas |
| `packages/messaging` | Bus port, RabbitMQ and in-memory adapters, outbox, inbox, broker topology |
| `packages/platform-nest` | Service bootstrap only: config, logging, errors, health, telemetry, database |
| `packages/testing` | Integration test helpers (Postgres, per-file test databases) |
| `packages/ui` | Design tokens and shadcn base components |
| `packages/config` | Shared TypeScript and Vitest config |
| `templates/nest-module` | The layered and hexagonal module shapes to copy from |
| `infra/` | Docker Compose files, Postgres init, RabbitMQ config and definitions |
| `scripts/` | Repo scripts (ADR tooling, migration checks, release inputs) and their tests |
| `docs/` | ADRs, plan, learning explainers, journal, process pages, architecture map |

The target layout adds `apps/admin`, `apps/contact`, `apps/mcp`, `packages/ai` and `packages/agent`
in later releases. The interactive map of the code (modules, injections, boot and request paths,
events) is [`docs/architecture/code-map.html`](docs/architecture/code-map.html).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.x, at least 24.12 (`.nvmrc` pins 24.21.0) | `nvm use` or `fnm use` reads `.nvmrc`; `engines` refuses other majors |
| pnpm | 11.x (`packageManager` pins 11.28.2) | `corepack enable` picks the pinned version |
| Docker | Docker Desktop or Engine with Compose v2 | Postgres and RabbitMQ for development, integration tests, images |
| Google Chrome | current stable | only for `pnpm test:e2e` (Playwright uses the installed Chrome) |
| GitHub CLI (`gh`) | current | optional: issues, PRs and image attestation checks |

## Quick start

From a clean clone:

```sh
nvm use                  # Node from .nvmrc
corepack enable          # pnpm from package.json
pnpm install             # also installs the git hooks (lefthook)

# One .env per app, from its example (fixed dev values, no secrets)
cp apps/api/.env.example apps/api/.env
cp apps/agent/.env.example apps/agent/.env
cp apps/web/.env.example apps/web/.env

pnpm dev:up              # Postgres 18 and RabbitMQ 4 on 127.0.0.1, waits for both healthchecks
pnpm build               # compile every package (dist/); the migrate and seed commands run from dist/
pnpm db:migrate          # apply each service's pending migrations
pnpm --filter @jadero/api db:seed   # placeholder content, idempotent
pnpm dev                 # every app and process type in watch mode
```

Then check it:

```sh
curl http://localhost:3001/health/ready          # api: {"status":"ok",...}
curl http://localhost:3002/health/ready          # agent
curl http://localhost:3001/v1/content/en/profile # the public content API
open http://localhost:3000                       # the site
```

`pnpm dev:down` stops the containers and keeps the data. More on the dev containers (databases,
roles, the RabbitMQ management UI on http://localhost:15672, resetting the data):
[`infra/compose/README.md`](infra/compose/README.md).

## Services, ports and process types

Every service is one image with several process types, picked by the command (ADR-049).

| Process | What it does | Port | Health |
|---|---|---|---|
| `web` | Next.js site; reads the content API per request | 3000 | `/robots.txt` (no health route) |
| `api` | HTTP: public content API under `/v1/content` | 3001 | `/health/live`, `/health/ready` |
| `api-worker` | Outbox relay and heartbeat publisher, no public routes | 3011 | `/health/live`, `/health/ready` |
| `agent` | HTTP service of the agent (health only today; chat arrives in later work packages) | 3002 | `/health/live`, `/health/ready` |
| `agent-consumer` | Consumes the agent's queues through the inbox | 3012 | `/health/live`, `/health/ready` |
| `api-migrate`, `agent-migrate` | One-off: apply the service's migrations, then exit | none | exit code |
| Postgres | `content_dev`, `agent_dev`, `contact_dev`, each owned by the role of the same name, plus the read-only `content_reader_dev` | 5432 (`POSTGRES_PORT`) | `pnpm dev:up` waits for it |
| RabbitMQ | AMQP, vhost `dev`; management UI | 5672, 15672 (`RABBITMQ_PORT`, `RABBITMQ_MANAGEMENT_PORT`) | `pnpm dev:up` waits for it |

Every container port binds to `127.0.0.1`, and the Node processes of `pnpm dev` listen on loopback
only: `api` and `agent` bind `LISTEN_HOST` (default `127.0.0.1`; the images set `0.0.0.0` so the Compose
network reaches them). Not `HOST`: some shells export it (tcsh; zsh sets it) and an exported value
wins over `.env`, so a dev server could bind a LAN name. `web` runs `next dev -H localhost`. Not `-H 127.0.0.1`: Next builds the
proxy's request URL on `localhost`, so with another host name it takes next-intl's rewrite of a
localized pathname for an external one and loops on a 307 (`/es/experiencia`). Node binds
`localhost` to `::1` on macOS, so open `http://localhost:3000`, not `127.0.0.1:3000`. `pnpm dev` starts the second process types through each app's
`dev:worker` script, which sets the port and `SERVICE_NAME` (3011 for `api-worker`, 3012 for the
agent consumer).

## Running one service alone

`pnpm dev` runs everything. To run one app with its dependencies built and watched, use Turborepo's
filter:

```sh
pnpm exec turbo run dev --filter=@jadero/api              # api only
pnpm exec turbo run dev dev:worker --filter=@jadero/api   # api and api-worker
pnpm exec turbo run dev dev:worker --filter=@jadero/agent # agent and its consumer
pnpm --filter @jadero/web dev                             # web only (next dev on port 3000)
```

Without watch mode, after `pnpm build`, each process type has a start script that reads the app's
`.env` (a variable set in the shell wins over the file):

```sh
pnpm --filter @jadero/api start
PORT=3011 pnpm --filter @jadero/api start:worker
pnpm --filter @jadero/agent start
PORT=3012 pnpm --filter @jadero/agent start:consumer
pnpm --filter @jadero/web start      # the standalone server of a `pnpm build`
```

Database commands per service: `pnpm --filter @jadero/api db:migrate`,
`pnpm --filter @jadero/agent db:generate`, and so on (see [Scripts reference](#scripts-reference)).

## Production images on a laptop

`pnpm images:up` builds the `api`, `agent` and `web` images and runs every process type from them
on top of the dev Postgres and RabbitMQ, each after its migrate one-off exits 0, and waits for every
healthcheck. `pnpm images:down` removes the containers. Stop `pnpm dev` first: the ports are the
same. The containers run hardened: read-only filesystem, no Linux capabilities, no new privileges,
a small memory-backed `/tmp`, a memory limit, non-root user. The values live in
[`infra/compose/compose.images.yml`](infra/compose/compose.images.yml).

## Environment variables

Each app validates its environment with Zod at boot and refuses to start on a missing or malformed
variable, naming the variable but never its value. The examples hold fixed dev values only, never
real secrets; AI and mail providers are always `fake` in development and tests.

| File | Copy to | Read by |
|---|---|---|
| [`apps/api/.env.example`](apps/api/.env.example) | `apps/api/.env` | `api`, `api-worker`, `db:migrate`, `db:seed` |
| [`apps/agent/.env.example`](apps/agent/.env.example) | `apps/agent/.env` | `agent`, the consumer, `db:migrate` |
| [`apps/web/.env.example`](apps/web/.env.example) | `apps/web/.env` | `web`, the e2e suite (`CSP_MODE`) |
| [`.env.example`](.env.example) | (reference) | the connection strings of every service, for tools and a quick look |

Each variable is explained by a comment in its example file. `.env` files are gitignored.

## Scripts reference

Root scripts (`pnpm <script>`):

| Script | What it does |
|---|---|
| `verify` | Lint, architecture check, typecheck, unit tests and script tests on affected packages, then the migration check. Run before every commit; the `pre-push` hook runs it |
| `verify:all` | The same on every package (for `main` and CI) |
| `lint:check` | Biome check, never writes |
| `lint:fix` | Biome format and safe fixes |
| `depcruise` | dependency-cruiser architecture rules over `apps`, `packages`, `templates` |
| `typecheck` | TypeScript in every package |
| `test` | Unit tests in every package, plus the script tests |
| `test:scripts` | The tests of `scripts/` (Node test runner) |
| `test:int` | Integration tests (`*.int.test.ts`) against real containers; needs Docker |
| `test:e2e` | Builds `web` and runs its Playwright smoke and axe checks per locale; needs Chrome |
| `check:migrations` | Fails when a branch edits a migration `main` already has, or adds one the migrator would skip |
| `release-inputs` | Regenerates each service's `release-inputs.txt` (its production dependency closure) |
| `lint:workflows` | zizmor over `.github/workflows/`, in Docker |
| `scan:secrets` | gitleaks over the git history, in Docker |
| `build` | Compiles every package (`dist/`, and the web standalone build) |
| `db:generate` | Writes a new SQL migration per service from its schema files (review it; never edit an applied one) |
| `db:migrate` | Applies the pending migrations per service (build first) |
| `dev` | Every app and second process type in watch mode |
| `dev:up` / `dev:down` | Start or stop Postgres and RabbitMQ in Docker |
| `dev:provision` | Runs `infra/postgres/provision.sql` again on the running dev Postgres (convergent: no data reset) |
| `images:build` | Builds the service images |
| `images:up` / `images:down` | Runs or removes every process type from the images, hardened |
| `adr:new` | `pnpm adr:new "Title"`: the next ADR from the template |
| `adr:index` | Regenerates the ADR index (`--check` fails when it is stale) |
| `prepare` | Installs the git hooks (runs on `pnpm install`) |

Per package:

| Command | What it does |
|---|---|
| `pnpm --filter @jadero/api db:seed` | Loads placeholder content through the content use cases; idempotent |
| `pnpm --filter @jadero/messaging topology` | Regenerates `infra/rabbitmq/definitions.json` and the servers' `infra/rabbitmq/server/` files from the topology code |
| `pnpm --filter @jadero/contracts asyncapi` | Regenerates the event catalog |
| `pnpm --filter @jadero/contracts compat:accept` | Freezes a new event version's schema |

Every command, with the rules around it, is also in [`AGENTS.md`](AGENTS.md) section 3.

## Testing

- **Unit:** `pnpm test` (or `pnpm verify` for the affected ones). Fakes and contract suites first.
  Coverage gates follow ADR-009 (domain and application layers 90% lines, 85% branches; API overall
  80%) and fail the run below them. `VITEST_MAX_WORKERS` caps the workers on a busy machine.
- **Integration:** `pnpm test:int` runs `*.int.test.ts` against real Postgres and RabbitMQ through
  Testcontainers. Needs Docker; not part of `pnpm verify`.
- **End to end:** `pnpm test:e2e` builds `web` and runs Playwright against the standalone server and
  a stub of the content API, under the enforced CSP. Needs Google Chrome; not part of `pnpm verify`.
  Details in [`apps/web/AGENTS.md`](apps/web/AGENTS.md).

## CI, releases and images

**CI.** GitHub Actions gates every pull request on the required checks `verify`, `integration`,
`web`, `workflows-lint`, `pr-title`, `osv-scanner / osv-scan`, `dependency-review`, `secrets` and
`images` (builds, smoke-runs and scans the affected service images with Trivy). A weekly run repeats the
checks without the cache. Renovate opens grouped dependency updates three days after release.

**Releases.** release-please reads the conventional commits on `main` and keeps one Release PR open
that bumps the version and changelog of each changed service. Merging it tags each released
component (`<component>-v<version>`) and creates its GitHub release.

**Images.** After a Release PR merges, `release.yml` builds each released service's image from its
tag, smoke-tests it hardened, scans it with Trivy, pushes it to GHCR as a private package
(`:<version>` and `:sha-<short>`) with an SBOM, and attests its build provenance. Verify an image:

```sh
gh attestation verify oci://ghcr.io/josealbdr/jadero-dev-<service>:<version> --owner JoseAlbDR
```

After merging a Release PR, wait for the `release` run on `main`, then check the releases, the
packages and the attestation: the steps are in the "After merging a Release PR" list of the workflows README.

A weekly scan of the released images opens an issue on a fixable CRITICAL finding. What each job
runs, the security model and what to do when one goes red:
[`.github/workflows/README.md`](.github/workflows/README.md).

## Troubleshooting

- **A port is already in use** (`pnpm dev:up` fails on 5432 or 5672, or an app on 3000 to 3012).
  Another local Postgres, RabbitMQ or a running `pnpm images:up` holds it. Stop that process or
  container (`pnpm images:down` for the images), or move the host port of the dev containers with
  `POSTGRES_PORT`, `RABBITMQ_PORT` or `RABBITMQ_MANAGEMENT_PORT` in the shell (for example
  `POSTGRES_PORT=55432 pnpm dev:up`, and the same variable for `dev:down`, `images:up` and
  `images:down`; or put them in a gitignored `infra/compose/.env`, since Compose does not read the
  root `.env`). Then use the same port in your `.env` files: `DATABASE_URL` and
  `DATABASE_READ_URL` in `apps/api/.env`, `DATABASE_URL` in `apps/agent/.env` (`RABBITMQ_URL` in
  both for 5672). More in [`infra/compose/README.md`](infra/compose/README.md).
- **`pnpm lint` does something unexpected.** pnpm 11 runs a built-in command by that name instead
  of a script. Use `pnpm lint:check` and `pnpm lint:fix`.
- **The editor says a workspace package "has no exported member".** Editors read the compiled
  `.d.ts` of workspace packages. Run `pnpm build` after a pull.
- **An app refuses to start with "Invalid configuration".** The listed variable is missing or
  malformed in that app's `.env`; compare it with the app's `.env.example`.
- **`db:migrate` cannot find `dist/migrate.js`.** Run `pnpm build` first.
- **Database roles or databases are missing after changing `infra/postgres/provision.sql`.** The
  container runs it by itself only on an empty volume; run it again on the existing one with
  `pnpm dev:provision` (convergent, keeps the data). A role renamed in the script leaves the old
  role behind; to start clean: `docker compose -f infra/compose/compose.dev.yml down -v`, then
  `pnpm dev:up` (this deletes local data).

## How work is done

Every change starts from a GitHub issue. The plan's work packages are sub-issues of the epic
`jadero.dev v2`, grouped in milestones R0 to R7 and tracked on the Project board (ADR-041).

1. A work package moves to Ready when its dependencies are closed and its decisions are made.
2. A branch `wp/<number>-<slug>` is cut from `main` (work outside a work package uses `chore/`,
   `fix/` or `docs/`).
3. Learning work packages open with an explainer in `docs/learning/wp-<number>.md`. The owner
   decides before code is written under the learning paths; a hook enforces it.
4. Small steps, each with a green `pnpm verify` and one conventional commit.
5. A pull request with `Closes #<issue>`; CI and the reviewer agent check it; the owner explains the
   design back and records gaps in the explainer's Recap.
6. Squash merge. The pull request title becomes the commit on `main` and the changelog line.

Where to read more:

- [`AGENTS.md`](AGENTS.md): the rules, commands and status, for people and coding agents.
- [`docs/adr/`](docs/adr/README.md): the architecture decision records, with an index. Start there.
- [`docs/plan/`](docs/plan/): the build plan (`report.md`) and the owner decisions as data.
- [`docs/learning/`](docs/learning/): one explainer per learning work package.
- [`docs/sessions.md`](docs/sessions.md): how a Claude Code session runs a work package.
- [`docs/local-playbook.md`](docs/local-playbook.md) and
  [`docs/agent-tooling.md`](docs/agent-tooling.md): the delivery flow and tooling in detail.

## Contributing conventions

- Conventional one-line commits scoped to the service: `feat(agent): add hybrid retrieval`. The
  `commit-msg` hook checks them.
- Branches: `wp/NN-slug` for a work package, `chore/`, `fix/` or `docs/` for anything else.
  Versions come from the commit type, never from the branch name.
- The PR title is the squash commit and the changelog line; the `pr-title` check enforces it.
- `pnpm verify` green before every commit and push.
- A change that adds or renames a root script, a service, a port or an environment variable
  updates this README and the matching `.env.example` in the same PR.

## Security and license

Report vulnerabilities as described in [`SECURITY.md`](SECURITY.md). The OpenSSF Scorecard badge
above scores the repo's supply-chain practices; its Code-Review check stays low on purpose, because
one person writes and merges every change.

Licensed under the [MIT License](LICENSE).
