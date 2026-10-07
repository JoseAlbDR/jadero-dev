import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrationJournal } from "@jadero/platform-nest";
import type { Config } from "drizzle-kit";
import { type DrizzleSnapshotJSON, generateDrizzleJson, generateMigration } from "drizzle-kit/api";

/** Where a service's schema lives: its folder and its `drizzle.config.ts`. */
export interface SchemaSource {
  /** Absolute path of the service folder; `config.schema` and `config.out` are relative to it. */
  readonly root: string;
  /** The service's drizzle-kit config, the default export of its `drizzle.config.ts`. */
  readonly config: Config;
}

/**
 * What `pnpm db:generate` would write now, computed with drizzle-kit's own programmatic diff: the
 * schema files `drizzle.config.ts` names, against the last snapshot in `drizzle/meta/`. Empty means
 * the CLI would print "No schema changes", so the schema files and the committed migrations agree
 * (WP-10 D7, suite 1). Needs no database. Runs inside Vitest, which loads the `.ts` schema files.
 * @param source the service folder and its drizzle-kit config.
 * @returns the SQL statements a new migration would hold.
 */
export async function pendingSchemaChanges({ root, config }: SchemaSource): Promise<string[]> {
  const folder = join(root, config.out ?? "drizzle");
  const journal = migrationJournal.parse(
    JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")),
  );
  const last = journal.entries.at(-1);
  if (!last) throw new Error("drizzle/meta/_journal.json has no entries");
  // drizzle-kit names each snapshot after its migration's numeric prefix (0000_snapshot.json).
  const prefix = last.tag.split("_")[0];
  const previous = JSON.parse(
    readFileSync(join(folder, "meta", `${prefix}_snapshot.json`), "utf8"),
  ) as DrizzleSnapshotJSON;
  const patterns: string[] = [config.schema ?? []].flat();
  const exports: Record<string, unknown> = {};
  for (const file of patterns.flatMap((pattern) => globSync(pattern, { cwd: root }))) {
    Object.assign(exports, await import(pathToFileURL(join(root, file)).href));
  }
  const current = generateDrizzleJson(exports, previous.id, undefined, config.casing);
  return generateMigration(previous, current);
}
