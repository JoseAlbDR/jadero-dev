---
name: learn-step
description: The learning gate for a learning work package. Writes docs/learning/wp-NN.md (first principles, one concrete trace, patterns, options, the exact question for the owner) and stops for the owner's decision. Required before code lands under a learning path (hook learning-gate.sh enforces it).
user-invocable: true
arguments: [wp, step]
allowed-tools: Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Bash(git status*), Bash(git branch*), Bash(git diff*), Bash(npm view *), Bash(pnpm view *), Bash(curl -s *), Bash(docker manifest inspect *)
---
Learning gate for WP-$wp (step: $step, or the whole WP if empty).

Read first: the WP row in `docs/plan/report.md` section 14, its GitHub issue, and the ADRs it implements (`docs/adr/`). Then write or extend `docs/learning/wp-$wp.md` from `docs/learning/wp-template.md` (front matter: `wp: $wp`, `decision: pending`, `adr: [ADR-...]`; add `fast_path: known` only when the owner says they already know this step):

1. **First principles**: the concepts this step needs, explained from zero in plain language, one paragraph each. Assume a strong backend engineer who has not used this specific thing.
2. **One concrete trace**: a real request, event or job through the code that will exist, with real payloads, real SQL, real file paths. Numbers, not adjectives. A service WP gets two: the success path and one failure path (a validation error, a dependency down). A tooling WP's trace is a command run with its real output.
3. **Patterns**: the named patterns (so the owner can look them up) and where each one appears in the trace.
4. **Options and trade-offs**: at least two ways to build this step, pros and cons, what the ADR already decided and what is still open at this level.
5. **The question for the owner**: one precise question (or a short list) that the owner must answer before code is written. If the ADR already decides everything, say so and ask only for the go.
6. **Decision**: empty until the owner answers.
7. **Step log**: empty; each implementation step appends two lines (what changed, why).
8. **Recap**: empty; filled with the owner's explain-back and the gaps found.
Make the file self-contained, so the owner learns from it without reading ADRs, other WPs or the plan:
- Right after the intro, a **How to read this file** section: one row per question with the exact parts to read first (section and paragraph names, trace step numbers), about 5 to 10 minutes each.
- A **Named here** table: every WP, ADR or tool named anywhere in the file, with one line saying what it is and when it lands. Never name a later WP without it.
- Every concept a question or an explain-back depends on is explained in First principles, including ones an earlier WP used without teaching. The goal is understanding, never memorizing: questions ask the owner to choose or to describe what they saw, not to recall facts.

For each option, say whether it matches what the ADRs already state about the implementation (library, file, mechanism); an option that departs from an ADR says so, and choosing it means a superseding ADR.

Also: a **Facts checked** table right after the intro (tool, version on the day, source, note), and a **Proposed steps** list after the question (4 to 8 steps, learning or known marked). When a WP includes a spike, its results go under a **Spike results** subsection of Options; a result that changes an answer the owner already gave is recorded under Decision as an amendment with the date, never by editing the original answer.

Facts: version numbers and dates come from the npm registry (`npm view <pkg> version time --json`), Docker Hub or nodejs.org, never from memory; when a documentation site is unreachable, mark the behavior **verify** instead of guessing. The file is `docs/learning/wp-$wp.md` with the number as given, no zero padding (`wp-1.md`, not `wp-01.md`): the gate hook and the session hook look for that exact name. For a tooling WP the "trace" is a command run with its real output; for a service WP it is a request, event or job.

Then STOP. Do not write code. Tell the owner the explainer is ready. Present all the questions in one message, in dependency order: for each, the reading pointer, the problem in two or three sentences, the options, the recommendation and what changes later depending on the answer. When a question depends on another, give its recommendation for each possible answer of the one it depends on instead of waiting. Record the answers under Decision. An explain-back question only covers what the explainer taught and says where; "I don't know" means the explainer has a gap: teach it in the conversation, add it to the explainer, and note it under Recap, without asking the same question again as a test. When they answer, record it under Decision, set `decision: recorded` and the ADR link, and only then start implementing in small visible steps under the step contract of `AGENTS.md` section 5. Style: plain English, no hype words, no em dashes.
