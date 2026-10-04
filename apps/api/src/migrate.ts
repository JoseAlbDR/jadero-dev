import { migrateMessagingSchema } from "@jadero/messaging";
import { loadConfig } from "@jadero/platform-nest";
import pg from "pg";
import { apiEnv } from "./config/api-config.js";

// Creates the outbox and inbox tables in `api`'s own database (WP-5 decision S1). Idempotent.
// WP-10 replaces this with Drizzle migrations, the messaging SQL as the first one.
const { DATABASE_URL } = loadConfig(apiEnv);
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await migrateMessagingSchema(client);
  console.log("api: messaging schema ready");
} finally {
  await client.end();
}
