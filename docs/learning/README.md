# Learning explainers

One file per learning work package, `wp-N.md` (the WP number as is, no zero padding: `wp-1.md`, `wp-11.md`), written by `/learn-step` before any code lands under a learning path (hook `.claude/hooks/learning-gate.sh`, ADR-028, report 12.3). The owner reads it, asks until it is mechanical, decides, and only then does implementation start, in small visible steps that append to the step log.

Front matter:

```yaml
wp: 11
decision: pending | recorded
adr: [ADR-030, ADR-012]
fast_path: known        # optional: the owner already knows this step (D-38); skips the full explainer and explain-back
```

Each file is self-contained: the owner never needs an ADR, another WP or the plan to answer its questions. Sections, in this order: Decisions explained (each ADR decision the WP implements: problem, example, decision, alternatives with when each would win, patterns), Open questions (0 to 2) and Recommendations, Implementation choices, One concrete trace (two for a service WP), Patterns, Proposed steps, Decision, Step log, Recap, Named here, Facts checked, Delegated details. The session gives the decisions, choices and questions in the chat too. Template: `wp-template.md`.

Each explainer later becomes the raw material of a journal post (ADR-034).
