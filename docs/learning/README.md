# Learning explainers

One file per learning work package, `wp-N.md` (the WP number as is, no zero padding: `wp-1.md`, `wp-11.md`), written by `/learn-step` before any code lands under a learning path (hook `.claude/hooks/learning-gate.sh`, ADR-028, report 12.3). The owner reads it, asks until it is mechanical, decides, and only then does implementation start, in small visible steps that append to the step log.

Front matter:

```yaml
wp: 11
decision: pending | recorded
adr: [ADR-030, ADR-012]
fast_path: known        # optional: the owner already knows this step (D-38); skips the full explainer and explain-back
```

Sections, in this order: First principles, One concrete trace, Patterns, Options and trade-offs, The question for the owner, Decision, Step log, Recap. Template: `wp-template.md`.

Each explainer later becomes the raw material of a journal post (ADR-034).
