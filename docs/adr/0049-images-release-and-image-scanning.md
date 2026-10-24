---
id: ADR-049
title: "Images, release and image scanning"
status: superseded
date: 2026-10-12
deciders: [owner]
decisions: [D-29, D-32, D-36, D-78, D-79]
supersedes: [ADR-048, ADR-025]
superseded_by: ADR-053, ADR-055
source: docs/learning/wp-7.md (Decisions explained, Open questions, Decision)
---

# ADR-049: Images, release and image scanning

**Status:** Superseded by ADR-053 as a whole (where the deploy files come from and the topology import, the rest restated) and, on a parallel branch, by ADR-055 for the "Dependency-only releases" line on what `release-inputs.txt` lists only (type packages `@types/*` left out); read the two together: `release-inputs.txt` lists the runtime closure without type packages (ADR-055) plus the deploy-file hash (ADR-053). Accepted (owner, WP-7, 2026-10-12). Supersedes ADR-048 and ADR-025 as a whole. It changes how built images are scanned and what blocks a pull request, which token opens the Release PR, how the server pulls images, which shared packages are release components, how a dependency-only change becomes a release, and it adds a signed build provenance. Everything else in ADR-048 and ADR-025 is restated unchanged by reference (section "Unchanged").

## Context

WP-7 builds the images, the Docker build check, Trivy, the SBOM and `release.yml`. Checking the repository and the tools on 2026-10-12 (`docs/learning/wp-7.md`, Facts checked) found five things the two ADRs did not foresee:

1. An image scan is full-state: it reports everything in the image today, so a Debian fix published on a Wednesday turns every pull request that affects that service red until the base update merges, three days later at the earliest because of the cooldown. WP-6 (ADR-048, question 2) chose a diff gate for npm packages for exactly this reason. ADR-048 also lists Trivy under `security.yml` and the Docker build under `ci.yml`, which would build each image twice.
2. release-please opens its Release PR with the job's `GITHUB_TOKEN` by default. This repository does not allow workflows to create pull requests (the default for a personal repository), and events made with `GITHUB_TOKEN` do not start other workflows, so the Release PR would get no required checks. GitHub's docs describe approval-required runs for such pull requests, rolling out on github.com.
3. A package pushed to GHCR from a personal account starts private, and public cannot be made private again. GHCR accepts only classic personal access tokens (which read every package of the account) or a workflow's `GITHUB_TOKEN`. ADR-048's deploy step "log in to GHCR with a read-only token" predates that check, and the 2026-10-09 audit rules out long-lived broad tokens.
4. release-please gives a commit to a component only through the files it touches. The pnpm catalog and the lockfile live at the root and are attributed to no component; it has no option to add paths to a component in any release (only an open pull request upstream, #2534); the `node-workspace` plugin never reads `pnpm-lock.yaml`, and a catalog bump never touches `apps/*/package.json`. A runtime dependency fix therefore releases no service. Renovate titles base image digest updates `chore(deps)`, which releases nothing either.
5. ADR-025 asked to verify the `node-workspace` plugin. Read in release-please 17.11.2 and the `^17.6.0` bundled by the action v5.0.0: it bumps every dependent component with a patch and a changelog note, leaves `workspace:*` as is, and counts `devDependencies`.

## Considered options

Image scanning gate:
- *A. Diff-style gate plus reports.* Trivy blocks a pull request on fixable HIGH and CRITICAL OS findings only when the pull request changes what the image is built from; otherwise it reports. Pros: the WP-6 rule (block what a change brings in, report the rest through a second channel); unrelated pull requests stay green. Cons: a finding in an unchanged image waits for the weekly scan or the next base update.
- *B. Full-state gate on fixable HIGH and CRITICAL.* Pros: simplest, strictest. Cons: unrelated pull requests turn red for the cooldown after every Debian fix.
- *C. Report only.* Pros: never blocks. Cons: relies on someone reading the Security tab.

Registry visibility:
- *A. Public images.* Pros: anonymous pulls, no registry credential on the server; anyone can verify attestations. Cons: one-way; a mistake baked into an image becomes public.
- *B. Private images, pulled with the deploy job's short-lived token.* Pros: no stored registry credential anywhere; the door to public stays open. Cons: WP-9 must hand the token to the server safely for one pull.
- *C. Private images, classic token stored on the server.* Pros: simplest deploy. Cons: long-lived and reads every package of the account; the audit rules it out.

Dependency-only releases:
- *A. Accept the gap.* Pros: nothing to build. Cons: a dependency fix waits for the service's next feature or fix.
- *B. A release-inputs file per service.* Pros: a dependency change releases exactly the services whose production closure changed, and the diff shows which. Cons: each dependency pull request must regenerate the file; the hosted Renovate may not be able to run the command.
- *C. Release every service on any lockfile change.* Pros: simple. Cons: releases services that did not change.

Release token:
- *A. The job's `GITHUB_TOKEN`, with the repository setting that lets Actions create pull requests.* Pros: no stored secret. Cons: the Release PR's checks need one approval click (if the rollout reaches this repository).
- *B. A GitHub App installation token.* Pros: one repository, one-hour tokens, checks run on their own. Cons: a private key to store and rotate.
- *C. A fine-grained personal access token.* Pros: simple. Cons: long-lived and acts as the owner.
- *D. A classic personal access token.* Cons: reaches every repository; ruled out by the audit.

## Decision

Image scanning: A. Registry: B. Dependency-only releases: B. Release token: A, with B as the fallback. Every part of ADR-048 and ADR-025 not named below is restated unchanged.

- **Trivy (changes ADR-048 `security.yml` and `ci.yml` lines).** The `images` job in `ci.yml` builds each affected service and scans it with Trivy, run as its container pinned by digest on the saved image. It fails a pull request on fixable HIGH and CRITICAL OS findings only when the pull request changes what the image is built from (a Dockerfile, the base pin, `.dockerignore`, `.trivyignore.yaml`); otherwise it reports in the job summary. A secret found in an image always fails. npm findings stay with OSV-Scanner. `release.yml` scans before the push and does not block. A weekly job in `security.yml` scans the released images into the Security tab and opens an issue on a fixable CRITICAL. Exceptions live in `.trivyignore.yaml` with an `expired_at` date. `images` becomes a required check.
- **Registry (changes ADR-048's deploy script line "log in to GHCR with a read-only token").** Images stay private. The deploy job passes its own `GITHUB_TOKEN` (`packages: read`) for that pull only; the deploy script logs in with a temporary `DOCKER_CONFIG` and removes it after the pull, so no credential stays on disk. Never a classic token. Going public later stays possible, since only private to public is allowed: a one-way door kept closed on purpose.
- **Release token.** release-please uses the job's `GITHUB_TOKEN`, with "Allow GitHub Actions to create and approve pull requests" turned on (manual action); only its job has `pull-requests: write`. If the first Release PR shows no approval prompt for its checks, a GitHub App installed on this repository only replaces it. Never a classic token. The image push keeps the job's `GITHUB_TOKEN` (ADR-043).
- **Release components (changes ADR-025's manifest list).** `apps/api`, `apps/agent`, `apps/web` (and `apps/admin`, `apps/contact` with their WPs), plus the shared runtime packages `packages/contracts`, `packages/messaging`, `packages/platform-nest` and `packages/ui`, with the `node-workspace` plugin. `packages/config` and `packages/testing` are not components: the plugin counts `devDependencies`, so they would release every service for a change no image contains. ADR-025's fallback check for shared packages is not needed.
- **Dependency-only releases (new).** Each service keeps `apps/<service>/release-inputs.txt`, its production dependency closure (`name@version`, one per line), regenerated by one command; a unit test in `pnpm verify` fails when it is stale. A dependency pull request regenerates it, so its squash commit touches the affected services. Renovate's `packageRules` give production dependency and base image updates `semanticCommitType: fix`, so the commit releases them.
- **Provenance (added to ADR-048 `release.yml`).** After the push, `actions/attest` signs a SLSA build provenance for the image digest with a short-lived Sigstore certificate from the job's OIDC token and pushes it to the registry; the SBOM is attached by BuildKit.
- **Staging deploy (moves from ADR-048 `release.yml` to WP-9).** `release.yml` ends at the push and the attestation; deploying the released service to staging arrives with `deploy.yml` in WP-9.

## Unchanged

Restated from ADR-048 without change: the per-service pipeline, repository visibility (public), the `ci.yml` jobs and triggers other than the `images` job, the backstop, `pr-title.yml`, `security.yml` other than the Trivy lines, `scorecard.yml`, `evals.yml`, `deploy.yml`, the supply chain and repository settings, the Images section (multi-stage, `pnpm deploy --prod` or `turbo prune`, Next `output: "standalone"`, non-root, read-only root filesystem where possible, `HEALTHCHECK`), deploy mechanics (option B, SSH over Tailscale with the forced command), the deploy script steps other than the registry login, and downtime. Restated from ADR-025 without change: release-please with one component per service, one combined Release PR, path attribution, tags `<component>-v<version>`, images tagged `<service>:<version>` plus `sha-<short>`, `versions.env` per environment, the semver rules, expand/contract for message schemas. Read ADR-048 and ADR-025 for the full text of those parts.

## Consequences

- WP-7 builds the Dockerfiles, the hardened runtime Compose, the `images` job, the Trivy jobs, `release-please-config.json` and its manifest, `release.yml` with SBOM and attestation, the release-inputs files, their generator and their staleness test, and the Renovate rules. WP-9 builds the registry login with the job token and the temporary `DOCKER_CONFIG`, and the staging deploy after release.
- Manual actions for the owner: turn on "Allow GitHub Actions to create and approve pull requests"; add `images` to the `protect-main` required checks after it has reported on `main`.
- A dependency pull request is not mergeable until its release-inputs files are regenerated; the hosted Renovate cannot be relied on to do it.
- Verify at WP time: approval-required runs on the first Release PR (else the GitHub App); whether the hosted Renovate's `postUpgradeTasks` allowed list can run the regenerate command (Renovate logs); whether Renovate's cooldown applies to Docker Hub digest updates; that Trivy stops reporting npm's packages once the runtime stage deletes them.

## Pattern names

Diff-based gate versus full-state gate, second channel, time-boxed exception, one tool per job, least privilege, short-lived credentials, one-way door, declared inputs (hermeticity), generated file with a staleness test, SLSA build provenance, keyless signing, build once deploy many, decision record that supersedes rather than edits.
