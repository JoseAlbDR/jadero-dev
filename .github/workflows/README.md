# Workflows

The CI pipeline of ADR-048 (built in WP-6, explained in `docs/learning/wp-6.md`), with the images,
releases and image scans of ADR-049, which supersedes it (built in WP-7, explained in
`docs/learning/wp-7.md`), and the deploy of ADR-049 and ADR-053 (built in WP-9, explained in
`docs/learning/wp-9.md`). Six workflows, plus Renovate (`renovate.json`) and pnpm's release cooldown (`pnpm-workspace.yaml`). This page is
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
| `nginx` | runs only when the PR changes `infra/nginx/`, `infra/scripts/nginx-check.sh`, `infra/scripts/smoke-edge.sh` or `ci.yml`; otherwise passes with nothing run | runs | runs | the nginx edge in `ubuntu:26.04` (pinned by digest) with the distro nginx: the repo's `nginx.conf`, snippets and sites installed, throwaway self-signed certificates, `nginx -t`, then `smoke-edge.sh` against it (headers, no version, no CORS, internal paths 404, TLS 1.1 refused, 1.2 and 1.3 accepted); locally `pnpm nginx:check`. Required since WP-9 step 6 |
| `backup` | runs only when the PR changes `infra/scripts/backup.sh`, `restore.sh` or `backup-check.sh`, `infra/env/backup.env.tpl`, `infra/compose/compose.ops.yml`, `infra/postgres/pg_hba.conf` or `ci.yml`; otherwise passes with nothing run | runs | runs | `infra/scripts/backup-check.sh` on the runner's Docker: the server's `backup.sh` and `restore.sh` against throwaway Postgres, RabbitMQ and Uptime Kuma containers (the images of `compose.ops.yml`) and a local restic 0.19.1 repository; every database found and saved, a failing dump saves no snapshot and sends no heartbeat, Kuma started again, the last complete night restored into a container with no network with matching row counts, no secret in the output; locally `pnpm backup:check`. Required since WP-9 step 6 |
| `backstop-issue` | skipped | skipped | schedule only, when `verify`, `integration`, `web`, `nginx` or `backup` failed | not a gate: opens or comments the issue "Weekly uncached CI run failed" |

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

Triggers: `push` to `main`, `workflow_dispatch` with a `service` input (the dry run). Not a gate.
Concurrency is per job, never cancelled in progress: `release-please` runs one at a time; `images`
legs have no group (each pushes the version its tag names, so nothing can cancel one and leave a
tag without its image); the deploy jobs use `deploy.yml`'s group. A workflow-level group would stay
held while production waits for approval and stop every later release behind it.

| Job (check name) | Runs on | Does |
|---|---|---|
| `release-please` | push to `main` | opens or updates the one Release PR from the conventional commits (components by path, `release-please-config.json`); merging it tags each released component `<component>-v<version>` and outputs the released services. Uses the job's `GITHUB_TOKEN`, so its PRs and tags start no workflow |
| `images (<service>)` | push to `main` with a released service; manual | per released service, from the commit its tag points at: build, hardened smoke run, Trivy (a secret fails; HIGH and CRITICAL OS findings are reported only), then push to GHCR (private) as `:<version>` and `:sha-<short>` with a BuildKit SBOM, check the pushed image is the scanned one and attest its SLSA build provenance (keyless, Sigstore), then upload `image-<service>` (its version and pushed digest). The manual run builds, smoke-tests and scans one service and never logs in, pushes, attests or deploys |
| `digests` | push to `main`, every `images` leg green | joins the `image-<service>` artifacts into one output, `{"api": {"version", "digest"}}`. A matrix job's outputs overwrite each other across legs, so each leg uploads its own artifact instead. If any `images` leg failed, this job and every deploy are skipped |
| `deploy-staging (<service>) / deploy <service> to staging` | after `digests` | `deploy.yml` for each released service on the `staging` environment, in the order `agent`, `api`, `web` (consumers before producers, the HTTP provider before `web`; WP-9 D6), one at a time (`max-parallel: 1`); `fail-fast` cancels the services not started yet when one fails |
| `deploy-production (<service>) / deploy <service> to production` | after every staging leg succeeded | the same services, versions and digests on the `production` environment, each waiting for the owner's approval; the server refuses an image whose digest differs, so production runs the bytes staging tested |

Verify an image from anywhere: `gh attestation verify oci://<image>:<version> --owner JoseAlbDR`.

After merging a Release PR:
1. Wait for the `release` run of that push on `main` to go green: `release-please` tags each
   component and creates its GitHub release, then one `images (<service>)` job per released service
   pushes its image. A later push's `release-please` waits while one runs; GitHub keeps one
   pending job per group and cancels the older pending one, which is harmless because the newer
   job reads all of `main` and tags every merged Release PR still marked pending.
2. Check that the GitHub releases (`gh release list`) and the packages (the repository's Packages
   tab) are there.
3. Verify the provenance of each new image with the command above. The packages are private, and
   `gh attestation verify` reads the registry with Docker's credentials, not with `gh`'s token: log
   in once with `gh auth token | docker login ghcr.io -u <user> --password-stdin` (the token needs
   the `read:packages` scope, `gh auth refresh -s read:packages`). GHCR answers "denied" both
   without that login and for an image that does not exist yet, so check step 1 first.
4. A service released for the first time creates its GHCR package with the repository's
   visibility, which is public. Set it private once (the package page, Package settings, Change
   visibility); there is no API for user packages. Later versions keep the setting.
5. Staging deploys by itself; production waits on the run page for your approval (Review
   deployments). See `deploy.yml` below.

### `deploy.yml`

Triggers: `workflow_call` from `release.yml` (inputs `environment`, `service`, `version`,
`digest`) and `workflow_dispatch` (choices `action` deploy or rollback, `environment` staging or
production, `service` agent, api or web, and a `version` for a deploy). Not a gate.

One job, named `<action> <service> to <environment>`, on the GitHub environment of that name; at
most one per environment and service at a time (`concurrency: deploy-<environment>-<service>`,
never cancelled in progress, the same group for a call and a manual dispatch). It checks every input (main only, a known environment and service, a semver version, a
`sha256:` digest from `release.yml`, no version on a rollback), joins the tailnet, and runs one SSH
command as `deploy`: `deploy <env> <service> <version>` or `rollback <env> <service>`, where
`<env>` is the server's word, `staging` or `prod`. Standard input carries the registry user (the
repository owner), the job's `GITHUB_TOKEN` (`packages: read`, valid until the job ends) and the
digest; a rollback sends nothing. It prints the server's journal lines and writes them to the job
summary, then `scripts/ci/deploy-result.mjs` (the job's only checkout, sparse, at the workflow's
commit; tested in `pnpm test:scripts`) turns the SSH exit code and the journal's last line into
the job's result.

A manual deploy has no `images` job behind it, so it resolves the tag's digest itself
(`docker buildx imagetools inspect`, the top-level index, the same kind the images job pushed and
the server reads from `RepoDigests`) and sends it only after
`gh attestation verify oci://<image>@<digest> --repo JoseAlbDR/jadero-dev --signer-workflow
JoseAlbDR/jadero-dev/.github/workflows/release.yml --source-ref refs/heads/main
--deny-self-hosted-runners` passes. A manual production deploy does not need a staging run first:
its guards are the approval, the provenance check and the server's anti-rollback rule. A manual
rollback goes back to the release the server recorded as previous, once.

Concurrency, as GitHub runs it: a group holds one running and one pending job, and a newly queued
job cancels the pending one, whatever its version: the job that queued later wins, not the higher
version. Each matrix leg's group takes its own service (the caller passes `matrix.service` as the
`service` input), so a pending deploy is only replaced by another deploy of the same service in the
same environment. Within one run the legs wait on `max-parallel`, so the order `agent`, `api`, `web`
holds per run, not across two runs: release N+1's `api` leg can run before release N's. N's then
reaches a server that already runs N+1 and is refused as `not-newer`; on a call from `release.yml`
the job maps that one refusal (the exact journal line, `refused reason=not-newer` for this
environment, service and version) to a notice and ends green, since a newer version already runs
there and nothing is needed, so `fail-fast` does not cancel N's later services or its production.
A leg that was replaced while pending shows as cancelled, and `fail-fast` then skips that run's
later services and its production: deploy those by hand if no newer release carries them.
Approve production runs in release order, oldest first. Before a manual rollback of a service,
reject any production approval still waiting for it: a waiting approval holds the group, so the
rollback would wait behind it instead of running.
The residual case: two releases deploying different services to one environment at the same time
(two approved production runs, or a manual dispatch during a release) meet on the server's lock.
The second gets exit 75, *busy*, with nothing touched: rerun the failed job once the first ends.

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
`verify`, `integration`, `web`, `workflows-lint`, `pr-title`, `osv-scanner / osv-scan`, `dependency-review`, `secrets`, `images`, `nginx`, `backup`.
All eleven match the `name:` of their job in the files above. `images` joined the list after it had
reported on `main` (expand, see the last section); `nginx` and `backup` joined in WP-9 step 6, both
report on every pull request (they pass with nothing run when their paths are untouched).

## Security model

- Only `pull_request`, never `pull_request_target`: a PR's code runs with a read-only token and no
  secrets, and a fork PR gets even less (its SARIF upload is skipped for that reason).
- `permissions: {}` at the top of every workflow; each job grants only what it needs, almost
  always `contents: read`. The write grants are `security-events: write` for SARIF uploads,
  `id-token: write` for Scorecard, `issues: write` for `backstop-issue` and `image-scan`, which
  run no repository code, and in `release.yml`, which runs only on `main`: `contents`,
  `pull-requests` and `issues: write` for `release-please`, `packages`, `id-token`,
  `attestations` and `artifact-metadata: write` for `images`. The deploy jobs read only:
  `contents`, `packages` and `attestations: read`, plus `id-token: write` for Tailscale.
- Deploys (WP-9 D2): the runner joins the tailnet as an ephemeral `tag:ci` node through workload
  identity federation (GitHub's OIDC token, subject
  `repo:JoseAlbDR@128265706/jadero-dev@1402255543:environment:<name>`, the immutable form with the
  owner and repository IDs, trusted only for the exact names `staging` and `production`, one federated identity each; no
  Tailscale secret is stored), and the tailnet policy lets `tag:ci` reach the server's SSH port
  only. Each environment holds its own `DEPLOY_SSH_KEY`, and the server's key line forces
  `deploy-entry staging` or `deploy-entry prod`, so the staging key never reaches production.
  Production's key is readable only after your approval. The host key is pinned
  (`StrictHostKeyChecking=yes`, `BatchMode=yes`, `IdentitiesOnly=yes`), the key lives in
  `$RUNNER_TEMP` with mode 600 until the step ends, and the registry token goes on standard input,
  never in the command line, which the server logs. The Tailscale tarball is checked against a
  pinned checksum and the actions cache stays off for it (a cache hit skips the check). The
  server's output is printed with workflow commands stopped, so nothing it prints can act on the
  job.
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

**A deploy red.** The job's last lines are the server's journal, one line per state
(`<time> <env> <service> <version> <state> reason=<token>`), and an error line that names the case:
- *busy* (exit 75): another deploy holds the environment's lock; nothing was touched. Rerun the job
  once the other one ends.
- *refused* (exit 1, journal `refused`, or a message from `deploy-entry` with no journal line): the
  words, the input or the state said no (`not-newer`, `env-mismatch`, `no-digest`, ...); nothing
  was touched. Fix the cause; a downgrade is a rollback, never a deploy. The one exception is green:
  a call from `release.yml` refused as `not-newer` ends with a notice, because a later release
  already deployed that service (see Concurrency under `deploy.yml`).
- *aborted* with a `-timeout` reason (`fetch-timeout`, `render-timeout`, `login-timeout`,
  `pull-timeout`): that step hit its time limit in `deploy.sh` before the point of no return;
  nothing shared changed. *rolling_back* `migrate-timeout`: the migration hit its limit (Postgres
  also cancels a statement after 60 s or a lock wait after 10 s); the previous release starts again.
  Look for a long transaction on that database before a rerun.
- *SSH port did not answer* (no journal line): the runner joined the tailnet but the server's SSH
  port never answered within about a minute; nothing ran on the server. Check the Tailscale grant
  for `tag:ci` and that the server is up, then rerun.
- *aborted* (exit 1): it failed before the point of no return (`op` down, pull or digest mismatch,
  missing release files); the running release never noticed. Rerun when the cause is gone.
- *rolled_back* (exit 1): the new release failed after the point of no return (migrate, health,
  smoke) and the previous one is healthy again. Fix forward with a new release; the same version
  can be retried, since a failed deploy never becomes current.
- *failed* (exit 1): the rollback did not get healthy either. Leave it to the owner on the server:
  read `/srv/jadero/<env>/deploy.log` and the containers' logs. No retry loop runs.
- *SSH failed* (exit 255): with no journal line, the tailnet, host key or key line refused the
  connection. With journal lines, the session dropped mid-deploy: the server ignores the hangup and
  runs to its end state, so read its journal before a rerun.

**`release` red.** A failed `images (<service>)` after the Release PR merged leaves the tag and
the GitHub release without an image. Fix the cause and rerun the failed job; the dry run
(`workflow_dispatch`, one service) reproduces the build, smoke run and scan without pushing.

**A Release PR whose checks never start.** release-please opens it with the job's `GITHUB_TOKEN`,
and events made with that token start no workflow on their own: the PR's runs wait for approval.
Approve the pending workflow runs on the PR (its Checks tab, or the run page). If the PR shows no
approval prompt at all, follow ADR-049's fallback: a GitHub App installed on this repository only
replaces the token in the `release-please` job. Never a classic token.

**`nginx` red.** Run `pnpm nginx:check` (Docker): the log shows `nginx -t`'s error with the file
and line, or the `FAIL` lines of `smoke-edge.sh`. A failure on the weekly run with no change in the
repo means the distro's nginx or OpenSSL package changed; the server gets the same package with its
next upgrade, so fix the config before that. `scripts/nginx-hardening.test.mjs` (in `verify`) holds
the static rules (headers, log privacy, deny by default, rate and body limits).

**`backup` red.** Run `pnpm backup:check` (Docker): each `FAIL` line names the promise that broke,
and the lines marked `|` above it are the scripts' own output. A failure on the weekly run with no
change in the repo means an image or a tool changed under the check (the Alpine packages of the
runner); the server's scripts may break the same way on the next install, so fix them before
installing. `scripts/backup-scripts.test.mjs` (in `verify`) holds the static rules (the restore
image equals the ops Postgres, the container names, the checkpoint tables, the env template).

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

## Owner setup for the deploy (WP-9 step 5)

Agents never change these settings; each item is yours.
1. **Environments** (Settings, Environments): `staging` with deployment branches "main" only and
   no reviewer; `production` with deployment branches "main" only and you as required reviewer.
   Keep **"Prevent self-reviews" off** on `production`: you merge the Release PR and are the only
   reviewer, so with it on nobody could approve.
2. **Keys**: two new ed25519 keys on your machine
   (`ssh-keygen -t ed25519 -N '' -C jadero-deploy-staging`, and `-prod`). The private half goes
   only into the environment secret `DEPLOY_SSH_KEY` of `staging` and of `production`, then delete
   it locally. The public halves go into `/home/deploy/.ssh/authorized_keys` as the two lines of
   `docs/runbooks/server-access.md` section 8 (`deploy-entry staging`, `deploy-entry prod`), and the
   WP-8 test key line is removed. The same visit installs the release's `deploy-entry` and
   `deploy.sh` into `/srv/jadero/bin/` (section 8, "Set it up"; check both with `sha256sum`
   against the repo), and the `new.jadero.dev` site with its `www/maintenance/` files
   (`infra/nginx/README.md`, "Install on the server"): the scripts never update themselves.
3. **Server secrets** (environment secrets in both `staging` and `production`, not variables: a
   variable's value is printed in the public log): `DEPLOY_HOST` (the server's full MagicDNS name, `<machine>.<tailnet>.ts.net`: the
   short name an SSH profile uses may not resolve on the runner),
   `DEPLOY_SSH_PORT`, `DEPLOY_KNOWN_HOSTS` (the output of
   `ssh-keyscan -p <ssh-port> -t ed25519 <tailnet-host>` run over the tailnet, checked against
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server; several lines are fine, the
   job writes the secret whole to a file and never prints it). **Variables** (per environment):
   `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE` (from that environment's federated identity below;
   identifiers, not secrets).
4. **Tailscale**: `tag:ci` in `tagOwners` and a grant from `tag:ci` to `tag:server` on
   `tcp:<ssh-port>` only, with a test that accepts that port and denies another
   (`docs/runbooks/server-access.md` section 1a). Two federated identities for GitHub Actions,
   one per environment, each with issuer `https://token.actions.githubusercontent.com`, tag
   `tag:ci` and the scope to create auth keys, and each with one exact subject:
   `repo:JoseAlbDR@128265706/jadero-dev@1402255543:environment:staging` and
   `repo:JoseAlbDR@128265706/jadero-dev@1402255543:environment:production`. The repository uses
   GitHub's immutable subject (`gh api repos/JoseAlbDR/jadero-dev/actions/oidc/customization/sub`
   shows `use_immutable_subject: true` and the prefix), so the subject carries the owner and
   repository IDs: a repository deleted and re-created under the same name gets new IDs and no
   access. A subject in the old `repo:JoseAlbDR/jadero-dev:...` form fails the exchange with 403
   "Unauthorized" (WP-9 step 6b). Never a wildcard like `environment:*`:
   GitHub creates an unprotected environment for any name a workflow on any branch names, so a
   wildcard would let any branch mint a `tag:ci` node. Each identity has its own client ID and
   audience: set `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE` as **environment variables** of `staging`
   and of `production` (an environment variable wins over a repository one of the same name, so
   remove any repository-level pair). If your plan does not offer federation, an OAuth client with
   the same tag is the fallback (its secret in an environment secret, and `deploy.yml` then passes
   it as `oauth-secret`: a change to review, not a setting).
5. **Tag ruleset** (ADR-053): release tags `*-v*` cannot be updated or deleted. Leave creation
   allowed: release-please creates them with the job's token.
6. **Required checks**: add `nginx` and `backup` to `protect-main`, then update the table and the
   list under "Required checks" above.

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
