import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Classes of a footer link. */
const FOOTER_LINK =
  "rounded-md underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Site footer: the copyright line, the links to the work log (also in the main nav) and the build
 * journal, and the one-line note. Links to pages of later WPs (/now, Under the hood) are added with
 * those pages, never before.
 */
export function SiteFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl px-6 pt-16 pb-10">
      <div className="flex flex-col gap-2 border-t pt-6 text-muted-foreground text-sm sm:flex-row sm:justify-between">
        <p className="font-mono">{t("copyright", { year: new Date().getFullYear() })}</p>
        <div className="flex gap-4">
          <Link href="/work" className={FOOTER_LINK}>
            {t("work")}
          </Link>
          <Link href="/journal" className={FOOTER_LINK}>
            {t("journal")}
          </Link>
        </div>
        <p>{t("note")}</p>
      </div>
    </footer>
  );
}
