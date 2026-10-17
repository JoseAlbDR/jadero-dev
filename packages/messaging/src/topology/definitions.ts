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
 * What a broker user may do, without its password: the shape the servers use, where passwords come
 * from 1Password at deploy and never from code (WP-8 D4). `publishes` lets it write to
 * `jadero.events`; it reads only its service's queues and writes its copies only to that service's
 * retry exchange.
 */
export interface BrokerAccess {
  /** The user name, e.g. `agent` in dev or `agent_prod` on a server (user names are global). */
  readonly name: string;
  /** The service whose queues it reads, e.g. `agent` for `agent_prod`; defaults to `name`. */
  readonly service?: string;
  readonly publishes?: boolean;
  /** Full rights and the management UI: the local `dev` user, and `ops_admin` over the tunnel. */
  readonly administrator?: boolean;
}

/** A broker user with a password stored in the definitions: dev and test only. */
export interface BrokerUser extends BrokerAccess {
  readonly password: string;
}

/** The queues and users of one virtual host, everything its permissions depend on. */
export interface PermissionInput {
  readonly vhost: string;
  readonly queues: readonly ConsumerQueue[];
  readonly users: readonly BrokerAccess[];
}

/** One user's rights on one virtual host, as `rabbitmqctl set_permissions` and the definitions take them. */
export interface PermissionRow {
  readonly user: string;
  readonly vhost: string;
  readonly configure: string;
  readonly write: string;
  readonly read: string;
}

/** Everything one virtual host needs. Without `users`, the definitions hold no users and no permissions. */
export interface TopologyInput {
  readonly vhost: string;
  readonly queues: readonly ConsumerQueue[];
  readonly users?: readonly BrokerUser[];
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

/**
 * The rights of each user on one virtual host (WP-5 decision T4): an administrator gets `.*`
 * everywhere; a service user gets no `configure` right (it cannot declare or delete anything), may
 * write to `jadero.events` when it publishes and to its service's retry exchange when that service
 * has queues, and reads only its service's queues. One function for the dev definitions and the
 * servers' `permissions.tsv`, so the same service gets the same regexes in every environment.
 * @param input the vhost, its consumer queues and the users to grant.
 * @returns one row per user, in the order of `input.users`.
 */
export function buildPermissions(input: PermissionInput): PermissionRow[] {
  const { vhost } = input;
  return input.users.map((user) => {
    if (user.administrator)
      return { user: user.name, vhost, configure: ".*", write: ".*", read: ".*" };
    const service = user.service ?? user.name;
    const own = input.queues.filter((q) => q.service === service).map((q) => escapeRegex(q.name));
    const writes = [
      ...(user.publishes ? [escapeRegex(EVENTS_EXCHANGE)] : []),
      // Retried and dead-lettered copies go only through the service's own retry exchange.
      ...(own.length > 0 ? [escapeRegex(retryExchangeName(service))] : []),
    ];
    return {
      user: user.name,
      vhost,
      configure: "^$",
      write: writes.length > 0 ? `^(${writes.join("|")})$` : "^$",
      read: own.length > 0 ? `^(${own.join("|")})$` : "^$",
    };
  });
}

/**
 * Renders the servers' `permissions.tsv`, read by `infra/rabbitmq/provision-users.sh`: one
 * tab-separated row per user and vhost (user, vhost, tags, configure, write, read), after a header
 * comment. Tags are comma-separated, `-` when there are none, because a shell `read` with a tab
 * separator merges empty fields.
 * @param inputs one entry per virtual host; a user may appear in several.
 * @returns the file's text, ending with a newline.
 */
export function renderPermissionsTable(inputs: readonly PermissionInput[]): string {
  const lines = [
    "# Generated by `pnpm --filter @jadero/messaging topology` from packages/messaging/src/topology:",
    "# never edit by hand. Read by infra/rabbitmq/provision-users.sh (WP-8 D4).",
    "# Columns, tab-separated: user, vhost, tags (comma-separated, - for none), configure, write, read.",
  ];
  for (const input of inputs) {
    const tagsOf = new Map(
      input.users.map((user) => [user.name, user.administrator ? "administrator" : "-"]),
    );
    for (const row of buildPermissions(input)) {
      lines.push(
        [row.user, row.vhost, tagsOf.get(row.user), row.configure, row.write, row.read].join("\t"),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Every queue is a quorum queue; the type is the only argument, set once at declaration. */
const QUORUM = { "x-queue-type": "quorum" } as const;

/**
 * At-least-once dead-lettering: a message moving to a retry queue or the DLQ cannot be lost on the
 * way (the quorum default is at-most-once), which requires reject-publish overflow.
 */
const SAFE_DEAD_LETTERING = {
  "dead-letter-strategy": "at-least-once",
  overflow: "reject-publish",
} as const;

/**
 * Builds the RabbitMQ definitions of one virtual host (WP-5 decisions T4 and R1): the topic
 * exchange with its alternate exchange, the dead-letter exchange, one retry exchange per service
 * for the consumer's retried and dead-lettered copies, and per consumer queue a quorum queue, one
 * wait queue per retry tier (no consumer; its TTL is the timer, then the broker dead-letters it
 * back through the retry exchange to that queue only) and a dead-letter queue. Queues carry only
 * their type as an argument; TTLs, dead-lettering and the delivery limit are policies, because
 * RabbitMQ cannot change a declared queue's arguments but applies a changed policy at once. Service users get
 * no `configure` right: they cannot declare or delete anything, so the topology lives only here.
 * @param input the vhost, its consumer queues and, for dev and tests, its users.
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

  const policies: Record<string, unknown>[] = [];
  const policy = (queueName: string, definition: Record<string, unknown>) =>
    policies.push({
      vhost,
      name: queueName,
      pattern: `^${escapeRegex(queueName)}$`,
      "apply-to": "queues",
      priority: 10,
      definition,
    });

  queue(UNROUTED, QUORUM);
  bind(UNROUTED, UNROUTED, "");
  for (const consumer of input.queues) {
    const retryExchange = retryExchangeName(consumer.service);
    queue(consumer.name, QUORUM);
    policy(consumer.name, {
      ...SAFE_DEAD_LETTERING,
      "dead-letter-exchange": DEAD_LETTER_EXCHANGE,
      "dead-letter-routing-key": consumer.name,
      // Explicit, not the implicit 4.x default: a consumer that crashes on a message 20 times
      // (a crash counts, a nack does not) sends it to the DLQ through jadero.dlx.
      "delivery-limit": 20,
    });
    for (const key of consumer.bindings) bind(EVENTS_EXCHANGE, consumer.name, key);
    // Expired retries come back through the service's retry exchange, to this queue only.
    bind(retryExchange, consumer.name, consumer.name);
    for (const delayMs of tiers) {
      const wait = retryQueueName(consumer.name, delayMs);
      queue(wait, QUORUM);
      policy(wait, {
        ...SAFE_DEAD_LETTERING,
        "message-ttl": delayMs,
        "dead-letter-exchange": retryExchange,
        "dead-letter-routing-key": consumer.name,
      });
      bind(retryExchange, wait, wait);
    }
    const dlq = deadLetterQueueName(consumer.name);
    queue(dlq, QUORUM);
    bind(DEAD_LETTER_EXCHANGE, dlq, consumer.name);
    bind(retryExchange, dlq, dlq);
  }
  const services = [...new Set(input.queues.map((q) => q.service))];

  const users = input.users ?? [];
  return {
    rabbit_version: "4.3.6",
    users: users.map((user) => ({
      name: user.name,
      password_hash: passwordHash(user.name, user.password),
      hashing_algorithm: "rabbit_password_hashing_sha256",
      tags: user.administrator ? ["administrator"] : [],
    })),
    vhosts: [{ name: vhost }],
    permissions: buildPermissions({ vhost, queues: input.queues, users }),
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
    policies,
    parameters: [],
    global_parameters: [],
    topic_permissions: [],
  };
}
