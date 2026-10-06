import { integrationConfig } from "@jadero/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig(integrationConfig(["test/setup/postgres.global-setup.ts"]));
