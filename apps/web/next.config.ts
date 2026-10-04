import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Next.js config for the public site. `standalone` output gives the image a minimal server
 * (ADR-026); tracing starts at the repo root so workspace packages are copied into it.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
