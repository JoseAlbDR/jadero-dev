import { defineConfig, mergeConfig } from "vitest/config";
import { baseConfig } from "./vitest/base.js";

// This package has no src/: its code is the shared configs, so coverage measures vitest/ too.
export default mergeConfig(
  baseConfig(),
  defineConfig({ test: { coverage: { include: ["vitest/**"] } } }),
);
