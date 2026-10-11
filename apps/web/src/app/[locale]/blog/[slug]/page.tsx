import { Card } from "@jadero/ui/components/card";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublishDate } from "@/components/post-list";
import { contentLang } from "@/components/project-sections";
import { StackTags } from "@/components/stack-tags";
import { loadPostPage } from "@/content/post-page";
import { contentAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { Markdown } from "@/markdown/markdown";
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
  const post = await loadPostPage(locale, slug);
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
 * One post (`/<locale>/blog/<slug>`) from `GET /v1/content/:locale/posts/:slug` (cached 60 s under
 * `content:posts` and its own tag). Another locale's slug of the same post redirects to this
 * locale's slug; a slug no post has is the page's 404 (`loadPostPage`). On the German fallback the
 * post's texts are marked `lang="en"`; the labels around them stay German. The body is Markdown,
 * rendered on the server through the safe pipeline of ADR-011 in one wide card (ADR-045).
 * @param props.params the route params with the locale and the localized slug.
 */
export default async function PostPage({ params }: PostPageProps) {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  setRequestLocale(locale);
  const [t, post] = await Promise.all([
    getTranslations({ locale, namespace: "BlogPage" }),
    loadPostPage(locale, slug),
  ]);
  const lang = contentLang(post.locale, locale);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("back")}
      </Link>
      <article className="mt-4">
        <Card asChild className="md:p-10">
          <header>
            <PublishDate value={post.publishedAt} locale={locale} className="text-signal" />
            <h1
              lang={lang}
              className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl"
            >
              {post.title}
            </h1>
            <p lang={lang} className="mt-5 max-w-2xl text-lg text-muted-foreground">
              {post.excerpt}
            </p>
            <StackTags tags={post.tags} label={t("tags")} className="mt-6" />
          </header>
        </Card>
        <Card variant="wide" className="mt-6">
          <div lang={lang}>
            <Markdown source={post.body} />
          </div>
        </Card>
      </article>
    </main>
  );
}
