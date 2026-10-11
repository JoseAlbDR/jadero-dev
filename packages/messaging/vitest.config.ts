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
          // test/rabbitmq-message-bus.int.test.ts on a real RabbitMQ: the bus contract suite
          // (publish-subscribe, retry tiers, dead letters, invalid data, unrouted messages, a stopped
          // consumer), a body that is not JSON, a copy the broker refuses (held, put back with a nack,
          // copied once when it accepts) and a malformed attempt header. The pure parts it calls (dispatch, dispose, attemptOf)
          // have unit tests.
          "src/rabbitmq-message-bus.ts",
          // test/outbox-inbox.int.test.ts: the outbox insert commits and rolls back with the caller's
          // transaction on real Postgres.
          "src/outbox/outbox.ts",
          // test/outbox-inbox.int.test.ts: the inbox applies an event once per consumer, rolls back
          // with a failed effect, and the cleanup keeps 30 days.
          "src/inbox/idempotent.ts",
        ],
      },
    },
  }),
);
