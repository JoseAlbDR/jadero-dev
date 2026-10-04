import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { z } from "zod";

/** How long the one-off migrate step waits for the database before it gives up. */
export const MIGRATION_CONNECT_TIMEOUT_MS = 5000;

/** The journal drizzle-kit writes to `drizzle/meta/_journal.json`, validated before it is trusted. */
export const migrationJournal = z.object({
  version: z.string(),
  dialect: z.literal("postgresql"),
  entries: z.array(
    z.object({
      idx: z.int().min(0),
      version: z.string(),
      when: z.int().positive(),
      tag: z.string().min(1),
      breakpoints: z.boolean(),
    }),
  ),
});

/** A parsed migration journal. */
export type MigrationJournal = z.output<typeof migrationJournal>;

/**
 * Checks the order rules Drizzle's migrator relies on without checking them itself: it applies only
 * entries whose `when` is newer than the last applied one, so an entry out of order, or an edited
 * timestamp, is silently skipped (WP-10 "Never edit an applied migration").
 * @param journal a parsed journal.
 * @returns one line per broken rule; empty when `idx` runs 0, 1, 2, ... and `when` strictly grows.
 */
export function journalOrderProblems(journal: MigrationJournal): string[] {
  const problems: string[] = [];
  journal.entries.forEach((entry, position) => {
    if (entry.idx !== position) {
      problems.push(`${entry.tag}: idx ${entry.idx}, expected ${position}`);
    }
    const previous = journal.entries[position - 1];
    if (previous && entry.when <= previous.when) {
      problems.push(
        `${entry.tag}: when ${entry.when} is not after ${previous.tag} (${previous.when})`,
      );
    }
  });
  return problems;
}

/**
 * Checks a service's migration folder as committed: the journal parses, its order holds, every
 * entry has its SQL file, and no SQL file is missing from the journal (Drizzle would never run it).
 * A folder with neither a journal nor SQL files is valid: the service has no migrations yet.
 * @param folder absolute path of the service's `drizzle/` folder.
 * @returns one line per problem; empty when the folder is consistent.
 */
export function migrationFolderProblems(folder: string): string[] {
  const journalPath = join(folder, "meta", "_journal.json");
  const sqlFiles = existsSync(folder)
    ? readdirSync(folder)
        .filter((name) => name.endsWith(".sql"))
        .sort()
    : [];
  if (!existsSync(journalPath)) {
    return sqlFiles.map((name) => `${name}: no meta/_journal.json, so it is never applied`);
  }
  const parsed = migrationJournal.safeParse(JSON.parse(readFileSync(journalPath, "utf8")));
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `meta/_journal.json: ${issue.message}`);
  }
  const tags = new Set(parsed.data.entries.map((entry) => `${entry.tag}.sql`));
  return [
    ...journalOrderProblems(parsed.data),
    ...[...tags].filter((name) => !sqlFiles.includes(name)).map((name) => `${name}: missing`),
    ...sqlFiles.filter((name) => !tags.has(name)).map((name) => `${name}: not in the journal`),
  ];
}

/** What a service's migrate entry passes. */
export interface RunMigrationsOptions {
  /** The service name, for messages. */
  readonly service: string;
  /** Connection string of the service's own database (ADR-029 rule 1). Never printed. */
  readonly url: string;
  /** Absolute path of the service's `drizzle/` folder. */
  readonly migrationsFolder: string;
}

/** A migrate step that failed; the message names the cause, never the connection string. */
export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

/** The Postgres or Node error code of an error or its cause, if it has one. */
function codeOf(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** The innermost message: Drizzle wraps the Postgres error in "Failed query: ...". */
function rootMessage(error: unknown): string {
  let current = error;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  return current instanceof Error ? current.message : String(current);
}

/**
 * The one-off migrate step (WP-10 D2): checks the folder, opens a short-lived pool of one
 * connection, fails fast when the database does not answer, then applies every pending migration
 * with Drizzle's `migrate()` (all of them in one transaction) and closes the pool. Never run at boot.
 * @param options the service, its database URL and its migration folder.
 * @throws {MigrationError} when the folder is inconsistent, the database is unreachable or a
 * migration fails; the message carries an error code, never the URL, a host or a Postgres detail.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const problems = migrationFolderProblems(options.migrationsFolder);
  if (problems.length > 0) {
    throw new MigrationError(
      `${options.service}: migration folder is inconsistent: ${problems.join("; ")}`,
    );
  }
  if (!existsSync(join(options.migrationsFolder, "meta", "_journal.json"))) {
    throw new MigrationError(`${options.service}: no migrations to apply (no meta/_journal.json)`);
  }
  const pool = new Pool({
    connectionString: options.url,
    max: 1,
    connectionTimeoutMillis: MIGRATION_CONNECT_TIMEOUT_MS,
  });
  try {
    try {
      await pool.query("select 1");
    } catch (error) {
      const reason = codeOf(error) ?? `no answer within ${MIGRATION_CONNECT_TIMEOUT_MS} ms`;
      throw new MigrationError(
        `${options.service}: cannot reach its database (DATABASE_URL): ${reason}`,
        {
          cause: error,
        },
      );
    }
    try {
      await migrate(drizzle({ client: pool }), { migrationsFolder: options.migrationsFolder });
    } catch (error) {
      const code = codeOf(error);
      throw new MigrationError(
        `${options.service}: migration failed, nothing applied: ${rootMessage(error)}${code ? ` (${code})` : ""}`,
        { cause: error },
      );
    }
  } finally {
    await pool.end();
  }
}
