# Workflows

The CI pipeline of ADR-048 (built in WP-6, explained in `docs/learning/wp-6.md`), with the images,
releases and image scans of ADR-049, which supersedes it (built in WP-7, explained in
`docs/learning/wp-7.md`). Five workflows, plus Renovate (`renovate.json`) and pnpm's release cooldown (`pnpm-workspace.yaml`). This page is
the map and the runbook; the comments in each file carry the detail.

## What runs where

### `ci.yml`

Triggers: every `pull_request`, `push` to `main`, weekly schedule (Monday 05:17 UTC),
`workflow_dispatch`. A new push to a PR cancels its outdated run; nothing on `main` is cancelled.

| Job (check name) | Pull request | Push to `main` | Weekly and manual | Gates |
|---|---|---|---|---|
| `verify` | `pnpm verify` on the affected tasks (`TURBO_SCM_BASE` = PR base) | `pnpm verify:all` with the cache, then saves the caches | `pnpm verify:all` with `TURBO_FORCE` (no Turborepo cache) | lint, depcruise, typecheck, unit tests with coverage gates, script tests, `check:migrations`; prints a coverage table per package |
| `integration` | `turbo run test:int --affected` | `pnpm test:int` | `pnpm test:int`, forced | `*.int.test.ts` on the runner's Docker through Testcontainers |
| `web` | `turbo run test:e2e --affected` (runs nothing when `web` is not affected) | `pnpm test:e2e` | `pnpm test:e2e`, forced | standalone build of `apps/web`, Playwright smoke, SEO, enforced CSP and axe per locale; uploads `playwright-results` on failure |
| `images` | Docker build of the affected services (`image` task of `turbo.json`, `--affected`) | all three | all three | per service: amd64 build loaded into the runner, never pushed; smoke run (not root, `api` and `agent` stop on the config error naming `DATABASE_URL`, `web` reaches `healthy`); Trivy: a secret always fails, a fixable HIGH or CRITICAL OS finding fails only a PR that changes the image inputs (Dockerfile, `.dockerignore`, `.trivyignore.yaml`), otherwise it is reported in the job summary |
| `workflows-lint` | zizmor, offline | same | same | the workflows themselves (injection, permissions, credentials, triggers); locally `pnpm lint:workflows` |
| `backstop-issue` | skipped | skipped | schedule only, when `verify`, `integration` or `web` failed | not a gate: opens or comments the issue "Weekly uncached CI run failed" |

### `security.yml`

Triggers: every `pull_request`, `push` to `main`, weekly schedule (Monday 05:41 UTC),
`workflow_dispatch`. No `paths:` filter on purpose (see the last section).

| Job (check name) | Runs on | Gates |
|---|---|---|
| `osv-scanner / osv-scan` | pull requests | OSV-Scanner diff gate: scans the lockfiles at the base and at the merge commit and fails only on vulnerabilities the PR introduces, or when a scan does not complete. Uploads SARIF to the Security tab (skipped on fork PRs) |
| `osv-scanner-full / osv-scan` | push to `main`, weekly, manual | full scan of every lockfile against today's advisories. Does not fail on a finding (`fail-on-vuln: false`): findings land as alerts in the Security tab |
| `dependency-review` | pull requests | licenses of added or changed dependencies; AGPL and GPL denied, LGPL and permissive pass. Vulnerability check off (OSV-Scanner owns it) |
| `secrets` | every event | gitleaks over the PR's commits (base to head) on a PR, over the full history otherwise; locally `pnpm scan:secrets` |
| `released-images`, `image-scan (<service>)` | weekly, manual | not a gate: pulls each released image (`.release-please-manifest.json`, version above 0.0.0) from GHCR and scans it with Trivy, OS and npm, all severities, into the Security tab (category `trivy-image-<service>`); on a fixable CRITICAL opens the issue "Weekly image scan: fixable CRITICAL in <service>", or comments on the open one; on a clean scan closes the open one. Skipped while nothing is released; a failed pull fails it |

The reusable workflow's check is named `<caller job> / <called job>`, so the PR gate shows as
`osv-scanner / osv-scan`. The PR also shows a separate check named plain `osv-scanner` from
GitHub Advanced Security: that is the code scanning result of the uploaded SARIF, not the gate.

### `release.yml`

Triggers: `push` to `main`, `workflow_dispatch` with a `service` input (the dry run). One run at a
time, never cancelled: a tag without its image is worse than a queued run. Not a gate.

| Job (check name) | Runs on | Does |
|---|---|---|
| `release-please` | push to `main` | opens or updates the one Release PR from the conventional commits (components by path, `release-please-config.json`); merging it tags each released component `<component>-v<version>` and outputs the released services. Uses the job's `GITHUB_TOKEN`, so its PRs and tags start no workflow |
| `images (<service>)` | push to `main` with a released service; manual | per released service: build, hardened smoke run, Trivy (a secret fails; HIGH and CRITICAL OS findings are reported only), then push to GHCR (private) as `:<version>` and `:sha-<short>` with a BuildKit SBOM, check the pushed image is the scanned one and attest its SLSA build provenance (keyless, Sigstore). The manual run builds, smoke-tests and scans one service and never logs in, pushes or attests |

Verify an image from anywhere: `gh attestation verify oci://<image>:<version> --owner JoseAlbDR`.

### `pr-title.yml`

Triggers: `pull_request` of types `opened`, `edited`, `synchronize`, `reopened` (`edited` fires
when the title is fixed).

| Job (check name) | Gates |
|---|---|
| `pr-title` | the PR title against `commitlint.config.mjs`. The squash merge uses the title as the commit on `main`, and release-please reads it |

### `scorecard.yml`

Triggers: `push` to `main`, weekly schedule (Tuesday 04:37 UTC), `workflow_dispatch`. Job
`analysis` (check name `scorecard`) runs OpenSSF Scorecard, uploads SARIF to the Security tab and
publishes the result for the README badge. Not a gate. Code-Review stays low while one person
writes and merges every change.

### Required checks

The `protect-main` ruleset requires exactly these names (the owner sets them, ADR-048):
`verify`, `integration`, `web`, `workflows-lint`, `pr-title`, `osv-scanner / osv-scan`, `dependency-review`, `secrets`.
All eight match the `name:` of their job in the files above. The `images` check of `ci.yml` joins
the list only after it has reported on `main` (expand, see the last section).

## Security model

- Only `pull_request`, never `pull_request_target`: a PR's code runs with a read-only token and no
  secrets, and a fork PR gets even less (its SARIF upload is skipped for that reason).
- `permissions: {}` at the top of every workflow; each job grants only what it needs, almost
  always `contents: read`. The write grants are `security-events: write` for SARIF uploads,
  `id-token: write` for Scorecard, `issues: write` for `backstop-issue` and `image-scan`, which
  run no repository code, and in `release.yml`, which runs only on `main`: `contents`,
  `pull-requests` and `issues: write` for `release-please`, `packages`, `id-token`,
  `attestations` and `artifact-metadata: write` for `images`.
- Every action is pinned by commit SHA with the version in a comment; container images (zizmor,
  gitleaks, Trivy) by digest. The repository setting that requires actions pinned to a full-length
  commit SHA (one of the owner's manual settings in ADR-048) makes an unpinned action fail.
- Checkouts use `persist-credentials: false`. Untrusted text (the PR title, SHAs, URLs) reaches
  the shell as an environment variable, never pasted into the script.
- Caches are restored on every run but saved only on a push to `main`, so a PR can never write a
  cache entry that `main` later reads.

## Runbook

**`verify` red.** Reproduce with `pnpm verify` locally (the `pre-push` hook already runs it); for
a run on `main` or the weekly run, `pnpm verify:all`. The coverage table on the run page shows
which package missed its threshold. Lint alone is `pnpm lint:check`, never `pnpm lint`: under
pnpm 11 that name runs a pnpm built-in instead of the script, so it checks nothing.

**`images` red.** The log names the service and the step. Build: `pnpm images:build` (one image
at a time locally). Smoke: `pnpm images:up` runs every process type hardened. Trivy: a secret, or
a fixable HIGH or CRITICAL OS finding in a PR that changes the image inputs; fix it with a base
digest update, or mute it in `.trivyignore.yaml` with a statement and an `expired_at` date.

**`release` red.** A failed `images (<service>)` after the Release PR merged leaves the tag and
the GitHub release without an image. Fix the cause and rerun the failed job; the dry run
(`workflow_dispatch`, one service) reproduces the build, smoke run and scan without pushing.

**`integration` red.** Run `pnpm test:int` with Docker up; one package with
`pnpm --filter @jadero/<pkg> test:int`. Ryuk removes the containers even when a run crashes.

**`web` red.** Run `pnpm test:e2e` (needs Google Chrome). Download the `playwright-results`
artifact from the run and open a trace with `pnpm exec playwright show-trace <file>`.

**`osv-scanner / osv-scan` red.** The PR adds a dependency version with a known vulnerability.
First choice: upgrade to a fixed version (an override in `pnpm-workspace.yaml` for a transitive
one). If it cannot be fixed now, add an entry to `osv-scanner.toml` at the repo root
(`[[IgnoredVulns]]` with `id`, `ignoreUntil` and `reason`): always a reason and an expiry date.
This gate only sees what the PR changes; an advisory published for a dependency already on `main`
shows up in the weekly full scan, as an alert in the Security tab, and Renovate opens the fix PR.

**`dependency-review` red.** A new or changed dependency carries a denied license (AGPL or GPL).
Pick another package; never widen the deny list to make it pass without a decision.

**`secrets` red.** gitleaks found something in the PR's commits; the log is redacted. If it is a
real key, rotate it first: once pushed, it is public, and deleting or ignoring it does not undo
that. Then remove it from the history. Only a reviewed false positive goes in `.gitleaksignore`,
by fingerprint (`commit:file:rule:line`) with a comment saying why it is not a secret.

**`pr-title` red.** Edit the title on GitHub to a conventional commit (`feat(api): ...`); the
`edited` event reruns the check. No new commit is needed.

**Issue "Weekly uncached CI run failed".** A task passed on PRs from the cache or the affected
selection but failed when run from scratch. Usual cause: a test reads a file its task's inputs do
not declare, so changing that file selected nothing and replayed a cached green. Fix it by
declaring the file in the task's `inputs` in `turbo.json` (or the package's `turbo.json`); a flaky
test is the other cause. Close the issue when `main` is green again; a new failure meanwhile adds
a comment to the same issue.

**Issue "Weekly image scan: fixable CRITICAL in <service>".** A released image carries a CRITICAL
advisory with a fix available, published after the image was scanned at release. The issue lists
the advisories, packages, installed and fixed versions and the image tag. Usual fix: the base
digest or dependency update from Renovate, then a release of the service. Lifecycle: opened by the
first scan that finds one, commented on weekly while it stands, closed with a "Clean in `<image>`"
comment by the first clean scan; closed by hand while it stands, a new issue opens the next week,
so mute an accepted finding in `.trivyignore.yaml` with a reason instead. The full list, every
severity, is in the Security tab.

**A Trivy secret table in the log.** The image scans of `ci.yml` and `release.yml` print the secret
table only when it holds a finding (with nothing found it is about 1,300 lines, one per file). A
table in the log means a secret in the image: treat it as the `secrets` runbook says.

**Renovate dashboard.** Renovate opens grouped updates weekly, three days after release
(`minimumReleaseAge: "3 days"`), never automerged. Container images from GHCR have no release
dates, so their updates wait on the dashboard issue until you tick their box. An action digest
update with no version change means a moved tag: review it as a warning sign. pnpm enforces its
own cooldown (`minimumReleaseAge: 4320` minutes in `pnpm-workspace.yaml`), so an install of a
version younger than three days fails in CI. For an urgent fix, add the exact version under
`minimumReleaseAgeExclude` with a comment (advisory or bug, date, when to drop it), and remove
the entry once the version is three days old.

## Adding or renaming a required check

- A required check must report on every PR. A workflow-level `paths:` filter skips the whole
  workflow, so the check never reports and stays "Pending" forever, blocking the merge. To skip
  work that does not apply, use a job-level `if:` (GitHub reports a skipped job as success) or
  let the job run and do nothing, as `web` does through `--affected`.
- The ruleset matches the check name exactly: the job's `name:`, or `<caller> / <called>` for a
  reusable workflow. Renaming a job silently turns its required check into one that never
  reports.
- The owner edits the `protect-main` ruleset in the repository settings (Rules, Rulesets).
  Every name in the ruleset is required on every PR (an AND), and a required name that nothing
  reports stays waiting, it never fails. So rename by expand/contract, never by listing both
  names: the rename PR adds the new job and keeps a thin job with the old `name:` that
  `needs:` the new one; once every open PR reports both names (rebase or merge `main` into
  them), swap the name in the ruleset; then a later PR removes the thin job.
