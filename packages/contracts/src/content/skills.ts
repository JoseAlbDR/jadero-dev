import { z } from "zod";
import { locale } from "./locale.js";
import { slug } from "./params.js";
import { publishedText } from "./shared.js";

/**
 * One published skill. `category` is a localized display string ("IA aplicada", "applied AI");
 * `projectSlugs` are the canonical slugs of the projects that show it, the stable ids an admin route
 * or a link resolver uses, not localized slugs.
 */
export const skillDto = z.object({
  locale,
  name: publishedText,
  category: publishedText,
  projectSlugs: z.array(slug),
});

/** A public skill. */
export type SkillDto = z.infer<typeof skillDto>;

/** `GET /content/:locale/skills`: every published skill, in display order. */
export const skillListDto = z.object({ items: z.array(skillDto) });

/** The public skill list. */
export type SkillListDto = z.infer<typeof skillListDto>;
