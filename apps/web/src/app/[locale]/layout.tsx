import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { requireLocale } from "@/i18n/locale";
import { routing } from "@/i18n/routing";
import "../globals.css";

type LocaleLayoutProps = Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>;

/** Pre-renders every page once per locale (static rendering, ADR-022). */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Title, description and `hreflang` alternates for the locale's home.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({
  params,
}: Omit<LocaleLayoutProps, "children">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    metadataBase: new URL(process.env.SITE_URL ?? "https://jadero.dev"),
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
        "x-default": `/${routing.defaultLocale}`,
      },
    },
  };
}

/**
 * Locale layout: validates the locale, enables static rendering for it and renders the document.
 * @param props.children the page.
 * @param props.params the route params with the locale segment.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);

  return (
    // next-themes sets the theme class on <html> before React hydrates; that difference is expected.
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider>
            <SiteHeader />
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
