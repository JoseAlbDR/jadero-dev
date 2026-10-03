---
id: ADR-026
title: "Pipeline, environments, images and deploy"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-29, D-32]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-026: Pipeline, environments, images and deploy (amended 2026-10-02; reframed 2026-10-03)")
---

# ADR-026: Pipeline, environments, images and deploy

**Status:** Accepted (owner review 2026-10-03, D-29 and D-32).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-29, D-32). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Per-service pipeline (new 2026-10-02)

CI builds, tests and image-builds only the services Turborepo marks as affected; `release.yml` builds images only for the services release-please just tagged; `deploy.yml` becomes `deploy(env, service, version)`; the deploy script runs that service's own migrations against its own database, updates its line in `versions.env`, recreates only that service and its process types (`docker compose up -d agent agent-ingest`), checks its `/health/ready`, and rolls back only that service on failure. Message-schema rollout order: deploy consumers that accept the new schema first, producers that emit it second (expand/contract). The RabbitMQ topology is deployed from `definitions.json` by an `infra` deploy job before any service that needs a new queue.

## Repo visibility (decide first)

on GitHub Free, environments, environment secrets and required reviewers are available only for public repositories; private repos need a paid plan (required reviewers for private repos need Enterprise). CodeQL code scanning is also free for public repos. Options: make the repo public before launch after a gitleaks scan of the full history (recommended: the code is the evidence); stay private and use repo-level secrets with a `workflow_dispatch` production deploy only the owner can trigger; pay for a plan. (D-29)

## Workflows

- `ci.yml` on PRs: pnpm install with store cache, `turbo run lint typecheck test build --affected`, integration tests with `pgvector/pgvector` and `rabbitmq` service containers, event contract tests, coverage gates, Docker build without push (validates Dockerfiles), Playwright smoke against the built web app with fake AI providers, dependency-cruiser, i18n key check, gitleaks.
- `security.yml` weekly and on PRs touching lockfiles or Dockerfiles: OSV-Scanner or `pnpm audit`, Trivy on built images, CodeQL if public.
- `evals.yml` (ADR-019): path-filtered on PRs, nightly on `main`, budget-capped key.
- `release.yml` on `main`: release-please; for each service released, build its amd64 image (one image per service; process types and the migrate step are commands of that image), push to GHCR (`ghcr.io/josealbdr/jadero-dev-agent:1.3.0` plus `:sha-<short>`), generate an SBOM, then deploy that service to staging.
- `deploy.yml`: reusable workflow `deploy(env, service, version)`; staging automatic after release, production by environment approval (public repo) or `workflow_dispatch` by the owner. The `admin` SPA deploys by copying its built files to the nginx root.

## Images

multi-stage Dockerfiles, `pnpm deploy --prod` (or `turbo prune`) for minimal contexts, Next `output: "standalone"`, non-root user, read-only root filesystem where possible, `HEALTHCHECK`.

## Deploy mechanics, options

- *A. SSH from GitHub Actions to a public port 22.* Pros: simplest. Cons: GitHub runners have changing IPs, so port 22 must be open to the world.
- *B. SSH over Tailscale:* the workflow joins the owner's tailnet as an ephemeral node (Tailscale GitHub Action) and SSHes to the server's tailnet address; port 22 closed publicly in the Hetzner Cloud Firewall. Pros: no public SSH at all; the owner uses the same tailnet. Cons: one more account and auth key to rotate.
- *C. Pull-based:* an agent on the server polls GHCR and redeploys. Pros: no inbound access. Cons: weaker control over migrations and rollbacks.

## Decision

B. The deploy key uses an SSH **forced command** (`command="/srv/jadero/bin/deploy.sh"` in `authorized_keys`), so the key can only run the deploy script with a validated environment and version, not a shell. The `deploy` user is not in the `docker` group (that group is root-equivalent); the forced command runs `sudo` on that one script only.

## Deploy script steps

log in to GHCR with a read-only token, pull the version, run the `migrate` container (expand-only migrations; contract migrations ship in a later release), `docker compose up -d` with healthchecks, smoke test (`/api/health`, home page per locale), on failure re-pin the previous version and alert. Migrations are written backward-compatible so a rollback never needs a down migration.

## Downtime

seconds during container restart are acceptable for v1; nginx serves a static maintenance page on 502. Blue-green with two upstreams is an optional later WP-33.
