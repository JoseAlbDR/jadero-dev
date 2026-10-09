import { z } from "zod";
import { locale } from "./locale.js";
import { publishedText } from "./shared.js";

/** The kind of a profile link, which picks its icon and label in `web`. */
export const profileLinkKind = z.enum(["email", "github", "linkedin", "website"]);

/** One contact link of the profile: an HTTPS URL, or `mailto:` for `email`. */
export const profileLink = z.object({
  kind: profileLinkKind,
  url: z.url({ protocol: /^(https|mailto)$/ }),
});

/**
 * `GET /content/:locale/profile`: the owner's published profile, a singleton (ADR-011). `locale` is
 * the language of the text, which is `en` when German was asked for and is not published (German
 * fallback). `summary` is Markdown, returned raw; `web` renders and sanitizes it.
 */
export const profileDto = z.object({
  locale,
  name: publishedText,
  headline: publishedText,
  summary: publishedText,
  links: z.array(profileLink),
});

/** The public profile. */
export type ProfileDto = z.infer<typeof profileDto>;
