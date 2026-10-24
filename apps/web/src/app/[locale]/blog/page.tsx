import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostIndex } from "@/components/post-index";
import { getPosts } from "@/content/api";
import { postCursorParam } from "@/content/posts";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
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
 * The blog: one page of blog posts (kind `post`, never a journal post), newest first, from
 * `GET /v1/content/:locale/posts?kind=post&cursor=` (cached 60 s under `content:posts`; the API
 * sets the page size, 20). The next page is a plain link with the API's `nextCursor` in
 * `?cursor=` (`PostIndex`); the nav's Blog entry is the first page. A `cursor` that is not one the
 * API could have built is the page's 404, and a valid one is rebuilt before it is forwarded
 * (`postCursorParam`). A failed call lands in the locale's error boundary.
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
    getPosts(locale, "post", cursor),
  ]);

  return (
    <PostIndex
      locale={locale}
      kind="post"
      page={page}
      firstPage={cursor === undefined}
      labels={{
        eyebrow: t("eyebrow"),
        title: t("title"),
        lead: t("lead"),
        empty: t("empty"),
        pagination: t("pagination"),
        older: t("older"),
      }}
    />
  );
}
