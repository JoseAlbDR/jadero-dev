import type { ProfileDto, ProjectSummaryDto, SkillDto } from "@jadero/contracts";
import { Card } from "@jadero/ui/components/card";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { type Locale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { AgentTerminal } from "@/components/agent-terminal";
import { ASK_QUERY_PARAM } from "@/components/ask-about-link";
import { PillarStrip } from "@/components/pillar-strip";
import { contentLang, projectHref } from "@/components/project-sections";
import { StackTags } from "@/components/stack-tags";
import { getExperience, getProfile, getProjects, getSkills } from "@/content/api";
import { type AskBullet, askBulletIdParam, findAskBullet } from "@/content/ask";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { Markdown } from "@/markdown/markdown";

type HomePageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}>;

/** How many skill names the stack tile shows; the stack page lists them all. */
const STACK_TILE_MAX = 12;

/** Classes of a section label in a tile ("Stack", "Featured case study"). */
const TILE_LABEL = "font-mono text-muted-foreground text-xs uppercase tracking-widest";

/**
 * Canonical and hreflang links of the home. They never carry the query: `?ask=` only fills the
 * terminal's prompt.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  return { alternates: localeAlternates("/", locale) };
}

/**
 * Resolves `?ask=` to a published CV bullet: an id the contract refuses costs no request, a valid
 * one is looked up in the experience list (cached like every content call).
 * @param locale the page locale.
 * @param value the raw search param.
 * @returns the bullet, or `null` for the empty prompt.
 */
async function loadAskBullet(
  locale: Locale,
  value: string | string[] | undefined,
): Promise<AskBullet | null> {
  const id = askBulletIdParam(value);
  if (id === null) return null;
  return findAskBullet(id, await getExperience(locale));
}

/**
 * The home (D-74, ADR-045), in bento order: the hero beside the agent terminal, the pillar strip,
 * then the stack and the featured case study. On phones the grid is one column in the same order,
 * so the hero, the terminal and the pillars come first. The hero reads the profile, the tiles read
 * the skills and the case studies (all cached 60 s under their content tags); a failed call lands
 * in the locale's error boundary. The page reads complete with the agent resting. The "now" tile of
 * ADR-045 arrives with the /now page.
 * @param props.params the route params with the locale segment.
 * @param props.searchParams the query, read for `ask` only.
 */
export default async function HomePage({ params, searchParams }: HomePageProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  // The query is read first: the page then waits for the request, like every page under the
  // layout's `connection()`, instead of starting content calls while the build prerenders.
  const query = await searchParams;
  const [profile, bullet, skills, caseStudies] = await Promise.all([
    getProfile(locale),
    loadAskBullet(locale, query[ASK_QUERY_PARAM]),
    getSkills(locale),
    getProjects(locale, "case_study"),
  ]);
  const featured = caseStudies.items.find((item) => item.featured) ?? caseStudies.items[0];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <div className="grid gap-4 md:grid-cols-4 [&>*]:min-w-0">
        <Hero profile={profile} locale={locale} />
        <AgentTerminal bullet={bullet} locale={locale} className="md:col-span-2" />
        <PillarStrip />
        <StackTile skills={skills.items} />
        {featured && <CaseStudyTile project={featured} locale={locale} />}
      </div>
    </main>
  );
}

/**
 * The hero card: the owner's name, the headline (the positioning, D-73) as the page's `h1` and the
 * profile summary as the line of proof, rendered through the safe Markdown pipeline.
 * @param props.profile the published profile.
 * @param props.locale the page locale, to mark a profile text in another language.
 */
function Hero({ profile, locale }: Readonly<{ profile: ProfileDto; locale: Locale }>) {
  const t = useTranslations("HomePage");
  const lang = contentLang(profile.locale, locale);
  return (
    <Card asChild className="flex flex-col md:col-span-2 md:p-8">
      <section aria-labelledby="hero-title">
        <p
          lang={lang}
          className="self-start rounded-full border px-3 py-1 text-muted-foreground text-xs"
        >
          {profile.name}
        </p>
        <h1
          id="hero-title"
          lang={lang}
          className="mt-6 text-balance font-semibold text-3xl tracking-tight md:text-4xl"
        >
          {profile.headline}
        </h1>
        <div lang={lang} className="mt-5 max-w-xl text-lg text-muted-foreground [&_p]:my-0">
          <Markdown source={profile.summary} />
        </div>
        <div className="mt-auto flex flex-wrap gap-3 pt-8 text-sm">
          <Link
            href="/projects"
            className="rounded-full bg-foreground px-5 py-2.5 font-medium text-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t("ctaProjects")}
          </Link>
          <Link
            href="/experience"
            className="rounded-full border px-5 py-2.5 font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t("ctaExperience")}
          </Link>
        </div>
      </section>
    </Card>
  );
}

/**
 * The stack tile: the first skill names in API order, each once, and a link to the stack page.
 * Renders nothing when no skill is published.
 * @param props.skills the published skills in display order.
 */
function StackTile({ skills }: Readonly<{ skills: readonly SkillDto[] }>) {
  const t = useTranslations("HomePage");
  const names = [...new Set(skills.map((skill) => skill.name))].slice(0, STACK_TILE_MAX);
  if (names.length === 0) return null;
  return (
    <Card asChild className="flex flex-col md:col-span-2">
      <section aria-labelledby="stack-title">
        <h2 id="stack-title" className={TILE_LABEL}>
          {t("stackTitle")}
        </h2>
        <StackTags tags={names} label={t("stackTitle")} className="mt-4" />
        <Link
          href="/stack"
          className="mt-auto inline-flex items-center gap-1.5 self-start rounded-sm pt-5 text-signal text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t("stackLink")}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </section>
    </Card>
  );
}

/**
 * The featured case study tile: the title links to the project page, then its summary and stack.
 * @param props.project the featured case study (or the first one when none is featured).
 * @param props.locale the page locale, to mark a project text in another language.
 */
function CaseStudyTile({
  project,
  locale,
}: Readonly<{ project: ProjectSummaryDto; locale: Locale }>) {
  const t = useTranslations("HomePage");
  const lang = contentLang(project.locale, locale);
  return (
    <Card asChild className="flex flex-col md:col-span-2">
      <section aria-labelledby="case-title">
        <h2 id="case-title" className={TILE_LABEL}>
          {t("caseTitle")}
        </h2>
        <Link
          href={projectHref(project.slug)}
          lang={lang}
          className="mt-3 inline-flex items-center gap-1 self-start rounded-sm font-semibold text-2xl tracking-tight underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {project.title}
          <ArrowUpRight aria-hidden className="size-5 text-signal" />
        </Link>
        <p lang={lang} className="mt-2 text-muted-foreground text-sm">
          {project.summary}
        </p>
        <StackTags tags={project.stackTags} label={t("stackTitle")} className="mt-auto pt-4" />
      </section>
    </Card>
  );
}
