import { NextRequest, type NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { cspMode, isDevelopment, SITE_URL } from "./config/site";
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
 * 1. A fresh nonce and the CSP built with it (ADR-047), enforced unless `CSP_MODE=report-only`.
 *    The policy and the nonce travel on the request to the render, where Next.js reads the nonce
 *    from the policy for its own scripts and the layout reads `x-nonce` for the theme script; the
 *    policy also goes on the response for the browser.
 * 2. next-intl sends `/` and any path without a locale to the visitor's locale, picked from the
 *    cookie, then Accept-Language, then English (ADR-022, D-19).
 * 3. Its redirect target derives from the request URL, Host header included, so it passes the
 *    open-redirect rule (ADR-047) against the configured `SITE_URL` origin, never the Host a client
 *    sent: a same-site target keeps its path, anything else goes to the default locale's home, and
 *    the result is resolved on `SITE_URL`. In development the request's own origin stands in.
 * @param request the incoming request.
 * @returns next-intl's response (pass-through, rewrite or redirect) with the CSP header.
 */
export default function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy(nonce, { dev: isDevelopment() });
  const header = cspHeaderName(cspMode());

  // next-intl forwards the request headers it receives to the render, so they are set here.
  const headers = new Headers(request.headers);
  // Next reads the nonce from either CSP request header, so a client-sent one never reaches the render.
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(NONCE_HEADER, nonce);
  headers.set(header, policy);
  const response = handleLocale(new NextRequest(request, { headers }));

  const location = response.headers.get("location");
  if (location !== null) {
    // `nextUrl.origin` comes from the Host header, which a client controls: outside development the
    // site's origin is the configured one, so a spoofed Host never ends up in a Location.
    const origin = isDevelopment() ? request.nextUrl.origin : SITE_URL.origin;
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
