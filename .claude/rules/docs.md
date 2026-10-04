---
paths:
  - "docs/**"
  - "*.md"
  - ".github/**/*.md"
---
# Documentation rules

- Plain English, concise, no hype words, no em dashes (use a comma, a colon or a new sentence).
- ADRs: never edit an accepted one; supersede with a new file from `docs/adr/0000-template.md` and update the index. Every ADR names its owner decisions (`decisions: [D-n]`).
- Learning explainers (`docs/learning/wp-N.md`): front matter `wp`, `decision` (`pending` or `recorded`), `adr`, optional `fast_path: known`; sections How to read this file, Named here, Facts checked, First principles (concepts labelled Own, Recognize or Delegate), One concrete trace, Patterns, Options and trade-offs (forces, at least three options, what would make it wrong), The question for the owner, Recommendations (read after answering), Proposed steps, Decision, Step log, Recap, Delegated details.
- Content rules apply to every document: no employer internals, no client names, no secrets, no local machine paths. The repo becomes public.
- `docs/plan/decisions.json` keeps its schema and ids; new items take the next free id.
