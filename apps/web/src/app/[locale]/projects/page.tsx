import type { ProjectKind } from "@jadero/contracts";
import { Card } from "@jadero/ui/components/card";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ProjectSection } from "@/components/project-sections";
import { getProjects } from "@/content/api";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";

type ProjectsPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/** The sections of the page in display order: case studies, projects, then the early archive. */
const SECTIONS: readonly ProjectKind[] = ["case_study", "project", "early"];

/**
 * Title, description, canonical and hreflang links of the projects page
 * (`/en/projects`, `/es/proyectos`, `/de/projekte`).
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: ProjectsPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "ProjectsPage" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localeAlternates("/projects", locale),
  };
}

/**
 * The projects page: one section per kind from the content API
 * (`GET /v1/content/:locale/projects?kind=`, cached 60 s under `content:projects`), in the order of
 * `SECTIONS`. A kind without published projects has no section; with none at all, the page says
 * so. A failed call lands in the locale's error boundary.
 * @param props.params the route params with the locale segment.
 */
export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, ...lists] = await Promise.all([
    getTranslations({ locale, namespace: "ProjectsPage" }),
    ...SECTIONS.map((kind) => getProjects(locale, kind)),
  ]);
  const sections = SECTIONS.map((kind, index) => ({ kind, items: lists[index]?.items ?? [] }));
  const empty = sections.every((section) => section.items.length === 0);

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
      {empty ? (
        <Card className="mt-8">
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      ) : (
        sections.map(({ kind, items }) => (
          <ProjectSection key={kind} kind={kind} items={items} locale={locale} />
        ))
      )}
    </main>
  );
}
