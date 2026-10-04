# Working on this repo with firstmate

How the owner's framework (firstmate) runs this repo's delivery flow on the owner's machine, where the two may collide, and the prompts to start a work package. Written at the end of WP-3 (2026-10-04), after two work packages ran end to end. The flow itself is in `docs/agent-tooling.md`; the hands-on daily loop in `docs/local-playbook.md`.

## What firstmate reads, in this order

1. `AGENTS.md`: map, commands, architecture rules, the learning protocol (section 5), conventions, hard rules.
2. `CLAUDE.md` and `.claude/` (`rules/`, `skills/`, `agents/reviewer.md`, `hooks/learning-gate.sh`, `settings.json`).
3. `docs/agent-tooling.md`: the ten stages, who does what, the gates.
4. `docs/local-playbook.md`: setup, daily loop, the "When something blocks" table.
5. For the WP at hand: its row in `docs/plan/decisions.json` and `docs/plan/report.md` section 14, its GitHub issue, the ADRs it names, and `docs/learning/wp-NN.md` once written.
6. To see the code at a glance: `docs/architecture/code-map.html` (open it in a browser).

It never needs to read the whole plan or every ADR: the explainer of the WP is written to be self-contained.

## The flow, mapped

| Stage | This repo | firstmate concept |
|---|---|---|
| Open | `/wp NN`: dependencies closed, branch `wp/NN-slug` from `origin/main`, 4 to 8 proposed steps, definition of done; stops | plan |
| Learn | `/learn-step NN`: writes `docs/learning/wp-NN.md` (self-contained, all questions in one message); stops | (no equivalent) |
| Decide | the owner answers; answers go under Decision, front matter `decision: recorded` | approve |
| Build | one step at a time: explain the files first, write, `pnpm verify`, one scoped commit, two lines in the step log, show it running | implement |
| Map | last step: update `docs/architecture/code-map.html` and the docs the WP changed | (no equivalent) |
| Review | PR with `Closes #N`; `@agent-reviewer` (ten points); fix findings | review gate |
| Explain back | the owner explains the design in their own words; gaps go to the explainer's Recap | retro / learn |
| Merge | the owner squash merges; the board card moves to Done by itself | MR |

## Where they may collide, and the rule for each

| Topic | This repo expects | Possible clash | Rule |
|---|---|---|---|
| Decisions before code | `learning-gate.sh` denies edits under learning paths until `decision: recorded` | an autonomous implementer that plans and codes in one pass | firstmate must stop after the plan and after the explainer; a denied edit is the process, never something to route around |
| Who decides | the owner answers every backend and agent pattern question | firstmate picking defaults to keep moving | firstmate recommends; only the owner records the decision. "Take the recommendation" is allowed only when the owner says it |
| Step size | one step, one commit, the owner sees it run | batching a WP into one diff | keep the step list from `/wp`; one commit per step |
| Decision records | ADRs tracked in `docs/adr/`, superseded never edited, `/adr` | the framework keeps decisions untracked | decisions that change an ADR become a new ADR in the repo; the framework's own notes stay outside it |
| Hosting | GitHub: issues, Project board, PRs, `Closes #N`, squash merge | the framework assumes GitLab and MRs | use `gh` (or GitHub tools); PR, not MR; the PR title is the squash commit |
| Commits | conventional, scoped (`feat(api): ...`), scopes in `commitlint.config.mjs`; the owner's identity; no attribution trailers, model names or session links | a commit skill that adds trailers or other formats | commitlint rejects bad shapes; turn off any trailer in the framework's commit skill for this repo |
| Branches | `wp/NN-slug` for a WP (the gate reads NN), `chore/`, `fix/`, `docs/` otherwise | other naming | follow the repo; versions come from the squash commit type, not the branch |
| Hooks | lefthook (Biome on staged files, commitlint); Claude hooks: Biome on edit, the learning gate, the session banner | the framework's guard hooks on the same events | both can run; security guards are the framework's job, the repo adds none. If two formatters fight, Biome wins in this repo |
| Secrets | `.claude/settings.json` denies `Read(.env.*)`; agents read `.env.example` files through Bash, list variable names only | a guard that blocks Bash reads of env files | allow reading `*.env.example` only; never real `.env` files |
| Reviews | `@agent-reviewer` before the owner looks | a second reviewer with other rules | run both if wanted; the repo's ten points are the merge bar |
| Model and effort | Opus-class main session, high effort for learning WPs | cheaper models on learning steps | learning WPs stay on the owner's chosen model |
| Docker | `pnpm dev:up` and `pnpm test:int` need it (OrbStack works; the harness reads the Docker context) | a sandbox without the Docker socket | Docker steps run where the socket is; say so instead of skipping the test |
| Artifacts | the code map and process pages live in the repo (`docs/architecture/`, `docs/process/`); claude.ai artifacts are copies | a local session without the artifact tool | edit the repo files; publishing is optional |

## Prompt: first local session (check the fit, change nothing)

```
Read AGENTS.md, CLAUDE.md, .claude/ (rules, skills, agents, hooks, settings.json), docs/agent-tooling.md,
docs/local-playbook.md and docs/firstmate.md in the jadero-dev repo. Then compare them with your own
framework rules and hooks. Report, without changing any file:
1. every place where your defaults would break this repo's flow (decision gate, one step per commit,
   GitHub instead of GitLab, commit format and identity, branch names, ADRs in the repo, hooks that
   would run twice or fight);
2. what you would change on your side for this repo (config, skills to turn off);
3. anything in the repo that looks wrong or stale.
Answer in Spanish; the files stay in English.
```

## Prompt: start a work package (WP-5 next)

```
Next work package in jadero-dev: WP-5 (messaging foundation and the agent skeleton), a learning WP.
Follow the repo's flow exactly (AGENTS.md section 5, docs/agent-tooling.md, docs/firstmate.md):
1. git switch main && git pull && pnpm install && pnpm verify:all.
2. /wp 5: check that WP-3 is merged, create wp/5-<slug> from origin/main, propose 4 to 8 steps and the
   definition of done from the issue, then stop.
3. After my go: /learn-step 5. The explainer must be self-contained (How to read this file, Named here,
   two traces for a service WP, facts checked against the npm registry, all questions in one message,
   dependent questions with a recommendation per answer). Stop. Do not write code under learning paths.
4. When I answer: record the decision (decision: recorded), then build one step at a time: tell me which
   files and why before writing, pnpm verify, one scoped commit, two lines in the step log, show it
   running. Steps that need Docker run here (pnpm dev:up, pnpm test:int).
5. Last step: update docs/architecture/code-map.html (its JSON data) and the docs the WP changed.
6. Open the PR with Closes #13, run @agent-reviewer, fix its findings, then ask me the
   explain-back questions (only about what the explainer taught) and write my answers and the gaps in
   the Recap. I merge.
Answer in Spanish; files in plain English, no em dashes, no attribution lines in commits or PRs.
```

To start any other WP, change the number and the title; the rest stays.

## What stays repo-local whatever firstmate adopts

`learning-gate.sh`, `docs/learning/`, `docs/adr/`, the GitHub delivery conventions, the code map. The four skills (`/wp`, `/learn-step`, `/explain`, `/adr`) can be replaced by firstmate equivalents if they produce the same files and stop at the same points.
