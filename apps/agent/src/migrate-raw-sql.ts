import { readFileSync } from "node:fs";
import { migrateMessagingSchema } from "@jadero/messaging";
import { loadConfig } from "@jadero/platform-nest";
import pg from "pg";
import { agentEnv } from "./config/agent-config.js";

// Creates the inbox (messaging schema) and agent's own tables in `agent_dev` (WP-5 decision S1).
// Idempotent. WP-10 step 4 deletes this file (and the `migrate` script) for `src/migrate.ts`.
const { DATABASE_URL } = loadConfig(agentEnv);
const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  await migrateMessagingSchema(client);
  await client.query(
    readFileSync(new URL("../sql/0001_broker_heartbeat.sql", import.meta.url), "utf8"),
  );
  console.log("agent: schema ready");
} finally {
  await client.end();
}
