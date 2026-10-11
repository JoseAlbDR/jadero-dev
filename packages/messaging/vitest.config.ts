import { baseConfig } from "@jadero/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Adapters proven only by an integration suite against real RabbitMQ or Postgres (ADR-009): left out
// of the unit number, each with the suite that proves it.
export default mergeConfig(
  baseConfig(),
  defineConfig({
    test: {
      coverage: {
        exclude: [
          // test/rabbitmq-message-bus.int.test.ts: the bus contract suite, retry tiers, dead letters
          // and broker permissions on a real RabbitMQ.
          "src/rabbitmq-message-bus.ts",
          // test/outbox-inbox.int.test.ts: the outbox insert commits and rolls back with the caller's
          // transaction on real Postgres.
          "src/outbox/outbox.ts",
          // test/outbox-inbox.int.test.ts: the inbox applies an event once per consumer, rolls back
          // with a failed effect, and the cleanup keeps 30 days.
          "src/inbox/idempotent.ts",
          // test/outbox-inbox.int.test.ts: every case runs inside inTransaction, the commit and the
          // rollback paths both.
          "src/sql/sql-executor.ts",
        ],
      },
    },
  }),
);
