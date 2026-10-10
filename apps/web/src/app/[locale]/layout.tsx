import { Aurora } from "@jadero/ui/components/aurora";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { SITE_URL } from "@/config/site";
import { requireLocale } from "@/i18n/locale";
import { routing } from "@/i18n/routing";
import { NONCE_HEADER } from "@/security/csp";
import "../globals.css";

type LocaleLayoutProps = Readonly<{
  children: ReactNode;
  params: Promise<{ locale: string }>;
}>;

/**
 * The known locales (ADR-022). Pages still render per request, because each response carries a
 * fresh CSP nonce (ADR-047, see the layout); this only lists the valid `[locale]` values.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Base URL, title and description shared by every page of a locale. Canonical and hreflang links
 * are per page (`localeAlternates`), never here, or every page would inherit the home's.
 * @param props.params the route params with the locale segment.
 */
export async function generateMetadata({
  params,
}: Omit<LocaleLayoutProps, "children">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    metadataBase: SITE_URL,
    title: t("title"),
    description: t("description"),
  };
}

/** Geist and Geist Mono, self-hosted from the `geist` package (ADR-045): no font CDN request. */
const fontVariables = `${GeistSans.variable} ${GeistMono.variable}`;

/**
 * Locale layout: validates the locale and renders the document: the aurora behind the page, the
 * header, the page and the footer.
 *
 * Every page renders per request: the proxy puts a fresh nonce in the CSP (ADR-047), and a page
 * built at build time could not carry it. `connection()` here, once, makes every route under the
 * locale wait for the request (never `force-dynamic`, which would also drop the `fetch` cache of
 * the content API). Next.js reads the nonce from the request's CSP for its own scripts; the theme
 * script of next-themes gets it from `x-nonce`.
 * @param props.children the page.
 * @param props.params the route params with the locale segment.
 */
export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  await connection();
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const nonce = (await headers()).get(NONCE_HEADER);

  return (
    // next-themes sets the theme class on <html> before React hydrates; that difference is expected.
    <html lang={locale} className={fontVariables} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider {...(nonce ? { nonce } : {})}>
            <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
              <Aurora className="bottom-auto h-[60rem] max-h-full" />
              <SiteHeader />
              {children}
              <SiteFooter />
            </div>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
