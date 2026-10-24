import type { PostSummaryDto } from "@jadero/contracts";
import { Card } from "@jadero/ui/components/card";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import type { Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PostList, PublishDate, postHref, WorkPackageLabel } from "@/components/post-list";
import { contentLang } from "@/components/project-sections";
import { getNow, getPosts } from "@/content/api";
import { readNowJournal } from "@/content/now";
import { formatPublishDate } from "@/content/posts";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { Markdown } from "@/markdown/markdown";
import { pageMetadata } from "@/seo/page-metadata";

type NowPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/** Classes of a section heading on the page ("Last finished work package"). */
const SECTION_HEADING = "font-mono text-muted-foreground text-xs uppercase tracking-widest";

/** Classes of a link that covers its whole card (the block-link pattern). */
const STRETCHED_LINK =
  "outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

/**
 * Title, description, canonical and hreflang links and Open Graph card of the /now page
 * (`/<locale>/now`).
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: NowPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "NowPage" });
  return pageMetadata({
    locale,
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates("/now", locale),
  });
}

/**
 * The /now page (WP-39 D2, a nownownow-style page): a read-side composition of two content reads
 * made in parallel, each cached 60 s. The Now text from `GET /v1/content/:locale/now` (under
 * `content:now`) is rendered through the safe Markdown pipeline with its "updated" date; when no
 * text is published in the locale, a short note takes its place and the page still answers 200.
 * The journal feed (`?kind=journal`, under `content:posts`) gives the last finished work package,
 * derived from the latest journal post (never a hand-edited field), and the next three posts after it;
 * with no journal post, or when the feed read fails, both blocks are hidden and the page still
 * renders. A failed Now text read (other than its 404) lands in the locale's error boundary.
 * @param props.params the route params with the locale segment.
 */
export default async function NowPage({ params }: NowPageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, now, { lastFinished, latest }] = await Promise.all([
    getTranslations({ locale, namespace: "NowPage" }),
    getNow(locale),
    readNowJournal(() => getPosts(locale, "journal")),
  ]);
  const lang = now ? contentLang(now.locale, locale) : undefined;

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
      <Card variant="wide" className="mt-6">
        {now ? (
          <>
            <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
              {t.rich("updated", {
                when: formatPublishDate(now.publishedAt, locale),
                date: (chunks) => <time dateTime={now.publishedAt}>{chunks}</time>,
              })}
            </p>
            <div lang={lang} className="mt-4">
              <Markdown source={now.body} />
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">{t("empty")}</p>
        )}
      </Card>
      {lastFinished && (
        <LastFinished post={lastFinished} locale={locale} heading={t("lastFinished")} />
      )}
      {latest.length > 0 && (
        <section aria-labelledby="now-journal" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="now-journal" className="font-semibold text-2xl tracking-tight">
              {t("latestJournal")}
            </h2>
            <Link
              href="/journal"
              className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {t("allJournal")}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <PostList items={latest} locale={locale} firstPage={false} headingLevel="h3" />
        </section>
      )}
    </main>
  );
}

type LastFinishedProps = Readonly<{
  post: PostSummaryDto;
  locale: Locale;
  heading: string;
}>;

/**
 * The "last finished work package" tile: the latest journal post's "WP-<n>" label, title (one link
 * stretched over the card, to the post under `/journal`), excerpt and date. On the German fallback
 * the post's texts are marked with their language.
 * @param props.post the latest published journal post.
 * @param props.locale the page locale.
 * @param props.heading the tile's localized heading.
 */
function LastFinished({ post, locale, heading }: LastFinishedProps) {
  const lang = contentLang(post.locale, locale);
  return (
    <section aria-labelledby="now-last-finished" className="mt-6">
      <Card className="relative">
        <h2 id="now-last-finished" className={SECTION_HEADING}>
          {heading}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <WorkPackageLabel wp={post.wp} />
          <PublishDate value={post.publishedAt} locale={locale} />
        </div>
        <p lang={lang} className="mt-3 font-semibold text-2xl tracking-tight">
          <Link href={postHref(post.slug, post.kind)} className={STRETCHED_LINK}>
            {post.title}
          </Link>
        </p>
        <p lang={lang} className="mt-3 text-muted-foreground">
          {post.excerpt}
        </p>
      </Card>
    </section>
  );
}
