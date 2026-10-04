import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getPathname } from "./navigation";
import { routing } from "./routing";

type Href = Parameters<typeof getPathname>[0]["href"];

/**
 * Canonical and hreflang alternates for one page (ADR-022). Each page sets its own, so a page never
 * inherits another page's canonical; `x-default` points at the English version (D-19).
 * @param href the page as a `routing.pathnames` key (with params, if any).
 * @param locale the locale being rendered.
 * @returns the `alternates` field of the page's metadata.
 */
export function localeAlternates(href: Href, locale: Locale): Metadata["alternates"] {
  const path = (l: Locale) => getPathname({ href, locale: l });
  return {
    canonical: path(locale),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, path(l)])),
      "x-default": path(routing.defaultLocale),
    },
  };
}
