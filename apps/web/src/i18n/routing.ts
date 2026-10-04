import { defineRouting } from "next-intl/routing";

/**
 * Locales and URL shape of the site (ADR-022): every path carries its locale (`/en`, `/es`, `/de`),
 * English is the default when Accept-Language matches none (D-19), and the visitor's choice is kept
 * in a cookie for a year. Pages add their localized pathname here (`/es/proyectos`, WP-16).
 */
export const routing = defineRouting({
  locales: ["en", "es", "de"],
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
  pathnames: {
    "/": "/",
  },
});
