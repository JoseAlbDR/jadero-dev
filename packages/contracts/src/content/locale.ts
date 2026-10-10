import { z } from "zod";

/**
 * A content locale, the first path segment of every localized public read (ADR-022): `/content/es/...`.
 * The locale is always in the path and never negotiated from `Accept-Language`, so each URL names
 * one representation and caches need no `Vary`. Which locales are required to publish (es and en,
 * D-20) is a rule of `api`'s content domain, not part of this contract.
 */
export const locale = z.enum(["es", "en", "de"]);

/** `es`, `en` or `de`. */
export type Locale = z.infer<typeof locale>;
