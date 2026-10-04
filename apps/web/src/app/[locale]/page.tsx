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
    <main>
      <h1>{t("title")}</h1>
      <p>{t("lead")}</p>
    </main>
  );
}
