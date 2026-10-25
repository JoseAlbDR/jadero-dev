import type { RevalidateRequest } from "@jadero/contracts";

/** What one call to web's revalidation route came to, classified once (WP-14 D5). */
export type WebCacheResult =
  | { readonly kind: "revalidated" }
  /** Waiting can fix it: web is down, slow, deploying or answered 5xx or 404. */
  | { readonly kind: "transient"; readonly reason: string }
  /** Waiting cannot fix it: a wrong secret (401), a body web refuses (400), any other 4xx. */
  | { readonly kind: "permanent"; readonly reason: string };

/**
 * The port to web's cache (ADR-003: an abstract class, so also the DI token): drop what the given
 * changes touch. The HTTP adapter signs the call; tests use a fake that records the requests.
 */
export abstract class WebCache {
  /**
   * Asks web to drop the cache entries of these changes. Never throws for a failed call: every
   * failure comes back classified, and its reason names a status or an error kind, never a body.
   * @param request the changes, already valid against `revalidateRequest`.
   * @param traceparent the W3C trace context to continue on web's side, when there is one.
   * @returns whether web revalidated, or why not and whether a retry can help.
   */
  abstract revalidate(request: RevalidateRequest, traceparent?: string): Promise<WebCacheResult>;
}
