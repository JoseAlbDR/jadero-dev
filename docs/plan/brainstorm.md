# jadero.dev v2 - brainstorm (2026-10-02, captain + fwmate)

Captain's ask: replace the outdated jadero.dev portfolio (Vite/React static build on the Hetzner server) with a modern, multilingual (es, en, de at least) personal site that works as his cover letter: real current experience (Mercanis at a public level only), stack, skills incl. Claude Code and his framework, selected GitHub projects, El Refugio (Next.js + Payload CMS on Vercel, years in production). Hosted on his own Hetzner server (subdomains of jadero.dev are free to use). Wants to learn LangChain/LangGraph/LangSmith via an "ask about me" AI agent with its own tools/skills/MCP. Open to ideas; launch together with the next framework batch. pm2->Docker migration of the old services is dropped: the new site replaces the old one and its backend (jadero-backend, recaptcha) retires with it.

## Proposed sections
1. Hero + "ask me" agent (RAG over CV/projects/posts, cites sources).
2. Experience timeline (Mercanis public-level only: role, stack, problem types, impact; main firstmate can give a sanitized summary, or the captain writes it).
3. Case studies: El Refugio; the Claude Code framework (agent fleet governance, guards, ticket flow, releases); jadero.dev itself.
4. Selected projects: jobs-hub (live), LangChainAssistantFront/Back, ReactGPT(+Back), Nest-Microservices, pdf-reports, Teslo-shop, nodepop-fullstack, the-wild-oasis, amplify-jsquiz (5 stars).
5. "Early projects" compact archive grid linking repos (bootcamp, Python games).
6. Stack and skills, with an applied-AI section.
7. MDX blog/notes.
8. Generated per-language PDF CV from the same content.

## Proposed stack
Turborepo + pnpm; Next.js App Router, next-intl, Tailwind v4, shadcn/ui, Motion; agent service with LangGraph + LangSmith + RAG; Postgres + pgvector in Docker on the server, Drizzle; NestJS only if the backend grows. Docker Compose behind existing nginx + certbot; GitHub Actions -> GHCR -> SSH deploy; stage on new.jadero.dev then swap. Extras: Umami analytics, Uptime Kuma status.jadero.dev, lab.jadero.dev.

## Open captain decisions (asked 2026-10-02, unanswered)
1. Agent language: Python LangGraph (rec, market standard, learning goal) vs TypeScript LangGraph.js (one stack).
2. Content: MDX in repo (rec for v1) vs Payload CMS.
3. Agent LLM cost: pay-per-use API key, Haiku, per-visitor rate limit and a spend cap.
4. Who creates the GitHub repo (suggested name jadero-dev).
Next step after answers: a planning worker writes the full plan (architecture, WPs, design, content), captain reviews, build runs alongside the next framework batch.

## Captain's answers (2026-10-02 evening)
- Sections 1-9 accepted, plus light/dark mode. Design: current and modern; the captain does not know design, so the plan proposes it.
- Mercanis content: the main firstmate may run a cheap scout over all his Mercanis commits/services to catalog features, fixes and improvements. Mercanis isolation holds: that catalog stays in the main home; only public-level text the captain approves crosses into this project.
- Old repos: triage by reading the code before choosing (Sonnet worker, gh-catalog-triage).
- Backend: NestJS, well architected, modern architecture, best practices, good coverage; architecture and patterns decided together with the captain per requirement. It must showcase backend engineering.
- CI/CD accepted, with automated versioning (semantic-release or Changesets from conventional commits), jobs for tests, secrets handling.
- Extras accepted (Umami, Uptime Kuma, lab subdomain).
- Language: TypeScript everywhere, including the agent (LangGraph.js, LangSmith).
- LEARNING IS A HARD REQUIREMENT for everything agent-side (agents, flows, tools, MCP, RAG, vector DB, LangGraph, LangSmith) and all backend: the captain is involved in every step, every pattern and architecture is explained and decided with him (ADRs in the repo). Frontend/Next.js he does not need to learn. Goal: a complete project to present.
- Content admin: open; MDX and Payload explained; fwmate recommendation: own content module in NestJS + admin panel in Next (showcases backend) vs Payload.
- Agent: Haiku-class pay-per-use, rate limit per IP and time window, and every security harness possible against prompt injection, prompt/system leakage and jailbreaks (research OWASP LLM Top 10 and existing guardrail projects).

## State (2026-10-02 ~21:50 Madrid)
- Repo JoseAlbDR/jadero-dev created private (squash only, delete branch on merge), initial commit pushed by the captain, registered [no-mistakes-prod-only], cloned at projects/jadero-dev.
- Plan done: data/jadero-dev-plan/report.md (28 draft ADRs, 38 decisions D-1..D-38 in section 13, WPs in section 14). Plan scout jadero-dev-plan is paused at ~327k context; recommended to the captain: close it (complete + teardown) rather than compact, publish the plan as a designed HTML artifact, and run WP-0 as a fresh walk-through session by area (backend, AI/agent, security, CI/CD and server). Awaiting his yes.
- Captain additions relayed to the planner: Claude-friendly repo (CLAUDE.md, skills, maybe his framework); provider agnostic (hexagonal, OpenAI etc. allowed).
- Public CV draft from main copied to the data folder: every line is draft until the captain approves; its Do-not-claim list is a hard rule. Main covers the employer's internal repositories (an internal RAG tool and an internal reporting tool among them); fwmate never re-scans those.
- Captain asked (21:55) for microservices where possible so one failure does not take down others. fwmate proposal, awaiting his "sigue con el orden": modular monolith api + extracted services: agent (LangGraph/RAG, chat degrades to resting state), worker (indexing, PDF CV, emails from a queue), contact (form + Turnstile, event to mail sender), admin as a separate Next app; RabbitMQ as the bus (Nest native transport) with outbox, idempotency, DLQ, circuit breaker web->agent; warn against a distributed monolith. Changes ADR 002/003/012: fresh short plan-amendment worker, then a designed artifact with two tabs (plan decisions D-1..D-39 with choose/comment stored via ArtifactData; public CV draft lines approve/edit/drop). Agreed order: compact, close jadero-dev-plan scout, amendment worker, artifact, captain marks, explanation session, WP-1. Manual items for him: Anthropic/Voyage/LangSmith/Turnstile/GitHub OAuth/Tailscale/mail accounts, DNS for new/stats/status/mcp/lab, Hetzner firewall SSH close after Tailscale, content and photo.
- 2026-10-02 ~22:30: captain approved adding recruiter mode, under-the-hood page, build journal, /now, all five MCPs (public profile, job match + prompt, request_intro via RabbitMQ, private admin MCP with OAuth 2.1, framework catalog), eval battery + LangSmith learning WP; sent to jadero-dev-plan with a no-renumber rule (captain is marking ids). Review pages: a CV draft page (reviewed), jadero.dev v2 Plan page (marks in db collection "marks"; republish data.json from data/jadero-dev-plan/decisions.json after the amendment). Main has round 2 request + addendum + entry format. Captain finishes marking tomorrow; tone, photo and agent name decided later.
- 2026-10-02 ~22:40: captain decided tickets = GitHub Issues with sub-issues + GitHub Project + milestones in JoseAlbDR/jadero-dev (shows he can use those tools). Framework follow-up idea: core plugin /ticket reading GitHub Issues, not only Jira (fold into fw-core-pack-split).
- 2026-10-02 ~22:55 pause point: plan artifact v3 live (72 decisions, D-72 marked decided by fwmate on his word, 5 earlier marks kept). Planner jadero-dev-plan paused at ~520k context, kept alive on purpose to apply the captain's marks tomorrow (captain said burn the weekly usage; do not close it). Tomorrow: read marks from the plan page, send the planner the decisions and every need-detail note, republish, then explanation session for flagged items, then GitHub issues/epic and WP-1. Main is working on content round 2 (missing items, Layer B entries in knowledge-entry-format.md, workshop docs).
