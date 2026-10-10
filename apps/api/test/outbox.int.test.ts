import { fileURLToPath } from "node:url";
import { systemPingV1 } from "@jadero/contracts";
import { addToOutbox } from "@jadero/messaging";
import { PG_POOL, runMigrations, withTransaction } from "@jadero/platform-nest";
import type { INestApplication } from "@nestjs/common";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootApi } from "./setup/boot.js";
import { createContentTestDatabase } from "./setup/content-database.js";

// WP-10 D7 suites 3 and 4 where the outbox lives today (api): the outbox row commits with the
// transaction that writes it and disappears with its rollback (ADR-012, D6). The domain-row
// rollback of a hexagonal module is the unit of work contract suite on Postgres (the template);
// the first module that emits a real event adds the outbox to its unit of work (WP-11/12).
let app: INestApplication;
let base: string;
let pool: Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createContentTestDatabase();
  drop = database.drop;
  await runMigrations({
    service: "api",
    url: database.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  // development registers POST /dev/ping (WP-5 W1 c).
  ({ app, base } = await bootApi({ DATABASE_URL: database.url, NODE_ENV: "development" }));
  pool = app.get<Pool>(PG_POOL);
});

afterAll(async () => {
  await app.close();
  await drop();
});

beforeEach(async () => {
  await pool.query("TRUNCATE messaging.outbox");
});

/** The outbox rows, oldest first, with the columns the relay reads. */
async function outboxRows(): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    "SELECT id, routing_key, published_at FROM messaging.outbox ORDER BY created_at",
  );
  return rows;
}

describe("atomic outbox (suite 4)", () => {
  it("a committed POST /dev/ping leaves exactly one unsent row for system.ping.v1", async () => {
    const response = await fetch(`${base}/dev/ping`, { method: "POST" });
    expect(response.status).toBe(202);
    const { eventId } = (await response.json()) as { eventId: string };
    expect(await outboxRows()).toEqual([
      { id: eventId, routing_key: systemPingV1.routingKey, published_at: null },
    ]);
  });
});

describe("rollback (suite 3)", () => {
  it("a throw after the outbox write leaves no row and rethrows the same error", async () => {
    const failure = new Error("rule checked too late");
    await expect(
      withTransaction(pool, async ({ executor }) => {
        await addToOutbox(executor, systemPingV1, { trigger: "manual" }, "jadero/api");
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await outboxRows()).toEqual([]);
  });

  it("an outbox write on a second connection survives the rollback (the D6 bug the test above catches)", async () => {
    // The mistake suite 3 exists for: the pool instead of the transaction's executor. The row
    // commits on its own connection, so the event would be published for a change that never was.
    await expect(
      withTransaction(pool, async () => {
        await addToOutbox(pool, systemPingV1, { trigger: "manual" }, "jadero/api");
        throw new Error("rule checked too late");
      }),
    ).rejects.toThrow("rule checked too late");
    expect(await outboxRows()).toHaveLength(1);
  });
});
