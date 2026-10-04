import { fileURLToPath } from "node:url";
import { loadConfig, MigrationError, runMigrations } from "@jadero/platform-nest";
import { agentEnv } from "./config/agent-config.js";

// The one-off migrate step (WP-10 D2): applies `drizzle/` to agent's own database (`agent_dev` in
// development) and exits; the deploy (WP-9) runs it once, before the service starts, never at boot.
// Exit code 1 on any failure, so the deploy stops and the old version keeps serving.
// Only the database URL: the one-off container needs no port, log level or broker.
const { DATABASE_URL } = loadConfig(agentEnv.pick({ DATABASE_URL: true }));
try {
  await runMigrations({
    service: "agent",
    url: DATABASE_URL,
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("agent: migrations applied");
} catch (error) {
  if (!(error instanceof MigrationError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
