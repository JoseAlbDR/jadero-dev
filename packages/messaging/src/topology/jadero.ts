import { systemPingV1 } from "@jadero/contracts";
import type { BrokerUser, ConsumerQueue } from "./definitions.js";

/**
 * Every consumer queue of jadero.dev (ADR-029: one queue per consumer and purpose). A new consumer
 * is a line here, then `pnpm --filter @jadero/messaging topology` regenerates
 * `infra/rabbitmq/definitions.json`, and a test fails until it does.
 */
export const JADERO_QUEUES: readonly ConsumerQueue[] = [
  { name: "agent.system.ping", service: "agent", bindings: [systemPingV1.routingKey] },
];

/**
 * The local dev users, with fixed dev passwords like the Postgres roles in compose (never used
 * outside a laptop). `api` publishes through `api-worker`'s relay; `agent` reads its queues.
 */
export const DEV_USERS: readonly BrokerUser[] = [
  { name: "dev", password: "dev", administrator: true },
  { name: "api", password: "api", publishes: true },
  { name: "agent", password: "agent" },
];

/** The dev virtual host; staging and production get `/staging` and `/prod` at deploy (ADR-029). */
export const DEV_VHOST = "dev";
