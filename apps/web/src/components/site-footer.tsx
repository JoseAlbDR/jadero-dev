import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Site footer: the copyright line, the link to the work log and the one-line note. The work log is
 * linked here, not in the main nav, until the header is redesigned for mobile. Links to pages of
 * later WPs (/now, the journal, Under the hood) are added with those pages, never before.
 */
export function SiteFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl px-6 pt-16 pb-10">
      <div className="flex flex-col gap-2 border-t pt-6 text-muted-foreground text-sm sm:flex-row sm:justify-between">
        <p className="font-mono">{t("copyright", { year: new Date().getFullYear() })}</p>
        <Link
          href="/work"
          className="rounded-md underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t("work")}
        </Link>
        <p>{t("note")}</p>
      </div>
    </footer>
  );
}
