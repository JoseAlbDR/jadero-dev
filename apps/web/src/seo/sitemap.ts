import type {
  KnowledgeEntryListDto,
  PostPageDto,
  PostSummaryDto,
  ProjectListDto,
  ProjectSummaryDto,
} from "@jadero/contracts";
import type { Metadata, MetadataRoute } from "next";
import type { Locale } from "next-intl";
import { contentAlternates, englishOnlyAlternates, localeAlternates } from "@/i18n/alternates";
import { routing } from "@/i18n/routing";

/** The pages that exist in every locale whatever the content, in sitemap order. */
export const STATIC_PAGES = ["/", "/experience", "/projects", "/stack", "/blog", "/work"] as const;

/**
 * How many list pages of posts the sitemap reads per locale at most (20 posts each from the real
 * API): a bound on the requests one sitemap costs, far above what the blog holds.
 */
export const SITEMAP_POSTS_MAX_PAGES = 50;

/** Where the sitemap reads the content from: the content client in the app, fakes in tests. */
export type SitemapSources = Readonly<{
  projects: (locale: Locale) => Promise<ProjectListDto>;
  posts: (locale: Locale, cursor?: string) => Promise<PostPageDto>;
  workLog: () => Promise<KnowledgeEntryListDto>;
}>;

/** Called once per content list the sitemap had to leave out, with the list's name only. */
export type SitemapFailureHandler = (resource: string) => void;

type Entry = MetadataRoute.Sitemap[number];

/**
 * The sitemap of the site (ADR-022): every static page in every locale, then each project and
 * post in each locale it is published in (a German fallback to English is the English page, so it
 * is not listed under `/de`), then each indexable work-log entry under `/en` only (D-50, D-52).
 * Each URL carries its hreflang alternates, the same ones the page's head links to, `x-default`
 * included. A content list that fails (API down, a refused payload) is left out and reported to
 * `onFailure`, so the sitemap degrades to fewer URLs instead of failing.
 * @param sources reads the projects, the post pages and the work log.
 * @param siteUrl the public origin every URL is resolved on (`SITE_URL`).
 * @param onFailure told the name of each list left out.
 * @returns the sitemap entries, each URL once.
 */
export async function buildSitemap(
  sources: SitemapSources,
  siteUrl: URL,
  onFailure: SitemapFailureHandler = () => {},
): Promise<MetadataRoute.Sitemap> {
  const entry = (alternates: Metadata["alternates"], lastModified?: string): Entry =>
    sitemapEntry(alternates, siteUrl, lastModified);

  const staticEntries = STATIC_PAGES.flatMap((href) =>
    routing.locales.map((locale) => entry(localeAlternates(href, locale))),
  );

  const [projects, posts, work] = await Promise.all([
    Promise.all(
      routing.locales.map(async (locale) => {
        const list = await attempt(() => sources.projects(locale), `projects ${locale}`, onFailure);
        return ownLocale(list?.items ?? [], locale).map((item) =>
          entry(contentAlternates("/projects/[slug]", item)),
        );
      }),
    ),
    Promise.all(
      routing.locales.map(async (locale) => {
        const items = await allPosts(locale, sources, onFailure);
        return ownLocale(items, locale).map((item) =>
          entry(contentAlternates("/blog/[slug]", item), item.publishedAt),
        );
      }),
    ),
    attempt(() => sources.workLog(), "work log", onFailure),
  ]);
  const workEntries = (work?.items ?? [])
    .filter((item) => item.indexable)
    .map((item) =>
      entry(englishOnlyAlternates({ pathname: "/work/[entryId]", params: { entryId: item.id } })),
    );

  const unique = new Map<string, Entry>();
  for (const e of [...staticEntries, ...projects.flat(), ...posts.flat(), ...workEntries]) {
    if (!unique.has(e.url)) unique.set(e.url, e);
  }
  return [...unique.values()];
}

/**
 * One sitemap entry from a page's metadata alternates: the canonical as the URL, the hreflang
 * links as its alternates, all resolved on the site's origin.
 */
function sitemapEntry(
  alternates: Metadata["alternates"],
  siteUrl: URL,
  lastModified?: string,
): Entry {
  const absolute = (path: unknown) => new URL(String(path), siteUrl).href;
  const languages = Object.fromEntries(
    Object.entries(alternates?.languages ?? {}).map(([lang, path]) => [lang, absolute(path)]),
  );
  return {
    url: absolute(alternates?.canonical),
    ...(lastModified ? { lastModified } : {}),
    alternates: { languages },
  };
}

/** The items the API returned in the list's own locale, without the German fallback ones. */
function ownLocale<T extends ProjectSummaryDto | PostSummaryDto>(
  items: readonly T[],
  locale: Locale,
): T[] {
  return items.filter((item) => item.locale === locale);
}

/**
 * Every post of a locale, walking the list pages newest first up to `SITEMAP_POSTS_MAX_PAGES`. A
 * page that fails stops the walk; the posts read before it stay in the sitemap.
 */
async function allPosts(
  locale: Locale,
  sources: SitemapSources,
  onFailure: SitemapFailureHandler,
): Promise<PostSummaryDto[]> {
  const items: PostSummaryDto[] = [];
  let cursor: string | undefined;
  for (let read = 0; read < SITEMAP_POSTS_MAX_PAGES; read++) {
    const page = await attempt(() => sources.posts(locale, cursor), `posts ${locale}`, onFailure);
    if (!page) break;
    items.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return items;
}

/**
 * Runs one content read; on any failure reports the list's name and returns `undefined`. The
 * error itself is not passed on: the sitemap needs to know only that the list is missing.
 */
async function attempt<T>(
  read: () => Promise<T>,
  resource: string,
  onFailure: SitemapFailureHandler,
): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    onFailure(resource);
    return undefined;
  }
}
