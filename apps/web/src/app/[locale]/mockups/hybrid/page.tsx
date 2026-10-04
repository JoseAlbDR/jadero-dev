import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";
import { Link } from "@/i18n/navigation";
import { MockupNotice, PILLARS, TerminalPrompt } from "../_shared";

type HybridPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Title and alternates of the hybrid mockup.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: HybridPageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Mockups" });
  return {
    title: t("directions.hybrid"),
    alternates: localeAlternates("/mockups/hybrid", locale),
  };
}

/**
 * Direction 2's editorial base with Direction 1's full command-palette block (the owner's pick
 * after the first round): serif headline, 12-column grid, terracotta accent, terminal card.
 * @param props.params the route params with the locale segment.
 */
export default function HybridPage({ params }: HybridPageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("Mockups");

  return (
    <main data-direction="editorial" className="font-sans">
      <div className="mx-auto max-w-5xl px-6 pt-10 pb-24">
        <MockupNotice />

        <div className="mt-12 grid grid-cols-12 gap-x-6 border-foreground border-t pt-4 text-sm">
          <p className="col-span-6 flex items-center gap-2 md:col-span-4">
            <span aria-hidden className="size-2 bg-(--signal)" />
            {t("role")}
          </p>
          <ul className="col-span-6 flex flex-col items-end gap-1 md:col-span-4 md:col-start-9">
            <li>
              <Link href="/" className="underline decoration-(--signal) underline-offset-4">
                {t("ctaWork")}
              </Link>
            </li>
            <li>
              <Link href="/" className="underline decoration-(--signal) underline-offset-4">
                {t("ctaArchitecture")}
              </Link>
            </li>
          </ul>
        </div>

        <h1 className="mt-14 text-balance font-serif text-5xl leading-[1.04] tracking-tight md:text-7xl">
          {t("headline")}
        </h1>

        <div className="mt-14 grid grid-cols-12 gap-x-6 gap-y-10">
          <p className="col-span-12 text-muted-foreground text-xl leading-relaxed md:col-span-5">
            {t("lead")}
          </p>

          <TerminalPrompt className="col-span-12 md:col-span-7 md:col-start-6" />
        </div>

        <section aria-labelledby="pillars-title" className="mt-24">
          <h2 id="pillars-title" className="border-foreground border-t pt-4 text-sm">
            {t("pillarsTitle")}
          </h2>
          <ol className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
            {PILLARS.map((pillar, index) => (
              <li key={pillar} className="border-t pt-3">
                <span className="block font-serif text-(--signal) text-2xl">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="mt-1 block text-sm">{t(`pillars.${pillar}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
