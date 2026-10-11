"use client";

import { cn } from "@jadero/ui/cn";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/**
 * The main navigation, in display order. Only pages that exist are listed: each WP-16 page adds
 * its entry together with its localized pathname in `routing.pathnames`.
 */
const NAV_ITEMS = [
  { href: "/", key: "home" },
  { href: "/experience", key: "experience" },
  { href: "/projects", key: "projects" },
  { href: "/stack", key: "stack" },
  { href: "/blog", key: "blog" },
  { href: "/work", key: "work" },
] as const;

/**
 * Main navigation of the header; the current page is marked with `aria-current` and the signal
 * color. `inline` is the row of the desktop header, `stacked` the column of the phone menu.
 * @param props.className layout classes from the header.
 * @param props.layout `inline` (default) or `stacked`.
 */
export function SiteNav({
  className,
  layout = "inline",
}: Readonly<{ className?: string; layout?: "inline" | "stacked" }>) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className={className}>
      <ul
        className={cn(
          "flex text-sm",
          layout === "inline" ? "flex-wrap items-center gap-1" : "flex-col gap-0.5",
        )}
      >
        {NAV_ITEMS.map(({ href, key }) => {
          const current = pathname === href;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  layout === "stacked" && "block py-2 text-base",
                  current && "font-medium text-signal hover:text-signal",
                )}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
