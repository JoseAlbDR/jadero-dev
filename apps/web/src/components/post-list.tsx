import type { PostSummaryDto } from "@jadero/contracts";
import { cn } from "@jadero/ui/cn";
import { Card } from "@jadero/ui/components/card";
import { type Locale, useTranslations } from "next-intl";
import { formatPublishDate } from "@/content/posts";
import { Link } from "@/i18n/navigation";
import { contentLang } from "./project-sections";
import { StackTags } from "./stack-tags";

/** The link to one post page, with the post's localized slug. */
export function postHref(slug: string) {
  return { pathname: "/blog/[slug]", params: { slug } } as const;
}

/** Classes of a link that covers its whole card (the block-link pattern). */
const STRETCHED_LINK =
  "outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

/**
 * The publish date of a post as a `<time>` in the page's date format.
 * @param props.value the post's `publishedAt` (ISO date-time).
 * @param props.locale the page locale.
 * @param props.className classes from the parent.
 */
export function PublishDate({
  value,
  locale,
  className,
}: Readonly<{ value: string; locale: Locale; className?: string }>) {
  return (
    <time
      dateTime={value}
      className={cn("font-mono text-muted-foreground text-xs uppercase tracking-widest", className)}
    >
      {formatPublishDate(value, locale)}
    </time>
  );
}

type PostListProps = Readonly<{
  items: PostSummaryDto[];
  locale: Locale;
  /** True on the first page: its newest post is a wide tile. */
  firstPage: boolean;
}>;

/**
 * One page of post cards as bento tiles (ADR-045), newest first: date, title, excerpt and tags. On
 * the first page the newest post spans both columns. Each tile is one link (its title) stretched
 * over the card. A post the API returned in another language (the German fallback) has its texts
 * marked with that `lang`.
 * @param props.items the posts of the page in API order.
 * @param props.locale the page locale.
 * @param props.firstPage whether this is the first page of the list.
 */
export function PostList({ items, locale, firstPage }: PostListProps) {
  const t = useTranslations("BlogPage");
  return (
    <ul className="mt-8 grid gap-4 md:grid-cols-2">
      {items.map((item, index) => {
        const lang = contentLang(item.locale, locale);
        const wide = firstPage && index === 0;
        return (
          <li key={item.slug} className={cn(wide && "md:col-span-2")}>
            <Card asChild className="relative flex h-full flex-col">
              <article>
                <PublishDate value={item.publishedAt} locale={locale} />
                <h2
                  lang={lang}
                  className={cn("mt-3 font-semibold tracking-tight", wide ? "text-2xl" : "text-lg")}
                >
                  <Link href={postHref(item.slug)} className={STRETCHED_LINK}>
                    {item.title}
                  </Link>
                </h2>
                <p lang={lang} className="mt-3 flex-1 text-muted-foreground">
                  {item.excerpt}
                </p>
                <StackTags tags={item.tags} label={t("tags")} className="mt-5" />
              </article>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
