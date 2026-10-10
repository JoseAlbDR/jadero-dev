import { useTranslations } from "next-intl";

/**
 * Site footer: the copyright line and the one-line note. Links to pages of later WPs (/now, the
 * journal, Under the hood) are added with those pages, never before.
 */
export function SiteFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl px-6 pt-16 pb-10">
      <div className="flex flex-col gap-2 border-t pt-6 text-muted-foreground text-sm sm:flex-row sm:justify-between">
        <p className="font-mono">{t("copyright", { year: new Date().getFullYear() })}</p>
        <p>{t("note")}</p>
      </div>
    </footer>
  );
}
