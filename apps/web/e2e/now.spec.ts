import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };
import { expectAccessible } from "./accessibility";
import journal from "./stub/journal.json" with { type: "json" };

// The server puts SITE_URL in canonical and hreflang links; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

const MESSAGES = { en, es, de } as const;

type Locale = keyof typeof MESSAGES;

/** The locales the stub has a Now text for (e2e/stub/now.json); German answers the 404 problem. */
const WITH_TEXT: readonly Locale[] = ["en", "es"];

// Data comes from the stub content API (e2e/stub/), never from a real `api`.
for (const [key, messages] of Object.entries(MESSAGES)) {
  const locale = key as Locale;
  const path = `/${locale}/now`;
  const t = messages.NowPage;
  const posts = journal[locale];
  const newest = posts[0];
  if (!newest) throw new Error("journal.json needs journal posts in every locale");

  test.describe(path, () => {
    test("renders its title, intro, canonical and hreflang links", async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveTitle(`${t.metaTitle} · jadero.dev`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);
      await expect(page.getByText(t.lead)).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}${path}`);
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
        "href",
        `${SITE}/en/now`,
      );
    });

    if (WITH_TEXT.includes(locale)) {
      test("renders the Now text through the safe pipeline with its updated date", async ({
        page,
      }) => {
        await page.goto(path);
        // The second card of the page holds the Now text (the first is the header).
        const text = page.getByRole("main").locator("[data-slot=card]").nth(1);
        await expect(text.locator("time")).toHaveAttribute("datetime", "2026-10-20T09:30:00.000Z");
        await expect(text.getByRole("heading").first()).toBeVisible();
        await expect(text.locator("strong")).toBeVisible();
        await expect(text.locator("script")).toHaveCount(0);
        await expect(page.getByText(t.empty)).toHaveCount(0);
        expect(await page.evaluate(() => "__xss" in window)).toBe(false);
      });
    } else {
      test("still renders, with a short note, when no Now text is published", async ({ page }) => {
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await expect(page.getByText(t.empty)).toBeVisible();
      });
    }

    test("derives the last finished work package from the latest journal post", async ({
      page,
    }) => {
      await page.goto(path);
      const tile = page.getByRole("region", { name: t.lastFinished });
      await expect(tile.getByText(`WP-${newest.wp}`, { exact: true })).toBeVisible();
      await expect(tile.getByRole("link", { name: newest.title, exact: true })).toHaveAttribute(
        "href",
        `/${locale}/journal/${newest.slug}`,
      );
    });

    test("lists the journal posts after the tile's one and links the journal", async ({ page }) => {
      await page.goto(path);
      const section = page.getByRole("region", { name: t.latestJournal });
      // The newest post is in the "last finished" tile, so the list starts with the next one.
      await expect(section.locator("article h3")).toHaveText(posts.slice(1, 4).map((p) => p.title));
      await expect(section.getByRole("link", { name: t.allJournal })).toHaveAttribute(
        "href",
        `/${locale}/journal`,
      );
    });

    test("is linked from the footer", async ({ page }) => {
      await page.goto(`/${locale}`);
      await page.getByRole("contentinfo").getByRole("link", { name: messages.Footer.now }).click();
      await expect(page).toHaveURL(`${SITE}${path}`);
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await expectAccessible(page);
      });
    }
  });
}
