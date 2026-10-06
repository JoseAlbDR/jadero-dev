import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrationJournal } from "@jadero/platform-nest";
import { type DrizzleSnapshotJSON, generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import config from "../../drizzle.config.js";

const serviceRoot = join(import.meta.dirname, "../..");

/**
 * What `pnpm db:generate` would write now, computed with drizzle-kit's own programmatic diff: the
 * schema files `drizzle.config.ts` names, against the last snapshot in `drizzle/meta/`. Empty means
 * the CLI would print "No schema changes", so the schema files and the committed migrations agree
 * (WP-10 D7, suite 1). Needs no database.
 * @returns the SQL statements a new migration would hold.
 */
export async function pendingSchemaChanges(): Promise<string[]> {
  const folder = join(serviceRoot, config.out ?? "drizzle");
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
  for (const file of patterns.flatMap((pattern) => globSync(pattern, { cwd: serviceRoot }))) {
    Object.assign(exports, await import(pathToFileURL(join(serviceRoot, file)).href));
  }
  const current = generateDrizzleJson(exports, previous.id, undefined, config.casing);
  return generateMigration(previous, current);
}
