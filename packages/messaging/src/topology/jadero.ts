import { systemPingV1 } from "@jadero/contracts";
import type { BrokerAccess, BrokerUser, ConsumerQueue } from "./definitions.js";

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

/** The dev virtual host; staging and production get `/staging` and `/prod` (ADR-029). */
export const DEV_VHOST = "dev";

/** A server environment's virtual host and the users that may reach it. */
export interface ServerEnvironment {
  readonly name: "prod" | "staging";
  readonly vhost: string;
  readonly users: readonly BrokerAccess[];
}

/**
 * The management UI's administrator on the servers, reached only over the tunnel (ADR-050). It
 * has rights on both vhosts, so it appears in each environment.
 */
export const OPS_ADMIN: BrokerAccess = { name: "ops_admin", administrator: true };

/**
 * The servers' environments (WP-8 D4, ADR-029): one vhost each, and per service a user named
 * `<service>_<env>`, because user names are global and staging and production share one broker.
 * No passwords here: `infra/rabbitmq/provision-users.sh` reads them from the environment at deploy.
 */
export const SERVER_ENVIRONMENTS: readonly ServerEnvironment[] = (["prod", "staging"] as const).map(
  (name) => ({
    name,
    vhost: `/${name}`,
    users: [
      { name: `api_${name}`, service: "api", publishes: true },
      { name: `agent_${name}`, service: "agent" },
      OPS_ADMIN,
    ],
  }),
);
