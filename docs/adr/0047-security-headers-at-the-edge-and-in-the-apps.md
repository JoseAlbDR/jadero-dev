---
id: ADR-047
title: "Security headers at the edge and in the apps"
status: proposed
date: 2026-10-09
deciders: [owner]
decisions: [D-77]
supersedes: []
superseded_by: null
source: null
---

# ADR-047: Security headers at the edge and in the apps

**Status:** proposed

## Context

The plan covers rate limits (ADR-002, ADR-020, ADR-021, WP-13, WP-23), Markdown sanitizing against XSS in content (ADR-011) and the AI guards (ADR-020), but no ADR or work package owns the HTTP security headers or the removal of headers that disclose the stack. Found by the owner in WP-12 step 2: today nothing in `api`, `agent` or `contact` removes Express's `X-Powered-By: Express`, and nothing plans `server_tokens off` on nginx.

The headers in question:
- **Browser protections:** `Content-Security-Policy` (which scripts, styles and frames a page may load; the main XSS mitigation after output encoding), `Strict-Transport-Security` (HTTPS only, no downgrade), `X-Content-Type-Options: nosniff` (no MIME sniffing of a JSON body into a script), `Referrer-Policy`, `Permissions-Policy`, framing control through CSP `frame-ancestors`.
- **Information disclosure:** nginx's version in `Server` and error pages, `X-Powered-By`, and any internal header an upstream sets.

Forces: three kinds of responders exist. nginx serves the static admin SPA (ADR-002) and proxies everything else; `web` renders HTML per request (Next.js); the Nest services answer JSON. A CSP with a per-request nonce can only be built by whoever renders the HTML. A header set in two places is either duplicated in the response or silently overridden, and nobody notices which one won. The services must also be safe when reached without nginx (local runs, the ops network, the future gateway of WP-53).

## Considered options

- *A. Everything at the edge (nginx).* Pros: one place, one review, covers every service including the static admin SPA. Cons: nginx cannot build a nonce-based CSP for Next.js pages; a service reached without nginx still discloses `X-Powered-By`; HTML and JSON need different policies, which turns into per-location config sprawl.
- *B. Everything in the apps (Helmet in each Nest service, headers in Next.js).* Pros: tested in TypeScript next to the code; safe without nginx. Cons: nginx itself still discloses its version and serves the admin SPA with no app in front; HSTS is a property of the domain, not of one app; the same lines repeated per service.
- *C. Split by who can know the right value, one owner per header (recommended).* nginx owns the response-independent headers for every host; `web` owns its CSP; `platform-nest` owns the JSON API defaults for every Nest service. Pros: each header is set where its value can be correct; no duplicates by rule; services stay safe without nginx. Cons: three places to look, so the split must be written down (this ADR) and tested in each place.

## Decision

C.

- **nginx (WP-8, `infra/nginx/`):** `server_tokens off`; `proxy_hide_header X-Powered-By` and any upstream header it owns; `Strict-Transport-Security: max-age=31536000; includeSubDomains` after a short-max-age trial (no `preload` until every subdomain is confirmed HTTPS only); `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a deny-all `Permissions-Policy` on every host; the admin SPA's static CSP (hashed bundles need no nonce) with `frame-ancestors 'none'`. Error pages without the version.
- **`web` (WP-16):** a nonce-based `Content-Security-Policy` built per request in Next.js (`script-src 'nonce-...' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`), report-only first, enforced once the reports are clean.
- **`platform-nest` (every Nest service, WP-12 step 7):** Helmet configured for JSON APIs (no HTML defaults that do not apply), plus `x-powered-by` disabled: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`. nginx hides the upstream copies of the headers it owns, so each header appears once.

Discarded: A, because the CSP of server-rendered pages cannot live at the edge and the services would disclose their stack when reached directly; B, because nginx's own disclosure, HSTS and the static admin SPA need the edge anyway.

## Consequences

- WP-12 step 7 adds the `platform-nest` part, with a test that asserts the headers and the absence of `X-Powered-By` on a real request.
- WP-8 adds the nginx part, checked by `nginx -t` and by a smoke request against each host that asserts the headers and no version in `Server`.
- WP-16 adds the CSP, with a Playwright check of the header and of a page with no CSP violations in the console.
- WP-17 confirms the admin SPA loads under its static CSP.
- WP-53 (the gateway) takes over the API part of the edge headers when it lands; this ADR's split still applies.
- Verify at WP time: Helmet's current version and API-oriented options; whether the existing host nginx already sets any of these headers globally (to avoid duplicates); the HSTS trial period before the long max-age.

## Pattern names

Gateway offloading, defense in depth, single owner per header, nonce-based (strict) CSP, report-only rollout, information disclosure minimization, secure by default in the shared platform.
