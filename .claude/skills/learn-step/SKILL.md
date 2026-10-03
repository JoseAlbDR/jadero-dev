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
2. **One concrete trace**: a real request, event or job through the code that will exist, with real payloads, real SQL, real file paths. Numbers, not adjectives.
3. **Patterns**: the named patterns (so the owner can look them up) and where each one appears in the trace.
4. **Options and trade-offs**: at least two ways to build this step, pros and cons, what the ADR already decided and what is still open at this level.
5. **The question for the owner**: one precise question (or a short list) that the owner must answer before code is written. If the ADR already decides everything, say so and ask only for the go.
6. **Decision**: empty until the owner answers.
7. **Step log**: empty; each implementation step appends two lines (what changed, why).
8. **Recap**: empty; filled with the owner's explain-back and the gaps found.

Facts: version numbers and dates come from the npm registry (`npm view <pkg> version time --json`), Docker Hub or nodejs.org, never from memory; when a documentation site is unreachable, mark the behavior **verify** instead of guessing. The file is `docs/learning/wp-$wp.md` with the number as given, no zero padding (`wp-1.md`, not `wp-01.md`): the gate hook and the session hook look for that exact name. For a tooling WP the "trace" is a command run with its real output; for a service WP it is a request, event or job.

Then STOP. Do not write code. Tell the owner the explainer is ready and what question they must answer. When they answer, record it under Decision, set `decision: recorded` and the ADR link, and only then start implementing in small visible steps. Style: plain English, no hype words, no em dashes.
