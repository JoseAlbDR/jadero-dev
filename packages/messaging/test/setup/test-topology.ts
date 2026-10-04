import { systemPingV1 } from "@jadero/contracts";
import { buildDefinitions } from "../../src/index.js";
import { TEST_RETRY_TIERS_MS } from "../support/tiers.js";

/** The vhost of the integration tests. */
export const TEST_VHOST = "test";

/**
 * The integration broker's definitions, built by the same code as the dev ones: two consumer
 * queues for the contract suite, an admin to inspect side queues, and a `test` service user with
 * the same rights a real service gets (publish, read its own queues, no configure).
 */
export const TEST_DEFINITIONS = buildDefinitions({
  vhost: TEST_VHOST,
  queues: [
    { name: "test.a", service: "test", bindings: [systemPingV1.routingKey] },
    { name: "test.b", service: "test", bindings: [systemPingV1.routingKey] },
  ],
  users: [
    { name: "admin", password: "admin", administrator: true },
    { name: "test", password: "test", publishes: true },
  ],
  retryTiersMs: TEST_RETRY_TIERS_MS,
});
