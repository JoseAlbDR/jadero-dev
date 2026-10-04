# apps/web

The public multilingual site (ADR-001, ADR-022, ADR-023). Today (WP-4) it is the skeleton: Next.js 16 App Router, next-intl with `/en`, `/es` and `/de`, Tailwind v4 tokens from `@jadero/ui`, a light, dark and system theme toggle, a locale switcher and a placeholder home. Result-only area: no learning gate; changes are reviewed from screenshots. Pages and content arrive in WP-16, the visual direction in WP-15.

## Run it

```sh
cp apps/web/.env.example apps/web/.env   # once; SITE_URL for canonical and hreflang links
pnpm --filter @jadero/web dev            # next dev on port 3000
pnpm --filter @jadero/web build          # standalone output, assets copied next to server.js
pnpm --filter @jadero/web start          # node .next/standalone/apps/web/server.js, as the image will
pnpm test:e2e                            # from the root: build, then Playwright and axe in Chrome
```

## Layout

- `src/proxy.ts`: the next-intl middleware (Next 16 calls it proxy). A path without a locale gets a 307 to the cookie locale, else Accept-Language, else `en`.
- `src/i18n/`: `routing.ts` (locales, default, cookie, localized pathnames), `navigation.ts` (use its `Link` and `usePathname`, never `next/link`), `request.ts` (messages per request), `locale.ts` (`requireLocale`), `global.d.ts` (typed keys from `messages/en.json`).
- `src/app/[locale]/`: the locale layout (`<html lang>`, metadata with hreflang, providers, header), the home, the localized 404 and a catch-all that triggers it. `src/app/layout.tsx` only passes children through.
- `src/components/`: app components (header, theme provider and toggle, locale switcher). Reusable, text-free components go to `packages/ui`.
- `messages/{en,es,de}.json`: every UI string. `test/messages.test.ts` fails when a locale's keys differ from English or a string is empty.
- `e2e/`: Playwright smoke and axe checks per locale; `playwright.config.ts` serves the standalone build.

## Rules that bite here

- No hard-coded UI strings: add the key to all three message files (the test and the typed keys catch a miss).
- A new page adds its localized pathname to `routing.pathnames` (`/es/proyectos`, `/de/projekte`), calls `setRequestLocale` and stays static.
- Colors and radii come from the tokens in `packages/ui/src/theme.css` (`bg-background`, `text-muted-foreground`); no raw color values in components.
- Server-side environment reads are limited to `SITE_URL` in the locale layout until the site has a config module.
- The map of this app is section 7 of `docs/architecture/code-map.html`; update it when the request path changes.
