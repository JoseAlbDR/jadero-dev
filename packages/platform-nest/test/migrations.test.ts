import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  journalOrderProblems,
  MigrationError,
  type MigrationJournal,
  migrationFolderProblems,
  runMigrations,
} from "../src/database/migrations.js";

// Nothing listens on port 1, so the connect fails at once.
const URL = "postgres://probe:secret-password@127.0.0.1:1/probe_test";

function entry(idx: number, when: number, tag = `000${idx}_m`) {
  return { idx, version: "7", when, tag, breakpoints: true };
}

function journal(...entries: MigrationJournal["entries"]): MigrationJournal {
  return { version: "7", dialect: "postgresql", entries };
}

/** A temporary `drizzle/` folder with the given journal and SQL files. */
function folder(content: { journal?: unknown; sql?: string[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "drizzle-"));
  if (content.journal !== undefined) {
    mkdirSync(join(dir, "meta"));
    writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify(content.journal));
  }
  for (const name of content.sql ?? []) writeFileSync(join(dir, name), "select 1;");
  return dir;
}

describe("journalOrderProblems", () => {
  it("accepts sequential idx and strictly growing timestamps", () => {
    expect(journalOrderProblems(journal(entry(0, 100), entry(1, 200), entry(2, 300)))).toEqual([]);
  });

  it("flags an entry whose timestamp is not after the previous one, which Drizzle would skip", () => {
    expect(journalOrderProblems(journal(entry(0, 200), entry(1, 200), entry(2, 100)))).toEqual([
      "0001_m: when 200 is not after 0000_m (200)",
      "0002_m: when 100 is not after 0001_m (200)",
    ]);
  });

  it("flags a gap or a duplicate in idx", () => {
    expect(journalOrderProblems(journal(entry(0, 100), entry(2, 200)))).toEqual([
      "0002_m: idx 2, expected 1",
    ]);
  });
});

describe("migrationFolderProblems", () => {
  it("accepts a service with no migrations yet", () => {
    expect(migrationFolderProblems(folder({}))).toEqual([]);
    expect(migrationFolderProblems(join(tmpdir(), "does-not-exist-drizzle"))).toEqual([]);
  });

  it("accepts a journal whose entries and SQL files match", () => {
    const dir = folder({ journal: journal(entry(0, 100)), sql: ["0000_m.sql"] });
    expect(migrationFolderProblems(dir)).toEqual([]);
  });

  it("flags SQL files without a journal, a missing file and a file outside the journal", () => {
    expect(migrationFolderProblems(folder({ sql: ["0000_m.sql"] }))).toEqual([
      "0000_m.sql: no meta/_journal.json, so it is never applied",
    ]);
    const dir = folder({ journal: journal(entry(0, 100)), sql: ["0001_stray.sql"] });
    expect(migrationFolderProblems(dir)).toEqual([
      "0000_m.sql: missing",
      "0001_stray.sql: not in the journal",
    ]);
  });

  it("flags a journal that does not have drizzle-kit's shape", () => {
    const problems = migrationFolderProblems(
      folder({ journal: { dialect: "mysql", entries: [] } }),
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((line) => line.startsWith("meta/_journal.json: "))).toBe(true);
  });

  it("turns a journal that is not JSON into one problem line instead of a parser stack trace", () => {
    const dir = folder({ journal: journal(), sql: [] });
    writeFileSync(join(dir, "meta", "_journal.json"), "{ not json");
    expect(migrationFolderProblems(dir)).toEqual(["meta/_journal.json: invalid JSON"]);
  });
});

describe("runMigrations", () => {
  it("refuses an inconsistent folder before it touches the database", async () => {
    const dir = folder({
      journal: journal(entry(0, 200), entry(1, 100)),
      sql: ["0000_m.sql", "0001_m.sql"],
    });
    await expect(
      runMigrations({ service: "probe", url: URL, migrationsFolder: dir }),
    ).rejects.toThrow(
      "probe: migration folder is inconsistent: 0001_m: when 100 is not after 0000_m (200)",
    );
  });

  it("refuses a journal that is not JSON with the same one-line MigrationError", async () => {
    const dir = folder({ journal: journal(), sql: [] });
    writeFileSync(join(dir, "meta", "_journal.json"), "{ not json");
    const error = await runMigrations({ service: "probe", url: URL, migrationsFolder: dir }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as Error).message).toBe(
      "probe: migration folder is inconsistent: meta/_journal.json: invalid JSON",
    );
  });

  it("fails when there is nothing to apply, so a missing folder in an image cannot pass silently", async () => {
    await expect(
      runMigrations({ service: "probe", url: URL, migrationsFolder: folder({}) }),
    ).rejects.toThrow("probe: no migrations to apply (no meta/_journal.json)");
  });

  it("fails fast on an unreachable database with a code, never the URL, host or password", async () => {
    const dir = folder({ journal: journal(entry(0, 100)), sql: ["0000_m.sql"] });
    const error = await runMigrations({ service: "probe", url: URL, migrationsFolder: dir }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrationError);
    const message = (error as Error).message;
    expect(message).toBe("probe: cannot reach its database (DATABASE_URL): ECONNREFUSED");
    expect(message).not.toMatch(/secret-password|127\.0\.0\.1|probe_test/);
  });
});
