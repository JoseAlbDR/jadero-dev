import { Card } from "@jadero/ui/components/card";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EnglishOnlyNote, WorkEntryList } from "@/components/work-log";
import { getWorkLog } from "@/content/api";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";

type WorkPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Title, description, canonical and hreflang links of the work log (`/en/work`, `/es/trabajo`,
 * `/de/arbeit`). The list's own texts are translated, so each locale's list is its own page with
 * its own canonical; only the entry pages point at English (D-50).
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: WorkPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "WorkPage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates("/work", locale),
  };
}

/**
 * The work log (ADR-031, D-52): every approved knowledge entry from `GET /v1/content/work` (cached
 * 60 s under `content:work`), as tiles linking to the entry pages. Entries are English only (D-50):
 * on a Spanish or German page a note says so and the entries' texts carry `lang="en"`. An entry
 * with `indexable: false` is listed too; only its own page is kept out of search results. A failed
 * call lands in the locale's error boundary.
 * @param props.params the route params with the locale segment.
 */
export default async function WorkPage({ params }: WorkPageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, workLog] = await Promise.all([
    getTranslations({ locale, namespace: "WorkPage" }),
    getWorkLog(),
  ]);

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
      {workLog.items.length === 0 ? (
        <Card className="mt-8">
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        <>
          <EnglishOnlyNote locale={locale} message="listNote" className="mt-6" />
          <WorkEntryList items={workLog.items} locale={locale} />
        </>
      )}
    </main>
  );
}
