import type { PostKind, PostSummaryDto } from "@jadero/contracts";
import { cn } from "@jadero/ui/cn";
import { Card } from "@jadero/ui/components/card";
import { type Locale, useTranslations } from "next-intl";
import { formatPublishDate, POST_ROUTES } from "@/content/posts";
import { Link } from "@/i18n/navigation";
import { contentLang } from "./project-sections";
import { StackTags } from "./stack-tags";

/**
 * The link to one post page, with the post's localized slug, on its kind's route (`/blog/<slug>`
 * or `/journal/<slug>`).
 * @param slug the post's slug in the page locale.
 * @param kind the post's kind.
 * @returns the href for the locale-aware `Link`.
 */
export function postHref(slug: string, kind: PostKind) {
  return { pathname: POST_ROUTES[kind].item, params: { slug } } as const;
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

/**
 * The small "WP-<n>" label of a journal post (ADR-034), next to its title or its date. Renders
 * nothing for a blog post (`wp: null`).
 * @param props.wp the post's work package number, or `null`.
 * @param props.className classes from the parent.
 */
export function WorkPackageLabel({
  wp,
  className,
}: Readonly<{ wp: number | null; className?: string }>) {
  const t = useTranslations("JournalPage");
  if (wp === null) return null;
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-md border border-border px-2 py-0.5 font-mono text-signal text-xs",
        className,
      )}
    >
      {t("workPackage", { wp })}
    </span>
  );
}

type PostListProps = Readonly<{
  items: PostSummaryDto[];
  locale: Locale;
  /** True on the first page: its newest post is a wide tile. */
  firstPage: boolean;
  /** The level of each card's title: `h2` on a list page, `h3` inside a section with its own `h2`. */
  headingLevel?: "h2" | "h3";
}>;

/**
 * One page of post cards as bento tiles (ADR-045), newest first: date, title (with its "WP-<n>"
 * label on a journal post), excerpt and tags. Each card links to its post on the post's own kind's
 * route. On
 * the first page the newest post spans both columns. Each tile is one link (its title) stretched
 * over the card. A post the API returned in another language (the German fallback) has its texts
 * marked with that `lang`.
 * @param props.items the posts of the page in API order.
 * @param props.locale the page locale.
 * @param props.firstPage whether this is the first page of the list.
 * @param props.headingLevel the level of each card's title, `h2` by default.
 */
export function PostList({ items, locale, firstPage, headingLevel = "h2" }: PostListProps) {
  const t = useTranslations("BlogPage");
  const Heading = headingLevel;
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
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <Heading
                    lang={lang}
                    className={cn("font-semibold tracking-tight", wide ? "text-2xl" : "text-lg")}
                  >
                    <Link href={postHref(item.slug, item.kind)} className={STRETCHED_LINK}>
                      {item.title}
                    </Link>
                  </Heading>
                  <WorkPackageLabel wp={item.wp} className="shrink-0" />
                </div>
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
