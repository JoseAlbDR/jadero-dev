---
id: ADR-007
title: "Configuration and secrets"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-7]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-007: Configuration and secrets")
---

# ADR-007: Configuration and secrets

**Status:** Accepted with a change (second pass 2026-10-03, D-7 option D): secrets stay only on the server, sourced from a personal 1Password vault through `op inject` at deploy (WP-8 installs the CLI and the service-account token, WP-9 renders the `.env` files from `infra/env/<service>.env.tpl`; manual action M-38). SOPS (WP-34) is superseded.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-7). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Context

Secrets: chat-model key, embeddings key, LangSmith key, Turnstile secret, session secret, DB passwords, GitHub OAuth secret, revalidation webhook secret. Environments: local dev, CI, staging, production.

## Options (runtime secrets)

- *A. Secrets only on the server* (`/srv/jadero/<env>/.env`, mode 600, owned by root, loaded by compose `env_file`), CI never sees runtime secrets. Pros: smallest blast radius (a leaked CI token cannot read production keys); simple. Cons: manual edit on the server to rotate a key (documented runbook).
- *B. GitHub Actions secrets written to the server at deploy.* Pros: one place to manage. Cons: CI becomes able to read every production secret; environment-scoped secrets need a public repo or a paid plan for private repos (ADR-026).
- *C. SOPS + age: encrypted `.env` files committed, decrypted on the server with an age key that never leaves it.* Pros: versioned, reviewable secret changes; a nice showcase. Cons: key management to learn; more moving parts on day one.

## Decision

A for v1, C as an optional later WP. CI holds only CI-scoped keys (low-limit provider keys for evals, Tailscale auth key, GHCR uses the built-in `GITHUB_TOKEN`).

## Config in code

`@nestjs/config` with a Zod env schema per module, validated at boot (fail fast: a missing `AI_EMBEDDINGS_DIM` stops startup with a clear error). Typed config accessors, no `process.env` reads outside the config module. `.env.example` defaults all AI providers to `fake` so the whole stack runs locally and in CI without keys or spend.

## Consequences

Separate provider keys per environment, each in its own provider workspace/project with its own spend limit (ADR-021). Never print secrets; the boot log lists which variables are set, never their values.

## Owner review (2026-10-03, F-5; decided D in the second pass)

option D: server-only as in A, sourced from a personal 1Password vault. A read-only service-account token lives on the server; the repo holds `infra/env/<service>.env.tpl` templates with `op://` references, never values; the deploy script renders each `.env` with `op inject`. Gains: rotation by editing 1Password and redeploying, secrets that survive a server loss, templates that document each service's secrets. Costs: a 1Password plan, service-account rate limits below the Business plan (1,000 reads per hour per token; 1,000 requests per day per account on Individual and Families), and deploys that fail while 1Password is unreachable. It would replace SOPS (WP-34) as the secrets-as-code item.
