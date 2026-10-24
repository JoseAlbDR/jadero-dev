import type { PostPageDto, PostSummaryDto } from "@jadero/contracts";

/** How many journal posts the /now page lists under "Latest journal posts". */
export const NOW_JOURNAL_POSTS = 3;

/** The journal side of the /now page, derived from the first page of the journal feed. */
export type NowJournal = Readonly<{
  /** The latest published journal post, shown as the last finished work package; `null` when none. */
  lastFinished: PostSummaryDto | null;
  /** The latest journal posts, newest first, at most `NOW_JOURNAL_POSTS`. */
  latest: PostSummaryDto[];
}>;

/**
 * Derives the journal blocks of the /now page from the journal feed (WP-39 D2): the last finished
 * work package is the latest published journal post, never a field someone edits by hand, so it
 * cannot go stale. The feed is newest first and a page holds far more than three posts (20 from the
 * API), so the first page is enough. What is in progress lives in the Now text, not here.
 * @param page the first page of `GET /v1/content/:locale/posts?kind=journal`.
 * @returns the last finished post and the latest posts; both empty when no journal post is
 *   published, so the page hides the two blocks.
 */
export function nowJournal(page: PostPageDto): NowJournal {
  const latest = page.items.slice(0, NOW_JOURNAL_POSTS);
  return { lastFinished: latest[0] ?? null, latest };
}
