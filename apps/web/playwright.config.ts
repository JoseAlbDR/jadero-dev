import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Load `.env` for CSP_MODE; variables already set in the shell win (loadEnvFile never overrides).
const envFile = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const PORT = Number(process.env.E2E_PORT ?? 3210);
const API_PORT = Number(process.env.E2E_API_PORT ?? 3211);

// SITE_URL is always the test server's own origin, whatever `.env` or the shell says: the proxy
// resolves every redirect on SITE_URL (ADR-047), so any other value would send the browser off the
// test server. Set here, before the workers load this file, so the specs expect the same value in
// canonical and hreflang links.
const SITE_URL = `http://localhost:${PORT}`;
process.env.SITE_URL = SITE_URL;

/**
 * Smoke tests per locale against the standalone build (ADR-009, ADR-026): `pnpm test:e2e` builds
 * first (Turborepo `dependsOn: ["build"]`), then serves `server.js` exactly as the image will.
 * Uses the installed Google Chrome (`channel: "chrome"`); in CI the runner image already has it.
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
      // Unset, the server enforces the CSP (ADR-047); CSP_MODE=report-only runs the suite with the
      // policy reported only. Turborepo's strict env mode drops CSP_MODE from the shell, so that
      // pass runs Playwright directly (apps/web/AGENTS.md); `.env` is read here and still applies.
      // HOSTNAME must be "localhost" (or unset, or 0.0.0.0 as in a container): Next builds the
      // proxy's request URL on localhost, and with HOSTNAME=127.0.0.1 it takes next-intl's rewrite
      // of a localized pathname (/es/experiencia to /es/experience) for an external one, runs it
      // through the proxy again and loops on a 307.
      env: {
        PORT: String(PORT),
        HOSTNAME: "localhost",
        CONTENT_API_URL: `http://127.0.0.1:${API_PORT}`,
        SITE_URL,
        ...(process.env.CSP_MODE ? { CSP_MODE: process.env.CSP_MODE } : {}),
      },
      url: `http://localhost:${PORT}/en`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
