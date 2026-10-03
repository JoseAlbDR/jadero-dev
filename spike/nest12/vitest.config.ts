import { defineConfig } from "vitest/config";

// No SWC plugin: row 1 checks that Vitest 5 (Oxc) emits decorator metadata from tsconfig.
export default defineConfig({
  test: { include: ["row*/**/*.test.ts"], exclude: ["**/node_modules/**", "dist/**"] },
});
