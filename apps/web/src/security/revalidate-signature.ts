import { createHmac, timingSafeEqual } from "node:crypto";
import { REVALIDATE_MAX_SKEW_SECONDS, revalidateSignature } from "@jadero/contracts";

/**
 * Verifies the `X-Jadero-Signature` of a revalidation call (WP-14 D6, ADR-047): the header parses
 * as `t=<unix seconds>,v1=<hex HMAC-SHA256>`, the timestamp is at most five minutes from this
 * server's clock either way, and the digest equals the HMAC of `"<t>.<raw body>"` under the shared
 * key, compared in constant time so the time a wrong guess takes says nothing about how close it
 * was. A replay inside the window only repeats a harmless revalidation.
 * @param header the header's value, if the request had one.
 * @param body the raw request body, exactly as received.
 * @param secret the shared key.
 * @param nowSeconds this server's time in Unix seconds.
 * @returns whether the call comes from a holder of the key, recently.
 */
export function verifyRevalidationSignature(
  header: string | null,
  body: string,
  secret: string,
  nowSeconds: number,
): boolean {
  const parsed = revalidateSignature.safeParse(header);
  if (!parsed.success) return false;
  const { timestamp, digest } = parsed.data;
  if (Math.abs(nowSeconds - timestamp) > REVALIDATE_MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  // Both are 32 bytes: the contract only accepts a 64-character hex digest.
  return timingSafeEqual(expected, Buffer.from(digest, "hex"));
}
