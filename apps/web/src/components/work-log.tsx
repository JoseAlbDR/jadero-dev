import type { KnowledgeEntrySummaryDto } from "@jadero/contracts";
import { cn } from "@jadero/ui/cn";
import { Card } from "@jadero/ui/components/card";
import { Languages } from "lucide-react";
import { type Locale, useTranslations } from "next-intl";
import { periodLabels } from "@/content/period";
import { ENTRY_LOCALE, markdownPlainText, roleKey } from "@/content/work-log";
import { Link } from "@/i18n/navigation";
import { contentLang } from "./project-sections";
import { StackTags } from "./stack-tags";

/** The link to one work-log entry page, by the entry's stable id (`kb-...`). */
export function workEntryHref(entryId: string) {
  return { pathname: "/work/[entryId]", params: { entryId } } as const;
}

/** Classes of a link that covers its whole card (the block-link pattern). */
const STRETCHED_LINK =
  "outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

/** A separator between two facts: a dot on screen, a comma for screen readers. */
function Separator() {
  return (
    <>
      <span aria-hidden> · </span>
      <span className="sr-only">, </span>
    </>
  );
}

type EntryMetaProps = Readonly<{
  entry: Pick<KnowledgeEntrySummaryDto, "type" | "period" | "role">;
  locale: Locale;
  className?: string;
}>;

/**
 * The facts line of an entry: its type, its period and the owner's role, all as labels of the
 * page's locale (the values are fixed lists in the contract, not English text).
 * @param props.entry the entry's type, period and role.
 * @param props.locale the page locale, for the labels and the month names.
 * @param props.className classes from the parent.
 */
export function EntryMeta({ entry, locale, className }: EntryMetaProps) {
  const t = useTranslations("WorkPage");
  const period = periodLabels(entry.period, locale);
  return (
    <p
      className={cn("font-mono text-muted-foreground text-xs uppercase tracking-widest", className)}
    >
      <span className="text-signal">{t(`type.${entry.type}`)}</span>
      <Separator />
      {t.rich("period", {
        fromLabel: period.from.label,
        toLabel: period.to?.label ?? t("present"),
        from: (chunks) => <time dateTime={period.from.value}>{chunks}</time>,
        to: (chunks) => (period.to ? <time dateTime={period.to.value}>{chunks}</time> : chunks),
      })}
      <Separator />
      {t(`role.${roleKey(entry.role)}`)}
    </p>
  );
}

type EnglishOnlyNoteProps = Readonly<{
  locale: Locale;
  message: "listNote" | "entryNote";
  className?: string;
}>;

/**
 * The note that tells a Spanish or German visitor the entries are in English (D-50). Renders
 * nothing on an English page. A `role="note"` block, not an `aside`, which would be a landmark.
 * @param props.locale the page locale.
 * @param props.message which note: the list's or one entry's.
 * @param props.className layout classes from the parent.
 */
export function EnglishOnlyNote({ locale, message, className }: EnglishOnlyNoteProps) {
  const t = useTranslations("WorkPage");
  if (locale === ENTRY_LOCALE) return null;
  return (
    <p
      role="note"
      className={cn("glass flex items-center gap-2.5 rounded-card px-5 py-3 text-sm", className)}
    >
      <Languages aria-hidden className="size-4 shrink-0 text-signal" />
      {t(message)}
    </p>
  );
}

type WorkEntryListProps = Readonly<{ items: KnowledgeEntrySummaryDto[]; locale: Locale }>;

/**
 * The work-log entries as bento tiles (ADR-045), in API order: facts line, title, the Summary as
 * plain text, stack and patterns. Each tile is one link (its title) stretched over the card. The
 * entries are English, so on a Spanish or German page their texts are marked `lang="en"`.
 * @param props.items the approved entries.
 * @param props.locale the page locale.
 */
export function WorkEntryList({ items, locale }: WorkEntryListProps) {
  const t = useTranslations("WorkPage");
  const lang = contentLang(ENTRY_LOCALE, locale);
  return (
    <ul className="mt-8 grid gap-4 md:grid-cols-2">
      {items.map((item) => (
        <li key={item.id}>
          <Card asChild className="relative flex h-full flex-col">
            <article>
              <EntryMeta entry={item} locale={locale} />
              <h2 lang={lang} className="mt-3 font-semibold text-lg tracking-tight">
                <Link href={workEntryHref(item.id)} className={STRETCHED_LINK}>
                  {item.title}
                </Link>
              </h2>
              <p lang={lang} className="mt-3 flex-1 text-muted-foreground">
                {markdownPlainText(item.summary)}
              </p>
              <StackTags tags={item.stack} label={t("stack")} className="mt-5" />
              <StackTags tags={item.patterns} label={t("patterns")} className="mt-2" />
            </article>
          </Card>
        </li>
      ))}
    </ul>
  );
}
