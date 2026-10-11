import { baseConfig } from "@jadero/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

/** ADR-009: the layers that hold the rules, on top of the package's 80% lines and 70% branches. */
const RULE_LAYERS = { lines: 90, branches: 85 };

export default mergeConfig(
  baseConfig(),
  defineConfig({
    test: {
      coverage: {
        thresholds: {
          "src/modules/*/domain/**": RULE_LAYERS,
          "src/modules/*/application/**": RULE_LAYERS,
        },
      },
    },
  }),
);
