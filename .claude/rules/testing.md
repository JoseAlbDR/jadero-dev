---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/test/**"
  - "**/__tests__/**"
---
# Testing rules (ADR-009)

- Pyramid: unit (Vitest, fakes) for domain and application; contract suites per port, run against every adapter; integration (Testcontainers: `pgvector/pgvector`, RabbitMQ) for repositories, migrations, outbox claims, consumer idempotency, retry tiers; service end-to-end with supertest and fake providers; Playwright smoke per locale for the web.
- Coverage gates: domain and application 90% lines, 85% branches; `packages/agent` and `packages/ai` 90% lines; each service 80% overall. Do not lower a gate to pass; fix or ask.
- Fakes are first-class code (`FakeEmbeddings` hashes n-grams into 1024 buckets so retrieval tests are meaningful). No mocking of our own modules; mock only at ports.
- Every bug fix starts with a failing test that reproduces it.
- Size workers from load: `VITEST_MAX_WORKERS` = 12 minus the 1-minute load average minus 3, between 1 and 6.
- LLM behavior is tested by evals (LangSmith), not by unit tests; evals are not counted in coverage.
