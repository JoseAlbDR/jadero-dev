import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";

type MockupsPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

const DIRECTIONS = ["terminal", "editorial", "bento", "hybrid", "bento-agent"] as const;

/**
 * Title and alternates of the mockup index.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: MockupsPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Mockups" });
  return { title: t("metaTitle"), alternates: localeAlternates("/mockups", locale) };
}

/**
 * Index of the three WP-15 hero mockups, one link per direction.
 * @param props.params the route params with the locale segment.
 */
export default function MockupsPage({ params }: MockupsPageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("Mockups");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl tracking-tight">{t("indexTitle")}</h1>
      <p className="mt-4 text-muted-foreground">{t("indexLead")}</p>
      <ol className="mt-10 divide-y divide-border border-y">
        {DIRECTIONS.map((direction, index) => (
          <li key={direction} className="py-5">
            <Link
              href={`/mockups/${direction}`}
              className="text-lg underline-offset-4 hover:underline"
            >
              <span className="font-mono text-sm text-muted-foreground">{index + 1}. </span>
              {t(`directions.${direction}`)}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">{t(`summaries.${direction}`)}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
