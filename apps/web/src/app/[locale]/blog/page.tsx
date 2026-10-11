import { Card } from "@jadero/ui/components/card";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostList } from "@/components/post-list";
import { getPosts } from "@/content/api";
import { postCursorParam } from "@/content/posts";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { getPathname } from "@/i18n/navigation";
import { pageMetadata } from "@/seo/page-metadata";

type BlogPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}>;

/**
 * Title, description, canonical and hreflang links and Open Graph card of the blog (`/<locale>/blog`). A later page
 * (`?cursor=`) is `noindex, follow`: crawlers follow its posts but index only the first page, and it
 * carries no canonical or hreflang links, so no link is ever built from the visitor's query.
 * @param props.params the route params with the locale segment.
 * @param props.searchParams the query, read for `cursor` only.
 */
export async function generateMetadata({ params, searchParams }: BlogPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "BlogPage" });
  const later = (await searchParams).cursor !== undefined;
  return pageMetadata({
    locale,
    title: t("metaTitle"),
    description: t("metaDescription"),
    ...(later
      ? { robots: { index: false, follow: true } }
      : { alternates: localeAlternates("/blog", locale) }),
  });
}

/**
 * The blog: one page of posts, newest first, from `GET /v1/content/:locale/posts?cursor=` (cached
 * 60 s under `content:posts`; the API sets the page size, 20). The next page is a plain link with
 * the API's `nextCursor` in `?cursor=`, followed as a document navigation so its head is rendered
 * fresh; the API gives no cursor back, so there is no "newer" link (the nav's Blog entry is the
 * first page). A `cursor` that is not one the API could have built is
 * the page's 404, and a valid one is rebuilt before it is forwarded (`postCursorParam`). A failed
 * call lands in the locale's error boundary.
 * @param props.params the route params with the locale segment.
 * @param props.searchParams the query, read for `cursor` only.
 */
export default async function BlogPage({ params, searchParams }: BlogPageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const cursor = postCursorParam((await searchParams).cursor);
  if (cursor === null) notFound();
  const [t, page] = await Promise.all([
    getTranslations({ locale, namespace: "BlogPage" }),
    getPosts(locale, cursor),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Card asChild className="md:p-10">
        <header>
          <p className="font-mono text-signal text-xs uppercase tracking-widest">{t("eyebrow")}</p>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t("lead")}</p>
        </header>
      </Card>
      {page.items.length === 0 ? (
        <Card className="mt-8">
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        <PostList items={page.items} locale={locale} firstPage={cursor === undefined} />
      )}
      {page.nextCursor !== null && (
        <nav aria-label={t("pagination")} className="mt-8 flex justify-end">
          {/*
           * A plain <a>, not the router's Link: a document navigation renders the later page's head
           * on the server. With a client navigation, Next 16.3 can reuse the head it prefetched for
           * the nav's Blog link (same route, no cursor), so the page kept the first page's
           * canonical and hreflang links and lost its `noindex` (e2e/blog.spec.ts).
           */}
          <a
            href={getPathname({
              href: { pathname: "/blog", query: { cursor: page.nextCursor } },
              locale,
            })}
            className="glass inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm outline-none transition-colors hover:text-signal focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t("older")}
            <ArrowRight aria-hidden className="size-4" />
          </a>
        </nav>
      )}
    </main>
  );
}
