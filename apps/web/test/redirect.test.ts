import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "../src/security/redirect";

const SITE = "https://jadero.dev";

describe("safeRedirectTarget (ADR-047 open-redirect rule)", () => {
  it.each([
    ["/de/projekte", "/de/projekte"],
    ["/es?ref=nav#top", "/es?ref=nav#top"],
    ["/de/%C3%BCber", "/de/%C3%BCber"],
    // next-intl builds absolute URLs; a same-site one comes back relative, so a forged Host
    // header cannot point the redirect at another host.
    ["https://jadero.dev/en", "/en"],
  ])("accepts the same-site target %s as %s", (target, expected) => {
    expect(safeRedirectTarget(target, SITE)).toBe(expected);
  });

  it.each([
    ["an absolute URL to another host", "https://evil.example/en"],
    ["the site's host on another scheme", "ftp://jadero.dev/en"],
    ["a protocol-relative URL", "//evil.example/en"],
    ["a backslash authority", "/\\evil.example"],
    ["a mixed-slash authority", "\\/evil.example"],
    ["a tab hidden in the authority", "/\t/evil.example"],
    ["a newline hidden in the authority", "/\n/evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an upper-case JavaScript: URL", "JavaScript:alert(1)"],
    ["a javascript: URL split by a tab", "java\tscript:alert(1)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["an encoded javascript: URL", "%6Aavascript:alert(1)"],
    ["an encoded protocol-relative URL", "%2F%2Fevil.example"],
    ["a path with encoded slashes", "/%2F%2Fevil.example"],
    ["a path with an encoded backslash", "/%5Cevil.example"],
    ["a path with a lower-case encoded backslash", "/%5cevil.example"],
    ["a double-encoded protocol-relative path", "/%252F%252Fevil.example"],
    ["a path with an encoded tab before a slash", "/%09/evil.example"],
    ["a path that decodes to a javascript: URL", "/%6Aavascript:alert(1)"],
    ["a relative path without a leading slash", "evil.example/en"],
    ["a malformed percent-encoding", "/en/%E0%A4%A"],
  ])("refuses %s", (_name, target) => {
    expect(safeRedirectTarget(target, SITE)).toBeUndefined();
  });

  it("accepts another host only when its origin is on the allowlist", () => {
    const allow = ["https://old.jadero.dev"];
    expect(safeRedirectTarget("https://old.jadero.dev/blog?x=1", SITE, allow)).toBe(
      "https://old.jadero.dev/blog?x=1",
    );
    expect(safeRedirectTarget("http://old.jadero.dev/blog", SITE, allow)).toBeUndefined();
    expect(safeRedirectTarget("https://old.jadero.dev.evil.example/", SITE, allow)).toBeUndefined();
    expect(safeRedirectTarget("//old.jadero.dev/blog", SITE, allow)).toBeUndefined();
  });
});
