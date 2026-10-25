import { z } from "zod";
import { cvBulletId, knowledgeEntryId, slug } from "./params.js";

/** The most changes one revalidation call may carry: one event names a handful at most. */
export const MAX_REVALIDATE_CHANGES = 20;

/**
 * One thing whose public representation changed, as `api-worker` knows it from an event (WP-14 Q1
 * B). It names content facts, never `web`'s cache tags: `web` maps each change to its own tags, so
 * it can restructure them without an `api` release. `kind` is a content type or `knowledge-entry`.
 * Projects and posts also carry `slug`, the localized slug, because `web` tags an item page by it
 * (one change per slug when several locales moved). No change carries a locale: no tag holds one.
 */
export const revalidateChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile"), id: z.uuid() }),
  z.object({ kind: z.literal("now"), id: z.uuid() }),
  z.object({ kind: z.literal("experience-item"), id: z.uuid() }),
  z.object({ kind: z.literal("project"), id: z.uuid(), slug }),
  z.object({ kind: z.literal("post"), id: z.uuid(), slug }),
  z.object({ kind: z.literal("skill"), id: z.uuid() }),
  z.object({ kind: z.literal("cv-bullet"), id: cvBulletId }),
  z.object({ kind: z.literal("knowledge-entry"), id: knowledgeEntryId }),
]);

/** One changed item. */
export type RevalidateChange = z.infer<typeof revalidateChange>;

/**
 * The body of `POST /api/revalidate` on `web`, sent by `api-worker`'s revalidation consumer and
 * signed with the internal header (WP-14 D6, ADR-047). At least one change, at most
 * `MAX_REVALIDATE_CHANGES`, so the route never loops over an unbounded list.
 */
export const revalidateRequest = z.object({
  changes: z.array(revalidateChange).min(1).max(MAX_REVALIDATE_CHANGES),
});

/** A revalidation call's body. */
export type RevalidateRequest = z.infer<typeof revalidateRequest>;

/**
 * The header that signs a revalidation call (WP-14 D6, ADR-047, the internal signature of
 * ADR-008), lowercase as Node and the Fetch API hand header names over.
 */
export const REVALIDATE_SIGNATURE_HEADER = "x-jadero-signature";

/**
 * How far, in seconds, the signature's timestamp may be from the receiver's clock, either way. A
 * captured header stops working after it; a replay inside it only repeats a harmless
 * revalidation (WP-14 D5).
 */
export const REVALIDATE_MAX_SKEW_SECONDS = 300;

/**
 * The value of {@link REVALIDATE_SIGNATURE_HEADER}: `t=<unix seconds>,v1=<hex HMAC-SHA256>`, the
 * HMAC keyed with `REVALIDATE_SECRET` over `"<t>.<raw body>"`, the webhook signature shape of
 * Stripe. Parsed into the timestamp and the 32-byte digest in hex; the cryptography itself lives in
 * the two services, since this package holds schemas only.
 */
export const revalidateSignature = z
  .string()
  .regex(/^t=\d{1,12},v1=[0-9a-f]{64}$/)
  .transform((value) => {
    const [t = "", v1 = ""] = value.split(",").map((part) => part.slice(part.indexOf("=") + 1));
    return { timestamp: Number(t), digest: v1 };
  });

/** A parsed revalidation signature. */
export type RevalidateSignature = z.output<typeof revalidateSignature>;
