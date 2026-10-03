# Owner review follow-ups (2026-10-03)

Source: your 76 marks in `owner-marks-2026-10-03.json` (picks made on 2026-10-02 UTC). I read every note, not just the picks. Result:

- **53 decided**: your pick stands as it is. Any question in the note is answered in section 3.
- **9 decided with a change**: your pick stands, and your note added something compatible that I applied (section 2). Please check these.
- **14 open**: the note contradicts or materially changes the pick, or there is no pick (section 1). I did not decide these for you. Each has my concrete recommendation.

`decisions.json` and `report.md` carry the same statuses. Where I recommend something new, I added the option with a new letter. No existing id was renumbered, renamed or removed.

## 1. Open: your call (14)

### F-1. D-45 Edge gateway (it also settles the edge part of D-2)
- **You picked:** a, host nginx as the gateway.
- **Your note:** a NestJS gateway appeals for learning, even as one more point of failure. You are unsure despite picking a, the question repeats D-2, and you want the best of both worlds.
- **Conflict:** option a means no gateway service at all; the note asks for one.
- **My recommendation:** new option **d**, two layers that each do what they are good at.
  - *nginx (edge):* TLS, static files (admin SPA, media), the stale page cache that keeps the public site up, coarse per-IP limits and body-size limits.
  - *`gateway` (a thin NestJS service behind nginx, only for `/api/*` on both origins):*
    - routes to `api`, `agent`, `contact` (and `mcp`, if F-4 is b);
    - checks admin sessions (F-3);
    - strips any internal headers that came from outside, then adds correlation ids;
    - applies per-route rate limits;
    - serves one merged OpenAPI document (D-6);
    - passes the chat's SSE stream through, with no buffering or compression on that route.
  - *Rules that keep it thin:*
    - no business logic, no database, no joining data from several services;
    - only outside traffic goes through it, never service-to-service calls;
    - a restart loses nothing.
  - *Cost:*
    - one more hop (about 1 to 3 ms on the same host);
    - about 150 MB of RAM;
    - about 3 to 4 build days (one learning WP);
    - a new single point of failure for `/api/*`. Pages keep serving from nginx's cache, and the health check restarts the gateway.
  - *Patterns you learn:*
    - API gateway, gateway routing and gateway offloading;
    - backends for frontends: one route table for the public audience and one for admin, the same per-audience idea you described from work;
    - reverse proxying with streaming.
  - If you choose d, I add the gateway WP to M1 and amend ADR-002, ADR-008 and ADR-029. I have not added it yet.
- **Your idea of asking firstmate to study the gateway at your employer:** this scout may not open any company repository, so I did not, and the plan does not need it. The public patterns above are the same ones. Whether a separate, pattern-only study is acceptable is for firstmate and you to decide; I flagged it (section 5).

### F-2. D-2 Runtime topology and edge
- **You picked:** a.
- **Your note:** "this one is repeated", plus the gateway wish.
- **Conflict:** the same one as F-1. D-2 predates the service split, and D-45 was added with the split, so D-45 repeats D-2's edge part.
- **My recommendation:** from now on, D-2 covers only the deployables and "same origin per audience" (`jadero.dev`, `admin.jadero.dev`). Your pick a already settles that part. The edge component is decided once, in D-45. If you confirm, I mark D-2 decided (a) as soon as D-45 is decided.

### F-3. D-47 Admin authorization across services
- **You picked:** a, nginx `auth_request` plus a signed header.
- **Your note:** what changes with the NestJS gateway, or with both nginx and the gateway?
- **Answer:** with D-45 d, the check moves from nginx config into the gateway's code (new option **d** here):
  1. The gateway reads the session cookie and validates it against `api` (Better Auth), caching the result for about 30 seconds.
  2. It drops any `X-Admin-*` header that came from outside.
  3. It forwards a signed identity header: an HMAC with an internal key and a timestamp, so a captured header expires.
  4. The services verify the signature exactly as in a.

  For you, auth becomes TypeScript with unit tests instead of nginx config, and nginx no longer runs `auth_request`. If D-45 stays a, D-47 stays a.
- **My recommendation:** d if F-1 is d, otherwise a.

### F-4. D-59 Where the MCP servers run
- **You picked:** a: the public MCP in `agent` and the admin MCP in `api`.
- **Your note:** the MCPs should have their own service, not be mixed into others. Wouldn't b need events to keep the data in sync?
- **Conflict:** your stated preference is b.
- **Answer:** b needs events only if the MCP service keeps its own copy of the data, and it does not have to. As a stateless edge service, it owns no database and needs no sync. It calls the owners' internal endpoints:
  - `agent` for search;
  - `api` for the CV, entries and admin actions;
  - `contact` for intros.

  The gateway can make synchronous calls for the same reason: both are edge adapters that translate an outside protocol (HTTP for browsers, MCP for AI clients) into calls to the owning services. The rule "services never call each other synchronously" still holds between `api`, `agent` and `contact`.
- **My recommendation:** b, reworded as that stateless MCP edge service: `apps/mcp`, hosting both servers on `mcp.jadero.dev`.
  - It costs about 150 MB of RAM, about 1 to 2 extra days, and an internal endpoint on each owning service.
  - If `agent` is down, `search_experience` fails cleanly while `get_cv` still works.
  - OAuth 2.1 for the admin MCP gets one home.

### F-5. D-7 Runtime secrets
- **You picked:** a: secrets only on the server.
- **Your note:** could 1Password, whose CLI you use lately, be an option?
- **Conflict:** adopting 1Password changes where secrets come from.
- **Answer:** yes, and it keeps a's property that GitHub never sees runtime secrets. The setup:
  1. A vault for jadero.dev in a personal 1Password account, never the employer's.
  2. A service account with read-only access to that one vault; its token is stored once on the server.
  3. The repo commits `infra/env/<service>.env.tpl` files that hold references such as `op://jadero-prod/anthropic/api-key`, never values.
  4. The deploy script runs `op inject` to render each service's `.env` (mode 600) right before `docker compose up`.

  What you gain:
  - rotating a key is "change it in 1Password, redeploy";
  - losing the server does not lose the secrets;
  - the templates document which secrets each service needs.

  What it costs:
  - a 1Password plan, if you do not have a personal one;
  - service-account rate limits below the Business plan: 1,000 reads per hour per token, and on Individual and Families 1,000 requests per day across the account. That is plenty for a few deploys a day.
  - a deploy fails while 1Password is unreachable; running services are unaffected.
- **My recommendation:** new option **d** (server-only, sourced from 1Password through `op inject`) if you have or want a personal 1Password account; otherwise a. It would replace the SOPS idea (WP-34) as the "secrets as code" learning item.

### F-6. D-16 RAG pipeline details (no option picked)
- **Your note:** a looks fine, and Qdrant is interesting to learn but probably overkill. You would explore it if the server can run it.
- **Answer:** the server can. A corpus of a few thousand chunks needs well under 512 MB (Qdrant's own benchmark serves a million small vectors in about 1.2 GB), so cap it at 512 MB (verify at WP time).
  - *What Qdrant would teach:*
    - a dedicated vector engine: collections, payload filters, HNSW tuning, quantization;
    - native hybrid search: dense and sparse results fused with RRF in one Query API call;
    - collection aliases, which give the blue-green re-index almost for free (build the new collection, then switch the alias atomically).
  - *What it costs:*
    - a second store to back up and keep consistent with Postgres;
    - no transaction shared between chunks and their metadata;
    - a choice for the semantic cache (D-69): it either moves to Qdrant too or stays in pgvector.
- **My recommendation:** new option **d**. Use pgvector at launch (a) and add a Qdrant adapter behind the existing `KnowledgeIndexPort` as an after-launch learning WP. Run it against the same evals (recall@5, MRR, latency) and adopt it only if it wins.
  - This is exactly what the port exists for, and "swapped the vector store behind a port and let the evals decide" is a stronger story than either store alone.
  - About 3 days, plus 300 to 500 MB while both stores run.

### F-7. D-25 Guard architecture
- **You picked:** a.
- **Your note:** you would not mind Python, because the agentic team uses it a lot. You want the pros and cons of building it all ourselves versus a Python library.
- **Conflict:** the note reopens option c.
- **New fact:** LLM Guard, the Python library option c named, was archived on 2026-07-09 and is no longer maintained, so it is out. The maintained Python choices are:
  - Meta's Prompt Guard 2 (86M), used directly or through LlamaFirewall. It is multilingual including Spanish and German, about 350 MB, and takes roughly 90 ms per check on a CPU (verify at WP time).
  - NVIDIA NeMo Guardrails: broader (dialog rails in Colang) and heavier.
- **Pros of a Python piece:** real Python inside a TypeScript project, the language the agentic team uses, and a polyglot service behind a port.
- **Cons:** a second toolchain (uv, pytest, ruff), an image of about 1 GB with CPU torch, about 500 MB of RAM, and an HTTP hop in the chat path.
- **My recommendation:** new option **e**.
  - Build a for launch: the own TypeScript guard module with the Haiku classifier.
  - After launch, add a small Python `guard-classifier` service (FastAPI plus Prompt Guard 2) as a second adapter behind `GuardClassifierPort`.
  - Call it with a timeout and a circuit breaker that falls back to the Haiku classifier.
  - Keep whichever adapter wins on the adversarial and false-positive evals.
  - It replaces the planned "Prompt Guard 2 in Node through ONNX" experiment. Python enters where it is strongest (running a model), and the chat never depends on it.

### F-8. D-42 How the agent gets content
- **You picked:** a.
- **Your note:** why is data stored twice? The agent's data is what lives in the vector database for RAG, so the api should not know about it. You do not see the duplication or the split between api and agent.
- **Conflict:** you picked a while doubting its premise, so I did not treat it as decided.
- **Answer:** the "twice" is a source of truth plus a search index derived from it, not two copies of the same thing.
  - *`api` owns the content you write and approve:*
    - CV bullets, and knowledge entries with their revisions and approval state;
    - projects, posts and translations.

    The admin edits it there; the site renders the CV, case studies and work-log pages from it; the PDF CV is generated from it.
  - *`agent` owns a search index built from that content:*
    - chunks with contextual headers;
    - embeddings, a full-text column and index versions.

    It can be deleted and rebuilt from `api`'s events at any time.
  - So `api` never sees a vector, and `agent` never edits content. The vector database cannot be the only home for the entries, because chunks and vectors are not the entry: the site needs whole entries, their revisions and their approval state, and any re-embedding must start from the original text.
- **The alternative your note hints at,** now option **c**: the agent owns knowledge entries end to end. That removes the copy, but:
  - the agent becomes a content service as well as a chat service;
  - content is split across two services;
  - an agent outage would stop entry editing and take down the work-log pages.
- **My recommendation:** a, now worded as "source of truth in `api`, derived search index in `agent`" (a CQRS read model). Confirm it, or choose c.

### F-9. D-49 Resilience policies (no option picked)
- **Your note:** not sure, because you do not know "composable" policies. They sound interesting to learn and, if they work well, to propose at work.
- **Answer:** "composable" means small policies stacked around one call. In cockatiel, `wrap(timeout, retry, circuitBreaker)` builds a single policy that:
  - times out a provider call after 10 seconds;
  - retries twice with exponential backoff;
  - opens the breaker after five consecutive failures, so later calls fail at once instead of piling up.

  Each policy is tested on its own, and combining them is one line. cockatiel is a maintained TypeScript library modeled on .NET's Polly: retry, circuit breaker, timeout, bulkhead and fallback.
- **My recommendation:** a (cockatiel). It is small, and something you can propose at work once you have used it here.

### F-10. D-50 Content layers and the approval gate (no option picked)
- **Your note:** you do not fully follow this one. The agent will hold far more detail than the CV in the vector database. Documents could be one or several per topic (bugs, tech debt, performance), or one per big feature; still to be decided.
- **Answer:** what you describe is option a.
  - Layer A is the short CV. Layer B is the detailed knowledge base the RAG answers from.
  - "Approval gate" only means an entry reaches the index after you approve it (`approved: true` plus passing checks).
  - On granularity, the agreed format already says "one entry per distinct piece of work":
    - topics come from each entry's `type`, `domain` and `patterns` fields, so "tech debt" is a filter, not a document;
    - a big feature becomes several entries linked through `related`, optionally with a short overview entry that links them.
- **My recommendation:** a.

### F-11. D-52 Visibility of approved entries (no option picked)
- **Your note:** fine, as long as no proprietary company information is included.
- **Answer:** D-53 enforces exactly that condition: a checklist, a private denylist, the `public_names` allowlist and the importer's checks. Nothing becomes public until you approve it. Anything the agent can read, a visitor can extract, so "approved means public" holds either way; the pages only make it browsable and citable.
- **My recommendation:** a, with your condition recorded on the decision.

### F-12. D-67 Entry metadata policy (no option picked)
- **Your note:** fine, but ask firstmate to prepare the documentation in this format where possible. Sometimes not all the information or metadata will exist, so the design has to fit the data we have.
- **My recommendation:** a, with a tolerant importer.
  - *Required:* `id`, `title`, `type`, `period`, `role` and `approved`, plus the headings `Summary`, `Problem`, `What he built` and `Questions this answers`.
  - *Everything else is optional, with defaults:*
    - a missing `confidence` means medium, so the agent hedges;
    - `stack`, `patterns`, `related`, `public_names` and `sources` default to empty lists;
    - `cv_bullet` defaults to `none`.
  - An empty section produces no chunk, and the word-count rule warns instead of blocking.
  - The importer lists what is missing per entry, so you can fill the gaps later.
- **Your request to firstmate** to prepare entries in this format is flagged in section 5; it is outside this scout.

### F-13. D-73 Site positioning (left open on purpose)
- **Your note:** decide later. You are not full-stack: you know some frontend and have used several frameworks, but have little experience with them. Your focus is backend.
- **What I changed:** the draft line no longer says full-stack. It now reads "a backend engineer who designs, tests, ships and operates whole systems, with applied AI as one of them". It is still a draft for you to rewrite.
- **My recommendation, for when you decide:** a, with that wording. Also rename the "Frontend craft" pillar to "Product delivery" (a fast, accessible site in three languages; El Refugio in production with real users), so the site does not claim frontend depth you do not want to claim.

### F-14. D-75 Launch scope balance
- **You picked:** a.
- **Your note:** "we'll talk about the launch". Build in order, part by part; each version can add features; start with the basics and the foundations; no hard deadline, since this is a personal learning project.
- **Conflict:** a fixes one big launch scope (about 104 days after this review), while the note describes incremental releases with no deadline.
- **My recommendation:** new option **d**, incremental releases without dates.
  - **v1.0** is the first version good enough to replace the old site, about 88 focused days. It contains WP-0 to WP-29 plus WP-35, WP-39, WP-49, WP-50 and WP-51:
    - foundations and the per-service pipeline;
    - the site, the admin and the contact service;
    - the content model and the importer;
    - the agent core with guards, tracing and evals;
    - observability and the game day;
    - content load and cutover.
  - The domain switches at v1.0.
  - Each later milestone then ships as its own release, in order:
    1. the LangSmith learning WP, the eval battery, Under the hood and the chaos test;
    2. the public MCP and `request_intro`;
    3. the recruiter agent and the supervisor;
    4. the admin MCP;
    5. everything else.
  - Milestones keep their order and exit criteria but get no target dates. release-please already versions each service, so every release stays visible.
  - If you choose d, I re-cut section 14 and the milestones.

## 2. Decided with a change I applied (9): please check

- **D-3 Architecture inside each service** (pick a). Your note asked for layers plus abstract classes. Applied as conventions in ADR-003:
  - Layers: controller, then an application service as the orchestrator (your "Service"; called a use case in hexagonal modules), then a repository for data access (your "DAO service", a Drizzle repository class), then the database. Hexagonal modules add ports between the application service and its repositories and providers, plus a domain layer with no framework imports.
  - Ports are abstract classes. This is the idiomatic Nest way: TypeScript interfaces vanish at runtime, so an abstract class serves as both the contract and the DI token (`{ provide: EmbeddingsPort, useClass: VoyageEmbeddings }`). Every adapter implements it, and shared adapter behavior (error mapping, retries) may live in a thin abstract base class.
  - No generic `utils/` folder, because it becomes a junk drawer that everything imports. A helper lives in the module that owns its concept. Shared code across services exists only as named infrastructure packages (`packages/messaging`, `packages/platform-nest`, `packages/contracts`), never as domain code.
- **D-6 Validation and contracts** (pick a). Your note asked for automated OpenAPI documentation. Applied as a new learning WP-51:
  - `@nestjs/swagger` 12 reflects the Standard Schemas passed to Nest 12's decorators into the OpenAPI document through a `standardSchemaConverter`; for Zod, that is the `zod-openapi` library (verify option names at WP time). One Zod schema then drives validation, types and docs.
  - Every service builds `openapi.json` in CI. A docs UI is served outside production (through the gateway, if F-1 is d).
  - A breaking-change checker (for example oasdiff) compares the document against `main` and fails CI on a breaking change.
  - AsyncAPI documents the events.
- **D-12 Reliable asynchronous work** (pick a). Your note asked about atomicity, a small database for dead letters, and event tracking in the admin.
  - *Atomicity, traced.* Your goal, both writes or neither, is the right one, but a try/catch with a rollback cannot reach it, because RabbitMQ is not part of the database transaction. Publishing inside the transaction:
    1. BEGIN; UPDATE the project.
    2. Publish `content.published`. The broker accepts it, and the agent starts indexing.
    3. COMMIT fails (deadlock, dropped connection). The catch rolls back, so the database says nothing changed, but the event cannot be unsent: the agent indexed a revision that does not exist.

    Swap the order (commit, then publish) and the failure flips: the commit succeeds, then the process crashes or the broker is down before the publish, and the event is lost. That is the dual-write problem: two systems with no shared transaction.

    The outbox fixes it by making the second write a row in the same database: BEGIN; UPDATE the project; INSERT INTO outbox; COMMIT. Both commit or neither does, which is your try/catch and rollback, now complete. A relay then publishes the outbox rows and retries until the broker confirms. At worst it publishes twice, and each consumer's inbox table makes the duplicate harmless.
  - *Dead letters and admin.* Applied, with one adjustment: not a separate database, but a `dead_letters` table in each service's own database. The service's consumer process writes it from its dead-letter queue, and the generic code lives once in `packages/messaging`. A central database for every service's failures would be a shared component that all services depend on, which database-per-service avoids.
    - The admin gets an Events page:
      - outbox rows pending and published per event type;
      - consumed and duplicate counts per consumer, from the inbox;
      - retries;
      - dead letters with the original message, the error and the attempt count.
    - A Replay button republishes a dead letter to its original exchange with a `replayed-by` header. Replay is safe because consumers are idempotent.
    - This is new WP-50 (M3).
- **D-13 Provider-agnostic AI layer** and **D-14 Model and provider per role** (pick a for both). Your notes asked which parts are fixed and which can move. Applied as this table, in ADR-013 and ADR-014:

  | Part | Fixed or movable | Why |
  |---|---|---|
  | Embedding model | Fixed per index version; changed only by a planned blue-green re-index | vectors from different models cannot be mixed |
  | Vector dimension (1024) | Fixed | it is the column type |
  | Chunking and contextual headers | Fixed per index version | changing them also means a re-index |
  | Chat model per graph role (guard, answer, recruiter steps, judge) | Movable by config | the model only reads text; no stored data depends on it |
  | Reranker, guard classifier | Movable by config | stateless; evals decide |

  Answers to the questions in those notes:
  - *Embeddings "valid for several models":* embedding models and chat models never talk to each other. The embedding model only turns text into vectors to find chunks, and the chat model receives the chunk text, so any embedding model works with any chat model.
  - *One model for every node, or one per node?* Start with one, Haiku 4.5, everywhere: one key, one price, the simplest evals. Config allows a per-role override (for example `AI_CHAT_MODEL_ANSWER=claude-sonnet-5-5`), adopted only when an eval experiment shows it pays for its price. Switching to Sonnet 5.5 or an OpenAI model is a config change plus an eval run.
  - *Embedding research and data size:* at this size, cost does not decide. The whole corpus is a few hundred thousand tokens, far inside Voyage's 200M free tokens, and a full re-embed elsewhere costs cents. Quality decides: Spanish and German questions over English entries. voyage-4-lite stays the default, and WP-21 measures it against OpenAI `text-embedding-3-small` at 1024 dimensions on the retrieval eval before the index fills up, so the choice is made once, with data.
- **D-17 Conversation state and streaming** (pick a). Your note: you have always used b and would like to learn a; shouldn't stored conversations be encrypted?
  - a streams the first words in under a second instead of after the whole answer, and the checkpointer lets a reload continue the thread. The stream ends with a `final` event carrying the full answer, so b's behavior is a subset of a's.
  - Encryption, applied in WP-22:
    1. Checkpoint payloads are encrypted at rest with AES-256-GCM by a small custom serializer passed to `PostgresSaver`. The JS checkpointer accepts a `serde`; LangGraph's Python package ships an encrypted serializer, the JS one needs our own, about 40 lines (verify at WP time).
    2. The key comes from the runtime secrets, and a key id is stored with each row, so the key can rotate.
    3. Threads are purged after 24 hours.
    4. Checkpoint tables are left out of the off-site backup.
    5. LangSmith traces are masked (D-21).
- **D-38 How learning work packages run** (pick a). Your note asked for a balance between learning and speed. Applied as a fast path: you can mark a WP, or one step, as `known`. Then the gate needs only the decision record, with no full explainer, and you can skip the explain-back for that step.
- **D-65 Entry import and approval source** (pick a). Your note asked for a dynamic CRUD of your knowledge and experience base. Applied:
  - Files still come in through the importer (admin upload or CLI).
  - The admin manages the whole lifecycle:
    - a list of entries with their status;
    - upload a new entry;
    - edit an entry, which creates a new draft revision you approve again;
    - extend an entry by re-importing a file with the same id;
    - withdraw an entry, which removes it from the index at once;
    - delete an entry;
    - export an entry back to the file format.
  - Once imported, the database in `api` is the source of truth, and files are the interchange format.
  - CV bullets are edited the same way and reach the site, the PDF CV and the agent on publish.
- **D-76 Case-study lineup** (pick a). Your note: decide this progressively, and your two years of work at your employer matter too, not only personal projects. Applied:
  - That work appears through the experience timeline (approved CV bullets) and the knowledge entries behind each bullet, which is where the detail lives.
  - The four personal case studies stay as the starting lineup.
  - "A public-level case study from the current role" is now listed in section 2A as something to decide once entries exist. It can only use what you approve (no names, no internals).

## 3. Answers to questions on decided items

- **D-9 Testing:** "how do we fit all this into GitHub Actions, or is that not needed?" CI runs everything on GitHub's runners, not on your server:
  - unit tests;
  - Testcontainers integration tests (GitHub's Ubuntu runners have Docker, so Postgres and RabbitMQ containers start inside the job);
  - event contract tests and coverage gates;
  - the Playwright smoke test.

  The server runs only staging and production. It gets the deploy smoke tests and, before messaging releases, the chaos test (ADR-040). This keeps test load off the machine that serves the site, and it is already the `ci.yml` in ADR-026.
- **D-11 Content approach:** "would Astro make sense for the admin?" No. Astro shines for content sites that ship little JavaScript, and the admin is the opposite: forms, tables, auth and client state, which a Vite plus React SPA handles best while sharing `packages/ui` with `web`. Astro would also add a third frontend framework, and since frontend is result-only for you, fewer frameworks is better.
- **D-18 MCP:** yes. That is the public MCP (5a): anyone adds `mcp.jadero.dev` to Claude (Desktop, Code, or any MCP client) and asks about your experience without using the site's agent. It is in the first release (WP-36, D-58), and a "connect from Claude" page explains the setup.
- **D-21 LangSmith and privacy:** your doubt about the server is right. Self-hosted Langfuse v3 needs Postgres, ClickHouse, Redis or Valkey, S3-compatible storage and two app containers, and its guide plans 4 CPUs and 16 GB of RAM for one VM: twice the whole CX33. LangSmith stays, with privacy handled in code:
  - the EU region;
  - the JS client's `hideInputs`, `hideOutputs` and `createAnonymizer` strip emails, phone numbers and raw job-description text before a trace leaves the server;
  - 14-day retention on the free plan;
  - a mention in the privacy notice.

  Langfuse can be a lab experiment on your own machine later.
- **D-22 Eval gates:** "if spend jumps, can we change it later?" Yes, easily. The triggers are a few lines in `evals.yml` (path-filtered `pull_request`, plus `schedule` for nightly runs), and the per-run budget is an environment variable. Moving from a to b means deleting the `pull_request` trigger; nothing else depends on it.
- **D-41 RabbitMQ client:** "an adapter, in case we ever change brokers?" Option a already has one. Services depend on our `MessageBus` port, and `@golevelup/nestjs-rabbitmq` is one adapter behind it, next to the in-memory adapter for tests, so changing brokers means writing one new adapter. Keep the port small (publish an event, subscribe a handler, ack or retry), so RabbitMQ details stay in the adapter and in `definitions.json`. It is worth it, because tests already need the second adapter.
- **D-43 Message contracts:** "a separate toolbox repository with published package versions?" The monorepo already gives you that toolbox without publishing anything:
  - `packages/contracts`, `packages/messaging` and `packages/platform-nest` are workspace packages that every service imports directly, versioned with the code;
  - a contract change and all its consumers land in one PR, and CI tests them together;
  - each event schema exists once, in `packages/contracts`, so nothing is duplicated.

  A separate repository with versioned npm packages solves sharing across repositories (different teams, different release trains). Here it would add a publish step and a version bump to every change, and let services drift onto different contract versions.
- **D-51 Knowledge-base chunking:** "I don't fully follow, but I like it." In short:
  - each entry is cut at its headings into small chunks (one per section, each with a header naming the entry and the section), because small chunks match questions precisely;
  - when a chunk matches, the agent reads the whole entry (parent expansion, up to about 1,500 tokens), so the answer has the full story;
  - "Ask about this" on a CV line fetches its linked entries by id, with no search at all (drill-down).

  WP-21's explainer traces one question through all three.
- **D-61 Human proof for `request_intro`:** "I don't fully follow, but fine." An AI client calling a tool proves nothing about a human behind it, and MCP clients cannot show a captcha. So the tool only creates a pending request and returns a link. The person opens the link in a browser, passes Turnstile and confirms; only then are you notified. Unconfirmed requests expire after 48 hours. The pattern is out-of-band confirmation, the same idea as an email confirmation link.
- **D-68 Answer feedback:** recorded as c: no feedback in v1. WP-45 moves to after launch as a possible follow-up. For when you reconsider: the planned design never trusted the thumbs. Ratings never change the agent automatically; they only queue answers for your review, so trolls cost you review time, not quality.
- **D-69 Semantic cache:** "could it be done with Qdrant, and is it worth learning?" Yes, technically: the cache would be a second Qdrant collection (the vector, plus a payload of locale, index version, prompt version and cited source ids), and invalidation becomes a delete filtered on source ids. The complexity is similar, there is no real gain at this size, and it teaches little beyond what F-6's Qdrant adapter already would. Keep the cache in pgvector behind its own port; if Qdrant ever replaces the index, move the cache in the same step.

## 4. Notes recorded, no action needed

- **D-4:** learn NestJS 12 here and bring data for a version bump at work. The WP-3 compatibility spike and its journal post give you exactly that data.
- **D-5:** learn Drizzle.
- **D-15:** build the StateGraph yourself with AI help, which is what the learning gate does.
- **D-40:** learn RabbitMQ.
- **D-70:** approved.
- **D-72:** as decided in chat.
- **D-74:** iterate on the home page as we go.

## 5. For firstmate (outside this scout)

1. **D-45:** the owner suggests that firstmate study the gateway in the employer's code, for architecture and patterns only. This scout's rules forbid opening any company repository, and the plan does not depend on it. Firstmate and the captain decide whether such a study is allowed at all.
2. **D-67:** the owner asks firstmate to prepare documentation (knowledge entries) in the agreed format where possible, accepting gaps in metadata. This is content work outside this scout; F-12's tolerant-importer rules say which gaps are acceptable.

## Sources (checked 2026-10-03)

- 1Password service accounts and rate limits: https://developer.1password.com/docs/service-accounts/rate-limits/ , https://developer.1password.com/docs/service-accounts/use-with-1password-cli/
- LLM Guard archived on 2026-07-09: https://github.com/protectai/llm-guard
- Prompt Guard 2: https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M , https://meta-llama.github.io/PurpleLlama/LlamaFirewall/docs/documentation/scanners/prompt-guard-2 ; NeMo Guardrails: https://github.com/NVIDIA-NeMo/Guardrails
- Langfuse self-hosting requirements: https://langfuse.com/self-hosting/configuration/scaling
- `@nestjs/swagger` 12 and Standard Schema: https://newreleases.io/project/github/nestjs/swagger/release/12.0.0 , https://docs.nestjs.com/openapi/introduction
- Qdrant hybrid queries and aliases: https://qdrant.tech/documentation/search/hybrid-queries/ , https://qdrant.tech/documentation/manage-data/collections/ , https://qdrant.tech/articles/memory-consumption/
- LangSmith masking: https://docs.langchain.com/langsmith/mask-inputs-outputs
- LangGraph.js `PostgresSaver` constructor (`serde`): https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-postgres/index/PostgresSaver/constructor
- cockatiel: https://github.com/connor4312/cockatiel
