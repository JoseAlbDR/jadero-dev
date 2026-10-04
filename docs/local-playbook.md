# Local playbook

How to run the delivery flow on the owner's machine with Claude Code and firstmate. Written after the WP-1 end-to-end trial of 2026-10-03. The ten stages, roles and gates are in `docs/agent-tooling.md`; this file is the hands-on version.

## Setup once

| Tool | Version | How | Why |
|---|---|---|---|
| Node | 24.x (24.12 or later) | the version manager reads `.nvmrc`: `nvm install` or `fnm use` | ADR-042; `engineStrict: true` makes `pnpm install` refuse other majors |
| pnpm | 11.x | `corepack enable && corepack prepare pnpm@11.28.2 --activate`, or `npm i -g pnpm@11` | pinned in `package.json`; pnpm 11 refuses packages younger than 24 hours (`minimumReleaseAge`) |
| Docker | Desktop or Engine with Compose v2 | installed | `pnpm dev:up` runs Postgres 18 and RabbitMQ 4 on 127.0.0.1; port 5432 must be free |
| gh | 2.60 or later | `gh auth status`, scopes repo and project | `/wp` reads issues; the seed script needs the project scope |
| Claude Code | current | model Opus 5.5 in the user settings (`/model`); the repo pins none | high effort for learning WPs; the reviewer agent inherits the model |

```bash
cd jadero-dev && git switch main && git pull
nvm use && corepack enable
pnpm install          # prepare: lefthook install writes .git/hooks
pnpm verify:all       # first run builds the cache (on main, plain verify runs nothing)
pnpm verify:all       # FULL TURBO
```

Commits on the owner's machine carry the owner's identity. A cloud session commits as the tool; its branch authors are reset before a PR (see `docs/agent-tooling.md`).

## After a merge to main

WP-1 closed this way on 2026-10-03: trace 3 checked with Docker on the owner's machine, the explain-back recorded in the Recap, the squash merge, the card moved to Done on its own.

On `main`: `git pull && pnpm verify:all`. `pnpm verify` runs nothing there ("No tasks were executed"): `--affected` compares with `main`, so on `main` nothing is affected. On a branch, `pnpm verify` is the right command.

Also waiting, no code: the Project views (`scripts/github/README.md`).

## Gates, in order

- **Decision, before code.** The hook refuses edits under a learning path until the explainer says `decision: recorded`.
- **Explain-back, before the merge.** The issue lists "Explained back by the owner"; the Recap lands in the same PR, so the history shows the code and what was understood of it together. A missed Recap lands later as a `docs(learning)` commit.
- **`pnpm verify`, before every commit; CI and the reviewer agent, before the owner reviews.**
- **`pnpm verify` again after merging `main` into a branch, before pushing.** A merge brings files that never passed your hooks (WP-1 pushed a merge with an unformatted file from another PR).

## Branch names and versions

Versions never come from branch names. With squash merges the PR title is the one commit on `main`; release-please reads its type (`feat` minor, `fix` patch, `!` major) per service. `wp/NN-slug` ties the branch to its issue and lets the learning gate find `docs/learning/wp-NN.md`. Work outside a WP uses `chore/`, `fix/` or `docs/`.

## What a session looks like

```
$ claude
jadero.dev v2. Branch: wp/3-service-platform. ... WP-3 explainer: docs/learning/wp-3.md (decision: pending).

> Show me the trace of GET /health/ready in the explainer and explain why readiness checks the database but liveness does not.
> /explain fail-fast configuration
> My answers: 1 Express, 2 ApiConfig class, 3 pg, ... Record the decision.
docs/learning/wp-3.md: decision: recorded. The gate is open.
> Step 2. Explain each file before you write it.
(writes, runs pnpm verify, commits feat(platform-nest): ..., appends two lines to the step log)
> Open the PR and run @agent-reviewer.
> Fix the high and medium findings, then ask me the explain-back questions.
```

Never typed: a push to `main`, a deploy, `pnpm eval` without `EVAL_CONFIRMED=1`. Done by the hooks: a denied edit under a learning path while the decision is pending (the process, not a bug), Biome on every edit and on staged files, commitlint on every commit.

## Daily loop

| When | Owner | Agent | Board |
|---|---|---|---|
| Start | `git switch main && git pull`; pick the Ready card | | Ready |
| Open | `/wp NN`; read the step list; go or edit | dependencies, gate, branch `wp/NN-slug`, steps; stops | In progress (owner moves it) |
| Learn | read `docs/learning/wp-NN.md`; ask; answer | `/learn-step NN` writes and stops; records the decision | |
| Build | one step at a time; answer the check question; stop and ask | names files and ADR lines, writes, `pnpm verify`, privacy check, step log from the diff, one check question, one scoped commit; mid-WP review for M or larger | |
| Review | explain the design back; review on GitHub | PR with `Closes #`; `@agent-reviewer`; fixes; Recap gaps | In review (automatic) |
| Close | squash merge; later deploy and journal | | Done (automatic) |

Compact after the decision is recorded and after the reviewer has reported. Keep: branch, WP id, explainer path, step list with done marks, open findings.

## How the owner learns

The file is the textbook for this WP; the session is the teacher. You never read ADRs or other WPs to answer: the file has a "How to read this file" table (what to read before each question) and a "Named here" table (one line per WP or ADR it names). The session asks all the questions in one message, each with that pointer; a question that depends on another carries a recommendation per possible answer of the first. Nothing is to memorize; an explain-back you cannot answer means the explainer missed something, and it gets taught and added, not re-tested. Ask about any paragraph or file. A step you already know: say "known" (`fast_path: known`). A fact marked **verify** was not confirmed from a primary source; verify it at implementation time. Learning survives the PR: the Recap can land after the merge in a docs commit. A learning WP run without the owner (as WP-1 was) gets its explain-back on the next session before moving on.


Learning happens during the build too: every learning step ends with one one-line check question on what was just built (for example "Postgres is down: what does `/health/live` answer?"). A wrong answer is explained on the spot, so the explain-back at the end confirms instead of discovering. WP-3 showed why: two gaps (live versus ready, why a package is compiled) surfaced only in the Recap.

## Lessons from WP-3 (2026-10-04)

- An implementation departed from an accepted ADR without anyone saying so (own config loader instead of `@nestjs/config`); it became ADR-043 after the fact. Rule: name the ADR lines before each step.
- A `git checkout` used to undo a test edit also removed an uncommitted change, and the step log described code that was not there. Rule: commit or stash before reverting; write the step log from the diff.
- Privacy issues (visitor IP in OpenTelemetry spans, query strings in error bodies) were found only in the PR review. Rule: a privacy check at the end of every step.
- Commits were pushed to a PR after it was said to be ready, and the merge took only part of them. Rule: a ready PR gets no new commits without telling the owner.
- The reviewer found one high and five medium issues; a mid-WP review would have found most of them earlier.
## When something blocks

| Symptom | Cause | Do |
|---|---|---|
| `learning-gate: ... not yet` | edit under a learning path before the decision | read, answer, let the agent record it; never route around the hook |
| `ERR_PNPM_UNSUPPORTED_ENGINE` | Node outside 24.12 to 24.x | `nvm use` |
| pnpm picks an older version or refuses one | `minimumReleaseAge`: younger than 24 hours | wait a day or pin the previous version in the catalog; say so in the step log |
| commit rejected: scope | commitlint | `type(scope): subject`; scopes live in `commitlint.config.mjs` |
| commit rejected by Biome | unsafe fix or syntax error | `pnpm lint:fix`, then fix by hand |
| `pnpm verify` never hits the cache | an input that changes every run | check `inputs` in `turbo.json`; `turbo run test --summarize` |
| `pnpm dev:up` fails on 5432 | a local Postgres | stop it, or change the host port in the compose file and `.env.example` |
| changed `01-databases.sql`, nothing happened | init runs only on an empty volume | `docker compose -f infra/compose/compose.dev.yml down -v` |
| the board card did not move | PR body lacks `Closes #N`, or a workflow is off | edit the body; check `scripts/github/README.md` |
| a reviewer wants a design change | larger than a nit | decide; `/adr` first if an ADR changes |
| `git switch` aborts: untracked `package.json` or `pnpm-lock.yaml` would be overwritten | a `pnpm` or `npx` run on `main` before WP-1 merged left them behind | look at them (`git status`, `cat package.json`), then `rm package.json pnpm-lock.yaml && rm -rf node_modules` and switch again |
| `nvm use`: no .nvmrc found | the current branch predates WP-1 | switch to a branch with `.nvmrc`; `nvm install` installs and selects 24.x |
| `pnpm verify` on `main`: "No tasks were executed" | `--affected` has no diff against `main` | `pnpm verify:all` |
| RabbitMQ exits with `.erlang.cookie: eacces` | an old volume where a root process wrote the cookie | `user: rabbitmq` is in the compose file; run `pnpm dev:down && docker compose -f infra/compose/compose.dev.yml down -v` once |
| Biome warns that `recommended` is deprecated | Biome 2.5 renamed it | `pnpm exec biome migrate --write` (it becomes `"preset": "recommended"`) |
| Testcontainers: `Could not find a working container runtime strategy` (`pnpm dev:up` works) | the socket is not at `/var/run/docker.sock`; Compose reads the Docker context, Testcontainers does not | the harness now reads the context itself (`apps/api/test/setup/docker-host.ts`); if it still fails, check `docker context ls` and `docker info`, or set `docker.host` in `~/.testcontainers.properties`. A "No test files found" line next to it is a side effect of the failed global setup |
| Editor: `Module '"@jadero/platform-nest"' has no exported member 'X'` while `pnpm verify` is green | the editor reads the package's compiled `dist/index.d.ts`, which is older than the source after a pull | `pnpm build` (Turborepo builds packages in dependency order); `pnpm verify` builds them too |
| A PR body opened from a cloud session ends with "Generated by Claude Code" and a session link | the cloud GitHub tool appends it on every post | delete it in the PR description (or the squash dialog) before merging; AGENTS.md section 6 forbids it on `main` |
| Claude cannot read `.env.example` | `settings.json` denies `Read(.env.*)` | expected; it reads it through Bash |

## With firstmate

`docs/firstmate.md` has the mapping, the collision table and two prompts: one to check the fit before changing anything, one to start the next WP. Firstmate must honor the learning gate (read the explainer's front matter before touching a learning path), the ADR files (supersede, never edit) and GitHub delivery. Security guardrails are firstmate's.

## Pages to keep current

| Page | Source in the repo | Published copy | Update when |
|---|---|---|---|
| Code map | `docs/architecture/code-map.html` (JSON data block) | claude.ai artifact | every WP that adds an app, package, module, provider or changes the request path (last step of `/wp`) |
| Delivery flow | `docs/process/delivery-flow.html` (mirrors `docs/agent-tooling.md`) | claude.ai artifact | the flow changes |
| Local guide | `docs/process/local-guide.html` (mirrors this playbook) | claude.ai artifact | this playbook changes |

A session that can publish artifacts republishes them; one that cannot edits the repo files, and the next session that can publishes them.

## Cheat sheet

| Command | Does |
|---|---|
| `pnpm verify` | lint, architecture rules, typecheck, unit tests, affected only, cached |
| `pnpm verify:all` | the same on every package; use it on `main` and in CI |
| `pnpm lint` / `pnpm lint:fix` | Biome check / format and safe fixes |
| `pnpm depcruise` | import rules of ADR-003 and AGENTS.md section 4 |
| `pnpm dev:up` / `pnpm dev:down` | Postgres 18 (pgvector) and RabbitMQ 4 |
| `pnpm adr:new "Title"` / `pnpm adr:index` / `--check` | next ADR / regenerate the index / fail when stale |
| `/wp NN`, `/learn-step NN`, `/explain X`, `/adr Title` | the four skills |
| `@agent-reviewer` | ten-point review before the owner looks at a PR |
| `LEFTHOOK=0 git commit ...` | skip hooks once; CI runs the same checks |
| `node scripts/github/seed.mjs` | re-seed issues and the Project after adding a WP |
