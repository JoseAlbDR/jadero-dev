---
paths:
  - "docs/**"
  - "*.md"
  - ".github/**/*.md"
---
# Documentation rules

- Plain English, concise, no hype words, no em dashes (use a comma, a colon or a new sentence).
- ADRs: never edit an accepted one; supersede with a new file from `docs/adr/0000-template.md` and update the index. Every ADR names its owner decisions (`decisions: [D-n]`).
- Learning explainers (`docs/learning/wp-NN.md`): front matter `wp`, `decision` (`pending` or `recorded`), `adr`, optional `fast_path: known`; sections First principles, One concrete trace, Patterns, Options and trade-offs, The question for the owner, Decision, Step log, Recap.
- Content rules apply to every document: no employer internals, no client names, no secrets, no local machine paths. The repo becomes public.
- `docs/plan/decisions.json` keeps its schema and ids; new items take the next free id.
