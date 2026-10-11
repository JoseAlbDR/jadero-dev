import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileMenu } from "./mobile-menu";
import { SiteNav } from "./site-nav";
import { ThemeToggle } from "./theme-toggle";

/**
 * Site header as a glass bar (ADR-045). From 60rem (960 px, where the German labels still fit one
 * row) it holds the site name, the main navigation and the language and theme controls in one row.
 * Below it, the bar shows the site name and a "Menu" button that opens the same navigation and controls in a panel inside the
 * bar (`MobileMenu`). Only one of the two sets is displayed at a time, so a screen reader meets one
 * main navigation.
 */
export function SiteHeader() {
  const t = useTranslations("Header");
  return (
    <header className="mx-auto w-full max-w-5xl px-6 pt-6">
      <div className="glass flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-card px-4 py-3 sm:px-5 min-[60rem]:gap-x-6">
        <Link
          href="/"
          className="rounded-sm font-mono font-semibold text-sm tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span aria-hidden className="text-signal">
            &gt;{" "}
          </span>
          jadero.dev<span className="sr-only">, {t("home")}</span>
        </Link>
        <SiteNav className="hidden min-[60rem]:mr-auto min-[60rem]:block" />
        <div className="hidden items-center gap-4 min-[60rem]:flex">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
        <MobileMenu
          className="min-[60rem]:hidden"
          panelClassName="w-full border-t pt-3 pb-1 min-[60rem]:hidden"
        >
          <SiteNav layout="stacked" />
          <div className="mt-3 flex items-center justify-between gap-4 border-t pt-3">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </MobileMenu>
      </div>
    </header>
  );
}
