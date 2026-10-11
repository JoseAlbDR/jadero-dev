import type { SkillDto } from "@jadero/contracts";
import type { Locale } from "next-intl";

/** The skills of one category, as the stack page shows them in one tile. */
export type SkillGroup = Readonly<{
  /** The localized category name from the API ("Backend", "Pruebas"). */
  category: string;
  /** `lang` of the category name when it is in another language than the page, else `undefined`. */
  lang: Locale | undefined;
  skills: readonly SkillDto[];
}>;

/**
 * Groups the published skills by their category for the stack page. Categories keep the order in
 * which the API first lists them, and skills keep API order inside each category (the API sends
 * them in display order). The category is a localized display string, so the group key is that
 * string: on the German fallback an English skill whose category reads the same in both languages
 * ("Backend") joins the German group.
 * @param items the skills in API order.
 * @param pageLocale the page locale, to mark a category name in another language.
 * @returns one group per category.
 */
export function groupSkills(items: readonly SkillDto[], pageLocale: Locale): SkillGroup[] {
  const groups = new Map<string, { lang: Locale | undefined; skills: SkillDto[] }>();
  for (const skill of items) {
    const group = groups.get(skill.category);
    if (group) {
      group.skills.push(skill);
      // The name is in the page's language as soon as one skill of the page's locale carries it.
      if (skill.locale === pageLocale) group.lang = undefined;
    } else {
      const lang = skill.locale === pageLocale ? undefined : skill.locale;
      groups.set(skill.category, { lang, skills: [skill] });
    }
  }
  return [...groups].map(([category, { lang, skills }]) => ({ category, lang, skills }));
}

/** From this many skills on, a category tile spans two columns of the bento grid. */
export const WIDE_TILE_MIN_SKILLS = 6;
