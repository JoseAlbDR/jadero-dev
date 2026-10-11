import { Card } from "@jadero/ui/components/card";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { contentLang } from "@/components/project-sections";
import { StackTags } from "@/components/stack-tags";
import { EnglishOnlyNote, EntryMeta, workEntryHref } from "@/components/work-log";
import { getWorkEntry } from "@/content/api";
import { ENTRY_LOCALE, entryDescription, entryRobots, QUESTIONS_ANCHOR } from "@/content/work-log";
import { englishOnlyAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { Markdown } from "@/markdown/markdown";
import { pageMetadata } from "@/seo/page-metadata";

type WorkEntryPageProps = Readonly<{ params: Promise<{ locale: string; entryId: string }> }>;

/**
 * Title (the entry's), description (its Summary as plain text), canonical and hreflang links and
 * robots of an entry page. Entries are English only (D-50), so every locale's canonical is the
 * English page and the only hreflang links are `en` and `x-default`; `indexable: false` adds
 * `noindex, follow` (D-52). The Open Graph card is an English article.
 * @param props.params the route params with the locale and the entry id.
 */
export async function generateMetadata({ params }: WorkEntryPageProps): Promise<Metadata> {
  const { locale: segment, entryId } = await params;
  const locale = requireLocale(segment);
  const entry = await getWorkEntry(entryId);
  return pageMetadata({
    locale,
    title: entry.title,
    description: entryDescription(entry),
    alternates: englishOnlyAlternates(workEntryHref(entry.id)),
    contentLocale: ENTRY_LOCALE,
    article: { tags: entry.stack },
    robots: entryRobots(entry.indexable),
  });
}

/**
 * One work-log entry (`/en/work/<id>`, `/es/trabajo/<id>`, `/de/arbeit/<id>`) from
 * `GET /v1/content/work/:entryId` (cached 60 s under `content:work` and its own tag). An id that is
 * not approved, or not an entry id at all, is the page's 404. Each prose section is a heading whose
 * id is its contract key, so a citation lands on it (`/en/work/<id>#tradeoffs`, ADR-031), and its
 * body goes through the safe Markdown pipeline of ADR-011. On a Spanish or German page a note
 * says the entry is in English and the entry's texts carry `lang="en"`; the headings and labels
 * around them stay in the page's language.
 * @param props.params the route params with the locale and the entry id.
 */
export default async function WorkEntryPage({ params }: WorkEntryPageProps) {
  const { locale: segment, entryId } = await params;
  const locale = requireLocale(segment);
  setRequestLocale(locale);
  const [t, entry] = await Promise.all([
    getTranslations({ locale, namespace: "WorkPage" }),
    getWorkEntry(entryId),
  ]);
  const lang = contentLang(ENTRY_LOCALE, locale);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Link
        href="/work"
        className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("back")}
      </Link>
      <EnglishOnlyNote locale={locale} message="entryNote" className="mt-4" />
      <article className="mt-4">
        <Card asChild className="md:p-10">
          <header>
            <EntryMeta entry={entry} locale={locale} />
            <h1
              lang={lang}
              className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl"
            >
              {entry.title}
            </h1>
            <StackTags tags={entry.stack} label={t("stack")} className="mt-6" />
            <StackTags tags={entry.patterns} label={t("patterns")} className="mt-2" />
          </header>
        </Card>
        <Card variant="wide" className="mt-6">
          {entry.sections.map((section) => (
            <section key={section.key} aria-labelledby={section.key} className="mt-10 first:mt-0">
              <h2 id={section.key} className="font-semibold text-2xl tracking-tight">
                {t(`sections.${section.key}`)}
              </h2>
              <div lang={lang}>
                <Markdown source={section.body} />
              </div>
            </section>
          ))}
          <section aria-labelledby={QUESTIONS_ANCHOR} className="mt-10">
            <h2 id={QUESTIONS_ANCHOR} className="font-semibold text-2xl tracking-tight">
              {t("questions")}
            </h2>
            <ul lang={lang} className="my-4 list-disc space-y-1 pl-6">
              {entry.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </section>
        </Card>
      </article>
    </main>
  );
}
