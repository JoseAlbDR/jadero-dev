import type { CspMode } from "@/config/site";

/** Request header the proxy uses to hand the nonce to Server Components (`headers()`). */
export const NONCE_HEADER = "x-nonce";

/**
 * A fresh nonce for one request: 16 random bytes, base64. An attacker who injects a `<script>` would
 * have to guess it, so it must never repeat or be predictable (ADR-047).
 * @returns the nonce, without the `'nonce-'` wrapper.
 */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/**
 * The nonce-based (strict) Content-Security-Policy of the site (ADR-047). Scripts run only when
 * they carry the request's nonce or were loaded by one that does (`'strict-dynamic'`); everything
 * else is limited to the site itself: fonts are self-hosted (ADR-045) and the content API is called
 * from the server, never from the browser. Next.js reads the nonce back from this header and puts
 * it on its own scripts and inline styles.
 * @param nonce the request's nonce from `createNonce`.
 * @param options.dev true under `next dev`, which needs `'unsafe-eval'` (React's error overlay)
 *   and inline styles (its dev tools); never in a production build.
 * @returns the header value, directives separated by `; `.
 */
export function buildContentSecurityPolicy(nonce: string, options: { dev: boolean }): string {
  const { dev } = options;
  const directives = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

/**
 * The response header that carries the policy in a given mode.
 * @param mode `report-only` (the browser logs violations and blocks nothing) or `enforce`.
 * @returns the header name.
 */
export function cspHeaderName(mode: CspMode): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}
