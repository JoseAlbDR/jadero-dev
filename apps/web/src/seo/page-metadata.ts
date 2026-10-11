import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/**
 * The Open Graph locale of each site locale: `og:locale` takes `language_TERRITORY`, not a bare
 * language tag.
 */
export const OG_LOCALES = {
  en: "en_US",
  es: "es_ES",
  de: "de_DE",
} as const satisfies Record<Locale, string>;

/** What a page knows about itself; the rest of its head is derived from it. */
export type PageMetadataInput = Readonly<{
  /** The locale being rendered. */
  locale: Locale;
  /** The page's own title, set into the layout's template; the home has none and uses the site's. */
  title?: string | undefined;
  /** The meta description, also the Open Graph and card description. */
  description: string;
  /** Canonical and hreflang links (`localeAlternates`, `contentAlternates`, ...); none on a page
   * that must not get any, like a later blog page. */
  alternates?: Metadata["alternates"] | undefined;
  /** The language the page's content is in when it differs from the page: English on the German
   * fallback and on every work-log entry (D-50). */
  contentLocale?: Locale | undefined;
  /** Set for a page about one piece of writing (a post, a project, a work-log entry): Open Graph
   * type `article` with its publish time and tags. */
  article?: Readonly<{ publishedTime?: string; tags?: readonly string[] }> | undefined;
  /** The page's `robots` (a later blog page, an entry that is not indexable). */
  robots?: Metadata["robots"] | undefined;
}>;

/**
 * The head of one page from what the page knows (ADR-022): title, description, canonical and
 * hreflang links, robots, and the Open Graph and Twitter card fields built from the same values,
 * so a shared link shows the page's own title in the language of its content. Next merges
 * metadata shallowly, so every page sets the whole `openGraph` object; this keeps them alike.
 * There is no Open Graph image yet, so the card is a `summary`.
 * @param input the page's title, description, alternates and content facts.
 * @param siteName the site's name for `og:site_name` (the `Metadata.title` message).
 * @returns the page's metadata.
 */
export function buildPageMetadata(input: PageMetadataInput, siteName: string): Metadata {
  const { locale, title, description, alternates, contentLocale, article, robots } = input;
  const ogLocale = contentLocale ?? locale;
  const languages = Object.keys(alternates?.languages ?? {});
  const alternateLocale = routing.locales
    .filter((l) => l !== ogLocale && languages.includes(l))
    .map((l) => OG_LOCALES[l]);
  const canonical = alternates?.canonical;
  const url = typeof canonical === "string" || canonical instanceof URL ? canonical : undefined;
  const shownTitle = title ?? siteName;

  return {
    ...(title !== undefined ? { title } : {}),
    description,
    ...(alternates ? { alternates } : {}),
    ...(robots ? { robots } : {}),
    openGraph: {
      siteName,
      title: shownTitle,
      description,
      locale: OG_LOCALES[ogLocale],
      ...(alternateLocale.length > 0 ? { alternateLocale } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(article
        ? {
            type: "article" as const,
            ...(article.publishedTime ? { publishedTime: article.publishedTime } : {}),
            ...(article.tags && article.tags.length > 0 ? { tags: [...article.tags] } : {}),
          }
        : { type: "website" as const }),
    },
    twitter: { card: "summary", title: shownTitle, description },
  };
}

/**
 * `buildPageMetadata` with the site name read from the locale's messages, for a page's
 * `generateMetadata`.
 * @param input the page's title, description, alternates and content facts.
 * @returns the page's metadata.
 */
export async function pageMetadata(input: PageMetadataInput): Promise<Metadata> {
  const t = await getTranslations({ locale: input.locale, namespace: "Metadata" });
  return buildPageMetadata(input, t("title"));
}
