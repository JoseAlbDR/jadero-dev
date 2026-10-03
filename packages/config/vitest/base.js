import { loadavg } from "node:os";

/**
 * Worker count from machine load (AGENTS.md section 3): 12 minus the 1-minute load average minus 3,
 * at least 1, at most 6. VITEST_MAX_WORKERS overrides it.
 * @returns {number}
 */
export function workersFromLoad() {
  const fromEnv = Number(process.env.VITEST_MAX_WORKERS);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  const [load1] = loadavg();
  return Math.min(6, Math.max(1, Math.floor(12 - (load1 ?? 0) - 3)));
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
      maxWorkers: workersFromLoad(),
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        include: ["src/**"],
        thresholds: { lines: 80, branches: 70 },
      },
    },
  };
}
