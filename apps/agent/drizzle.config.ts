import { defineConfig } from "drizzle-kit";

// drizzle-kit (a dev tool, never in the image) turns the schema files into reviewed SQL migrations
// in drizzle/ (WP-10 D3). `db:generate` needs no database and the runtime `migrate.js` applies the
// SQL (D2), so there are no `dbCredentials`: `push` and `studio` are never used.

export default defineConfig({
  dialect: "postgresql",
  schema: [
    // Schema files live next to their module and are never exported from its index.ts.
    "./src/modules/*/infrastructure/*.schema.ts",
    // Only the messaging tables agent uses (the inbox), from `@jadero/messaging/schema`.
    "./src/db/messaging.schema.ts",
  ],
  out: "./drizzle",
  // Must match DatabaseModule's drizzle({ casing }), or queries use the wrong column names.
  casing: "snake_case",
});
