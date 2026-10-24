import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostArticle } from "@/components/post-article";
import { loadPostPage } from "@/content/post-page";
import { contentAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { pageMetadata } from "@/seo/page-metadata";

type PostPageProps = Readonly<{ params: Promise<{ locale: string; slug: string }> }>;

/**
 * Title (the post's), description (its excerpt), canonical and hreflang links and Open Graph card of a post page. The
 * hreflang links use the post's slug in each locale it is published in; on the German fallback the
 * canonical is the English page.
 * @param props.params the route params with the locale and the localized slug.
 */
export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  const post = await loadPostPage(locale, slug, "post");
  return pageMetadata({
    locale,
    title: post.title,
    description: post.excerpt,
    alternates: contentAlternates("/blog/[slug]", post),
    contentLocale: post.locale,
    article: { publishedTime: post.publishedAt, tags: post.tags },
  });
}

/**
 * One blog post (`/<locale>/blog/<slug>`) from `GET /v1/content/:locale/posts/:slug` (cached 60 s
 * under `content:posts` and its own tag). Another locale's slug of the same post redirects to this
 * locale's slug; a slug no blog post has, a journal post's slug included, is the page's 404
 * (`loadPostPage`). The page body is `PostArticle`: safe Markdown (ADR-011) in one wide card.
 * @param props.params the route params with the locale and the localized slug.
 */
export default async function PostPage({ params }: PostPageProps) {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  setRequestLocale(locale);
  const [t, post] = await Promise.all([
    getTranslations({ locale, namespace: "BlogPage" }),
    loadPostPage(locale, slug, "post"),
  ]);

  return <PostArticle post={post} locale={locale} back={t("back")} tagsLabel={t("tags")} />;
}
