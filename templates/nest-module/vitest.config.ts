import { baseConfig } from "@jadero/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig(),
  defineConfig({
    test: {
      coverage: {
        // Adapters proven only by an integration contract suite (ADR-009): test/widgets.int.test.ts
        // runs the repository and unit of work contract suites on real Postgres.
        exclude: [
          "src/modules/widgets/infrastructure/drizzle-widget.repository.ts",
          "src/modules/widgets/infrastructure/drizzle-widgets.unit-of-work.ts",
        ],
      },
    },
  }),
);
