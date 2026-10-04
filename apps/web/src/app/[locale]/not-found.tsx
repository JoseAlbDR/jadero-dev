import { useTranslations } from "next-intl";

/** Localized 404 inside a locale. */
export default function NotFoundPage() {
  const t = useTranslations("NotFound");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("description")}</p>
    </main>
  );
}
