import { REVALIDATE_SIGNATURE_HEADER, revalidateRequest } from "@jadero/contracts";
import { revalidateTag } from "next/cache";
import { revalidateSecret } from "@/config/site";
import { tagsForChanges } from "@/content/revalidate-tags";
import { verifyRevalidationSignature } from "@/security/revalidate-signature";

/** A call names at most 20 changes; anything near this size is not one (ADR-047 body limits). */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * `POST /api/revalidate`: the internal route `api-worker`'s revalidation consumer calls after a
 * content event (WP-14 D4 to D6, ADR-047). Never public: nginx answers 404 on it, and the route
 * still checks the signature, so a misrouted location is not enough to call it. Order: the size,
 * the signature over the raw body (401 on any problem, and when no key is configured), then the
 * body against its contract (400), then each change's tags dropped with `{ expire: 0 }`, so the
 * next visitor waits for fresh content instead of seeing the old text once more (204). The
 * proxy's matcher skips `/api`, so neither the CSP nor next-intl's locale redirect touch it.
 * Logs carry only the count of tags dropped, never the body.
 * @param request the incoming call.
 * @returns 204, 400, 401 or 413, with no body.
 */
export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const secret = revalidateSecret();
  const signature = request.headers.get(REVALIDATE_SIGNATURE_HEADER);
  const now = Math.floor(Date.now() / 1000);
  if (!secret || !verifyRevalidationSignature(signature, body, secret, now)) {
    return new Response(null, { status: 401 });
  }

  const parsed = revalidateRequest.safeParse(parseJson(body));
  if (!parsed.success) return new Response(null, { status: 400 });

  const tags = tagsForChanges(parsed.data.changes);
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  console.info(`revalidate: ${tags.length} tags dropped`);
  return new Response(null, { status: 204 });
}

/** @returns the parsed JSON, or `undefined` when the text is not JSON (the contract refuses it). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
