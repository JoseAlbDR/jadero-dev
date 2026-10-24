import type { Alternates } from "@jadero/contracts";
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

/** A page of one content item, addressed by the item's own localized slug. */
type ContentPathname = "/projects/[slug]" | "/blog/[slug]" | "/journal/[slug]";

/**
 * Canonical and hreflang alternates for the page of one content item whose slug differs per locale
 * (ADR-022). Only the locales the item is published in get an hreflang link, each with its own
 * slug; `x-default` is the English page. When the API answered in another language than the page
 * (the German fallback to English), the page is a copy of that language's page, so its canonical
 * points there, the same rule as the English-only work-log pages (D-50).
 * @param pathname the page as a `routing.pathnames` key with a `[slug]` param.
 * @param item the returned item: its `slug`, its `locale` (the page's, or English on the German
 *   fallback) and its published slugs per locale.
 * @returns the `alternates` field of the page's metadata.
 */
export function contentAlternates(
  pathname: ContentPathname,
  item: Readonly<{ slug: string; locale: Locale; alternates: Alternates }>,
): Metadata["alternates"] {
  const path = (l: Locale, slug: string) =>
    getPathname({ href: { pathname, params: { slug } }, locale: l });
  const published = routing.locales.flatMap((l) => {
    const slug = item.alternates[l];
    return slug ? [[l, path(l, slug)] as const] : [];
  });
  const english = item.alternates[routing.defaultLocale];
  return {
    canonical: path(item.locale, item.slug),
    languages: {
      ...Object.fromEntries(published),
      ...(english ? { "x-default": path(routing.defaultLocale, english) } : {}),
    },
  };
}

/**
 * Canonical and hreflang alternates for a page whose content exists in English only: the work-log
 * entry pages (D-50). The `/es` and `/de` pages show the same English entry, so they are copies of
 * the English page: every locale's canonical points at it, and the only hreflang links are `en` and
 * `x-default`, both the English page. Translated entries would get their own links (issue #116).
 * @param href the page as a `routing.pathnames` key (with params, if any).
 * @returns the `alternates` field of the page's metadata, the same in every locale.
 */
export function englishOnlyAlternates(href: Href): Metadata["alternates"] {
  const english = getPathname({ href, locale: routing.defaultLocale });
  return {
    canonical: english,
    languages: { [routing.defaultLocale]: english, "x-default": english },
  };
}
