"use client";

import { cn } from "@jadero/ui/cn";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Each language's name in that language, for screen readers and tooltips. */
const LANGUAGE_NAMES = { en: "English", es: "Español", de: "Deutsch" } as const;

/** Links to the current page in the other locales; the choice is kept in the locale cookie. */
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")}>
      <ul className="flex items-center gap-1 font-mono text-xs uppercase">
        {routing.locales.map((locale) => (
          <li key={locale}>
            <Link
              href={pathname}
              locale={locale}
              hrefLang={locale}
              lang={locale}
              title={LANGUAGE_NAMES[locale]}
              aria-current={locale === current ? "page" : undefined}
              className={cn(
                "rounded px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground",
                locale === current && "text-foreground underline underline-offset-4",
              )}
            >
              <span className="sr-only">{LANGUAGE_NAMES[locale]}</span>
              <span aria-hidden>{locale}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
