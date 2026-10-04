import { baseConfig } from "@jadero/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Component tests are .tsx; they opt into jsdom per file with `// @vitest-environment jsdom`.
export default mergeConfig(
  baseConfig(),
  defineConfig({ test: { include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"] } }),
);
