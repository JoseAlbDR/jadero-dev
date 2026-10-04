import { createHash } from "node:crypto";
import { DEFAULT_RETRY_TIERS_MS } from "../outcome.js";
import {
  DEAD_LETTER_EXCHANGE,
  deadLetterQueueName,
  EVENTS_EXCHANGE,
  retryExchangeName,
  retryQueueName,
  UNROUTED,
} from "./names.js";

/** A consumer queue: who owns it and which routing keys it is bound to. */
export interface ConsumerQueue {
  /** `<service>.<purpose>`, e.g. `agent.system.ping`. */
  readonly name: string;
  /** The service whose broker user may read it, e.g. `agent`. */
  readonly service: string;
  /** Topic bindings on `jadero.events`, usually one exact routing key per contract version. */
  readonly bindings: readonly string[];
}

/**
 * A broker user, named after its service. `publishes` lets it write to `jadero.events`; it reads
 * only its own queues and writes its copies only to its own retry exchange.
 */
export interface BrokerUser {
  readonly name: string;
  readonly password: string;
  readonly publishes?: boolean;
  /** Full rights and the management UI: the local `dev` user only, never staging or production. */
  readonly administrator?: boolean;
}

/** Everything one virtual host needs. */
export interface TopologyInput {
  readonly vhost: string;
  readonly queues: readonly ConsumerQueue[];
  readonly users: readonly BrokerUser[];
  readonly retryTiersMs?: readonly number[];
}

/**
 * RabbitMQ's `rabbit_password_hashing_sha256`: base64 of a 4-byte salt followed by
 * sha256(salt + password). The salt comes from the user name, so the file is stable between runs.
 * Only for the fixed dev and test passwords; real users are created at deploy (WP-8, WP-9).
 */
function passwordHash(user: string, password: string): string {
  const salt = createHash("sha256").update(`salt:${user}`).digest().subarray(0, 4);
  const hash = createHash("sha256")
    .update(Buffer.concat([salt, Buffer.from(password)]))
    .digest();
  return Buffer.concat([salt, hash]).toString("base64");
}

function escapeRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const quorum = (extra: Record<string, unknown> = {}) => ({
  "x-queue-type": "quorum",
  // At-least-once dead-lettering: a message moving to a retry queue or the DLQ cannot be lost on
  // the way (the quorum default is at-most-once), which requires reject-publish overflow.
  "x-dead-letter-strategy": "at-least-once",
  "x-overflow": "reject-publish",
  ...extra,
});

/**
 * Builds the RabbitMQ definitions of one virtual host (WP-5 decisions T4 and R1): the topic
 * exchange with its alternate exchange, the dead-letter exchange, one retry exchange per service
 * for the consumer's retried and dead-lettered copies, and per consumer queue a quorum queue, one
 * wait queue per retry tier (no consumer; its TTL is the timer, then the broker dead-letters it
 * back through the default exchange to that queue only) and a dead-letter queue. Service users get
 * no `configure` right: they cannot declare or delete anything, so the topology lives only here.
 * @param input the vhost, its consumer queues and users.
 * @returns the object RabbitMQ imports with `load_definitions`.
 */
export function buildDefinitions(input: TopologyInput): Record<string, unknown> {
  const { vhost } = input;
  const tiers = input.retryTiersMs ?? DEFAULT_RETRY_TIERS_MS;
  const queues: Record<string, unknown>[] = [];
  const bindings: Record<string, unknown>[] = [];
  const bind = (source: string, destination: string, routing_key: string) =>
    bindings.push({
      source,
      vhost,
      destination,
      destination_type: "queue",
      routing_key,
      arguments: {},
    });
  const queue = (name: string, args: Record<string, unknown>) =>
    queues.push({ name, vhost, durable: true, auto_delete: false, arguments: args });

  queue(UNROUTED, { "x-queue-type": "quorum" });
  bind(UNROUTED, UNROUTED, "");
  for (const consumer of input.queues) {
    const retryExchange = retryExchangeName(consumer.service);
    queue(
      consumer.name,
      quorum({
        "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE,
        "x-dead-letter-routing-key": consumer.name,
        // Explicit, not the implicit 4.x default: a consumer that crashes on a message 20 times
        // (a crash counts, a nack does not) sends it to the DLQ through jadero.dlx.
        "x-delivery-limit": 20,
      }),
    );
    for (const key of consumer.bindings) bind(EVENTS_EXCHANGE, consumer.name, key);
    for (const delayMs of tiers) {
      const wait = retryQueueName(consumer.name, delayMs);
      queue(
        wait,
        quorum({
          "x-message-ttl": delayMs,
          "x-dead-letter-exchange": "",
          "x-dead-letter-routing-key": consumer.name,
        }),
      );
      bind(retryExchange, wait, wait);
    }
    const dlq = deadLetterQueueName(consumer.name);
    queue(dlq, { "x-queue-type": "quorum" });
    bind(DEAD_LETTER_EXCHANGE, dlq, consumer.name);
    bind(retryExchange, dlq, dlq);
  }
  const services = [...new Set(input.queues.map((q) => q.service))];

  const permissions = input.users.map((user) => {
    if (user.administrator)
      return { user: user.name, vhost, configure: ".*", write: ".*", read: ".*" };
    const own = input.queues.filter((q) => q.service === user.name).map((q) => escapeRegex(q.name));
    const writes = [
      ...(user.publishes ? [escapeRegex(EVENTS_EXCHANGE)] : []),
      // Retried and dead-lettered copies go only through the service's own retry exchange.
      ...(own.length > 0 ? [escapeRegex(retryExchangeName(user.name))] : []),
    ];
    return {
      user: user.name,
      vhost,
      configure: "^$",
      write: writes.length > 0 ? `^(${writes.join("|")})$` : "^$",
      read: own.length > 0 ? `^(${own.join("|")})$` : "^$",
    };
  });

  return {
    rabbit_version: "4.3.6",
    users: input.users.map((user) => ({
      name: user.name,
      password_hash: passwordHash(user.name, user.password),
      hashing_algorithm: "rabbit_password_hashing_sha256",
      tags: user.administrator ? ["administrator"] : [],
    })),
    vhosts: [{ name: vhost }],
    permissions,
    exchanges: [
      {
        name: EVENTS_EXCHANGE,
        vhost,
        type: "topic",
        durable: true,
        auto_delete: false,
        internal: false,
        arguments: { "alternate-exchange": UNROUTED },
      },
      {
        name: UNROUTED,
        vhost,
        type: "fanout",
        durable: true,
        auto_delete: false,
        internal: false,
        arguments: {},
      },
      ...services.map((service) => ({
        name: retryExchangeName(service),
        vhost,
        type: "direct",
        durable: true,
        auto_delete: false,
        internal: false,
        // A copy whose queue is missing (tiers out of step with the topology) is kept, not lost.
        arguments: { "alternate-exchange": UNROUTED },
      })),
      {
        name: DEAD_LETTER_EXCHANGE,
        vhost,
        type: "direct",
        durable: true,
        auto_delete: false,
        internal: false,
        arguments: {},
      },
    ],
    queues,
    bindings,
    policies: [],
    parameters: [],
    global_parameters: [],
    topic_permissions: [],
  };
}
