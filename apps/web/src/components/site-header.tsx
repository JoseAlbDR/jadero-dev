import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Site header as a glass bar (ADR-045): the site name, the main navigation and the language and
 * theme controls. On phones the navigation wraps to its own row.
 */
export function SiteHeader() {
  const t = useTranslations("Header");
  return (
    <header className="mx-auto w-full max-w-5xl px-6 pt-6">
      <div className="glass flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-card px-4 py-3 sm:gap-x-6 sm:px-5">
        <Link href="/" className="font-mono font-semibold text-sm tracking-tight">
          <span aria-hidden className="text-signal">
            &gt;{" "}
          </span>
          jadero.dev<span className="sr-only">, {t("home")}</span>
        </Link>
        <SiteNav className="order-last w-full sm:order-none sm:mr-auto sm:w-auto" />
        <div className="flex items-center gap-2 sm:gap-4">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
