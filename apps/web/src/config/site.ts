import { z } from "zod";

/**
 * The public origin used for canonical and hreflang links. Pages render per request (CSP nonce,
 * ADR-047), so the server reads `SITE_URL` when it loads: set it where the server starts. The build
 * reads it too, so a malformed value fails `next build` instead of producing broken links.
 */
export const SITE_URL = new URL(
  z
    .url()
    .default("https://jadero.dev")
    .parse(process.env.SITE_URL, {
      error: () => "SITE_URL must be an absolute URL, for example https://jadero.dev",
    }),
);

/**
 * True when the app runs under `next dev` (`NODE_ENV=development`). The proxy uses it to relax the
 * CSP for hot reload and to resolve redirects on the request's own origin, since the dev server is
 * reached on whatever host and port it was started with.
 * @returns `true` only in development; a production build, the standalone server and tests are not.
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

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

const contentApiDebugSchema = z.literal("1");

/**
 * Whether the content client logs each of its requests to the server console (`CONTENT_API_DEBUG`),
 * read per request: server-side fetches never show in the browser's Network tab. Development
 * only: a production build, the standalone server and tests stay silent even when the variable is
 * set, because the log line carries the full URL and the response body.
 * @returns `true` only when `CONTENT_API_DEBUG=1` and the app runs under `next dev`; any other
 *   value, or none, is off.
 */
export function contentApiDebug(): boolean {
  return isDevelopment() && contentApiDebugSchema.safeParse(process.env.CONTENT_API_DEBUG).success;
}

const cspModeSchema = z.enum(["report-only", "enforce"]).default("report-only");

/** How the browser applies the Content-Security-Policy (ADR-047): report it only, or enforce it. */
export type CspMode = z.infer<typeof cspModeSchema>;

/**
 * Mode of the nonce-based CSP (`CSP_MODE`), read per request by the proxy. ADR-047 rolls the policy
 * out report-only first (`Content-Security-Policy-Report-Only`: the browser logs a violation but
 * still runs the script) and enforces it once the reports are clean; switching is this one value.
 * @returns `report-only` when `CSP_MODE` is unset or empty, else the parsed value.
 * @throws {Error} when `CSP_MODE` holds anything else, so a typo fails loudly instead of silently
 *   picking a mode.
 */
export function cspMode(): CspMode {
  const parsed = cspModeSchema.safeParse(process.env.CSP_MODE || undefined);
  if (!parsed.success) {
    throw new Error('CSP_MODE must be "report-only" or "enforce"');
  }
  return parsed.data;
}
