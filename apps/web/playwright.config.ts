import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// `next build` reads `.env` and bakes SITE_URL into the pages; the tests must expect the same value,
// so load the same file here. Variables already set in the shell win (loadEnvFile never overrides).
const envFile = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const PORT = Number(process.env.E2E_PORT ?? 3210);

/**
 * Smoke tests per locale against the standalone build (ADR-009, ADR-026): `pnpm test:e2e` builds
 * first (Turborepo `dependsOn: ["build"]`), then serves `server.js` exactly as the image will.
 * Uses the installed Chrome; CI installs it with `playwright install chrome`.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: {
    command: "node .next/standalone/apps/web/server.js",
    env: { PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    url: `http://127.0.0.1:${PORT}/en`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
