---
id: ADR-048
title: "CI pipeline and supply chain"
status: accepted
date: 2026-10-11
deciders: [owner]
decisions: [D-29, D-32, D-78]
supersedes: [ADR-026]
superseded_by: null
source: docs/learning/wp-6.md (Decision)
---

# ADR-048: CI pipeline and supply chain

**Status:** Accepted (owner, WP-6, 2026-10-11). Supersedes ADR-026 as a whole. It changes the CI and security workflows (integration tests on Testcontainers instead of service containers, how affected runs are made safe and backed up, `security.yml` on every pull request with OSV-Scanner, CodeQL default setup) and adds a supply chain section from the 2026-10-09 audit and the owner's answers in WP-6. The per-service pipeline, repository visibility (now resolved: public), `release.yml`, `deploy.yml`, images, deploy mechanics (option B with the forced command), the deploy script steps and downtime are restated from ADR-026 unchanged.

## Context

ADR-026 described every workflow before any existed. WP-6 builds `ci.yml` and the security workflows and found five things the ADR did not foresee:

1. The integration tests start their own Postgres and RabbitMQ through Testcontainers (`packages/testing`, WP-12 step 1). ADR-026's workflow service containers would duplicate them and need a CI-only code path in the harness. The owner decided Testcontainers during WP-12 (issue #14, 2026-10-10).
2. `turbo run ... --affected` is safe only when every file a task reads is known to Turborepo. Dry runs in a scratch clone showed two gaps: the root tasks (`//#lint`, `//#depcruise`) were not selected when a pull request touched only package files, so Biome and dependency-cruiser would not run in CI; and tests that read `infra/compose/` (outside any package) were not selected when only those files changed, while their cache entries stayed valid. `scripts/check-migrations.mjs` passed silently when `origin/main` was missing, which is what a default checkout gives.
3. ADR-026 runs `security.yml` "on PRs touching lockfiles or Dockerfiles". A required status check whose workflow is skipped by a path filter stays "Pending" and blocks the merge, so a required workflow cannot be path-filtered.
4. ADR-026 left "OSV-Scanner or `pnpm audit`" open. A full-state scan (`pnpm audit`) turns every open pull request red when an advisory is published for a dependency nobody touched; a diff scan blocks only what a pull request brings in.
5. The repo is public (D-29 resolved). GitHub gives public repos secret scanning, push protection, Dependabot alerts, the dependency review action, private vulnerability reporting and CodeQL at no cost; some were already on, CodeQL default setup was configured with no languages, and Dependabot security updates would duplicate Renovate. The 2026-10-09 audit also asked for actions pinned by commit SHA, least-privilege `permissions:`, Renovate with grouped updates and a release-age cooldown. None of that had an ADR.

## Considered options

Integration tests in CI:
- *A. Workflow service containers (ADR-026).* Pros: GitHub starts and health-checks them; tests connect to `localhost`. Cons: duplicates the containers the harness already starts; a CI-only branch in the global setup; one long-lived server shared by the job instead of one per run.
- *B. Testcontainers on the runner's Docker.* Pros: the same harness and isolation (a database and role per test file) locally and in CI; GitHub-hosted Ubuntu runners have Docker. Cons: each run pays container start-up; needs a runner with Docker.

Free GitHub features beyond ADR-026 (D-78, question 1):
- *A. Everything:* keep secret scanning, push protection, Dependabot alerts and private vulnerability reporting; add the dependency review action, OpenSSF Scorecard with a public badge, `SECURITY.md`, CodeQL default setup fixed, the "require SHA pinning" setting; turn Dependabot security updates off. Pros: most coverage and visible evidence for a portfolio repo. Cons: overlapping tools need tuning so one problem does not fail two checks; Scorecard's Code-Review stays low with one reviewer.
- *B. Native core without duplicates:* A, with dependency review for licenses only or dropped and Scorecard unpublished. Pros: one tool per job. Cons: less visible evidence.
- *C. Minimal:* what was already on, security updates off, CodeQL fixed, `SECURITY.md`. Pros: least to maintain. Cons: a thin Security tab for a portfolio repo.

Vulnerability gate on pull requests (question 2):
- *A. OSV-Scanner.* Pros: its PR workflow fails only on vulnerabilities the pull request introduces; a scheduled full scan reports to the Security tab; open database that includes GitHub's advisories; the same tool runs locally. Cons: its job needs `security-events: write`.
- *B. `pnpm audit`.* Pros: no new tool. Cons: full scan only, so a new advisory blocks unrelated pull requests until someone updates the dependency.
- *C. Dependency review action only.* Pros: native diff gate plus licenses, `contents: read`. Cons: no local equivalent and no scheduled full scan of its own.

Backstop for affected runs (question 3):
- *A. A full run with the cache on every push to `main`.* Pros: catches selection mistakes within minutes and refreshes the cache pull requests read. Cons: a task with an undeclared input keeps an unchanged hash, so the cache replays its old result.
- *B. A plus a scheduled uncached full run (`--force`) on `main`.* Pros: also catches undeclared inputs within the period. Cons: one long run per period.
- *C. Full runs with the cache on every pull request.* Pros: simplest rule. Cons: the same blind spot as A, slower pull requests.
- *D. Full uncached runs on every pull request.* Pros: catches everything before merge. Cons: every pull request pays the full build and test time.

## Decision

Integration tests: option B, Testcontainers. Free GitHub features: option A. Vulnerability gate: option A, OSV-Scanner. Backstop: option B, weekly. Every part of ADR-026 not named below is restated unchanged.

**Per-service pipeline (unchanged from ADR-026).** CI builds, tests and image-builds only the services Turborepo marks as affected; `release.yml` builds images only for the services release-please just tagged; `deploy.yml` becomes `deploy(env, service, version)`; the deploy script runs that service's own migrations against its own database, updates its line in `versions.env`, recreates only that service and its process types (`docker compose up -d agent agent-ingest`), checks its `/health/ready`, and rolls back only that service on failure. Message-schema rollout order: deploy consumers that accept the new schema first, producers that emit it second (expand/contract). The RabbitMQ topology is deployed from `definitions.json` by an `infra` deploy job before any service that needs a new queue.

**Repository visibility (resolved).** The repository is public (D-29 option a). Environments, environment secrets and required reviewers are available on GitHub Free for public repositories, and so are CodeQL, secret scanning and the dependency review action.

**Workflows.**
- `ci.yml` on every pull request and on every push to `main`: pnpm install with the store cache; `turbo run lint depcruise typecheck test --affected` against the pull request's base commit (full history checkout, `TURBO_SCM_BASE` set to the payload's `pull_request.base.sha`), with task-level affected detection (`futureFlags.affectedUsingTaskInputs`) and every file a task reads outside its package declared in its `inputs` (for example `$TURBO_ROOT$/infra/compose/**`), checked by a test; `check:migrations` fails when it runs in CI without the base branch; integration and end-to-end tests on Testcontainers through `packages/testing`, on the runner's Docker; event contract tests (fixtures, frozen schemas, consumer-side fixture parsing); coverage gates per package and layer (ADR-009); Playwright smoke and axe against the built web app with fake AI providers, when `web` is affected; dependency-cruiser; the i18n key check; gitleaks over the pull request's commits; Docker build without push (validates Dockerfiles), arriving with WP-7. On `main` the run is full (`pnpm verify:all` and every integration suite) with the cache, and it is the only run that saves the caches; pull requests restore them.
- Backstop: a weekly scheduled run on `main` repeats the full run without the cache (`--force`), unit and integration; a failed scheduled run opens an issue.
- `pr-title.yml` on pull requests (opened, edited, synchronize, reopened): the repo's commitlint config on the title (ADR-024, ADR-025).
- `security.yml` on every pull request and weekly: OSV-Scanner's pull request workflow fails on vulnerabilities the pull request introduces, and its weekly full scan reports to the Security tab; the dependency review action checks licenses only (license check on, AGPL and GPL denied, vulnerability check off because OSV-Scanner gates vulnerabilities); gitleaks over the full history; Trivy on built images, arriving with WP-7. CodeQL runs as GitHub's default setup for JavaScript/TypeScript and GitHub Actions, with no workflow file.
- `scorecard.yml` on push to `main` and weekly: OpenSSF Scorecard with `publish_results` and the public badge in the README, next to a note that Code-Review scores low because the owner is the only reviewer.
- `evals.yml` (ADR-019): path-filtered on PRs, nightly on `main`, budget-capped key. It is not a required check.
- `release.yml` on `main` (unchanged): release-please; for each service released, build its amd64 image (one image per service; process types and the migrate step are commands of that image), push to GHCR (`ghcr.io/josealbdr/jadero-dev-agent:1.3.0` plus `:sha-<short>`), generate an SBOM, then deploy that service to staging.
- `deploy.yml` (unchanged): reusable workflow `deploy(env, service, version)`; staging automatic after release, production by environment approval (public repo) or `workflow_dispatch` by the owner. The `admin` SPA deploys by copying its built files to the nginx root.

**Supply chain and repository settings (new).**
- Workflows run on `pull_request`, never `pull_request_target`. Every workflow starts with `permissions: {}`; each job lists only what it needs (`contents: read`; `security-events: write` only where results are uploaded; `id-token: write` only in Scorecard's publishing job). Untrusted event text (a PR title) reaches a shell only through an environment variable. `actions/checkout` runs with `persist-credentials: false`.
- Every action is pinned by the full commit SHA a release tag of its real repository points at, with the version as a comment, and the repository setting that requires SHA pinning is on. Tools run as containers are pinned by digest.
- Renovate (the hosted app) updates npm packages, pnpm catalogs and action SHAs: `config:best-practices`, a three-day `minimumReleaseAge` with `internalChecksFilter: strict`, grouped updates (majors alone), a weekly schedule, the dependency dashboard, no automerge. pnpm's `minimumReleaseAge` is set explicitly in `pnpm-workspace.yaml` (4320 minutes), which makes it strict.
- GitHub features: secret scanning and push protection on; Dependabot alerts on (Renovate reads them for fix PRs); Dependabot security updates off; private vulnerability reporting on, with a `SECURITY.md`; CodeQL default setup re-enabled.
- The `protect-main` ruleset requires the status checks of `ci.yml`, `pr-title.yml`, `security.yml` (OSV-Scanner and dependency review) in loose mode, and allows squash merges only. A required workflow never uses a path filter: work that applies to some changes only is skipped inside the job, which reports success.

**Images (unchanged).** Multi-stage Dockerfiles, `pnpm deploy --prod` (or `turbo prune`) for minimal contexts, Next `output: "standalone"`, non-root user, read-only root filesystem where possible, `HEALTHCHECK`.

**Deploy mechanics (unchanged).** Option B: SSH over Tailscale. The workflow joins the owner's tailnet as an ephemeral node (Tailscale GitHub Action) and SSHes to the server's tailnet address; port 22 is closed publicly in the Hetzner Cloud Firewall. The deploy key uses an SSH forced command (`command="/srv/jadero/bin/deploy.sh"` in `authorized_keys`), so the key can only run the deploy script with a validated environment and version, not a shell. The `deploy` user is not in the `docker` group (that group is root-equivalent); the forced command runs `sudo` on that one script only. Discarded, as in ADR-026: A, SSH from GitHub Actions to a public port 22 (port open to the world because runner IPs change); C, pull-based redeploys (weaker control over migrations and rollbacks).

**Deploy script steps (unchanged).** Log in to GHCR with a read-only token, pull the version, run the `migrate` container (expand-only migrations; contract migrations ship in a later release), `docker compose up -d` with healthchecks, smoke test (`/api/health`, home page per locale), on failure re-pin the previous version and alert. Migrations are written backward-compatible so a rollback never needs a down migration.

**Downtime (unchanged).** Seconds during container restart are acceptable for v1; nginx serves a static maintenance page on 502. Blue-green with two upstreams is an optional later WP-33.

Why: Testcontainers keeps one harness and per-file isolation everywhere, and service containers would only win on a runner without Docker. Option A of the GitHub features fits a portfolio repo, where the Security tab is part of the evidence, and most of it was already on; the dependency review action keeps only its license check so one advisory does not fail two checks. OSV-Scanner blocks a pull request only for what it brings in and runs locally; `pnpm audit` stays a local command. The weekly uncached run is the only check that catches an undeclared task input, and the cached run on every push to `main` catches selection mistakes within minutes at almost no cost.

## Consequences

- WP-6 builds `ci.yml`, `pr-title.yml`, `security.yml`, `scorecard.yml`, `renovate.json`, `SECURITY.md`, the `turbo.json` flag and declared inputs, the coverage gates and the `check:migrations` change. WP-7 owns the Docker build check, Trivy, the images, the SBOM and `release.yml`; WP-9 owns `deploy.yml`; WP-24 owns `evals.yml`.
- Manual GitHub settings the owner makes (M-13): required status checks and squash-only merges on `protect-main`; "require actions pinned to a full-length commit SHA" on; Dependabot security updates off (alerts stay on); CodeQL default setup re-enabled for JavaScript/TypeScript and GitHub Actions; the Renovate app installed on this repository only, with read access to Dependabot alerts.
- A new file read outside a package must be declared in the reading task's `inputs`, or its test fails; adding a dependency published less than three days ago needs a justified `minimumReleaseAgeExclude` entry.
- Renovate's cooldown does not protect against a moved action tag (digest updates age against the tag's original date), so an action digest update without a version change is reviewed as a warning sign.
- Verify at WP time: pnpm's non-strict behavior for an exact pin that is too new, with a real install; whether Renovate's vulnerability-fix pull requests respect the cooldown; the dependency review action on a real `pnpm-lock.yaml` change; the hosted Renovate app's terms for public repositories; whether secret scanning's non-provider patterns and validity checks are available on this free public repository.

## Pattern names

Least privilege, trust boundary, immutable reference (pin by content hash), untrusted input handling, incremental (affected) build, content-addressed memoization, declared inputs (hermeticity), fail safe versus fail open, backstop, single trusted writer, cache poisoning, environment parity, quality gate, contract test, secret scanning, shift left, cooldown (quarantine period), batching, diff-based gate versus full-state gate, defense in depth, required check, coordinated disclosure.
