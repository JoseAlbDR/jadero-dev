import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { requireLocale } from "@/i18n/locale";

/**
 * Home page placeholder; WP-16 builds the real home.
 * @param props.params the route params with the locale segment.
 */
export default function HomePage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = requireLocale(use(params).locale);
  setRequestLocale(locale);
  const t = useTranslations("HomePage");

  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="font-serif text-5xl tracking-tight">{t("title")}</h1>
      <p className="mt-6 text-lg text-muted-foreground">{t("lead")}</p>
    </main>
  );
}
