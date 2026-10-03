---
paths:
  - "infra/**"
  - ".github/workflows/**"
  - "**/Dockerfile"
---
# Infrastructure and delivery rules (ADR-007, ADR-025 to ADR-027)

- Secrets never enter the repo: `infra/env/*.env.tpl` holds `op://` references, the deploy renders them with `op inject`. Never commit a rendered `.env`. CI holds only CI-scoped keys.
- Images: multi-stage, non-root user, read-only root filesystem where possible, `HEALTHCHECK`, one image per service with process types as commands. Tag `<service>:<version>` and `sha-<short>`.
- Compose: every published port binds to `127.0.0.1`; `mem_limit` on every service (ADR-027 table, update it when you add a process); `depends_on` only on Postgres with `condition: service_healthy`; services never depend on each other at startup.
- Migrations are expand-only in the release that ships them; contract migrations ship later. A rollback never needs a down migration.
- Message-schema rollout: consumers that accept the new schema first, producers second.
- Workflows: pin actions by commit SHA; `turbo --affected`; release-please owns versions (one component per service). Agents never run the deploy script, never ssh, never operate the production or staging compose files.
- nginx config is reviewed like code and checked with `nginx -t` in CI.
