---
wp: 6
title: "CI on someone else's machine: affected runs, a weekly backstop and a locked supply chain"
status: draft
date: 2026-10-12
locale: en
---

# CI on someone else's machine: affected runs, a weekly backstop and a locked supply chain

Until WP-6 every check in this repo ran only on my laptop, and `LEFTHOOK=0` skipped all of it. Now GitHub runs them on every pull request, on a machine I do not control, with a token. The work was deciding which shortcuts are safe there. <!-- owner: check -->

## What I built

`ci.yml` runs `pnpm verify` only on what the PR affects, compared against the PR base commit with full history. Turborepo picks tasks by their inputs, so every file a test reads outside its package is declared, and a small test fails when one is not. Every push to `main` runs everything from the cache, and every Monday a run without the cache checks that nothing replayed green by mistake.

Integration tests run on the runner's Docker through Testcontainers, the same harness I use locally. A consumer contract test in `agent` parses the producer's ping fixture with the schema it subscribes with. Coverage gates run per package, with 90% lines on the `api` domain and application layers. A `web` job runs the Playwright smoke and axe checks per locale.

The PR title goes through commitlint, because the title becomes the squash commit and the changelog line. gitleaks scans every commit in the PR and the full history on `main`. zizmor lints the workflows. OSV-Scanner fails a PR only on vulnerabilities that PR adds, and a weekly full scan reports the rest to the Security tab. Dependency review denies AGPL and GPL licenses.

Every action is pinned by commit SHA, every workflow starts from `permissions: {}`, and only `pull_request` triggers it, never `pull_request_target`. Every run restores the cache, but only `main` saves it, so a PR cannot poison it. Renovate groups updates weekly behind a three-day cooldown, and pnpm refuses anything younger than three days. Eight required checks guard `main`.

## What I learned

**An undeclared input replays green.** I said CI would catch a test reading an undeclared file. The PR never selects that test, the cached run on `main` replays the old green result, and only the uncached Monday run executes it and fails.

**Coverage counts execution, not assertions.** V8 marks a line covered once it runs. A test that runs the outbox write and never checks the value keeps the number high and catches nothing. Mutation testing is the check for that.

**A diff gate needs a second channel.** In a transfer question about a severe advisory with no fix yet, I saw that a full-scan gate blocks every PR, even a typo fix. I missed that the advisory still has to reach someone, so the full scan goes to alerts and tickets instead of the gate.

**Renaming a required check is expand/contract, and the ruleset list is an AND.** I got the pattern but put both names in the ruleset, which blocks every PR. The expand lives in the workflow: a thin job with the old name. The ruleset swaps names once every open PR reports both. A required name nobody reports never goes red, it waits forever, and so does a check behind a `paths:` filter.

**Readiness should check only what a request cannot work without.** If six replicas all check a shared service for readiness, one outage drops them all at once. That is a cascading failure.

Two surprises came from the repo itself: an untracked `.mcp.json` made `verify` look complete on my machine, and the migration check passed quietly on a shallow clone. Both fail open. <!-- owner: check -->

## What I would change

I would apply the repository settings (required checks, required SHA pinning) in the step that adds the jobs, not find out at the docs step that they were never set. <!-- owner: check -->

ADR-048 puts gitleaks in two different workflows. The build follows one of them, and the next ADR that supersedes it should fix the other.

I deferred the explain-back to the R0 review, so this post comes before I have walked the whole run from memory.

**Next:** WP-7 builds the Docker images, adds release-please per service, an SBOM and Trivy, and finally the Docker build check ADR-026 wanted in CI.
