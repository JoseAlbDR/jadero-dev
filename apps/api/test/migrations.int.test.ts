import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MigrationError, migrationJournal, runMigrations } from "@jadero/platform-nest";
import { createTestDatabase, type TestDatabase } from "@jadero/testing";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

// WP-10 D7 suite 1: api's committed drizzle/ applied to an empty database by the deploy's own
// entry (runMigrations), as an ordinary owner role like production (D4), never the superuser.
const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
const journal = migrationJournal.parse(
  JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")),
);
const databases: TestDatabase[] = [];

/** A fresh database owned by an ordinary role, dropped after the file. */
async function emptyDatabase(): Promise<string> {
  const database = await createTestDatabase();
  databases.push(database);
  return database.url;
}

/** Runs one query on a short-lived client and returns its rows. */
async function rows(url: string, text: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text)).rows;
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  for (const database of databases) await database.drop();
});

describe("api migrations from zero, as an ordinary role", () => {
  it("connect as a role that is neither superuser nor allowed to create databases", async () => {
    const url = await emptyDatabase();
    expect(
      await rows(url, "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user"),
    ).toEqual([{ rolsuper: false, rolcreatedb: false }]);
  });

  it("create the outbox and record one row per journal entry; a second run applies nothing", async () => {
    const url = await emptyDatabase();
    await runMigrations({ service: "api", url, migrationsFolder: folder });
    await runMigrations({ service: "api", url, migrationsFolder: folder });
    const tables = await rows(
      url,
      `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`,
    );
    expect(tables.map((row) => row.name)).toEqual([
      "drizzle.__drizzle_migrations",
      "messaging.outbox",
    ]);
    // Drizzle stores each entry's `when` as created_at (bigint, a string in pg).
    const applied = await rows(
      url,
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    expect(applied.map((row) => Number(row.created_at))).toEqual(
      journal.entries.map((entry) => entry.when),
    );
  });

  it("refuse a migration that needs a superuser and roll back the whole batch (Trace 2c)", async () => {
    // A copy of drizzle/ plus one migration that creates `vector`, which ADR-027 keeps out of
    // content_* and which only a superuser can create (not a trusted extension).
    const copy = mkdtempSync(join(tmpdir(), "api-drizzle-"));
    try {
      cpSync(folder, copy, { recursive: true });
      const last = journal.entries.at(-1);
      if (!last) throw new Error("api has no migrations");
      const tag = `${String(last.idx + 1).padStart(4, "0")}_needs_superuser`;
      writeFileSync(join(copy, `${tag}.sql`), "CREATE EXTENSION IF NOT EXISTS vector;\n");
      writeFileSync(
        join(copy, "meta", "_journal.json"),
        JSON.stringify({
          ...journal,
          entries: [
            ...journal.entries,
            { idx: last.idx + 1, version: "7", when: last.when + 1, tag, breakpoints: true },
          ],
        }),
      );
      const url = await emptyDatabase();
      const failure = runMigrations({ service: "api", url, migrationsFolder: copy });
      await expect(failure).rejects.toBeInstanceOf(MigrationError);
      // 42501 insufficient_privilege: "permission denied to create extension".
      await expect(failure).rejects.toThrow(/permission denied.*\(42501\)/);
      // All pending migrations run in one transaction, so 0000 is rolled back with it (Trace 2b).
      expect(await rows(url, "SELECT to_regclass('messaging.outbox') AS outbox")).toEqual([
        { outbox: null },
      ]);
      expect(
        await rows(url, "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations"),
      ).toEqual([{ n: 0 }]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
