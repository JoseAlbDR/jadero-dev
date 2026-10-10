import type { ProjectKind, ProjectSummaryDto } from "@jadero/contracts";
import { cn } from "@jadero/ui/cn";
import { Card } from "@jadero/ui/components/card";
import { type Locale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { StackTags } from "./stack-tags";

/** The link to one project page, with the project's localized slug. */
export function projectHref(slug: string) {
  return { pathname: "/projects/[slug]", params: { slug } } as const;
}

/**
 * `lang` for a text the API returned in another language than the page (the German fallback to
 * English), or `undefined` when it matches.
 * @param itemLocale the `locale` of the returned item.
 * @param pageLocale the locale of the page.
 */
export function contentLang(itemLocale: Locale, pageLocale: Locale): Locale | undefined {
  return itemLocale === pageLocale ? undefined : itemLocale;
}

/** Classes of a link that covers its whole card (the block-link pattern). */
const STRETCHED_LINK =
  "outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

type ProjectSectionProps = Readonly<{
  kind: ProjectKind;
  items: ProjectSummaryDto[];
  locale: Locale;
}>;

/**
 * One section of the projects page; renders nothing when the kind has no published project.
 * Case studies are bento tiles, the featured ones two columns wide; projects are smaller tiles;
 * early work is a compact list in one card. Each tile is one link (its title) stretched over the
 * card, so a screen reader hears the title, not the whole card.
 * @param props.kind the kind this section lists.
 * @param props.items the projects of that kind in API order.
 * @param props.locale the page locale.
 */
export function ProjectSection({ kind, items, locale }: ProjectSectionProps) {
  const t = useTranslations("ProjectsPage");
  if (items.length === 0) return null;
  const headingId = `projects-${kind}`;

  return (
    <section aria-labelledby={headingId} className="mt-12">
      <h2 id={headingId} className="font-semibold text-2xl tracking-tight">
        {t(`sections.${kind}`)}
      </h2>
      {kind === "early" ? (
        <Card className="mt-5">
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const lang = contentLang(item.locale, locale);
              return (
                <li
                  key={item.slug}
                  className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <Link
                    href={projectHref(item.slug)}
                    lang={lang}
                    className="shrink-0 font-medium text-signal underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p lang={lang} className="text-muted-foreground text-sm">
                    {item.summary}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <ul
          className={cn(
            "mt-5 grid gap-4",
            kind === "case_study" ? "md:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {items.map((item) => {
            const lang = contentLang(item.locale, locale);
            return (
              <li
                key={item.slug}
                className={cn(kind === "case_study" && item.featured && "md:col-span-2")}
              >
                <Card asChild className="relative flex h-full flex-col">
                  <article>
                    <h3
                      lang={lang}
                      className={cn(
                        "font-semibold tracking-tight",
                        kind === "case_study" ? "text-2xl" : "text-lg",
                      )}
                    >
                      <Link href={projectHref(item.slug)} className={STRETCHED_LINK}>
                        {item.title}
                      </Link>
                    </h3>
                    <p lang={lang} className="mt-3 flex-1 text-muted-foreground">
                      {item.summary}
                    </p>
                    <StackTags tags={item.stackTags} label={t("stack")} className="mt-5" />
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
