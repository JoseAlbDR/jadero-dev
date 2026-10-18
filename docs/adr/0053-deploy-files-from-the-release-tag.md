---
id: ADR-053
title: "Deploy files from the release tag"
status: proposed
date: 2026-10-18
deciders: [owner]
decisions: [D-83, D-84]
supersedes: [ADR-049]
superseded_by: null
source: docs/learning/wp-9.md (Open questions, Decision)
---

# ADR-053: Deploy files from the release tag

**Status:** proposed (owner, WP-9, 2026-10-18). Supersedes ADR-049 as a whole. It decides where the server gets the files a deploy runs besides the image, and it moves the RabbitMQ topology import from a separate infra deploy job into each service deploy. Everything else in ADR-049 (and what ADR-049 restates from ADR-048 and ADR-025) is restated unchanged; read ADR-049 for its full text.

## Context

WP-9 fills in `deploy.sh`. Besides the image, a deploy reads files: the services' Compose files, the env templates, the RabbitMQ definitions with `provision-users.sh` and `permissions.tsv`, `provision.sql` and the smoke script. Root runs them, and a Compose file decides mounts and privileges, so whoever writes the files root runs controls the server. Until now they came from the owner's git checkout on the server, synced by hand. `infra/` belongs to no release component, so the checkout and the image can come from different commits. A release tag such as `api-v0.3.0` points at the commit the image was built from, and the image's revision label names it. No ruleset protects tags.

Services have no `configure` right on the broker (WP-5 T4), so a queue must exist before its consumer starts. ADR-048, restated by ADR-049, says the topology "is deployed from `definitions.json` by an `infra` deploy job before any service that needs a new queue". A live import (`rabbitmqctl import_definitions`) adds and updates exchanges, queues, bindings and policies and never deletes; a queue's declared arguments (here only its type) cannot change in place, its policies can.

## Considered options

Where the deploy files come from:
- *A. The owner's checkout, synced by hand.* Pros: nothing new; every change is seen landing. Cons: drift between an image and its files; a rollback runs today's files with yesterday's image.
- *B. Fetched at the release tag.* Pros: the image and its files come from one reviewed commit; a rollback uses its own release's files. Cons: root runs files fetched from GitHub, so the trust anchor becomes `main`'s protection plus tags that cannot move; an `infra/`-only change waits for a release.
- *C. Sent by CI with the deploy.* Cons: a stolen deploy key supplies the files root runs; undoes WP-8 D3.
- *D. Baked into each image.* Cons: the Compose project and the topology span several images; an image describing its own privileges is circular.

Who applies the topology:
- *A. Its own deploy target, first in the run.* Pros: matches ADR-049's wording. Cons: the order lives in the workflow, a manual service deploy can skip it.
- *B. Each `api` and `agent` deploy imports the definitions of its own release, before migrate.* Pros: the order holds by construction, however the deploy starts. Cons: an older release would re-import older policies.
- *C. Services declare their own queues.* Cons: undoes WP-5 T4.

## Decision

Deploy files: B. Topology: B, with a monotonic guard.

- **Deploy files at the release tag (new).** `deploy.sh` fetches `infra/` from the public repository at the tag of the version being deployed, checks that the tag's commit equals the image's revision label, and keeps the files per release on disk (current and previous). A rollback uses the previous release's files. A tag ruleset on `*-v*` blocks update and deletion (manual action). `deploy.sh` and `deploy-entry` stay installed by hand: the code that checks never updates itself from what it checks. Each service's `release-inputs.txt` lists a hash of its deploy files, so a change to them releases the service.
- **Topology per service deploy (changes ADR-048's "infra deploy job" line).** Each `api` and `agent` deploy imports the definitions of its own release in the `provisioned` state, before migrate, and waits until the queues are listed. The deploy records the `messaging` version whose definitions it imported, per environment, and imports only when the release's version is equal or newer (the same anti-rollback rule as the service versions), so a rollback never reverts a policy. Queue types never change in place: a queue that needs another type is a new name, checked by a test on the generator. Removing a queue, binding or exchange stays a deliberate manual contract step.
- **Discarded.** A drifts and gives a rollback the wrong files. C hands root to the deploy key. D does not fit files that span images. Topology A leaves the order to a workflow a manual run can skip; topology C gives services the right to reshape the broker.

## Unchanged

Restated from ADR-049 without change: image scanning, registry visibility and the job-token pull, the release token, the release components, dependency-only releases, provenance, and the staging deploy arriving with WP-9, together with every part of ADR-048 and ADR-025 that ADR-049 restates (the per-service pipeline, the deploy mechanics, the deploy script steps other than the registry login, the message-schema rollout order, downtime).

## Consequences

- WP-9 builds the tag fetch, the revision check, the per-release file store, the topology import with its guard and wait, the generator test on queue types and the deploy-file hash in `release-inputs.txt`.
- Manual action for the owner: a tag ruleset on `*-v*` (no update, no deletion).
- A deploy needs GitHub reachable for the fetch; it already needs GHCR.
- Shared state moves forward only: the database schema (expand migrations), the topology (guarded import) and the rendered env stay at the newest version in a rollback, so every release must work on the next release's shared state (N-1 compatibility).

## Pattern names

Configuration versioned with the artifact, single source of truth, trust anchor, root of trust, environment drift, ordering by construction, additive infrastructure change, monotonic counter (anti-rollback), expand/contract.
