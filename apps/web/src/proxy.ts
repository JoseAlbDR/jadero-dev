import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Next 16 proxy (formerly middleware): sends `/` and any path without a locale to the visitor's
 * locale, picked from the cookie, then Accept-Language, then English (ADR-022, D-19).
 */
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
