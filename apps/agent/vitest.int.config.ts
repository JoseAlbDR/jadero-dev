import { fileURLToPath } from "node:url";
import { integrationConfig } from "@jadero/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig(
  integrationConfig([fileURLToPath(import.meta.resolve("@jadero/testing/postgres-global-setup"))]),
);
