import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { MockupNotice, PILLARS, QUESTIONS, STACK, TERMINAL } from "../_shared";

type BentoAgentPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/** Glass surface shared by every card; the hover lift only runs when motion is allowed. */
const CARD =
  "mockup-glass rounded-3xl p-6 transition-transform duration-300 motion-safe:hover:-translate-y-1";

/**
 * Title and alternates of the bento mockup with the agent terminal.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: BentoAgentPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Mockups" });
  return {
    title: t("directions.bento-agent"),
    alternates: localeAlternates("/mockups/bento-agent", locale),
  };
}

/**
 * Direction 3, "Bento glass", as the owner picked it (ADR-045): the agent gets its own terminal
 * card, as large as the hero and next to it, dark in both themes with a glowing accent border.
 * @param props.params the route params with the locale segment.
 */
export default function BentoAgentPage({ params }: BentoAgentPageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("Mockups");

  return (
    <main data-direction="bento" className="relative overflow-hidden font-sans">
      <div aria-hidden className="mockup-aurora pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-5xl px-6 pt-10 pb-24">
        <MockupNotice />

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <section className={`${CARD} md:col-span-2 md:row-span-2 md:p-8`}>
            <p className="inline-flex rounded-full border px-3 py-1 text-muted-foreground text-xs">
              {t("role")}
            </p>
            <h1 className="mt-6 text-balance font-semibold text-3xl tracking-tight md:text-4xl">
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

          <section
            aria-label={t("promptLabel")}
            className="mockup-term-glow rounded-3xl p-px md:col-span-2 md:row-span-2"
          >
            <div className="mockup-term flex h-full flex-col overflow-hidden rounded-[calc(1.5rem-1px)] font-mono">
              <div className="flex items-center gap-2 border-(--term-line) border-b px-4 py-3">
                <span aria-hidden className="flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-(--term-line)" />
                  <span className="size-2.5 rounded-full bg-(--term-line)" />
                  <span className="size-2.5 rounded-full bg-(--term-line)" />
                </span>
                <span className="mx-auto text-(--term-muted) text-xs">{TERMINAL.window}</span>
                <kbd className="rounded border border-(--term-line) px-1.5 py-0.5 text-(--term-muted) text-xs">
                  {TERMINAL.shortcut}
                </kbd>
              </div>
              <div className="flex flex-1 flex-col gap-6 px-5 py-6">
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-xl border border-(--term-line) bg-(--term-raised) px-4 py-4 text-left text-lg"
                >
                  <span aria-hidden className="text-(--term-signal)">
                    &gt;
                  </span>
                  <span className="text-(--term-fg)">{t("promptLabel")}</span>
                  <span aria-hidden className="mockup-caret -ml-2 h-6 w-2.5 bg-(--term-signal)" />
                </button>
                <div>
                  <p className="text-(--term-muted) text-xs uppercase tracking-widest">
                    {t("promptHint")}
                  </p>
                  <ul className="mt-3 space-y-1">
                    {QUESTIONS.map((question) => (
                      <li key={question}>
                        <button
                          type="button"
                          className="w-full rounded-lg px-3 py-2 text-left text-(--term-fg) text-sm transition-colors hover:bg-(--term-raised)"
                        >
                          <span aria-hidden className="text-(--term-signal)">
                            →{" "}
                          </span>
                          {t(`questions.${question}`)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-auto flex items-start gap-2 text-(--term-muted) text-xs">
                  <span
                    aria-hidden
                    className="mt-1 size-2 shrink-0 rounded-full bg-(--term-signal)"
                  />
                  {t("resting")}
                </p>
              </div>
            </div>
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
        </div>
      </div>
    </main>
  );
}
