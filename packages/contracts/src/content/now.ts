import { z } from "zod";
import { locale } from "./locale.js";
import { publishedText } from "./shared.js";

/**
 * `GET /content/:locale/now`: the owner's published /now page, a singleton (WP-39 D2, ADR-034).
 * `locale` is the language of the text, which is `en` when German was asked for and is not
 * published (German fallback). `body` is Markdown, returned raw; `web` renders and sanitizes it.
 * `publishedAt` is when that locale's published text last changed, the page's "updated on" date.
 */
export const nowDto = z.object({
  locale,
  body: publishedText,
  publishedAt: z.iso.datetime(),
});

/** The public /now page. */
export type NowDto = z.infer<typeof nowDto>;
