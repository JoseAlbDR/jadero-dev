---
id: ADR-022
title: "Internationalization"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-19, D-20]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-022: Internationalization")
---

# ADR-022: Internationalization

**Status:** Accepted (owner review 2026-10-03, D-19 and D-20).

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-19, D-20). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Considered options

next-intl v4 (App Router native, ICU messages, typed keys, localized pathnames, `setRequestLocale` for static rendering, `proxy.ts` integration on Next 16); Paraglide JS (compiler-based, smallest bundles, less App Router routing help); i18next/react-i18next (generic, more glue for RSC).

## Decision

next-intl (already in the brainstorm stack). Routes `/es`, `/en`, `/de` with `localePrefix: "always"`, default locale chosen from `Accept-Language` and remembered in a cookie; localized pathnames (`/es/proyectos`, `/en/projects`, `/de/projekte`); `hreflang` alternates and per-locale sitemaps; `generateStaticParams` for all locales. UI strings in `messages/{es,en,de}.json` with a CI check that fails on missing keys; content translations come from the API (ADR-011). The agent answers in the visitor's locale unless the visitor writes in another language, in which case it follows the visitor.

## Consequences

default locale (D-19) and which locales are required for publish (D-20) are owner decisions.
