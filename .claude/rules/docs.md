---
paths:
  - "docs/**"
  - "*.md"
  - ".github/**/*.md"
---
# Documentation rules

- Plain English, concise, no hype words, no em dashes (use a comma, a colon or a new sentence).
- ADRs: never edit an accepted one; supersede with a new file from `docs/adr/0000-template.md` and update the index. Every ADR names its owner decisions (`decisions: [D-n]`).
- Learning explainers (`docs/learning/wp-N.md`): front matter `wp`, `decision` (`pending` or `recorded`), `adr`, optional `fast_path: known`; sections Decisions explained (`### D<n>. Why X and not Y?`: problem, example, decision, alternatives with when each wins, patterns; a Mermaid diagram when it helps), Open questions (0 to 2, only architecture no ADR decides) with Recommendations after them, Implementation choices (one line each), One concrete trace, Patterns, Proposed steps, Decision, Step log, Recap, Named here, Facts checked, Delegated details. Everything the owner needs to decide is also given in the chat, so the file is reference, not homework.
- Content rules apply to every document: no employer internals, no client names, no secrets, no local machine paths. The repo becomes public.
- `docs/plan/decisions.json` keeps its schema and ids; new items take the next free id.
