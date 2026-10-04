import { z } from "zod";

/**
 * The public origin used for canonical and hreflang links. Pages are prerendered, so this is read
 * at build time and baked into the HTML: set `SITE_URL` before `next build`, not at `start`.
 * A malformed value fails the build instead of producing broken links.
 */
export const SITE_URL = new URL(
  z
    .url()
    .default("https://jadero.dev")
    .parse(process.env.SITE_URL, {
      error: () => "SITE_URL must be an absolute URL, for example https://jadero.dev",
    }),
);
