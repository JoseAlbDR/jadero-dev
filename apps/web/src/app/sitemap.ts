import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { SITE_URL } from "@/config/site";
import { getPosts, getProjects, getWorkLog } from "@/content/api";
import { buildSitemap } from "@/seo/sitemap";

/**
 * `/sitemap.xml`: the static pages in every locale and the published projects, blog and journal
 * posts and indexable work-log entries from the content API (`buildSitemap`). Rendered per request
 * (`connection()`), so it uses the server's `SITE_URL` and never bakes a build-time answer; the
 * content reads go through the content client and its 60 s `fetch` cache. When the API is down the sitemap still answers
 * 200 with the static pages and logs which lists it left out, by name only.
 * @returns the sitemap entries.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  return buildSitemap(
    { projects: (locale) => getProjects(locale), posts: getPosts, workLog: getWorkLog },
    SITE_URL,
    (resource) => console.warn(`sitemap: ${resource} unavailable, left out of the sitemap`),
  );
}
