# Owner intent for jadero.dev v2

The owner's own ask, as recorded during planning. Paths under /Users/... point to the planning machine; the copies you need are in this folder.

## Intent
Plan the build of jadero.dev v2, the personal site that replaces the outdated jadero.dev portfolio: a modern multilingual (es, en, de) portfolio that works as a cover letter for an internal move to an agentic AI team, with an "ask about me" AI agent, a NestJS backend, CI/CD with automated versioning, hosted on the owner's Hetzner CX33 server. Every decision taken so far is in /Users/jadero/firstmate-fwmate/data/jadero-dev-v2/brainstorm.md (sections, stack, answers); read it fully, it is binding.

Learning is a hard requirement: the owner wants to be involved and learn every backend and agent step (agents, flows, tools, MCP, RAG, vector DB, LangGraph.js, LangSmith, NestJS architecture, patterns, testing, CI/CD). For each choice the plan must explain why it was chosen, which options were discarded and why, so the owner makes the call. Frontend and Next.js he does not need to learn; the plan proposes a current, modern design with light and dark modes.

Steps agreed: (1) content material from his GitHub triage plus a public-level summary of his work experience supplied later; (2) private repo JoseAlbDR/jadero-dev (created); (3) this plan, with explanations of chosen and discarded options; (4) plan review with the owner, deciding each backend and agent pattern, recorded as ADRs; (5) build by work packages, backend and agent explained step by step; (6) deploy first to new.jadero.dev, then switch jadero.dev and retire the old site and its pm2 services.

Repo triage input: /Users/jadero/firstmate-fwmate/data/gh-catalog-triage/report.md (portfolio picks: LangChainAssistant back+front pair as AI case study, practica-node-avanzado, nodepop-fullstack, jobs-hub; all old demos dead). A local, unpublished project ~/dev/projects/confluence-agent (NestJS multi-provider RAG with reranker) is a candidate case study pending a check; treat it as a possible content item only.

Everything should be Claude friendly: maybe the owner's own Claude Code framework could be used to implement it, though it has its own gates like the learning one and it is not exactly the Mercanis stack; at minimum the repo has a CLAUDE.md and everything needed to work with agents and keep expanding and updating it in the future.

Other providers such as OpenAI can be used for embeddings or anything else; it does not have to be Anthropic, whatever fits this use case best. Being able to switch between providers would also be good, like the owner's confluence-agent project (not an exact copy): provider agnostic, with adapters and a hexagonal design, he thinks.

The artifact is too oriented to the agentic team. The goal is to gain demonstrable experience to move to that team, but not everything should point there: if the owner ever left Mercanis, this page and everything being built should also demonstrate his knowledge across many areas, not only agentic work. The content and the way the project is built must not be tightly coupled to the agentic team. He is still reviewing and answering in the artifact.
