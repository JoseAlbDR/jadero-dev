import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * `next build` with `output: "standalone"` leaves `.next/static` and `public/` out of the
 * standalone folder: a CDN or the image is expected to serve them. This copies both next to
 * `server.js`, so `pnpm start` (and later the image, ADR-026) serves a complete site.
 */
const app = join(import.meta.dirname, "..");
const target = join(app, ".next/standalone/apps/web");

cpSync(join(app, ".next/static"), join(target, ".next/static"), { recursive: true });
if (existsSync(join(app, "public"))) {
  cpSync(join(app, "public"), join(target, "public"), { recursive: true });
}
