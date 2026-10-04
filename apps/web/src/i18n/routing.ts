import { defineRouting } from "next-intl/routing";

/**
 * Locales and URL shape of the site (ADR-022): every path carries its locale (`/en`, `/es`, `/de`),
 * English is the default when Accept-Language matches none (D-19). The locale of a visited page that
 * differs from the detected one is kept in a session cookie (next-intl's default, owner's choice on
 * 2026-10-04: no persistent cookie). Pages add their localized pathname here (`/es/proyectos`, WP-16).
 */
export const routing = defineRouting({
  locales: ["en", "es", "de"],
  defaultLocale: "en",
  localePrefix: "always",
  pathnames: {
    "/": "/",
  },
});
