---
wp: 1
decision: recorded
adr: [ADR-001, ADR-024, ADR-009, ADR-025, ADR-042, ADR-027, ADR-028]
---

# WP-1: Repo foundation

Issue #9, branch `wp/1-repo-foundation`, release R0, size M, tag learning. Depends on WP-0 (issue #8, closed).

Deliverable (report section 14): Turborepo + pnpm, `packages/config`, Biome, dependency-cruiser skeleton, commitlint + lefthook, `compose.dev.yml` with Postgres and RabbitMQ, `pnpm verify`, AGENTS.md + CLAUDE.md, ADR files + index.

Already on `main` before this WP started: `AGENTS.md` and `CLAUDE.md` (PR #5), the 41 ADR files and a hand-written index in `docs/adr/README.md`. What is left of those two items is the tooling: the `pnpm adr:new` and `pnpm adr:index` scripts, and the switch of `docs/adr/README.md` from "maintained by hand" to "generated".

What the owner learns: task graphs and caching, compiled vs just-in-time internal packages, ESM `exports` maps.

Facts checked on 2026-10-03 against the npm registry, Docker Hub and nodejs.org (turborepo.dev and pnpm.io were not reachable from this environment, so a few behaviors below are marked **verify**):

| Tool | Latest on 2026-10-03 | Note |
|---|---|---|
| `turbo` | 2.11.7 (2.11 released 2026-09-18) | |
| `pnpm` | 12.8.1 (`latest`); 11.28.2 (`latest-11`); 10.34.6 (`latest-10`) | 12.0.0 published 2026-08-26, 11.0.0 on 2026-04-28 |
| `@biomejs/biome` | 2.5.15 | |
| `dependency-cruiser` | 18.5.0 | |
| `lefthook` | 2.1.16 | |
| `@commitlint/cli`, `@commitlint/config-conventional` | 21.2.3 | |
| `typescript` | 7.0.2 (`latest`, GA 2026-07-08); 6.0.3 newest 6.x | `@nestjs/cli` 12.0.8 depends on `typescript ~6.0.2` |
| Node.js LTS lines | 24.21.0 "Krypton" (active LTS); 22.23.3 "Jod" (maintenance) | ADR-004 says Node 22 |
| `pgvector/pgvector` | `0.8.7-pg17`, `0.8.7-pg18` | ADR-027: pick 17 or 18 at WP time |
| `rabbitmq` | `4.3.6-management-alpine` | ADR-027 and ADR-029: RabbitMQ 4 |

## First principles

**Workspace (pnpm).** A workspace is one repository that holds several npm packages, each with its own `package.json`. A file at the root, `pnpm-workspace.yaml`, lists the folders that hold packages (`apps/*`, `packages/*`). When `apps/api/package.json` declares `"@jadero/contracts": "workspace:*"`, pnpm does not download anything: it creates a symlink `apps/api/node_modules/@jadero/contracts -> ../../../packages/contracts`. pnpm is strict: a package can import only what its own `package.json` declares, so a missing dependency fails at once instead of working by accident because a sibling installed it (the "phantom dependency" problem npm and Yarn v1 have). Every downloaded file is stored once in a content-addressed store on disk and hard-linked into each project.

**Catalogs (pnpm).** A catalog is a named list of versions in `pnpm-workspace.yaml` (`catalog: { typescript: 6.0.3 }`). A package writes `"typescript": "catalog:"` instead of a version. One edit in one file moves every package to the new version. This is the single-version policy without a custom script.

**Task graph (Turborepo).** Each package has scripts (`build`, `typecheck`, `test`). Turborepo reads `turbo.json`, which says how tasks relate. `"dependsOn": ["^build"]` means "before this task runs in package X, run `build` in every package X depends on" (the caret means "in my dependencies"). Without the caret, `"dependsOn": ["build"]` means "run my own `build` first". From the package dependency graph (who lists whom in `package.json`) and these rules, Turborepo builds a directed acyclic graph of (package, task) pairs and runs it in topological order, in parallel where two nodes do not depend on each other. Example: `api#typecheck` waits for `contracts#build`, while `contracts#test` and `config#lint` run at the same time.

**Caching (Turborepo).** Before running a task, Turborepo computes a hash from its inputs: the package's tracked files (or the `inputs` you list), the resolved versions of its dependencies from the lockfile, the hashes of the tasks it depends on, the task's definition in `turbo.json`, and the values of environment variables you declare in `env`. If a result for that hash exists in `.turbo/cache`, Turborepo restores the declared `outputs` (for example `dist/**`) and replays the logs instead of running the task. This is memoization of a pure function, where "pure" is your promise that the declared inputs are all that matters. Two ways to break that promise: an undeclared output (the cache restores nothing, the next task fails) and an undeclared input (a stale result is served). Turborepo 2 runs tasks in strict environment mode by default: a task sees only the variables listed in `env`, `globalEnv` or `passThroughEnv` **(verify the default in 2.11)**. A variable that changes results goes in `env` (it changes the hash); one that changes only speed, such as `VITEST_MAX_WORKERS`, goes in `passThroughEnv` (visible, not hashed). A remote cache shares the same results between machines and CI; ADR-001 leaves it for later.

**Affected runs.** `turbo run test --affected` asks git which files changed between a base and `HEAD` (locally `main...HEAD`; in GitHub Actions the pull request's base ref, overridable with `TURBO_SCM_BASE`), maps the files to packages, adds every package that depends on them, and runs tasks only there. Caching and affected runs stack: affected decides which packages are candidates, the cache skips the ones whose inputs did not really change.

**Internal packages: just-in-time vs compiled.** An internal package is a workspace package that is never published. The question is who turns its TypeScript into JavaScript.
- *Just-in-time (JIT):* the package's `exports` point at `.ts` source. The consumer's tool transpiles it: Next.js (with `transpilePackages`), Vite and Vitest all do. No `build` task, no `dist/`, edits show up immediately. The cost: every consumer must be able to compile TypeScript, and Turborepo has nothing to cache for that package.
- *Compiled:* the package has a `build` script (for example `tsc`) that writes `dist/*.js` and `dist/*.d.ts`, and `exports` point at `dist/`. Any consumer works, including plain `node`. The cost: a build step, and a consumer sees a change only after that build (Turborepo's `^build` and the cache make this cheap).
- Why ADR-001 says "compiled for anything the API consumes": the Nest services run as plain Node in production. Node 24.12 made type stripping stable, but it refuses `.ts` files whose real path is under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), it handles only "erasable" syntax (no decorators with metadata, no `enum`), and a `pnpm deploy` or `turbo prune` production bundle copies packages into `node_modules`, where stripping stops. So a JIT package would work in dev and fail inside the image.
- A third strategy, *publishable*, adds versioning and a registry. Not needed: no npm packages are published (ADR-025).

**ESM and `exports` maps.** With `"type": "module"` in `package.json`, Node treats `.js` files as ES modules (`import`/`export`). The `exports` field is the package's public front door. It does two things. First, encapsulation: if `exports` lists only `"."`, then `import "@jadero/contracts/src/internal/x"` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`, so a package's internals stay private the same way a module's `index.ts` does inside a service (ADR-003). Second, conditional resolution: each entry can map conditions to files, for example `{ "types": "./dist/index.d.ts", "default": "./dist/index.js" }`. The resolver walks the conditions in object order and takes the first one it recognizes: TypeScript recognizes `types`, Node recognizes `import`, `node` and `default`, and you can add custom ones (Node's `--conditions=name`, TypeScript's `customConditions`, Vite's `resolve.conditions`). Order matters: `types` must come before `default`. With `"moduleResolution": "nodenext"`, relative imports in source must carry the `.js` extension (`import { x } from "./x.js"`) because that is the file Node will load after compilation.

**Biome.** One Rust binary that formats and lints JavaScript, TypeScript, JSON and CSS, configured by `biome.json`. It replaces ESLint plus Prettier with one tool and one config (ADR-024). `biome check --write` formats and applies safe fixes; `biome ci` checks without writing and fails on any difference. Since v2, a package can hold a nested `biome.json` with `"root": false, "extends": "//"` to inherit the root config and override a few rules. The repo's `format.sh` hook already calls Biome as soon as a root `biome.json` exists.

**dependency-cruiser.** It parses every `import` in the code into a graph and checks it against rules in a config file: `forbidden` rules with `from` and `to` path patterns, for example "a file under `src/modules/*/domain/` may not import anything outside `domain/`". A rule like this is an *architecture fitness function*: an automated test of a structural property. In WP-1 there is almost no code, so the deliverable is a skeleton: the rules of ADR-003 and ADR-024 written down and wired into `pnpm verify`, so that the first wrong import in WP-3 fails.

**Conventional commits, commitlint, lefthook.** A conventional commit message has the shape `type(scope): subject`, for example `feat(agent): add hybrid retrieval`. release-please reads these types to decide the next version (`feat` minor, `fix` patch, `!` major; ADR-025). commitlint checks a message against `@commitlint/config-conventional`. Git runs scripts at fixed points (hooks) such as `pre-commit` and `commit-msg`; lefthook is a small binary that installs those hooks from a `lefthook.yml`, so the hook setup is versioned with the repo. The hooks run on the developer's machine; CI checks the PR title as well (WP-6), because a squash merge makes the PR title the commit.

**Development dependencies in containers, code on the host.** `compose.dev.yml` runs only Postgres and RabbitMQ. The Nest and Next apps run on the host with `pnpm dev` in watch mode, which keeps reloads fast and debuggers simple. Postgres runs its init scripts from `/docker-entrypoint-initdb.d/` only when its data volume is empty, so a change to those scripts needs a volume reset.

**`pnpm verify`.** The single "am I done" command from AGENTS.md: lint, typecheck, unit tests, affected only, plus the dependency-cruiser check. It is a root `package.json` script that calls Turborepo and the root tools.

## One concrete trace

Three traces. File contents below are proposals to make the trace concrete; the step that creates each file can change them. Hashes and timings are illustrative; their shape is what Turborepo 2 prints.

### Trace 1: `pnpm verify`, twice, after a change to the shared tsconfig

Proposed files at the end of WP-1:

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
catalog:
  typescript: 6.0.3
  "@biomejs/biome": 2.5.15
  dependency-cruiser: 18.5.0
```

```json
// packages/config/package.json (a no-build package: JSON and plain .js only)
{
  "name": "@jadero/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./tsconfig/node-library.json": "./tsconfig/node-library.json",
    "./vitest": "./vitest/base.js"
  },
  "scripts": { "typecheck": "tsc -p tsconfig.check.json --noEmit", "test": "vitest run" }
}
```

```json
// turbo.json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"],
                   "env": ["AI_*_PROVIDER", "MAIL_PROVIDER"], "passThroughEnv": ["VITEST_MAX_WORKERS"] },
    "//#lint":   { "inputs": ["**/*.{ts,tsx,js,mjs,json,jsonc}", "biome.json"] },
    "//#depcruise": { "inputs": ["apps/**/src/**", "packages/**/src/**", ".dependency-cruiser.cjs"] },
    "dev":       { "cache": false, "persistent": true }
  }
}
```

```json
// root package.json, scripts only
{
  "scripts": {
    "verify": "turbo run lint depcruise typecheck test --affected",
    "dev:up": "docker compose -f infra/compose/compose.dev.yml up -d --wait",
    "dev:down": "docker compose -f infra/compose/compose.dev.yml down",
    "adr:new": "node scripts/adr/new.mjs",
    "adr:index": "node scripts/adr/index.mjs"
  }
}
```

The owner edits one line in `packages/config/tsconfig/base.json` (`"noUncheckedIndexedAccess": true`) on the branch and runs `pnpm verify`.

1. pnpm finds the `verify` script in the root `package.json` and runs `turbo run lint depcruise typecheck test --affected`.
2. Turborepo runs `git diff --name-only main...HEAD` (plus uncommitted files): one changed file, `packages/config/tsconfig/base.json`. It belongs to `@jadero/config`. No package depends on `@jadero/config` yet in WP-1, so the affected set is `{@jadero/config, //}` (`//` is the root).
3. It expands the task graph: `@jadero/config#typecheck`, `@jadero/config#test`, `//#lint`, `//#depcruise`. `^build` adds nothing because `@jadero/config` has no dependencies with a `build` script. Four nodes, no edges between them: all four start at once.
4. For each node it hashes the inputs. `@jadero/config#typecheck` hashes the package's git-tracked files (the changed line changes this hash), the lockfile entries for `typescript@6.0.3`, and its `turbo.json` entry. Result, for example, `9f1c2a7b3e5d4f60`.
5. `.turbo/cache/9f1c2a7b3e5d4f60.tar.zst` does not exist: `cache miss, executing 9f1c2a7b3e5d4f60`. tsc runs. On success Turborepo stores the logs (and the declared outputs; here none) under that hash.
6. Summary: `Tasks: 4 successful, 4 total  Cached: 0 cached, 4 total  Time: 3.8s`.

The owner runs `pnpm verify` again without changing anything. Same files, same hashes; all four entries exist: `cache hit, replaying logs 9f1c2a7b3e5d4f60`, then `Tasks: 4 successful, 4 total  Cached: 4 cached, 4 total  Time: 140ms  >>> FULL TURBO`.

The same command in WP-5, when the graph is larger (shown to make `^build` concrete): `apps/api` and `apps/agent` both depend on `@jadero/contracts` (compiled) and `@jadero/config`. A change in `packages/contracts/src/contact/submitted.v1.ts` makes the affected set `{contracts, api, agent, contact}`. The graph now has edges: `contracts#build` runs first and writes `packages/contracts/dist/`; then `api#typecheck`, `agent#typecheck`, `contact#typecheck` and their `test` tasks run in parallel against that `dist/`. `config` and `web` are not affected and do not run at all.

### Trace 2: a commit message rejected and then accepted

Proposed `lefthook.yml`:

```yaml
pre-commit:
  commands:
    biome:
      glob: "*.{ts,tsx,js,mjs,json,jsonc}"
      run: pnpm exec biome check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true
commit-msg:
  commands:
    commitlint:
      run: pnpm exec commitlint --edit {1}
```

1. `git commit -m "Add tsconfig"`. Git runs `.git/hooks/pre-commit`, which lefthook installed. Biome formats the two staged `.json` files and lefthook re-stages them (`stage_fixed`).
2. Git writes the message to `.git/COMMIT_EDITMSG` and runs `.git/hooks/commit-msg .git/COMMIT_EDITMSG`. lefthook replaces `{1}` with that path and runs commitlint, which prints:

```
⧗   input: Add tsconfig
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
```

   commitlint exits with 1, so git aborts the commit. Nothing is written to history.
3. `git commit -m "feat(config): add shared tsconfig base"` passes both hooks. Later, release-please (WP-6/7) reads `feat` and attributes the commit to the component whose path it touched (`packages/config`), not to the scope text.

### Trace 3: `pnpm dev:up` on a clean machine

Proposed `infra/compose/compose.dev.yml` (abridged) and init script:

```yaml
name: jadero-dev
services:
  postgres:
    image: pgvector/pgvector:0.8.7-pg18
    ports: ["127.0.0.1:5432:5432"]
    environment: { POSTGRES_PASSWORD: postgres }
    volumes:
      - pgdata:/var/lib/postgresql        # verify: the pg18 images moved PGDATA under this folder
      - ./init:/docker-entrypoint-initdb.d:ro
    healthcheck: { test: ["CMD", "pg_isready", "-U", "postgres"], interval: 2s, retries: 30 }
    mem_limit: 1024m
  rabbitmq:
    image: rabbitmq:4.3.6-management-alpine
    ports: ["127.0.0.1:5672:5672", "127.0.0.1:15672:15672"]
    environment: { RABBITMQ_DEFAULT_USER: dev, RABBITMQ_DEFAULT_PASS: dev }
    healthcheck: { test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"], interval: 5s, retries: 24 }
    mem_limit: 256m
volumes: { pgdata: {} }
```

```sql
-- infra/compose/init/01-databases.sql (local development only; fixed dev passwords, bound to 127.0.0.1)
CREATE ROLE content LOGIN PASSWORD 'content';
CREATE DATABASE content_dev OWNER content;
REVOKE CONNECT ON DATABASE content_dev FROM PUBLIC;
CREATE ROLE agent LOGIN PASSWORD 'agent';
CREATE DATABASE agent_dev OWNER agent;
REVOKE CONNECT ON DATABASE agent_dev FROM PUBLIC;
CREATE ROLE contact LOGIN PASSWORD 'contact';
CREATE DATABASE contact_dev OWNER contact;
REVOKE CONNECT ON DATABASE contact_dev FROM PUBLIC;
\connect agent_dev
CREATE EXTENSION IF NOT EXISTS vector;
```

1. `pnpm dev:up` runs `docker compose -f infra/compose/compose.dev.yml up -d --wait` (already in the permission allowlist of `.claude/settings.json`).
2. Docker pulls both images, creates the network `jadero-dev_default` and the volume `jadero-dev_pgdata`.
3. Postgres sees an empty volume, runs `initdb`, then runs `01-databases.sql` as the `postgres` superuser: 3 roles, 3 databases, the `vector` extension only in `agent_dev` (ADR-027).
4. `--wait` blocks until both healthchecks pass: `pg_isready` returns `accepting connections`; `rabbitmq-diagnostics -q ping` returns 0. Typical cold start: 5 to 20 seconds.
5. Check: `docker compose -f infra/compose/compose.dev.yml exec postgres psql -U agent -d content_dev` fails with `FATAL: permission denied for database "content_dev"`, which is ADR-029 rule 1 (a service cannot read another's tables) proven at the database level from day one.
6. The RabbitMQ UI answers on `http://localhost:15672` with user `dev`. The default `guest` user would not work here: RabbitMQ allows `guest` only over loopback, and a connection through a Docker port mapping arrives from the bridge network.
7. Editing `01-databases.sql` later has no effect until `docker compose ... down -v` deletes the volume, because init scripts run only on an empty data directory.

## Patterns

- **Monorepo with workspaces**: trace 1, `pnpm-workspace.yaml`.
- **Single-version policy** (pnpm catalogs): trace 1, `catalog:`.
- **Task graph as a DAG, topological execution**: trace 1, step 3 and the WP-5 extension (`^build`).
- **Content-addressed build cache / memoization**: trace 1, steps 4 to 6 and the FULL TURBO rerun.
- **Incremental (affected) builds**: trace 1, step 2.
- **Internal packages: compiled vs just-in-time vs no-build**: `@jadero/config` is no-build (JSON and plain JS), `@jadero/contracts` in WP-5 is compiled.
- **Encapsulation through the package boundary** (`exports` map, conditional exports): `packages/config/package.json`.
- **Architecture fitness function**: `//#depcruise` in trace 1.
- **Shift-left checks with git hooks**: trace 2.
- **Conventional commits as machine input** (release automation): trace 2, step 3.
- **Infrastructure as code** and **database per service**: trace 3.
- **Golden command** (one "am I done" entry point): `pnpm verify`.

## Options and trade-offs

Already decided by ADRs, not reopened here: Turborepo + pnpm with catalogs, compiled packages for anything the API consumes (ADR-001); Biome, dependency-cruiser, commitlint through lefthook (ADR-024); Vitest and coverage gates (ADR-009); release-please per service (ADR-025, wired in WP-6/7); Nest 12 on Node 22, ESM (ADR-004); RabbitMQ 4 and `pgvector/pgvector` (ADR-027). Open at this level:

**A. How compiled packages are consumed in dev and tests.**
- *A1. Plain compiled:* `exports` point only at `dist/`. Every `typecheck` and `test` waits for `^build`. Pros: one path, identical in dev, CI and the image. Cons: a change in `contracts` needs its `build` before `api` sees it (cached, but still one more step in watch mode; `turbo watch` or `tsc --watch` in `pnpm dev`).
- *A2. Compiled plus a custom source condition:* `exports["."] = { "@jadero/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`. TypeScript (`customConditions`) and Vitest (`resolve.conditions`) resolve `src/` directly, so `typecheck` and `test` no longer need `^build`; Node in production ignores the unknown condition and loads `dist/`. Pros: faster feedback, simpler watch mode. Cons: two resolution paths, so a bug that only shows with `dist/` (a wrong `exports` path, a missing `.js` extension) hides until `build`; CI must run `build` too. **Verify** that `customConditions` works with `moduleResolution: nodenext` in the chosen TypeScript version.
- In WP-1 itself this choice touches only `turbo.json`; the first compiled package arrives in WP-3 (`platform-nest`) or WP-5 (`contracts`).

**B. TypeScript version in the catalog.**
- *B1. 6.0.3.* `@nestjs/cli` 12.0.8 itself depends on `~6.0.2`. Pros: matches Nest's own toolchain; `tsc` declaration emit is the known path. Cons: the slower compiler.
- *B2. 7.0.2 (native Go compiler).* Reported about 10x faster type checks. Cons: three months old; reports disagree on whether declaration (`.d.ts`) emit is complete in 7.0 **(verify)**, and compiled packages need `.d.ts`.
- *B3. 6.0.3 for `build`, 7.0.x only for `typecheck`.* Pros: speed where it is safe. Cons: two compilers can disagree.

**C. pnpm major.**
- *C1. 10.34.6.* What the plan assumed. Most documentation matches it. Cons: oldest of three supported lines.
- *C2. 11.28.2.* Defaults `minimumReleaseAge` to 1440 minutes (a version must be one day old before install), a supply-chain guard.
- *C3. 12.8.1.* Current `latest`; byte-stable lockfile, stricter `pnpm-workspace.yaml` (unknown settings fail); reported as a Rust rewrite **(verify)**. Cons: five weeks old; **verify** that Turborepo 2.11 parses its lockfile (needed for `--affected`, hashing and `turbo prune` in the Docker builds of ADR-026).
- Whatever the choice, it is pinned in `package.json` (`packageManager` or `devEngines.packageManager`, which Turborepo 2.11 supports) and enabled through Corepack or the pnpm installer, so every machine and CI runs the same binary.

**D. Node line.**
- *D1. Node 22 (ADR-004).* Maintenance LTS now, end of life 2027-04-30 (about 7 months away).
- *D2. Node 24 (active LTS).* Nest 12 needs 20.19+ or 22.12+, so 24 qualifies. Changing it means a new ADR that supersedes ADR-004 on this one point (`/adr`).

**E. TypeScript project structure.**
- *E1. Each package has its own `tsconfig.json` that extends `@jadero/config/tsconfig/...`; Turborepo orders the work.* Simple, and it is the layout Turborepo's guides use **(verify their current advice on project references)**.
- *E2. TypeScript project references (`tsc -b`).* Incremental builds inside tsc. Cons: a second dependency graph to keep in sync with `package.json`, and it overlaps with Turborepo's cache.

**F. Postgres image (ADR-027 left the tag open).** `0.8.7-pg17` or `0.8.7-pg18`. 18 has a longer support window; the pg18 images changed the data directory layout, so the volume path differs **(verify)**. Production (WP-8) should use the same major as dev.

**G. Dev databases.**
- *G1. Three databases and three roles now* (trace 3, about 12 lines of SQL). Pros: ADR-029 rule 1 is true from day one; WP-3 and WP-5 just use their database.
- *G2. One database now, add one per service in its own WP.* Pros: less to explain today. Cons: each later WP needs a volume reset.

**H. RabbitMQ in WP-1.** *H1.* Plain broker with the management UI and a `dev` user; `definitions.json`, vhosts and per-service users come in WP-5, whose deliverable already lists them. *H2.* Load a minimal `definitions.json` now. H1 keeps WP-1 about tooling.

**I. Where lint and the architecture check run.** *I1.* Biome and dependency-cruiser once at the root (`//#lint`, `//#depcruise`): one process each, one cache entry. *I2.* A `lint` script in every package: finer cache, but N processes for a tool that lints the whole repo in well under a second.

**J. Commit scopes.** *J1.* `scope-enum` with a fixed list (`api`, `agent`, `contact`, `mcp`, `web`, `admin`, `contracts`, `messaging`, `platform-nest`, `ai`, `ui`, `cv`, `config`, `infra`, `ci`, `docs`, `adr`, `deps`, `repo`). A typo fails the commit. Each new package adds a scope. *J2.* Free scopes. release-please attributes by path either way, so scopes are for human readers and the changelog line.

**K. ADR scripts.** `pnpm adr:new` copies `docs/adr/0000-template.md` to the next number; `pnpm adr:index` rewrites the table in `docs/adr/README.md` from each file's front matter, and a `--check` mode for CI (WP-6) fails when the table is stale. Plain Node `.mjs` with no dependencies (the front matter is flat YAML), or a small YAML parser such as `yaml`. The owner may mark this step `known`.

## The question for the owner

Answer each with a letter (or "your call"); the recommendation is in brackets.

1. **Compiled packages in dev and tests (A):** plain compiled, every `typecheck` and `test` waits for `^build` (A1), or compiled plus the `@jadero/source` condition (A2)? [A1 for now: one resolution path while you learn it; A2 is a later, measured change.]
2. **TypeScript (B):** 6.0.3, 7.0.2, or 6 for build and 7 for typecheck? [B1, 6.0.3, matching `@nestjs/cli` 12; revisit when Nest moves.]
3. **pnpm major (C):** 10, 11 or 12? [C2, 11: the one-day release-age default is worth having, and it avoids betting on a five-week-old major before Turborepo support is checked. If you prefer 12, step 2 starts with a 10-minute check of `turbo prune` on its lockfile.]
4. **Node (D):** stay on 22 as ADR-004 says, or move to 24 with a new ADR that supersedes ADR-004 on the Node line? [D2, 24: 22 leaves support in about 7 months, before R2.]
5. **Postgres major (F):** 17 or 18? [18, pinned as `0.8.7-pg18`.]
6. **Dev databases (G):** three databases and roles now, or one now? [G1, three now.]
7. **Commit scopes (J):** fixed list or free? [J1, fixed list.]

E (no project references), H (plain RabbitMQ, definitions in WP-5), I (lint and depcruise at the root) and K (dependency-free `.mjs` scripts) have a clear default; say so if you want any of them changed. Also say which steps you already know (D-38 fast path): Biome, commitlint + lefthook, Docker Compose and the ADR scripts are candidates.

## Decision

Recorded 2026-10-03. The owner took the recommendation on every question.

1. A1: plain compiled packages; `typecheck` and `test` depend on `^build`. A2 (`@jadero/source` condition) is a later, measured change.
2. B1: TypeScript 6.0.3 in the catalog, matching `@nestjs/cli` 12.
3. C2: pnpm 11 (11.28.2 today), pinned in `package.json`; the one-day `minimumReleaseAge` default stays on.
4. D2: Node 24 LTS. Recorded as ADR-042, which supersedes ADR-004 on the Node line.
5. Postgres 18: `pgvector/pgvector:0.8.7-pg18`; production (WP-8) uses the same major.
6. G1: three databases and three roles in the dev init script.
7. J1: fixed commit scope list (`scope-enum`); a new package adds its scope in the same PR.

Defaults confirmed: E1 (no project references), H1 (plain RabbitMQ, definitions in WP-5), I1 (lint and depcruise once at the root), K (dependency-free `.mjs` ADR scripts).

Fast path: none marked `known`; every step gets its two-line note and the explain-back covers steps 2, 4 and 7.

## Step log

- Step 2 (workspace and task graph): root `package.json` (pnpm 11.28.2 pinned, Node >= 24), `pnpm-workspace.yaml` with the catalog, `turbo.json`, `.nvmrc`, `packages/config` (three tsconfig bases, the Vitest base with `workersFromLoad`, a contract test). Trace 1 reproduced: `turbo run test --affected` was a cache miss (1.4 s), then `FULL TURBO` in 25 ms.
  Why: the single-version policy lives in the catalog; `@jadero/config` is a no-build package so its `exports` map points at JSON and plain JS; `turbo.json` declares `^build` so compiled packages (WP-5) will build before their consumers typecheck. Seen live: turbo 2.11.7 was 19 hours old, so pnpm 11's one-day `minimumReleaseAge` would refuse it; the catalog pins 2.11.6.
- Step 3 (Biome): `@biomejs/biome` 2.5.15 from the catalog; `biome.json` with 2 spaces, width 100, double quotes, trailing commas in JS and TS, the recommended lint rules, import sorting through `assist`, and the git ignore file as the ignore list. `pnpm lint:fix` reformatted 5 files (two data files under `docs/plan/`, `turbo.json`, `.claude/settings.json`, `scripts/github/seed.mjs`; the parsed JSON is unchanged), then `pnpm lint` (`biome ci .`) passed: `Checked 14 files. No fixes applied.` with one `useTemplate` info in `seed.mjs` (Biome marks that fix unsafe, so it stays a hint).
  Why: one tool and one config for format and lint (ADR-024); `biome ci` never writes, so CI and `pnpm verify` fail on a difference instead of fixing it silently. JSON keeps no trailing commas because `package.json` and `turbo.json` must stay strict JSON.

## Recap
