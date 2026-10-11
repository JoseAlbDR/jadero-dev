# apps/web

The public multilingual site (ADR-001, ADR-022, ADR-045, which supersedes ADR-023 and restates its foundation). Today (WP-4) it is the skeleton: Next.js 16 App Router, next-intl with `/en`, `/es` and `/de`, Tailwind v4 tokens from `@jadero/ui`, a light, dark and system theme toggle, a locale switcher and a placeholder home. Result-only area: no learning gate; changes are reviewed from screenshots. Pages and content arrive in WP-16.

**Visual direction (ADR-045, decided 2026-10-04, supersedes ADR-044):** Bento glass, as in the WP-15 mockup `bento-agent` (screenshots in `docs/artifacts/design-directions/`; the mockup pages were deleted in WP-16). Glass cards over a soft aurora, Geist and Geist Mono, violet accent in light mode and cyan in dark mode, and the agent as a dark terminal card as large as the hero, right next to it. The tokens live in `packages/ui`; build every page to this direction.

## Run it

```sh
cp apps/web/.env.example apps/web/.env   # once; SITE_URL for canonical and hreflang links, CSP_MODE
pnpm --filter @jadero/web dev            # next dev on port 3000
pnpm --filter @jadero/web build          # standalone output, assets copied next to server.js
pnpm --filter @jadero/web start          # node .next/standalone/apps/web/server.js, as the image will
pnpm test:e2e                            # from the root: build, then Playwright and axe in Chrome
```

`playwright.config.ts` loads `apps/web/.env` when it exists and hands `CSP_MODE` to the server (a value exported in the shell wins over the file). `SITE_URL` is always the test server's own origin, whatever `.env` says, because the proxy resolves every redirect on `SITE_URL`; the tests expect that same value in canonical and hreflang links. `CSP_MODE=enforce pnpm test:e2e` runs the suite under the enforced CSP.

## Layout

- `src/proxy.ts` (Next 16's name for middleware): per request, a fresh nonce and the CSP built with it, then the next-intl middleware. A path without a locale gets a 307 to the cookie locale, else Accept-Language, else `en`; that `Location` passes the open-redirect rule first, checked and resolved on the `SITE_URL` origin (the request's own origin only under `next dev`), never on the Host header.
- `src/security/`: `csp.ts` (nonce, the strict CSP of ADR-047, header name per mode) and `redirect.ts` (`safeRedirectTarget`: a redirect built from request input goes only to a same-site path or a `REDIRECT_ALLOWLIST` origin; every redirect, the cutover 301s included, goes through it).
- `src/i18n/`: `routing.ts` (locales, default, cookie, localized pathnames), `navigation.ts` (use its `Link` and `usePathname`, never `next/link`), `request.ts` (messages per request), `locale.ts` (`requireLocale`), `alternates.ts` (`localeAlternates`), `global.d.ts` (typed keys from `messages/en.json`).
- `src/app/[locale]/`: the locale layout (`connection()`, the nonce for the theme script, `<html lang>`, metadata with the localized title template, providers, header), the home (ADR-045 bento order: the hero from the profile beside the agent terminal, the pillar strip, the stack tile and the featured case study; one column on phones in the same order), the experience timeline (`experience/`, `/es/experiencia`, `/de/erfahrung`), the projects list and project pages (`projects/` and `projects/[slug]/`, `/es/proyectos`, `/de/projekte`; the slug is the project's own localized slug, and another locale's slug redirects to it, so the locale switcher can keep the current one: `src/content/project-page.ts`), the stack page (`stack/`, one bento tile per skill category: `src/content/skills.ts`), the blog and post pages (`blog/` and `blog/[slug]/`, `/blog` in every locale; the list pages on with a plain `?cursor=` link (an `<a>`, so a document navigation: on a client navigation Next 16.3 can reuse the head it prefetched for the same route without a cursor), the cursor checked against the contract and rebuilt before it is forwarded, a later page `noindex`; a post's translated slug redirects like a project's, found by walking at most 10 list pages: `src/content/posts.ts`, `src/content/post-page.ts`), the work log and entry pages (`work/` and `work/[entryId]/`, `/es/trabajo`, `/de/arbeit`, linked from the nav and the footer; an entry is addressed by its `kb-...` id in every locale, each section heading's id is its contract key, the citation anchor of ADR-031 (`#tradeoffs`); entries are English only (D-50), so `/es` and `/de` show a note, mark the entry `lang="en"` and point canonical and hreflang at the `/en` page; `indexable: false` is `noindex, follow` (D-52): `src/content/work-log.ts`), the error boundary (`error.tsx`: a failed content API call shows a localized message and a retry, never the error), the localized 404 and a catch-all that triggers it. `src/app/layout.tsx` only passes children through.
- "Ask about this" (`src/components/ask-about-link.tsx`): resting until WP-25, a plain link to the home terminal, `/<locale>?ask=<cvBulletId>#ask`; nothing is sent. The home checks `?ask=` against the contract (`src/content/ask.ts`) and shows the question with the bullet's text from the experience API, never the raw value; an unknown id leaves the prompt empty.
- The agent terminal (`src/components/agent-terminal.tsx`): a Server Component, dark in both themes (`--term-*`), the prompt line, a disabled send and the resting note; no form, no client JavaScript, no request.
- The pillar strip (`src/components/pillar-strip.tsx`): the eight proof pillars of report section 2A as fixed copy in the message files (`HomePage.pillars`, `HomePage.evidence`), each with its evidence map; evidence links only to pages that exist (`EVIDENCE`), the rest is plain text until its page ships.
- The header (`src/components/site-header.tsx`): inline nav from 60rem (960 px, where the German labels fit one row); below it a "Menu" button opens the nav, the locale switcher and the theme toggle in a panel inside the glass bar (`src/components/mobile-menu.tsx`, the disclosure pattern), closed on Escape, on a link click and on every navigation.
- `src/components/`: app components (header and its nav, footer, theme provider and toggle, locale switcher). Reusable, text-free components go to `packages/ui` (`Button`, the glass `Card` with its `tile` and `wide` variants, the `Aurora` background).
- `src/content/api.ts`: the client of the public content API (`/v1/content`), for Server Components only. One function per endpoint; each response is parsed with its `@jadero/contracts` schema and cached by `fetch` for 60 s under content tags (`content:projects`, `content:projects:<slug>`, ...) that `revalidateTag` can drop. A 404 problem body calls `notFound()`; any other failure throws a `ContentApiError` that names the resource only, never the URL or a body. The `fetch` cache still applies to pages rendered per request.
- `src/markdown/`: the safe Markdown pipeline of content bodies (ADR-011), server only: remark-parse, remark-gfm, remark-directive, the site's rules (`remark-site-rules.ts`: `:::callout` and `::figure[alt]{src=... caption=...}` become fixed components, other block directives render as nothing, a figure `src` must be a path on the site, `#` becomes `h2`, footnotes are dropped), remark-rehype (raw HTML dropped), `rehype-sanitize` with the explicit allowlist in `schema.ts`, then React elements through `hast-util-to-jsx-runtime`. Never `dangerouslySetInnerHTML`; a new tag or attribute goes on the allowlist and gets a test in `test/markdown.test.tsx`.
- The layout loads Geist and Geist Mono from the `geist` package (`next/font/local`, self-hosted, no font CDN) and sets their variables on `<html>`; the tokens in `packages/ui/src/theme.css` point `font-sans` and `font-mono` at them.
- `messages/{en,es,de}.json`: every UI string. `test/messages.test.ts` fails when a locale's keys differ from English or a string is empty.
- `e2e/`: Playwright smoke and axe checks per locale; `playwright.config.ts` serves the standalone build against a stub content API (`e2e/stub/`, fixtures parsed with the `@jadero/contracts` schemas), so the suite needs no Docker.

## Rules that bite here

- No hard-coded UI strings: add the key to all three message files (the test and the typed keys catch a miss).
- A new page adds its localized pathname to `routing.pathnames` (`/es/proyectos`, `/de/projekte`) and calls `setRequestLocale`.
- Every page is rendered per request because of the CSP nonce (ADR-047, `docs/learning/wp-16.md`): the locale layout calls `connection()` once, for every route under it. Data is cached with `fetch` `revalidate` and tags (`src/content/api.ts`). Never `export const dynamic = "force-dynamic"`: it drops that cache.
- The CSP is report-only until `CSP_MODE=enforce`. There is no report endpoint, so the clean signal ADR-047 waits for is the Playwright suite passing with `CSP_MODE=enforce` on every page; enforcement is switched on in step 8 of WP-16. An inline `<script>` or `<style>` needs the nonce (Next adds it to its own tags; `headers().get("x-nonce")` gives it to anything else), and a `style` attribute in server HTML is blocked outright (no nonce covers it): use classes.
- Colors and radii come from the tokens in `packages/ui/src/theme.css` (`bg-background`, `text-muted-foreground`); no raw color values in components.
- App code (`src/`) reads the environment only in `src/config/site.ts`. `SITE_URL` is read when the server starts (pages render per request): set it where the server runs, to the public origin, because redirects are pinned to it; the build checks it too. `NODE_ENV` is read through `isDevelopment()`. `CSP_MODE` (`report-only` by default, or `enforce`) is read per request by the proxy. `CONTENT_API_URL` is server only and read at request time (`contentApiUrl()`); it has no default, so a missing value fails the content fetch with a clear error.
- Colors, glass and the aurora come from tokens and utilities (`text-signal`, `bg-term`, `glass`, `aurora`, `rounded-card`); accessibility checks hide `[data-aurora]` so contrast is measured on the solid surface (ADR-045).
- Every page sets its own canonical and hreflang links with `localeAlternates` in its `generateMetadata`; the layout sets none.
- The map of this app is section 7 of `docs/architecture/code-map.html`; update it when the request path changes.

## Notes for agent sessions

- The block below is written by Next.js: `next dev` adds it when an agent runs it, and only while it is missing. Keep it committed and unedited, or every agent run leaves an uncommitted change that blocks `git switch`.
- Start the standalone server with `HOSTNAME=localhost` (or unset), never `127.0.0.1`: with it, a localized pathname (`/es/experiencia`) loops on a 307 (`playwright.config.ts` says why).
- Next renames its process to `next-server`, so `pkill -f server.js` finds nothing. Stop a server by its port: `lsof -nP -iTCP:<port> -sTCP:LISTEN -t | xargs kill`. Check the port is free before starting another one, or curl may reach the old server.
- Screenshots without Playwright browsers: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1280,800 --screenshot=<file>.png <url>`; add `--force-dark-mode --blink-settings=preferredColorScheme=0` for dark mode. Save them in the session's scratchpad, never in the repo. `gh` cannot upload images, so the PR gets them as an artifact: an HTML gallery published with the Artifact tool (screenshots as its `files`), linked from a PR comment. Headless Chrome keeps a minimum window width of about 500 px and crops the rest, so a 390 px screenshot looks cut off; for mobile, use Playwright with `channel: "chrome"` and a real `viewport`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
