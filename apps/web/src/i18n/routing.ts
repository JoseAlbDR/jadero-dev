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
    "/experience": { en: "/experience", es: "/experiencia", de: "/erfahrung" },
    "/projects": { en: "/projects", es: "/proyectos", de: "/projekte" },
    // The slug is the project's own localized slug (`sample-project`, `proyecto-de-ejemplo`).
    "/projects/[slug]": { en: "/projects/[slug]", es: "/proyectos/[slug]", de: "/projekte/[slug]" },
    // The same word in every locale (owner's choice); a post's slug is its own localized slug.
    "/stack": "/stack",
    "/blog": "/blog",
    "/blog/[slug]": "/blog/[slug]",
    // The work log (ADR-031, D-52): entries are English only (D-50) and addressed by their stable
    // id (`kb-...`) in every locale, the target of a citation (`/en/work/<id>#tradeoffs`).
    "/work": { en: "/work", es: "/trabajo", de: "/arbeit" },
    "/work/[entryId]": { en: "/work/[entryId]", es: "/trabajo/[entryId]", de: "/arbeit/[entryId]" },
    // WP-15 throwaway mockups; removed once the owner picks a direction.
    "/mockups": "/mockups",
    "/mockups/terminal": "/mockups/terminal",
    "/mockups/editorial": "/mockups/editorial",
    "/mockups/bento": "/mockups/bento",
    "/mockups/hybrid": "/mockups/hybrid",
    "/mockups/bento-agent": "/mockups/bento-agent",
  },
});
