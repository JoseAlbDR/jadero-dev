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
 * Home page placeholder; WP-16 builds the real home.
 * @param props.params the route params with the locale segment.
 */
export default function HomePage({ params }: HomePageProps) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("HomePage");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-5xl tracking-tight">{t("title")}</h1>
      <p className="mt-6 text-lg text-muted-foreground">{t("lead")}</p>
    </main>
  );
}
