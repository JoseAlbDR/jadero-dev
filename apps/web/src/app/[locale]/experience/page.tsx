import { Card } from "@jadero/ui/components/card";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExperienceTimeline } from "@/components/experience-timeline";
import { getExperience } from "@/content/api";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";

type ExperiencePageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Title, description, canonical and hreflang links of the experience page
 * (`/en/experience`, `/es/experiencia`, `/de/erfahrung`).
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: ExperiencePageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "ExperiencePage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates("/experience", locale),
  };
}

/**
 * The experience timeline: the published roles with their CV bullets from the content API
 * (`GET /v1/content/:locale/experience`, cached 60 s under `content:experience`). When the API
 * fails, the client throws a `ContentApiError` and the locale's error boundary shows a localized
 * message without any detail.
 * @param props.params the route params with the locale segment.
 */
export default async function ExperiencePage({ params }: ExperiencePageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, experience] = await Promise.all([
    getTranslations({ locale, namespace: "ExperiencePage" }),
    getExperience(locale),
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
      <ExperienceTimeline items={experience.items} locale={locale} />
    </main>
  );
}
