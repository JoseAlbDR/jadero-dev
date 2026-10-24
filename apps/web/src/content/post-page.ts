import type { Locale, PostDto, PostKind } from "@jadero/contracts";
import { notFound, redirect } from "next/navigation";
import { SITE_URL } from "@/config/site";
import { getPathname } from "@/i18n/navigation";
import { safeRedirectTarget } from "@/security/redirect";
import { findPost, getPosts } from "./api";
import { findAlternatePostSlug, POST_ROUTES } from "./posts";

/**
 * The post of a post page, on the blog (`kind` `post`) or the journal (`kind` `journal`). Slugs are
 * localized, as on project pages: the API is asked for the page's slug first, which is the only
 * request in the usual case. A post of the other kind is the page's 404, so a journal post never
 * shows under `/blog` and a blog post never under `/journal` (one URL per post). When the API does
 * not know the slug, the list of this kind is searched for a post that has it in another locale
 * (the locale switcher keeps the current slug), and the page redirects to that post's own slug in
 * this locale (307: a slug can change when a translation is published). The list is paginated, so
 * the search reads at most `POST_LOOKUP_MAX_PAGES` pages, each cached for 60 s under the posts tag.
 * No match is the 404.
 * @param locale the page locale.
 * @param slug the slug from the page URL.
 * @param kind the kind of post the route serves.
 * @returns the post; redirects or calls `notFound()` instead of returning when it must.
 */
export async function loadPostPage(locale: Locale, slug: string, kind: PostKind): Promise<PostDto> {
  const post = await findPost(locale, slug);
  if (post) return post.kind === kind ? post : notFound();
  const match = await findAlternatePostSlug(slug, (cursor) => getPosts(locale, kind, cursor));
  if (match === null || match === slug) notFound();
  const path = getPathname({
    href: { pathname: POST_ROUTES[kind].item, params: { slug: match } },
    locale,
  });
  // Every redirect goes through the open-redirect rule (ADR-047), even one built from API data.
  redirect(safeRedirectTarget(path, SITE_URL) ?? notFound());
}
