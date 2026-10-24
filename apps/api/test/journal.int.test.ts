import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@jadero/platform-nest";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type JournalDatabase, runJournal } from "../src/journal/journal.module.js";
import type { JournalOutput } from "../src/journal/journal-commands.js";
import { createContentTestDatabase } from "./setup/content-database.js";

// WP-39 step 4 (D3, ADR-034): the journal commands' own path (a Nest application context without
// HTTP, the Drizzle unit of work, the content use cases) against the migrated content schema. The
// import runs twice (created, then unchanged, no new row); the publish fails without es (D-20) and
// passes once es is imported. Tests in the file run in order and share the database.
let pool: pg.Pool;
let drop: () => Promise<void>;
let database: JournalDatabase;
let dir: string;

beforeAll(async () => {
  const created = await createContentTestDatabase();
  drop = created.drop;
  await runMigrations({
    service: "api",
    url: created.url,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  database = { url: created.url, poolMax: 2 };
  pool = new pg.Pool({ connectionString: created.url, max: 2 });
  dir = await mkdtemp(join(tmpdir(), "journal-int-"));
});

afterAll(async () => {
  await pool.end();
  await drop();
  await rm(dir, { recursive: true, force: true });
});

/** Writes one draft file into the test's drafts folder. */
async function writeDraft(name: string, locale: string, status = "approved"): Promise<void> {
  await writeFile(
    join(dir, name),
    `---\nwp: 41\ntitle: "Journal: the import"\nstatus: ${status}\ndate: 2026-10-24\nlocale: ${locale}\n---\n\n# Journal: the import\n\nWhat I built (${locale}).\n`,
  );
}

/** Runs one command and returns its result and lines. */
async function run(
  args: Parameters<typeof runJournal>[0],
): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  const output: JournalOutput = { info: (l) => lines.push(l), error: (l) => lines.push(l) };
  return { ok: await runJournal(args, database, output), lines };
}

/** The journal post's root row and its revisions per locale. */
async function stored(): Promise<{ posts: unknown[]; revisions: unknown[]; live: unknown[] }> {
  const posts = await pool.query("SELECT slug, kind, wp, version FROM content.posts");
  const revisions = await pool.query(
    "SELECT locale, number, document->>'slug' AS slug FROM content.post_revisions ORDER BY locale, number",
  );
  const live = await pool.query(
    "SELECT locale, published_slug FROM content.post_translations WHERE published_revision_id IS NOT NULL ORDER BY locale",
  );
  return { posts: posts.rows, revisions: revisions.rows, live: live.rows };
}

describe("journal:import and journal:publish on Postgres", () => {
  it("imports a draft once: created, then unchanged with no new row", async () => {
    await writeDraft("wp-41.md", "en");
    expect(await run({ command: "import", dir })).toEqual({
      ok: true,
      lines: ["wp-41 en: created"],
    });
    const afterFirst = await stored();
    expect(afterFirst).toEqual({
      posts: [{ slug: "journal-wp-41", kind: "journal", wp: 41, version: 2 }],
      revisions: [{ locale: "en", number: 1, slug: "journal-the-import" }],
      live: [],
    });

    expect(await run({ command: "import", dir })).toEqual({
      ok: true,
      lines: ["wp-41 en: unchanged"],
    });
    expect(await stored()).toEqual(afterFirst);
  });

  it("refuses to publish without es, then publishes es and en once es is imported", async () => {
    expect(await run({ command: "publish", wp: 41, locales: [] })).toEqual({
      ok: false,
      lines: [
        expect.stringMatching(/^wp-41: not published: RequiredLocalesMissing: .+ without es\.$/),
      ],
    });
    expect((await stored()).live).toEqual([]);

    await writeDraft("wp-41.es.md", "es", "draft");
    expect((await run({ command: "import", dir })).lines).toEqual([
      "wp-41 es: created",
      "wp-41 en: unchanged",
    ]);
    expect(await run({ command: "publish", wp: 41, locales: [] })).toEqual({
      ok: true,
      lines: ["wp-41: published es, en", "wp-41: warning: de is not published"],
    });
    expect((await stored()).live).toEqual([
      { locale: "en", published_slug: "journal-the-import" },
      { locale: "es", published_slug: "journal-the-import" },
    ]);
  });

  it("fails the run when a draft still holds an owner check marker, importing the rest", async () => {
    await writeFile(
      join(dir, "wp-42.md"),
      "---\nwp: 42\ntitle: Guess\nstatus: draft\ndate: 2026-10-24\nlocale: en\n---\n\nI loved it. <!-- owner: check -->\n",
    );
    expect(await run({ command: "import", dir })).toEqual({
      ok: false,
      lines: [
        "wp-41 es: unchanged",
        "wp-41 en: unchanged",
        "wp-42 en: refused: holds an <!-- owner: check --> marker; review it first",
      ],
    });
    expect((await stored()).posts).toHaveLength(1);
  });
});
