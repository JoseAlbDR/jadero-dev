import { Card } from "@jadero/ui/components/card";
import { ArrowLeft, CodeXml, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { contentLang } from "@/components/project-sections";
import { StackTags } from "@/components/stack-tags";
import { loadProjectPage } from "@/content/project-page";
import { contentAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { Markdown } from "@/markdown/markdown";
import { pageMetadata } from "@/seo/page-metadata";

type ProjectPageProps = Readonly<{ params: Promise<{ locale: string; slug: string }> }>;

/**
 * Title (the project's), description (its summary), canonical and hreflang links and Open Graph card of a project
 * page. The hreflang links use the project's slug in each locale it is published in.
 * @param props.params the route params with the locale and the localized slug.
 */
export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  const project = await loadProjectPage(locale, slug);
  return pageMetadata({
    locale,
    title: project.title,
    description: project.summary,
    alternates: contentAlternates("/projects/[slug]", project),
    contentLocale: project.locale,
    article: { tags: project.stackTags },
  });
}

/**
 * One project or case study (`/en/projects/<slug>`, `/es/proyectos/<slug>`, `/de/projekte/<slug>`)
 * from `GET /v1/content/:locale/projects/:slug` (cached 60 s under `content:projects` and its own
 * tag). Another locale's slug of the same project redirects to this locale's slug; a slug the API
 * does not know for the locale is the page's 404 (`loadProjectPage`). On the German fallback the
 * project's texts are marked `lang="en"`; the labels around them stay German. The body is Markdown,
 * rendered on the server through the safe pipeline of ADR-011 in one wide card (ADR-045).
 * @param props.params the route params with the locale and the localized slug.
 */
export default async function ProjectPage({ params }: ProjectPageProps) {
  const { locale: segment, slug } = await params;
  const locale = requireLocale(segment);
  setRequestLocale(locale);
  const [t, project] = await Promise.all([
    getTranslations({ locale, namespace: "ProjectsPage" }),
    loadProjectPage(locale, slug),
  ]);
  const lang = contentLang(project.locale, locale);
  const links = [
    project.repoUrl && { href: project.repoUrl, label: t("repo"), Icon: CodeXml },
    project.demoUrl && { href: project.demoUrl, label: t("demo"), Icon: ExternalLink },
  ].filter((link) => !!link);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 rounded-md text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("back")}
      </Link>
      <article className="mt-4">
        <Card asChild className="md:p-10">
          <header>
            <p className="font-mono text-signal text-xs uppercase tracking-widest">
              {t(`kind.${project.kind}`)}
            </p>
            <h1
              lang={lang}
              className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl"
            >
              {project.title}
            </h1>
            <p lang={lang} className="mt-5 max-w-2xl text-lg text-muted-foreground">
              {project.summary}
            </p>
            <StackTags tags={project.stackTags} label={t("stack")} className="mt-6" />
            {links.length > 0 && (
              <ul aria-label={t("links")} className="mt-6 flex flex-wrap gap-3">
                {links.map(({ href, label, Icon }) => (
                  <li key={href}>
                    <a
                      href={href}
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <Icon aria-hidden className="size-4 text-signal" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </header>
        </Card>
        <Card variant="wide" className="mt-6">
          <div lang={lang}>
            <Markdown source={project.body} />
          </div>
        </Card>
      </article>
    </main>
  );
}
