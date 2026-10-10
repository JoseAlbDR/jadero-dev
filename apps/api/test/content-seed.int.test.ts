import { fileURLToPath } from "node:url";
import { runMigrations } from "@jadero/platform-nest";
import { createTestDatabase } from "@jadero/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentSeed } from "../src/seed/content-seed-data.js";
import { runSeed, type SeedDatabase } from "../src/seed/seed.module.js";

// WP-12 step 6: `db:seed`'s own path (a Nest application context without HTTP, the Drizzle unit of
// work, the content use cases) run twice against the migrated content schema. Owner decision A:
// the second run creates nothing and changes nothing, proved on every content table's row count and
// every root's version; the first run leaves every seeded locale published and the entry approved.
let pool: pg.Pool;
let drop: () => Promise<void>;
let database: SeedDatabase;

beforeAll(async () => {
  const created = await createTestDatabase();
  drop = created.drop;
  await runMigrations({
    service: "api",
    url: created.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  database = { url: created.url, poolMax: 2 };
  pool = new pg.Pool({ connectionString: created.url, max: 2 });
});

afterAll(async () => {
  await pool.end();
  await drop();
});

/** Every table of the `content` schema with its row count, and every root's id and version. */
async function contentState(): Promise<{ counts: Record<string, number>; versions: unknown[] }> {
  const tables = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'content' ORDER BY 1",
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM content.${table_name}`,
    );
    counts[table_name] = rows[0]?.n ?? -1;
  }
  const versioned = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.columns WHERE table_schema = 'content' AND column_name = 'version' ORDER BY 1",
  );
  const versions: unknown[] = [];
  for (const { table_name } of versioned.rows) {
    const { rows } = await pool.query(
      `SELECT '${table_name}' AS t, id, version FROM content.${table_name} ORDER BY id`,
    );
    versions.push(...rows);
  }
  return { counts, versions };
}

describe("db:seed on Postgres", () => {
  it("seeds every item once; a second run skips them all and changes no row or version", async () => {
    const first = await runSeed(database, contentSeed);
    expect(Object.values(first).reduce((n, c) => n + c.created, 0)).toBe(contentSeed.length);
    const afterFirst = await contentState();
    expect(afterFirst.counts.projects).toBe(2);
    expect(afterFirst.counts.cv_bullets).toBe(3);

    const second = await runSeed(database, contentSeed);
    expect(Object.values(second).reduce((n, c) => n + c.created, 0)).toBe(0);
    expect(Object.values(second).reduce((n, c) => n + c.skipped, 0)).toBe(contentSeed.length);
    expect(await contentState()).toEqual(afterFirst);
  });

  // Reads the database the test above seeded (tests in a file run in order).
  it("leaves every seeded locale published and the entry approved", async () => {
    const translationTables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'content' AND table_name LIKE '%\\_translations' ORDER BY 1",
    );
    let published = 0;
    for (const { table_name } of translationTables.rows) {
      const { rows } = await pool.query<{ total: number; unpublished: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE published_revision_id IS NULL)::int AS unpublished FROM content.${table_name}`,
      );
      expect(rows[0]?.unpublished, table_name).toBe(0);
      published += rows[0]?.total ?? 0;
    }
    // es and en for every localized item, plus de where the seed has it.
    const expected = contentSeed.reduce(
      (n, item) => n + (item.type === "knowledge-entry" ? 0 : item.documents.de ? 3 : 2),
      0,
    );
    expect(published).toBe(expected);

    const entries = await pool.query(
      "SELECT id, state, approved_revision_id IS NOT NULL AS live FROM content.knowledge_entries",
    );
    expect(entries.rows).toEqual([
      { id: "kb-sample-message-queue", state: "approved", live: true },
    ]);
  });
});
