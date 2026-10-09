import { describe, expect, it } from "vitest";
import { InvalidTransition, SlugInvalid } from "./content.errors.js";
import { isPostComplete, Post, type PostDocument } from "./post.js";

const AT = new Date("2026-11-03T10:12:00.000Z");

function doc(over: Partial<PostDocument> = {}): PostDocument {
  return {
    slug: "sample-post",
    title: "Sample post",
    excerpt: "A placeholder excerpt.",
    body: "Placeholder body.",
    tags: ["testing"],
    ...over,
  };
}

describe("Post", () => {
  it("creates with its canonical slug and version 0", () => {
    const post = Post.create({ id: "post-1", slug: "sample-post" });
    expect(post).toMatchObject({ id: "post-1", slug: "sample-post", version: 0 });
  });

  it("refuses an invalid canonical slug", () => {
    expect(() => Post.create({ id: "post-1", slug: "Sample Post" })).toThrow(SlugInvalid);
  });

  it.each`
    field        | value
    ${"slug"}    | ${""}
    ${"title"}   | ${" "}
    ${"excerpt"} | ${""}
    ${"body"}    | ${""}
  `("is incomplete with $field = $value", ({ field, value }) => {
    expect(isPostComplete(doc())).toBe(true);
    expect(isPostComplete(doc({ [field]: value }))).toBe(false);
  });

  it("publishes all three locales without warnings and records the publish time", () => {
    const post = Post.create({ id: "post-1", slug: "sample-post" });
    for (const locale of ["es", "en", "de"] as const) {
      post.saveRevision(locale, doc(), "owner", `r-${locale}`, AT);
    }
    expect(post.publish(["es", "en", "de"], AT).warnings).toEqual([]);
    expect(post.translations.publishedAt("de")).toEqual(AT);
    post.archive(AT);
    expect(() => post.saveRevision("es", doc(), "owner", "r-es-2", AT)).toThrow(InvalidTransition);
  });

  it("reconstitutes with its stored version", () => {
    const post = Post.reconstitute({
      id: "post-1",
      slug: "sample-post",
      version: 3,
      translations: { locales: {}, archivedAt: AT },
    });
    expect(post.version).toBe(3);
    expect(post.translations.archivedAt()).toEqual(AT);
  });
});
