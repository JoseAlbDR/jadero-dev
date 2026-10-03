---
id: ADR-023
title: "Design system and visual direction"
status: accepted
date: 2026-10-03
deciders: [owner]
decisions: [D-23, D-74]
supersedes: []
superseded_by: null
source: docs/plan/report.md ("ADR-023: Design system and visual direction (amended 2026-10-02; reframed 2026-10-03)")
---

# ADR-023: Design system and visual direction

**Status:** Accepted (owner review 2026-10-03, D-23); the WP-15 mockups confirm the direction.

Decided by the owner in the plan review of 2026-10-02 and 2026-10-03 (decisions D-23, D-74). This record was extracted verbatim from `docs/plan/report.md`; the narrative, traces and sources stay there. From now on this file is the canonical record: a new decision is a new ADR that supersedes this one, never an edit.

## Foundation (all directions)

Tailwind v4 with CSS-first tokens (`@theme`, OKLCH colors, `@theme inline` mapping light/dark variables), shadcn/ui components owned in `packages/ui`, `next-themes` for light, dark and system with no flash on load, Motion for restrained transitions that respect `prefers-reduced-motion`, self-hosted fonts through `next/font`, lucide icons. Targets: WCAG 2.2 AA (axe in CI), Lighthouse 95+ on content pages, LCP under 2 s on mobile, the chat bundle lazy-loaded so content pages ship little JavaScript.

## Direction 1, "Terminal editorial"

Developer-native. A clean sans for body (Geist or Inter) with a monospace accent (Geist Mono or JetBrains Mono) for labels, dates and the agent. Dark mode near-black with a single vivid accent (phosphor green or amber); light mode warm paper white with the same accent darkened for contrast. The hero is a command-palette style prompt ("ask me anything about my work") with a blinking caret and suggested questions; case studies read like changelogs with version-style dates; a faint dot grid in the background. Strong developer-tooling feel; risks: a cliche if overdone, and it frames the whole site around the agent.

## Direction 2, "Swiss editorial"

Calm and senior. Large typographic hierarchy with a variable serif for headings (Fraunces or Instrument Serif) and a neutral sans for body, generous whitespace, a strict 12-column grid, monochrome palette with one muted accent (ink blue or terracotta). The agent lives in a quiet side panel opened from the hero. Reads like a well-made publication; timeless and recruiter-friendly; less overtly "AI".

## Direction 3, "Bento glass"

Contemporary and showy. A bento grid hero (agent card, current role card, stack card, featured case study card), soft aurora gradients behind glass surfaces in dark mode, large rounded corners, playful micro-interactions on hover. Shows frontend polish; risk: trend-dated within two years, and glass needs care for contrast in light mode.

## Decision

Direction 2 as the base with Direction 1's terminal-style prompt as one signature element: an editorial base that reads as credible to any engineering audience, plus one memorable interactive element that invites questions without making the agent the whole story (section 2A). WP-15 builds three throwaway hero mockups so the owner picks from screenshots, not words (D-23).
