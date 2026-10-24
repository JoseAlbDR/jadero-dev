import { describe, expect, it } from "vitest";
import {
  FieldFormatInvalid,
  InvalidTransition,
  JournalWorkPackageInvalid,
  SlugInvalid,
} from "./content.errors.js";
import { Post, type PostDocument, postRules } from "./post.js";

/** A blog post's layout. */
const BLOG = { id: "post-1", slug: "sample-post", kind: "post", wp: null } as const;

const AT = new Date("2026-11-03T10:12:00.000Z");
const LATER = new Date("2026-11-10T10:00:00.000Z");

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
    const post = Post.create(BLOG);
    expect(post).toMatchObject({ id: "post-1", slug: "sample-post", kind: "post", wp: null });
    expect(post.version).toBe(0);
  });

  it("refuses an invalid canonical slug", () => {
    expect(() => Post.create({ ...BLOG, slug: "Sample Post" })).toThrow(SlugInvalid);
  });

  it("creates a journal post linked to its work package, kept in the snapshot", () => {
    const post = Post.create({ id: "post-2", slug: "wp-39-journal", kind: "journal", wp: 39 });
    expect(post.snapshot()).toMatchObject({ kind: "journal", wp: 39 });
  });

  it.each`
    kind         | wp
    ${"journal"} | ${null}
    ${"journal"} | ${0}
    ${"journal"} | ${-3}
    ${"journal"} | ${1.5}
    ${"post"}    | ${39}
  `("refuses kind $kind with wp $wp", ({ kind, wp }) => {
    expect(() => Post.create({ ...BLOG, kind, wp })).toThrow(JournalWorkPackageInvalid);
  });

  it.each`
    field        | value  | complete
    ${"slug"}    | ${""}  | ${false}
    ${"title"}   | ${" "} | ${false}
    ${"body"}    | ${""}  | ${false}
    ${"excerpt"} | ${""}  | ${true}
  `("is complete: $complete with $field = $value", ({ field, value, complete }) => {
    expect(postRules.isComplete(doc())).toBe(true);
    expect(postRules.isComplete(doc({ [field]: value }))).toBe(complete);
  });

  it.each`
    over                          | fields
    ${{ slug: "sample_post" }}    | ${["slug"]}
    ${{ tags: ["x".repeat(61)] }} | ${["tags[0]"]}
  `("refuses to save $over", ({ over, fields }) => {
    expect(postRules.invalidFields(doc(over))).toEqual(fields);
    const post = Post.create(BLOG);
    expect(() => post.saveRevision("es", doc(over), "owner", "r-es", AT)).toThrow(
      FieldFormatInvalid,
    );
  });

  it("keeps its feed date (first publish) when a fix is published later", () => {
    const post = Post.create(BLOG);
    for (const locale of ["es", "en", "de"] as const) {
      post.saveRevision(locale, doc(), "owner", `r-${locale}`, AT);
    }
    expect(post.publish(["es", "en", "de"], AT).warnings).toEqual([]);
    post.saveRevision("de", doc({ title: "Fixed title" }), "owner", "r-de-2", LATER);
    post.publish(["de"], LATER);
    expect(post.translations.firstPublishedAt("de")).toEqual(AT);
    expect(post.translations.publishedAt("de")).toEqual(LATER);

    post.archive(LATER);
    expect(() => post.saveRevision("es", doc(), "owner", "r-es-2", AT)).toThrow(InvalidTransition);
  });

  it("reconstitutes with its stored version", () => {
    const post = Post.reconstitute({
      ...BLOG,
      version: 3,
      translations: { locales: {}, archivedAt: AT },
    });
    expect(post.version).toBe(3);
    expect(post.translations.archivedAt()).toEqual(AT);
  });
});
