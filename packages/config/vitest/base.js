import { loadavg } from "node:os";
import { configDefaults } from "vitest/config";

/**
 * Worker count from machine load (AGENTS.md section 3): 12 minus the 1-minute load average minus 3,
 * at least 1, at most 6. A positive integer in VITEST_MAX_WORKERS overrides the formula and is
 * clamped to the same 1 to 6 range.
 * @param {number} [load1] the 1-minute load average; defaults to the current one, tests pass it in.
 * @returns {number} the number of Vitest workers to use, between 1 and 6.
 */
export function workersFromLoad(load1 = loadavg()[0] ?? 0) {
  const fromEnv = Number(process.env.VITEST_MAX_WORKERS);
  const wanted = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : Math.floor(12 - load1 - 3);
  return Math.min(6, Math.max(1, wanted));
}

/**
 * The Vitest base every package extends with `mergeConfig`. Coverage gates follow ADR-009; a package
 * raises them for its domain and application folders, never lowers them.
 * @returns {import("vitest/config").ViteUserConfig}
 */
export function baseConfig() {
  return {
    test: {
      include: ["src/**/*.{test,spec}.ts", "test/**/*.{test,spec}.ts"],
      // Integration tests need Docker and run only through `pnpm test:int` (integrationConfig).
      exclude: [...configDefaults.exclude, "**/*.int.test.ts"],
      maxWorkers: workersFromLoad(),
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov", "json-summary"],
        include: ["src/**"],
        // A package adds its own exclusions with `mergeConfig` (arrays concatenate). ADR-009 allows
        // excluding only code that something else proves; each entry names what does.
        exclude: [
          // Composition roots: they read the config, build the Nest app or call one helper, and hold
          // no logic of their own. The boot (`pnpm dev`, the deploy smoke) proves them; the modules
          // they build are proven by the app tests and the integration suites (`*.int.test.ts`).
          "src/{main,worker,consumer,migrate}.ts",
          // Contract suites are test code kept next to the port they describe, run against every
          // adapter (the fake in `pnpm verify`, the real one in `pnpm test:int`).
          "**/*.contract.ts",
        ],
        thresholds: { lines: 80, branches: 70 },
      },
    },
  };
}

/**
 * The Vitest config for `*.int.test.ts` files (`pnpm test:int`): real containers through
 * Testcontainers, so Docker must run. A package passes its global setup file, which starts the
 * containers once per run (ADR-009, WP-3 decision H).
 * @param {string[]} globalSetup paths of the global setup files, relative to the package.
 * @returns {import("vitest/config").ViteUserConfig}
 */
export function integrationConfig(globalSetup) {
  return {
    test: {
      include: ["test/**/*.int.test.ts"],
      globalSetup,
      maxWorkers: workersFromLoad(),
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  };
}
