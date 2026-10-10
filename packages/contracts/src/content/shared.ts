import { z } from "zod";
import { slug } from "./params.js";

/**
 * The published localized slug of one item in each locale it is published in, for `hreflang` links
 * (WP-16). A locale without a published version is absent: `{ "es": "portal-de-empleo", "en":
 * "jobs-hub" }` has no German page.
 */
export const alternates = z.object({
  es: slug.optional(),
  en: slug.optional(),
  de: slug.optional(),
});

/** Published slugs per locale. */
export type Alternates = z.infer<typeof alternates>;

/** A year and month, `2025-03`: periods have month precision (the entry format of ADR-031). */
export const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * A span of time with month precision. `to: null` means ongoing ("2024 to now"). Structured rather
 * than one string, so each locale's page formats it in its own words.
 */
export const period = z
  .object({ from: yearMonth, to: yearMonth.nullable() })
  .refine((p) => p.to === null || p.from <= p.to, {
    message: "A period cannot end before it starts",
    path: ["to"],
  });

/** `{ from: "2025-03", to: "2025-05" }`, or `to: null` while it lasts. */
export type Period = z.infer<typeof period>;

/**
 * A link a page renders as `href`: HTTPS only, so a stored `javascript:` or plain `http:` URL is
 * refused by the response schema instead of reaching the browser.
 */
export const httpsUrl = z.url({ protocol: /^https$/ });

/**
 * A text a published page needs: at least one character that is not whitespace. The content domain
 * refuses to publish a revision whose required text is blank, and the public DTO is never weaker
 * than that rule (`apps/api/test/content-documents.contract.test.ts` keeps the two equal).
 */
export const publishedText = z.string().regex(/\S/, { message: "Must not be blank" });

/** A free list of display tags (`NestJS`, `PostgreSQL`): non-empty strings. */
export const tags = z.array(z.string().min(1).max(60));
