import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostIndex } from "@/components/post-index";
import { getPosts } from "@/content/api";
import { postCursorParam } from "@/content/posts";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { pageMetadata } from "@/seo/page-metadata";

type JournalPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}>;

/**
 * Title, description, canonical and hreflang links and Open Graph card of the journal
 * (`/<locale>/journal`). A later page (`?cursor=`) is `noindex, follow` without canonical or
 * hreflang links, the same rule as the blog.
 * @param props.params the route params with the locale segment.
 * @param props.searchParams the query, read for `cursor` only.
 */
export async function generateMetadata({
  params,
  searchParams,
}: JournalPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "JournalPage" });
  const later = (await searchParams).cursor !== undefined;
  return pageMetadata({
    locale,
    title: t("metaTitle"),
    description: t("metaDescription"),
    ...(later
      ? { robots: { index: false, follow: true } }
      : { alternates: localeAlternates("/journal", locale) }),
  });
}

/**
 * The build journal (ADR-034): one page of journal posts, one per work package, newest first, from
 * `GET /v1/content/:locale/posts?kind=journal&cursor=` (cached 60 s under `content:posts`). Each
 * card carries its "WP-<n>" label; the paging, the cursor check and the error boundary work as on
 * the blog (`PostIndex`, `postCursorParam`).
 * @param props.params the route params with the locale segment.
 * @param props.searchParams the query, read for `cursor` only.
 */
export default async function JournalPage({ params, searchParams }: JournalPageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const cursor = postCursorParam((await searchParams).cursor);
  if (cursor === null) notFound();
  const [t, page] = await Promise.all([
    getTranslations({ locale, namespace: "JournalPage" }),
    getPosts(locale, "journal", cursor),
  ]);

  return (
    <PostIndex
      locale={locale}
      kind="journal"
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
