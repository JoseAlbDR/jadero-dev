# apps/web

The public multilingual site (ADR-001, ADR-022, ADR-023, ADR-044). Today (WP-4) it is the skeleton: Next.js 16 App Router, next-intl with `/en`, `/es` and `/de`, Tailwind v4 tokens from `@jadero/ui`, a light, dark and system theme toggle, a locale switcher and a placeholder home. Result-only area: no learning gate; changes are reviewed from screenshots. Pages and content arrive in WP-16.

**Visual direction (ADR-044, decided 2026-10-04):** the hybrid of mockup 4. Swiss editorial base (Fraunces headings, Inter body, 12-column grid, thin rules, warm paper or warm near-black) with one terracotta accent, and Direction 1's terminal prompt card in Geist Mono as the signature element. WP-16 moves these tokens into `packages/ui` and deletes the mockups; build every page to this direction, not to the other mockups.

## Run it

```sh
cp apps/web/.env.example apps/web/.env   # once; SITE_URL, read at build time for canonical and hreflang links
pnpm --filter @jadero/web dev            # next dev on port 3000
pnpm --filter @jadero/web build          # standalone output, assets copied next to server.js
pnpm --filter @jadero/web start          # node .next/standalone/apps/web/server.js, as the image will
pnpm test:e2e                            # from the root: build, then Playwright and axe in Chrome
```

`playwright.config.ts` loads `apps/web/.env` when it exists, so the tests expect the same `SITE_URL` the build baked into the pages (canonical and hreflang links). A `SITE_URL` exported in the shell wins over the file.

## Layout

- `src/proxy.ts`: the next-intl middleware (Next 16 calls it proxy). A path without a locale gets a 307 to the cookie locale, else Accept-Language, else `en`.
- `src/i18n/`: `routing.ts` (locales, default, cookie, localized pathnames), `navigation.ts` (use its `Link` and `usePathname`, never `next/link`), `request.ts` (messages per request), `locale.ts` (`requireLocale`), `alternates.ts` (`localeAlternates`), `global.d.ts` (typed keys from `messages/en.json`).
- `src/app/[locale]/`: the locale layout (`<html lang>`, metadata with hreflang, providers, header), the home, the localized 404 and a catch-all that triggers it. `src/app/layout.tsx` only passes children through.
- `src/components/`: app components (header, theme provider and toggle, locale switcher). Reusable, text-free components go to `packages/ui`.
- `src/app/[locale]/mockups/`: the WP-15 hero mockups (`/mockups/terminal`, `/editorial`, `/bento`, `/hybrid`), throwaway and `noindex`. Each overrides the tokens in `mockups.css` through its `data-direction`; the owner picked `/hybrid` (ADR-044). WP-16 deletes the folder, its five `routing.pathnames` entries, the `Mockups` messages, its e2e block, this line and the code-map mentions, after promoting `TerminalPrompt` and the tokens.
- `messages/{en,es,de}.json`: every UI string. `test/messages.test.ts` fails when a locale's keys differ from English or a string is empty.
- `e2e/`: Playwright smoke and axe checks per locale; `playwright.config.ts` serves the standalone build.

## Rules that bite here

- No hard-coded UI strings: add the key to all three message files (the test and the typed keys catch a miss).
- A new page adds its localized pathname to `routing.pathnames` (`/es/proyectos`, `/de/projekte`), calls `setRequestLocale` and stays static.
- Colors and radii come from the tokens in `packages/ui/src/theme.css` (`bg-background`, `text-muted-foreground`); no raw color values in components.
- App code (`src/`) reads the environment only in `src/config/site.ts`. `SITE_URL` is baked in at build time (pages are prerendered): set it before `next build`; Turborepo hashes it and `.env*`.
- Every page sets its own canonical and hreflang links with `localeAlternates` in its `generateMetadata`; the layout sets none.
- The map of this app is section 7 of `docs/architecture/code-map.html`; update it when the request path changes.

## Notes for agent sessions

- The block below is written by Next.js: `next dev` adds it when an agent runs it, and only while it is missing. Keep it committed and unedited, or every agent run leaves an uncommitted change that blocks `git switch`.
- Next renames its process to `next-server`, so `pkill -f server.js` finds nothing. Stop a server by its port: `lsof -nP -iTCP:<port> -sTCP:LISTEN -t | xargs kill`. Check the port is free before starting another one, or curl may reach the old server.
- Screenshots without Playwright browsers: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1280,800 --screenshot=<file>.png <url>`; add `--force-dark-mode --blink-settings=preferredColorScheme=0` for dark mode. Save them in the session's scratchpad, never in the repo. `gh` cannot upload images, so the PR gets them as an artifact: an HTML gallery published with the Artifact tool (screenshots as its `files`), linked from a PR comment. Headless Chrome keeps a minimum window width of about 500 px and crops the rest, so a 390 px screenshot looks cut off; for mobile, use Playwright with `channel: "chrome"` and a real `viewport`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
