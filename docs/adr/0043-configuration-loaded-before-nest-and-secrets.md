---
id: ADR-043
title: "Configuration loaded before Nest, and secrets"
status: accepted
date: 2026-10-04
deciders: [owner]
decisions: [D-7]
supersedes: [ADR-007]
superseded_by: null
source: docs/learning/wp-3.md (Decision, amendment on ADR-007)
---

# ADR-043: Configuration loaded before Nest, and secrets

**Status:** Accepted (WP-3, 2026-10-04). Supersedes ADR-007 on the config library only: services validate their environment with an own Zod loader from `@jadero/platform-nest`, not `@nestjs/config`. The secrets decision of ADR-007 (server-only, rendered from 1Password with `op inject`, D-7 option D) and every other config rule are restated here unchanged.

## Context

ADR-007 said "`@nestjs/config` with a Zod env schema per module, validated at boot". WP-3 built the config path and found three reasons not to use the library:

1. Validation must happen before `NestFactory.create`, so a bad environment exits in milliseconds without building a module. `ConfigModule.forRoot({ validate })` and `forRootAsync` both validate during module initialization, inside `NestFactory.create`.
2. The OpenTelemetry entry (`node --import @jadero/platform-nest/instrumentation`, WP-3 decision F1) runs before Nest exists and needs its own slice of config, read the same way.
3. The owner chose a typed config class as the DI token (WP-3 decision B2, `ApiConfig`). `ConfigService.get("PORT")` reads values by string key, which B2 set out to avoid.

The implementation ADR-007 assumed was not discussed when the WP-3 options were written, and the code went another way first. The owner reviewed it and chose to record the change rather than add a library that would validate the same environment a second time.

## Considered options

- *Keep ADR-007: add `@nestjs/config` with `forRoot({ validate })` or `forRootAsync`.* Pros: the library most Nest guides use; `.env` loading built in. Cons: validates inside `NestFactory.create`, after the loader already did; `ConfigService` string keys next to `ApiConfig`; the instrumentation entry still needs its own loader; one more dependency with nothing to do.
- *Own loader in `platform-nest`, run before Nest (built in WP-3).* `loadConfig(schema, env)` parses `process.env` with a service's Zod schema (`platformEnv.extend({...})`), prints one line per bad variable (name and issue, never the value) and exits with code 1. The service maps the result to its config class and provides it with `useValue`. Pros: fails before any module; one way to read config for the app and the instrumentation entry; typed injection by class. Cons: about 60 lines the project owns; `.env` loading comes from Node (`--env-file-if-exists`) instead of the library.

## Decision

The own loader. Each service has one Zod schema built on `platformEnv`, validated once in `main.ts` with `loadConfig` before `NestFactory.create`, mapped to an abstract config class (`ApiConfig` in `api`) that providers inject. `process.env` is read only by `loadConfig` and by the instrumentation entry's call to it. Development `.env` files load with Node's `--env-file-if-exists=.env`.

Restated from ADR-007 unchanged:
- Runtime secrets live only on the server, rendered from a personal 1Password vault with `op inject` at deploy (`infra/env/<service>.env.tpl` with `op://` references; WP-8 and WP-9; manual action M-38). SOPS (WP-34) stays superseded. CI holds only CI-scoped keys.
- Never print secrets; config errors and the boot log name variables, never values. ADR-007 also asked the boot log to list which variables are set; that is dropped on purpose: a failed boot names every bad variable, and a list of set names on a good boot added nothing the schema does not already say.
- `.env.example` files default every AI provider to `fake`, so the stack runs locally and in CI without keys or spend.
- Separate provider keys per environment, each with its own spend limit (ADR-021).

## Consequences

- `@nestjs/config` is not a dependency. A later need it covers (per-module namespaced config, hot reload) is a new ADR.
- New variables are added to the service's schema and to its `.env.example`; a unit test covers a missing or malformed value.
- WP-3 step 7 reuses `loadConfig` for the OpenTelemetry variables.

## Pattern names

Fail fast; twelve-factor config; typed configuration object as a DI token; composition root.
