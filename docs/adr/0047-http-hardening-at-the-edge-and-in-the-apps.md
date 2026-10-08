---
id: ADR-047
title: "HTTP hardening at the edge and in the apps"
status: proposed
date: 2026-10-09
deciders: [owner]
decisions: [D-77]
supersedes: []
superseded_by: null
source: null
---

# ADR-047: HTTP hardening at the edge and in the apps

**Status:** proposed

## Context

The plan covers rate limits (ADR-002, ADR-020, ADR-021, WP-13, WP-23), Markdown sanitizing against XSS in content (ADR-011) and the AI guards (ADR-020), but no ADR or work package owns the HTTP security headers or the removal of headers that disclose the stack. Found by the owner in WP-12 step 2: today nothing in `api`, `agent` or `contact` removes Express's `X-Powered-By: Express`, and nothing plans `server_tokens off` on nginx. A security gap audit of the plan on 2026-10-09 found four more HTTP concerns with no owner: CORS, request body limits, internal endpoints reachable from the public edge, and open redirects. This ADR covers all five.

The headers in question:
- **Browser protections:** `Content-Security-Policy` (which scripts, styles and frames a page may load; the main XSS mitigation after output encoding), `Strict-Transport-Security` (HTTPS only, no downgrade), `X-Content-Type-Options: nosniff` (no MIME sniffing of a JSON body into a script), `Referrer-Policy`, `Permissions-Policy`, framing control through CSP `frame-ancestors`.
- **Information disclosure:** nginx's version in `Server` and error pages, `X-Powered-By`, and any internal header an upstream sets.

The other four concerns:
- **CORS.** A browser applies the same-origin policy: a script on one origin cannot read responses from another. CORS headers (`Access-Control-Allow-Origin` and friends) are how a server relaxes that policy for chosen origins. They protect nothing on their own: a non-browser client (curl, a script, a bot) ignores them and calls the API anyway. So CORS is only ever a way to open a door, and a door opened by mistake (`*`, or reflecting any `Origin` with credentials) lets any site read a logged-in admin's responses. ADR-002 serves each audience from one origin (the public site and its API on one host, the admin SPA and its API on another), so no browser call is cross-origin and CORS is not needed.
- **Body limits.** Without a limit, a large request body ties up memory and CPU before validation runs. Express's JSON parser defaults to 100kb, a value nobody chose and nobody tests. Only the media upload route of WP-17 needs large bodies.
- **Internal endpoints.** Some routes exist for other services, not for browsers: `web`'s revalidation route called by `api-worker` (WP-14) and the internal endpoints of `agent`, `api` and `contact` that the MCP edge calls (ADR-035, WP-36). If nginx proxies them on a public host, anyone can call them.
- **Open redirects.** A route that redirects to a target taken from the request (a login `callbackURL` or `returnTo`, a locale redirect) can be abused to send a visitor from a trusted `jadero.dev` link to an attacker's page, or to leak a token in the URL.

Forces: three kinds of responders exist. nginx serves the static admin SPA (ADR-002) and proxies everything else; `web` renders HTML per request (Next.js); the Nest services answer JSON. A CSP with a per-request nonce can only be built by whoever renders the HTML. A header set in two places is either duplicated in the response or silently overridden, and nobody notices which one won. The services must also be safe when reached without nginx (local runs, the ops network, the future gateway of WP-53).

## Considered options

- *A. Everything at the edge (nginx).* Pros: one place, one review, covers every service including the static admin SPA. Cons: nginx cannot build a nonce-based CSP for Next.js pages; a service reached without nginx still discloses `X-Powered-By` and has no body limit; HTML and JSON need different policies, which turns into per-location config sprawl; nginx cannot know whether a redirect target is safe.
- *B. Everything in the apps (Helmet in each Nest service, headers in Next.js).* Pros: tested in TypeScript next to the code; safe without nginx. Cons: nginx itself still discloses its version and serves the admin SPA with no app in front; HSTS is a property of the domain, not of one app; an internal route the app answers is already reachable once nginx proxies it; the same lines repeated per service.
- *C. Split by who can know the right value, one owner per concern (recommended).* nginx owns the response-independent headers, the outer body limits and the blocking of internal routes for every host; `web` owns its CSP and its redirects; `platform-nest` owns the JSON API defaults (headers, no CORS, JSON body limit) for every Nest service. Pros: each control is set where its value can be correct; no duplicates by rule; services stay safe without nginx, and the edge stays safe if an app gets a default wrong. Cons: three places to look, so the split must be written down (this ADR) and tested in each place.

## Decision

C.

- **nginx (WP-8, `infra/nginx/`):** `server_tokens off`; `proxy_hide_header X-Powered-By` and any upstream header it owns; `Strict-Transport-Security: max-age=31536000; includeSubDomains` after a short-max-age trial (no `preload` until every subdomain is confirmed HTTPS only); `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a deny-all `Permissions-Policy` on every host; the admin SPA's static CSP (hashed bundles need no nonce) with `frame-ancestors 'none'`. Error pages without the version. No `Access-Control-*` header on any host. `client_max_body_size` per location: small for the JSON APIs, larger only on the media upload route of WP-17. Internal routes denied on every public host (`web`'s revalidation route and every internal endpoint the MCP edge calls).
- **`web` (WP-16):** a nonce-based `Content-Security-Policy` built per request in Next.js (`script-src 'nonce-...' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`), report-only first, enforced once the reports are clean. The next-intl locale redirects and the cutover 301s follow the redirect rule below.
- **`platform-nest` (every Nest service, WP-12 step 7):** Helmet configured for JSON APIs (no HTML defaults that do not apply), plus `x-powered-by` disabled: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`. No service calls `enableCors`. The JSON body parser gets an explicit limit (the 100kb default made explicit, or smaller if no route needs it), set in configuration. nginx hides the upstream copies of the headers it owns, so each header appears once.
- **CORS closed by default:** same origin per audience (ADR-002) makes cross-origin browser calls unnecessary. Opening CORS to any origin needs a new ADR that names the origin and the routes. The MCP edge (WP-36) is the one public endpoint built for other clients; it validates the `Origin` header as the MCP specification requires for its HTTP transport, which guards against DNS rebinding.
- **Internal endpoints never reachable from the public edge:** besides the nginx deny, every internal endpoint authenticates its caller with a signed request (the signed revalidation webhook of the report, the signed internal header of WP-13 and ADR-035), so a misconfigured location is not enough to call it.
- **Open redirects:** a redirect whose target comes from user input goes only to a relative path on the same host or to an entry on an explicit allowlist. This covers Better Auth's `callbackURL` and any `returnTo` (WP-13), the next-intl locale redirects and the cutover 301s (WP-16, WP-29). Every redirecting route has a test that an absolute URL to another host, a protocol-relative `//host` and a `javascript:` target are refused or replaced by a safe default.

Discarded: A, because the CSP of server-rendered pages and the redirect rule cannot live at the edge, and the services would disclose their stack when reached directly; B, because nginx's own disclosure, HSTS, the static admin SPA and the blocking of internal routes need the edge anyway.

## Consequences

- WP-12 step 7 adds the `platform-nest` part: Helmet for JSON APIs, `x-powered-by` off, no CORS, the explicit JSON body limit. Tests on a real request assert the headers, the absence of `X-Powered-By`, the absence of any `Access-Control-*` header (also on a preflight `OPTIONS` with an `Origin`), and a 413 for a body over the limit.
- WP-8 adds the nginx part, checked by `nginx -t` and by smoke requests against each host that assert the headers, no version in `Server`, no `Access-Control-*` header, and a 403 or 404 on each internal route.
- WP-13 applies the redirect rule to Better Auth's callback and `returnTo`, with the tests above.
- WP-16 adds the CSP, with a Playwright check of the header and of a page with no CSP violations in the console, and the redirect tests for the locale redirects.
- WP-17 confirms the admin SPA loads under its static CSP; its upload route is the one location with a larger body limit.
- WP-29 checks the cutover 301s against the redirect rule.
- WP-36 validates `Origin` on the MCP endpoint and calls internal endpoints only with signed requests.
- WP-53 (the gateway) takes over the API part of the edge headers, body limits and internal-route blocking when it lands; this ADR's split still applies.
- Verify at WP time: Helmet's current version and API-oriented options; whether the existing host nginx already sets any of these headers globally (to avoid duplicates); the HSTS trial period before the long max-age; the body limit each JSON route actually needs; how Better Auth validates `callbackURL` (trusted origins) in the version used; the MCP specification's current wording on `Origin` validation.

## Pattern names

Gateway offloading, defense in depth, single owner per control, nonce-based (strict) CSP, report-only rollout, information disclosure minimization, secure by default in the shared platform, deny by default (CORS), allowlist validation (redirects), resource limits at every layer.
