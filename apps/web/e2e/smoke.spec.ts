import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import de from "../messages/de.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };

const LOCALES = { en, es, de } as const;
// The build bakes SITE_URL into the prerendered HTML; the default matches src/config/site.ts.
const SITE = (process.env.SITE_URL ?? "https://jadero.dev").replace(/\/$/, "");

test.describe("locale routing (ADR-022)", () => {
  test("sends / to the Accept-Language locale", async ({ browser }) => {
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/de$/);
    await context.close();
  });

  test("falls back to English for an unsupported language", async ({ browser }) => {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await context.close();
  });

  test("remembers the chosen locale in a session cookie", async ({ page, context }) => {
    await page.goto("/en");
    await page.getByRole("link", { name: "Deutsch" }).click();
    await expect(page).toHaveURL(/\/de$/);
    const cookie = (await context.cookies()).find((c) => c.name === "NEXT_LOCALE");
    expect(cookie?.value).toBe("de");
    expect(cookie?.expires).toBe(-1); // session cookie: no persistent preference (owner's choice)
    await page.goto("/");
    await expect(page).toHaveURL(/\/de$/);
  });
});

for (const [locale, messages] of Object.entries(LOCALES)) {
  test.describe(`/${locale}`, () => {
    test("renders the home in its language with hreflang alternates", async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.HomePage.title);
      await expect(page.getByText(messages.HomePage.lead)).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `${SITE}/${locale}`,
      );
      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["en", `${SITE}/en`],
        ["es", `${SITE}/es`],
        ["de", `${SITE}/de`],
        ["x-default", `${SITE}/en`],
      ]);
    });

    test("renders the localized 404", async ({ page }) => {
      const response = await page.goto(`/${locale}/does-not-exist`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(messages.NotFound.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    });

    for (const colorScheme of ["light", "dark"] as const) {
      test(`has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(`/${locale}`);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    }
  });
}

test.describe("theme (ADR-023)", () => {
  test("switches to dark and keeps it across a reload without a flash", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/en");
    await page.getByRole("button", { name: en.ThemeToggle.dark }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);

    // The class must be on <html> before any script of the app runs: read it at DOMContentLoaded.
    await page.reload({ waitUntil: "domcontentloaded" });
    const classAtLoad = await page.evaluate(() => document.documentElement.className);
    expect(classAtLoad).toMatch(/\bdark\b/);
    await expect(page.getByRole("button", { name: en.ThemeToggle.dark })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("follows the system preference by default", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/es");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });
});
