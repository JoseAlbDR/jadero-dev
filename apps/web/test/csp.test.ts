import { afterEach, describe, expect, it, vi } from "vitest";
import { cspMode } from "../src/config/site";
import { buildContentSecurityPolicy, createNonce, cspHeaderName } from "../src/security/csp";

/** Splits a policy into a directive name to value map. */
function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split("; ").map((d) => {
      const [name = "", ...values] = d.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createNonce", () => {
  it("returns 16 random bytes in base64, different each time", () => {
    const a = createNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(createNonce()).not.toBe(a);
  });
});

describe("buildContentSecurityPolicy (ADR-047)", () => {
  it("is a strict nonce policy with the ADR's directives in production", () => {
    const d = directives(buildContentSecurityPolicy("abc=", { dev: false }));
    expect(d.get("script-src")).toBe("'nonce-abc=' 'strict-dynamic'");
    expect(d.get("style-src")).toBe("'self' 'nonce-abc='");
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'none'");
    expect(d.get("frame-ancestors")).toBe("'none'");
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("font-src")).toBe("'self'");
    expect(d.get("connect-src")).toBe("'self'");
    expect([...d.values()].join(" ")).not.toMatch(/unsafe/);
  });

  it("allows eval and inline styles only under next dev", () => {
    const d = directives(buildContentSecurityPolicy("abc=", { dev: true }));
    expect(d.get("script-src")).toBe("'nonce-abc=' 'strict-dynamic' 'unsafe-eval'");
    expect(d.get("style-src")).toBe("'self' 'unsafe-inline'");
  });
});

describe("CSP mode", () => {
  it("defaults to enforce and names the matching header", () => {
    vi.stubEnv("CSP_MODE", "");
    expect(cspMode()).toBe("enforce");
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
  });

  it("switches to report-only with one value", () => {
    vi.stubEnv("CSP_MODE", "report-only");
    expect(cspMode()).toBe("report-only");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });

  it("fails loudly on any other value", () => {
    vi.stubEnv("CSP_MODE", "enforced");
    expect(() => cspMode()).toThrow(/CSP_MODE/);
  });
});
