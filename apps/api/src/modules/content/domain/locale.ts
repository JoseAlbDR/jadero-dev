/**
 * The content locales (ADR-022). A string union is the value object here: the type system refuses
 * any other language, and `isLocale` turns an unchecked string into one.
 */
export const LOCALES = ["es", "en", "de"] as const;

/** `es`, `en` or `de`. */
export type Locale = (typeof LOCALES)[number];

/**
 * The locales an item needs published before it can go public (D-20): an item is never public in
 * one required language only.
 */
export const REQUIRED_LOCALES: readonly Locale[] = ["es", "en"];

/** The locales that may stay unpublished; a publish that leaves one out reports a warning (D-20). */
export const OPTIONAL_LOCALES: readonly Locale[] = LOCALES.filter(
  (locale) => !REQUIRED_LOCALES.includes(locale),
);

/**
 * Tells whether a string is a content locale.
 * @param value any string, such as a stored column.
 * @returns true for `es`, `en` and `de`.
 */
export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
