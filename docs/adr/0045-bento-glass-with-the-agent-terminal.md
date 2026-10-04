---
id: ADR-045
title: "Bento glass with the agent terminal"
status: accepted
date: 2026-10-04
deciders: [owner]
decisions: [D-23, D-74]
supersedes: [ADR-023, ADR-044]
superseded_by: null
source: WP-15 follow-up (issue #23, PR #88), mockup /mockups/bento-agent (apps/web/src/app/[locale]/mockups/bento-agent/)
---

# ADR-045: Bento glass with the agent terminal

**Status:** Accepted (owner, 2026-10-04). Supersedes ADR-023 (its recommended direction, Swiss editorial with a terminal prompt) and ADR-044 (the hybrid editorial pick). ADR-023's foundation is restated below unchanged.

## Foundation (unchanged from ADR-023)

Tailwind v4 with CSS-first tokens (`@theme`, OKLCH colors, `@theme inline` mapping light/dark variables), shadcn/ui components owned in `packages/ui`, `next-themes` for light, dark and system with no flash on load, Motion for restrained transitions that respect `prefers-reduced-motion`, self-hosted fonts through `next/font`, lucide icons. Targets: WCAG 2.2 AA (axe in CI), Lighthouse 95+ on content pages, LCP under 2 s on mobile, the chat bundle lazy-loaded so content pages ship little JavaScript.

## Context

ADR-044 picked the hybrid of mockup 4 (Swiss editorial base with Direction 1's prompt card). After sharing the screenshots, the owner got feedback that Bento glass (Direction 3) looks better, and decided to switch. The owner added one requirement: the agent is close to the most important thing on the site, so it must stand out, either with Direction 1's terminal or with a terminal designed for bento.

The plain bento mockup showed the agent as one card among six, with a small input. A fifth mockup, `/mockups/bento-agent`, gives it a dedicated terminal card.

## Considered options

- *A. Bento with a bento-native agent terminal (mockup 5).* The agent card is as large as the hero (two columns by two rows) and sits right next to it; it is a dark terminal window in both themes (window bar, `ask@jadero.dev`, a `/` shortcut, prompt line with caret, suggested questions, resting note) framed by a glowing accent gradient. Pros: the agent is the second thing a visitor sees, clearly interactive; dark in both themes, so its contrast does not depend on the glass. Cons: a dark block in the light theme is a strong contrast the rest of the page has to balance.
- *B. Bento with Direction 1's terminal card as is.* Pros: already built. Cons: its flat, bordered look reads as a different design system inside a glass grid.
- *C. Plain bento (mockup 3).* Cons: the agent does not stand out, against the owner's requirement.
- *D. Keep ADR-044.* Discarded: the owner chose bento.

## Decision

Option A. The direction is Bento glass:

- Cards: glass surfaces (`color-mix(in srgb, surface 62%, transparent)` with a backdrop blur) over a soft aurora, large radii, a hover lift only when motion is allowed.
- Type: Geist for headings and body, Geist Mono for the terminal and labels.
- Accent: violet in light mode (about `oklch(0.48 0.18 280)`), cyan in dark mode (about `oklch(0.82 0.12 200)`); aurora in violet, cyan and magenta. Values are the starting point; WP-16 keeps them only where axe passes.
- Home layout: hero card and agent terminal side by side at the same size, then the pillar strip, then now, stack and the featured case study. On phones the terminal comes right after the hero, then the pillars.
- The agent terminal is dark in both themes (`--term-*` tokens) with a cyan prompt and caret.

D-74 is kept with one recorded shift: the headline is still the positioning and the pillar strip follows the hero row right away, but the agent is no longer a quiet entry point. It sits beside the headline at the same size, which the owner chose on purpose because the agent is close to the most important thing on the site. The page still reads complete with the agent resting.

## Consequences

- WP-16 moves the bento tokens, the `--term-*` tokens and the glass and aurora styles into `packages/ui`, points the fonts at Geist and Geist Mono (prefer the `geist` package or `next/font/local`, ADR-026), promotes the agent terminal to a real component, and deletes the mockups (`apps/web/AGENTS.md` lists the pieces).
- Every WP-16 page is built from bento cards. Long text (case studies, blog posts) goes in a single wide card with a readable measure, not split across tiles.
- Light-mode glass is the contrast risk ADR-023 named: keep the WP-15 e2e pattern (axe with the aurora hidden, no unchecked contrast) for every page.
- WP-25 (chat UI) grows from this terminal card: the card is where the chat opens.
- Trend risk (ADR-023): the tokens keep the look in one place, so a later restyle is a token change plus the card component, not a rewrite.

## Pattern names

Design tokens, bento grid (modular card layout), progressive disclosure (suggested questions before input), graceful degradation (the page reads complete with the agent resting).
