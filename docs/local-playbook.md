# Local playbook

How to run the delivery flow on the owner's machine with Claude Code and firstmate. Written after the WP-1 end-to-end trial of 2026-10-03. The nine stages, roles and gates are in `docs/agent-tooling.md`; this file is the hands-on version.

## Setup once

| Tool | Version | How | Why |
|---|---|---|---|
| Node | 24.x (24.12 or later) | the version manager reads `.nvmrc`: `nvm install` or `fnm use` | ADR-042; `engineStrict: true` makes `pnpm install` refuse other majors |
| pnpm | 11.x | `corepack enable && corepack prepare pnpm@11.28.2 --activate`, or `npm i -g pnpm@11` | pinned in `package.json`; pnpm 11 refuses packages younger than 24 hours (`minimumReleaseAge`) |
| Docker | Desktop or Engine with Compose v2 | installed | `pnpm dev:up` runs Postgres 18 and RabbitMQ 4 on 127.0.0.1; port 5432 must be free |
| gh | 2.60 or later | `gh auth status`, scopes repo and project | `/wp` reads issues; the seed script needs the project scope |
| Claude Code | current | model Opus 5.5 in the user settings (`/model`); the repo pins none | high effort for learning WPs; the reviewer agent inherits the model |

```bash
cd ~/dev/projects/jadero-dev && git switch main && git pull
nvm use && corepack enable
pnpm install          # prepare: lefthook install writes .git/hooks
pnpm verify           # first run builds the cache
pnpm verify           # FULL TURBO
```

Commits on the owner's machine carry the owner's identity. A cloud session commits as the tool; its branch authors are reset before a PR (see `docs/agent-tooling.md`).

## First local session: close WP-1

PR #66 is implemented, reviewed by the reviewer agent and green. What the cloud could not do: start Docker, the explain-back, the Recap.

1. Squash merge #67 on GitHub first (process gaps and this playbook), so the skills you run are the corrected ones. It merges cleanly with #66 in either order.
2. `git fetch && git switch wp/1-repo-foundation && git pull && nvm install && corepack enable && pnpm install`. Chain with `&&`: if the switch fails, nothing else runs on the wrong branch.
3. `pnpm dev:up`, then the trace 3 check of `docs/learning/wp-1.md`: `psql -U agent -d content_dev` must be denied; `psql -U agent -d agent_dev -c '\dx'` must list `vector`; `http://localhost:15672` accepts user `dev`. Then `pnpm dev:down`.
4. In Claude Code: "Append the dev:up result to step 6 of the WP-1 step log, then do my explain-back for steps 2, 4 and 7." Answer in your own words; the gaps go under Recap. Commit `docs(learning): add the WP-1 recap`. Push.
5. Squash merge #66 on GitHub. The issue closes and the board moves to Done.
6. On `main`: `git pull && pnpm verify`.

Also waiting, no code: the Project views and workflows (`scripts/github/README.md`); mark "Deployed to staging" and "Changelog entry" n/a on issue #9.

## Gates, in order

- **Decision, before code.** The hook refuses edits under a learning path until the explainer says `decision: recorded`.
- **Explain-back, before the merge.** The issue lists "Explained back by the owner"; the Recap lands in the same PR, so the history shows the code and what was understood of it together. A missed Recap lands later as a `docs(learning)` commit.
- **`pnpm verify`, before every commit; CI and the reviewer agent, before the owner reviews.**

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
| Build | one step at a time; stop and ask | explains, writes, `pnpm verify`, one scoped commit, two log lines | |
| Review | explain the design back; review on GitHub | PR with `Closes #`; `@agent-reviewer`; fixes; Recap gaps | In review (automatic) |
| Close | squash merge; later deploy and journal | | Done (automatic) |

Compact after the decision is recorded and after the reviewer has reported. Keep: branch, WP id, explainer path, step list with done marks, open findings.

## How the owner learns

The file is the textbook for this WP; the session is the teacher. Read the question first, then the options, then the first principles you need. Ask about any paragraph or file. A step you already know: say "known" (`fast_path: known`). A fact marked **verify** was not confirmed from a primary source; verify it at implementation time. Learning survives the PR: the Recap can land after the merge in a docs commit. A learning WP run without the owner (as WP-1 was) gets its explain-back on the next session before moving on.

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
| Claude cannot read `.env.example` | `settings.json` denies `Read(.env.*)` | expected; it reads it through Bash |

## With firstmate

Point the implementers at `AGENTS.md`. The mapping (plan, approve, implement, review, MR) is in `docs/agent-tooling.md`. Firstmate must honor the learning gate (read the explainer front matter before touching a learning path) and the ADR files (supersede, never edit). Security guardrails are firstmate's. Cloud sessions suit explainers, ADR drafts, tooling fixes and reviews; implementation of a learning WP belongs in the local session, with the owner present and Docker running.

## Cheat sheet

| Command | Does |
|---|---|
| `pnpm verify` | lint, architecture rules, typecheck, unit tests, affected only, cached |
| `pnpm lint` / `pnpm lint:fix` | Biome check / format and safe fixes |
| `pnpm depcruise` | import rules of ADR-003 and AGENTS.md section 4 |
| `pnpm dev:up` / `pnpm dev:down` | Postgres 18 (pgvector) and RabbitMQ 4 |
| `pnpm adr:new "Title"` / `pnpm adr:index` / `--check` | next ADR / regenerate the index / fail when stale |
| `/wp NN`, `/learn-step NN`, `/explain X`, `/adr Title` | the four skills |
| `@agent-reviewer` | ten-point review before the owner looks at a PR |
| `LEFTHOOK=0 git commit ...` | skip hooks once; CI runs the same checks |
| `node scripts/github/seed.mjs` | re-seed issues and the Project after adding a WP |
