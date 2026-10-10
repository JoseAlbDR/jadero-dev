import { encodePostCursor, type PostPageDto, postCursor } from "@jadero/contracts";
import type { Locale } from "next-intl";

/**
 * Reads the `?cursor=` of the blog list from the visitor's URL. The value is checked against the
 * contract (`postCursor`: base64url of a publish time and a post id) and rebuilt from the decoded
 * position with `encodePostCursor`, so what reaches the API and the page's links is a cursor this
 * site built, never the raw input.
 * @param value the raw search param (absent, one value or repeated).
 * @returns `undefined` for the first page, the rebuilt cursor, or `null` when the value is not a
 *   cursor (the page answers 404).
 */
export function postCursorParam(value: string | string[] | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const parsed = postCursor.safeParse(value);
  return parsed.success ? encodePostCursor(parsed.data) : null;
}

/** How many list pages a post page reads at most when it looks for another locale's slug. */
export const POST_LOOKUP_MAX_PAGES = 10;

/**
 * Finds the post that has `slug` in another locale and returns its slug in the page's locale, for
 * the redirect of a post page reached with a translated slug (the locale switcher keeps the current
 * slug). Walks the list pages newest first, following `nextCursor`, and stops at the first match,
 * at the last page or after `maxPages` pages, so an unknown slug costs a bounded number of
 * (cached) requests.
 * @param slug the slug from the page URL, which the API does not know in the page's locale.
 * @param fetchPage reads one list page in the page's locale; `undefined` is the first page.
 * @param maxPages the most pages to read.
 * @returns the post's slug in the page's locale, or `null` when no post has that slug.
 */
export async function findAlternatePostSlug(
  slug: string,
  fetchPage: (cursor?: string) => Promise<PostPageDto>,
  maxPages: number = POST_LOOKUP_MAX_PAGES,
): Promise<string | null> {
  let cursor: string | undefined;
  for (let read = 0; read < maxPages; read++) {
    const page = await fetchPage(cursor);
    const match = page.items.find((item) => Object.values(item.alternates).includes(slug));
    if (match) return match.slug;
    if (page.nextCursor === null) return null;
    cursor = page.nextCursor;
  }
  return null;
}

/**
 * Formats a post's publish time as a date in a locale (`Oct 10, 2026`, `10 oct 2026`,
 * `10.10.2026`). The day is taken in UTC, so the server's time zone never moves it.
 * @param value an ISO date-time from the contract (`publishedAt`).
 * @param locale the page locale; the format follows the page, not the post's language.
 * @returns the date label.
 */
export function formatPublishDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(value),
  );
}
