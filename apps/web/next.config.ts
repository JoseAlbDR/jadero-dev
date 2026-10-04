import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Next.js config for the public site. `standalone` output gives the image a minimal server
 * (ADR-026); tracing starts at the repo root so workspace packages are copied into it.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  // packages/ui ships TypeScript source (just-in-time package); Next compiles it.
  transpilePackages: ["@jadero/ui"],
};

export default withNextIntl(nextConfig);
