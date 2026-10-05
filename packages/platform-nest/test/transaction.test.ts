import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { type ConnectionSource, withTransaction } from "../src/database/transaction.js";

/** A fake `pg` client: records every statement and how it was released; fails on request. */
class FakeClient {
  readonly statements: string[] = [];
  releases: unknown[] = [];

  constructor(private readonly failOn: string[] = []) {}

  async query(query: string | { text: string }, _values?: unknown[]) {
    const text = typeof query === "string" ? query : query.text;
    this.statements.push(text);
    if (this.failOn.includes(text)) throw new Error(`${text} failed`);
    return { rows: [{ ok: 1 }], rowCount: 1, fields: [], command: "", oid: 0 };
  }

  release(error?: Error | boolean): void {
    this.releases.push(error);
  }
}

/** A fake pool that hands out one fresh client per `connect()` and counts the checkouts. */
function fakePool(failOn: string[] = []) {
  const clients: FakeClient[] = [];
  const pool: ConnectionSource = {
    connect: async () => {
      const client = new FakeClient(failOn);
      clients.push(client);
      return client as unknown as PoolClient;
    },
  };
  return { pool, clients };
}

describe("withTransaction (unit of work on one connection)", () => {
  it("runs Drizzle and raw SQL on one checked-out client between BEGIN and COMMIT", async () => {
    const { pool, clients } = fakePool();
    const result = await withTransaction(pool, async ({ db, executor }) => {
      await db.execute(sql`UPDATE content.projects SET state = 'published'`);
      const { rows } = await executor.query("INSERT INTO messaging.outbox VALUES ($1)", ["x"]);
      return rows.length;
    });
    expect(result).toBe(1);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.statements).toEqual([
      "BEGIN",
      "UPDATE content.projects SET state = 'published'",
      "INSERT INTO messaging.outbox VALUES ($1)",
      "COMMIT",
    ]);
    expect(clients[0]?.releases).toEqual([undefined]);
  });

  it("rolls back and rethrows when the work throws, and returns the client to the pool", async () => {
    const { pool, clients } = fakePool();
    const failure = new Error("use case failed after both writes");
    await expect(
      withTransaction(pool, async ({ executor }) => {
        await executor.query("INSERT INTO messaging.outbox VALUES ($1)", ["x"]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(clients[0]?.statements).toEqual([
      "BEGIN",
      "INSERT INTO messaging.outbox VALUES ($1)",
      "ROLLBACK",
    ]);
    expect(clients[0]?.releases).toEqual([undefined]);
  });

  it("destroys the connection when the rollback fails, and still rethrows the work's error", async () => {
    const { pool, clients } = fakePool(["ROLLBACK"]);
    const failure = new Error("work failed");
    await expect(
      withTransaction(pool, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const [released] = clients[0]?.releases ?? [];
    expect(released).toBeInstanceOf(Error);
    expect((released as Error).message).toBe("ROLLBACK failed");
  });

  it("rolls back and releases when COMMIT fails", async () => {
    const { pool, clients } = fakePool(["COMMIT"]);
    await expect(withTransaction(pool, async () => "done")).rejects.toThrow("COMMIT failed");
    expect(clients[0]?.statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(clients[0]?.releases).toEqual([undefined]);
  });

  it("releases the client when BEGIN fails, without running the work", async () => {
    const { pool, clients } = fakePool(["BEGIN", "ROLLBACK"]);
    let ran = false;
    await expect(
      withTransaction(pool, async () => {
        ran = true;
      }),
    ).rejects.toThrow("BEGIN failed");
    expect(ran).toBe(false);
    expect(clients[0]?.releases).toHaveLength(1);
    expect(clients[0]?.releases[0]).toBeInstanceOf(Error);
  });
});
