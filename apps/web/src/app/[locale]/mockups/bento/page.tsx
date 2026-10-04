import { ArrowUpRight, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { MockupNotice, PILLARS, QUESTIONS, STACK } from "../_shared";

type BentoPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/** Glass surface shared by every card; the hover lift only runs when motion is allowed. */
const CARD =
  "mockup-glass rounded-3xl p-6 transition-transform duration-300 motion-safe:hover:-translate-y-1";

/**
 * Title and alternates of the bento mockup.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: BentoPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Mockups" });
  return { title: t("directions.bento"), alternates: localeAlternates("/mockups/bento", locale) };
}

/**
 * Direction 3, "Bento glass" (ADR-023): a grid of glass cards (hero, now, stack, agent, featured
 * case study, pillars) over a soft aurora gradient, large radii, small hover moves.
 * @param props.params the route params with the locale segment.
 */
export default function BentoPage({ params }: BentoPageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("Mockups");

  return (
    <main data-direction="bento" className="relative overflow-hidden font-sans">
      <div aria-hidden className="mockup-aurora pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-5xl px-6 pt-10 pb-24">
        <MockupNotice />

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <section className={`${CARD} md:col-span-3 md:row-span-2 md:p-10`}>
            <p className="inline-flex rounded-full border px-3 py-1 text-muted-foreground text-xs">
              {t("role")}
            </p>
            <h1 className="mt-6 text-balance font-semibold text-4xl tracking-tight md:text-5xl">
              {t("headline")}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t("lead")}</p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <Link
                href="/"
                className="rounded-full bg-foreground px-5 py-2.5 font-medium text-background"
              >
                {t("ctaWork")}
              </Link>
              <Link href="/" className="rounded-full border px-5 py-2.5 font-medium">
                {t("ctaArchitecture")}
              </Link>
            </div>
          </section>

          <section className={CARD} aria-labelledby="now-title">
            <h2 id="now-title" className="text-muted-foreground text-xs uppercase tracking-widest">
              {t("nowTitle")}
            </h2>
            <p className="mt-3 text-sm">{t("nowBody")}</p>
          </section>

          <section className={CARD} aria-labelledby="stack-title">
            <h2
              id="stack-title"
              className="text-muted-foreground text-xs uppercase tracking-widest"
            >
              {t("stackTitle")}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {STACK.map((item) => (
                <li key={item} className="rounded-full border px-2.5 py-1">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className={`${CARD} md:col-span-2`} aria-label={t("promptLabel")}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl border bg-background/60 px-4 py-3 text-left"
            >
              <Sparkles aria-hidden className="size-4 text-(--signal)" />
              <span className="text-muted-foreground">{t("promptLabel")}</span>
            </button>
            <ul className="mt-4 flex flex-wrap gap-2 text-xs">
              {QUESTIONS.map((question) => (
                <li key={question}>
                  <button type="button" className="rounded-full border px-3 py-1.5 text-left">
                    {t(`questions.${question}`)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-muted-foreground text-xs">{t("resting")}</p>
          </section>

          <section className={`${CARD} md:col-span-2`} aria-labelledby="case-title">
            <h2 id="case-title" className="text-muted-foreground text-xs uppercase tracking-widest">
              {t("caseTitle")}
            </h2>
            <Link href="/" className="mt-3 flex items-center gap-1 font-semibold text-2xl">
              {t("caseName")}
              <ArrowUpRight aria-hidden className="size-5 text-(--signal)" />
            </Link>
            <p className="mt-2 text-muted-foreground text-sm">{t("caseBody")}</p>
          </section>

          <section className={`${CARD} md:col-span-4`} aria-labelledby="pillars-title">
            <h2
              id="pillars-title"
              className="text-muted-foreground text-xs uppercase tracking-widest"
            >
              {t("pillarsTitle")}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2 text-sm">
              {PILLARS.map((pillar) => (
                <li key={pillar} className="rounded-full border bg-background/50 px-3.5 py-1.5">
                  {t(`pillars.${pillar}`)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
