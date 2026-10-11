import { baseConfig } from "@jadero/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// The Docker and Postgres helpers run only inside the other packages' test runs, so this package's
// unit tests cannot cover them; each is left out of the unit number with what proves it (ADR-009).
export default mergeConfig(
  baseConfig(),
  defineConfig({
    test: {
      coverage: {
        exclude: [
          // The global setup of every `pnpm test:int` run (each vitest.int.config.ts names it), which
          // starts the Postgres container: apps/api/test/content-repositories.int.test.ts and every
          // other `*.int.test.ts` fail without it.
          "src/postgres.global-setup.ts",
          // Called by that global setup to find Docker; same proof.
          "src/docker-host.ts",
          // Every integration suite's database: apps/api/test/content-repositories.int.test.ts,
          // apps/agent/test/heartbeat.int.test.ts, packages/messaging/test/outbox-inbox.int.test.ts.
          // Its input checks are unit-tested here (test/test-database.test.ts).
          "src/test-database.ts",
          // The schema drift check of apps/api/test/migrations.test.ts and
          // apps/agent/test/migrations.test.ts, unit tests that run in `pnpm verify`.
          "src/pending-schema-changes.ts",
        ],
      },
    },
  }),
);
