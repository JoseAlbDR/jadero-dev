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

const contentApiUrlSchema = z.url({ protocol: /^https?$/ });

/**
 * Base URL of the public content API of `api` (`CONTENT_API_URL`), server only: it is never
 * exposed to the browser and is read at request time, when a page fetches content, not at build
 * time. There is no default, so a missing value fails loudly instead of calling a wrong host; the
 * error never repeats the value, which could carry credentials.
 * @returns the URL without a trailing slash, for example `http://localhost:3001`.
 * @throws {Error} when `CONTENT_API_URL` is unset or not an absolute http(s) URL.
 */
export function contentApiUrl(): string {
  const parsed = contentApiUrlSchema.safeParse(process.env.CONTENT_API_URL);
  if (!parsed.success) {
    throw new Error(
      "CONTENT_API_URL must be an absolute http(s) URL, for example http://localhost:3001",
    );
  }
  return parsed.data.replace(/\/+$/, "");
}
