import { expect, type Page, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import fixtures from "./stub/posts.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

const MESSAGES = { en, es, de } as const;

type Locale = keyof typeof MESSAGES;

/** The stub API sends two posts per page (e2e/stub/content-api.ts). */
const STUB_PAGE_SIZE = 2;

/** The path of a post page in a locale; `/blog` is the same word in every locale. */
const postPath = (locale: Locale, slug: string) => `/${locale}/blog/${slug}`;

/** The canonical and hreflang links of the page, as `[hreflang, href]` pairs. */
async function hreflangLinks(page: Page): Promise<(string | null)[][]> {
  return page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]));
}

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [key, messages] of Object.entries(MESSAGES)) {
  const locale = key as Locale;
  const list = `/${locale}/blog`;
  const t = messages.BlogPage;
  const items = fixtures[locale];
  const newest = items[0];
  if (!newest) throw new Error("posts.json needs posts in every locale");

  test.describe(list, () => {
    test("renders its title, canonical and hreflang links", async ({ page }) => {
      await page.goto(list);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${t.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${list}`);
      expect(await hreflangLinks(page)).toEqual([
        ["en", `${SITE}/en/blog`],
        ["es", `${SITE}/es/blog`],
        ["de", `${SITE}/de/blog`],
        ["x-default", `${SITE}/en/blog`],
      ]);
      const nav = page.getByRole("navigation", { name: messages.Nav.label });
      await expect(nav.getByRole("link", { name: messages.Nav.blog })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("lists the first page newest first, each post with its date, link and lang", async ({
      page,
    }) => {
      await page.goto(list);
      const firstPage = items.slice(0, STUB_PAGE_SIZE);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(
        firstPage.map((p) => p.title),
      );
      for (const item of firstPage) {
        const link = page.getByRole("link", { name: item.title, exact: true });
        await expect(link).toHaveAttribute("href", postPath(locale, item.slug));
        const card = page.locator("article", { has: link });
        await expect(card.locator("time")).toHaveAttribute("datetime", item.publishedAt);
        const heading = card.getByRole("heading", { level: 2 });
        if (item.locale === locale) await expect(heading).not.toHaveAttribute("lang");
        else await expect(heading).toHaveAttribute("lang", item.locale);
      }
    });

    test("pages on with an Older posts link to a noindex page without canonical", async ({
      page,
    }) => {
      await page.goto(list);
      const pagination = page.getByRole("navigation", { name: t.pagination });
      await pagination.getByRole("link", { name: t.older }).click();
      await expect(page).toHaveURL(new RegExp(`^${SITE}${list}\\?cursor=[A-Za-z0-9_-]+$`));
      const last = items[STUB_PAGE_SIZE];
      await expect(page.getByRole("heading", { level: 2 })).toHaveText([last?.title ?? ""]);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex, follow",
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      // The API gave no next cursor: the last page has no Older posts link.
      await expect(page.getByRole("link", { name: t.older })).toHaveCount(0);
    });

    test("answers a cursor that is not one the API built with the 404 page", async ({ page }) => {
      const response = await page.goto(`${list}?cursor=%3Cscript%3E`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
      await expect(page.locator("body")).not.toContainText("<script>");
    });

    test("renders a post with its date, tags, links and its body through the safe pipeline", async ({
      page,
    }) => {
      const path = postPath(locale, newest.slug);
      await page.goto(path);
      await expect(page).toHaveTitle(`${newest.title} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(newest.title);
      await expect(page.locator("article header time")).toHaveAttribute(
        "datetime",
        newest.publishedAt,
      );
      await expect(page.getByRole("list", { name: t.tags }).getByRole("listitem")).toHaveText(
        newest.tags,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${path}`);
      expect(await hreflangLinks(page)).toEqual([
        ["en", `${SITE}${postPath("en", newest.alternates.en)}`],
        ["es", `${SITE}${postPath("es", newest.alternates.es)}`],
        ["de", `${SITE}${postPath("de", newest.alternates.de ?? "")}`],
        ["x-default", `${SITE}${postPath("en", newest.alternates.en)}`],
      ]);
      // The fixture body carries a script tag the pipeline must drop.
      const body = page.locator("article [data-slot=card]").nth(1);
      await expect(body.getByRole("heading", { level: 2 })).toBeVisible();
      await expect(body.locator("script")).toHaveCount(0);
      expect(await page.evaluate(() => "__xss" in window)).toBe(false);
      await expect(body.locator("[style]")).toHaveCount(0);
    });

    test("answers a slug no post has with the 404 page", async ({ page }) => {
      const response = await page.goto(postPath(locale, "not-a-post"));
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`list has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(list);
        await expectAccessible(page);
      });

      test(`post has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(postPath(locale, newest.slug));
        await expectAccessible(page);
      });
    }
  });
}

test.describe("localized post slugs", () => {
  test("the German fallback shows the English post with lang and an English canonical", async ({
    page,
  }) => {
    const fallback = fixtures.de.find((p) => p.locale === "en");
    if (!fallback) throw new Error("posts.json needs a German fallback");
    await page.goto(postPath("de", fallback.slug));
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
    // The labels around the English text stay German.
    await expect(page.getByRole("link", { name: de.BlogPage.back })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${SITE}${postPath("en", fallback.slug)}`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="de"]')).toHaveCount(0);
  });

  test("another locale's slug redirects to this locale's slug", async ({ page }) => {
    const outbox = fixtures.en[0]?.alternates;
    await page.goto(postPath("de", outbox?.es ?? ""));
    await expect(page).toHaveURL(postPath("de", outbox?.de ?? ""));
    // The oldest post sits on the second list page: the lookup follows the cursor to find it.
    const oldest = fixtures.en[STUB_PAGE_SIZE]?.alternates;
    await page.goto(postPath("en", oldest?.es ?? ""));
    await expect(page).toHaveURL(postPath("en", oldest?.en ?? ""));
  });

  test("the language switcher on a post lands on the translated post", async ({ page }) => {
    await page.goto(postPath("en", fixtures.en[0]?.slug ?? ""));
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page).toHaveURL(postPath("es", fixtures.es[0]?.slug ?? ""));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fixtures.es[0]?.title ?? "");
  });
});
