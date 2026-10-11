import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { SITE_URL } from "@/config/site";
import { robotsFor } from "@/seo/robots";

/**
 * `/robots.txt`. Rendered per request (`connection()`) like the pages, so it names the `SITE_URL`
 * the server was started with, not the one the build saw.
 * @returns the robots rules and the sitemap URL.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return robotsFor(SITE_URL);
}
