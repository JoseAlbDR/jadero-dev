import { describe, expect, it } from "vitest";
import { entryDescription, entryRobots, markdownPlainText, roleKey } from "../src/content/work-log";
import { englishOnlyAlternates } from "../src/i18n/alternates";

describe("entryRobots", () => {
  it("asks for noindex, follow when the entry is not indexable (D-52)", () => {
    expect(entryRobots(false)).toEqual({ index: false, follow: true });
  });

  it("sets nothing for an indexable entry", () => {
    expect(entryRobots(true)).toBeUndefined();
  });
});

describe("roleKey", () => {
  it.each([
    ["sole author", "soleAuthor"],
    ["lead", "lead"],
    ["contributor", "contributor"],
  ] as const)("maps %s to its message key", (role, key) => {
    expect(roleKey(role)).toBe(key);
  });
});

describe("markdownPlainText", () => {
  it("keeps the text of the Markdown and drops its markup", () => {
    expect(markdownPlainText("An **outbox** and a [relay](https://example.com/r).")).toBe(
      "An outbox and a relay.",
    );
  });

  it("separates blocks with one space and collapses whitespace", () => {
    expect(markdownPlainText("First paragraph.\n\n- one\n- two\n\n  Last.")).toBe(
      "First paragraph. one two Last.",
    );
  });

  it("drops raw HTML through the safe pipeline, script text included", () => {
    expect(markdownPlainText("Safe.\n\n<script>window.__xss = true</script>")).toBe("Safe.");
  });
});

describe("entryDescription", () => {
  it("is the plain text of the Summary section", () => {
    const sections = [
      { key: "summary", body: "Saves a row and an event in *one* transaction." },
      { key: "problem", body: "Two writes." },
    ] as const;
    expect(entryDescription({ sections: [...sections] })).toBe(
      "Saves a row and an event in one transaction.",
    );
  });
});

describe("englishOnlyAlternates", () => {
  it("points the canonical and the only hreflang links at the English page (D-50)", () => {
    const href = { pathname: "/work/[entryId]", params: { entryId: "kb-outbox-relay" } } as const;
    expect(englishOnlyAlternates(href)).toEqual({
      canonical: "/en/work/kb-outbox-relay",
      languages: { en: "/en/work/kb-outbox-relay", "x-default": "/en/work/kb-outbox-relay" },
    });
  });
});
