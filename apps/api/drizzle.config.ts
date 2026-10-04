import { defineConfig } from "drizzle-kit";

// drizzle-kit (a dev tool, never in the image) turns the schema files into reviewed SQL migrations
// in drizzle/ (WP-10 D3). `db:generate` needs no database; `push` is never used. This file is
// tooling, so it reads DATABASE_URL itself (only `drizzle-kit studio` uses it) and never prints it.
// Until WP-10 step 4 adds the first schema file, the glob matches nothing and drizzle-kit stops
// with "No schema files found".
const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  // Schema files live next to their module and are never exported from its index.ts.
  schema: "./src/modules/*/infrastructure/*.schema.ts",
  out: "./drizzle",
  // Must match DatabaseModule's drizzle({ casing }), or queries use the wrong column names.
  casing: "snake_case",
  ...(url ? { dbCredentials: { url } } : {}),
});
