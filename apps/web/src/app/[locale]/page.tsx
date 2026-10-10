import { Card } from "@jadero/ui/components/card";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { localeAlternates } from "@/i18n/alternates";
import { requireLocale } from "@/i18n/locale";

type HomePageProps = Readonly<{ params: Promise<{ locale: string }> }>;

/**
 * Canonical and hreflang links of the home.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  return { alternates: localeAlternates("/", locale) };
}

/**
 * Home page placeholder in one glass card over the aurora; a later WP-16 step builds the real home.
 * @param props.params the route params with the locale segment.
 */
export default function HomePage({ params }: HomePageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("HomePage");

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Card asChild className="md:p-10">
        <section>
          <p className="font-mono text-signal text-xs uppercase tracking-widest">{t("eyebrow")}</p>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight md:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t("lead")}</p>
        </section>
      </Card>
    </main>
  );
}
