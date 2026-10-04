---
name: learn-step
description: The learning gate for a learning work package. Writes docs/learning/wp-N.md (the ADR decisions this WP implements explained as problem, example, decision, alternatives and patterns; the few open questions; the implementation choices) and stops for the owner's go. Required before code lands under a learning path (hook learning-gate.sh enforces it).
user-invocable: true
arguments: [wp, step]
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, WebFetch, WebSearch, Bash(git status*), Bash(git branch*), Bash(git diff*), Bash(npm view *), Bash(pnpm view *), Bash(curl -s *), Bash(docker manifest inspect *)
---
Learning gate for WP-$wp (step: $step, or the whole WP if empty).

## Who does what (orchestrator pattern, `.claude/rules/orchestration.md`)

The main session delegates the drafting and keeps the teaching:
1. Launch the `explainer-writer` agent with the WP number, the step (if any) and anything the owner already said. It reads the sources below, checks the facts, writes the file as this skill defines it, commits, pushes and returns the chat version.
2. Check its report before presenting: the file exists on the branch with `decision: pending`, the decisions match the ADRs it names (open one ADR when a claim looks off), facts marked **verify** are listed, and nothing departs from an ADR without saying so. Ask the `researcher` agent about any fact you doubt.
3. Present the chat version in the main session (section "In the chat" below), then lead the dialogue and record the decision yourself.
The rest of this skill is the specification the agent writes to and the main session checks against.

Read first: the WP row in `docs/plan/report.md` section 14, its GitHub issue, and the ADRs it implements (`docs/adr/`). Then write or extend `docs/learning/wp-$wp.md` from `docs/learning/wp-template.md` (front matter: `wp: $wp`, `decision: pending`, `adr: [ADR-...]`; add `fast_path: known` only when the owner says they already know this step).

## What the owner wants to learn (2026-10-04)

The owner orchestrates agents and wants to make design decisions alone, or at least know the alternatives for a use case. So the explainer teaches **design, architecture and patterns**: why a decision was taken, what else was possible, why the alternatives were discarded here, and when one of them would win instead. It does **not** turn implementation details into questions: most big decisions were already taken in the ADRs, and the owner needs to understand them, not re-decide them one parameter at a time. Learning comes from repetition across WPs and projects: when a concept or pattern from an earlier WP appears again, say so in one sentence ("the same idempotency as WP-N, here applied to ...") and what is different this time.

Tiers still sort every concept: **Own** (boundaries, consistency and delivery semantics, failure modes, data flow and privacy, observability, data modeling, the cost of changing a decision: explained and checked), **Recognize** (named patterns: enough to name and spot them), **Delegate** (library APIs, config syntax, versions: the appendix "Delegated details", never asked).

## The file

1. **Decisions explained** (the core, first after the intro). One heading per decision the WP implements, phrased as a question: `### D1. Why <X> and not <Y>?`. Each block, in plain language a strong backend engineer new to the topic understands, in this order:
   - **Problem**: what goes wrong without a decision, in two or three sentences.
   - **Example**: one concrete case with real names and numbers from this project (a publish, a ping, a contact form), showing the failure.
   - **Decision**: what was chosen and where (ADR number), and why, in a few sentences.
   - **Alternatives**: three or more, each with what it is, why it was discarded here, and **when it would win** (the use case where you would pick it).
   - **Patterns**: the names to recognize, at the end of the block.
   - A **diagram** (Mermaid, which GitHub renders) when it makes the mechanism clearer than text: a flow across processes, a queue topology, a sequence with a failure. Not by default.
   Decisions an earlier WP already explained get one sentence and the earlier file's heading, unless this WP uses them differently.
2. **Open questions** (usually 0 to 2). Only choices that are architecture (they change a boundary, a failure mode, a data flow or what is expensive to change later) and that no ADR decides. Same shape as a decision block (problem, example, options with when each wins, patterns), then the question. The recommendation goes in a separate **Recommendations** block after the questions, read after answering.
3. **Implementation choices**: what the agent will do for everything else, one line each with a short why ("the relay polls every second: a few events a day, a second of delay is invisible"). The owner reads and objects only if something looks wrong. Never a question per line.
4. **One concrete trace**: the success path and one failure path through the code that will exist, with real payloads, SQL and file paths, numbered steps (`### Trace 1: ...`). Reference for the explain-back; the decision blocks may point at a step.
5. **Patterns**: a table of every pattern named in the file and where it appears, so the owner can tell similar ones apart.
6. **Proposed steps** (4 to 8, learning or known marked), **Decision**, **Step log**, **Recap** (empty until filled), then the reference appendix: **Named here** (every WP, ADR or tool named, one line each, when it lands), **Facts checked** (tool, version on the day, source, note), **Delegated details**.

Each decision and open question says whether an option departs from an ADR; choosing one means a superseding ADR (`/adr`).

Facts: version numbers and dates come from the npm registry (`npm view <pkg> version time --json`), Docker Hub or nodejs.org, never from memory; when a documentation site is unreachable, mark the behavior **verify** instead of guessing. The file is `docs/learning/wp-$wp.md` with the number as given, no zero padding (`wp-1.md`, not `wp-01.md`): the gate hook and the session hook look for that exact name. For a tooling WP the trace is a command run with its real output. When a WP includes a spike, its results go under a **Spike results** subsection; a result that changes an answer the owner already gave is recorded under Decision as an amendment with the date, never by editing the original answer.

## In the chat

Commit the explainer (`docs(learning): ...`) and push the branch (the main session does it when this skill's tools do not allow it). Then STOP: no code. In one message, so the owner does not have to open the file to decide:

1. The **decisions explained**, in the same shape (problem, example, decision, alternatives with when each wins, patterns), short and simple, with a diagram where it helps.
2. The **implementation choices** list.
3. The **open questions**, if any, each with what the owner needs to know right before it, then one **Recommendations** block after the last question (collapsed, read after answering; a question that depends on another gets a recommendation per possible answer).
4. One line: "Say go, object to any choice, or answer the questions."

Follow "How the owner learns" in `AGENTS.md` section 5. The owner's answers are a starting point, not an order: when an answer differs from the recommendation or carries a risk, say so, explain why, and discuss it before recording. The owner learns most from that dialogue. Record the outcome under Decision, set `decision: recorded` and the ADR link, and only then implement in small visible steps, each through `/step` (the step contract of `AGENTS.md` section 5).

An explain-back question only covers what the explainer taught and says where; "I don't know" means the explainer has a gap: teach it in the conversation, add it to the explainer, and note it under Recap, without asking the same question again as a test. Style: plain English, no hype words, no em dashes.
