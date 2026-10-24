import { encodePostCursor, type PostPageDto, type PostSummaryDto } from "@jadero/contracts";
import { describe, expect, it, vi } from "vitest";
import { findAlternatePostSlug, formatPublishDate, postCursorParam } from "../src/content/posts";

const POSITION = {
  publishedAt: "2026-10-01T08:00:00.000Z",
  id: "4b7c2f8e-1d3a-4c5b-9e6f-0a1b2c3d4e5f",
};

describe("postCursorParam", () => {
  it("is the first page when there is no cursor", () => {
    expect(postCursorParam(undefined)).toBeUndefined();
  });

  it("rebuilds a valid cursor from its decoded position", () => {
    const cursor = encodePostCursor(POSITION);
    expect(postCursorParam(cursor)).toBe(cursor);
  });

  it.each([
    ["not base64url", "abc$%"],
    ["base64url but not JSON", "bm90LWpzb24"],
    ["JSON that is not a position", btoa('["yesterday","1"]').replace(/=+$/, "")],
    ["too long", "a".repeat(201)],
    ["empty", ""],
  ])("refuses a cursor that is %s", (_label, value) => {
    expect(postCursorParam(value)).toBeNull();
  });

  it("refuses a repeated cursor instead of picking one", () => {
    const cursor = encodePostCursor(POSITION);
    expect(postCursorParam([cursor, cursor])).toBeNull();
  });
});

/** A post card in English whose Spanish slug is `es`. */
function post(slug: string, es?: string): PostSummaryDto {
  return {
    slug,
    locale: "en",
    kind: "post",
    wp: null,
    title: slug,
    excerpt: "",
    tags: [],
    publishedAt: POSITION.publishedAt,
    alternates: { en: slug, ...(es ? { es } : {}) },
  };
}

/** A fake list reader that serves `pages` in order, chained by cursors `c1`, `c2`, ... */
function pager(pages: PostSummaryDto[][]) {
  return vi.fn(async (cursor?: string): Promise<PostPageDto> => {
    const index = cursor ? Number(cursor.slice(1)) : 0;
    return {
      items: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? `c${index + 1}` : null,
    };
  });
}

describe("findAlternatePostSlug", () => {
  it("finds the post that has the slug in another locale on a later page", async () => {
    const fetchPage = pager([[post("first", "primero")], [post("hello-world", "hola-mundo")]]);

    await expect(findAlternatePostSlug("hola-mundo", fetchPage)).resolves.toBe("hello-world");
    expect(fetchPage.mock.calls).toEqual([[undefined], ["c1"]]);
  });

  it("stops at the last page when no post has the slug", async () => {
    const fetchPage = pager([[post("a")], [post("b")]]);

    await expect(findAlternatePostSlug("missing", fetchPage)).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("reads at most maxPages pages, so an unknown slug costs a bounded number of requests", async () => {
    const fetchPage = pager([[post("a")], [post("b")], [post("c")], [post("d", "dd")]]);

    await expect(findAlternatePostSlug("dd", fetchPage, 3)).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe("formatPublishDate", () => {
  it.each([
    ["en", "Oct 1, 2026"],
    ["es", "1 oct 2026"],
    ["de", "01.10.2026"],
  ] as const)("prints the publish date in the page's format in %s", (locale, expected) => {
    expect(formatPublishDate(POSITION.publishedAt, locale)).toBe(expected);
  });

  it("takes the day in UTC, whatever the server's time zone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatPublishDate("2026-10-01T02:00:00.000Z", "en")).toBe("Oct 1, 2026");
    } finally {
      process.env.TZ = previous;
    }
  });
});
