import { REVALIDATE_SIGNATURE_HEADER, type RevalidateRequest } from "@jadero/contracts";
import { errorKind } from "@jadero/messaging";
import { signRevalidation } from "./revalidation-signature.js";
import { WebCache, type WebCacheResult } from "./web-cache.js";

/** How long one revalidation call may take before it counts as a transient failure. */
export const REVALIDATE_TIMEOUT_MS = 5000;

/** Options of {@link HttpWebCache}. */
export interface HttpWebCacheOptions {
  /** web's `POST /api/revalidate`, on the environment's private network. */
  readonly url: string;
  /** The key the call is signed with; never logged. */
  readonly secret: string;
  /** Defaults to {@link REVALIDATE_TIMEOUT_MS}; tests pass a short one. */
  readonly timeoutMs?: number;
  /** The clock for the signature's timestamp, in milliseconds; tests pin it. */
  readonly now?: () => number;
}

/**
 * Classifies web's answer (WP-14 D5; 404 is transient by the owner's decision of 2026-10-25: it
 * means web has not deployed the route yet, which a later attempt survives). A redirect is
 * permanent: the URL points at a page, not at the route, and waiting does not move it.
 * @param status the HTTP status web answered.
 * @returns the classified result.
 */
export function classifyStatus(status: number): WebCacheResult {
  if (status >= 200 && status < 300) return { kind: "revalidated" };
  if (status >= 500 || status === 404)
    return { kind: "transient", reason: `web answered ${status}` };
  return { kind: "permanent", reason: `web answered ${status}` };
}

/**
 * The HTTP adapter of {@link WebCache}: `POST` with the signed header, a timeout and the trace
 * context. `fetch` is not instrumented by the service's telemetry (WP-14 fact 14), so the
 * `traceparent` header is added here by hand. The response body is never read: only its status
 * counts, and nothing web sends reaches a log line.
 */
export class HttpWebCache extends WebCache {
  private readonly timeoutMs: number;
  private readonly now: () => number;

  /** @param options the route, the key, and the timeout and clock for tests. */
  constructor(private readonly options: HttpWebCacheOptions) {
    super();
    this.timeoutMs = options.timeoutMs ?? REVALIDATE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** @inheritdoc */
  override async revalidate(
    request: RevalidateRequest,
    traceparent?: string,
  ): Promise<WebCacheResult> {
    const body = JSON.stringify(request);
    const timestamp = Math.floor(this.now() / 1000);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [REVALIDATE_SIGNATURE_HEADER]: signRevalidation(this.options.secret, body, timestamp),
    };
    if (traceparent) headers.traceparent = traceparent;
    let response: Response;
    try {
      response = await fetch(this.options.url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return { kind: "transient", reason: failureReason(error) };
    }
    await response.body?.cancel().catch(() => undefined);
    return classifyStatus(response.status);
  }
}

/**
 * @param error what `fetch` threw: a `TimeoutError` from the signal, or a `TypeError` whose cause
 *   carries the socket's code (`ECONNREFUSED`).
 * @returns a reason without the URL or any message text.
 */
function failureReason(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "web timed out";
  const cause = error instanceof Error ? error.cause : undefined;
  return `web unreachable: ${errorKind(cause instanceof Error ? cause : error)}`;
}
