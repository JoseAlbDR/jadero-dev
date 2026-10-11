import { type CvBulletDto, cvBulletId, type ExperienceListDto } from "@jadero/contracts";
import type { Locale } from "next-intl";

/** The CV bullet an "Ask about this" link points at, as the home terminal shows it. */
export type AskBullet = Readonly<{
  id: CvBulletDto["id"];
  /** The bullet text from the content API, never anything from the URL. */
  text: string;
  /** The language of the text: `en` on the German fallback, else the page's locale. */
  locale: Locale;
}>;

/**
 * Reads the `?ask=` of the home from the visitor's URL. The value must be one CV bullet id as the
 * contract defines it (`cvBulletId`: lowercase kebab case, at most 80 characters); anything else
 * (absent, repeated, too long, other characters) is ignored, so no request is made for it.
 * @param value the raw search param (absent, one value or repeated).
 * @returns the bullet id, or `null` when the value is not one.
 */
export function askBulletIdParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const parsed = cvBulletId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Finds the published CV bullet with this id in the experience list, so the terminal shows the
 * bullet's own text. An id no published bullet has gives `null`: the terminal then shows its empty
 * prompt, and the id never reaches the page.
 * @param id a bullet id already checked by `askBulletIdParam`.
 * @param experience the experience list of the page's locale.
 * @returns the bullet with the language of its text, or `null`.
 */
export function findAskBullet(id: string, experience: ExperienceListDto): AskBullet | null {
  for (const item of experience.items) {
    const bullet = item.bullets.find((b) => b.id === id);
    if (bullet) return { id: bullet.id, text: bullet.text, locale: item.locale };
  }
  return null;
}
