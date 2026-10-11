import type { Locale, PostDto } from "@jadero/contracts";
import { notFound, redirect } from "next/navigation";
import { SITE_URL } from "@/config/site";
import { getPathname } from "@/i18n/navigation";
import { safeRedirectTarget } from "@/security/redirect";
import { findPost, getPosts } from "./api";
import { findAlternatePostSlug } from "./posts";

/**
 * The post of a post page. Slugs are localized, as on project pages: the API is asked for the
 * page's slug first, which is the only request in the usual case. When it does not know the slug,
 * the post list is searched for a post that has it in another locale (the locale switcher keeps the
 * current slug), and the page redirects to that post's own slug in this locale (307: a slug can
 * change when a translation is published). The list is paginated, so the search reads at most
 * `POST_LOOKUP_MAX_PAGES` pages, each cached for 60 s under the posts tag. No match is the 404.
 * @param locale the page locale.
 * @param slug the slug from the page URL.
 * @returns the post; redirects or calls `notFound()` instead of returning when it must.
 */
export async function loadPostPage(locale: Locale, slug: string): Promise<PostDto> {
  const post = await findPost(locale, slug);
  if (post) return post;
  const match = await findAlternatePostSlug(slug, (cursor) => getPosts(locale, cursor));
  if (match === null || match === slug) notFound();
  const path = getPathname({
    href: { pathname: "/blog/[slug]", params: { slug: match } },
    locale,
  });
  // Every redirect goes through the open-redirect rule (ADR-047), even one built from API data.
  redirect(safeRedirectTarget(path, SITE_URL) ?? notFound());
}
