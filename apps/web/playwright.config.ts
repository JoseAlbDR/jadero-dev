import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// The server reads SITE_URL at request time for canonical and hreflang links; the tests must expect
// the same value, so load `.env` here and hand it to the server. Variables already set in the shell
// win (loadEnvFile never overrides).
const envFile = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const PORT = Number(process.env.E2E_PORT ?? 3210);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3211);

/**
 * Smoke tests per locale against the standalone build (ADR-009, ADR-026): `pnpm test:e2e` builds
 * first (Turborepo `dependsOn: ["build"]`), then serves `server.js` exactly as the image will.
 * Uses the installed Chrome; CI installs it with `playwright install chrome`.
 *
 * Content pages read the content API, so the suite starts a stub of it first (`e2e/stub/`): fixed
 * fixtures parsed with the `@jadero/contracts` schemas, no Docker, no database, no `api`. The web
 * server always gets the stub as CONTENT_API_URL, even when `.env` points at a real API, so the
 * tests assert on known data.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    {
      command: "node e2e/stub/content-api.ts",
      env: { E2E_API_PORT: String(API_PORT) },
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: "node .next/standalone/apps/web/server.js",
      // CSP_MODE=enforce runs the suite under the enforced CSP (ADR-047); unset, it is report-only.
      // HOSTNAME must be "localhost" (or unset, or 0.0.0.0 as in a container): Next builds the
      // proxy's request URL on localhost, and with HOSTNAME=127.0.0.1 it takes next-intl's rewrite
      // of a localized pathname (/es/experiencia to /es/experience) for an external one, runs it
      // through the proxy again and loops on a 307.
      env: {
        PORT: String(PORT),
        HOSTNAME: "localhost",
        CONTENT_API_URL: `http://127.0.0.1:${API_PORT}`,
        ...(process.env.SITE_URL ? { SITE_URL: process.env.SITE_URL } : {}),
        ...(process.env.CSP_MODE ? { CSP_MODE: process.env.CSP_MODE } : {}),
      },
      url: `http://localhost:${PORT}/en`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
