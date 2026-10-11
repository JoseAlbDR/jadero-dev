import { systemPingV1 } from "@jadero/contracts";
import { createEnvelope, type Delivery, InMemoryMessageBus } from "@jadero/messaging";
import type { Database, PinoLogger } from "@jadero/platform-nest";
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_QUEUE,
  HeartbeatConsumer,
  INBOX_CLEANUP_INTERVAL_MS,
} from "../src/modules/heartbeat/heartbeat.consumer.js";
import {
  type HeartbeatRecord,
  HeartbeatRepository,
} from "../src/modules/heartbeat/heartbeat.repository.js";

/**
 * Unit tests of the consumer's own logic with fakes at its edges: the transaction it opens, the
 * duplicate path of the idempotent consumer, and the inbox cleanup timer. The real SQL (inbox
 * insert, upsert, cleanup) is proven against Postgres by `heartbeat.int.test.ts`.
 */

/**
 * A fake `pg` pool. Each checkout records its statements; the inbox insert answers like
 * `ON CONFLICT DO NOTHING RETURNING`, one row the first time an event id is seen and none after.
 * `query` on the pool itself serves the cleanup, and fails on request.
 */
class FakePool {
  readonly statements: string[] = [];
  readonly poolQueries: string[] = [];
  private readonly seen = new Set<string>();
  failPoolQuery = false;

  async connect(): Promise<PoolClient> {
    const client = {
      query: async (query: string | { text: string }, values?: unknown[]) => {
        const text = typeof query === "string" ? query : query.text;
        this.statements.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
        if (text.includes("INSERT INTO messaging.inbox")) {
          const id = String(values?.[1]);
          const first = !this.seen.has(id);
          this.seen.add(id);
          return { rows: first ? [{ event_id: id }] : [], rowCount: first ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    return client as unknown as PoolClient;
  }

  async query(text: string): Promise<{ rows: never[]; rowCount: number }> {
    this.poolQueries.push(text.split(" ").slice(0, 3).join(" "));
    if (this.failPoolQuery) throw new Error("database down");
    return { rows: [], rowCount: 0 };
  }
}

/** Records each heartbeat instead of writing it; the upsert itself is covered by its own tests. */
class RecordingHeartbeats extends HeartbeatRepository {
  readonly records: HeartbeatRecord[] = [];

  override async record(_db: Database, record: HeartbeatRecord): Promise<void> {
    this.records.push(record);
  }
}

/** Collects debug lines; the other levels are not used by the consumer. */
function fakeLogger() {
  const debug: unknown[][] = [];
  const log = {
    setContext: () => undefined,
    debug: (...args: unknown[]) => debug.push(args),
  } as unknown as PinoLogger;
  return { log, debug };
}

/** A consumer wired to fakes, plus the fakes to assert on. */
function setup() {
  const bus = new InMemoryMessageBus();
  const pool = new FakePool();
  const heartbeats = new RecordingHeartbeats();
  const { log, debug } = fakeLogger();
  const consumer = new HeartbeatConsumer(bus, pool as unknown as Pool, heartbeats, log);
  return { bus, pool, heartbeats, debug, consumer };
}

/** One delivery of a fresh `system.ping.v1` on the heartbeat queue. */
function delivery() {
  const envelope = createEnvelope(systemPingV1, { trigger: "manual" }, "jadero/api");
  return { envelope, queue: HEARTBEAT_QUEUE } as Delivery<typeof envelope>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HeartbeatConsumer.handle (idempotent consumer)", () => {
  it("records the first delivery in one transaction with the inbox row", async () => {
    const { pool, heartbeats, debug, consumer } = setup();
    const ping = delivery();

    await expect(consumer.handle(ping)).resolves.toEqual({ kind: "done" });

    expect(pool.statements).toEqual(["BEGIN", "INSERT INTO messaging.inbox", "COMMIT"]);
    expect(heartbeats.records).toEqual([
      {
        source: "jadero/api",
        eventId: ping.envelope.id,
        trigger: "manual",
        seenAt: ping.envelope.time,
      },
    ]);
    expect(debug).toEqual([]);
  });

  it("skips the heartbeat on a duplicate, still acks it, and logs it at debug only", async () => {
    const { heartbeats, debug, consumer } = setup();
    const ping = delivery();

    await consumer.handle(ping);
    await expect(consumer.handle(ping)).resolves.toEqual({ kind: "done" });

    expect(heartbeats.records).toHaveLength(1);
    expect(debug).toEqual([
      [{ event_id: ping.envelope.id, queue: HEARTBEAT_QUEUE }, "duplicate ignored"],
    ]);
  });
});

describe("HeartbeatConsumer lifecycle (inbox cleanup)", () => {
  it("cleans the inbox at startup and again every interval, until shutdown", async () => {
    vi.useFakeTimers();
    const { pool, consumer } = setup();

    await consumer.onApplicationBootstrap();
    expect(pool.poolQueries).toEqual(["DELETE FROM messaging.inbox"]);

    await vi.advanceTimersByTimeAsync(INBOX_CLEANUP_INTERVAL_MS);
    expect(pool.poolQueries).toHaveLength(2);

    await consumer.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(INBOX_CLEANUP_INTERVAL_MS);
    expect(pool.poolQueries).toHaveLength(2);
    await consumer.onApplicationShutdown();
  });

  it("keeps running when a cleanup fails: the next interval simply tries again", async () => {
    vi.useFakeTimers();
    const { pool, consumer } = setup();
    pool.failPoolQuery = true;

    await expect(consumer.onApplicationBootstrap()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(INBOX_CLEANUP_INTERVAL_MS);
    expect(pool.poolQueries).toHaveLength(2);

    await consumer.beforeApplicationShutdown();
  });

  it("shuts down cleanly when it never started (no cleanup timer to clear)", async () => {
    const { consumer } = setup();
    await expect(consumer.beforeApplicationShutdown()).resolves.toBeUndefined();
    await expect(consumer.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
