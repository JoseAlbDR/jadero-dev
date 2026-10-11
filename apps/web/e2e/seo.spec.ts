import { expect, type Page, test } from "@playwright/test";
import es from "../messages/es.json" with { type: "json" };

// The server puts SITE_URL in canonical, hreflang, Open Graph, sitemap and robots URLs.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

/**
 * The content of each `<meta property=...>` tag of the page, keyed by property; a property that
 * repeats (`og:locale:alternate`, `article:tag`) keeps every value in order.
 * @param page the page under test, already loaded.
 */
async function openGraph(page: Page): Promise<Record<string, string[]>> {
  const pairs = await page
    .locator("meta[property]")
    .evaluateAll((tags) =>
      tags.map((t) => [t.getAttribute("property") ?? "", t.getAttribute("content") ?? ""]),
    );
  const result: Record<string, string[]> = {};
  for (const [property, content] of pairs) {
    result[property as string] = [...(result[property as string] ?? []), content as string];
  }
  return result;
}

/** The `content` of `<meta name=...>`, or null when the tag is missing. */
async function metaName(page: Page, name: string): Promise<string | null> {
  const tag = page.locator(`meta[name="${name}"]`);
  return (await tag.count()) > 0 ? tag.getAttribute("content") : null;
}

test.describe("Open Graph and Twitter card (ADR-022)", () => {
  test("a list page describes itself in its own language with the other locales as alternates", async ({
    page,
  }) => {
    await page.goto("/es/experiencia");
    const og = await openGraph(page);
    expect(og["og:type"]).toEqual(["website"]);
    expect(og["og:title"]).toEqual([es.ExperiencePage.metaTitle]);
    expect(og["og:description"]).toEqual([es.ExperiencePage.metaDescription]);
    expect(og["og:url"]).toEqual([`${SITE}/es/experiencia`]);
    expect(og["og:site_name"]).toEqual(["jadero.dev"]);
    expect(og["og:locale"]).toEqual(["es_ES"]);
    expect(og["og:locale:alternate"]).toEqual(["en_US", "de_DE"]);
    expect(await metaName(page, "twitter:card")).toBe("summary");
    expect(await metaName(page, "twitter:title")).toBe(es.ExperiencePage.metaTitle);
  });

  test("a post is an article with its publish time and tags", async ({ page }) => {
    await page.goto("/en/blog/why-an-outbox");
    const og = await openGraph(page);
    expect(og["og:type"]).toEqual(["article"]);
    expect(og["og:url"]).toEqual([`${SITE}/en/blog/why-an-outbox`]);
    expect(og["article:published_time"]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(og["article:tag"]?.length).toBeGreaterThan(0);
  });

  test("the German fallback project points its card at the English page", async ({ page }) => {
    await page.goto("/de/projekte/search-index");
    const og = await openGraph(page);
    expect(og["og:type"]).toEqual(["article"]);
    expect(og["og:url"]).toEqual([`${SITE}/en/projects/search-index`]);
    expect(og["og:locale"]).toEqual(["en_US"]);
    expect(og["og:locale:alternate"]).toEqual(["es_ES"]);
  });

  test("a work-log entry under /es is the English article", async ({ page }) => {
    await page.goto("/es/trabajo/kb-outbox-relay");
    const og = await openGraph(page);
    expect(og["og:url"]).toEqual([`${SITE}/en/work/kb-outbox-relay`]);
    expect(og["og:locale"]).toEqual(["en_US"]);
    expect(og["og:locale:alternate"]).toBeUndefined();
  });
});

test.describe("sitemap and robots", () => {
  test("/sitemap.xml lists the pages per locale with their alternates, indexable ones only", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/xml/);
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    // Static pages in every locale, on their localized pathnames.
    for (const path of ["/en", "/es", "/de", "/es/experiencia", "/de/arbeit", "/en/stack"]) {
      expect(locs).toContain(`${SITE}${path}`);
    }
    // Content in each locale it is published in; the German fallback is not a German page.
    expect(locs).toContain(`${SITE}/es/proyectos/relay-de-mensajes`);
    expect(locs).toContain(`${SITE}/de/projekte/nachrichten-relay`);
    expect(locs).not.toContain(`${SITE}/de/projekte/search-index`);
    // Posts from every list page (the stub pages by two).
    expect(locs).toContain(`${SITE}/en/blog/first-notes`);
    expect(locs).not.toContain(`${SITE}/de/blog/first-notes`);
    // Work-log entries under /en only, and only the indexable ones (D-50, D-52).
    expect(locs).toContain(`${SITE}/en/work/kb-outbox-relay`);
    expect(locs).not.toContain(`${SITE}/en/work/kb-inbox-dedup`);
    expect(locs).not.toContain(`${SITE}/es/trabajo/kb-outbox-relay`);
    expect(new Set(locs).size).toBe(locs.length);

    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/en/experience" />`,
    );
  });

  test("/robots.txt allows everything and points at the sitemap", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toMatch(/User-Agent: \*/i);
    expect(text).toContain("Allow: /");
    expect(text).not.toMatch(/Disallow: \S/);
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});
