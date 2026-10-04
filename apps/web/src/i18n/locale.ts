import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "next-intl";
import { routing } from "./routing";

/**
 * Narrows the `[locale]` route segment to a supported locale, or renders the 404.
 * @param value the raw segment from the route params.
 * @returns the segment typed as a supported locale.
 */
export function requireLocale(value: string): Locale {
  if (!hasLocale(routing.locales, value)) {
    notFound();
  }
  return value;
}
