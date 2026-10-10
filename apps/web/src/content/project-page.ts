import type { Locale, ProjectDto } from "@jadero/contracts";
import { notFound, redirect } from "next/navigation";
import { SITE_URL } from "@/config/site";
import { getPathname } from "@/i18n/navigation";
import { safeRedirectTarget } from "@/security/redirect";
import { getProject, getProjects } from "./api";

/**
 * The project of a project page. Slugs are localized, so the locale switcher, which keeps the
 * current slug, lands on `/de/projekte/caso-de-ejemplo` with the Spanish one. When the slug is not
 * the locale's but is another locale's slug of a project published here, the page redirects to the
 * locale's own slug (307: a slug can change when a translation is published). Otherwise the API
 * decides: its 404 is the page's 404. The lookup reads the cached project list (60 s, the same tag
 * as the list page), so it costs no extra request most of the time.
 * @param locale the page locale.
 * @param slug the slug from the page URL.
 * @returns the project; redirects or calls `notFound()` instead of returning when it must.
 */
export async function loadProjectPage(locale: Locale, slug: string): Promise<ProjectDto> {
  const { items } = await getProjects(locale);
  if (!items.some((item) => item.slug === slug)) {
    const match = items.find((item) => Object.values(item.alternates).includes(slug));
    if (match) {
      const path = getPathname({
        href: { pathname: "/projects/[slug]", params: { slug: match.slug } },
        locale,
      });
      // Every redirect goes through the open-redirect rule (ADR-047), even one built from API data.
      redirect(safeRedirectTarget(path, SITE_URL) ?? notFound());
    }
  }
  return getProject(locale, slug);
}
