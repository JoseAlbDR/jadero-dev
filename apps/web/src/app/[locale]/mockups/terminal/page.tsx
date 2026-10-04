import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { MockupNotice, PILLARS, QUESTIONS, TERMINAL } from "../_shared";

type TerminalPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Title and alternates of the terminal mockup.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: TerminalPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Mockups" });
  return {
    title: t("directions.terminal"),
    alternates: localeAlternates("/mockups/terminal", locale),
  };
}

/**
 * Direction 1, "Terminal editorial" (ADR-023): sans body with a monospace accent, one vivid
 * accent, a faint dot grid and a command-palette prompt as the hero.
 * @param props.params the route params with the locale segment.
 */
export default function TerminalPage({ params }: TerminalPageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("Mockups");

  return (
    <main data-direction="terminal" className="relative font-sans">
      <div aria-hidden className="mockup-dot-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-5xl px-6 pt-10 pb-24">
        <MockupNotice />

        <p className="mt-10 font-mono text-muted-foreground text-sm">
          <span className="text-(--signal)">{TERMINAL.cwd}</span> {TERMINAL.command}
        </p>
        <p className="mt-1 font-mono text-sm">{t("role")}</p>

        <h1 className="mt-8 max-w-4xl text-balance font-semibold text-5xl tracking-tight md:text-6xl">
          {t("headline")}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{t("lead")}</p>

        <div className="mt-8 flex flex-wrap gap-6 font-mono text-sm">
          <Link href="/" className="underline-offset-4 hover:text-(--signal) hover:underline">
            <span aria-hidden className="text-(--signal)">
              →{" "}
            </span>
            {t("ctaWork")}
          </Link>
          <Link href="/" className="underline-offset-4 hover:text-(--signal) hover:underline">
            <span aria-hidden className="text-(--signal)">
              →{" "}
            </span>
            {t("ctaArchitecture")}
          </Link>
        </div>

        <section
          aria-label={t("promptLabel")}
          className="mt-14 max-w-3xl rounded-lg border bg-(--surface) shadow-2xl shadow-foreground/5"
        >
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-5 text-left font-mono text-lg"
          >
            <span aria-hidden className="text-(--signal)">
              &gt;
            </span>
            <span className="text-muted-foreground">{t("promptLabel")}</span>
            <span aria-hidden className="mockup-caret -ml-2 h-6 w-2.5 bg-(--signal)" />
            <kbd className="ml-auto rounded border px-1.5 py-0.5 text-muted-foreground text-xs">
              {TERMINAL.shortcut}
            </kbd>
          </button>
          <div className="border-t px-5 py-4">
            <p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
              {t("promptHint")}
            </p>
            <ul className="mt-3 space-y-2 font-mono text-sm">
              {QUESTIONS.map((question) => (
                <li key={question}>
                  <button type="button" className="text-left hover:text-(--signal)">
                    <span aria-hidden className="text-muted-foreground">
                      ↳{" "}
                    </span>
                    {t(`questions.${question}`)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="flex items-center gap-2 border-t px-5 py-3 font-mono text-muted-foreground text-xs">
            <span aria-hidden className="size-2 rounded-full bg-(--signal)" />
            {t("resting")}
          </p>
        </section>

        <section aria-labelledby="pillars-title" className="mt-20">
          <h2
            id="pillars-title"
            className="font-mono text-muted-foreground text-xs uppercase tracking-widest"
          >
            {t("pillarsTitle")}
          </h2>
          <ol className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
            {PILLARS.map((pillar, index) => (
              <li key={pillar} className="bg-background px-4 py-4 text-sm">
                <span className="block font-mono text-(--signal) text-xs">
                  [{String(index + 1).padStart(2, "0")}]
                </span>
                <span className="mt-1 block">{t(`pillars.${pillar}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
