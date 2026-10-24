import type { PostPageDto, PostSummaryDto } from "@jadero/contracts";
import { ContentApiError } from "./api";

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

/**
 * Reads the journal feed for the /now page and derives its blocks, degrading like the Now text
 * does (WP-39 D2: the page always renders). A failed read (the API unreachable, an error status or
 * a payload its contract refuses, all a `ContentApiError`) gives the empty journal, so the page
 * answers 200 without the two journal blocks instead of landing in the error boundary. Nothing is
 * logged here: `fetchContent` already logged what its debug mode allows. Any other error (a missing
 * `CONTENT_API_URL`, a Next.js control-flow error) is rethrown.
 * @param read the read of the first page of `GET /v1/content/:locale/posts?kind=journal`.
 * @returns the journal blocks, or both empty when the read failed or the journal is empty.
 */
export async function readNowJournal(read: () => Promise<PostPageDto>): Promise<NowJournal> {
  try {
    return nowJournal(await read());
  } catch (error) {
    if (error instanceof ContentApiError) return { lastFinished: null, latest: [] };
    throw error;
  }
}
