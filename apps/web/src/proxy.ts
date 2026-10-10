import { NextRequest, type NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { cspMode } from "./config/site";
import { routing } from "./i18n/routing";
import {
  buildContentSecurityPolicy,
  createNonce,
  cspHeaderName,
  NONCE_HEADER,
} from "./security/csp";
import { safeRedirectTarget } from "./security/redirect";

const handleLocale = createMiddleware(routing);

/**
 * Next 16 proxy (formerly middleware), run on every page request:
 * 1. A fresh nonce and the CSP built with it (ADR-047), report-only or enforced by `CSP_MODE`.
 *    The policy and the nonce travel on the request to the render, where Next.js reads the nonce
 *    from the policy for its own scripts and the layout reads `x-nonce` for the theme script; the
 *    policy also goes on the response for the browser.
 * 2. next-intl sends `/` and any path without a locale to the visitor's locale, picked from the
 *    cookie, then Accept-Language, then English (ADR-022, D-19).
 * 3. Its redirect target derives from the request path, so it passes the open-redirect rule
 *    (ADR-047): a same-site target keeps its path, anything else goes to the default locale's home.
 * @param request the incoming request.
 * @returns next-intl's response (pass-through, rewrite or redirect) with the CSP header.
 */
export default function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const header = cspHeaderName(cspMode());

  // next-intl forwards the request headers it receives to the render, so they are set here.
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set(header, policy);
  const response = handleLocale(new NextRequest(request, { headers }));

  const location = response.headers.get("location");
  if (location !== null) {
    const origin = request.nextUrl.origin;
    const safe = safeRedirectTarget(location, origin) ?? `/${routing.defaultLocale}`;
    // Next requires an absolute Location from the proxy; the checked path is resolved on our origin.
    response.headers.set("location", new URL(safe, origin).href);
  }
  response.headers.set(header, policy);
  return response;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
