import { systemPingV1 } from "@jadero/contracts";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addToOutbox,
  cleanupInbox,
  done,
  InMemoryMessageBus,
  idempotent,
  inTransaction,
  type MessageBus,
  migrateMessagingSchema,
  OutboxRelay,
  type OutgoingMessage,
} from "../src/index.js";
import { createTestDatabase } from "./setup/test-database.js";

let pool: pg.Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createTestDatabase();
  drop = database.drop;
  pool = new pg.Pool({ connectionString: database.url, max: 6 });
  await migrateMessagingSchema(pool);
  await migrateMessagingSchema(pool); // idempotent: safe on every migrate
  await pool.query("CREATE TABLE heartbeat (source text PRIMARY KEY, seen integer NOT NULL)");
});

afterAll(async () => {
  await pool.end();
  await drop();
});

beforeEach(async () => {
  await pool.query("TRUNCATE messaging.outbox, messaging.inbox, heartbeat");
});

/** A bus that records what it is asked to publish, or fails every publish. */
class RecordingBus extends InMemoryMessageBus {
  readonly sent: OutgoingMessage[] = [];
  constructor(private readonly failing = false) {
    super();
  }
  override async publish(message: OutgoingMessage): Promise<void> {
    if (this.failing) throw Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" });
    this.sent.push(message);
  }
}

async function ping(trigger: "manual" | "heartbeat" = "manual") {
  return inTransaction(pool, (tx) => addToOutbox(tx, systemPingV1, { trigger }, "jadero/api"));
}

describe("transactional outbox", () => {
  it("writes the event in the caller's transaction: a rollback leaves no row (no dual write)", async () => {
    await expect(
      inTransaction(pool, async (tx) => {
        await addToOutbox(tx, systemPingV1, { trigger: "manual" }, "jadero/api");
        throw new Error("the state change failed");
      }),
    ).rejects.toThrow("the state change failed");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM messaging.outbox");
    expect(rows[0].n).toBe(0);
  });

  it("the relay publishes due rows with their routing key and marks them published", async () => {
    const envelope = await ping();
    const bus = new RecordingBus();
    const relay = new OutboxRelay({ pool, bus: bus as MessageBus });
    expect(await relay.runOnce()).toEqual({ published: 1, failed: 0 });
    expect(bus.sent).toEqual([{ routingKey: "system.ping.v1", envelope }]);
    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0 });
    const { rows } = await pool.query("SELECT published_at FROM messaging.outbox");
    expect(rows[0].published_at).toBeInstanceOf(Date);
  });

  it("two relays at once never claim the same row (FOR UPDATE SKIP LOCKED)", async () => {
    for (let i = 0; i < 40; i++) await ping();
    const bus = new RecordingBus();
    const relays = [1, 2, 3].map(
      () => new OutboxRelay({ pool, bus: bus as MessageBus, batchSize: 5 }),
    );
    for (let round = 0; round < 10; round++) await Promise.all(relays.map((r) => r.runOnce()));
    const ids = bus.sent.map((m) => m.envelope.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  });

  it("a failed publish counts the attempt, backs the row off and keeps only the error kind", async () => {
    await ping();
    const relay = new OutboxRelay({ pool, bus: new RecordingBus(true) as MessageBus });
    expect(await relay.runOnce()).toEqual({ published: 0, failed: 1 });
    const { rows } = await pool.query(
      "SELECT attempts, last_error, next_attempt_at > now() AS later, published_at FROM messaging.outbox",
    );
    expect(rows[0]).toEqual({
      attempts: 1,
      last_error: "Error (ETIMEDOUT)",
      later: true,
      published_at: null,
    });
    // Not due yet: the next poll leaves it alone instead of hammering a broker that is down.
    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0 });
  });

  it("cleanup deletes published rows past the retention and keeps unsent ones", async () => {
    await ping();
    await ping();
    await pool.query(
      "UPDATE messaging.outbox SET published_at = now() - interval '8 days' WHERE id = (SELECT id FROM messaging.outbox ORDER BY created_at LIMIT 1)",
    );
    const relay = new OutboxRelay({ pool, bus: new RecordingBus() as MessageBus });
    expect(await relay.cleanup()).toBe(1);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM messaging.outbox");
    expect(rows[0].n).toBe(1);
  });
});

describe("idempotent consumer (inbox)", () => {
  function handler(onDuplicate?: () => void) {
    return idempotent<typeof systemPingV1>(
      pool,
      async (tx, delivery) => {
        await tx.query(
          `INSERT INTO heartbeat (source, seen) VALUES ($1, 1)
           ON CONFLICT (source) DO UPDATE SET seen = heartbeat.seen + 1`,
          [delivery.envelope.source],
        );
      },
      onDuplicate,
    );
  }

  it("applies the same event once, however often it is delivered", async () => {
    const envelope = await ping();
    let duplicates = 0;
    const handle = handler(() => duplicates++);
    for (const attempt of [1, 1, 2]) {
      expect(await handle({ envelope, attempt, queue: "agent.system.ping" })).toEqual(done());
    }
    const { rows } = await pool.query("SELECT seen FROM heartbeat");
    expect(rows[0].seen).toBe(1);
    expect(duplicates).toBe(2);
  });

  it("keys by consumer: another consumer in the same database still applies it", async () => {
    const envelope = await ping();
    await handler()({ envelope, attempt: 1, queue: "agent.system.ping" });
    await handler()({ envelope, attempt: 1, queue: "agent.usage.ping" });
    const { rows } = await pool.query("SELECT seen FROM heartbeat");
    expect(rows[0].seen).toBe(2);
  });

  it("an effect that fails rolls back the inbox row too, so the retry applies it", async () => {
    const envelope = await ping();
    const failing = idempotent<typeof systemPingV1>(pool, async () => {
      throw new Error("database blip");
    });
    await expect(failing({ envelope, attempt: 1, queue: "agent.system.ping" })).rejects.toThrow();
    await handler()({ envelope, attempt: 2, queue: "agent.system.ping" });
    const { rows } = await pool.query("SELECT seen FROM heartbeat");
    expect(rows[0].seen).toBe(1);
  });

  it("cleanup forgets rows older than 30 days", async () => {
    const envelope = await ping();
    await handler()({ envelope, attempt: 1, queue: "agent.system.ping" });
    await pool.query("UPDATE messaging.inbox SET received_at = now() - interval '31 days'");
    expect(await cleanupInbox(pool)).toBe(1);
  });
});
