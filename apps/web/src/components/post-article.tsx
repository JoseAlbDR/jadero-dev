import type { PostDto } from "@jadero/contracts";
import { Card } from "@jadero/ui/components/card";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "next-intl";
import { POST_ROUTES } from "@/content/posts";
import { Link } from "@/i18n/navigation";
import { Markdown } from "@/markdown/markdown";
import { PublishDate, WorkPackageLabel } from "./post-list";
import { contentLang } from "./project-sections";
import { StackTags } from "./stack-tags";

type PostArticleProps = Readonly<{
  post: PostDto;
  locale: Locale;
  /** The back link's text ("All posts", "All journal posts"). */
  back: string;
  /** The accessible name of the tag list. */
  tagsLabel: string;
}>;

/**
 * The body of a post page, shared by the blog and the journal: the link back to the post's list,
 * the header card (date, the "WP-<n>" label of a journal post, title, excerpt, tags) and the body
 * in one wide card (ADR-045), rendered on the server through the safe Markdown pipeline of
 * ADR-011. On the German fallback the post's texts are marked `lang="en"`; the labels around them
 * stay in the page's language.
 * @param props.post the post from the API, already checked to be of the route's kind.
 * @param props.locale the page locale.
 * @param props.back the back link's text.
 * @param props.tagsLabel the accessible name of the tag list.
 */
export function PostArticle({ post, locale, back, tagsLabel }: PostArticleProps) {
  const lang = contentLang(post.locale, locale);
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Link
        href={POST_ROUTES[post.kind].list}
        className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {back}
      </Link>
      <article className="mt-4">
        <Card asChild className="md:p-10">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <PublishDate value={post.publishedAt} locale={locale} className="text-signal" />
              <WorkPackageLabel wp={post.wp} />
            </div>
            <h1
              lang={lang}
              className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl"
            >
              {post.title}
            </h1>
            <p lang={lang} className="mt-5 max-w-2xl text-lg text-muted-foreground">
              {post.excerpt}
            </p>
            <StackTags tags={post.tags} label={tagsLabel} className="mt-6" />
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
