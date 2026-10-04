---
id: ADR-044
title: "Visual direction confirmed from the mockups"
status: superseded
date: 2026-10-04
deciders: [owner]
decisions: [D-23]
supersedes: []
superseded_by: ADR-045
source: WP-15 (issue #23, PR #84), the hero mockups under apps/web/src/app/[locale]/mockups/
---

# ADR-044: Visual direction confirmed from the mockups

**Status:** Superseded by ADR-045 (the owner switched to Bento glass on 2026-10-04). Accepted (owner, 2026-10-04, after the WP-15 screenshots). Refines ADR-023 and does not supersede it: ADR-023's foundation and its recommendation (Swiss editorial base with the terminal-style prompt) stand. This record fixes the concrete choices WP-16 builds on.

## Context

ADR-023 described three directions and recommended "Direction 2 as the base with Direction 1's terminal-style prompt as one signature element", to be confirmed from throwaway mockups (D-23). WP-15 built four hero mockups with the same placeholder copy, the eight proof pillars and the agent shown at rest, in light and dark, and checked each with axe (WCAG 2.2 AA):

1. Terminal editorial: Geist and Geist Mono, near-black or warm paper, a phosphor green accent, a dot grid, the prompt as the hero.
2. Swiss editorial: Fraunces headline, Inter body, a 12-column grid, a terracotta accent, the prompt as a quiet inline line.
3. Bento glass: glass cards over a soft aurora, large radii.
4. Hybrid: option 2's base with option 1's full prompt card (input line with a caret, suggested questions, resting note).

The owner liked 2 with option 1's prompt block best, found 3 acceptable, and asked which one fits this kind of site.

## Considered options

- *A. Hybrid (mockup 4).* Pros: the editorial base reads as credible to recruiters, hiring managers and engineers; the prompt card is visual and invites questions without making the agent the headline (D-74); it is what ADR-023 already recommended. Cons: the most restrained of the four, so frontend polish shows in the details rather than in effects.
- *B. Bento glass (mockup 3).* Pros: the most current look. Cons: trend-dated within a couple of years (ADR-023); glass in light mode is hard for contrast, which the WP-15 axe check showed in practice; every page of WP-16 would need the card grid.
- *C. Pure Swiss editorial (mockup 2).* Pros: the calmest. Cons: the inline prompt line is easy to miss; the owner preferred the card.
- *D. Several directions switchable from the admin.* Pros: the owner could change the look with one click. Cons: each direction has its own layout, so every WP-16 page and its axe and Lighthouse checks would be built N times, and prerendered pages would need a revalidation flow for the switch. Discarded as overkill.

## Decision

Option A, the hybrid of mockup 4:

- Headings: Fraunces (variable, `opsz` and `SOFT` axes). Body: Inter. Monospace for the prompt, labels and dates: Geist Mono.
- Palette: warm paper and ink in light mode, warm near-black in dark mode, one muted terracotta accent (`--signal`, about `oklch(0.5 0.13 40)` light and `oklch(0.74 0.12 45)` dark). Values are the starting point; WP-16 keeps them only where axe passes.
- Layout: the 12-column editorial grid with thin rules, a large serif headline, the lead beside the prompt card.
- Signature element: Direction 1's command-palette card (`TerminalPrompt` in the mockups), with a caret that blinks a few times and stops (WCAG 2.2.2), suggested questions, and a resting note while the agent is not live.

Discarded: B for durability and light-mode contrast, C because the owner preferred the card, D as overkill. A cheap variant of D stays possible after launch: a few accent presets over the same layout, which only swap tokens.

## Consequences

- WP-16 moves the chosen tokens into `packages/ui/src/theme.css` (a `--signal` accent token joins the theme, `--surface` for the card), points `--font-serif`, `--font-sans` and `--font-mono` at the three faces, promotes `TerminalPrompt` to a real component, and deletes the mockups: the `mockups/` folder, its `routing.pathnames` entries, the `Mockups` messages, the e2e block and the code-map mentions (`apps/web/AGENTS.md` lists them).
- Fonts: prefer `next/font/local` or the `geist` package over `next/font/google` in WP-16, so the image build does not need to reach Google Fonts (ADR-026).
- The site header follows the direction too (fonts included), which the mockups did not do.
- Verify at WP-16: axe with no unchecked contrast in light and dark (the WP-15 e2e pattern), and Lighthouse 95+ with three font families loaded.
- Screenshots of the decision live in a private artifact linked from PR #84, never in the repo.

## Pattern names

Design tokens (one source of truth for color and type), progressive disclosure (the prompt card shows suggested questions before any input), graceful degradation (the page reads complete with the agent resting).
