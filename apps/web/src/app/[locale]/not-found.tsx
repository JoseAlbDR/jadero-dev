import { useTranslations } from "next-intl";

/** Localized 404 inside a locale. */
export default function NotFoundPage() {
  const t = useTranslations("NotFound");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-serif text-4xl tracking-tight">{t("title")}</h1>
      <p className="mt-4 text-muted-foreground">{t("description")}</p>
    </main>
  );
}
