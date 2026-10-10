import { fileURLToPath } from "node:url";
import { baseConfig } from "@jadero/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

// Component tests are .tsx; they opt into jsdom per file with `// @vitest-environment jsdom`.
// `@/` is the app's source alias (tsconfig `paths`), resolved here the same way Next resolves it.
export default mergeConfig(
  baseConfig(),
  defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
      include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
      // next-intl's ESM build imports `next/server` without an extension, which Node's resolver
      // refuses; inlined, Vite resolves it the way Next does (needed by the proxy test).
      server: { deps: { inline: ["next-intl"] } },
    },
  }),
);
