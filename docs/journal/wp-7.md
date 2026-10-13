---
wp: 7
title: "Images and releases: build once, scan what you ship, and watch it after"
status: draft
date: 2026-10-13
locale: en
---

# Images and releases: build once, scan what you ship, and watch it after

Until WP-7 the services only ran from source on my laptop. Now each one is a Docker image with a version, built from a tagged commit, scanned, pushed to a private registry and signed. The work was making sure what runs later is what was checked.

## What I built

Each service gets one image with two stages. The build stage installs, compiles and runs `pnpm deploy --prod` into a clean folder, and the runtime stage copies only that folder onto a slim Node 24 base pinned by tag and digest. npm, npx, corepack and yarn are deleted, the app files belong to root, and the process runs as `node`. The worker and migrate are commands on the same image.

A Compose file runs every process type hardened against the dev Postgres and RabbitMQ: read-only root filesystem, no capabilities, no new privileges, a small `tmpfs` for `/tmp`, and memory limits where heap plus every `tmpfs` stays under 80%. A test fails when a service loses any of that, or adds a privilege back. Migrate runs first as a one-off, and the servers wait for it to exit 0.

CI builds only the affected images on a pull request, smoke-runs them and scans them with Trivy. A secret always fails the run. A fixable HIGH or CRITICAL fails it only when the PR changes the image inputs. release-please versions each service from conventional commits through one Release PR, and `release.yml` builds the tagged commit, checks the pushed image is the scanned one, and attests its provenance. Every Monday a job scans the released images and opens an issue on a fixable CRITICAL, then closes it once a scan comes back clean.

## What I learned

**A deleted file still lives in its layer.** I got that a token removed later in the runtime stage stays readable in the earlier layer. What I did not know is that the build stage layers also live in the build cache, so the real fix is a BuildKit secret mount that never writes the token anywhere.

**A diff gate does not fail every PR.** I said a typo fix in `api` would go red on a new CRITICAL in the base image. It does not: the gate only blocks a PR that touches the Dockerfile or the ignore files. Blocking every PR until the base is fixed is alert fatigue, so the weekly scan is the second channel.

**The weekly scan watches the released image, not `main`.** A fix merged on Thursday reaches the scan only once a release publishes it. Artifact, not source.

**A scan that could not run is not clean.** I got that the issue stays open when the pull fails, but missed that the run has to go red. A quiet open issue is easy to ignore, and closing only on a positive clean result is the fail-safe.

**pnpm 11 shadowed `pnpm lint`.** It ran a built-in and checked nothing, though `verify` still ran Biome through Turborepo. It is `pnpm lint:check` now.

**Build once, deploy many.** If the deploy rebuilds the image, the scan and the signature guarantee nothing about what runs. I answered "nothing" and was right, but the reason came after: a second build is never byte-identical, so its digest differs.

The warm-up exercises this time were about concurrency, and the one that stuck was that a unique index serializes a race that check-then-act in code cannot. <!-- owner: check -->

## What I would change

I would test the release workflow against a real tag earlier. Two of the final review fixes, the concurrency group and building from the tagged commit instead of the latest `main`, only showed up when I read the run order closely. <!-- owner: check -->

I spent too long on a pnpm `EXDEV` error that only happened with the build cache imported. The fix was one setting. <!-- owner: check -->

I deferred two explain-back questions to the R0 review again, so this post comes before I have walked the full release trace from memory.

**Next:** WP-8 sets up the server, and WP-9 deploys to staging by pulling the image by its tag and digest, never building it again.
