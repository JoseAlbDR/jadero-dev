import type { ExperienceItemDto } from "@jadero/contracts";
import { Card } from "@jadero/ui/components/card";
import { type Locale, useTranslations } from "next-intl";
import { periodLabels } from "@/content/period";
import { AskAboutLink } from "./ask-about-link";

type ExperienceTimelineProps = Readonly<{ items: ExperienceItemDto[]; locale: Locale }>;

/**
 * The experience timeline (ADR-045): a vertical line with one dot per role, each role a wide glass
 * card with its organization, dates, work mode, stack and CV bullets. Items and bullets keep the
 * order the API sends (display order, most important bullet first). A German page may get an
 * English item (the API's German fallback): its texts are marked `lang="en"`, the labels around
 * them stay in the page's language.
 * @param props.items the published experience items.
 * @param props.locale the page locale, for dates and labels.
 */
export function ExperienceTimeline({ items, locale }: ExperienceTimelineProps) {
  const t = useTranslations("ExperiencePage");

  if (items.length === 0) {
    return (
      <Card className="mt-8">
        <p className="text-muted-foreground">{t("empty")}</p>
      </Card>
    );
  }

  return (
    <ol className="relative mt-8 space-y-6 border-border border-l pl-6 md:ml-4 md:pl-10">
      {items.map((item, index) => {
        const textLang = item.locale === locale ? undefined : item.locale;
        const period = periodLabels(item.period, locale);
        const key = `${item.period.from}-${index}`;
        return (
          <li key={key} className="relative">
            <span
              aria-hidden
              className="absolute top-8 -left-[calc(1.5rem+5px)] size-2.5 rounded-full bg-signal ring-4 ring-background md:-left-[calc(2.5rem+5px)]"
            />
            <Card variant="wide" asChild>
              <article>
                <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <div>
                    <h2 lang={textLang} className="font-semibold text-xl tracking-tight">
                      {item.role}
                    </h2>
                    <p lang={textLang} className="mt-1 text-muted-foreground">
                      {item.organization}
                    </p>
                  </div>
                  <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
                    {t.rich("period", {
                      fromLabel: period.from.label,
                      toLabel: period.to?.label ?? t("present"),
                      from: (chunks) => <time dateTime={period.from.value}>{chunks}</time>,
                      to: (chunks) =>
                        period.to ? <time dateTime={period.to.value}>{chunks}</time> : chunks,
                    })}
                    <span aria-hidden> · </span>
                    <span className="sr-only">, </span>
                    {t(`location.${item.locationType}`)}
                  </p>
                </header>
                {item.stackTags.length > 0 && (
                  <ul aria-label={t("stack")} className="mt-4 flex flex-wrap gap-2">
                    {item.stackTags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded-md border border-border px-2 py-0.5 font-mono text-muted-foreground text-xs"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                )}
                {item.bullets.length > 0 && (
                  <ul aria-label={t("highlights")} className="mt-6 space-y-4">
                    {item.bullets.map((bullet) => {
                      const textId = `bullet-${bullet.id}`;
                      return (
                        <li
                          key={bullet.id}
                          className="flex flex-col gap-2 border-border border-t pt-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                        >
                          <p id={textId} lang={textLang} className="text-pretty">
                            {bullet.text}
                          </p>
                          <AskAboutLink
                            bulletId={bullet.id}
                            describedBy={textId}
                            label={t("ask")}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </article>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
