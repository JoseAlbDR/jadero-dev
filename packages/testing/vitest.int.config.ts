import { integrationConfig } from "@jadero/config/vitest";
import { defineConfig } from "vitest/config";

// No global setup: the provisioning suite starts its own container, so it can run the script
// several times from a known empty state.
export default defineConfig(integrationConfig([]));
