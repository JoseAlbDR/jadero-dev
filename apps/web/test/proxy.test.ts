import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import proxy from "../src/proxy";

const SITE = "https://jadero.dev";

/**
 * A page request as Next hands it to the proxy. The path is appended, not resolved, so `//host`
 * stays a path, as it is on the wire.
 */
function request(path: string, init: { language?: string } = {}): NextRequest {
  const headers = new Headers({ "accept-language": init.language ?? "en" });
  return new NextRequest(`${SITE}${path}`, { headers });
}

/** The request headers the proxy forwards to the render (Next's override protocol). */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name.toLowerCase()}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: CSP (ADR-047)", () => {
  it("sends a report-only policy by default and hands the same nonce to the render", () => {
    const response = proxy(request("/en"));
    const policy = response.headers.get("content-security-policy-report-only");
    expect(response.headers.get("content-security-policy")).toBeNull();
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(forwarded(response, "x-nonce")).toBe(nonce);
    expect(forwarded(response, "content-security-policy-report-only")).toBe(policy);
    // next-intl's own forwarded header survives the composition.
    expect(forwarded(response, "x-next-intl-locale")).toBe("en");
  });

  it("enforces the policy when CSP_MODE=enforce", () => {
    vi.stubEnv("CSP_MODE", "enforce");
    const response = proxy(request("/de"));
    expect(response.headers.get("content-security-policy")).toMatch(/'strict-dynamic'/);
    expect(response.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("uses a fresh nonce for every request", () => {
    const nonce = (r: Response) => forwarded(r, "x-nonce");
    expect(nonce(proxy(request("/en")))).not.toBe(nonce(proxy(request("/en"))));
  });
});

describe("proxy: locale redirects follow the open-redirect rule (ADR-047)", () => {
  it("redirects / to the Accept-Language locale on the site", () => {
    const response = proxy(request("/", { language: "de-DE" }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${SITE}/de`);
    expect(response.headers.get("content-security-policy-report-only")).toBeTruthy();
  });

  it("keeps the path and query of a localized redirect", () => {
    const response = proxy(request("/blog?x=1", { language: "es" }));
    expect(response.headers.get("location")).toBe(`${SITE}/es/blog?x=1`);
  });

  it.each([
    "//evil.example",
    "//evil.example/en",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%5C%5Cevil.example",
    "/%252F%252Fevil.example",
  ])("keeps %s under a locale on the site", (path) => {
    const location = proxy(request(path)).headers.get("location") ?? "";
    expect(location.startsWith(`${SITE}/en`)).toBe(true);
    expect(new URL(location).pathname).toMatch(/^\/en(\/|$)/);
  });
});

describe("proxy: redirects are pinned to SITE_URL, not the Host header (ADR-047)", () => {
  /** A request whose Host header names another site, as a client or a cache-poisoning probe sends. */
  function spoofed(path: string, host: string): NextRequest {
    const headers = new Headers({ "accept-language": "de", host });
    return new NextRequest(`https://${host}${path}`, { headers });
  }

  it("never redirects to a spoofed Host", () => {
    const response = proxy(spoofed("/", "evil.example"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("evil.example");
    expect(new URL(location).origin).toBe(SITE);
  });

  it("still sends a request on the site's own host to its locale", () => {
    const response = proxy(spoofed("/", "jadero.dev"));
    expect(response.headers.get("location")).toBe(`${SITE}/de`);
  });

  it("uses the request's own origin in development, where the dev server has no fixed host", () => {
    vi.stubEnv("NODE_ENV", "development");
    const headers = new Headers({ "accept-language": "es" });
    const response = proxy(new NextRequest("http://localhost:3000/", { headers }));
    expect(response.headers.get("location")).toBe("http://localhost:3000/es");
  });
});
