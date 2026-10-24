import type { PostSummaryDto } from "@jadero/contracts";
import { describe, expect, it } from "vitest";
import { NOW_JOURNAL_POSTS, nowJournal } from "../src/content/now";

/** A published journal post card of a work package, as the journal feed lists it. */
function journal(wp: number): PostSummaryDto {
  return {
    slug: `journal-wp-${wp}`,
    locale: "en",
    kind: "journal",
    wp,
    title: `WP-${wp}`,
    excerpt: "",
    tags: [],
    publishedAt: `2026-10-${String(wp).padStart(2, "0")}T09:00:00.000Z`,
    alternates: { en: `journal-wp-${wp}` },
  };
}

describe("nowJournal", () => {
  it("takes the latest journal post as the last finished work package", () => {
    // The feed is newest first: WP-39 was published last, whatever its number.
    const page = { items: [journal(39), journal(12), journal(10), journal(5)], nextCursor: "c" };

    const { lastFinished, latest } = nowJournal(page);

    expect(lastFinished?.wp).toBe(39);
    expect(latest.map((p) => p.wp)).toEqual([39, 12, 10]);
    expect(latest).toHaveLength(NOW_JOURNAL_POSTS);
  });

  it("lists fewer posts when the journal holds fewer than three", () => {
    const { lastFinished, latest } = nowJournal({ items: [journal(12)], nextCursor: null });

    expect(lastFinished?.wp).toBe(12);
    expect(latest.map((p) => p.wp)).toEqual([12]);
  });

  it("has nothing to show when no journal post is published, so the page hides both blocks", () => {
    expect(nowJournal({ items: [], nextCursor: null })).toEqual({ lastFinished: null, latest: [] });
  });
});
