import { expect, type Page, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import fixtures from "./stub/journal.json" with { type: "json" };
import blogFixtures from "./stub/posts.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

const MESSAGES = { en, es, de } as const;

type Locale = keyof typeof MESSAGES;

/** The path of a journal post page in a locale; `/journal` is the same word in every locale. */
const journalPath = (locale: Locale, slug: string) => `/${locale}/journal/${slug}`;

/** The canonical and hreflang links of the page, as `[hreflang, href]` pairs. */
async function hreflangLinks(page: Page): Promise<(string | null)[][]> {
  return page
    .locator('link[rel="alternate"][hreflang]')
    .evaluateAll((links) => links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]));
}

// Data comes from the stub content API (e2e/stub/journal.json), never from a real `api`.
for (const [key, messages] of Object.entries(MESSAGES)) {
  const locale = key as Locale;
  const list = `/${locale}/journal`;
  const t = messages.JournalPage;
  const items = fixtures[locale];
  const newest = items[0];
  if (!newest) throw new Error("journal.json needs journal posts in every locale");

  test.describe(list, () => {
    test("renders its title, intro, canonical and hreflang links", async ({ page }) => {
      await page.goto(list);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${t.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
      await expect(page.getByText(t.lead)).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${list}`);
      expect(await hreflangLinks(page)).toEqual([
        ["en", `${SITE}/en/journal`],
        ["es", `${SITE}/es/journal`],
        ["de", `${SITE}/de/journal`],
        ["x-default", `${SITE}/en/journal`],
      ]);
    });

    test("lists the journal posts only, each with its WP label and a link under /journal", async ({
      page,
    }) => {
      await page.goto(list);
      const headings = page.locator("main article h2");
      await expect(headings).toHaveText(items.map((p) => p.title));
      for (const item of items) {
        const link = page.getByRole("link", { name: item.title, exact: true });
        await expect(link).toHaveAttribute("href", journalPath(locale, item.slug));
        const card = page.locator("article", { has: link });
        await expect(card.getByText(`WP-${item.wp}`, { exact: true })).toBeVisible();
      }
      // No blog post leaks into the journal.
      for (const blogPost of blogFixtures[locale]) {
        await expect(page.getByRole("link", { name: blogPost.title, exact: true })).toHaveCount(0);
      }
    });

    test("is linked from the footer", async ({ page }) => {
      await page.goto(`/${locale}`);
      await page
        .getByRole("contentinfo")
        .getByRole("link", { name: messages.Footer.journal })
        .click();
      await expect(page).toHaveURL(`${SITE}${list}`);
    });

    test("renders a journal post with its WP label, links and its body through the safe pipeline", async ({
      page,
    }) => {
      const path = journalPath(locale, newest.slug);
      await page.goto(path);
      await expect(page).toHaveTitle(`${newest.title} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(newest.title);
      const header = page.locator("article header");
      await expect(header.locator("time")).toHaveAttribute("datetime", newest.publishedAt);
      await expect(header.getByText(`WP-${newest.wp}`, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: t.back })).toHaveAttribute("href", list);
      const canonical = journalPath(newest.locale as Locale, newest.slug);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE}${canonical}`,
      );
      expect(await hreflangLinks(page)).toEqual([
        ["en", `${SITE}${journalPath("en", newest.alternates.en)}`],
        ["es", `${SITE}${journalPath("es", newest.alternates.es ?? "")}`],
        ["x-default", `${SITE}${journalPath("en", newest.alternates.en)}`],
      ]);
      const body = page.locator("article [data-slot=card]").nth(1);
      await expect(body.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expect(body.locator("script")).toHaveCount(0);
      expect(await page.evaluate(() => "__xss" in window)).toBe(false);
    });

    test("answers a blog post's slug under /journal with the 404 page", async ({ page }) => {
      const blogPost = blogFixtures[locale][0];
      const response = await page.goto(journalPath(locale, blogPost?.slug ?? ""));
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
    });

    test("answers a journal post's slug under /blog with the 404 page", async ({ page }) => {
      const response = await page.goto(`/${locale}/blog/${newest.slug}`);
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
        await page.goto(journalPath(locale, newest.slug));
        await expectAccessible(page);
      });
    }
  });
}

test.describe("localized journal slugs", () => {
  test("another locale's slug redirects to this locale's slug", async ({ page }) => {
    const domain = fixtures.en[0]?.alternates;
    await page.goto(journalPath("en", domain?.es ?? ""));
    await expect(page).toHaveURL(journalPath("en", domain?.en ?? ""));
  });

  test("the language switcher on a journal post lands on the translated post", async ({ page }) => {
    await page.goto(journalPath("en", fixtures.en[0]?.slug ?? ""));
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page).toHaveURL(journalPath("es", fixtures.es[0]?.slug ?? ""));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fixtures.es[0]?.title ?? "");
  });
});
