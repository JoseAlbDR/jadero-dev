import { loadConfig } from "@jadero/platform-nest";
import { DrizzleQueryError } from "drizzle-orm";
import { apiEnv } from "./config/api-config.js";
import { contentSeed } from "./seed/content-seed-data.js";
import { runSeed } from "./seed/seed.module.js";

// The one-off seed (WP-12 Q2 A): loads placeholder content into api's own database through the
// content use cases, so WP-16 has data locally and on staging. Run by hand after `db:migrate`,
// never by a deploy. Idempotent: an item already stored is skipped, never changed. Prints counts
// per type, never content. Exit code 1 on any failure; the items seeded before it stay.
const { DATABASE_URL, DATABASE_POOL_MAX } = loadConfig(
  apiEnv.pick({ DATABASE_URL: true, DATABASE_POOL_MAX: true }),
);

/**
 * A one-line description of a failure that carries no content: a query error's message holds its
 * bound parameters (document text), so only its driver code is printed.
 * @param error what the seed threw.
 * @returns the error's name and message, or the query error's code.
 */
function describeFailure(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    return `query failed (${typeof code === "string" ? code : "no code"})`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

try {
  const report = await runSeed({ url: DATABASE_URL, poolMax: DATABASE_POOL_MAX }, contentSeed);
  for (const [type, { created, skipped }] of Object.entries(report)) {
    console.log(`api: seed ${type}: ${created} created, ${skipped} skipped`);
  }
} catch (error) {
  console.error(`api: seed failed: ${describeFailure(error)}`);
  process.exitCode = 1;
}
