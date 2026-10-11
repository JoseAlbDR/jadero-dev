import type {
  KnowledgeEntryListDto,
  PostPageDto,
  PostSummaryDto,
  ProjectListDto,
  ProjectSummaryDto,
} from "@jadero/contracts";
import type { Locale } from "next-intl";
import { describe, expect, it } from "vitest";
import { contentAlternates, englishOnlyAlternates, localeAlternates } from "../src/i18n/alternates";
import { buildPageMetadata } from "../src/seo/page-metadata";
import { robotsFor } from "../src/seo/robots";
import { buildSitemap, type SitemapSources, STATIC_PAGES } from "../src/seo/sitemap";

const SITE = new URL("https://jadero.dev");

describe("buildPageMetadata", () => {
  it("builds a website card in the page's language with the other locales as alternates", () => {
    const metadata = buildPageMetadata(
      {
        locale: "es",
        title: "Experiencia",
        description: "Roles y logros.",
        alternates: localeAlternates("/experience", "es"),
      },
      "jadero.dev",
    );
    expect(metadata.title).toBe("Experiencia");
    expect(metadata.alternates?.canonical).toBe("/es/experiencia");
    expect(metadata.openGraph).toEqual({
      siteName: "jadero.dev",
      title: "Experiencia",
      description: "Roles y logros.",
      locale: "es_ES",
      alternateLocale: ["en_US", "de_DE"],
      url: "/es/experiencia",
      type: "website",
    });
    expect(metadata.twitter).toEqual({
      card: "summary",
      title: "Experiencia",
      description: "Roles y logros.",
    });
  });

  it("keeps the layout's title on the home and uses the site name in the card", () => {
    const metadata = buildPageMetadata(
      { locale: "en", description: "Site.", alternates: localeAlternates("/", "en") },
      "jadero.dev",
    );
    expect(metadata).not.toHaveProperty("title");
    expect(metadata.openGraph?.title).toBe("jadero.dev");
  });

  it("marks the German fallback card as the English article it points at", () => {
    const metadata = buildPageMetadata(
      {
        locale: "de",
        title: "Search index",
        description: "A search index.",
        alternates: contentAlternates("/projects/[slug]", {
          slug: "search-index",
          locale: "en",
          alternates: { en: "search-index", es: "indice-de-busqueda" },
        }),
        contentLocale: "en",
        article: { tags: ["postgres"] },
      },
      "jadero.dev",
    );
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      url: "/en/projects/search-index",
      locale: "en_US",
      alternateLocale: ["es_ES"],
      tags: ["postgres"],
    });
  });

  it("gives a page without canonical no og:url and keeps its robots", () => {
    const metadata = buildPageMetadata(
      {
        locale: "en",
        title: "Blog",
        description: "Notes.",
        robots: { index: false, follow: true },
      },
      "jadero.dev",
    );
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata).not.toHaveProperty("alternates");
    expect(metadata.openGraph).not.toHaveProperty("url");
    expect(metadata.openGraph).not.toHaveProperty("alternateLocale");
  });

  it("adds the publish time of an article and no alternates for an English-only entry", () => {
    const metadata = buildPageMetadata(
      {
        locale: "es",
        title: "Outbox relay",
        description: "Entry.",
        alternates: englishOnlyAlternates({
          pathname: "/work/[entryId]",
          params: { entryId: "kb-outbox-relay" },
        }),
        contentLocale: "en",
        article: { publishedTime: "2026-10-01T09:00:00.000Z" },
      },
      "jadero.dev",
    );
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      locale: "en_US",
      url: "/en/work/kb-outbox-relay",
      publishedTime: "2026-10-01T09:00:00.000Z",
    });
    expect(metadata.openGraph).not.toHaveProperty("alternateLocale");
  });
});

describe("robotsFor", () => {
  it("allows every crawler everywhere and points at the sitemap on the site's origin", () => {
    expect(robotsFor(SITE)).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://jadero.dev/sitemap.xml",
    });
  });
});

/** A project card as the API lists it. */
function project(
  slug: string,
  locale: Locale,
  alternates: ProjectSummaryDto["alternates"],
): ProjectSummaryDto {
  return {
    slug,
    locale,
    kind: "project",
    title: slug,
    summary: "",
    stackTags: [],
    featured: false,
    alternates,
  };
}

/** A post card as the API lists it. */
function post(slug: string, locale: Locale, alternates: PostSummaryDto["alternates"]) {
  return {
    slug,
    locale,
    title: slug,
    excerpt: "",
    tags: [],
    publishedAt: "2026-10-01T09:00:00.000Z",
    alternates,
  } satisfies PostSummaryDto;
}

const RELAY = { en: "message-relay", es: "relay-de-mensajes", de: "nachrichten-relay" };
const SEARCH = { en: "search-index", es: "indice-de-busqueda" };

const PROJECTS: Record<Locale, ProjectListDto> = {
  en: { items: [project("message-relay", "en", RELAY), project("search-index", "en", SEARCH)] },
  es: {
    items: [project("relay-de-mensajes", "es", RELAY), project("indice-de-busqueda", "es", SEARCH)],
  },
  // German is not published for the search index: the API falls back to English.
  de: { items: [project("nachrichten-relay", "de", RELAY), project("search-index", "en", SEARCH)] },
};

const OUTBOX = { en: "why-an-outbox", es: "por-que-un-outbox" };
const NOTES = { en: "first-notes" };

/** Two pages of posts per locale, so the walk follows `nextCursor`. */
function posts(locale: Locale, cursor?: string): PostPageDto {
  const items = {
    en: [post("why-an-outbox", "en", OUTBOX), post("first-notes", "en", NOTES)],
    es: [post("por-que-un-outbox", "es", OUTBOX), post("first-notes", "en", NOTES)],
    de: [post("why-an-outbox", "en", OUTBOX), post("first-notes", "en", NOTES)],
  }[locale];
  return cursor === undefined
    ? { items: items.slice(0, 1), nextCursor: "page-2" }
    : { items: items.slice(1), nextCursor: null };
}

const WORK: KnowledgeEntryListDto = {
  items: [
    { id: "kb-outbox-relay", indexable: true },
    { id: "kb-inbox-dedup", indexable: false },
  ] as KnowledgeEntryListDto["items"],
};

const SOURCES: SitemapSources = {
  projects: async (locale) => PROJECTS[locale],
  posts: async (locale, cursor) => posts(locale, cursor),
  workLog: async () => WORK,
};

const STATIC_URLS = STATIC_PAGES.length * 3;

describe("buildSitemap", () => {
  it("lists the static pages in every locale with their hreflang alternates", async () => {
    const entries = await buildSitemap(SOURCES, SITE);
    const experience = entries.find((e) => e.url === "https://jadero.dev/de/erfahrung");
    expect(experience?.alternates?.languages).toEqual({
      en: "https://jadero.dev/en/experience",
      es: "https://jadero.dev/es/experiencia",
      de: "https://jadero.dev/de/erfahrung",
      "x-default": "https://jadero.dev/en/experience",
    });
    expect(entries.map((e) => e.url).slice(0, 3)).toEqual([
      "https://jadero.dev/en",
      "https://jadero.dev/es",
      "https://jadero.dev/de",
    ]);
  });

  it("lists content in each locale it is published in, never a German fallback", async () => {
    const urls = (await buildSitemap(SOURCES, SITE)).map((e) => e.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://jadero.dev/en/projects/message-relay",
        "https://jadero.dev/es/proyectos/relay-de-mensajes",
        "https://jadero.dev/de/projekte/nachrichten-relay",
        "https://jadero.dev/en/projects/search-index",
        "https://jadero.dev/es/proyectos/indice-de-busqueda",
        "https://jadero.dev/en/blog/why-an-outbox",
        "https://jadero.dev/en/blog/first-notes",
        "https://jadero.dev/es/blog/por-que-un-outbox",
      ]),
    );
    expect(urls).not.toContain("https://jadero.dev/de/projekte/search-index");
    expect(urls).not.toContain("https://jadero.dev/de/blog/why-an-outbox");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("gives a post its publish time and its published slugs as alternates", async () => {
    const entries = await buildSitemap(SOURCES, SITE);
    const outbox = entries.find((e) => e.url === "https://jadero.dev/es/blog/por-que-un-outbox");
    expect(outbox).toEqual({
      url: "https://jadero.dev/es/blog/por-que-un-outbox",
      lastModified: "2026-10-01T09:00:00.000Z",
      alternates: {
        languages: {
          en: "https://jadero.dev/en/blog/why-an-outbox",
          es: "https://jadero.dev/es/blog/por-que-un-outbox",
          "x-default": "https://jadero.dev/en/blog/why-an-outbox",
        },
      },
    });
  });

  it("lists only indexable work-log entries, under /en only (D-50, D-52)", async () => {
    const urls = (await buildSitemap(SOURCES, SITE)).map((e) => e.url);
    expect(urls).toContain("https://jadero.dev/en/work/kb-outbox-relay");
    expect(urls).not.toContain("https://jadero.dev/en/work/kb-inbox-dedup");
    expect(urls.filter((u) => u.includes("kb-outbox-relay"))).toHaveLength(1);
  });

  it("falls back to the static pages when the content API is down", async () => {
    const down = async (): Promise<never> => {
      throw new Error("fetch failed");
    };
    const failures: string[] = [];
    const entries = await buildSitemap(
      { projects: down, posts: down, workLog: down },
      SITE,
      (resource) => failures.push(resource),
    );
    expect(entries).toHaveLength(STATIC_URLS);
    expect(failures.sort()).toEqual([
      "posts de",
      "posts en",
      "posts es",
      "projects de",
      "projects en",
      "projects es",
      "work log",
    ]);
  });

  it("keeps the posts read before a later page fails", async () => {
    const entries = await buildSitemap(
      {
        ...SOURCES,
        posts: async (locale, cursor) => {
          if (cursor !== undefined) throw new Error("fetch failed");
          return posts(locale);
        },
      },
      SITE,
    );
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://jadero.dev/en/blog/why-an-outbox");
    expect(urls).not.toContain("https://jadero.dev/en/blog/first-notes");
  });
});
