import { createHmac } from "node:crypto";

/**
 * Signs one revalidation call (WP-14 D6, ADR-047): an HMAC-SHA256 keyed with `REVALIDATE_SECRET`
 * over `"<timestamp>.<body>"`, the webhook signature shape of Stripe. The timestamp is inside the
 * signed text, so a captured header cannot be replayed with a fresh time, and `web` refuses one
 * more than five minutes off. The body is signed exactly as it is sent, byte for byte.
 * @param secret the shared key; never logged.
 * @param body the raw JSON body of the call.
 * @param timestamp the signing time in whole Unix seconds.
 * @returns the value of `X-Jadero-Signature`: `t=<timestamp>,v1=<hex digest>`.
 */
export function signRevalidation(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
