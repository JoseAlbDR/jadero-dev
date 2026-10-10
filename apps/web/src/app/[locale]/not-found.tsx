import { Card } from "@jadero/ui/components/card";
import { useTranslations } from "next-intl";

/** Localized 404 inside a locale, in one glass card. */
export default function NotFoundPage() {
  const t = useTranslations("NotFound");
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-24">
      <Card asChild className="md:p-10">
        <section>
          <h1 className="font-semibold text-4xl tracking-tight">{t("title")}</h1>
          <p className="mt-4 text-muted-foreground">{t("description")}</p>
        </section>
      </Card>
    </main>
  );
}
