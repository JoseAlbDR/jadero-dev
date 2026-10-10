import { Card } from "@jadero/ui/components/card";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SkillGroups } from "@/components/skill-groups";
import { getSkills } from "@/content/api";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";

type StackPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Title, description, canonical and hreflang links of the stack page (`/<locale>/stack`).
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: StackPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "StackPage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates("/stack", locale),
  };
}

/**
 * The stack and skills page: the published skills from `GET /v1/content/:locale/skills` (cached
 * 60 s under `content:skills`), one bento tile per category (`SkillGroups`). With no skills, the
 * page says so. A failed call lands in the locale's error boundary.
 * @param props.params the route params with the locale segment.
 */
export default async function StackPage({ params }: StackPageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, skills] = await Promise.all([
    getTranslations({ locale, namespace: "StackPage" }),
    getSkills(locale),
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
      {skills.items.length === 0 ? (
        <Card className="mt-8">
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        <SkillGroups items={skills.items} locale={locale} />
      )}
    </main>
  );
}
