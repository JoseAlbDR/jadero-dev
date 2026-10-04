import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

/** Minimal header: the site name and the language and theme controls. WP-16 adds navigation. */
export function SiteHeader() {
  const t = useTranslations("Header");
  return (
    <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
      <Link href="/" className="font-serif text-lg tracking-tight">
        jadero.dev<span className="sr-only">, {t("home")}</span>
      </Link>
      <div className="flex items-center gap-4">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
