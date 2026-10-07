import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationJournal, runMigrations } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// WP-10 D7 suite 1: agent's committed drizzle/ applied to an empty database by the deploy's own
// entry (runMigrations), as an ordinary owner role like production (D4). `vector` was created by
// the superuser first, as provisioning does (ADR-027); the first migration only asserts it.
const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
const journal = migrationJournal.parse(
  JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")),
);
let client: pg.Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  // As provisioning does for every `agent_*` database (ADR-027), the superuser creates `vector`
  // first, because it is not a trusted extension; the agent's first migration only asserts it.
  const database = await createTestDatabase({ superuserExtensions: ["vector"] });
  drop = database.drop;
  await runMigrations({ service: "agent", url: database.url, migrationsFolder: folder });
  await runMigrations({ service: "agent", url: database.url, migrationsFolder: folder });
  client = new pg.Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await drop();
});

describe("agent migrations from zero, as an ordinary role", () => {
  it("ran as a role that is neither superuser nor allowed to create databases", async () => {
    const { rows } = await client.query(
      "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user",
    );
    expect(rows).toEqual([{ rolsuper: false, rolcreatedb: false }]);
  });

  it("create the inbox and the heartbeat table, with vector present", async () => {
    const { rows } = await client.query(
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      "drizzle.__drizzle_migrations",
      "heartbeat.broker_heartbeat",
      "messaging.inbox",
    ]);
    const extensions = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    expect(extensions.rows).toEqual([{ extname: "vector" }]);
  });

  it("record one row per journal entry, and the second run applied nothing", async () => {
    // Drizzle stores each entry's `when` as created_at (bigint, a string in pg).
    const { rows } = await client.query(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    expect(rows.map((row) => Number(row.created_at))).toEqual(
      journal.entries.map((entry) => entry.when),
    );
  });
});
