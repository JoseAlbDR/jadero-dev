---
paths:
  - "apps/web/**"
  - "apps/admin/**"
  - "packages/ui/**"
---
# Frontend rules (ADR-022, ADR-023; result-only area, no learning gate)

- Next.js 16 App Router, `next-intl` with `localePrefix: "always"`, localized pathnames, `setRequestLocale`, `generateStaticParams` for es, en, de. No hard-coded UI strings; CI fails on missing message keys.
- Tailwind v4 tokens in `packages/ui/theme.css`; shadcn/ui components owned in `packages/ui`; light, dark and system through `next-themes`; `prefers-reduced-motion` respected.
- Markdown from the API is rendered through remark/rehype with `rehype-sanitize`; never `dangerouslySetInnerHTML` with content, never MDX from the database.
- Budgets: WCAG 2.2 AA (axe in CI), Lighthouse 95+ on content pages, LCP under 2 s mobile; the chat bundle is lazy-loaded.
- The home must read complete with the agent resting (R1 ships without the agent). Pillar strip and evidence map are acceptance criteria (report 2A).
- Admin is a static SPA (Vite + React); it calls `/api/*` on `admin.jadero.dev` only; forms are built on the Zod contracts.
- Deliver with screenshots in the PR; the owner reviews results, not code, here.
