import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostArticle } from "@/components/post-article";
import { loadPostPage } from "@/content/post-page";
import { contentAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { pageMetadata } from "@/seo/page-metadata";

type JournalPostPageProps = Readonly<{ params: Promise<{ locale: string; slug: string }> }>;

/**
 * Title, description, canonical and hreflang links and Open Graph card of a journal post page, the
 * same rules as a blog post: hreflang links per published locale with its own slug, the English
 * page as canonical on the German fallback.
 * @param props.params the route params with the locale and the localized slug.
 */
export async function generateMetadata({ params }: JournalPostPageProps): Promise<Metadata> {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  const post = await loadPostPage(locale, slug, "journal");
  return pageMetadata({
    locale,
    title: post.title,
    description: post.excerpt,
    alternates: contentAlternates("/journal/[slug]", post),
    contentLocale: post.locale,
    article: { publishedTime: post.publishedAt, tags: post.tags },
  });
}

/**
 * One journal post (`/<locale>/journal/<slug>`, ADR-034) from `GET /v1/content/:locale/posts/:slug`.
 * Another locale's slug redirects to this locale's; a slug no journal post has, a blog post's slug
 * included, is the page's 404 (`loadPostPage`). The body is `PostArticle`, as on the blog, with the
 * post's "WP-<n>" label beside its date.
 * @param props.params the route params with the locale and the localized slug.
 */
export default async function JournalPostPage({ params }: JournalPostPageProps) {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  setRequestLocale(locale);
  const [tJournal, tBlog, post] = await Promise.all([
    getTranslations({ locale, namespace: "JournalPage" }),
    getTranslations({ locale, namespace: "BlogPage" }),
    loadPostPage(locale, slug, "journal"),
  ]);

  return (
    <PostArticle post={post} locale={locale} back={tJournal("back")} tagsLabel={tBlog("tags")} />
  );
}
