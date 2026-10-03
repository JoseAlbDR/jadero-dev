---
paths:
  - "packages/ai/**"
  - "packages/agent/**"
  - "apps/agent/**"
---
# AI layer and agent rules (ADR-013 to ADR-021, ADR-031)

- `packages/agent` and `packages/ai` never import Nest or a database driver; they must run from a plain script (evals, LangGraph Studio).
- Own ports where the domain has invariants: `EmbeddingsPort { modelId; dimension; embed(texts, inputType) }`, `RerankerPort`, `KnowledgeIndexPort`, `GuardClassifierPort`. The chat model port is LangChain's `BaseChatModel`. Every adapter, fake included, passes the port's contract suite.
- The embedding model is fixed per `index_version`; changing it is a blue-green re-index, never an in-place update. Queries always filter `index_version = active`.
- Only approved revisions are indexed; the consumer rejects anything else to the dead-letter queue (ADR-031, three checks).
- Guards are deterministic nodes, not prompt text: input rules, classifier, context hygiene (retrieved text is JSON-encoded data), bounded tool loop, output checks (canary, prompt overlap, link allowlist, PII, citations).
- Every tool is read-only, takes a Zod input from `packages/contracts`, returns JSON marked as data, and ships with at least one adversarial eval case. Any prompt change requires an eval run (`EVAL_CONFIRMED=1` and the owner's yes).
- Prompts are versioned files; the prompt version is part of the semantic-cache key and of every trace.
- Never log message bodies at info level; usage rows store counts and verdicts, not text.
