import type { MetadataRoute } from "next";

/** The path of the sitemap (`src/app/sitemap.ts`). */
export const SITEMAP_PATH = "/sitemap.xml";

/**
 * The robots rules of the site: every crawler may read every page, nothing public is disallowed,
 * and the sitemap is announced on the site's own origin. Pages that must stay out of search results
 * say so in their own `robots` meta tag (a later blog page, an entry that is not indexable), which a
 * crawler can only read when robots.txt lets it fetch the page.
 * @param siteUrl the public origin (`SITE_URL`).
 * @returns the robots.txt content as Next's metadata route object.
 */
export function robotsFor(siteUrl: URL): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL(SITEMAP_PATH, siteUrl).href,
  };
}
